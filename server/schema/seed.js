// FK Home — seed
// Idempotent. Runs every boot, inserts only what doesn't already exist.
// Seeds: 9 departments, full permission catalogue, starter groups, team break,
//        Bobby as owner with current-year leave balance.

const bcrypt = require('bcryptjs');
const { db } = require('../db');

// ---------- Departments (locked from chat) ----------
const DEPARTMENTS = [
  { slug: 'amazon',    name: 'Amazon',           icon: 'ti-brand-amazon',   colour: '#EF9F27', sort: 1 },
  { slug: 'google',    name: 'Google',           icon: 'ti-brand-google',   colour: '#378ADD', sort: 2 },
  { slug: 'cs',        name: 'Customer Service', icon: 'ti-headset',        colour: '#1D9E75', sort: 3 },
  { slug: 'design',    name: 'Design',           icon: 'ti-palette',        colour: '#7F77DD', sort: 4 },
  { slug: 'seo',       name: 'SEO',              icon: 'ti-search',         colour: '#34A853', sort: 5 },
  { slug: 'accounts',  name: 'Accounts',         icon: 'ti-receipt-pound',  colour: '#D4537E', sort: 6 },
  { slug: 'warehouse', name: 'Warehouse',        icon: 'ti-package',        colour: '#D85A30', sort: 7 },
  { slug: 'logistics', name: 'Logistics',        icon: 'ti-ship',           colour: '#534AB7', sort: 8 },
  { slug: 'hr',        name: 'HR',               icon: 'ti-users',          colour: '#5DCAA5', sort: 9 },
  { slug: 'sourcing',  name: 'Sourcing',         icon: 'ti-archive',        colour: '#888780', sort: 10 },
];

