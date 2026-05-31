// FK Home — /api/tasks/*
// ----------------------------------------------------------------------------
// The universal task queue + the assignment/request engine.
//
// A task is personal by default (assignee_user_id = the doer). It reaches
// someone else in one of three ways, auto-detected from the relationship
// between creator and target — the creator never picks a "mode":
//   * assignment — manager/owner → someone in a dept they run. Lands direct.
//   * handoff    — my own task → a teammate (same dept). Lands direct.
//   * request    — anyone → someone in ANOTHER department. Needs accept/decline.
//
// Scoring rule (locked): the DOER scores. assignee_user_id always = current doer;
// assigned_by_user_id records who put it there; reassign_history logs handoffs.
//
// Permission tiers for originating onto others (managers-and-up only):
//   * owner            → assign to anyone, any dept
//   * manager/lead/HR  → assign to people in a dept they run
//   * regular agent    → self only (may hand off their OWN task to a teammate)
//   * ANYONE           → may send a cross-dept REQUEST (receiver accepts/declines)
//
// Routes:
//   GET  /api/tasks/mine            -> { groups, incoming_requests, my_requests, total }
//   GET  /api/tasks/summary         -> home card counts
//   GET  /api/tasks/assignable      -> people this user may assign to (for the card)
//   POST /api/tasks                 -> create (self / assign / request, auto-detected)
//   POST /api/tasks/:id/action      -> start | complete | move | reopen
//   POST /api/tasks/:id/accept      -> accept a request (becomes mine)
//   POST /api/tasks/:id/decline     -> decline a request (bounces back)
//   GET  /api/tasks/:id             -> single task
//   POST /api/tasks/:id/dismiss     -> voluntarily mark done
//   GET  /api/tasks/admin/all       -> admin view
//   POST /api/tasks/admin/tick      -> manual cron tick

const express = require('express');
const { db } = require('../db');
const { requireAuth, logAudit } = require('../auth');
const { notifyEvent } = require('../notify');
const lifecycle = require('./lifecycle');

const router = express.Router();
router.use(requireAuth);

const TASK_SELECT = `
  t.id, t.kind, t.source, t.category, t.title, t.body,
  t.opens_at, t.due_at, t.status, t.reason,
  t.related_user_id, t.related_profile_note_id, t.parent_task_id,
  t.department_id, t.moved_at, t.movement_note, t.meta,
  t.assigned_by_user_id, t.request_status, t.requester_user_id, t.decline_reason,
  t.created_at, t.updated_at,
  u.full_name AS related_full_name, u.display_name AS related_display_name,
  u.avatar_colour AS related_avatar_colour, u.initials AS related_initials,
  ab.display_name AS assigned_by_name, ab.full_name AS assigned_by_full_name,
  rq.display_name AS requester_name, rq.full_name AS requester_full_name`;

const TASK_JOINS = `
  LEFT JOIN users u  ON u.id  = t.related_user_id
  LEFT JOIN users ab ON ab.id = t.assigned_by_user_id
  LEFT JOIN users rq ON rq.id = t.requester_user_id`;

// ---------- department helpers ----------
// Departments a user belongs to (ids).
async function deptIdsFor(userId) {
  const r = await db.query(
    `SELECT department_id FROM user_department_memberships
      WHERE user_id = $1 AND deleted_at IS NULL`, [userId]);
  return r.rows.map(x => x.department_id);
}
// Departments a user RUNS (manager/lead).
async function deptsManagedBy(userId) {
  const r = await db.query(
    `SELECT department_id FROM user_department_memberships
      WHERE user_id = $1 AND role IN ('manager','lead') AND deleted_at IS NULL`, [userId]);
  return r.rows.map(x => x.department_id);
}
// Do the two users share any department?
async function shareDept(aId, bId) {
  const a = await deptIdsFor(aId);
  if (a.length === 0) return false;
  const r = await db.query(
    `SELECT 1 FROM user_department_memberships
      WHERE user_id = $1 AND department_id = ANY($2::int[]) AND deleted_at IS NULL LIMIT 1`,
    [bId, a]);
  return r.rows.length > 0;
}
// Does `actor` manage a dept that `target` is in?
async function actorManagesTarget(actorId, targetId) {
  const managed = await deptsManagedBy(actorId);
  if (managed.length === 0) return false;
  const r = await db.query(
    `SELECT 1 FROM user_department_memberships
      WHERE user_id = $1 AND department_id = ANY($2::int[]) AND deleted_at IS NULL LIMIT 1`,
    [targetId, managed]);
  return r.rows.length > 0;
}

function groupFor(t) {
  if (t.status === 'in_progress') return 'in_progress';
  if (t.kind === 'recurring') return 'recurring';
  return 'needs_action';
}

