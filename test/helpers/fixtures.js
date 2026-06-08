// FK Home — test fixtures
const express = require('express');
const { db } = require('../../server/db');

let seq = 0;

// Create a test user. hire is a 'YYYY-MM-DD' string (the real column is hire_date).
async function createUser({ hire = null, status = 'active', name = null, hrArea = null, managerId = null, left = null } = {}) {
  seq++;
  const nm = name || ('Test User ' + seq);
  const email = `test+${Date.now()}_${seq}@fk.test`;
  const r = await db.query(
    `INSERT INTO users (email, password_hash, full_name, display_name, initials, avatar_colour,
        employment_status, hire_date, left_date, hr_area, manager_user_id, must_change_password)
     VALUES ($1,'x',$2,$2,$3,'#888888',$4,$5,$6,$7,$8,FALSE)
     RETURNING *`,
    [email, nm, nm.slice(0, 2).toUpperCase(), status, hire, left, hrArea, managerId]);
  return r.rows[0];
}

async function addToGroup(userId, slug) {
  await db.query(
    `INSERT INTO user_groups (user_id, group_id)
       SELECT $1, id FROM groups WHERE slug = $2 ON CONFLICT DO NOTHING`, [userId, slug]);
}

async function addToDept(userId, deptSlug, role = 'member') {
  await db.query(
    `INSERT INTO user_department_memberships (user_id, department_id, role, is_primary)
       SELECT $1, id, $3, TRUE FROM departments WHERE slug = $2`, [userId, deptSlug, role]);
}

// A fake req.user matching the shape auth.js builds (can / inGroup / etc).
function reqUser(row, { perms = [], groups = [], departments = [] } = {}) {
  const P = new Set(perms);
  return {
    id: row.id, email: row.email, full_name: row.full_name, display_name: row.display_name,
    permissions: P, departments, group_slugs: groups,
    can(s) { return this.permissions.has(s); },
    inGroup(s) { return (this.group_slugs || []).includes(s); },
    inDepartment(slug) { return this.departments.some(d => d.slug === slug); },
    isManagerOf(slug) { return this.departments.some(d => d.slug === slug && (d.role === 'manager' || d.role === 'lead')); },
  };
}

// Build a tiny express app that mounts a real router with an injected identity.
// getUser() is called per request so a test can switch who is acting.
function miniApp(mountPath, router, getUser) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = getUser(); next(); });
  app.use(mountPath, router);
  return app;
}

// Date helper: first day of the month, n months before the current month (UTC),
// as 'YYYY-MM-01'. Using day=01 makes accrual month-counts deterministic.
function monthsAgoFirst(n) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-01`;
}

module.exports = { createUser, addToGroup, addToDept, reqUser, miniApp, monthsAgoFirst };
