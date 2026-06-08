// FK Home — leave engine tests (A)
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupDb, resetData, db } = require('./helpers/db');
const { createUser, monthsAgoFirst } = require('./helpers/fixtures');
const engine = require('../server/modules/leave-engine');

before(setupDb);
beforeEach(resetData);

// --- pure logic ---
test('accrualRateForTenure: 1.0/mo for first 6 months, 1.5/mo after', () => {
  assert.equal(engine.accrualRateForTenure(1), 1.0);
  assert.equal(engine.accrualRateForTenure(6), 1.0);
  assert.equal(engine.accrualRateForTenure(7), 1.5);
  assert.equal(engine.accrualRateForTenure(24), 1.5);
});

test('monthsBetween counts whole months and respects day-of-month edges', () => {
  assert.equal(engine.monthsBetween('2025-06-15', '2026-06-15'), 12);
  assert.equal(engine.monthsBetween('2026-03-15', '2026-06-15'), 3);
  assert.equal(engine.monthsBetween('2025-06-15', '2026-06-14'), 11); // a day short = not a full month
  assert.equal(engine.monthsBetween('2026-01-31', '2026-02-28'), 0);  // month-end: not yet a full month
});

// --- accrual integration (real DB) ---
test('joiner under 6 months accrues 1.0/month', async () => {
  const u = await createUser({ hire: monthsAgoFirst(3) });
  const r = await engine.recomputeBalanceFor(u.id);
  assert.equal(r.ok, true);
  assert.equal(r.accrued_days, 3.0);
});

test('tenure crossing 6 months: first 6 at 1.0, rest at 1.5', async () => {
  const u = await createUser({ hire: monthsAgoFirst(8) });
  const r = await engine.recomputeBalanceFor(u.id);
  assert.equal(r.accrued_days, 9.0); // 6*1.0 + 2*1.5
});

test('anniversary resets the leave year — no carryover from year 1', async () => {
  const u = await createUser({ hire: monthsAgoFirst(14) }); // anniversary was 2 months ago
  const r = await engine.recomputeBalanceFor(u.id);
  // Only the 2 months since the anniversary count, both at the >6mo rate.
  assert.equal(r.accrued_days, 3.0); // 2 * 1.5, NOT a full year's ~21 days
});

test('recomputeBalanceFor returns ok:false when hire_date is missing', async () => {
  const u = await createUser({ hire: null });
  const r = await engine.recomputeBalanceFor(u.id);
  assert.equal(r.ok, false);
});

// --- balance math (real DB) ---
test('getBalance remaining = entitled - taken - pending', async () => {
  const u = await createUser({ hire: monthsAgoFirst(8) }); // entitled 9.0
  const anniv = monthsAgoFirst(8);
  // an approved 2-day leave and a pending 1-day leave, both inside the leave year
  await db.query(`INSERT INTO leave_requests (user_id, request_type, start_date, end_date, total_days, status)
                  VALUES ($1,'annual',$2,$2,2,'approved')`, [u.id, monthsAgoFirst(1)]);
  await db.query(`INSERT INTO leave_requests (user_id, request_type, start_date, end_date, total_days, status)
                  VALUES ($1,'annual',$2,$2,1,'pending')`, [u.id, monthsAgoFirst(0)]);
  await engine.recomputeBalanceFor(u.id);
  const b = await engine.getBalance(u.id);
  assert.equal(b.used, 2);
  assert.equal(b.remaining, 9.0 - 2 - 1); // 6
  void anniv;
});

test('leave dated before the anniversary does not reduce the new year balance', async () => {
  const u = await createUser({ hire: monthsAgoFirst(14) }); // anniversary 2 months ago, entitled 3.0
  // approved leave 5 months ago = BEFORE the anniversary → must not count
  await db.query(`INSERT INTO leave_requests (user_id, request_type, start_date, end_date, total_days, status)
                  VALUES ($1,'annual',$2,$2,2,'approved')`, [u.id, monthsAgoFirst(5)]);
  // approved leave 1 month ago = inside the current year → counts
  await db.query(`INSERT INTO leave_requests (user_id, request_type, start_date, end_date, total_days, status)
                  VALUES ($1,'annual',$2,$2,1,'approved')`, [u.id, monthsAgoFirst(1)]);
  const r = await engine.recomputeBalanceFor(u.id);
  assert.equal(r.taken_days, 1); // only the in-year one
});

test('a half-day leave reduces taken by 0.5', async () => {
  const u = await createUser({ hire: monthsAgoFirst(8) });
  await db.query(`INSERT INTO leave_requests (user_id, request_type, start_date, end_date, total_days, is_half_day, status)
                  VALUES ($1,'annual',$2,$2,0.5,TRUE,'approved')`, [u.id, monthsAgoFirst(1)]);
  const r = await engine.recomputeBalanceFor(u.id);
  assert.equal(Number(r.taken_days), 0.5);
});
