// FK Home — weekend conditional pay tests (B)
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupDb, resetData, db } = require('./helpers/db');
const { createUser } = require('./helpers/fixtures');
const engine = require('../server/modules/leave-engine');

before(setupDb);
beforeEach(resetData);

// The Mon–Sun week containing today (matches tickWeeklyWeekendPay's own math).
function weekDates() {
  const now = new Date();
  const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = dt.getUTCDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const mon = new Date(dt); mon.setUTCDate(mon.getUTCDate() - daysBack);
  const iso = (d) => d.toISOString().slice(0, 10);
  const at = (n) => { const x = new Date(mon); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
  return { mon: at(0), tue: at(1), wed: at(2), thu: at(3), fri: at(4), sat: at(5), sun: at(6) };
}

async function seedDay(uid, date, status, sickHours = null) {
  await db.query(
    `INSERT INTO attendance_day (user_id, for_date, status, sick_notified_hours)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, for_date) DO UPDATE SET status=EXCLUDED.status, sick_notified_hours=EXCLUDED.sick_notified_hours`,
    [uid, date, status, sickHours]);
}

async function weekendStatus(uid, date) {
  const r = await db.query(`SELECT weekend_pay_status FROM attendance_day WHERE user_id=$1 AND for_date=$2`, [uid, date]);
  return r.rows[0] ? r.rows[0].weekend_pay_status : null;
}

test('5 worked days qualifies — Saturday and Sunday both paid', async () => {
  const u = await createUser({ name: 'WP1' });
  const w = weekDates();
  for (const d of [w.mon, w.tue, w.wed, w.thu, w.fri]) await seedDay(u.id, d, 'on_time');
  await engine.tickWeeklyWeekendPay();
  assert.equal(await weekendStatus(u.id, w.sat), 'paid');
  assert.equal(await weekendStatus(u.id, w.sun), 'paid');
});

test('4 worked days does not qualify — weekend unpaid (no proration)', async () => {
  const u = await createUser({ name: 'WP2' });
  const w = weekDates();
  for (const d of [w.mon, w.tue, w.wed, w.thu]) await seedDay(u.id, d, 'on_time');
  await engine.tickWeeklyWeekendPay();
  assert.equal(await weekendStatus(u.id, w.sat), 'unpaid');
  assert.equal(await weekendStatus(u.id, w.sun), 'unpaid');
});

test('approved leave counts toward the 5 qualifying days', async () => {
  const u = await createUser({ name: 'WP3' });
  const w = weekDates();
  for (const d of [w.mon, w.tue, w.wed, w.thu]) await seedDay(u.id, d, 'on_time');
  await seedDay(u.id, w.fri, 'on_leave'); // 4 worked + 1 leave = 5
  await engine.tickWeeklyWeekendPay();
  assert.equal(await weekendStatus(u.id, w.sat), 'paid');
});

test('short-notice sick (<4h notified) does not count toward qualifying', async () => {
  const u = await createUser({ name: 'WP4' });
  const w = weekDates();
  for (const d of [w.mon, w.tue, w.wed, w.thu]) await seedDay(u.id, d, 'on_time');
  await seedDay(u.id, w.fri, 'off_sick', 2); // notified only 2h → excluded → 4 qualifying
  await engine.tickWeeklyWeekendPay();
  assert.equal(await weekendStatus(u.id, w.sat), 'unpaid');
});
