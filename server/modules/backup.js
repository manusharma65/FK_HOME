// FK Home — Backup engine (r0.8)
// ----------------------------------------------------------------------------
// Handles:
//   * Nightly off-site backup of the Postgres database to Backblaze B2
//   * Manual on-demand backups via admin UI
//   * Health status for the home page pill
//   * Listing recent backups
//   * Streaming the most recent backup back to the owner for download
//
// How it works:
//   1. Run pg_dump --format=custom --compress=9 against DATABASE_URL.
//      Output is a single binary file in a temp path under /tmp.
//   2. Upload that file to B2 using the S3-compatible API.
//      Bucket: $B2_BUCKET, endpoint: $B2_ENDPOINT.
//      Object key: fkhome-YYYY-MM-DD-HHmmss.dump
//   3. Insert a backup_log row with status, size, duration, B2 key.
//   4. Delete the local temp file regardless of outcome.
//
// Retention is enforced inside B2 itself via a Lifecycle Rule that you set
// once in the B2 console (instructions in DISASTER_RECOVERY.md).
// No retention logic in this file — keep it simple.
//
// Health rule:
//   healthy  — most recent successful backup is < 36 hours old
//   stale    — most recent successful backup is 36-72 hours old
//   missing  — no successful backup, or last success > 72 hours old
// ============================================================================

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { db } = require('../db');
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');

// --- B2 / S3 client setup --------------------------------------------------

function getS3() {
  const endpoint = process.env.B2_ENDPOINT;
  const keyId = process.env.B2_KEY_ID;
  const appKey = process.env.B2_APP_KEY;
  if (!endpoint || !keyId || !appKey) {
    throw new Error('B2 env vars missing — set B2_ENDPOINT, B2_KEY_ID, B2_APP_KEY, B2_BUCKET');
  }
  // Region is embedded in the endpoint (e.g. s3.eu-central-003.backblazeb2.com).
  const m = endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
  const region = m ? m[1] : 'us-east-1';
  return new S3Client({
    endpoint: 'https://' + endpoint,
    region,
    credentials: { accessKeyId: keyId, secretAccessKey: appKey },
    forcePathStyle: true,
  });
}

function getBucket() {
  const b = process.env.B2_BUCKET;
  if (!b) throw new Error('B2_BUCKET env var not set');
  return b;
}

// --- Date helpers ----------------------------------------------------------

function nowLondonDateTimeStamp() {
  // Returns YYYY-MM-DD-HHmmss in London time, for use in object keys.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}

// --- pg_dump runner --------------------------------------------------------

function runPgDump(databaseUrl, outPath) {
  return new Promise((resolve, reject) => {
    // --format=custom: binary, restorable with pg_restore, supports compression.
    // --compress=9:    max compression (slower, smaller upload).
    // --no-owner / --no-privileges: portable across hosts (no role mismatch on restore).
    const args = [
      '--format=custom',
      '--compress=9',
      '--no-owner',
      '--no-privileges',
      '--file=' + outPath,
      databaseUrl,
    ];
    const proc = spawn('pg_dump', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => reject(new Error('pg_dump spawn failed: ' + err.message)));
    proc.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error('pg_dump exited ' + code + ': ' + stderr.slice(0, 500)));
    });
  });
}

// --- Core backup routine ---------------------------------------------------

