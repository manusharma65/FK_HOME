// FK Home — monitoring (r1.01)
// ----------------------------------------------------------------------------
// A best-effort error sink + a daily heartbeat. The cardinal rule: logging must
// NEVER throw — a failing logger must not mask the original error. Everything
// here swallows its own failures and falls back to console.
//
//   logError(context, err, meta)  — write one row to system_errors (best effort)
//   errorMiddleware               — Express safety net for unhandled route throws
//   installProcessHandlers()      — capture unhandledRejection / uncaughtException
//   tickHeartbeat()               — daily: stamp a heartbeat + count 24h errors
//   health()                      — for GET /healthz
// ----------------------------------------------------------------------------
const { db } = require('../db');

const bootedAt = Date.now();
const DAY_MS = 24 * 3600 * 1000;

async function logError(context, err, meta = {}) {
  try {
    const message = (err && err.message) ? err.message : String(err);
    const stack = (err && err.stack) ? String(err.stack).slice(0, 8000) : null;
    await db.query(
      `INSERT INTO system_errors (context, method, path, user_id, message, stack)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [String(context || '').slice(0, 200), meta.method || null, meta.path || null,
       meta.userId || null, String(message).slice(0, 2000), stack]
    );
  } catch (e) {
    console.error('[monitoring] logError failed:', e.message);
  }
}

// Express error-handling middleware (4-arg). Safety net for synchronous route
// throws / explicit next(err) — modules that catch their own errors never reach
// here, so this stays low-noise. Logs, then returns a clean 500.
function errorMiddleware(err, req, res, next) {
  logError('express', err, { method: req.method, path: req.path, userId: req.user && req.user.id });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal error' });
}

function installProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason && reason.message ? reason.message : reason);
    logError('unhandledRejection', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err && err.message);
    // Log, then exit so the platform restarts us in a known-good state.
    logError('uncaughtException', err).finally(() => process.exit(1));
  });
}

async function errorsSince(sinceIso) {
  try {
    const r = await db.query(`SELECT COUNT(*)::int AS n FROM system_errors WHERE occurred_at >= $1`, [sinceIso]);
    return r.rows[0].n;
  } catch (e) { return null; }
}

// Daily: stamp a heartbeat into system_state + report the last 24h error count.
async function tickHeartbeat() {
  const now = new Date().toISOString();
  const n = await errorsSince(new Date(Date.now() - DAY_MS).toISOString());
  try {
    await db.query(
      `INSERT INTO system_state (key, value) VALUES ('heartbeat:last', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`, [now]);
  } catch (e) { console.error('[monitoring] heartbeat save', e.message); }
  console.log(`[heartbeat] ${now} — errors in last 24h: ${n == null ? 'unknown' : n}`);
  return { now, errors24h: n };
}

async function health() {
  let lastHeartbeat = null;
  try {
    const r = await db.query(`SELECT value FROM system_state WHERE key = 'heartbeat:last'`);
    lastHeartbeat = r.rows[0] ? r.rows[0].value : null;
  } catch (e) { /* table may be mid-migration; report null */ }
  const errors24h = await errorsSince(new Date(Date.now() - DAY_MS).toISOString());
  return { ok: true, uptime_s: Math.round((Date.now() - bootedAt) / 1000), lastHeartbeat, errors24h };
}

module.exports = { logError, errorMiddleware, installProcessHandlers, tickHeartbeat, health };
