// FK Home — schema migration runner
// Runs every .sql file in /server/schema/ in alphabetical order.
// Tracks applied migrations by checksum so re-runs are safe.

const fs = require('fs');
const path = require('path');
const { db } = require('../db');

async function runMigrations() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum TEXT
    )
  `);

  const schemaDir = __dirname;
  const files = fs.readdirSync(schemaDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(schemaDir, file), 'utf8');
    const checksum = simpleHash(sql);
    const existing = await db.query('SELECT checksum FROM schema_migrations WHERE filename = $1', [file]);

    if (existing.rows.length > 0) {
      if (existing.rows[0].checksum === checksum) {
        console.log(`[schema] ${file} — already applied`);
      } else {
        // Migrations are APPEND-ONLY. A shipped .sql whose content changed is
        // deliberately NOT re-run: re-running a non-idempotent migration (seeds,
        // UPDATE/DELETE, CREATE without IF NOT EXISTS) could duplicate or damage
        // live data. To change the schema, add a NEW migration file.
        console.warn(`[schema] ${file} — content CHANGED since it was applied; NOT re-running (append-only). To change schema, add a new migration file.`);
      }
      continue;
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      console.log(`[schema] ${file} — applied`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[schema] FAILED on ${file} (rolled back): ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

module.exports = { runMigrations };