async function runBackup({ trigger, actorUserId }) {
  if (!['cron', 'manual'].includes(trigger)) {
    throw new Error('Invalid trigger: ' + trigger);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set');

  // Open the log row first so we have something even if pg_dump dies.
  const logIns = await db.query(
    `INSERT INTO backup_log (started_at, status, trigger, actor_user_id)
     VALUES (NOW(), 'running', $1, $2) RETURNING id`,
    [trigger, actorUserId || null]
  );
  const logId = logIns.rows[0].id;
  const t0 = Date.now();

  const stamp = nowLondonDateTimeStamp();
  const objectKey = `fkhome-${stamp}.dump`;
  const tmpPath = path.join(os.tmpdir(), objectKey);

  let bytesWritten = 0;
  try {
    // 1. Dump
    console.log('[backup] starting pg_dump → ' + tmpPath);
    await runPgDump(databaseUrl, tmpPath);
    const stat = fs.statSync(tmpPath);
    bytesWritten = stat.size;
    console.log(`[backup] dump complete: ${(bytesWritten / 1024 / 1024).toFixed(2)} MB`);

    // 2. Upload
    const s3 = getS3();
    const body = fs.readFileSync(tmpPath);
    console.log('[backup] uploading to B2: ' + objectKey);
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: objectKey,
      Body: body,
      ContentType: 'application/octet-stream',
    }));
    console.log('[backup] upload complete');

    // 3. Mark success
    const ms = Date.now() - t0;
    await db.query(
      `UPDATE backup_log
          SET status='success', finished_at=NOW(), size_bytes=$1, duration_ms=$2, object_key=$3
        WHERE id=$4`,
      [bytesWritten, ms, objectKey, logId]
    );
    return { ok: true, id: logId, size_bytes: bytesWritten, object_key: objectKey, duration_ms: ms };
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = (err && err.message) || String(err);
    console.error('[backup] FAILED:', msg);
    await db.query(
      `UPDATE backup_log
          SET status='failed', finished_at=NOW(), duration_ms=$1, error_message=$2
        WHERE id=$3`,
      [ms, msg.slice(0, 800), logId]
    ).catch(() => {});
    return { ok: false, id: logId, error: msg };
  } finally {
    // 4. Always clean up temp file
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
  }
}

// --- Cron entry point ------------------------------------------------------

async function tickNightlyBackup() {
  console.log('[cron] nightly backup tick');
  const r = await runBackup({ trigger: 'cron' });
  if (!r.ok) console.error('[cron] backup failed:', r.error);
}

// --- Queries used by admin endpoints ---------------------------------------

async function listBackups(limit = 60) {
  const r = await db.query(
    `SELECT id, started_at, finished_at, status, trigger,
            size_bytes, duration_ms, object_key, error_message, actor_user_id
       FROM backup_log
      ORDER BY started_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit | 0, 1), 200)]
  );
  return r.rows;
}

async function getHealth() {
  // Find most recent successful backup
  const r = await db.query(
    `SELECT started_at, finished_at, size_bytes, object_key
       FROM backup_log
      WHERE status='success'
      ORDER BY started_at DESC
      LIMIT 1`
  );
  if (r.rows.length === 0) {
    return { status: 'missing', last_success_at: null, hours_since: null };
  }
  const last = r.rows[0];
  const ms = Date.now() - new Date(last.finished_at || last.started_at).getTime();
  const hours = ms / 3_600_000;
  let status;
  if (hours < 36) status = 'healthy';
  else if (hours < 72) status = 'stale';
  else status = 'missing';
  return {
    status,
    last_success_at: last.finished_at || last.started_at,
    hours_since: Math.round(hours * 10) / 10,
    size_bytes: last.size_bytes,
    object_key: last.object_key,
  };
}

async function streamLatestBackup(res) {
  // Find the most recent successful backup and stream it from B2 through to res.
  const r = await db.query(
    `SELECT object_key, size_bytes
       FROM backup_log
      WHERE status='success' AND object_key IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 1`
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: 'No successful backup found yet' });
    return;
  }
  const { object_key, size_bytes } = r.rows[0];
  try {
    const s3 = getS3();
    const obj = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: object_key }));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${object_key}"`);
    if (size_bytes) res.setHeader('Content-Length', String(size_bytes));
    // obj.Body is a Node Readable stream in v3 SDK
    obj.Body.on('error', err => {
      console.error('[backup] stream error:', err.message);
      try { res.end(); } catch (_) {}
    });
    obj.Body.pipe(res);
  } catch (err) {
    console.error('[backup] streamLatestBackup error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed: ' + err.message });
  }
}

// --- Diagnostic helper (does NOT touch DB or upload) -----------------------

function diagnose() {
  // Returns a sanitised view of whether env vars are set. Never exposes secrets.
  return {
    DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'MISSING',
    B2_ENDPOINT:  process.env.B2_ENDPOINT  || 'MISSING',
    B2_BUCKET:    process.env.B2_BUCKET    || 'MISSING',
    B2_KEY_ID:    process.env.B2_KEY_ID    ? 'set'     : 'MISSING',
    B2_APP_KEY:   process.env.B2_APP_KEY   ? 'set'     : 'MISSING',
  };
}

module.exports = {
  runBackup,
  tickNightlyBackup,
  listBackups,
  getHealth,
  streamLatestBackup,
  diagnose,
};