// ---------- Permissions catalogue ----------
const PERMISSIONS = [
  // Auth — everyone (via employee-base group)
  { slug: 'auth.profile.view',           module: 'auth',  description: 'View own profile' },
  { slug: 'auth.profile.edit',           module: 'auth',  description: 'Edit own profile' },
  { slug: 'auth.password.change',        module: 'auth',  description: 'Change own password' },

  // Me — own status, leaves, lateness
  { slug: 'me.status.set',               module: 'me',    description: 'Set own status (active/late/sick/break)' },
  { slug: 'me.leaves.request',           module: 'me',    description: 'Request leave' },
  { slug: 'me.leaves.cancel_own',        module: 'me',    description: 'Cancel own pending leave request' },
  { slug: 'me.lateness.report',          module: 'me',    description: 'Report running late' },
  { slug: 'me.sick.report',              module: 'me',    description: 'Report sick' },

  // Team — see your teammates' presence
  { slug: 'team.presence.view',          module: 'team',  description: 'See who is on / late / off in your team' },

  // Leaves — approval flow
  { slug: 'leaves.approve.dept',         module: 'leaves', description: 'Approve leave requests in your department' },
  { slug: 'leaves.approve.any',          module: 'leaves', description: 'Approve leave requests for anyone' },
  { slug: 'leaves.view.dept',            module: 'leaves', description: 'View leave history for your department' },
  { slug: 'leaves.view.any',             module: 'leaves', description: 'View leave history for anyone' },

  // Admin
  { slug: 'admin.users.view',            module: 'admin', description: 'View user list' },
  { slug: 'admin.users.create',          module: 'admin', description: 'Create new user' },
  { slug: 'admin.users.edit',            module: 'admin', description: 'Edit user details' },
  { slug: 'admin.users.delete',          module: 'admin', description: 'Soft-delete a user' },
  { slug: 'admin.users.reset_password',  module: 'admin', description: 'Reset another user password' },
  { slug: 'admin.departments.view',      module: 'admin', description: 'View departments' },
  { slug: 'admin.groups.view',           module: 'admin', description: 'View groups' },
  { slug: 'admin.groups.edit',           module: 'admin', description: 'Edit groups' },
  { slug: 'admin.permissions.view',      module: 'admin', description: 'View permission catalogue' },
  { slug: 'admin.audit.view',            module: 'admin', description: 'View audit log' },
  { slug: 'admin.break.edit',            module: 'admin', description: 'Edit team break schedule' },

  // HR-1 — Attendance + shift policy
  { slug: 'attendance.regularise.request',   module: 'attendance', description: 'Submit an attendance correction request' },
  { slug: 'attendance.regularise.approve.dept', module: 'attendance', description: 'Approve attendance corrections for your department' },
  { slug: 'attendance.regularise.approve.any',  module: 'attendance', description: 'Approve attendance corrections for anyone' },
  { slug: 'attendance.view.own',             module: 'attendance', description: 'View own attendance record' },
  { slug: 'attendance.view.dept',            module: 'attendance', description: 'View attendance for your department' },
  { slug: 'attendance.view.any',             module: 'attendance', description: 'View attendance company-wide' },
  { slug: 'attendance.policy.edit',          module: 'attendance', description: 'Edit shift policies, pattern anchor, holidays' },
  { slug: 'attendance.cs_rota.upload',       module: 'attendance', description: 'Upload the CS 4-week rota' },
  { slug: 'attendance.cs_rota.view',         module: 'attendance', description: 'View the CS rota' },
  { slug: 'hr.dashboard.view',               module: 'hr',         description: 'Access the HR dashboard (/hr.html)' },
  { slug: 'hr.chronic_idle.action',          module: 'hr',         description: 'Acknowledge or dismiss chronic idle flags' },
  { slug: 'daily_report.submit.own',         module: 'attendance', description: 'Submit own daily report' },
  { slug: 'daily_report.view.dept',          module: 'attendance', description: 'View daily reports for your department' },
  { slug: 'daily_report.view.any',           module: 'attendance', description: 'View daily reports company-wide' },

  // r0.7 — Daily report review + employment + leave admin
  { slug: 'daily_report.review.dept',        module: 'attendance', description: 'Review (mark Not satisfactory/Satisfactory/Good) reports in your department' },
  { slug: 'daily_report.review.any',         module: 'attendance', description: 'Review daily reports for anyone' },
  { slug: 'admin.employment.edit',           module: 'admin',      description: 'Edit employment fields (joined date, salary, pattern, etc.)' },
  { slug: 'admin.payroll.view',              module: 'admin',      description: 'View payroll summaries (weekend pay, balances)' },
  { slug: 'admin.leaves.adjust',             module: 'admin',      description: 'Manually adjust leave balances' },

  // r0.8 — Backups (owner-only)
  { slug: 'admin.backup.manage',             module: 'admin',      description: 'View, trigger, and download system backups' },

  // r0.9 — Profile + files (HR-3)
  { slug: 'profile.view.own',                module: 'profile',    description: 'View own profile page' },
  { slug: 'profile.view.dept',               module: 'profile',    description: 'View profiles of department colleagues' },
  { slug: 'profile.view.any',                module: 'profile',    description: 'View any user profile' },
  { slug: 'profile.edit.dept',               module: 'profile',    description: 'Add performance notes for department colleagues' },
  { slug: 'profile.edit.any',                module: 'profile',    description: 'Edit drawers (except Salary) for any user' },
  { slug: 'profile.salary.view',             module: 'profile',    description: 'View salary structure' },
  { slug: 'profile.salary.edit',             module: 'profile',    description: 'Change salary structure (owner-sensitive)' },
  { slug: 'files.upload.own',                module: 'profile',    description: 'Upload to own Personal drawer' },
  { slug: 'files.upload.any',                module: 'profile',    description: 'Upload files to any user, any drawer' },
  { slug: 'files.delete.any',                module: 'profile',    description: 'Delete files (soft) on any profile' },

  // r0.10 — Lifecycle (reviews + tasks + onboarding templates)
  { slug: 'tasks.view.own',                  module: 'tasks',      description: 'See own task list (everyone has this)' },
  { slug: 'reviews.complete',                module: 'reviews',    description: 'Complete a review (write status + notes)' },
  { slug: 'reviews.schedule',                module: 'reviews',    description: 'Add ad-hoc reviews or reschedule planned ones' },
  { slug: 'probation.manage',                module: 'profile',    description: 'Change probation status (confirm / extend / fail)' },
  { slug: 'admin.onboarding_templates.edit', module: 'admin',      description: 'Edit the company onboarding checklist template' },
  { slug: 'admin.settings.edit',             module: 'admin',      description: 'Edit system settings (review windows, probation length…)' },
  { slug: 'admin.backfill.run',              module: 'admin',      description: 'Run one-off backfill jobs (generate review schedules)' },
];

