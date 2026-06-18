// FK Home — Mail admin (department mailboxes, aliases, routing, access grants)
const express = require('express');
const { requireAuth, requirePermission, logAudit } = require('../auth');
const { db } = require('../db');
const { resolveRoutingForAddress, loadMailboxRow } = require('./mail-access');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission('mail.admin.manage'));

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

async function mailboxDetail(id) {
 const r = await db.query(
    `SELECT m.*, d.slug AS department_slug, d.name AS department_name
     FROM mail_mailboxes m
     LEFT JOIN departments d ON d.id = m.department_id
     WHERE m.id = $1`,
    [id]
  );
  if (!r.rows.length) return null;
  const mb = r.rows[0];
  const [aliases, rules, access] = await Promise.all([
    db.query('SELECT id, alias_address, is_primary FROM mail_mailbox_aliases WHERE mailbox_id = $1 ORDER BY is_primary DESC, alias_address', [id]),
    db.query('SELECT id, match_type, match_value, priority, is_active, notes FROM mail_routing_rules WHERE mailbox_id = $1 ORDER BY priority, id', [id]),
    db.query(
      `SELECT a.user_id, a.can_read, a.can_send, u.full_name, u.email
       FROM mail_mailbox_access a JOIN users u ON u.id = a.user_id
       WHERE a.mailbox_id = $1 ORDER BY u.full_name`,
      [id]
    ),
  ]);
  return {
    ...mb,
    aliases: aliases.rows,
    routing_rules: rules.rows,
    access_grants: access.rows,
  };
}

