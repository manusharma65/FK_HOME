// FK Home — test DB harness
// Reuses the app's REAL initDb + migrations + seed against a throwaway Postgres
// (a local instance, or the GitHub Actions postgres service). High fidelity:
// the same migration path and scaffolding the app boots with.
//
// Requires DATABASE_URL to point at a disposable database. NEVER point this at
// production — resetData() truncates tables.

const { initDb, db } = require('../../server/db');
const { runMigrations } = require('../../server/schema');
const { seedInitialData } = require('../../server/schema/seed');

let ready = false;

async function setupDb() {
  if (ready) return db;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set for tests');
  if (/prod|railway\.app/.test(process.env.DATABASE_URL) && !process.env.FK_TEST_ALLOW) {
    throw new Error('Refusing to run tests against what looks like a production URL');
  }
  await initDb();
  await runMigrations();
  await seedInitialData();
  ready = true;
  return db;
}

// Volatile tables wiped between tests. Seeded scaffolding (groups, permissions,
// departments, the owner) is kept so we don't re-seed every test.
const VOLATILE = [
  'tasks', 'leave_requests', 'attendance_regularisations', 'attendance_day',
  'leave_balances', 'leave_accrual_log', 'weekly_scores', 'attendance_ledger',
  'recognition_log', 'notifications', 'audit_log', 'shift_log',
];

async function resetData() {
  await db.query(`TRUNCATE ${VOLATILE.join(', ')} RESTART IDENTITY CASCADE`);
  // Drop test-created users (and their memberships) — keep the seeded owner.
  await db.query(`DELETE FROM user_department_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test+%')`);
  await db.query(`DELETE FROM user_groups WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test+%')`);
  await db.query(`DELETE FROM users WHERE email LIKE 'test+%'`);
}

module.exports = { setupDb, resetData, db };
