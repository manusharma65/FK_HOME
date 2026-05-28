// FK Home — /api/notifications/*
//   GET  /api/notifications              — your notifications (paginated, newest first)
//   GET  /api/notifications/unread-count — quick count
//   POST /api/notifications/:id/read     — mark one as read
//   POST /api/notifications/read-all     — mark all yours as read

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// LIST
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  try {
    const r = await db.query(
      `SELECT n.id, n.type, n.title, n.body, n.action_url, n.is_read, n.read_at, n.created_at,
              n.related_user_id, n.related_type, n.related_id,
              u.display_name AS related_user_name, u.initials AS related_user_initials,
              u.avatar_colour AS related_user_avatar_colour
       FROM notifications n
       LEFT JOIN users u ON u.id = n.related_user_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    const unreadRes = await db.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ notifications: r.rows, unread_count: unreadRes.rows[0].n });
  } catch (err) {
    console.error('[notifications] list error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// UNREAD COUNT
router.get('/unread-count', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ count: r.rows[0].n });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// MARK ONE READ
router.post('/:id/read', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    await db.query(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// MARK ALL READ
router.post('/read-all', async (req, res) => {
  try {
    await db.query(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
