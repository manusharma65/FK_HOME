// FK Home — approval flow helpers (r0.76)
// ----------------------------------------------------------------------------
// The shared brain for the two-stage manager -> HR approval used by both leave
// (leaves.js) and attendance regularisation (attendance.js). Keeps the routing,
// the approval-task creation, and the task-closing identical for both so they
// can't drift.
//
// An "approval task" is a normal task (so it lives in My Work and is scored by
// assignee like everything else) tagged in meta so the My Work card can render
// the right decision UI:
//   meta = { approval:true, approval_kind:'leave'|'regularisation',
//            request_id:<id>, approval_stage:'manager'|'hr', shared_with:[...] }
// ----------------------------------------------------------------------------

const { db } = require('./db');

// Resolve the stage-1 owner for an applicant: their explicit line manager.
// Returns the manager's user_id, or null if none is set / not active — in which
// case the request skips the manager stage and goes straight to HR.
async function resolveStageOneManager(applicantUserId) {
  try {
    const r = await db.query(
      `SELECT m.id
         FROM users u
         JOIN users m ON m.id = u.manager_user_id
        WHERE u.id = $1
          AND m.deleted_at IS NULL AND m.employment_status = 'active'
          AND m.id <> u.id
        LIMIT 1`,
      [applicantUserId]);
    return r.rows.length ? r.rows[0].id : null;
  } catch (e) {
    console.error('[approval-flow.resolveStageOneManager]', e.message);
    return null; // safe: fall through to HR
  }
}

// Active HR-team member ids (for the shared HR view / coverage).
async function hrTeamIds() {
  try {
    const r = await db.query(
      `SELECT u.id FROM users u
         JOIN user_groups ug ON ug.user_id = u.id
         JOIN groups g ON g.id = ug.group_id
        WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'`);
    return r.rows.map(x => x.id);
  } catch (e) { console.error('[approval-flow.hrTeamIds]', e.message); return []; }
}

// The HR person an HR-stage task lands on: the daily_ops owner (Deepanshi) if
// tagged, else the first HR-team member. Coverage surfacing (built r0.75) lets
// the other HR person pick it up when this one is off.
async function hrStageOwner() {
  try {
    const owner = await db.query(
      `SELECT u.id FROM users u
         JOIN user_groups ug ON ug.user_id = u.id
         JOIN groups g ON g.id = ug.group_id
        WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'
          AND u.hr_area = 'daily_ops'
        ORDER BY u.id LIMIT 1`);
    if (owner.rows.length) return owner.rows[0].id;
    const team = await hrTeamIds();
    return team.length ? team[0] : null;
  } catch (e) { console.error('[approval-flow.hrStageOwner]', e.message); return null; }
}

async function primaryDeptId(userId) {
  try {
    const r = await db.query(
      `SELECT department_id FROM user_department_memberships
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY is_primary DESC NULLS LAST, department_id LIMIT 1`, [userId]);
    return r.rows.length ? r.rows[0].department_id : null;
  } catch (e) { return null; }
}

async function hrDeptId() {
  try {
    const r = await db.query(`SELECT id FROM departments WHERE LOWER(name) = 'hr' LIMIT 1`);
    return r.rows.length ? r.rows[0].id : null;
  } catch (e) { return null; }
}

// Create the approval task for a stage. Returns nothing (best-effort, logged).
//   kind: 'leave' | 'regularisation'
//   stage: 'manager' | 'hr'
//   assigneeUserId: who must act (manager for stage 1; HR owner for stage 2)
async function createApprovalTask({ kind, stage, requestId, applicantUserId, assigneeUserId, title, body }) {
  if (!assigneeUserId) return;
  try {
    const shared = stage === 'hr' ? await hrTeamIds() : [];
    const deptId = stage === 'hr' ? await hrDeptId() : await primaryDeptId(applicantUserId);
    const meta = {
      approval: true,
      approval_kind: kind,
      request_id: String(requestId),
      approval_stage: stage,
      shared_with: shared,
      context_url: '#my-work',
    };
    await db.query(
      `INSERT INTO tasks
         (kind, source, title, body, category, assignee_user_id, related_user_id,
          department_id, status, opens_at, meta)
       VALUES ('event','auto_event',$1,$2,$3,$4,$5,$6,'open',NOW(),$7)`,
      [title, body || null, kind, assigneeUserId, applicantUserId, deptId, JSON.stringify(meta)]);
  } catch (e) {
    console.error('[approval-flow.createApprovalTask]', e.message);
  }
}

// Close the open approval task(s) for a request (any stage). Marks done so it
// leaves the owner's plate and is recorded as completed by whoever decided.
async function closeApprovalTask({ kind, requestId, byUserId }) {
  try {
    await db.query(
      `UPDATE tasks
          SET status='done', completed_at=NOW(), completed_by_user_id=$1, updated_at=NOW()
        WHERE category=$2
          AND (meta->>'approval') = 'true'
          AND (meta->>'request_id') = $3
          AND status NOT IN ('done','cancelled')`,
      [byUserId || null, kind, String(requestId)]);
  } catch (e) {
    console.error('[approval-flow.closeApprovalTask]', e.message);
  }
}

async function ownerIds() {
  try {
    const r = await db.query(
      `SELECT u.id FROM users u
         JOIN user_groups ug ON ug.user_id = u.id
         JOIN groups g ON g.id = ug.group_id
        WHERE g.slug = 'owner' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'`);
    return r.rows.map(x => x.id);
  } catch (e) { console.error('[approval-flow.ownerIds]', e.message); return []; }
}

module.exports = {
  resolveStageOneManager, hrTeamIds, hrStageOwner, ownerIds, primaryDeptId, hrDeptId,
  createApprovalTask, closeApprovalTask,
};
