// FK Home — weekly scoring band tests (E)
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupDb, resetData, db } = require('./helpers/db');
const { createUser } = require('./helpers/fixtures');
const daily = require('../server/modules/daily');

before(setupDb);
beforeEach(resetData);

// A Monday three weeks ago, so all task deadlines sit safely in the past.
function pastMonday() {
  const now = new Date();
  const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = dt.getUTCDay();
  const daysBack = (day === 0 ? 6 : day - 1) + 21;
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  return dt.toISOString().slice(0, 10);
}

async function task(uid, dueDate, { done = true, onTime = true } = {}) {
  const due = dueDate + 'T12:00:00Z';
  const completed = done ? (onTime ? dueDate + 'T10:00:00Z' : dueDate + 'T20:00:00Z') : null;
  await db.query(
    `INSERT INTO tasks (assignee_user_id, kind, category, title, status, source, due_at, completed_at)
     VALUES ($1,'ad_hoc','task',$2,$3,'system',$4,$5)`,
    [uid, done ? 'done' : 'open', done ? 'done' : 'open', due, completed]);
}

async function scoreRow(uid, weekStart) {
  const r = await db.query(`SELECT band, band_capped, correctness_pct FROM weekly_scores WHERE user_id=$1 AND week_start=$2`, [uid, weekStart]);
  return r.rows[0];
}

test('all tasks done on time → 100% correctness → top band', async () => {
  const u = await createUser({ name: 'SC1' });
  const wk = pastMonday();
  for (let i = 0; i < 3; i++) await task(u.id, wk, { done: true, onTime: true });
  await daily.scoreWeek(u.id, wk);
  const s = await scoreRow(u.id, wk);
  assert.equal(Number(s.correctness_pct), 100);
  assert.equal(s.band, 'Above Expectations');
});

test('a genuinely not-done task caps the band at Good', async () => {
  const u = await createUser({ name: 'SC2' });
  const wk = pastMonday();
  // 49 done-on-time + 1 not-done = 98% correctness (Excellent) → capped to Good
  for (let i = 0; i < 49; i++) await task(u.id, wk, { done: true, onTime: true });
  await task(u.id, wk, { done: false });
  await daily.scoreWeek(u.id, wk);
  const s = await scoreRow(u.id, wk);
  assert.equal(s.band, 'Good');
  assert.equal(s.band_capped, true);
});

test('an unauthorised absence drops the band one level', async () => {
  const u = await createUser({ name: 'SC3' });
  const wk = pastMonday();
  for (let i = 0; i < 3; i++) await task(u.id, wk, { done: true, onTime: true }); // 100% → Above Expectations
  await db.query(
    `INSERT INTO attendance_ledger (user_id, kind, points, excused, occurred_on)
     VALUES ($1,'unauth_absence',2,FALSE,$2)`, [u.id, wk]);
  await daily.scoreWeek(u.id, wk);
  const s = await scoreRow(u.id, wk);
  assert.equal(s.band, 'Excellent'); // one below Above Expectations
});
