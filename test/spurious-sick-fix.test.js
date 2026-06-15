// FK Home — proves the one-time off_sick re-stamp (the "calendar all purple" fix).
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupDb, resetData, db } = require('./helpers/db');
const { createUser, addToDept } = require('./helpers/fixtures');
const att = require('../server/modules/attendance');

before(setupDb);
beforeEach(async () => {
  // fixSpuriousSick reads sick_log + a system_state guard — neither is in the
  // standard volatile-truncate list. Clear them BEFORE resetData, so resetData's
  // user-delete doesn't trip the sick_log foreign key.
  await db.query("DELETE FROM sick_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test+%')");
  await db.query("DELETE FROM system_state WHERE key = 'fix:spurious_sick_v2'");
  await resetData();
});

function dStr(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
async function addDay(userId, date, status, opts = {}) {
  await db.query(
    `INSERT INTO attendance_day (user_id, for_date, status, first_login, shift_start_local)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, date, status, opts.first_login || null, opts.shift_start || null]
  );
}

test('open-ended sick log froze 30 days as off_sick — fix clears all but the real sick day', async () => {
  const u = await createUser({ hire: '2025-01-01' });
  await addToDept(u.id, 'amazon', 'agent');

  // The bug: an open-ended sick log starting 29 days ago.
  const start = dStr(29);
  await db.query(`INSERT INTO sick_log (user_id, start_date, end_date) VALUES ($1,$2,NULL)`, [u.id, start]);

  // ...made the nightly seed stamp every day off_sick. Mix worked + non-worked days.
  for (let i = 29; i >= 0; i--) {
    const date = dStr(i);
    const worked = (i % 3 === 0);
    await addDay(u.id, date, 'off_sick', worked ? { first_login: date + 'T09:05:00Z', shift_start: '09:00' } : {});
  }

  // Migration 46 later closed the open log (end_date := start_date).
  await db.query(`UPDATE sick_log SET end_date = start_date WHERE user_id = $1 AND end_date IS NULL`, [u.id]);

  const before = await db.query(`SELECT COUNT(*)::int n FROM attendance_day WHERE user_id=$1 AND status='off_sick'`, [u.id]);
  assert.equal(before.rows[0].n, 30, 'before: the grid would paint all 30 days purple');

  // The fix runs via the existing boot hook.
  await att.reconcileTodayPattern();

  const after = await db.query(`SELECT for_date::text d, status FROM attendance_day WHERE user_id=$1 ORDER BY for_date`, [u.id]);
  const sick = after.rows.filter(r => r.status === 'off_sick');
  assert.equal(sick.length, 1, 'after: exactly one real sick day remains');
  assert.equal(sick[0].d, start, 'and it is the day the closed sick_log actually covers');

  const worked = after.rows.filter(r => ['on_time', 'late', 'very_late'].includes(r.status));
  assert.ok(worked.length >= 1, 'days with a login re-derived to a worked status (green/amber)');
});

test('a genuinely-sick range is left completely untouched', async () => {
  const u = await createUser({ hire: '2025-01-01' });
  await addToDept(u.id, 'amazon', 'agent');

  const s = dStr(10), e = dStr(6); // a real, properly-closed 5-day sick spell
  await db.query(`INSERT INTO sick_log (user_id, start_date, end_date) VALUES ($1,$2,$3)`, [u.id, s, e]);
  for (let i = 10; i >= 6; i--) await addDay(u.id, dStr(i), 'off_sick');

  await att.reconcileTodayPattern();

  const n = await db.query(`SELECT COUNT(*)::int n FROM attendance_day WHERE user_id=$1 AND status='off_sick'`, [u.id]);
  assert.equal(n.rows[0].n, 5, 'all 5 genuinely-sick days stay off_sick');
});

test('idempotent — a second boot does not touch anything again', async () => {
  const u = await createUser({ hire: '2025-01-01' });
  await addToDept(u.id, 'amazon', 'agent');

  await addDay(u.id, dStr(2), 'off_sick'); // spurious: no sick_log at all
  await att.reconcileTodayPattern();
  const first = await db.query(`SELECT status FROM attendance_day WHERE user_id=$1 AND for_date=$2`, [u.id, dStr(2)]);
  assert.notEqual(first.rows[0].status, 'off_sick', 'first pass clears the spurious day');

  // Insert another spurious off_sick AFTER the guard is set — must be left alone.
  await addDay(u.id, dStr(3), 'off_sick');
  await att.reconcileTodayPattern();
  const second = await db.query(`SELECT status FROM attendance_day WHERE user_id=$1 AND for_date=$2`, [u.id, dStr(3)]);
  assert.equal(second.rows[0].status, 'off_sick', 'guard prevents a second pass (runs once, ever)');
});
