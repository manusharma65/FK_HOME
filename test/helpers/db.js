// FK Home — test DB harness
const { initDb, db } = require('../../server/db');
const { runMigrations } = require('../../server/schema');
const { seedInitialData } = require('../../server/schema/seed');

let ready = false;
async function setupDb() {
  if (ready) return db;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set for tests');
  await initDb();
  await runMigrations();
  await seedInitialData();
  ready = true;
  return db;
}

const VOLATILE = [
  'tasks', 'leave_requests', 'attendance_regularisations', 'attendance_day',
  'leave_balances', 'leave_accrual_log', 'weekly_scores', 'monthly_scores',
  'attendance_ledger', 'recognition_log', 'notifications', 'audit_log', 'shift_log',
];

async function resetData() {
  await db.query(`TRUNCATE ${VOLATILE.join(', ')} RESTART IDENTITY CASCADE`);
  await db.query(`DELETE FROM user_department_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test+%')`);
  await db.query(`DELETE FROM user_groups WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test+%')`);
  await db.query(`DELETE FROM users WHERE email LIKE 'test+%'`);
}

module.exports = { setupDb, resetData, db };
