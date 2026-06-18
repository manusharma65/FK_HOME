// FK Home — shared mailbox access control + routing helpers
//
// Access model (no mail.* permissions required — none exist in this system):
//   • Personal mailbox  → any authenticated user may use their own mailbox.
//   • Department mailbox → accessible if the user is in the owner / company-manager
//                          group, OR is a member of that mailbox's department,
//                          OR has an explicit per-mailbox grant.
// This keeps existing personal mail working exactly as before and only ever ADDS
// access — it can never take a user's own inbox away.

const { db } = require('../db');

// Groups that can see/send every shared mailbox.
const ADMIN_GROUPS = ['owner', 'company-manager'];

const PERSONAL = {
  slug: 'personal',
  id: null,
  type: 'personal',
  display_name: 'Personal',
  gmail_address: null, // filled from req.user.email
  department_id: null,
  department_slug: null,
  department_name: null,
  can_read: true,
  can_send: true,
};

// Personal mail: available to any logged-in user (matches prior behaviour).
function canViewOwnMail() { return true; }
function canSendOwnMail() { return true; }

// "Mail admin" = member of the owner or company-manager group.
async function isMailAdmin(user) {
  if (!user || !user.id) return false;
  const r = await db.query(
    `SELECT 1
       FROM user_groups ug
       JOIN groups g ON g.id = ug.group_id AND g.deleted_at IS NULL
      WHERE ug.user_id = $1 AND g.slug = ANY($2)
      LIMIT 1`,
    [user.id, ADMIN_GROUPS]
  );
  return r.rows.length > 0;
}

async function loadMailboxRow(slugOrId) {
  const isNum = /^\d+$/.test(String(slugOrId));
  const r = await db.query(
    `SELECT m.id, m.slug, m.display_name, m.gmail_address, m.department_id, m.is_active,
            d.slug AS department_slug, d.name AS department_name
     FROM mail_mailboxes m
     LEFT JOIN departments d ON d.id = m.department_id AND d.deleted_at IS NULL
     WHERE ${isNum ? 'm.id = $1' : 'm.slug = $1'}
     LIMIT 1`,
    [isNum ? parseInt(slugOrId, 10) : String(slugOrId)]
  );
  return r.rows[0] || null;
}

async function loadExplicitAccess(userId, mailboxId) {
  const r = await db.query(
    `SELECT can_read, can_send FROM mail_mailbox_access
     WHERE user_id = $1 AND mailbox_id = $2`,
    [userId, mailboxId]
  );
  return r.rows[0] || null;
}

