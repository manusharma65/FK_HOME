// FK Home — /api/team/*
// GET /api/team/whos-on   — list of teammates with their current status
// Filter rule: same department(s) OR the owner sees everyone.

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/whos-on', async (req, res) => {
  if (!req.user.can('team.presence.view')) return res.status(403).json({ error: 'Permission denied' });

  try {
    const userDeptIds = req.user.departments.map(d => d.id);
    // "Sees everyone" — held by owner, company-manager, and hr-team groups.
    // Specialists/dept-managers see only their own departments.
    const seesEveryone = req.user.can('attendance.view.any');

    let query, params;
    if (seesEveryone) {
      // Owner / Head of Ops / HR sees everyone
      query = `
        SELECT u.id, u.full_name, u.display_name, u.initials, u.avatar_colour,
               s.status, s.status_note, s.status_until, s.last_active_at,
               (SELECT json_agg(json_build_object('slug', d.slug, 'name', d.name, 'role', m.role))
                  FROM user_department_memberships m
                  JOIN departments d ON d.id = m.department_id
                  WHERE m.user_id = u.id AND m.deleted_at IS NULL AND d.deleted_at IS NULL) AS departments,
               (SELECT json_agg(g.slug)
                  FROM user_groups ug JOIN groups g ON g.id = ug.group_id
                  WHERE ug.user_id = u.id AND g.deleted_at IS NULL) AS group_slugs
        FROM users u
        LEFT JOIN user_status s ON s.user_id = u.id
        WHERE u.deleted_at IS NULL AND u.employment_status = 'active' AND u.id <> $1
        ORDER BY u.full_name`;
      params = [req.user.id];
    } else if (userDeptIds.length === 0) {
      return res.json({ people: [] });
    } else {
      query = `
        SELECT u.id, u.full_name, u.display_name, u.initials, u.avatar_colour,
               s.status, s.status_note, s.status_until, s.last_active_at,
               (SELECT json_agg(json_build_object('slug', d.slug, 'name', d.name, 'role', m.role))
                  FROM user_department_memberships m
                  JOIN departments d ON d.id = m.department_id
                  WHERE m.user_id = u.id AND m.deleted_at IS NULL AND d.deleted_at IS NULL) AS departments,
               (SELECT json_agg(g.slug)
                  FROM user_groups ug JOIN groups g ON g.id = ug.group_id
                  WHERE ug.user_id = u.id AND g.deleted_at IS NULL) AS group_slugs
        FROM users u
        LEFT JOIN user_status s ON s.user_id = u.id
        WHERE u.deleted_at IS NULL AND u.employment_status = 'active'
          AND u.id <> $1
          AND EXISTS (
            SELECT 1 FROM user_department_memberships um
            WHERE um.user_id = u.id AND um.deleted_at IS NULL
              AND um.department_id = ANY($2::int[])
          )
        ORDER BY u.full_name`;
      params = [req.user.id, userDeptIds];
    }

    const r = await db.query(query, params);
    const people = r.rows.map(p => ({
      id: p.id,
      name: p.display_name || p.full_name,
      full_name: p.full_name,
      initials: p.initials,
      avatar_colour: p.avatar_colour,
      status: p.status || 'offline',
      status_note: p.status_note,
      status_until: p.status_until,
      departments: p.departments || [],
      role_label: pickRoleLabel(p.departments || [], p.group_slugs || []),
    }));
    res.json({ people });
  } catch (err) {
    console.error('[team/whos-on] error:', err);
    res.status(500).json({ error: 'Failed to load team' });
  }
});

function pickRoleLabel(depts, groupSlugs) {
  const groups = groupSlugs || [];
  // Special titles trump everything
  if (groups.includes('owner')) return 'Founder';
  if (groups.includes('company-manager')) return 'Head of Operations';

  if (!depts || depts.length === 0) {
    if (groups.includes('hr-team')) return 'HR Team';
    return '';
  }
  // Pick top tier across departments: manager → lead → specialist
  const order = { manager: 0, lead: 1, agent: 2 };
  const sorted = [...depts].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
  const top = sorted[0];
  if (top.role === 'manager') return `${top.name} Manager`;
  if (top.role === 'lead') return `${top.name} Executive`;
  return `${top.name} Specialist`;
}

// GET /api/team/search — returns ALL active users for the Find someone modal.
// Available to everyone with team.presence.view (every employee).
// Returns id, name, role label, dept names — enough for searching and DMing.
router.get('/search', async (req, res) => {
  if (!req.user.can('team.presence.view')) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  try {
    const r = await db.query(
      `SELECT u.id, u.full_name, u.display_name, u.initials, u.avatar_colour,
              (SELECT json_agg(json_build_object('slug', d.slug, 'name', d.name, 'role', m.role))
                 FROM user_department_memberships m
                 JOIN departments d ON d.id = m.department_id
                 WHERE m.user_id = u.id AND m.deleted_at IS NULL AND d.deleted_at IS NULL) AS departments,
              (SELECT json_agg(g.slug)
                 FROM user_groups ug JOIN groups g ON g.id = ug.group_id
                 WHERE ug.user_id = u.id AND g.deleted_at IS NULL) AS group_slugs
       FROM users u
       WHERE u.deleted_at IS NULL AND u.employment_status = 'active' AND u.id <> $1
       ORDER BY u.full_name`,
      [req.user.id]
    );
    const people = r.rows.map(u => ({
      id: u.id,
      name: u.display_name || u.full_name,
      initials: u.initials,
      avatar_colour: u.avatar_colour,
      role_label: pickRoleLabel(u.departments || [], u.group_slugs || []),
      departments: u.departments || [],
    }));
    res.json({ people });
  } catch (err) {
    console.error('[team/search] error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
