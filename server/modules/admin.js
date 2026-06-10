// FK Home — /api/admin/*
// User, group, department, and audit log management.
// Permission-gated: requires admin.* permissions for each action.

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireAuth, requirePermission, logAudit } = require('../auth');
const { notify, notifyEvent } = require('../notify');
const leaveEngine = require('./leave-engine');
const backupEngine = require('./backup');
const lifecycle = require('./lifecycle');
const { nextEmpId } = require('./emp-id');
const { applyOnboardingTemplate } = require('./onboarding-template');

const router = express.Router();
router.use(requireAuth);

// ---------- DEPARTMENTS ----------
router.get('/departments', requirePermission('admin.departments.view'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, slug, name, icon, colour, sort_order
       FROM departments WHERE deleted_at IS NULL ORDER BY sort_order, name`
    );
    res.json({ departments: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- USERS ----------
// LIST
router.get('/users', requirePermission('admin.users.view'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.id, u.email, u.full_name, u.display_name, u.initials, u.avatar_colour,
              u.employment_status, u.must_change_password, u.last_login_at, u.created_at,
              u.hire_date, u.monthly_salary, u.salary_currency, u.employment_type,
              u.work_pattern, u.probation_end_date, u.notice_period_days, u.emergency_contact,
              (SELECT json_agg(json_build_object('id', d.id, 'slug', d.slug, 'name', d.name,
                                                  'role', m.role, 'is_primary', m.is_primary))
                 FROM user_department_memberships m
                 JOIN departments d ON d.id = m.department_id
                 WHERE m.user_id = u.id AND m.deleted_at IS NULL AND d.deleted_at IS NULL) AS departments,
              (SELECT json_agg(json_build_object('id', g.id, 'slug', g.slug, 'name', g.name))
                 FROM user_groups ug
                 JOIN groups g ON g.id = ug.group_id
                 WHERE ug.user_id = u.id AND g.deleted_at IS NULL) AS groups
       FROM users u
       WHERE u.deleted_at IS NULL
       ORDER BY u.full_name`
    );
    res.json({ users: r.rows });
  } catch (err) {
    console.error('[admin/users] error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// CREATE
router.post('/users', requirePermission('admin.users.create'), async (req, res) => {
  const { email, full_name, display_name, primary_department_slug, group_slugs, password } = req.body || {};
  if (!email || !full_name) return res.status(400).json({ error: 'Email and full name required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });

  try {
    // Check duplicate
    const dup = await db.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email.trim()]);
    if (dup.rows.length > 0) return res.status(409).json({ error: 'A user with that email already exists' });

    // Compute defaults
    const firstName = full_name.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    const seedPwd = password || (firstName + '001');
    const hash = await bcrypt.hash(seedPwd, 10);
    const dn = display_name || full_name.split(/\s+/)[0];
    const initials = full_name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const avatarColour = pickAvatarColour(initials);
    const empId = await nextEmpId();

    const u = await db.query(
      `INSERT INTO users (email, password_hash, full_name, display_name, initials, avatar_colour, emp_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *`,
      [email.trim().toLowerCase(), hash, full_name.trim(), dn, initials, avatarColour, empId]
    );
    const newUser = u.rows[0];

    // Department
    if (primary_department_slug) {
      const d = await db.query(`SELECT id FROM departments WHERE slug = $1`, [primary_department_slug]);
      if (d.rows.length > 0) {
        await db.query(
          `INSERT INTO user_department_memberships (user_id, department_id, role, is_primary)
           VALUES ($1, $2, 'agent', TRUE)`,
          [newUser.id, d.rows[0].id]
        );
      }
    }

    // Groups — always include employee-base
    const slugs = Array.isArray(group_slugs) ? group_slugs : [];
    if (!slugs.includes('employee-base')) slugs.push('employee-base');
    for (const slug of slugs) {
      const g = await db.query(`SELECT id FROM groups WHERE slug = $1 AND deleted_at IS NULL`, [slug]);
      if (g.rows.length > 0) {
        await db.query(
          `INSERT INTO user_groups (user_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [newUser.id, g.rows[0].id]
        );
      }
    }

    // Initial user_status row
    await db.query(
      `INSERT INTO user_status (user_id, status) VALUES ($1, 'offline')
       ON CONFLICT (user_id) DO NOTHING`,
      [newUser.id]
    );

    // Initial leave balance for current year.
    // New hires start at 0 — the accrual engine (leave-engine.js) credits
    // 1 day/month for the first 6 months, 1.5/month after, on each monthly
    // anniversary of their hire date. Granting a flat figure here would
    // double-count on top of accrual.
    const year = new Date().getFullYear();
    await db.query(
      `INSERT INTO leave_balances (user_id, year, entitled_days) VALUES ($1,$2,0)
       ON CONFLICT (user_id, year) DO NOTHING`,
      [newUser.id, year]
    );

    // Auto-apply the India onboarding checklist to the new joiner.
    try { await applyOnboardingTemplate(newUser.id, req.user.id); } catch (e) { console.error('[onboarding template]', e.message); }

    // Auto-add to channels: All-hands + their primary department channel
    const allHands = await db.query(`SELECT id FROM chat_channels WHERE type = 'all_hands' LIMIT 1`);
    if (allHands.rows.length > 0) {
      await db.query(
        `INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [allHands.rows[0].id, newUser.id]
      );
    }
    if (primary_department_slug) {
      const dch = await db.query(
        `SELECT c.id FROM chat_channels c
         JOIN departments d ON d.id = c.department_id
         WHERE d.slug = $1 AND c.type = 'department' LIMIT 1`,
        [primary_department_slug]
      );
      if (dch.rows.length > 0) {
        await db.query(
          `INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [dch.rows[0].id, newUser.id]
        );
      }
    }

    // If created in owner / company-manager groups, auto-add to ALL dept channels
    if (slugs.includes('owner') || slugs.includes('company-manager')) {
      await db.query(
        `INSERT INTO chat_channel_members (channel_id, user_id)
         SELECT c.id, $1 FROM chat_channels c WHERE c.type = 'department'
         ON CONFLICT DO NOTHING`,
        [newUser.id]
      );
    }

    // Welcome notification
    await notifyEvent('system.welcome', { targetUserId: newUser.id });

    // Onboarding checklist is applied above via the India template
    // (applyOnboardingTemplate). The old onboarding_templates DB seed is
    // retired — it duplicated the India items (ID/address/bank/emergency).

    // r0.10 — If hire_date was set during creation, also generate review schedule.
    // (Most of the time hire_date is filled in later via the Employment tab —
    // in that case the backfill button generates the schedule.)
    if (newUser.hire_date) {
      const schedRes = await lifecycle.generateReviewSchedule(newUser.id);
      if (schedRes.reviewerUserId && schedRes.created > 0) {
        await notifyEvent('schedule.generated', {
          targetUserId: schedRes.reviewerUserId,
          taskCount: schedRes.created,
        });
      }
    }

    await logAudit({
      req, module: 'admin', action: 'user.created',
      target_type: 'user', target_id: newUser.id,
      after: { email: newUser.email, full_name: newUser.full_name, primary_department: primary_department_slug }
    });

    res.json({
      ok: true,
      user: { id: newUser.id, email: newUser.email, full_name: newUser.full_name, display_name: newUser.display_name },
      initial_password: seedPwd, // shown ONCE to admin so they can pass it on
    });
  } catch (err) {
    console.error('[admin/users.create] error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// UPDATE basic fields
router.patch('/users/:id', requirePermission('admin.users.edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const { full_name, display_name, employment_status } = req.body || {};

  try {
    const cur = await db.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const updates = [];
    const params = [];
    let p = 1;
    if (full_name !== undefined) { updates.push(`full_name = $${p++}`); params.push(full_name); }
    if (display_name !== undefined) { updates.push(`display_name = $${p++}`); params.push(display_name); }
    if (employment_status !== undefined) {
      if (!['active','on_leave','left'].includes(employment_status)) {
        return res.status(400).json({ error: 'Bad employment_status' });
      }
      updates.push(`employment_status = $${p++}`); params.push(employment_status);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(id);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${p}`, params);

    // r0.10 — If employment_status just flipped to 'left', cancel open tasks + stamp left_date
    if (employment_status === 'left' && cur.rows[0].employment_status !== 'left') {
      await db.query(`UPDATE users SET left_date = CURRENT_DATE WHERE id = $1 AND left_date IS NULL`, [id]);
      const cancelled = await lifecycle.cancelTasksForUser(id, 'user_left');
      console.log(`[admin] user ${id} marked left — cancelled ${cancelled} open task(s)`);
    }

    await logAudit({
      req, module: 'admin', action: 'user.updated', target_type: 'user', target_id: id,
      before: cur.rows[0], after: req.body
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/users.patch] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// RESET PASSWORD
router.post('/users/:id/reset-password', requirePermission('admin.users.reset_password'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const u = await db.query(`SELECT email, full_name FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const firstName = u.rows[0].full_name.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    const newPwd = firstName + '001';
    const hash = await bcrypt.hash(newPwd, 10);
    await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2`,
      [hash, id]
    );
    await db.query(`DELETE FROM user_sessions WHERE user_id = $1`, [id]);
    await logAudit({ req, module: 'admin', action: 'user.password_reset', target_type: 'user', target_id: id });
    res.json({ ok: true, initial_password: newPwd });
  } catch (err) {
    console.error('[admin/users.reset_password] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// DEPARTMENT MEMBERSHIPS
router.put('/users/:id/departments', requirePermission('admin.users.edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { memberships } = req.body || {};
  if (!Array.isArray(memberships)) return res.status(400).json({ error: 'memberships array required' });

  try {
    // Validate
    for (const m of memberships) {
      if (!m.department_slug) return res.status(400).json({ error: 'Each membership needs department_slug' });
      if (m.role && !['agent','senior','lead','manager'].includes(m.role)) return res.status(400).json({ error: 'Bad role' });
    }

    // Soft-delete existing
    await db.query(
      `UPDATE user_department_memberships SET deleted_at = NOW()
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [id]
    );

    for (const m of memberships) {
      const d = await db.query(`SELECT id FROM departments WHERE slug = $1`, [m.department_slug]);
      if (d.rows.length === 0) continue;
      await db.query(
        `INSERT INTO user_department_memberships (user_id, department_id, role, is_primary)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, department_id)
         DO UPDATE SET role = EXCLUDED.role, is_primary = EXCLUDED.is_primary, deleted_at = NULL`,
        [id, d.rows[0].id, m.role || 'agent', !!m.is_primary]
      );

      // Make sure they're in the dept channel
      const dch = await db.query(
        `SELECT id FROM chat_channels WHERE department_id = $1 AND type = 'department' LIMIT 1`,
        [d.rows[0].id]
      );
      if (dch.rows.length > 0) {
        await db.query(
          `INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [dch.rows[0].id, id]
        );
      }
    }

    await logAudit({ req, module: 'admin', action: 'user.departments_updated', target_type: 'user', target_id: id, after: { memberships } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/users.departments] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// GROUP MEMBERSHIPS
router.put('/users/:id/groups', requirePermission('admin.groups.edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { group_slugs } = req.body || {};
  if (!Array.isArray(group_slugs)) return res.status(400).json({ error: 'group_slugs array required' });

  try {
    // Ensure employee-base is always present
    const slugs = [...new Set([...group_slugs, 'employee-base'])];

    // Look up group IDs
    const g = await db.query(`SELECT id, slug FROM groups WHERE slug = ANY($1::text[]) AND deleted_at IS NULL`, [slugs]);
    const validIds = g.rows.map(x => x.id);

    // Replace existing
    await db.query(`DELETE FROM user_groups WHERE user_id = $1`, [id]);
    for (const gid of validIds) {
      await db.query(
        `INSERT INTO user_groups (user_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, gid]
      );
    }

    // If the user is now in owner or company-manager, auto-join them to every dept channel.
    const isCompanyWide = slugs.includes('owner') || slugs.includes('company-manager');
    if (isCompanyWide) {
      await db.query(
        `INSERT INTO chat_channel_members (channel_id, user_id)
         SELECT c.id, $1 FROM chat_channels c WHERE c.type = 'department'
         ON CONFLICT DO NOTHING`,
        [id]
      );
    }

    await logAudit({ req, module: 'admin', action: 'user.groups_updated', target_type: 'user', target_id: id, after: { group_slugs: slugs } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/users.groups] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// SOFT DELETE USER
router.delete('/users/:id', requirePermission('admin.users.delete'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    const u = await db.query(`SELECT id, full_name FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await db.query(
      `UPDATE users SET deleted_at = NOW(), employment_status = 'left' WHERE id = $1`,
      [id]
    );
    await db.query(`DELETE FROM user_sessions WHERE user_id = $1`, [id]);
    await logAudit({ req, module: 'admin', action: 'user.deleted', target_type: 'user', target_id: id, before: u.rows[0] });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/users.delete] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GROUPS ----------
router.get('/groups', requirePermission('admin.groups.view'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT g.id, g.slug, g.name, g.description, g.is_system, g.created_at,
              (SELECT COUNT(*)::int FROM user_groups ug WHERE ug.group_id = g.id) AS member_count,
              (SELECT json_agg(p.slug ORDER BY p.slug)
                 FROM group_permissions gp
                 JOIN permissions p ON p.id = gp.permission_id
                 WHERE gp.group_id = g.id) AS permissions
       FROM groups g
       WHERE g.deleted_at IS NULL
       ORDER BY g.is_system DESC, g.name`
    );
    res.json({ groups: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/permissions', requirePermission('admin.permissions.view'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT slug, module, description FROM permissions ORDER BY module, slug`
    );
    res.json({ permissions: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- AUDIT LOG ----------
router.get('/audit', requirePermission('admin.audit.view'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const moduleFilter = req.query.module || null;
  const actorFilter = req.query.actor ? parseInt(req.query.actor, 10) : null;

  try {
    const conds = [];
    const params = [];
    let p = 1;
    if (moduleFilter) { conds.push(`module = $${p++}`); params.push(moduleFilter); }
    if (actorFilter) { conds.push(`actor_user_id = $${p++}`); params.push(actorFilter); }
    const where = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';
    params.push(limit); const limP = p++;
    params.push(offset); const offP = p++;

    const r = await db.query(
      `SELECT id, occurred_at, actor_user_id, actor_name, module, action,
              target_type, target_id, details, ip_address
       FROM audit_log ${where}
       ORDER BY occurred_at DESC
       LIMIT $${limP} OFFSET $${offP}`,
      params
    );
    res.json({ entries: r.rows });
  } catch (err) {
    console.error('[admin/audit] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- TEAM BREAK ----------
router.get('/break', requirePermission('admin.break.edit'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT break_start_time::text AS start_time, duration_minutes, timezone, active FROM team_break_schedule WHERE scope = 'company'`
    );
    res.json({ break: r.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/break', requirePermission('admin.break.edit'), async (req, res) => {
  const { start_time, duration_minutes, timezone, active } = req.body || {};
  if (!start_time || !/^\d{2}:\d{2}(:\d{2})?$/.test(start_time)) return res.status(400).json({ error: 'Bad start_time' });
  if (!duration_minutes || duration_minutes < 1 || duration_minutes > 240) return res.status(400).json({ error: 'Bad duration' });
  try {
    await db.query(
      `UPDATE team_break_schedule
       SET break_start_time = $1, duration_minutes = $2, timezone = COALESCE($3, timezone),
           active = COALESCE($4, active), updated_by_user_id = $5, updated_at = NOW()
       WHERE scope = 'company'`,
      [start_time, duration_minutes, timezone || null, active === undefined ? null : active, req.user.id]
    );
    await logAudit({ req, module: 'admin', action: 'team_break.updated', after: req.body });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================================
// r0.7 — Employment fields, leave admin, daily report review
// ============================================================

// PUT /api/admin/users/:id/employment — update employment fields for one user
router.put('/users/:id/employment', requirePermission('admin.employment.edit'), async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid id' });
  const {
    hire_date, monthly_salary, salary_currency, employment_type,
    work_pattern, probation_end_date, notice_period_days, emergency_contact
  } = req.body || {};
  try {
    // Defaults: probation_end_date = hire_date + 6 months if not provided
    let probEnd = probation_end_date;
    if (!probEnd && hire_date) {
      const d = new Date(hire_date + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + 6);
      probEnd = d.toISOString().slice(0, 10);
    }
    const before = await db.query(
      `SELECT hire_date, monthly_salary, salary_currency, employment_type, work_pattern,
              probation_end_date, probation_status, notice_period_days, emergency_contact
         FROM users WHERE id = $1`,
      [userId]
    );
    const wasHireDate = before.rows[0] ? before.rows[0].hire_date : null;

    // r0.10 — If hire_date is being set for the first time, also set probation_status
    let probStatusUpdate = null;
    if (hire_date && !wasHireDate) {
      probStatusUpdate = 'in_probation';
    }

    await db.query(
      `UPDATE users SET
         hire_date = COALESCE($1, hire_date),
         monthly_salary = COALESCE($2, monthly_salary),
         salary_currency = COALESCE($3, salary_currency),
         employment_type = COALESCE($4, employment_type),
         work_pattern = COALESCE($5, work_pattern),
         probation_end_date = COALESCE($6, probation_end_date),
         probation_status = COALESCE($10, probation_status),
         notice_period_days = COALESCE($7, notice_period_days),
         emergency_contact = COALESCE($8, emergency_contact),
         updated_at = NOW()
       WHERE id = $9`,
      [hire_date || null, monthly_salary != null ? monthly_salary : null,
       salary_currency || null, employment_type || null, work_pattern || null,
       probEnd || null, notice_period_days != null ? notice_period_days : null,
       emergency_contact != null ? emergency_contact : null, userId,
       probStatusUpdate]
    );
    await logAudit({ req, module: 'admin', action: 'employment.updated',
                     target_type: 'user', target_id: userId,
                     before: before.rows[0], after: req.body });

    // r0.10 — If hire_date was just set (or changed), auto-generate review schedule
    let scheduleResult = null;
    if (hire_date && (!wasHireDate || wasHireDate.toString() !== hire_date)) {
      scheduleResult = await lifecycle.generateReviewSchedule(userId);
      if (scheduleResult && scheduleResult.reviewerUserId && scheduleResult.created > 0) {
        await notifyEvent('schedule.generated', {
          targetUserId: scheduleResult.reviewerUserId,
          taskCount: scheduleResult.created,
        });
      }
    }

    res.json({ ok: true, schedule: scheduleResult });
  } catch (err) {
    console.error('[admin/employment] error:', err.message);
    res.status(500).json({ error: 'Failed to update employment' });
  }
});

// POST /api/admin/users/bulk-employment — bulk update employment fields
// Body: { updates: [{id, hire_date, monthly_salary, ...}, ...] }
router.post('/users/bulk-employment', requirePermission('admin.employment.edit'), async (req, res) => {
  const { updates } = req.body || {};
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates must be an array' });
  if (updates.length === 0) return res.json({ ok: true, updated: 0 });
  if (updates.length > 200) return res.status(400).json({ error: 'Too many updates (max 200)' });
  let updated = 0;
  let errors = [];
  for (const u of updates) {
    if (!u.id) continue;
    try {
      let probEnd = u.probation_end_date;
      if (!probEnd && u.hire_date) {
        const d = new Date(u.hire_date + 'T00:00:00Z');
        d.setUTCMonth(d.getUTCMonth() + 6);
        probEnd = d.toISOString().slice(0, 10);
      }
      await db.query(
        `UPDATE users SET
           hire_date = COALESCE($1, hire_date),
           monthly_salary = COALESCE($2, monthly_salary),
           salary_currency = COALESCE($3, salary_currency),
           employment_type = COALESCE($4, employment_type),
           work_pattern = COALESCE($5, work_pattern),
           probation_end_date = COALESCE($6, probation_end_date),
           notice_period_days = COALESCE($7, notice_period_days),
           emergency_contact = COALESCE($8, emergency_contact),
           last_working_day = COALESCE($9, last_working_day),
           updated_at = NOW()
         WHERE id = $10 AND deleted_at IS NULL`,
        [u.hire_date || null,
         (u.monthly_salary != null && u.monthly_salary !== '') ? u.monthly_salary : null,
         u.salary_currency || null, u.employment_type || null, u.work_pattern || null,
         probEnd || null,
         (u.notice_period_days != null && u.notice_period_days !== '') ? u.notice_period_days : null,
         u.emergency_contact || null,
         u.last_working_day || null, u.id]
      );
      updated++;
    } catch (err) {
      errors.push({ id: u.id, error: err.message });
    }
  }
  await logAudit({ req, module: 'admin', action: 'employment.bulk_updated',
                   after: { updated, errors_count: errors.length } });
  res.json({ ok: true, updated, errors });
});

// POST /api/admin/leaves/adjust — set a manual adjustment on a user's balance
router.post('/leaves/adjust', requirePermission('admin.leaves.adjust'), async (req, res) => {
  const { user_id, delta, note } = req.body || {};
  const uid = parseInt(user_id, 10);
  const d = parseFloat(delta);
  if (!Number.isFinite(uid)) return res.status(400).json({ error: 'user_id required' });
  if (!Number.isFinite(d)) return res.status(400).json({ error: 'delta must be a number' });
  try {
    const result = await leaveEngine.adjustBalance(uid, d, note, req.user.id);
    if (!result.ok) return res.status(400).json(result);
    await logAudit({ req, module: 'admin', action: 'leaves.adjusted',
                     target_type: 'user', target_id: uid,
                     after: { delta: d, note } });
    res.json(result);
  } catch (err) {
    console.error('[admin/leaves/adjust] error:', err.message);
    res.status(500).json({ error: 'Failed to adjust' });
  }
});

// POST /api/admin/leaves/recompute — recompute balance from hire_date for one or all users
//   Body: { user_id?: number, all?: boolean }
router.post('/leaves/recompute', requirePermission('admin.leaves.adjust'), async (req, res) => {
  const { user_id, all } = req.body || {};
  try {
    if (all) {
      const u = await db.query(
        `SELECT id FROM users
          WHERE deleted_at IS NULL
            AND employment_status = 'active'
            AND hire_date IS NOT NULL`
      );
      const results = [];
      for (const row of u.rows) {
        results.push(await leaveEngine.recomputeBalanceFor(row.id, { actorUserId: req.user.id, note: 'Bulk recompute by admin' }));
      }
      await logAudit({ req, module: 'admin', action: 'leaves.recompute_all',
                       after: { count: results.length } });
      return res.json({ ok: true, count: results.length, results });
    }
    const uid = parseInt(user_id, 10);
    if (!Number.isFinite(uid)) return res.status(400).json({ error: 'user_id or all required' });
    const result = await leaveEngine.recomputeBalanceFor(uid, { actorUserId: req.user.id });
    if (!result.ok) return res.status(400).json(result);
    await logAudit({ req, module: 'admin', action: 'leaves.recompute_one',
                     target_type: 'user', target_id: uid, after: result });
    res.json(result);
  } catch (err) {
    console.error('[admin/leaves/recompute] error:', err.message);
    res.status(500).json({ error: 'Failed to recompute' });
  }
});

// GET /api/admin/leaves/accrual-log — recent accrual events for a user (or all)
router.get('/leaves/accrual-log', requirePermission('admin.leaves.adjust'), async (req, res) => {
  try {
    const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const params = [];
    let sql = `SELECT l.*, u.full_name AS user_name, u.display_name,
                      a.full_name AS actor_name
                 FROM leave_accrual_log l
                 JOIN users u ON u.id = l.user_id
                 LEFT JOIN users a ON a.id = l.actor_user_id
                WHERE 1=1`;
    if (userId) { sql += ` AND l.user_id = $1`; params.push(userId); }
    sql += ` ORDER BY l.created_at DESC LIMIT ${limit}`;
    const r = await db.query(sql, params);
    res.json({ events: r.rows });
  } catch (err) {
    console.error('[admin/leaves/accrual-log] error:', err.message);
    res.status(500).json({ error: 'Failed to load' });
  }
});

// GET /api/admin/payroll/week?week_start=YYYY-MM-DD
// Returns per-user weekly summary: qualifying days, weekend pay status, monthly salary.
router.get('/payroll/week', requirePermission('admin.payroll.view'), async (req, res) => {
  try {
    const weekStart = req.query.week_start;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: 'week_start (YYYY-MM-DD) required' });
    }
    const monday = new Date(weekStart + 'T00:00:00Z');
    if (monday.getUTCDay() !== 1) {
      return res.status(400).json({ error: 'week_start must be a Monday' });
    }
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const saturday = new Date(monday);
    saturday.setUTCDate(saturday.getUTCDate() + 5);
    const monStr = monday.toISOString().slice(0, 10);
    const sunStr = sunday.toISOString().slice(0, 10);
    const satStr = saturday.toISOString().slice(0, 10);

    const users = await db.query(
      `SELECT id, full_name, display_name, monthly_salary, salary_currency
         FROM users
        WHERE deleted_at IS NULL AND employment_status = 'active'
        ORDER BY full_name`
    );
    const rows = [];
    for (const u of users.rows) {
      const dayRows = await db.query(
        `SELECT for_date, status, weekend_pay_status, is_paid, sick_notified_hours
           FROM attendance_day
          WHERE user_id = $1 AND for_date BETWEEN $2 AND $3
          ORDER BY for_date`,
        [u.id, monStr, sunStr]
      );
      const qualifying = dayRows.rows.filter(r =>
        ['on_time','late','very_late','worked_voluntary','off_holiday'].includes(r.status)
        || r.status === 'on_leave'
        || (r.status === 'off_sick' && Number(r.sick_notified_hours || 0) >= 4)
      ).length;
      const sat = dayRows.rows.find(r => String(r.for_date).slice(0,10) === satStr);
      const sun = dayRows.rows.find(r => String(r.for_date).slice(0,10) === sunStr);
      rows.push({
        user_id: u.id,
        full_name: u.full_name,
        display_name: u.display_name,
        monthly_salary: u.monthly_salary != null ? Number(u.monthly_salary) : null,
        salary_currency: u.salary_currency,
        qualifying_days: qualifying,
        weekend_paid: qualifying >= 5,
        saturday_status: sat?.weekend_pay_status || 'pending',
        sunday_status: sun?.weekend_pay_status || 'pending',
        days: dayRows.rows,
      });
    }
    res.json({ week_start: monStr, week_end: sunStr, rows });
  } catch (err) {
    console.error('[admin/payroll/week] error:', err.message);
    res.status(500).json({ error: 'Failed to load payroll' });
  }
});

// GET /api/admin/reports/pending — daily reports awaiting review (last 30 days)
// Permission: daily_report.review.dept (own dept only) or daily_report.review.any (all)
router.get('/reports/pending', async (req, res) => {
  const canAny = req.user.can('daily_report.review.any');
  const canDept = req.user.can('daily_report.review.dept');
  if (!canAny && !canDept) return res.status(403).json({ error: 'Permission denied' });

  // r0.19.1 — optional ?user_id= filters to one person; ?days= widens the
  // window (default 30; default 365 when a person is picked, so managers see
  // real history not just the review queue). Permission logic is UNCHANGED:
  // canAny still sees everyone, canDept still constrained to managed-dept users
  // via the same subquery — user_id only narrows further, never widens.
  const filterUserId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  let days = parseInt(req.query.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > 1825) days = filterUserId ? 365 : 30;

  try {
    const cols = `dr.id, dr.user_id, dr.for_date, dr.notes, dr.auto_submitted, dr.submitted_at,
                    dr.snapshot_first_login, dr.snapshot_last_logout,
                    dr.snapshot_active_min, dr.snapshot_idle_min, dr.snapshot_break_min,
                    dr.created_at, dr.updated_at,
                    u.full_name, u.display_name, u.initials, u.avatar_colour,
                    rev.decision, rev.comment, rev.reviewed_at,
                    revu.full_name AS reviewer_name,
                    (SELECT d.name FROM user_department_memberships m JOIN departments d ON d.id = m.department_id
                     WHERE m.user_id = u.id AND m.is_primary = TRUE AND m.deleted_at IS NULL LIMIT 1) AS dept_name`;
    const joins = `FROM daily_reports dr
               JOIN users u ON u.id = dr.user_id
          LEFT JOIN daily_report_reviews rev ON rev.report_id = dr.id
          LEFT JOIN users revu ON revu.id = rev.reviewer_id`;

    let sql, params;
    if (canAny) {
      params = [days];
      let where = `WHERE dr.for_date >= CURRENT_DATE - ($1 || ' days')::interval`;
      if (filterUserId) { params.push(filterUserId); where += ` AND dr.user_id = $${params.length}`; }
      sql = `SELECT ${cols} ${joins} ${where} ORDER BY dr.for_date DESC, u.full_name`;
    } else {
      // Dept-scoped — get caller's managed depts
      params = [req.user.id, days];
      let where = `WHERE dr.for_date >= CURRENT_DATE - ($2 || ' days')::interval
                AND u.id IN (
                  SELECT m2.user_id FROM user_department_memberships m2
                  WHERE m2.deleted_at IS NULL
                    AND m2.department_id IN (
                      SELECT m1.department_id FROM user_department_memberships m1
                      WHERE m1.user_id = $1 AND m1.deleted_at IS NULL
                        AND m1.role IN ('manager','lead')
                    )
                )`;
      if (filterUserId) { params.push(filterUserId); where += ` AND dr.user_id = $${params.length}`; }
      sql = `SELECT ${cols} ${joins} ${where} ORDER BY dr.for_date DESC, u.full_name`;
    }
    const r = await db.query(sql, params);
    res.json({ reports: r.rows });
  } catch (err) {
    console.error('[admin/reports/pending] error:', err.message);
    res.status(500).json({ error: 'Failed to load' });
  }
});

// POST /api/admin/reports/:id/review — submit a review decision
router.post('/reports/:id/review', async (req, res) => {
  const canAny = req.user.can('daily_report.review.any');
  const canDept = req.user.can('daily_report.review.dept');
  if (!canAny && !canDept) return res.status(403).json({ error: 'Permission denied' });

  const id = parseInt(req.params.id, 10);
  const { decision, comment } = req.body || {};
  if (!['not_satisfactory','satisfactory','good'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be not_satisfactory, satisfactory, or good' });
  }
  if (decision === 'not_satisfactory' && (!comment || comment.trim().length < 3)) {
    return res.status(400).json({ error: 'A comment is required when marking Not satisfactory' });
  }
  try {
    const rep = await db.query(
      `SELECT dr.id, dr.user_id, dr.for_date, u.display_name, u.full_name
         FROM daily_reports dr JOIN users u ON u.id = dr.user_id
        WHERE dr.id = $1`, [id]
    );
    if (rep.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    const report = rep.rows[0];

    // Dept-scope check
    if (!canAny) {
      const overlap = await db.query(
        `SELECT 1 FROM user_department_memberships m1
           JOIN user_department_memberships m2 ON m1.department_id = m2.department_id
          WHERE m1.user_id = $1 AND m1.role IN ('manager','lead') AND m1.deleted_at IS NULL
            AND m2.user_id = $2 AND m2.deleted_at IS NULL
          LIMIT 1`,
        [req.user.id, report.user_id]
      );
      if (overlap.rows.length === 0) {
        return res.status(403).json({ error: 'Not in your managed department' });
      }
    }

    // Upsert review
    await db.query(
      `INSERT INTO daily_report_reviews (report_id, reviewer_id, decision, comment)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (report_id) DO UPDATE
         SET reviewer_id = EXCLUDED.reviewer_id,
             decision    = EXCLUDED.decision,
             comment     = EXCLUDED.comment,
             reviewed_at = NOW()`,
      [id, req.user.id, decision, comment || null]
    );

    await logAudit({ req, module: 'attendance', action: 'report.reviewed',
                     target_type: 'daily_report', target_id: id,
                     after: { decision, comment } });

    // Notify on not_satisfactory: agent + HR
    if (decision === 'not_satisfactory') {
      const reviewer = req.user.display_name || req.user.full_name;
      const forDateStr = String(report.for_date).slice(0, 10);
      const trimmedComment = comment ? String(comment).slice(0, 140) : null;
      await notifyEvent('report.flagged.agent', {
        targetUserId: report.user_id,
        forDate: forDateStr,
        comment: trimmedComment,
        related_id: id,
      });
      // HR team
      const hr = await db.query(
        `SELECT ug.user_id FROM user_groups ug
           JOIN groups g ON g.id = ug.group_id
          WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL`
      );
      const hrIds = hr.rows.map(x => x.user_id).filter(x => x !== req.user.id);
      if (hrIds.length > 0) {
        await notifyEvent('report.flagged.hr', {
          targetUserId: report.user_id,
          targetName: report.display_name || report.full_name,
          reviewerName: reviewer,
          forDate: forDateStr,
          comment: trimmedComment,
          hrUserIds: hrIds,
          related_id: id,
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/reports/review] error:', err.message);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// ============================================================================
// r0.8 — BACKUPS (owner-only)
// ============================================================================
// All four endpoints gated by 'admin.backup.manage'. Only the owner group
// has this permission by default. Backup operations are security-sensitive
// so we keep them strictly to the founder.

// GET /api/admin/backups — list recent backup runs
router.get('/backups', requirePermission('admin.backup.manage'), async (req, res) => {
  try {
    const rows = await backupEngine.listBackups(60);
    res.json({ backups: rows, diag: backupEngine.diagnose() });
  } catch (err) {
    console.error('[admin/backups] error:', err.message);
    res.status(500).json({ error: 'Failed to load backups' });
  }
});

// GET /api/admin/backups/health — health summary for home page pill
router.get('/backups/health', requirePermission('admin.backup.manage'), async (req, res) => {
  try {
    const h = await backupEngine.getHealth();
    res.json(h);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/admin/backups/run — trigger a manual backup
router.post('/backups/run', requirePermission('admin.backup.manage'), async (req, res) => {
  try {
    await logAudit({
      req, module: 'backup', action: 'manual_run',
      target_type: 'system', details: 'Manual backup triggered',
    });
    // Run async — return the new log row id straight away so UI can poll.
    const startRow = await db.query(
      `SELECT id FROM backup_log ORDER BY started_at DESC LIMIT 1`
    );
    // Fire-and-forget: runBackup logs its own row.
    backupEngine.runBackup({ trigger: 'manual', actorUserId: req.user.id })
      .then(r => console.log('[admin/backups/run] result:', r.ok ? 'ok' : 'failed:' + r.error))
      .catch(e => console.error('[admin/backups/run] threw:', e.message));
    res.json({ ok: true, message: 'Backup started. Refresh in a moment to see the result.' });
  } catch (err) {
    console.error('[admin/backups/run] error:', err.message);
    res.status(500).json({ error: 'Failed to start backup' });
  }
});

// GET /api/admin/backups/download-latest — stream the most recent backup
router.get('/backups/download-latest', requirePermission('admin.backup.manage'), async (req, res) => {
  await logAudit({
    req, module: 'backup', action: 'download_latest',
    target_type: 'system', details: 'Latest backup downloaded',
  });
  await backupEngine.streamLatestBackup(res);
});

// ---------- helpers ----------
const AVATAR_COLOURS = [
  '#FAC775', '#F4C0D1', '#C0DD97', '#CECBF6', '#F5C4B3',
  '#B5D4F4', '#FDE6A0', '#D8BFD8', '#FFD1A1', '#B6E0DA'
];
function pickAvatarColour(initials) {
  let h = 0;
  for (let i = 0; i < initials.length; i++) h = (h << 5) - h + initials.charCodeAt(i);
  return AVATAR_COLOURS[Math.abs(h) % AVATAR_COLOURS.length];
}

// ============================================================================
// r0.10 — Onboarding templates (company-wide checklist)
// ============================================================================

router.get('/onboarding-templates', requirePermission('admin.onboarding_templates.edit'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, title, body, sort_order, is_active, created_at, updated_at
         FROM onboarding_templates ORDER BY sort_order ASC, id ASC`
    );
    res.json({ templates: r.rows });
  } catch (e) {
    console.error('[admin/onboarding-templates] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/onboarding-templates', requirePermission('admin.onboarding_templates.edit'), async (req, res) => {
  const { title, body, sort_order, is_active } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
  try {
    const r = await db.query(
      `INSERT INTO onboarding_templates (title, body, sort_order, is_active)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title.trim().slice(0, 200), body || null,
       Number.isFinite(sort_order) ? sort_order : 100,
       is_active !== false]
    );
    await logAudit({ req, module: 'admin', action: 'onboarding_template.added',
                     target_type: 'onboarding_template', target_id: r.rows[0].id,
                     after: r.rows[0] });
    res.json({ ok: true, template: r.rows[0] });
  } catch (e) {
    console.error('[admin/onboarding-templates.post] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/onboarding-templates/:id', requirePermission('admin.onboarding_templates.edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  const { title, body, sort_order, is_active } = req.body || {};
  try {
    const cur = await db.query(`SELECT * FROM onboarding_templates WHERE id = $1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await db.query(
      `UPDATE onboarding_templates SET
         title = COALESCE($1, title),
         body = $2,
         sort_order = COALESCE($3, sort_order),
         is_active = COALESCE($4, is_active),
         updated_at = NOW()
       WHERE id = $5`,
      [title != null ? String(title).slice(0, 200) : null,
       body != null ? body : cur.rows[0].body,
       Number.isFinite(sort_order) ? sort_order : null,
       typeof is_active === 'boolean' ? is_active : null,
       id]
    );
    await logAudit({ req, module: 'admin', action: 'onboarding_template.updated',
                     target_type: 'onboarding_template', target_id: id,
                     before: cur.rows[0], after: req.body });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/onboarding-templates.patch] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

router.delete('/onboarding-templates/:id', requirePermission('admin.onboarding_templates.edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const r = await db.query(`DELETE FROM onboarding_templates WHERE id = $1 RETURNING title`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await logAudit({ req, module: 'admin', action: 'onboarding_template.deleted',
                     target_type: 'onboarding_template', target_id: id,
                     before: r.rows[0] });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/onboarding-templates.delete] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================================================
// r0.10 — Settings
// ============================================================================

router.get('/settings', requirePermission('admin.settings.edit'), async (req, res) => {
  try {
    const r = await db.query(`SELECT key, value, description, updated_at FROM settings ORDER BY key`);
    res.json({ settings: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/settings/:key', requirePermission('admin.settings.edit'), async (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};
  if (value == null) return res.status(400).json({ error: 'value required' });
  try {
    const cur = await db.query(`SELECT value FROM settings WHERE key = $1`, [key]);
    await db.query(
      `INSERT INTO settings (key, value, updated_by_user_id, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = NOW()`,
      [key, JSON.stringify(value), req.user.id]
    );
    lifecycle.invalidateSettings();
    await logAudit({ req, module: 'admin', action: 'setting.updated',
                     target_type: 'setting', target_id: key,
                     before: cur.rows[0] || null, after: { value } });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/settings.put] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================================================
// r0.10 — Backfill: generate review schedules for all active users with hire_date
// ============================================================================
// r0.15.3 — DISABLED. The bulk backfill generated phantom-overdue reviews and
// pre-onboarding items for staff who've been here for years, cluttering
// Insights. Per Bobby, HR adds review schedules manually per-person now.
// Per-user generation still works via the user-edit flow in admin.js.

router.post('/backfill/review-schedules', requirePermission('admin.backfill.run'), async (req, res) => {
  return res.status(410).json({
    error: 'Bulk backfill is disabled.',
    detail: 'Phantom-overdue records cluttered Insights. Add reviews per-person via the user profile instead.'
  });
});

// ============================================================================
// r0.11 — HR insights
// ============================================================================
// One endpoint that returns three lists for the HR Insights page:
//   * probation       — users in probation states (in_probation / pass_expected
//                       / extended / failed) with their probation_end_date
//   * overdue_tasks   — all currently-overdue tasks across the company
//   * onboarding      — active users with onboarding progress (only those with
//                       any onboarding items)
// Permission: profile.view.any (HR + owner)
router.get('/insights', async (req, res) => {
  if (!(req.user.can('profile.view.any') || req.user.can('*'))) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  try {
    // 1. Probation watchlist
    const probation = await db.query(
      `SELECT u.id, u.full_name, u.display_name, u.initials, u.avatar_colour,
              u.hire_date, u.probation_status, u.probation_end_date,
              (CURRENT_DATE - u.probation_end_date) AS days_past_end_date
         FROM users u
        WHERE u.deleted_at IS NULL
          AND u.employment_status = 'active'
          AND u.probation_status IN ('in_probation','probation_pass_expected','extended','failed')
        ORDER BY u.probation_end_date ASC NULLS LAST`
    );

    // 2. Overdue tasks (all assignees)
    const overdue = await db.query(
      `SELECT t.id, t.title, t.kind, t.status, t.opens_at, t.due_at, t.reason,
              t.assignee_user_id,
              au.full_name AS assignee_full_name,
              au.display_name AS assignee_display_name,
              au.initials AS assignee_initials,
              au.avatar_colour AS assignee_avatar_colour,
              t.related_user_id,
              ru.full_name AS related_full_name,
              ru.display_name AS related_display_name,
              (CURRENT_DATE - t.due_at::date) AS days_overdue
         FROM tasks t
    LEFT JOIN users au ON au.id = t.assignee_user_id
    LEFT JOIN users ru ON ru.id = t.related_user_id
        WHERE t.status = 'overdue'
        ORDER BY t.due_at ASC`
    );

    // 3. Onboarding progress — one row per user with onboarding items
    const onboarding = await db.query(
      `SELECT u.id, u.full_name, u.display_name, u.initials, u.avatar_colour,
              u.hire_date, u.probation_status,
              COUNT(n.id)::int AS total_items,
              SUM(CASE WHEN n.is_completed THEN 1 ELSE 0 END)::int AS done_items
         FROM users u
         JOIN profile_notes n ON n.user_id = u.id AND n.kind = 'onboarding'
        WHERE u.deleted_at IS NULL
          AND u.employment_status = 'active'
        GROUP BY u.id
        HAVING COUNT(n.id) > SUM(CASE WHEN n.is_completed THEN 1 ELSE 0 END)
        ORDER BY u.hire_date DESC NULLS LAST`
    );

    res.json({
      probation: probation.rows,
      overdue_tasks: overdue.rows,
      onboarding: onboarding.rows,
    });
  } catch (e) {
    console.error('[admin/insights] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
