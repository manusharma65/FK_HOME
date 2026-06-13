// FK Home — /api/auth/*
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { SESSION_COOKIE, createSession, destroySession, logAudit, logShift, requireAuth } = require('../auth');
const attendance = require('./attendance');
const { isMobileRequest, hashDeviceToken, isOfficeDevice } = require('./device');

const router = express.Router();

// ---- Login brute-force throttle (in-memory; FK Home runs as a single instance).
// Keyed by client IP + email. After MAX_FAILS bad attempts inside WINDOW_MS the
// pair is locked for LOCK_MS. Successful login clears it.
const LOGIN_FAILS = new Map();
const MAX_FAILS = 8, WINDOW_MS = 15 * 60 * 1000, LOCK_MS = 15 * 60 * 1000;
// Fixed hash used for a constant-time compare when the email is unknown/deleted,
// so an attacker can't tell a real account from a missing one by response time.
const DUMMY_HASH = bcrypt.hashSync('fk-home-dummy-password', 10);
function throttleKey(req, email) { return (req.ip || '?') + '|' + String(email || '').toLowerCase().trim(); }
// Who may register/revoke office devices: the owner, or whoever can see all
// attendance (Head of Ops, e.g. Satyam) — so device setup isn't blocked when the
// owner isn't on site.
function canTrustDevices(u) {
  try { return u.inGroup('owner') || u.can('attendance.device.trust') || u.can('attendance.view.any'); } catch (e) { return false; }
}
function lockSecondsLeft(key) { const e = LOGIN_FAILS.get(key); return (e && e.until && e.until > Date.now()) ? Math.ceil((e.until - Date.now()) / 1000) : 0; }
function noteLoginFail(key) { const now = Date.now(); let e = LOGIN_FAILS.get(key); if (!e || now - e.first > WINDOW_MS) e = { n: 0, first: now, until: 0 }; e.n += 1; if (e.n >= MAX_FAILS) e.until = now + LOCK_MS; LOGIN_FAILS.set(key, e); }
function clearLoginFail(key) { LOGIN_FAILS.delete(key); }
const _throttleSweep = setInterval(() => { const now = Date.now(); for (const [k, e] of LOGIN_FAILS) { if ((!e.until || e.until < now) && now - e.first > WINDOW_MS) LOGIN_FAILS.delete(k); } }, 10 * 60 * 1000);
if (_throttleSweep.unref) _throttleSweep.unref();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const tkey = throttleKey(req, email);
  const wait = lockSecondsLeft(tkey);
  if (wait) return res.status(429).json({ error: 'Too many attempts. Try again in ' + Math.ceil(wait / 60) + ' min.' });
  try {
    const r = await db.query(
      `SELECT id, email, password_hash, full_name, display_name, employment_status, must_change_password, deleted_at
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );
    const user = r.rows[0];

    // Constant-time + uniform-response login (no account enumeration):
    // unknown/deleted email still runs a bcrypt compare against a dummy hash so
    // timing matches a real account; and an inactive account is only revealed
    // AFTER a correct password — without the password, active vs inactive both 401.
    const hashToCheck = (user && !user.deleted_at) ? user.password_hash : DUMMY_HASH;
    const ok = await bcrypt.compare(password, hashToCheck);

    if (!user || user.deleted_at || !ok) {
      noteLoginFail(tkey);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.employment_status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }
    clearLoginFail(tkey);

    const { token, expiresAt } = await createSession(user.id, req);
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    await logShift({ user_id: user.id, event_type: 'login', status_after: 'active', req });
    // r0.6: login = clock-in. Record/update attendance_day row.
    if (typeof attendance.recordLogin === 'function') {
      const onOfficeDevice = await isOfficeDevice(req);
      attendance.recordLogin(user.id, onOfficeDevice).catch(e => console.error('[recordLogin]', e.message));
    }

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
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
      attendance.recordLogout(req.user.id, isMobileRequest(req)).catch(e => console.error('[recordLogout]', e.message));
    }
  }
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

// Owner: mark THIS machine a trusted office device. The raw token is stored only
// in this machine's long-lived cookie; the DB keeps its hash. Dormant until ship 2
// wires clock-in to it. (HR can be added to the gate later.)
router.post('/trust-device', requireAuth, async (req, res) => {
  if (!canTrustDevices(req.user)) return res.status(403).json({ error: 'Not permitted' });
  try {
    const raw = crypto.randomBytes(32).toString('hex');
    await db.query(
      `INSERT INTO trusted_devices (token_hash, label, created_by) VALUES ($1, $2, $3)`,
      [hashDeviceToken(raw), String((req.body && req.body.label) || 'Office device').slice(0, 120), req.user.id]
    );
    res.cookie('fk_device', raw, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      maxAge: 365 * 24 * 3600 * 1000,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[trust-device]', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// Owner: list / revoke trusted devices.
router.get('/trusted-devices', requireAuth, async (req, res) => {
  if (!canTrustDevices(req.user)) return res.status(403).json({ error: 'Not permitted' });
  const r = await db.query(
    `SELECT id, label, created_at, last_seen_at FROM trusted_devices WHERE revoked_at IS NULL ORDER BY created_at DESC`);
  res.json({ devices: r.rows });
});
router.post('/trusted-devices/:id/revoke', requireAuth, async (req, res) => {
  if (!canTrustDevices(req.user)) return res.status(403).json({ error: 'Not permitted' });
  await db.query(`UPDATE trusted_devices SET revoked_at = NOW() WHERE id = $1`, [req.params.id]);
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
