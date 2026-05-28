// FK Home — /api/tasks/*
// ----------------------------------------------------------------------------
// Routes:
//   GET    /api/tasks/mine               — open tasks assigned to me
//   GET    /api/tasks/:id                — get a single task (assignee/owner only)
//   POST   /api/tasks/:id/dismiss        — voluntarily mark done (rare)
//   GET    /api/tasks/admin/all          — admin view of all tasks
//   POST   /api/tasks/admin/tick         — admin trigger of tick cron (owner/HR)

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const lifecycle = require('./lifecycle');

const router = express.Router();
router.use(requireAuth);

// ---------- GET /api/tasks/mine ----------
// Active tasks for the current user. Sorted by status priority (overdue > due > open > pending).
router.get('/mine', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT t.id, t.kind, t.title, t.body, t.opens_at, t.due_at, t.status, t.reason,
              t.related_user_id, t.related_profile_note_id,
              u.full_name AS related_full_name,
              u.display_name AS related_display_name,
              u.avatar_colour AS related_avatar_colour,
              u.initials AS related_initials
         FROM tasks t
    LEFT JOIN users u ON u.id = t.related_user_id
        WHERE t.assignee_user_id = $1
          AND t.status IN ('open','due','overdue')
        ORDER BY
          CASE t.status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1 ELSE 2 END,
          t.due_at ASC`,
      [req.user.id]
    );
    res.json({ tasks: r.rows });
  } catch (e) {
    console.error('[tasks/mine] failed:', e.message);
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
    // Only the assignee, the related user, or owner can read
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

// ---------- POST /api/tasks/admin/tick ----------
// Manually trigger the cron tick. Owner/HR only.
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
      `SELECT t.id, t.kind, t.title, t.status, t.opens_at, t.due_at,
              t.related_user_id, t.assignee_user_id, t.reason,
              ru.full_name AS related_full_name,
              au.full_name AS assignee_full_name
         FROM tasks t
    LEFT JOIN users ru ON ru.id = t.related_user_id
    LEFT JOIN users au ON au.id = t.assignee_user_id
        WHERE t.status NOT IN ('done','cancelled')
        ORDER BY t.due_at ASC
        LIMIT 200`
    );
    res.json({ tasks: r.rows });
  } catch (e) {
    console.error('[tasks/admin/all] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
