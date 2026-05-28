// FK Home — /api/auth/*
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { SESSION_COOKIE, createSession, destroySession, logAudit, logShift } = require('../auth');
const attendance = require('./attendance');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const r = await db.query(
      `SELECT id, email, password_hash, full_name, display_name, employment_status, must_change_password, deleted_at
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = r.rows[0];
    if (user.deleted_at) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.employment_status !== 'active') return res.status(403).json({ error: 'Account is not active' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { token, expiresAt } = await createSession(user.id, req);
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    await logShift({ user_id: user.id, event_type: 'login', status_after: 'active', req });
    // r0.6: login = clock-in. Record/update attendance_day row.
    if (typeof attendance.recordLogin === 'function') {
      attendance.recordLogin(user.id).catch(e => console.error('[recordLogin]', e.message));
    }

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
    });
    res.json({
      ok: true,
      must_change_password: user.must_change_password,
      user: { id: user.id, email: user.email, full_name: user.full_name, display_name: user.display_name || user.full_name },
      token,
    });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE] || req.headers['x-fk-token'];
  if (req.user) {
    await logShift({ user_id: req.user.id, event_type: 'logout', status_before: 'active', status_after: 'offline', req });
    await db.query(`UPDATE user_status SET status='offline', changed_at=NOW() WHERE user_id=$1`, [req.user.id]);
    // r0.6: logout = clock-out. Stamp last_logout on today's attendance_day row.
    if (typeof attendance.recordLogout === 'function') {
      attendance.recordLogout(req.user.id).catch(e => console.error('[recordLogout]', e.message));
    }
  }
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  // Fetch user's group slugs (for display-title resolution: Founder, Head of Operations, etc.)
  let groupSlugs = [];
  try {
    const r = await db.query(
      `SELECT g.slug FROM user_groups ug
       JOIN groups g ON g.id = ug.group_id
       WHERE ug.user_id = $1 AND g.deleted_at IS NULL`,
      [req.user.id]
    );
    groupSlugs = r.rows.map(x => x.slug);
  } catch (err) {
    console.error('[auth/me] groups lookup failed:', err.message);
  }
  res.json({
    id: req.user.id,
    email: req.user.email,
    full_name: req.user.full_name,
    display_name: req.user.display_name,
    initials: req.user.initials,
    avatar_colour: req.user.avatar_colour,
    must_change_password: req.user.must_change_password,
    departments: req.user.departments,
    group_slugs: groupSlugs,
    permissions: Array.from(req.user.permissions),
  });
});

router.post('/change-password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'New password must be different' });

  try {
    const r = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Current password is wrong' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
      `UPDATE users SET password_hash=$1, must_change_password=FALSE, last_password_change_at=NOW() WHERE id=$2`,
      [hash, req.user.id]
    );
    await logAudit({ req, module: 'auth', action: 'password.changed' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] change-password error:', err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;