async function userInMailboxDepartment(user, row) {
  if (!row.department_id) return false;
  const r = await db.query(
    `SELECT 1 FROM user_department_memberships
     WHERE user_id = $1 AND department_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [user.id, row.department_id]
  );
  return r.rows.length > 0;
}

async function checkMailboxAccess(user, row) {
  if (!row || !row.is_active) return null;

  if (await isMailAdmin(user)) {
    return { can_read: true, can_send: true, source: 'admin' };
  }

  const explicit = await loadExplicitAccess(user.id, row.id);
  if (explicit) {
    return {
      can_read: !!explicit.can_read,
      can_send: !!explicit.can_send,
      source: 'grant',
    };
  }

  if (await userInMailboxDepartment(user, row)) {
    return { can_read: true, can_send: true, source: 'department' };
  }

  return null;
}

async function resolveMailbox(user, mailboxKey) {
  const key = String(mailboxKey || 'personal').trim();

  // Personal mailbox.
  if (!key || key === 'personal') {
    return {
      ...PERSONAL,
      gmail_address: user.email,
      can_read: true,
      can_send: canSendOwnMail(user),
    };
  }

  // Department / shared mailbox.
  const row = await loadMailboxRow(key);
  if (!row) throw new Error('Mailbox not found.');

  const access = await checkMailboxAccess(user, row);
  if (!access || !access.can_read) {
    const err = new Error('You do not have access to this mailbox.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  return {
    slug: row.slug,
    id: row.id,
    type: 'department',
    display_name: row.display_name,
    gmail_address: row.gmail_address,
    department_id: row.department_id,
    department_slug: row.department_slug,
    department_name: row.department_name,
    can_read: access.can_read,
    can_send: access.can_send,
    access_source: access.source,
  };
}

async function listAccessibleMailboxes(user) {
  const out = [];

  // 1. Personal mailbox — always available.
  out.push({
    slug: 'personal',
    id: null,
    type: 'personal',
    display_name: 'Personal',
    gmail_address: user.email,
    department_name: null,
    can_read: true,
    can_send: canSendOwnMail(user),
  });

  // 2. Shared / department mailboxes the user can reach.
  const isAdmin = await isMailAdmin(user);
  const query = `
    SELECT DISTINCT
           m.id, m.slug, m.display_name, m.gmail_address,
           d.name AS department_name
    FROM mail_mailboxes m
    LEFT JOIN departments d
      ON d.id = m.department_id AND d.deleted_at IS NULL
    LEFT JOIN user_department_memberships udm
      ON udm.department_id = m.department_id AND udm.user_id = $1 AND udm.deleted_at IS NULL
    LEFT JOIN mail_mailbox_access a
      ON a.mailbox_id = m.id AND a.user_id = $1
    WHERE m.is_active = TRUE
      AND ($2 = TRUE OR udm.user_id IS NOT NULL OR a.user_id IS NOT NULL)
    ORDER BY m.display_name ASC
  `;
  try {
    const r = await db.query(query, [user.id, isAdmin]);
    r.rows.forEach((row) => {
      out.push({ ...row, type: 'department', can_read: true, can_send: true });
    });
  } catch (error) {
    // Never let a shared-mailbox lookup break the inbox; personal mail still loads.
    console.error('[mail-access] listAccessibleMailboxes failed:', error.message);
  }

  return out;
}

// Resolve which mailbox an inbound address belongs to (routing preview / admin).
async function resolveRoutingForAddress(address) {
  const addr = String(address || '').trim().toLowerCase();
  if (!addr) return null;

  const aliasHit = await db.query(
    `SELECT m.id, m.slug, m.display_name, m.gmail_address
     FROM mail_mailbox_aliases a
     JOIN mail_mailboxes m ON m.id = a.mailbox_id AND m.is_active = TRUE
     WHERE LOWER(a.alias_address) = $1
     LIMIT 1`,
    [addr]
  );
  if (aliasHit.rows.length) return { mailbox: aliasHit.rows[0], matched_by: 'alias' };

  const ruleHit = await db.query(
    `SELECT m.id, m.slug, m.display_name, m.gmail_address, r.match_type
     FROM mail_routing_rules r
     JOIN mail_mailboxes m ON m.id = r.mailbox_id AND m.is_active = TRUE
     WHERE r.is_active = TRUE AND r.match_type = 'alias' AND LOWER(r.match_value) = $1
     ORDER BY r.priority ASC
     LIMIT 1`,
    [addr]
  );
  if (ruleHit.rows.length) {
    const row = ruleHit.rows[0];
    return { mailbox: row, matched_by: 'rule:' + row.match_type };
  }

  const gmailHit = await db.query(
    `SELECT id, slug, display_name, gmail_address FROM mail_mailboxes
     WHERE is_active = TRUE AND LOWER(gmail_address) = $1 LIMIT 1`,
    [addr]
  );
  if (gmailHit.rows.length) return { mailbox: gmailHit.rows[0], matched_by: 'gmail_address' };

  return null;
}

function mailboxScopeId(mailbox) {
  return mailbox && mailbox.id ? mailbox.id : null;
}

module.exports = {
  resolveMailbox,
  listAccessibleMailboxes,
  resolveRoutingForAddress,
  checkMailboxAccess,
  loadMailboxRow,
  mailboxScopeId,
  isMailAdmin,
};
