// FK Home — shared mailbox access control + routing helpers
const { db } = require('../db');

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

function canManageMail(user) {
  return user.can('mail.admin.manage');
}

function canViewDeptMail(user) {
  return user.can('mail.view.dept') || user.can('mail.admin.manage');
}

function canSendDeptMail(user) {
  return user.can('mail.send.dept') || user.can('mail.admin.manage');
}

function canViewOwnMail(user) {
  return user.can('mail.view.own') || user.can('mail.admin.manage');
}

function canSendOwnMail(user) {
  return user.can('mail.send.own') || user.can('mail.admin.manage');
}

async function loadMailboxRow(slugOrId) {
  const isNum = /^\d+$/.test(String(slugOrId));
  const r = await db.query(
    `SELECT m.id, m.slug, m.display_name, m.gmail_address, m.department_id, m.is_active, 
            m.department_email, -- Added this field
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
     WHERE user_id = $1 AND department_id = $2 
     LIMIT 1`,
    [user.id, row.department_id]
  );

  return r.rows.length > 0;
}

async function checkMailboxAccess(user, row) {
  
  if (!row || !row.is_active) return null;

  if (canManageMail(user)) {
    return {
      can_read: true,
      can_send: true,
      source: 'admin'
    };
  }

  const explicit = await loadExplicitAccess(user.id, row.id);

  if (explicit) {
    return {
      can_read: !!explicit.can_read,
      can_send: !!explicit.can_send,
      source: 'grant'
    };
  }

  const deptMatch = await userInMailboxDepartment(user, row);

  console.log(
    "MAILBOX:",
    row.display_name,
    "DEPARTMENT_ID:",
    row.department_id,
    "DEPT_MATCH:",
    deptMatch
  );

  if (deptMatch) {
    console.log("✅ DEPARTMENT ACCESS GRANTED:", row.display_name);

    return {
      can_read: true,
      can_send: true,
      source: 'department'
    };
  }

  console.log("❌ ACCESS DENIED:", row.display_name);

  return null;
}
// Add department_email to the return object of resolveMailbox
// Inside resolveMailbox in mail-access.js
async function resolveMailbox(user, mailboxKey) {
  const key = String(mailboxKey || 'personal').trim();

  // If personal, check basic permission and return personal object
  if (!key || key === 'personal') {
    if (!canViewOwnMail(user)) {
      const err = new Error('You do not have permission to view your personal mailbox.');
      err.code = 'FORBIDDEN';
      throw err;
    }
    return {
      ...PERSONAL,
      gmail_address: user.email,
      department_email: user.email, // Ensure this exists
      can_read: true,
      can_send: canSendOwnMail(user),
    };
  }

  // If department, load and check access
  const row = await loadMailboxRow(key);
  if (!row) throw new Error('Mailbox not found.');
  
  const access = await checkMailboxAccess(user, row);
  if (!access || !access.can_read) {
    throw new Error('You do not have access to this mailbox.');
  }

  return {
    slug: row.slug,
    id: row.id,
    type: 'department',
    display_name: row.display_name,
    gmail_address: row.gmail_address,
    department_email: row.department_email, // Add this
    can_read: access.can_read,
    can_send: access.can_send,
    access_source: access.source,
  };
}

// Ensure listAccessibleMailboxes in mail-access.js includes both
async function listAccessibleMailboxes(user) {
  const out = [];

  // 1. Personal Mailbox
  if (canViewOwnMail(user)) {
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
  }

  // 2. Department/Shared Mailboxes
  const isAdmin = canManageMail(user);
  
  // Explicitly fetch all required fields for the frontend switcher
  const query = `
    SELECT DISTINCT 
           m.id, 
           m.slug, 
           m.display_name, 
           m.gmail_address, 
           d.name AS department_name
    FROM mail_mailboxes m
    LEFT JOIN departments d ON d.id = m.department_id AND d.deleted_at IS NULL
    LEFT JOIN user_department_memberships udm ON udm.department_id = m.department_id AND udm.user_id = $1
    LEFT JOIN mail_mailbox_access a ON a.mailbox_id = m.id AND a.user_id = $1
    WHERE m.is_active = TRUE
      AND ($2 = TRUE OR udm.user_id IS NOT NULL OR a.user_id IS NOT NULL)
    ORDER BY m.display_name ASC
  `;
  
  try {
    const r = await db.query(query, [user.id, isAdmin]);
    r.rows.forEach(row => {
      out.push({
        ...row,
        type: 'department',
        can_read: true, // You may want to refine this based on actual access levels
        can_send: true
      });
    });
  } catch (error) {
    console.error("Error fetching accessible mailboxes:", error);
    throw error;
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
  canManageMail,
};
