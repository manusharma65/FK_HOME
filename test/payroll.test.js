// FK Home — payroll rollup tests (C)
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupDb, resetData, db } = require('./helpers/db');
const { createUser } = require('./helpers/fixtures');
const payroll = require('../server/modules/payroll');

before(setupDb);
beforeEach(resetData);

const RANGE = { start: '2026-05-01', end: '2026-05-31' };

// is_paid left NULL so the rollup infers paid/unpaid from status.
async function day(uid, date, status, extra = {}) {
  await db.query(
    `INSERT INTO attendance_day (user_id, for_date, status, sick_notified_hours, weekend_pay_status)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, for_date) DO UPDATE SET status=EXCLUDED.status`,
    [uid, date, status, extra.sick ?? null, extra.weekend ?? null]);
}

test('paid/unpaid/annual-leave inferred from status', async () => {
  const u = await createUser({ name: 'PR1' });
  await day(u.id, '2026-05-06', 'on_time');   // paid
  await day(u.id, '2026-05-07', 'no_show');   // unpaid
  await day(u.id, '2026-05-08', 'on_leave');  // paid + annual leave
  const r = await payroll.rollupForUser(u.id, RANGE);
  assert.equal(r.paid_days, 2);
  assert.equal(r.unpaid_days, 1);
  assert.equal(r.annual_leave, 1);
});

test('sick threshold (>=4h paid, <4h unpaid) and past-pending counts unpaid', async () => {
  const u = await createUser({ name: 'PR2' });
  await day(u.id, '2026-05-06', 'off_sick', { sick: 5 }); // paid + sick_paid
  await day(u.id, '2026-05-07', 'off_sick', { sick: 2 }); // unpaid + sick_unpaid
  await day(u.id, '2026-05-08', 'pending');               // a past day still pending = unpaid
  const r = await payroll.rollupForUser(u.id, RANGE);
  assert.equal(r.paid_days, 1);
  assert.equal(r.unpaid_days, 2);
  assert.equal(r.sick_paid, 1);
  assert.equal(r.sick_unpaid, 1);
});

test('weekend pairs counted from weekend_pay_status', async () => {
  const u = await createUser({ name: 'PR3' });
  await day(u.id, '2026-05-02', 'off_pattern', { weekend: 'paid' }); // Sat
  await day(u.id, '2026-05-03', 'off_pattern', { weekend: 'paid' }); // Sun
  const r = await payroll.rollupForUser(u.id, RANGE);
  assert.equal(r.weekend_pairs_total, 1);
  assert.equal(r.weekend_pairs_paid, 1);
});

test('splitSalary splits 60/30/remainder and always sums back to gross', () => {
  const a = payroll.splitSalary(50000);
  assert.deepEqual(a, { basic: 30000, hra: 15000, special: 5000 });
  assert.equal(a.basic + a.hra + a.special, 50000);
  const b = payroll.splitSalary(33333); // rounding still sums exactly
  assert.equal(b.basic + b.hra + b.special, 33333);
});
