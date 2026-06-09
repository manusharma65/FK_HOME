// FK Home — weekly + monthly scoring tests (E)
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupDb, resetData, db } = require('./helpers/db');
const { createUser } = require('./helpers/fixtures');
const daily = require('../server/modules/daily');

before(setupDb);
beforeEach(resetData);

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

// ---- Weekly ----
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
  for (let i = 0; i < 3; i++) await task(u.id, wk, { done: true, onTime: true });
  await db.query(
    `INSERT INTO attendance_ledger (user_id, kind, points, excused, occurred_on)
     VALUES ($1,'unauth_absence',2,FALSE,$2)`, [u.id, wk]);
  await daily.scoreWeek(u.id, wk);
  const s = await scoreRow(u.id, wk);
  assert.equal(s.band, 'Excellent');
});

// ---- Monthly rollup rules (pure) ----
const M = (weeks) => daily.monthlyBandFromWeeks(weeks).computed;

test('monthly: steady Good weeks → Good', () => {
  assert.equal(M(['Good', 'Good', 'Good', 'Good']), 'Good');
});

test('monthly: strict floor — one Poor week caps the month at Average', () => {
  assert.equal(M(['Excellent', 'Poor', 'Excellent', 'Poor']), 'Average');
  assert.equal(M(['Good', 'Good', 'Good', 'Poor']), 'Average');
});

test('monthly: all-weeks gate — Excellent needs every week Excellent-or-above', () => {
  assert.equal(M(['Excellent', 'Excellent', 'Excellent', 'Good']), 'Good');
  assert.equal(M(['Excellent', 'Excellent', 'Excellent', 'Excellent']), 'Excellent');
  assert.equal(M(['Above Expectations', 'Above Expectations', 'Above Expectations', 'Above Expectations']), 'Above Expectations');
});

test('monthly: a partial month (<4 weeks) cannot reach the top bands', () => {
  assert.equal(M(['Excellent', 'Excellent']), 'Good');
});

// ---- Monthly approval (DB) ----
test('monthly: Excellent needs director approval — effective stays Good until approved', async () => {
  const u = await createUser({ name: 'SCM' });
  for (let i = 0; i < 4; i++) {
    const wkStart = `2026-03-${String(2 + i * 7).padStart(2, '0')}`;
    await db.query(
      `INSERT INTO weekly_scores (user_id, week_start, band, total, correctness_pct)
       VALUES ($1,$2,'Excellent',90,99)`, [u.id, wkStart]);
  }
  const m1 = await daily.computeMonth(u.id, '2026-03-01');
  assert.equal(m1.computed_band, 'Excellent');
  assert.equal(m1.needs_approval, true);
  assert.equal(m1.approval_status, 'pending');
  assert.equal(m1.effective_band, 'Good');

  await db.query(
    `UPDATE monthly_scores SET approval_status='approved', approved_band='Excellent', effective_band='Excellent', approved_by=$1, approved_at=NOW()
      WHERE user_id=$2 AND month_start='2026-03-01'`, [u.id, u.id]);
  const m2 = await daily.computeMonth(u.id, '2026-03-01');
  assert.equal(m2.approval_status, 'approved');
  assert.equal(m2.effective_band, 'Excellent');
});
