// FK Home — auth core
// Session middleware, permission checks (live every request — no caching), audit helper.

const crypto = require('crypto');
const { db } = require('./db');

const SESSION_COOKIE = 'fk_session';
const SESSION_TTL_HOURS = 24 * 14;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function attachUserToRequest(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE] || req.headers['x-fk-token'] || null;
  req.user = null;
  if (!token) return next();

  try {
    const r = await db.query(
      `SELECT s.token, s.user_id, s.expires_at,
              u.email, u.full_name, u.display_name, u.initials, u.avatar_colour,
              u.must_change_password, u.employment_status, u.deleted_at, u.date_of_birth
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    if (r.rows.length === 0) return next();
    const row = r.rows[0];
    if (row.deleted_at || row.employment_status !== 'active') return next();

    const perms = await loadUserPermissions(row.user_id);
    const depts = await loadUserDepartments(row.user_id);
    const groupSlugs = await loadUserGroups(row.user_id);

    req.user = {
      id: row.user_id,
      email: row.email,
      full_name: row.full_name,
      display_name: row.display_name || row.full_name,
      initials: row.initials,
      avatar_colour: row.avatar_colour,
      date_of_birth: row.date_of_birth,
      must_change_password: row.must_change_password,
      token,
      permissions: perms,
      departments: depts,
      group_slugs: groupSlugs,
      can(slug) { return this.permissions.has(slug); },
      inGroup(slug) { return (this.group_slugs || []).includes(slug); },
      inDepartment(slug) { return this.departments.some(d => d.slug === slug); },
      isManagerOf(slug) { return this.departments.some(d => d.slug === slug && (d.role === 'manager' || d.role === 'lead')); },
    };

    // Touch last_seen + last_active fire-and-forget
    db.query('UPDATE user_sessions SET last_seen_at = NOW() WHERE token = $1', [token]).catch(() => {});
    db.query(
      `INSERT INTO user_status (user_id, status, last_active_at, changed_at)
       VALUES ($1, 'active', NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         last_active_at = NOW(),
         status = CASE
           WHEN user_status.status = 'offline' THEN 'active'
           WHEN user_status.status = 'idle' THEN 'active'
           ELSE user_status.status
         END`,
      [row.user_id]
    ).catch(() => {});
  } catch (err) {
    console.error('[auth] attachUserToRequest error:', err.message);
  }
  next();
}

async function loadUserPermissions(userId) {
  const r = await db.query(
    `SELECT DISTINCT p.slug
     FROM user_groups ug
     JOIN group_permissions gp ON gp.group_id = ug.group_id
     JOIN permissions p ON p.id = gp.permission_id
     WHERE ug.user_id = $1`,
    [userId]
  );
  return new Set(r.rows.map(x => x.slug));
}

async function loadUserGroups(userId) {
  const r = await db.query(
    `SELECT g.slug FROM user_groups ug
       JOIN groups g ON g.id = ug.group_id
      WHERE ug.user_id = $1 AND g.deleted_at IS NULL`,
    [userId]
  );
  return r.rows.map(x => x.slug);
}

async function loadUserDepartments(userId) {
  const r = await db.query(
    `SELECT d.id, d.slug, d.name, d.icon, d.colour, m.role, m.is_primary
     FROM user_department_memberships m
     JOIN departments d ON d.id = m.department_id
     WHERE m.user_id = $1 AND m.deleted_at IS NULL AND d.deleted_at IS NULL`,
    [userId]
  );
  return r.rows.map(x => ({
    id: x.id, slug: x.slug, name: x.name, icon: x.icon, colour: x.colour,
    role: x.role, is_primary: x.is_primary,
  }));
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (req.user.must_change_password && !req.path.endsWith('/change-password')) {
    return res.status(403).json({ error: 'Password change required', must_change_password: true });
  }
  next();
}

function requirePermission(slug) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not logged in' });
    if (!req.user.can(slug)) return res.status(403).json({ error: 'Permission denied', required: slug });
    next();
  };
}

async function createSession(userId, req) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await db.query(
    `INSERT INTO user_sessions (token, user_id, ip_address, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [token, userId, req?.ip || null, req?.headers?.['user-agent'] || null, expiresAt]
  );
  return { token, expiresAt };
}

async function destroySession(token) {
  if (!token) return;
  await db.query('DELETE FROM user_sessions WHERE token = $1', [token]);
}

async function logAudit({ req, user, module, action, target_type, target_id, before, after, details }) {
  const actor = user || req?.user || null;
  try {
    await db.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_name, module, action, target_type, target_id, before_data, after_data, details, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        actor?.id || null,
        actor?.full_name || actor?.email || null,
        module, action,
        target_type || null,
        target_id ? String(target_id) : null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        details || null,
        req?.ip || null,
        req?.headers?.['user-agent'] || null,
      ]
    );
  } catch (err) {
    console.error('[audit] failed to write:', err.message);
  }
}

// Helper for shift_log
async function logShift({ user_id, event_type, status_before, status_after, note, req }) {
  try {
    await db.query(
      `INSERT INTO shift_log (user_id, event_type, status_before, status_after, ip_address, user_agent, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [user_id, event_type, status_before || null, status_after || null,
       req?.ip || null, req?.headers?.['user-agent'] || null, note || null]
    );
  } catch (err) {
    console.error('[shift_log] failed:', err.message);
  }
}

module.exports = {
  SESSION_COOKIE,
  attachUserToRequest,
  requireAuth,
  requirePermission,
  createSession,
  destroySession,
  logAudit,
  logShift,
};
