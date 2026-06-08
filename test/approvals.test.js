// FK Home — two-stage approval tests (D)
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupDb, resetData, db } = require('./helpers/db');
const { createUser, addToGroup, reqUser, miniApp } = require('./helpers/fixtures');
const approvalFlow = require('../server/approval-flow');
const leavesRouter = require('../server/modules/leaves');

before(setupDb);
beforeEach(resetData);

// --- routing helpers ---
test('resolveStageOneManager returns the line manager, or null when none', async () => {
  const mgr = await createUser({ name: 'Manager' });
  const withMgr = await createUser({ name: 'Has Manager', managerId: mgr.id });
  const noMgr = await createUser({ name: 'No Manager' });
  assert.equal(await approvalFlow.resolveStageOneManager(withMgr.id), mgr.id);
  assert.equal(await approvalFlow.resolveStageOneManager(noMgr.id), null);
});

test('hrStageOwner never assigns the applicant their own approval', async () => {
  const a = await createUser({ name: 'HR Daily', hrArea: 'daily_ops' });
  const b = await createUser({ name: 'HR Other' });
  await addToGroup(a.id, 'hr-team');
  await addToGroup(b.id, 'hr-team');
  // Normally the daily_ops owner (a). But if a is the applicant, it must fall to b.
  assert.equal(await approvalFlow.hrStageOwner(null), a.id);
  assert.equal(await approvalFlow.hrStageOwner(a.id), b.id);
});

test('createApprovalTask then closeApprovalTask opens and closes the task', async () => {
  const u = await createUser({ name: 'Applicant' });
  await approvalFlow.createApprovalTask({
    kind: 'leave', stage: 'hr', requestId: 4242, applicantUserId: u.id,
    assigneeUserId: u.id, title: 'Leave to approve', body: 'x',
  });
  let r = await db.query(`SELECT status FROM tasks WHERE category='leave' AND meta->>'request_id'='4242'`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].status, 'open');
  await approvalFlow.closeApprovalTask({ kind: 'leave', requestId: 4242, byUserId: u.id });
  r = await db.query(`SELECT status FROM tasks WHERE category='leave' AND meta->>'request_id'='4242'`);
  assert.equal(r.rows[0].status, 'done');
});

// --- route handlers (real leaves router, injected identity) ---
let actingUser = null;
const app = miniApp('/api/leaves', leavesRouter, () => actingUser);

async function pendingLeaveAtManagerStage(applicant, mgr) {
  const ins = await db.query(
    `INSERT INTO leave_requests (user_id, request_type, start_date, end_date, total_days, status, approval_stage, manager_user_id)
     VALUES ($1,'annual',CURRENT_DATE,CURRENT_DATE,1,'pending','manager',$2) RETURNING id`,
    [applicant.id, mgr.id]);
  const id = ins.rows[0].id;
  await approvalFlow.createApprovalTask({
    kind: 'leave', stage: 'manager', requestId: id, applicantUserId: applicant.id,
    assigneeUserId: mgr.id, title: 'Leave to review', body: 'x',
  });
  return id;
}

test('manager agree → moves to HR stage, opens HR task, closes manager task', async () => {
  const mgr = await createUser({ name: 'Mgr' });
  const emp = await createUser({ name: 'Emp', managerId: mgr.id });
  const hr = await createUser({ name: 'HR', hrArea: 'daily_ops' });
  await addToGroup(hr.id, 'hr-team');
  const id = await pendingLeaveAtManagerStage(emp, mgr);

  actingUser = reqUser(mgr, {});
  const res = await request(app).post(`/api/leaves/${id}/manager-decide`).send({ decision: 'agreed' });
  assert.equal(res.status, 200);

  const lr = (await db.query(`SELECT approval_stage, manager_decision FROM leave_requests WHERE id=$1`, [id])).rows[0];
  assert.equal(lr.approval_stage, 'hr');
  assert.equal(lr.manager_decision, 'agreed');
  const hrTask = (await db.query(`SELECT status FROM tasks WHERE meta->>'request_id'=$1 AND meta->>'approval_stage'='hr'`, [String(id)])).rows[0];
  const mgrTask = (await db.query(`SELECT status FROM tasks WHERE meta->>'request_id'=$1 AND meta->>'approval_stage'='manager'`, [String(id)])).rows[0];
  assert.equal(hrTask.status, 'open');
  assert.equal(mgrTask.status, 'done');
});

test('manager disagree → rejected, never reaches HR', async () => {
  const mgr = await createUser({ name: 'Mgr2' });
  const emp = await createUser({ name: 'Emp2', managerId: mgr.id });
  const id = await pendingLeaveAtManagerStage(emp, mgr);

  actingUser = reqUser(mgr, {});
  const res = await request(app).post(`/api/leaves/${id}/manager-decide`).send({ decision: 'disagreed', note: 'no cover' });
  assert.equal(res.status, 200);

  const lr = (await db.query(`SELECT status, approval_stage, manager_decision FROM leave_requests WHERE id=$1`, [id])).rows[0];
  assert.equal(lr.status, 'rejected');
  assert.equal(lr.manager_decision, 'disagreed');
  const hrTask = await db.query(`SELECT 1 FROM tasks WHERE meta->>'request_id'=$1 AND meta->>'approval_stage'='hr'`, [String(id)]);
  assert.equal(hrTask.rows.length, 0); // never created an HR task
});

test('HR decide is refused while still awaiting the manager', async () => {
  const mgr = await createUser({ name: 'Mgr3' });
  const emp = await createUser({ name: 'Emp3', managerId: mgr.id });
  const hr = await createUser({ name: 'HR3' });
  await addToGroup(hr.id, 'hr-team');
  const id = await pendingLeaveAtManagerStage(emp, mgr);

  actingUser = reqUser(hr, { perms: ['leaves.approve.any'], groups: ['hr-team'] });
  const res = await request(app).post(`/api/leaves/${id}/decide`).send({ decision: 'approved' });
  assert.equal(res.status, 400); // "Still awaiting manager review"
});
