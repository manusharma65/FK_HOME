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
// Departments a user RUNS (manager/lead) — used by the Team Work view.
async function deptsManagedBy(userId) {
  const r = await db.query(
    `SELECT department_id FROM user_department_memberships
      WHERE user_id = $1 AND role IN ('manager','lead') AND deleted_at IS NULL`, [userId]);
  return r.rows.map(x => x.department_id);
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
          AND t.kind <> 'recruitment'
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
                          AND kind <> 'recruitment') AS to_action,
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
// Just the list of active people you can pick (everyone). No permission split —
// the category dropdown decides assign-vs-request, not who you are.
router.get('/assignable', async (req, res) => {
  try {
    const everyone = await db.query(
      `SELECT u.id, u.display_name, u.full_name,
              (SELECT d.name FROM user_department_memberships m
                 JOIN departments d ON d.id = m.department_id
                WHERE m.user_id = u.id AND m.deleted_at IS NULL
                ORDER BY m.is_primary DESC LIMIT 1) AS dept_name
         FROM users u
        WHERE u.deleted_at IS NULL AND u.employment_status = 'active' AND u.id <> $1
        ORDER BY u.display_name, u.full_name`, [req.user.id]);
    res.json({ people: everyone.rows });
  } catch (e) {
    console.error('[tasks/assignable] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks ----------
// Explicit mode (the user chooses), server validates the permission:
//   Body: { title, body?, category?, assignee_user_id?, mode?, due_at?, meta? }
//   mode = 'self'    → my own task (assignee ignored)
//   mode = 'assign'  → direct to assignee_user_id (must be allowed: owner, or I
//                      manage them, or same dept + I manage something)
//   mode = 'request' → request to assignee_user_id (anyone may request anyone)
// If mode omitted: 'self' when no assignee, else defaults to 'request' (safe).
router.post('/', async (req, res) => {
  const { title, body, category, assignee_user_id, due_at, meta } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title required' });
  const me = req.user.id;
  const target = assignee_user_id ? parseInt(assignee_user_id, 10) : null;
  const isRequest = (category === 'request');   // "Request" is just an option in the category dropdown

  try {
    // --- my own task (no person picked, or I picked myself) ---
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

    // --- a person is picked + category is "Request" → goes as a request (accept/reject) ---
    if (isRequest) {
      const r = await db.query(
        `INSERT INTO tasks (kind, source, title, body, category, assignee_user_id,
                            assigned_by_user_id, requester_user_id, request_status,
                            due_at, meta, status, opens_at)
         VALUES ('ad_hoc','manual',$1,$2,$3,$4,$5,$5,'awaiting',$6,$7,'open',NOW()) RETURNING id`,
        [String(title).trim(), body || null, 'request', target, me, due_at || null,
         meta ? JSON.stringify(meta) : null]);
      await notifyEvent('request.received', { targetUserId: target, taskTitle: String(title).trim(),
        byUserId: me, related_id: r.rows[0].id });
      await logAudit({ req, module:'tasks', action:'request.sent', target_type:'task',
        target_id:r.rows[0].id, after:{ title, to:target } });
      return res.json({ ok:true, id:r.rows[0].id, mode:'request' });
    }

    // --- a person is picked + a normal category → assign straight to them ---
    const r = await db.query(
      `INSERT INTO tasks (kind, source, title, body, category, assignee_user_id,
                          assigned_by_user_id, due_at, meta, status, opens_at, reassign_history)
       VALUES ('ad_hoc','manual',$1,$2,$3,$4,$5,$6,$7,'open',NOW(),$8) RETURNING id`,
      [String(title).trim(), body || null, category || null, target, me, due_at || null,
       meta ? JSON.stringify(meta) : null,
       JSON.stringify([{ at:new Date().toISOString(), by:me, to:target, act:'assigned' }])]);
    await notifyEvent('task.assigned', { targetUserId: target, taskTitle: String(title).trim(),
      byUserId: me, related_id: r.rows[0].id });
    await logAudit({ req, module:'tasks', action:'task.assigned', target_type:'task',
      target_id:r.rows[0].id, after:{ title, to:target } });
    return res.json({ ok:true, id:r.rows[0].id, mode:'assigned' });
  } catch (e) {
    console.error('[tasks/create] failed:', e.message);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// ---------- PATCH /api/tasks/:id ----------
// Edit a task's free-text / category / due. Assignee, assigner, or owner.
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  const { title, body, category, due_at } = req.body || {};
  try {
    const cur = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    const canEdit = t.assignee_user_id === req.user.id || t.assigned_by_user_id === req.user.id
      || t.requester_user_id === req.user.id || req.user.can('profile.view.any');
    if (!canEdit) return res.status(403).json({ error: 'Permission denied' });
    if (title !== undefined && !String(title).trim()) return res.status(400).json({ error: 'title cannot be empty' });
    await db.query(
      `UPDATE tasks SET
         title    = COALESCE($1, title),
         body     = COALESCE($2, body),
         category = COALESCE($3, category),
         due_at   = COALESCE($4, due_at),
         updated_at = NOW()
       WHERE id=$5`,
      [title !== undefined ? String(title).trim() : null, body ?? null, category ?? null, due_at ?? null, id]);
    await logAudit({ req, module:'tasks', action:'task.edited', target_type:'task', target_id:id });
    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/edit] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks/:id/cancel ----------
// Cancel (not hard-delete): status='cancelled', kept for history.
router.post('/:id/cancel', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  const { reason } = req.body || {};
  try {
    const cur = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    const canCancel = t.assignee_user_id === req.user.id || t.assigned_by_user_id === req.user.id
      || t.requester_user_id === req.user.id || req.user.can('profile.view.any');
    if (!canCancel) return res.status(403).json({ error: 'Permission denied' });
    await db.query(
      `UPDATE tasks SET status='cancelled', cancelled_at=NOW(), cancel_reason=$1, updated_at=NOW() WHERE id=$2`,
      [reason || null, id]);
    await logAudit({ req, module:'tasks', action:'task.cancelled', target_type:'task', target_id:id });
    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/cancel] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks/:id/decline-assignment ----------
// Assignee pushes back a DIRECT assignment (not a request) → bounces to assigner.
router.post('/:id/decline-assignment', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  const { reason } = req.body || {};
  try {
    const cur = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    if (t.assignee_user_id !== req.user.id) return res.status(403).json({ error: 'Not yours to decline' });
    if (!t.assigned_by_user_id || t.assigned_by_user_id === req.user.id) {
      return res.status(400).json({ error: 'This is not an assigned task' });
    }
    if (t.request_status === 'awaiting') return res.status(400).json({ error: 'Use the request decline for requests' });
    const hist = Array.isArray(t.reassign_history) ? t.reassign_history : [];
    hist.push({ at:new Date().toISOString(), by:req.user.id, to:t.assigned_by_user_id, act:'declined_assignment', reason:reason||null });
    await db.query(
      `UPDATE tasks SET assignee_user_id=$1, updated_at=NOW(), reassign_history=$2 WHERE id=$3`,
      [t.assigned_by_user_id, JSON.stringify(hist), id]);
    await notifyEvent('task.assignment_declined', {
      targetUserId: t.assigned_by_user_id, taskTitle: t.title, byUserId: req.user.id, related_id: id, reason: reason||null });
    await logAudit({ req, module:'tasks', action:'task.assignment_declined', target_type:'task', target_id:id });
    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/decline-assignment] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/tasks/done ----------
// Recently completed tasks I did (for the Done section / history).
router.get('/done', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT ${TASK_SELECT}
         FROM tasks t ${TASK_JOINS}
        WHERE t.assignee_user_id = $1 AND t.status = 'done'
          AND t.completed_at > NOW() - INTERVAL '14 days'
        ORDER BY t.completed_at DESC LIMIT 50`, [req.user.id]);
    res.json({ tasks: r.rows });
  } catch (e) {
    console.error('[tasks/done] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/tasks/team ----------
// Manager/lead view: tasks of people in the departments I run, + their status.
// Owner sees everyone's active tasks.
router.get('/team', async (req, res) => {
  try {
    const isOwner = req.user.can('profile.view.any');
    let memberIds = [];
    if (isOwner) {
      const all = await db.query(
        `SELECT id FROM users WHERE deleted_at IS NULL AND employment_status='active' AND id <> $1`, [req.user.id]);
      memberIds = all.rows.map(x => x.id);
    } else {
      const managed = await deptsManagedBy(req.user.id);
      if (managed.length === 0) return res.json({ tasks: [], can_view: false });
      const mem = await db.query(
        `SELECT DISTINCT user_id FROM user_department_memberships
          WHERE deleted_at IS NULL AND department_id = ANY($1::int[]) AND user_id <> $2`,
        [managed, req.user.id]);
      memberIds = mem.rows.map(x => x.user_id);
    }
    if (memberIds.length === 0) return res.json({ tasks: [], can_view: true });
    const r = await db.query(
      `SELECT t.id, t.kind, t.source, t.title, t.status, t.due_at, t.category,
              t.request_status, t.assignee_user_id, t.assigned_by_user_id,
              au.display_name AS assignee_name, au.full_name AS assignee_full_name,
              au.initials AS assignee_initials, au.avatar_colour AS assignee_colour
         FROM tasks t
         JOIN users au ON au.id = t.assignee_user_id
        WHERE t.assignee_user_id = ANY($1::int[])
          AND t.status IN ('open','due','overdue','in_progress')
          AND (t.request_status IS NULL OR t.request_status='accepted')
          AND t.kind <> 'recruitment'
        ORDER BY au.display_name,
                 CASE t.status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
                 t.due_at ASC NULLS LAST`, [memberIds]);
    res.json({ tasks: r.rows, can_view: true });
  } catch (e) {
    console.error('[tasks/team] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/tasks/hr-queue ----------
// The shared HR queue: all active HR tasks (routed by area), tagged with whose
// they are, so Tanu & Deepanshi both see everything and can cover for each other.
// Visible to hr-team members + owner.
router.get('/hr-queue', async (req, res) => {
  try {
    // Is the caller HR (or owner)?
    const isOwner = req.user.can('profile.view.any');
    let isHr = isOwner;
    if (!isHr) {
      const m = await db.query(
        `SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug.group_id
          WHERE ug.user_id = $1 AND g.slug = 'hr-team' AND g.deleted_at IS NULL LIMIT 1`,
        [req.user.id]);
      isHr = m.rows.length > 0;
    }
    if (!isHr) return res.status(403).json({ error: 'HR only' });

    const r = await db.query(
      `SELECT t.id, t.kind, t.source, t.category, t.title, t.body, t.status,
              t.due_at, t.opens_at, t.meta, t.assignee_user_id, t.related_user_id,
              au.display_name AS assignee_name, au.full_name AS assignee_full_name,
              au.initials AS assignee_initials, au.avatar_colour AS assignee_colour,
              ru.display_name AS related_name, ru.full_name AS related_full_name
         FROM tasks t
         JOIN users au ON au.id = t.assignee_user_id
    LEFT JOIN users ru ON ru.id = t.related_user_id
        WHERE t.source = 'auto_event'
          AND t.status IN ('open','due','overdue','in_progress')
          AND (t.meta->>'hr_area') IS NOT NULL
        ORDER BY
          CASE t.status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1
                        WHEN 'in_progress' THEN 2 ELSE 3 END,
          t.due_at ASC NULLS LAST, t.created_at ASC`);
    res.json({ tasks: r.rows, me: req.user.id });
  } catch (e) {
    console.error('[tasks/hr-queue] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks/:id/cover ----------
// Take over a colleague's HR task (cover when they're off). Reassigns it to me,
// records the cover in reassign_history. HR-team / owner only.
router.post('/:id/cover', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const isOwner = req.user.can('profile.view.any');
    let isHr = isOwner;
    if (!isHr) {
      const m = await db.query(
        `SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug.group_id
          WHERE ug.user_id = $1 AND g.slug = 'hr-team' AND g.deleted_at IS NULL LIMIT 1`,
        [req.user.id]);
      isHr = m.rows.length > 0;
    }
    if (!isHr) return res.status(403).json({ error: 'HR only' });

    const cur = await db.query(`SELECT * FROM tasks WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    if (t.assignee_user_id === req.user.id) return res.json({ ok: true }); // already mine
    const hist = Array.isArray(t.reassign_history) ? t.reassign_history : [];
    hist.push({ at: new Date().toISOString(), by: req.user.id, from: t.assignee_user_id, act: 'covered' });
    await db.query(
      `UPDATE tasks SET assignee_user_id=$1, reassign_history=$2, updated_at=NOW() WHERE id=$3`,
      [req.user.id, JSON.stringify(hist), id]);
    await logAudit({ req, module:'tasks', action:'task.covered', target_type:'task', target_id:id,
      after:{ from: t.assignee_user_id, to: req.user.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/cover] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
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
    const isOwner = req.user.can('profile.view.any') || req.user.can('admin.audit.view');
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
      || t.requester_user_id === req.user.id || req.user.can('profile.view.any') || req.user.can('admin.audit.view');
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
    if (t.assignee_user_id !== req.user.id && !req.user.can('profile.view.any')) {
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
  if (!(req.user.can('admin.backfill.run') || req.user.can('profile.view.any'))) {
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
  if (!(req.user.can('admin.audit.view') || req.user.can('profile.view.any'))) {
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
