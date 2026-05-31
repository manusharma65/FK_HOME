// FK Home — /api/tasks/*
// ----------------------------------------------------------------------------
// The universal task queue. Holds all work-shapes (review/onboarding/probation
// + event/recurring/ad_hoc/recruitment) in one table. This module powers the
// My Work view + ad-hoc task creation. Auto-event generation (Ship 2b) and
// recruitment (Ship 2c) write rows here via their own engines.
//
// Routes:
//   GET    /api/tasks/mine               — my open tasks, grouped for My Work
//   GET    /api/tasks/summary            — counts for the home "My work" card
//   POST   /api/tasks                    — create an ad-hoc task (manual)
//   POST   /api/tasks/:id/action         — progress / complete / add movement
//   GET    /api/tasks/:id                — single task (assignee/related/owner)
//   POST   /api/tasks/:id/dismiss        — voluntarily mark done
//   GET    /api/tasks/admin/all          — admin view of all tasks
//   POST   /api/tasks/admin/tick         — admin trigger of tick cron (owner/HR)

const express = require('express');
const { db } = require('../db');
const { requireAuth, logAudit } = require('../auth');
const lifecycle = require('./lifecycle');

const router = express.Router();
router.use(requireAuth);

// Columns returned for a task row (kept consistent across endpoints).
const TASK_SELECT = `
  t.id, t.kind, t.source, t.category, t.title, t.body,
  t.opens_at, t.due_at, t.status, t.reason,
  t.related_user_id, t.related_profile_note_id, t.parent_task_id,
  t.department_id, t.moved_at, t.movement_note, t.meta,
  t.created_at, t.updated_at,
  u.full_name AS related_full_name,
  u.display_name AS related_display_name,
  u.avatar_colour AS related_avatar_colour,
  u.initials AS related_initials`;

// Which "group" a task falls into for the My Work view.
//   needs_action : open/due/overdue, not multi-day-in-progress
//   recurring    : recurring kind, active today
//   in_progress  : status in_progress (multi-day work being worked)
// Recruitment OPENINGS (parent_task_id IS NULL, kind recruitment) are excluded
// from My Work — they live in the Recruitment view; only their movement (child
// tasks / in-progress) surfaces here.
function groupFor(t) {
  if (t.status === 'in_progress') return 'in_progress';
  if (t.kind === 'recurring') return 'recurring';
  return 'needs_action';
}