// ---------- GET /api/tasks/mine ----------
router.get('/mine', async (req, res) => {
  try {
    // My active tasks (things I'm the doer of), excluding requests still awaiting
    // MY acceptance (those show in incoming_requests) and recruitment openings.
    const r = await db.query(
      `SELECT ${TASK_SELECT}
         FROM tasks t ${TASK_JOINS}
        WHERE t.assignee_user_id = $1
          AND t.status IN ('open','due','overdue','in_progress')
          AND NOT (t.kind = 'recruitment' AND t.parent_task_id IS NULL)
          AND (t.request_status IS NULL OR t.request_status = 'accepted')
        ORDER BY CASE t.status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1
                               WHEN 'in_progress' THEN 2 ELSE 3 END,
                 t.due_at ASC NULLS LAST, t.created_at DESC`,
      [req.user.id]);
    const groups = { needs_action: [], recurring: [], in_progress: [] };
    for (const t of r.rows) groups[groupFor(t)].push(t);

    // Requests waiting for ME to accept/decline (I'm the target, still awaiting).
    const incoming = await db.query(
      `SELECT ${TASK_SELECT}
         FROM tasks t ${TASK_JOINS}
        WHERE t.assignee_user_id = $1 AND t.request_status = 'awaiting'
        ORDER BY t.created_at DESC`, [req.user.id]);

    // Requests I SENT that are still awaiting / recently resolved (so I see outcomes).
    const mine = await db.query(
      `SELECT ${TASK_SELECT}
         FROM tasks t ${TASK_JOINS}
        WHERE t.requester_user_id = $1 AND t.assignee_user_id <> $1
          AND t.request_status IN ('awaiting','declined')
        ORDER BY t.updated_at DESC`, [req.user.id]);

    res.json({
      groups,
      incoming_requests: incoming.rows,
      my_requests: mine.rows,
      total: r.rows.length + incoming.rows.length,
    });
  } catch (e) {
    console.error('[tasks/mine] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/tasks/summary ----------
router.get('/summary', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('open','due','overdue')
                          AND (request_status IS NULL OR request_status='accepted')
                          AND NOT (kind='recruitment' AND parent_task_id IS NULL)) AS to_action,
         COUNT(*) FILTER (WHERE status='in_progress') AS in_progress,
         COUNT(*) FILTER (WHERE status='overdue'
                          AND (request_status IS NULL OR request_status='accepted')) AS overdue
       FROM tasks
      WHERE assignee_user_id = $1 AND status IN ('open','due','overdue','in_progress')
        AND (request_status IS NULL OR request_status='accepted')`,
      [req.user.id]);
    const inc = await db.query(
      `SELECT COUNT(*) AS n FROM tasks WHERE assignee_user_id=$1 AND request_status='awaiting'`,
      [req.user.id]);
    const row = r.rows[0] || {};
    res.json({
      to_action: Number(row.to_action || 0),
      in_progress: Number(row.in_progress || 0),
      overdue: Number(row.overdue || 0),
      incoming_requests: Number(inc.rows[0].n || 0),
    });
  } catch (e) {
    console.error('[tasks/summary] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/tasks/assignable ----------
// People this user may put a task onto, split into:
//   direct  — assignment/handoff lands immediately (self, own dept, depts I run)
//   request — everyone else (cross-dept) → would become a request
// Owner sees everyone as "direct".
router.get('/assignable', async (req, res) => {
  try {
    const isOwner = req.user.can('*');
    const everyone = await db.query(
      `SELECT u.id, u.display_name, u.full_name,
              (SELECT d.name FROM user_department_memberships m
                 JOIN departments d ON d.id = m.department_id
                WHERE m.user_id = u.id AND m.deleted_at IS NULL
                ORDER BY m.is_primary DESC LIMIT 1) AS dept_name
         FROM users u
        WHERE u.deleted_at IS NULL AND u.employment_status = 'active' AND u.id <> $1
        ORDER BY u.display_name, u.full_name`, [req.user.id]);

    if (isOwner) {
      return res.json({ direct: everyone.rows, request: [], self_only: false });
    }

    const myDepts = await deptIdsFor(req.user.id);
    const managed = await deptsManagedBy(req.user.id);
    const directIds = new Set();
    // people in depts I run = assignment; people in my own dept = handoff target
    const reachable = (myDepts.length || managed.length)
      ? await db.query(
          `SELECT DISTINCT user_id FROM user_department_memberships
            WHERE deleted_at IS NULL AND department_id = ANY($1::int[])`,
          [Array.from(new Set([...myDepts, ...managed]))])
      : { rows: [] };
    for (const x of reachable.rows) directIds.add(x.user_id);

    const direct = [], request = [];
    for (const p of everyone.rows) {
      if (directIds.has(p.id)) direct.push(p); else request.push(p);
    }
    // Regular agents (manage nothing) can't originate onto same-dept peers as a
    // *new* task — but the frontend still needs them for OWN-task handoff, so we
    // return them under "direct" only if the user manages a dept; else self-only.
    const managesSomething = managed.length > 0;
    res.json({
      direct: managesSomething ? direct : [],
      request: managesSomething ? request : everyone.rows,
      self_only: !managesSomething,
    });
  } catch (e) {
    console.error('[tasks/assignable] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks ----------
// Body: { title, body?, category?, assignee_user_id?, due_at?, meta? }
// If assignee omitted or = self → personal task.
// Else: auto-detect assignment (direct) vs request (cross-dept) by relationship.
router.post('/', async (req, res) => {
  const { title, body, category, assignee_user_id, due_at, meta } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title required' });
  const me = req.user.id;
  const target = assignee_user_id ? parseInt(assignee_user_id, 10) : me;

  try {
    // --- self task ---
    if (!target || target === me) {
      const r = await db.query(
        `INSERT INTO tasks (kind, source, title, body, category, assignee_user_id, due_at, meta, status, opens_at)
         VALUES ('ad_hoc','manual',$1,$2,$3,$4,$5,$6,'open',NOW()) RETURNING id`,
        [String(title).trim(), body || null, category || null, me, due_at || null,
         meta ? JSON.stringify(meta) : null]);
      await logAudit({ req, module:'tasks', action:'task.created', target_type:'task',
        target_id:r.rows[0].id, after:{ title, kind:'ad_hoc' } });
      return res.json({ ok:true, id:r.rows[0].id, mode:'self' });
    }

    // --- onto someone else: decide assignment vs request ---
    const isOwner = req.user.can('*');
    const sameDept = await shareDept(me, target);
    const manages = await actorManagesTarget(me, target);

    // Direct assignment allowed if: owner, OR I manage the target, OR same dept
    // AND I manage something (managers-and-up originate; same-dept peers can't
    // originate new tasks onto each other — that path is REQUEST).
    const iManageSomething = (await deptsManagedBy(me)).length > 0;
    const canAssignDirect = isOwner || manages || (sameDept && iManageSomething);

    if (canAssignDirect) {
      const r = await db.query(
        `INSERT INTO tasks (kind, source, title, body, category, assignee_user_id,
                            assigned_by_user_id, due_at, meta, status, opens_at,
                            reassign_history)
         VALUES ('ad_hoc','manual',$1,$2,$3,$4,$5,$6,$7,'open',NOW(),$8) RETURNING id`,
        [String(title).trim(), body || null, category || null, target, me, due_at || null,
         meta ? JSON.stringify(meta) : null,
         JSON.stringify([{ at:new Date().toISOString(), by:me, to:target, act:'assigned' }])]);
      await notifyEvent('task.assigned', {
        targetUserId: target, taskTitle: String(title).trim(),
        byUserId: me, related_id: r.rows[0].id });
      await logAudit({ req, module:'tasks', action:'task.assigned', target_type:'task',
        target_id:r.rows[0].id, after:{ title, to:target } });
      return res.json({ ok:true, id:r.rows[0].id, mode:'assigned' });
    }

    // --- otherwise it's a REQUEST (cross-dept / no authority) ---
    const r = await db.query(
      `INSERT INTO tasks (kind, source, title, body, category, assignee_user_id,
                          assigned_by_user_id, requester_user_id, request_status,
                          due_at, meta, status, opens_at)
       VALUES ('ad_hoc','manual',$1,$2,$3,$4,$5,$5,'awaiting',$6,$7,'open',NOW()) RETURNING id`,
      [String(title).trim(), body || null, category || null, target, me, due_at || null,
       meta ? JSON.stringify(meta) : null]);
    await notifyEvent('request.received', {
      targetUserId: target, taskTitle: String(title).trim(),
      byUserId: me, related_id: r.rows[0].id });
    await logAudit({ req, module:'tasks', action:'request.sent', target_type:'task',
      target_id:r.rows[0].id, after:{ title, to:target } });
    return res.json({ ok:true, id:r.rows[0].id, mode:'request' });
  } catch (e) {
    console.error('[tasks/create] failed:', e.message);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// ---------- POST /api/tasks/:id/accept ----------
router.post('/:id/accept', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const cur = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    if (t.assignee_user_id !== req.user.id || t.request_status !== 'awaiting') {
      return res.status(403).json({ error: 'Not your request to accept' });
    }
    await db.query(
      `UPDATE tasks SET request_status='accepted', status='open', updated_at=NOW() WHERE id=$1`, [id]);
    if (t.requester_user_id) {
      await notifyEvent('request.accepted', {
        targetUserId: t.requester_user_id, taskTitle: t.title,
        byUserId: req.user.id, related_id: id });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/accept] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks/:id/decline ----------
// Body: { reason? }. Bounces back to the requester (they become the doer again).
router.post('/:id/decline', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  const { reason } = req.body || {};
  try {
    const cur = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    if (t.assignee_user_id !== req.user.id || t.request_status !== 'awaiting') {
      return res.status(403).json({ error: 'Not your request to decline' });
    }
    // Bounce back: assignee becomes the requester again so it lands on their plate.
    await db.query(
      `UPDATE tasks SET request_status='declined', decline_reason=$1,
                        assignee_user_id=$2, updated_at=NOW() WHERE id=$3`,
      [reason || null, t.requester_user_id || t.assigned_by_user_id, id]);
    if (t.requester_user_id) {
      await notifyEvent('request.declined', {
        targetUserId: t.requester_user_id, taskTitle: t.title,
        byUserId: req.user.id, related_id: id, reason: reason || null });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/decline] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks/:id/action ----------
router.post('/:id/action', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  const { action, note } = req.body || {};
  if (!['start','complete','move','reopen'].includes(action)) {
    return res.status(400).json({ error: 'bad action' });
  }
  try {
    const cur = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    const isAssignee = t.assignee_user_id === req.user.id;
    const isOwner = req.user.can('*') || req.user.can('admin.audit.view');
    if (!isAssignee && !isOwner) return res.status(403).json({ error: 'Permission denied' });
    // Can't action a request that's still awaiting acceptance.
    if (t.request_status === 'awaiting') return res.status(409).json({ error: 'Request not yet accepted' });

    if (action === 'start') {
      await db.query(`UPDATE tasks SET status='in_progress', updated_at=NOW() WHERE id=$1`, [id]);
    } else if (action === 'complete') {
      await db.query(
        `UPDATE tasks SET status='done', completed_at=NOW(), completed_by_user_id=$1, updated_at=NOW() WHERE id=$2`,
        [req.user.id, id]);
      if (t.kind === 'review' && t.related_profile_note_id) {
        await lifecycle.completeReview(t.related_profile_note_id, req.user.id);
      }
    } else if (action === 'reopen') {
      await db.query(`UPDATE tasks SET status='open', completed_at=NULL, updated_at=NOW() WHERE id=$1`, [id]);
    } else if (action === 'move') {
      await db.query(
        `UPDATE tasks SET status='in_progress', moved_at=NOW(), movement_note=$1, updated_at=NOW() WHERE id=$2`,
        [note || null, id]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/action] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/tasks/:id ----------
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const r = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = r.rows[0];
    const ok = t.assignee_user_id === req.user.id || t.related_user_id === req.user.id
      || t.requester_user_id === req.user.id || req.user.can('*') || req.user.can('admin.audit.view');
    if (!ok) return res.status(403).json({ error: 'Permission denied' });
    res.json({ task: t });
  } catch (e) {
    console.error('[tasks/get] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks/:id/dismiss ----------
router.post('/:id/dismiss', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const r = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = r.rows[0];
    if (t.assignee_user_id !== req.user.id && !req.user.can('*')) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    await db.query(
      `UPDATE tasks SET status='done', completed_at=NOW(), completed_by_user_id=$1, updated_at=NOW() WHERE id=$2`,
      [req.user.id, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/dismiss] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks/admin/tick ----------
router.post('/admin/tick', async (req, res) => {
  if (!(req.user.can('admin.backfill.run') || req.user.can('*'))) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  try {
    const result = await lifecycle.tickTasks();
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[tasks/admin/tick] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/tasks/admin/all ----------
router.get('/admin/all', async (req, res) => {
  if (!(req.user.can('admin.audit.view') || req.user.can('*'))) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  try {
    const r = await db.query(
      `SELECT t.id, t.kind, t.source, t.title, t.status, t.opens_at, t.due_at,
              t.related_user_id, t.assignee_user_id, t.assigned_by_user_id,
              t.request_status, t.reason, t.category,
              ru.full_name AS related_full_name, au.full_name AS assignee_full_name
         FROM tasks t
    LEFT JOIN users ru ON ru.id = t.related_user_id
    LEFT JOIN users au ON au.id = t.assignee_user_id
        WHERE t.status NOT IN ('done','cancelled')
        ORDER BY t.due_at ASC NULLS LAST LIMIT 200`);
    res.json({ tasks: r.rows });
  } catch (e) {
    console.error('[tasks/admin/all] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
