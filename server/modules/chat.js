// FK Home — /api/chat/*
//   GET  /api/chat/channels                       — your channels with unread counts
//   GET  /api/chat/channels/:id/messages          — messages (paginated, newest first)
//   POST /api/chat/channels/:id/messages          — send a message
//   POST /api/chat/channels/:id/read              — mark channel read up to latest message
//   POST /api/chat/dm/:userId/open                — open or create a DM channel with another user

const express = require('express');
const { db } = require('../db');
const { requireAuth, logAudit } = require('../auth');
const { notify, notifyEvent } = require('../notify');

const router = express.Router();
router.use(requireAuth);

// ---- helpers ----
function dmPairKey(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return `${lo}-${hi}`;
}

async function userIsInChannel(userId, channelId) {
  const r = await db.query(
    `SELECT 1 FROM chat_channel_members WHERE user_id = $1 AND channel_id = $2`,
    [userId, channelId]
  );
  return r.rows.length > 0;
}

// ---- LIST CHANNELS ----
router.get('/channels', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.id, c.slug, c.name, c.type, c.department_id, c.dm_pair_key,
              c.description, c.created_at,
              d.name AS department_name, d.icon AS department_icon, d.colour AS department_colour,
              (SELECT COUNT(*)::int FROM chat_messages m
                 WHERE m.channel_id = c.id AND m.deleted_at IS NULL
                   AND (
                     SELECT last_read_message_id FROM chat_reads
                     WHERE user_id = $1 AND channel_id = c.id
                   ) IS DISTINCT FROM NULL
                   AND m.id > (
                     SELECT last_read_message_id FROM chat_reads
                     WHERE user_id = $1 AND channel_id = c.id
                   )) AS unread_count,
              (SELECT COUNT(*)::int FROM chat_messages m
                 WHERE m.channel_id = c.id AND m.deleted_at IS NULL
                   AND (SELECT last_read_message_id FROM chat_reads
                          WHERE user_id = $1 AND channel_id = c.id) IS NULL) AS unread_when_no_read_row,
              (SELECT json_build_object(
                  'id', lm.id, 'body', lm.body, 'created_at', lm.created_at,
                  'sender_name', lu.display_name, 'sender_id', lu.id
               )
               FROM chat_messages lm
               LEFT JOIN users lu ON lu.id = lm.sender_user_id
               WHERE lm.channel_id = c.id AND lm.deleted_at IS NULL
               ORDER BY lm.id DESC LIMIT 1) AS last_message
       FROM chat_channels c
       JOIN chat_channel_members ccm ON ccm.channel_id = c.id AND ccm.user_id = $1
       LEFT JOIN departments d ON d.id = c.department_id
       WHERE c.is_archived = FALSE
       ORDER BY (CASE WHEN c.type = 'all_hands' THEN 0
                      WHEN c.type = 'department' THEN 1
                      WHEN c.type = 'group' THEN 2
                      WHEN c.type = 'dm' THEN 3
                      ELSE 4 END), c.name`,
      [req.user.id]
    );

    // For DMs, resolve the OTHER user's display name as channel name
    const channels = [];
    for (const c of r.rows) {
      let displayName = c.name;
      let other = null;
      if (c.type === 'dm') {
        const others = await db.query(
          `SELECT u.id, u.display_name, u.full_name, u.initials, u.avatar_colour
           FROM chat_channel_members ccm
           JOIN users u ON u.id = ccm.user_id
           WHERE ccm.channel_id = $1 AND ccm.user_id <> $2 LIMIT 1`,
          [c.id, req.user.id]
        );
        if (others.rows.length > 0) {
          other = others.rows[0];
          displayName = other.display_name || other.full_name;
        }
      }
      const unread = c.unread_count != null ? c.unread_count : (c.unread_when_no_read_row || 0);
      channels.push({
        id: c.id, slug: c.slug, type: c.type,
        name: displayName,
        department_id: c.department_id,
        department_name: c.department_name,
        department_icon: c.department_icon,
        department_colour: c.department_colour,
        last_message: c.last_message,
        unread_count: unread,
        other_user: other,
      });
    }
    res.json({ channels });
  } catch (err) {
    console.error('[chat/channels] error:', err);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

// ---- MESSAGES ----
router.get('/channels/:id/messages', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  if (!(await userIsInChannel(req.user.id, id))) return res.status(403).json({ error: 'Not a member of this channel' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  try {
    let sql, params;
    if (before) {
      sql = `SELECT m.id, m.body, m.created_at, m.edited_at, m.reply_to_id,
                    u.id AS sender_id, u.display_name AS sender_name, u.full_name AS sender_full_name,
                    u.initials AS sender_initials, u.avatar_colour AS sender_avatar_colour
             FROM chat_messages m JOIN users u ON u.id = m.sender_user_id
             WHERE m.channel_id = $1 AND m.deleted_at IS NULL AND m.id < $2
             ORDER BY m.id DESC LIMIT $3`;
      params = [id, before, limit];
    } else {
      sql = `SELECT m.id, m.body, m.created_at, m.edited_at, m.reply_to_id,
                    u.id AS sender_id, u.display_name AS sender_name, u.full_name AS sender_full_name,
                    u.initials AS sender_initials, u.avatar_colour AS sender_avatar_colour
             FROM chat_messages m JOIN users u ON u.id = m.sender_user_id
             WHERE m.channel_id = $1 AND m.deleted_at IS NULL
             ORDER BY m.id DESC LIMIT $2`;
      params = [id, limit];
    }
    const r = await db.query(sql, params);
    // Return in chronological order (oldest first)
    res.json({ messages: r.rows.reverse() });
  } catch (err) {
    console.error('[chat/messages] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---- SEND MESSAGE ----
router.post('/channels/:id/messages', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { body, reply_to_id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Bad id' });
  if (!body || typeof body !== 'string' || body.trim().length === 0) return res.status(400).json({ error: 'Body required' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message too long (5000 char max)' });
  if (!(await userIsInChannel(req.user.id, id))) return res.status(403).json({ error: 'Not a member of this channel' });

  try {
    const r = await db.query(
      `INSERT INTO chat_messages (channel_id, sender_user_id, body, reply_to_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, req.user.id, body.trim(), reply_to_id || null]
    );
    const msg = r.rows[0];

    // Notify other channel members (cap to non-DM channels to avoid spam? actually DMs especially need a ping)
    const others = await db.query(
      `SELECT user_id FROM chat_channel_members
       WHERE channel_id = $1 AND user_id <> $2 AND is_muted = FALSE`,
      [id, req.user.id]
    );
    if (others.rows.length > 0) {
      const channel = await db.query(`SELECT name, type FROM chat_channels WHERE id = $1`, [id]);
      const chName = channel.rows[0] ? channel.rows[0].name : 'chat';
      const chType = channel.rows[0] ? channel.rows[0].type : null;
      const senderName = req.user.display_name || req.user.full_name;
      const bodyPreview = body.length > 120 ? body.slice(0, 120) + '\u2026' : body;
      await notifyEvent('chat.message', {
        userIds: others.rows.map(x => x.user_id),
        isDm: chType === 'dm',
        senderName,
        channelName: chName,
        channelId: id,
        bodyPreview,
        actorUserId: req.user.id,
        related_id: msg.id,
      });
    }

    // Mark channel as read for sender (so their own message doesn't count as unread)
    await db.query(
      `INSERT INTO chat_reads (user_id, channel_id, last_read_message_id, last_read_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (user_id, channel_id) DO UPDATE SET
         last_read_message_id = EXCLUDED.last_read_message_id,
         last_read_at = NOW()`,
      [req.user.id, id, msg.id]
    );

    res.json({ ok: true, message: msg });
  } catch (err) {
    console.error('[chat/send] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---- MARK READ ----
router.post('/channels/:id/read', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  if (!(await userIsInChannel(req.user.id, id))) return res.status(403).json({ error: 'Not a member of this channel' });
  try {
    const latest = await db.query(
      `SELECT MAX(id) AS max_id FROM chat_messages WHERE channel_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    const maxId = latest.rows[0].max_id;
    await db.query(
      `INSERT INTO chat_reads (user_id, channel_id, last_read_message_id, last_read_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (user_id, channel_id) DO UPDATE SET
         last_read_message_id = EXCLUDED.last_read_message_id,
         last_read_at = NOW()`,
      [req.user.id, id, maxId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat/read] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---- OPEN / CREATE DM ----
router.post('/dm/:userId/open', async (req, res) => {
  const otherId = parseInt(req.params.userId, 10);
  if (!otherId) return res.status(400).json({ error: 'Bad userId' });
  if (otherId === req.user.id) return res.status(400).json({ error: 'Cannot DM yourself' });

  try {
    const userCheck = await db.query(
      `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND employment_status = 'active'`,
      [otherId]
    );
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const pairKey = dmPairKey(req.user.id, otherId);

    // Existing?
    const existing = await db.query(
      `SELECT id FROM chat_channels WHERE dm_pair_key = $1`,
      [pairKey]
    );
    if (existing.rows.length > 0) {
      return res.json({ ok: true, channel_id: existing.rows[0].id, created: false });
    }

    // Create
    const ch = await db.query(
      `INSERT INTO chat_channels (slug, name, type, dm_pair_key, created_by_user_id)
       VALUES ($1, $2, 'dm', $3, $4) RETURNING id`,
      [`dm-${pairKey}`, '', pairKey, req.user.id]
    );
    const channelId = ch.rows[0].id;
    await db.query(
      `INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1,$2),($1,$3)`,
      [channelId, req.user.id, otherId]
    );
    res.json({ ok: true, channel_id: channelId, created: true });
  } catch (err) {
    console.error('[chat/dm/open] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================================================
// CUSTOM GROUPS (r0.20, Ship D)
// A custom group is a chat_channels row with type='group' (no schema change —
// type is free text; name, created_by_user_id, is_archived, members all exist).
// Anyone can create a group. Membership is managed by anyone already in the
// group (Google-Chat style). Archive hides the group for everyone.
// ============================================================================

// Helper: is this channel a custom group, and is the caller a member?
async function getGroupForMember(userId, channelId) {
  const r = await db.query(
    `SELECT c.id, c.name, c.type, c.is_archived,
            EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id = c.id AND m.user_id = $2) AS is_member
       FROM chat_channels c WHERE c.id = $1`,
    [channelId, userId]
  );
  return r.rows[0] || null;
}

// ---- CREATE GROUP ----
//   body: { name, member_ids: [int] }   (creator auto-added)
router.post('/groups', async (req, res) => {
  const { name, member_ids } = req.body || {};
  const groupName = (name || '').trim();
  if (!groupName) return res.status(400).json({ error: 'Group name required' });
  if (groupName.length > 80) return res.status(400).json({ error: 'Name too long (80 char max)' });

  // De-dupe + validate member ids; always include the creator.
  const ids = Array.isArray(member_ids) ? member_ids.map(x => parseInt(x, 10)).filter(Number.isFinite) : [];
  const memberSet = new Set(ids);
  memberSet.add(req.user.id);
  const members = Array.from(memberSet);

  try {
    // Only allow adding active, non-deleted users.
    const valid = await db.query(
      `SELECT id FROM users WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND employment_status = 'active'`,
      [members]
    );
    const validIds = valid.rows.map(r => r.id);
    if (!validIds.includes(req.user.id)) validIds.push(req.user.id); // safety

    // Unique-ish slug from name + timestamp suffix.
    const baseSlug = 'grp-' + groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const slug = baseSlug + '-' + Date.now().toString(36);

    const ch = await db.query(
      `INSERT INTO chat_channels (slug, name, type, created_by_user_id, is_archived)
       VALUES ($1, $2, 'group', $3, FALSE) RETURNING id`,
      [slug, groupName, req.user.id]
    );
    const channelId = ch.rows[0].id;

    // Insert members.
    const values = validIds.map((_, i) => `($1, $${i + 2})`).join(',');
    await db.query(
      `INSERT INTO chat_channel_members (channel_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      [channelId, ...validIds]
    );

    await logAudit({ req, module: 'chat', action: 'group.created', target_type: 'chat_channel', target_id: channelId, after: { name: groupName, members: validIds } });

    // Notify the people added (not the creator).
    const notifyIds = validIds.filter(id => id !== req.user.id);
    if (notifyIds.length > 0) {
      await notifyEvent('chat.message', {
        userIds: notifyIds,
        isDm: false,
        senderName: req.user.display_name || req.user.full_name,
        channelName: groupName,
        channelId,
        bodyPreview: 'added you to the group',
        actorUserId: req.user.id,
        related_id: channelId,
      }).catch(() => {});
    }

    res.json({ ok: true, channel_id: channelId, created: true });
  } catch (err) {
    console.error('[chat/groups/create] error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// ---- ADD MEMBERS ----   body: { member_ids: [int] }
router.post('/channels/:id/members', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const g = await getGroupForMember(req.user.id, id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (g.type !== 'group') return res.status(400).json({ error: 'Can only manage members of custom groups' });
  if (!g.is_member) return res.status(403).json({ error: 'Join the group to manage members' });

  const ids = Array.isArray(req.body && req.body.member_ids) ? req.body.member_ids.map(x => parseInt(x, 10)).filter(Number.isFinite) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No members given' });

  try {
    const valid = await db.query(
      `SELECT id FROM users WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND employment_status = 'active'`,
      [ids]
    );
    const validIds = valid.rows.map(r => r.id);
    if (validIds.length === 0) return res.status(400).json({ error: 'No valid users' });
    const values = validIds.map((_, i) => `($1, $${i + 2})`).join(',');
    await db.query(
      `INSERT INTO chat_channel_members (channel_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      [id, ...validIds]
    );
    await logAudit({ req, module: 'chat', action: 'group.members_added', target_type: 'chat_channel', target_id: id, after: { added: validIds } });

    const notifyIds = validIds.filter(uid => uid !== req.user.id);
    if (notifyIds.length > 0) {
      await notifyEvent('chat.message', {
        userIds: notifyIds, isDm: false,
        senderName: req.user.display_name || req.user.full_name,
        channelName: g.name, channelId: id,
        bodyPreview: 'added you to the group',
        actorUserId: req.user.id, related_id: id,
      }).catch(() => {});
    }
    res.json({ ok: true, added: validIds });
  } catch (err) {
    console.error('[chat/members/add] error:', err);
    res.status(500).json({ error: 'Failed to add members' });
  }
});

// ---- REMOVE MEMBER ----
router.delete('/channels/:id/members/:userId', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = parseInt(req.params.userId, 10);
  if (!id || !target) return res.status(400).json({ error: 'Bad id' });
  const g = await getGroupForMember(req.user.id, id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (g.type !== 'group') return res.status(400).json({ error: 'Can only manage members of custom groups' });
  if (!g.is_member) return res.status(403).json({ error: 'Join the group to manage members' });

  try {
    await db.query(`DELETE FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2`, [id, target]);
    await logAudit({ req, module: 'chat', action: 'group.member_removed', target_type: 'chat_channel', target_id: id, after: { removed: target } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat/members/remove] error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ---- GROUP MEMBERS (for the manage modal) ----
router.get('/channels/:id/members', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  if (!(await userIsInChannel(req.user.id, id))) return res.status(403).json({ error: 'Not a member' });
  try {
    const r = await db.query(
      `SELECT u.id, u.display_name, u.full_name, u.initials, u.avatar_colour
         FROM chat_channel_members m JOIN users u ON u.id = m.user_id
        WHERE m.channel_id = $1 AND u.deleted_at IS NULL
        ORDER BY u.full_name`,
      [id]
    );
    res.json({ members: r.rows });
  } catch (err) {
    console.error('[chat/members/list] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---- RENAME GROUP ----   body: { name }
router.post('/channels/:id/rename', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const g = await getGroupForMember(req.user.id, id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (g.type !== 'group') return res.status(400).json({ error: 'Only custom groups can be renamed' });
  if (!g.is_member) return res.status(403).json({ error: 'Join the group to rename it' });
  const newName = (req.body && req.body.name || '').trim();
  if (!newName) return res.status(400).json({ error: 'Name required' });
  if (newName.length > 80) return res.status(400).json({ error: 'Name too long (80 char max)' });
  try {
    await db.query(`UPDATE chat_channels SET name = $1 WHERE id = $2`, [newName, id]);
    await logAudit({ req, module: 'chat', action: 'group.renamed', target_type: 'chat_channel', target_id: id, before: { name: g.name }, after: { name: newName } });
    res.json({ ok: true, name: newName });
  } catch (err) {
    console.error('[chat/rename] error:', err);
    res.status(500).json({ error: 'Failed to rename' });
  }
});

// ---- ARCHIVE GROUP ----   hides it for everyone
router.post('/channels/:id/archive', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const g = await getGroupForMember(req.user.id, id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (g.type !== 'group') return res.status(400).json({ error: 'Only custom groups can be archived' });
  if (!g.is_member) return res.status(403).json({ error: 'Join the group to archive it' });
  try {
    await db.query(`UPDATE chat_channels SET is_archived = TRUE WHERE id = $1`, [id]);
    await logAudit({ req, module: 'chat', action: 'group.archived', target_type: 'chat_channel', target_id: id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat/archive] error:', err);
    res.status(500).json({ error: 'Failed to archive' });
  }
});

module.exports = router;
