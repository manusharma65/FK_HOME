// FK Home — Employee ID (FK###) assignment.
// New users get the next FK number on creation; existing staff are backfilled
// once at boot. HR can override any emp_id from the profile. All idempotent.

const { db } = require('../db');

async function maxEmpNumber() {
  const r = await db.query(`SELECT emp_id FROM users WHERE emp_id ~ '^FK[0-9]+$'`);
  let max = 100; // first assigned id is FK101
  for (const row of r.rows) {
    const n = parseInt(row.emp_id.slice(2), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

// Next free FK id as a string, e.g. "FK101".
async function nextEmpId() {
  return 'FK' + (await maxEmpNumber() + 1);
}

// One-time backfill: give every active user without an emp_id an FK number.
// Naturally idempotent — only touches rows where emp_id IS NULL.
async function runEmpIdBackfillIfNeeded() {
  const missing = await db.query(
    `SELECT id FROM users WHERE emp_id IS NULL AND deleted_at IS NULL
      ORDER BY hire_date NULLS LAST, id`
  );
  if (missing.rows.length === 0) return;
  let next = (await maxEmpNumber()) + 1;
  let done = 0;
  for (const row of missing.rows) {
    try {
      await db.query(
        `UPDATE users SET emp_id = $1, updated_at = NOW() WHERE id = $2 AND emp_id IS NULL`,
        ['FK' + next, row.id]
      );
      next++; done++;
    } catch (e) {
      // Collision (someone set the same id manually) — skip and move on.
      if (e.code === '23505') { next++; continue; }
      throw e;
    }
  }
  console.log('[emp-id] backfilled ' + done + ' user(s)');
}

module.exports = { nextEmpId, runEmpIdBackfillIfNeeded };