// ---------- Groups ----------
const EMPLOYEE_BASE_PERMS = [
  'auth.profile.view','auth.profile.edit','auth.password.change',
  'me.status.set','me.leaves.request','me.leaves.cancel_own',
  'me.lateness.report','me.sick.report',
  'team.presence.view',
  'attendance.view.own','attendance.regularise.request',
  'daily_report.submit.own',
  // r0.9 — HR-3
  'profile.view.own','files.upload.own',
  // r0.10 — Lifecycle: everyone has tasks (My tasks card)
  'tasks.view.own',
];

const GROUPS = [
  {
    slug: 'owner',
    name: 'Founder',
    description: 'Full system access.',
    is_system: true,
    permissions: '*'
  },
  {
    slug: 'company-manager',
    name: 'Head of Operations',
    description: 'Cross-department manager.',
    is_system: true,
    permissions: [
      ...EMPLOYEE_BASE_PERMS,
      'leaves.approve.any','leaves.view.any',
      'admin.users.view','admin.users.create','admin.users.edit','admin.users.reset_password',
      'admin.departments.view',
      'admin.groups.view','admin.groups.edit',
      'admin.permissions.view',
      'admin.audit.view',
      'admin.employment.edit','admin.payroll.view','admin.leaves.adjust',
      'attendance.view.any','attendance.regularise.approve.any','attendance.policy.edit','attendance.cs_rota.view',
      'hr.dashboard.view',
      'daily_report.view.any','daily_report.review.any',
      // r0.9 — HR-3. Sees profiles + edits notes for everyone, but NO salary access.
      'profile.view.any','profile.edit.any',
      'files.upload.any',
      // r0.10 — Lifecycle: ops head can review anyone, schedule, etc.
      'reviews.complete','reviews.schedule',
    ]
  },
  {
    slug: 'department-manager',
    name: 'Department Manager',
    description: 'Manages their own department. Approves dept leaves.',
    is_system: true,
    permissions: [
      ...EMPLOYEE_BASE_PERMS,
      'leaves.approve.dept','leaves.view.dept',
      'attendance.view.dept','attendance.regularise.approve.dept',
      'daily_report.view.dept','daily_report.review.dept',
      // r0.9 — sees dept profiles, adds performance notes
      'profile.view.dept','profile.edit.dept',
      // r0.10 — Lifecycle: managers complete reviews for their team
      'reviews.complete',
    ]
  },
  {
    slug: 'hr-team',
    name: 'HR Team',
    description: 'HR can manage leaves, lateness, and people.',
    is_system: true,
    permissions: [
      ...EMPLOYEE_BASE_PERMS,
      'leaves.approve.any','leaves.view.any',
      'admin.users.view','admin.users.create','admin.users.edit','admin.users.reset_password',
      'admin.departments.view',
      'admin.groups.view',
      'admin.break.edit',
      'admin.employment.edit','admin.payroll.view','admin.leaves.adjust',
      'attendance.view.any','attendance.regularise.approve.any',
      'attendance.cs_rota.view',
      'hr.dashboard.view','hr.chronic_idle.action',
      'daily_report.view.any','daily_report.review.any',
      // r0.9 — HR-3. Full profile access including salary VIEW (but not edit).
      'profile.view.any','profile.edit.any',
      'profile.salary.view',
      'files.upload.any','files.delete.any',
      // r0.10 — Lifecycle: HR can schedule, complete, manage probation, edit templates
      'reviews.complete','reviews.schedule','probation.manage',
      'admin.onboarding_templates.edit','admin.backfill.run',
    ]
  },
  {
    slug: 'cs-lead',
    name: 'CS Team Lead',
    description: 'Customer Service team lead. Uploads the 4-week rota.',
    is_system: true,
    permissions: [
      ...EMPLOYEE_BASE_PERMS,
      'attendance.cs_rota.upload','attendance.cs_rota.view',
      'attendance.view.dept','attendance.regularise.approve.dept',
      'daily_report.view.dept','daily_report.review.dept',
      // r0.9 — sees CS team profiles
      'profile.view.dept','profile.edit.dept',
      // r0.10 — CS lead reviews CS team
      'reviews.complete',
    ]
  },
  {
    slug: 'employee-base',
    name: 'Employee (base)',
    description: 'Default group for every employee.',
    is_system: true,
    permissions: EMPLOYEE_BASE_PERMS
  },
];

// ---------- Bobby ----------
const BOBBY = {
  email: 'bobby@fksports.co.uk',
  password: 'Bobby001',
  full_name: 'Bobby Singh',
  display_name: 'Bobby',
  initials: 'BS',
  avatar_colour: '#FAC775',
  must_change_password: true,
  groups: ['owner','employee-base'],
};

