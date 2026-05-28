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

    if (existing.rows.length > 0 && existing.rows[0].checksum === checksum) {
      console.log(`[schema] ${file} — already applied`);
      continue;
    }

    try {
      await db.query(sql);
      if (existing.rows.length > 0) {
        await db.query('UPDATE schema_migrations SET checksum=$1, applied_at=NOW() WHERE filename=$2', [checksum, file]);
        console.log(`[schema] ${file} — re-applied (checksum changed)`);
      } else {
        await db.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum]);
        console.log(`[schema] ${file} — applied`);
      }
    } catch (err) {
      console.error(`[schema] FAILED on ${file}: ${err.message}`);
      throw err;
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