// ---------- GET /api/tasks/mine ----------
// Active tasks for the current user, grouped for the My Work view.
router.get('/mine', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT ${TASK_SELECT}
         FROM tasks t
    LEFT JOIN users u ON u.id = t.related_user_id
        WHERE t.assignee_user_id = $1
          AND t.status IN ('open','due','overdue','in_progress')
          AND NOT (t.kind = 'recruitment' AND t.parent_task_id IS NULL)
        ORDER BY
          CASE t.status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1
                        WHEN 'in_progress' THEN 2 ELSE 3 END,
          t.due_at ASC NULLS LAST,
          t.created_at DESC`,
      [req.user.id]
    );
    const groups = { needs_action: [], recurring: [], in_progress: [] };
    for (const t of r.rows) groups[groupFor(t)].push(t);
    res.json({ groups, total: r.rows.length });
  } catch (e) {
    console.error('[tasks/mine] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/tasks/summary ----------
// Lightweight counts for the home "My work" card.
router.get('/summary', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('open','due','overdue')
                          AND NOT (kind='recruitment' AND parent_task_id IS NULL)) AS to_action,
         COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
         COUNT(*) FILTER (WHERE status = 'overdue') AS overdue
       FROM tasks
      WHERE assignee_user_id = $1
        AND status IN ('open','due','overdue','in_progress')`,
      [req.user.id]
    );
    const row = r.rows[0] || {};
    res.json({
      to_action: Number(row.to_action || 0),
      in_progress: Number(row.in_progress || 0),
      overdue: Number(row.overdue || 0),
    });
  } catch (e) {
    console.error('[tasks/summary] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/tasks ----------
// Create an ad-hoc task (the "+ Add" button). Manual source.
// Body: { title, body?, category?, related_user_id?, due_at?, department_id?, meta? }
router.post('/', async (req, res) => {
  const { title, body, category, related_user_id, due_at, department_id, meta } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title required' });
  }
  try {
    const r = await db.query(
      `INSERT INTO tasks
         (kind, source, title, body, category, assignee_user_id,
          related_user_id, due_at, department_id, meta, status, opens_at)
       VALUES ('ad_hoc', 'manual', $1, $2, $3, $4, $5, $6, $7, $8, 'open', NOW())
       RETURNING id`,
      [
        String(title).trim(),
        body || null,
        category || null,
        req.user.id,
        related_user_id || null,
        due_at || null,
        department_id || null,
        meta ? JSON.stringify(meta) : null,
      ]
    );
    await logAudit({ req, module: 'tasks', action: 'task.created',
      target_type: 'task', target_id: r.rows[0].id, after: { title, kind: 'ad_hoc' } });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error('[tasks/create] failed:', e.message);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// ---------- POST /api/tasks/:id/action ----------
// Progress a task. action: 'start' | 'complete' | 'move' | 'reopen'
//   start    → in_progress
//   complete → done
//   reopen   → open
//   move     → record a movement note (multi-day work), stays in_progress
// Body: { action, note? }
router.post('/:id/action', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  const { action, note } = req.body || {};
  if (!['start', 'complete', 'move', 'reopen'].includes(action)) {
    return res.status(400).json({ error: 'bad action' });
  }
  try {
    const cur = await db.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = cur.rows[0];
    const isAssignee = t.assignee_user_id === req.user.id;
    const isOwner = req.user.can('*') || req.user.can('admin.audit.view');
    if (!isAssignee && !isOwner) return res.status(403).json({ error: 'Permission denied' });

    if (action === 'start') {
      await db.query(`UPDATE tasks SET status='in_progress', updated_at=NOW() WHERE id=$1`, [id]);
    } else if (action === 'complete') {
      await db.query(
        `UPDATE tasks SET status='done', completed_at=NOW(), completed_by_user_id=$1, updated_at=NOW() WHERE id=$2`,
        [req.user.id, id]
      );
      // If this review task points at a profile_note, close it via lifecycle.
      if (t.kind === 'review' && t.related_profile_note_id) {
        await lifecycle.completeReview(t.related_profile_note_id, req.user.id);
      }
    } else if (action === 'reopen') {
      await db.query(`UPDATE tasks SET status='open', completed_at=NULL, updated_at=NOW() WHERE id=$1`, [id]);
    } else if (action === 'move') {
      await db.query(
        `UPDATE tasks SET status='in_progress', moved_at=NOW(), movement_note=$1, updated_at=NOW() WHERE id=$2`,
        [note || null, id]
      );
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
    const r = await db.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = r.rows[0];
    const isAssignee = t.assignee_user_id === req.user.id;
    const isRelated  = t.related_user_id === req.user.id;
    const isOwner    = req.user.can('*') || req.user.can('admin.audit.view');
    if (!isAssignee && !isRelated && !isOwner) {
      return res.status(403).json({ error: 'Permission denied' });
    }
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
    const r = await db.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const t = r.rows[0];
    if (t.assignee_user_id !== req.user.id && !req.user.can('*')) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    await db.query(
      `UPDATE tasks SET status='done', completed_at=NOW(), completed_by_user_id=$1, updated_at=NOW() WHERE id=$2`,
      [req.user.id, id]
    );
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
              t.related_user_id, t.assignee_user_id, t.reason, t.category,
              ru.full_name AS related_full_name,
              au.full_name AS assignee_full_name
         FROM tasks t
    LEFT JOIN users ru ON ru.id = t.related_user_id
    LEFT JOIN users au ON au.id = t.assignee_user_id
        WHERE t.status NOT IN ('done','cancelled')
        ORDER BY t.due_at ASC NULLS LAST
        LIMIT 200`
    );
    res.json({ tasks: r.rows });
  } catch (e) {
    console.error('[tasks/admin/all] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