// ---------- Year + leave policy ----------
const CURRENT_YEAR = new Date().getFullYear();
const STANDARD_ANNUAL_DAYS = 25;

// ---------- Team break ----------
const TEAM_BREAK = { scope: 'company', start: '11:30:00', duration: 50, timezone: 'Europe/London' };

async function seedInitialData() {
  await seedDepartments();
  await seedPermissions();
  await seedGroups();
  await seedLeavePolicy();
  await seedTeamBreak();
  await seedBobby();
  await seedChannels();
}

async function seedDepartments() {
  for (const d of DEPARTMENTS) {
    await db.query(
      `INSERT INTO departments (slug, name, icon, colour, sort_order)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO NOTHING`,
      [d.slug, d.name, d.icon, d.colour, d.sort]
    );
  }
  console.log(`[seed] departments: ${DEPARTMENTS.length} verified`);
}

async function seedPermissions() {
  for (const p of PERMISSIONS) {
    await db.query(
      `INSERT INTO permissions (slug, module, description)
       VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE
         SET module = EXCLUDED.module, description = EXCLUDED.description`,
      [p.slug, p.module, p.description]
    );
  }
  // r0.9 — Remove dead permission rows that are no longer in the catalogue.
  // Safe because we just inserted everything in the catalogue; whatever is
  // left in the table that we didn't touch is orphaned.
  const validSlugs = PERMISSIONS.map(p => p.slug);
  const removed = await db.query(
    `DELETE FROM permissions WHERE slug <> ALL($1::text[]) RETURNING slug`,
    [validSlugs]
  );
  if (removed.rows.length > 0) {
    console.log(`[seed] permissions: removed ${removed.rows.length} orphan(s): ${removed.rows.map(r => r.slug).join(', ')}`);
  }
  console.log(`[seed] permissions: ${PERMISSIONS.length} verified`);
}

async function seedGroups() {
  for (const g of GROUPS) {
    let existing = await db.query('SELECT id FROM groups WHERE slug = $1', [g.slug]);
    let groupId;
    if (existing.rows.length === 0) {
      const r = await db.query(
        `INSERT INTO groups (slug, name, description, is_system)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [g.slug, g.name, g.description, g.is_system]
      );
      groupId = r.rows[0].id;
    } else {
      groupId = existing.rows[0].id;
      // Keep name + description in sync with seed (so renames propagate).
      await db.query(
        `UPDATE groups SET name = $1, description = $2 WHERE id = $3`,
        [g.name, g.description, groupId]
      );
    }

    let permSlugs;
    if (g.permissions === '*') {
      const r = await db.query('SELECT slug FROM permissions');
      permSlugs = r.rows.map(x => x.slug);
    } else {
      permSlugs = g.permissions;
    }

    // r0.9 — Make seed authoritative for system groups: REPLACE the membership
    // set rather than just adding. Wipe + re-add. Only for system groups so
    // any manually-managed (non-system) group is untouched.
    if (g.is_system) {
      await db.query(`DELETE FROM group_permissions WHERE group_id = $1`, [groupId]);
    }

    for (const slug of permSlugs) {
      const p = await db.query('SELECT id FROM permissions WHERE slug = $1', [slug]);
      if (p.rows.length === 0) {
        console.warn(`[seed] group "${g.slug}" references unknown permission "${slug}"`);
        continue;
      }
      await db.query(
        `INSERT INTO group_permissions (group_id, permission_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [groupId, p.rows[0].id]
      );
    }
  }
  console.log(`[seed] groups: ${GROUPS.length} verified`);
}

async function seedLeavePolicy() {
  await db.query(
    `INSERT INTO leave_policies (year, policy_name, annual_days, notes)
     VALUES ($1,'standard',$2,$3) ON CONFLICT (year, policy_name) DO NOTHING`,
    [CURRENT_YEAR, STANDARD_ANNUAL_DAYS, `Default annual entitlement: ${STANDARD_ANNUAL_DAYS} days`]
  );
  console.log(`[seed] leave policy ${CURRENT_YEAR}: ${STANDARD_ANNUAL_DAYS} days`);
}

async function seedTeamBreak() {
  await db.query(
    `INSERT INTO team_break_schedule (scope, break_start_time, duration_minutes, timezone)
     VALUES ($1,$2,$3,$4) ON CONFLICT (scope) DO NOTHING`,
    [TEAM_BREAK.scope, TEAM_BREAK.start, TEAM_BREAK.duration, TEAM_BREAK.timezone]
  );
  console.log('[seed] team break: 11:30 — 50 min Europe/London');
}

async function seedBobby() {
  let existing = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [BOBBY.email]);
  let bobbyId;
  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(BOBBY.password, 10);
    const r = await db.query(
      `INSERT INTO users (email, password_hash, full_name, display_name, initials, avatar_colour, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [BOBBY.email, hash, BOBBY.full_name, BOBBY.display_name, BOBBY.initials, BOBBY.avatar_colour, BOBBY.must_change_password]
    );
    bobbyId = r.rows[0].id;
    console.log(`[seed] Bobby created — email: ${BOBBY.email}, password: Bobby001 (must change on first login)`);
  } else {
    bobbyId = existing.rows[0].id;
    console.log('[seed] Bobby already exists');
  }

  // Sync group memberships
  for (const slug of BOBBY.groups) {
    const g = await db.query('SELECT id FROM groups WHERE slug = $1', [slug]);
    if (g.rows.length === 0) continue;
    await db.query(
      `INSERT INTO user_groups (user_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [bobbyId, g.rows[0].id]
    );
  }

  // Ensure current-year leave balance row
  await db.query(
    `INSERT INTO leave_balances (user_id, year, entitled_days, carryover_days, taken_days, pending_days)
     VALUES ($1,$2,$3,0,0,0)
     ON CONFLICT (user_id, year) DO NOTHING`,
    [bobbyId, CURRENT_YEAR, STANDARD_ANNUAL_DAYS]
  );

  // Ensure user_status row
  await db.query(
    `INSERT INTO user_status (user_id, status) VALUES ($1, 'offline')
     ON CONFLICT (user_id) DO NOTHING`,
    [bobbyId]
  );
}