// ---- Mailboxes CRUD ----
router.get('/mailboxes', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT m.id, m.slug, m.display_name, m.gmail_address, m.department_email, m.department_id, m.description,
              m.sort_order, m.is_active, d.slug AS department_slug, d.name AS department_name
       FROM mail_mailboxes m
       LEFT JOIN departments d ON d.id = m.department_id
       ORDER BY m.sort_order, m.display_name`
    );
    res.json({ mailboxes: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/mailboxes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const mb = await mailboxDetail(id);
    if (!mb) return res.status(404).json({ error: 'Not found' });
    res.json({ mailbox: mb });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/mailboxes', async (req, res) => {
  try {
    const { slug, display_name, gmail_address, department_id, department_slug, description, sort_order, is_active } = req.body || {};
    if (!display_name || !gmail_address) return res.status(400).json({ error: 'display_name and gmail_address required' });
    const finalSlug = slugify(slug || display_name);
    if (!finalSlug) return res.status(400).json({ error: 'Invalid slug' });
    let deptId = department_id ? parseInt(department_id, 10) : null;
    if (!deptId && department_slug) {
      const d = await db.query('SELECT id FROM departments WHERE slug = $1 AND deleted_at IS NULL', [department_slug]);
      if (d.rows.length) deptId = d.rows[0].id;
    }
    const r = await db.query(
      `INSERT INTO mail_mailboxes (slug, display_name, gmail_address,department_email, department_id, description, sort_order, is_active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [finalSlug, display_name.trim(), gmail_address.trim().toLowerCase(), department_email || null, deptId || null,
       description || null, parseInt(sort_order, 10) || 0, is_active !== false]
    );
    await logAudit({ req, module: 'mail', action: 'mailbox.created', target_type: 'mail_mailbox', target_id: r.rows[0].id, after: r.rows[0] });
    res.json({ mailbox: await mailboxDetail(r.rows[0].id) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Slug or address already exists.' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/mailboxes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Bad id' });
    const before = await loadMailboxRow(id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const { display_name, gmail_address, department_id, department_slug, description, sort_order, is_active } = req.body || {};
    let deptId = department_id !== undefined ? (department_id ? parseInt(department_id, 10) : null) : before.department_id;
    if (department_slug !== undefined) {
      if (!department_slug) deptId = null;
      else {
        const d = await db.query('SELECT id FROM departments WHERE slug = $1 AND deleted_at IS NULL', [department_slug]);
        deptId = d.rows.length ? d.rows[0].id : null;
      }
    }
    const r = await db.query(
      `UPDATE mail_mailboxes SET
         display_name = COALESCE($2, display_name),
         gmail_address = COALESCE($3, gmail_address),
         department_id = $4,
         description = COALESCE($5, description),
         sort_order = COALESCE($6, sort_order),
         is_active = COALESCE($7, is_active),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id,
       display_name != null ? display_name.trim() : null,
       gmail_address != null ? gmail_address.trim().toLowerCase() : null,
       deptId,
       description,
       sort_order != null ? parseInt(sort_order, 10) : null,
       is_active != null ? !!is_active : null]
    );
    await logAudit({ req, module: 'mail', action: 'mailbox.updated', target_type: 'mail_mailbox', target_id: id, before, after: r.rows[0] });
    res.json({ mailbox: await mailboxDetail(id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/mailboxes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await db.query('UPDATE mail_mailboxes SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    await logAudit({ req, module: 'mail', action: 'mailbox.deactivated', target_type: 'mail_mailbox', target_id: id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Aliases ----
router.post('/mailboxes/:id/aliases', async (req, res) => {
  try {
    const mailboxId = parseInt(req.params.id, 10);
    const { alias_address, is_primary } = req.body || {};
    if (!alias_address) return res.status(400).json({ error: 'alias_address required' });
    if (is_primary) {
      await db.query('UPDATE mail_mailbox_aliases SET is_primary = FALSE WHERE mailbox_id = $1', [mailboxId]);
    }
    const r = await db.query(
      `INSERT INTO mail_mailbox_aliases (mailbox_id, alias_address, is_primary)
       VALUES ($1,$2,$3) RETURNING *`,
      [mailboxId, alias_address.trim().toLowerCase(), !!is_primary]
    );
    await logAudit({ req, module: 'mail', action: 'alias.created', target_type: 'mail_mailbox', target_id: mailboxId, after: r.rows[0] });
    res.json({ alias: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Alias already assigned to another mailbox.' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/aliases/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.query('DELETE FROM mail_mailbox_aliases WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Routing rules ----
router.get('/routing-rules', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT r.*, m.slug AS mailbox_slug, m.display_name AS mailbox_name
       FROM mail_routing_rules r
       JOIN mail_mailboxes m ON m.id = r.mailbox_id
       ORDER BY r.priority, r.id`
    );
    res.json({ rules: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/routing-rules', async (req, res) => {
  try {
    const { mailbox_id, match_type, match_value, priority, is_active, notes } = req.body || {};
    const mbId = parseInt(mailbox_id, 10);
    if (!mbId || !match_type || !match_value) return res.status(400).json({ error: 'mailbox_id, match_type, match_value required' });
    if (!['to', 'from', 'subject', 'alias'].includes(match_type)) return res.status(400).json({ error: 'Invalid match_type' });
    const r = await db.query(
      `INSERT INTO mail_routing_rules (mailbox_id, match_type, match_value, priority, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [mbId, match_type, match_value.trim(), parseInt(priority, 10) || 100, is_active !== false, notes || null]
    );
    await logAudit({ req, module: 'mail', action: 'routing.created', target_type: 'mail_routing_rule', target_id: r.rows[0].id, after: r.rows[0] });
    res.json({ rule: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/routing-rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { match_type, match_value, priority, is_active, notes, mailbox_id } = req.body || {};
    const r = await db.query(
      `UPDATE mail_routing_rules SET
         mailbox_id = COALESCE($2, mailbox_id),
         match_type = COALESCE($3, match_type),
         match_value = COALESCE($4, match_value),
         priority = COALESCE($5, priority),
         is_active = COALESCE($6, is_active),
         notes = COALESCE($7, notes)
       WHERE id = $1 RETURNING *`,
      [id, mailbox_id ? parseInt(mailbox_id, 10) : null, match_type, match_value, priority != null ? parseInt(priority, 10) : null, is_active, notes]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ rule: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/routing-rules/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM mail_routing_rules WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/route-preview', async (req, res) => {
  try {
    const address = req.query.address || req.query.to;
    const hit = await resolveRoutingForAddress(address);
    res.json({ address, route: hit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Access grants ----
router.put('/mailboxes/:id/access', async (req, res) => {
  try {
    const mailboxId = parseInt(req.params.id, 10);
    const { user_id, can_read, can_send } = req.body || {};
    const userId = parseInt(user_id, 10);
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    await db.query(
      `INSERT INTO mail_mailbox_access (mailbox_id, user_id, can_read, can_send)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (mailbox_id, user_id) DO UPDATE SET can_read = EXCLUDED.can_read, can_send = EXCLUDED.can_send`,
      [mailboxId, userId, can_read !== false, !!can_send]
    );
    await logAudit({ req, module: 'mail', action: 'access.granted', target_type: 'mail_mailbox', target_id: mailboxId, details: `user ${userId}` });
    res.json({ ok: true, mailbox: await mailboxDetail(mailboxId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/mailboxes/:id/access/:userId', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM mail_mailbox_access WHERE mailbox_id = $1 AND user_id = $2',
      [parseInt(req.params.id, 10), parseInt(req.params.userId, 10)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