async function seedChannels() {
  // All-hands channel — everyone joins
  const ah = await db.query(`SELECT id FROM chat_channels WHERE type = 'all_hands' LIMIT 1`);
  let allHandsId;
  if (ah.rows.length === 0) {
    const r = await db.query(
      `INSERT INTO chat_channels (slug, name, type, description)
       VALUES ('all-hands', 'All hands', 'all_hands', 'Company-wide announcements')
       RETURNING id`
    );
    allHandsId = r.rows[0].id;
    console.log('[seed] all-hands channel created');
  } else {
    allHandsId = ah.rows[0].id;
  }

  // One channel per department
  const depts = await db.query(`SELECT id, slug, name FROM departments WHERE deleted_at IS NULL`);
  for (const d of depts.rows) {
    const existing = await db.query(
      `SELECT id FROM chat_channels WHERE department_id = $1 AND type = 'department'`,
      [d.id]
    );
    if (existing.rows.length === 0) {
      await db.query(
        `INSERT INTO chat_channels (slug, name, type, department_id, description)
         VALUES ($1, $2, 'department', $3, $4)`,
        [`dept-${d.slug}`, `${d.name} team`, d.id, `${d.name} team channel`]
      );
    }
  }

  // Sync: every active user is in all-hands, and in their own dept channel(s)
  await db.query(
    `INSERT INTO chat_channel_members (channel_id, user_id)
     SELECT $1, u.id FROM users u
     WHERE u.deleted_at IS NULL AND u.employment_status = 'active'
     ON CONFLICT DO NOTHING`,
    [allHandsId]
  );
  await db.query(
    `INSERT INTO chat_channel_members (channel_id, user_id)
     SELECT c.id, m.user_id
     FROM chat_channels c
     JOIN user_department_memberships m ON m.department_id = c.department_id AND m.deleted_at IS NULL
     WHERE c.type = 'department'
     ON CONFLICT DO NOTHING`
  );

  // Founder + Head of Operations get auto-joined to EVERY department channel
  // (so they see all team chats and get notifications across the company).
  await db.query(
    `INSERT INTO chat_channel_members (channel_id, user_id)
     SELECT c.id, ug.user_id
     FROM chat_channels c
     JOIN user_groups ug ON TRUE
     JOIN groups g ON g.id = ug.group_id
     WHERE c.type = 'department'
       AND g.slug IN ('owner','company-manager')
       AND g.deleted_at IS NULL
     ON CONFLICT DO NOTHING`
  );

  console.log(`[seed] channels: all-hands + ${depts.rows.length} dept channels verified`);
}

module.exports = { seedInitialData };