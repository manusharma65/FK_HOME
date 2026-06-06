// FK Home — /api/attendance/*
//
// Endpoints
//   GET    /api/attendance/today           — own attendance today (any logged-in user)
//   GET    /api/attendance/me/week         — own this-week summary
//   GET    /api/attendance/me/month        — own this-month summary
//   POST   /api/attendance/regularise      — submit a correction request
//   GET    /api/attendance/regularise/pending  — pending requests visible to caller
//   POST   /api/attendance/regularise/:id/decide — approve/deny (manager)
//   GET    /api/attendance/policy          — list shift policies
//   PUT    /api/attendance/policy/:slug    — edit a policy
//   GET    /api/attendance/anchor          — get current pattern anchor
//   PUT    /api/attendance/anchor          — set pattern anchor
//   GET    /api/attendance/holidays        — list holidays
//   POST   /api/attendance/holidays        — add a holiday
//   DELETE /api/attendance/holidays/:id    — remove a holiday (soft delete)
//   POST   /api/attendance/cs-rota         — upload a 4-week CS rota (multipart/json CSV)
//   GET    /api/attendance/cs-rota/template — template download (returns CSV string)
//   GET    /api/attendance/cs-rota/current — current rota for display
//   POST   /api/attendance/idle/ack        — agent taps "Still there" banner
//
// HR view
//   GET    /api/attendance/hr/today        — categorised view of who's where today
//   GET    /api/attendance/hr/chronic-idle — chronic idle flags queue
//   POST   /api/attendance/hr/chronic-idle/:id/decide — acknowledge / dismiss
//
// Cron entry points (called from server.js)
//   tickFiveMinute()      — every 5 min: mark late, fire alerts, escalate idle
//   tickDailyMidnight()   — every day at 00:00: close yesterday, seed today
//   tickWeeklySunday()    — every Sunday 23:00: scan for chronic idle patterns

const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePermission, logAudit } = require('../auth');
const { notify, notifyManagersOf, notifyEvent } = require('../notify');

const router = express.Router();
router.use(requireAuth);

// ============================================================================
//  HELPERS
// ============================================================================

// Anchor week is the 6-day week (Mon-Sat, Sun off).
// Following week is the 5-day week (Mon-Fri, Sat+Sun off).
// Pattern repeats fortnightly from anchor_monday forever.
async function getPatternAnchor() {
  const r = await db.query('SELECT anchor_monday FROM pattern_anchor WHERE id = 1');
  if (r.rows.length === 0) return null;
  return r.rows[0].anchor_monday;
}

// Given a date and the anchor monday, return:
//   { week_type: 'six_day' | 'five_day', dow: 0..6, is_off_pattern: true/false }
// dow: 0=Sun, 1=Mon, ..., 6=Sat
function classifyDateByPattern(dateStr, anchorMonday) {
  // Both as UTC date objects to avoid local-time drift.
  const target = new Date(dateStr + 'T00:00:00Z');
  const anchor = new Date(anchorMonday + 'T00:00:00Z');
  // Find the Monday of the target week (handle Sunday as part of *next* week's Monday's pair).
  // Approach: compute days since anchor_monday. divmod 14 gives position in fortnight.
  const msPerDay = 86400000;
  const daysSinceAnchor = Math.round((target - anchor) / msPerDay);
  // Position in 14-day cycle.
  const cycle = ((daysSinceAnchor % 14) + 14) % 14;
  // Cycle 0..6 = anchor week (6-day, Mon..Sun); cycle 7..13 = following week (5-day, Mon..Sun).
  const weekType = cycle < 7 ? 'six_day' : 'five_day';
  const dowIdx = cycle % 7; // 0=Mon, 1=Tue ... 5=Sat, 6=Sun
  let isOff;
  if (weekType === 'six_day') {
    isOff = (dowIdx === 6); // Sun off
  } else {
    isOff = (dowIdx === 5 || dowIdx === 6); // Sat + Sun off
  }
  return { week_type: weekType, dow_idx: dowIdx, is_off_pattern: isOff };
}

// Is dateStr a public holiday? Returns the holiday row or null.
async function getHoliday(dateStr) {
  const r = await db.query(
    `SELECT id, holiday_date, name, office_closed_for_cs
     FROM holidays WHERE holiday_date = $1 AND deleted_at IS NULL LIMIT 1`,
    [dateStr]
  );
  return r.rows[0] || null;
}

// Does the user have an approved leave covering dateStr?
async function isUserOnApprovedLeave(userId, dateStr) {
  const r = await db.query(
    `SELECT 1 FROM leave_requests
     WHERE user_id = $1
       AND status = 'approved'
       AND $2::date BETWEEN start_date AND end_date
     LIMIT 1`,
    [userId, dateStr]
  );
  return r.rows.length > 0;
}

// Does the user have a sick log covering dateStr?
async function isUserSickOn(userId, dateStr) {
  const r = await db.query(
    `SELECT 1 FROM sick_log
     WHERE user_id = $1
       AND deleted_at IS NULL
       AND start_date <= $2::date
       AND (end_date IS NULL OR end_date >= $2::date)
     LIMIT 1`,
    [userId, dateStr]
  );
  return r.rows.length > 0;
}

// Returns the user's primary department slug (the one with role='manager' is irrelevant — we want any membership).
// We use the SMALLEST sort order as a tiebreaker for users in multiple depts.
async function getUserPrimaryDept(userId) {
  const r = await db.query(
    `SELECT d.slug
     FROM user_department_memberships m
     JOIN departments d ON d.id = m.department_id
     WHERE m.user_id = $1 AND m.deleted_at IS NULL AND d.deleted_at IS NULL
     ORDER BY d.sort_order ASC NULLS LAST, d.id ASC
     LIMIT 1`,
    [userId]
  );
  return r.rows[0] ? r.rows[0].slug : null;
}

// Get the shift policy for a department.
async function getShiftPolicy(deptSlug) {
  if (!deptSlug) return null;
  const r = await db.query(
    `SELECT department_slug, start_time, end_time, grace_minutes, tz
     FROM shift_policies WHERE department_slug = $1`,
    [deptSlug]
  );
  return r.rows[0] || null;
}

// r0.9 — Company-wide break window from team_break_schedule.
// Returns { start_hhmm, end_hhmm } or null if no active break configured.
let _breakCache = null;
let _breakCacheAt = 0;
async function getCompanyBreak() {
  // Cache for 60s — only updated via admin, rare.
  if (_breakCache !== null && (Date.now() - _breakCacheAt) < 60000) return _breakCache;
  try {
    const r = await db.query(
      `SELECT break_start_time::text AS start_time, duration_minutes
       FROM team_break_schedule WHERE scope = 'company' AND active = TRUE`
    );
    if (r.rows.length === 0) {
      _breakCache = null;
    } else {
      const startStr = String(r.rows[0].start_time).slice(0, 5); // HH:MM
      const [hh, mm] = startStr.split(':').map(Number);
      const total = hh * 60 + mm + Number(r.rows[0].duration_minutes);
      const endHh = Math.floor(total / 60) % 24;
      const endMm = total % 60;
      const endStr = String(endHh).padStart(2, '0') + ':' + String(endMm).padStart(2, '0');
      _breakCache = { start_hhmm: startStr, end_hhmm: endStr };
    }
    _breakCacheAt = Date.now();
    return _breakCache;
  } catch (e) {
    console.error('[getCompanyBreak] failed:', e.message);
    return null;
  }
}

// For a CS user, look up today's rota entry. Returns 'working' | 'off' | 'leave' | null.
async function getCsRotaStatus(userId, dateStr) {
  const r = await db.query(
    `SELECT e.status
     FROM cs_rota_entries e
     JOIN cs_rotas r ON r.id = e.rota_id
     WHERE e.user_id = $1 AND e.entry_date = $2 AND r.deleted_at IS NULL
     ORDER BY r.uploaded_at DESC LIMIT 1`,
    [userId, dateStr]
  );
  return r.rows[0] ? r.rows[0].status : null;
}

// Compute expected_status for one (user, date). Order of precedence:
//   1. approved leave  -> 'on_leave'
//   2. sick log        -> 'off_sick'
//   3. public holiday  -> 'off_holiday' for non-CS; for CS, see step 4
//   4. CS user:
//        rota entry exists -> 'working' | 'off_cs_rota' | 'on_leave' (from rota 'leave')
//        no rota uploaded for this date -> 'pending' (no expectation, HR interprets)
//   5. non-CS user:
//        pattern says off -> 'off_pattern'
//        else -> 'pending' (expected to work)
async function computeExpectedStatus(userId, dateStr) {
  // 1) Leave
  if (await isUserOnApprovedLeave(userId, dateStr)) return 'on_leave';
  // 2) Sick
  if (await isUserSickOn(userId, dateStr)) return 'off_sick';

  const deptSlug = await getUserPrimaryDept(userId);
  const isCs = deptSlug === 'cs';

  // 3) Holiday — non-CS only
  if (!isCs) {
    const hol = await getHoliday(dateStr);
    if (hol) return 'off_holiday';
  }

  // 4) CS path
  if (isCs) {
    const rotaStatus = await getCsRotaStatus(userId, dateStr);
    if (rotaStatus === 'working') return 'pending';
    if (rotaStatus === 'off') return 'off_cs_rota';
    if (rotaStatus === 'leave') return 'on_leave';
    return 'pending'; // no rota -> no expectation, but row still created
  }

  // 5) Non-CS pattern check
  const anchor = await getPatternAnchor();
  if (anchor) {
    const cls = classifyDateByPattern(dateStr, anchor);
    if (cls.is_off_pattern) return 'off_pattern';
  }
  return 'pending';
}

// Format an HH:MM string + a date into a TIMESTAMPTZ at the given timezone.
// We do this in JS using offset arithmetic to avoid PG version pain. Returns ISO string.
function buildLocalTimestamp(dateStr, hhmm, tz) {
  // Trust 'Europe/London' default for now. tz only affects display.
  // For policy comparison we treat the dates as London local.
  // Build a Date with that local time then convert to ISO.
  // Approach: format = `YYYY-MM-DDTHH:MM:00` then assume Europe/London.
  // To keep this simple and robust, return the local wall-clock string and let SQL handle TZ.
  return `${dateStr} ${hhmm}:00 Europe/London`;
}

// Local-time "now" in London as YYYY-MM-DD HH:MM (used by cron tasks).
function nowInLondon() {
  // Intl gives us the parts; we reassemble.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${get('hour')}:${get('minute')}`,
    iso: new Date().toISOString()
  };
}

// Helper: minutes between two HH:MM strings (a >= b returns positive minutes).
function minutesBetween(aHHMM, bHHMM) {
  const [ah, am] = aHHMM.split(':').map(Number);
  const [bh, bm] = bHHMM.split(':').map(Number);
  return (ah * 60 + am) - (bh * 60 + bm);
}

// Is a given HH:MM inside [start, end] inclusive?
function isInWindow(hhmm, startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return false;
  return minutesBetween(hhmm, startHHMM) >= 0 && minutesBetween(endHHMM, hhmm) >= 0;
}

// ============================================================================
//  ENDPOINTS — agent-facing
// ============================================================================

// GET /api/attendance/today
// Returns: { status, first_login, last_logout, late_minutes, shift_start_local, shift_end_local,
//            policy: {...}, idle_banner: bool (if currently idle >= 10 min) }
router.get('/today', async (req, res) => {
  try {
    const today = nowInLondon().date;
    const r = await db.query(
      `SELECT status, first_login, last_logout, late_minutes,
              active_minutes, idle_minutes, break_taken_minutes,
              shift_start_local, shift_end_local
       FROM attendance_day WHERE user_id = $1 AND for_date = $2`,
      [req.user.id, today]
    );
    let row = r.rows[0];
    if (!row) {
      // Edge case: row not yet created (e.g. first login after midnight before cron has run).
      // Create on demand.
      const expected = await computeExpectedStatus(req.user.id, today);
      const deptSlug = await getUserPrimaryDept(req.user.id);
      const pol = await getShiftPolicy(deptSlug);
      await db.query(
        `INSERT INTO attendance_day (user_id, for_date, status, shift_start_local, shift_end_local)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, for_date) DO NOTHING`,
        [req.user.id, today, expected, pol ? pol.start_time : null, pol ? pol.end_time : null]
      );
      const r2 = await db.query(
        `SELECT status, first_login, last_logout, late_minutes,
                active_minutes, idle_minutes, break_taken_minutes,
                shift_start_local, shift_end_local
         FROM attendance_day WHERE user_id = $1 AND for_date = $2`,
        [req.user.id, today]
      );
      row = r2.rows[0];
    }

    // Check for an open idle event >= 10 minutes
    const idleRow = await db.query(
      `SELECT started_at, EXTRACT(EPOCH FROM (NOW() - started_at))/60 AS mins
       FROM idle_events
       WHERE user_id = $1 AND ended_at IS NULL AND agent_acknowledged_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [req.user.id]
    );
    let idleBanner = false;
    if (idleRow.rows[0] && idleRow.rows[0].mins >= 10) {
      idleBanner = true;
    }

    res.json({ ...row, idle_banner: idleBanner });
  } catch (err) {
    console.error('[attendance/today] failed:', err.message);
    res.status(500).json({ error: 'Could not load today\'s attendance' });
  }
});

// GET /api/attendance/me/week
//   ?days=N      (default 7) — how many days back to fetch
//   ?user_id=X   — to view another user's history. Requires attendance.view.any
//                  or attendance.view.dept (and the target must be in your dept).
router.get('/me/week', async (req, res) => {
  try {
    const today = nowInLondon().date;
    let days = parseInt(req.query.days, 10);
    if (!Number.isFinite(days) || days < 1) days = 7;
    if (days > 366) days = 366;

    let targetUserId = req.user.id;
    if (req.query.user_id) {
      const requested = parseInt(req.query.user_id, 10);
      if (!Number.isFinite(requested)) {
        return res.status(400).json({ error: 'user_id must be a number' });
      }
      if (requested !== req.user.id) {
        const canAny = req.user.can('attendance.view.any');
        const canDept = req.user.can('attendance.view.dept');
        if (!canAny && !canDept) {
          return res.status(403).json({ error: 'Cannot view other users' });
        }
        if (canDept && !canAny) {
          const sameDept = await db.query(
            `SELECT 1 FROM user_department_memberships m1
             JOIN user_department_memberships m2 ON m1.department_id = m2.department_id
             WHERE m1.user_id = $1 AND m2.user_id = $2
               AND m1.deleted_at IS NULL AND m2.deleted_at IS NULL
             LIMIT 1`,
            [req.user.id, requested]
          );
          if (sameDept.rows.length === 0) {
            return res.status(403).json({ error: 'User is not in your department' });
          }
        }
        targetUserId = requested;
      }
    }

    const r = await db.query(
      `SELECT for_date, status, late_minutes, active_minutes, idle_minutes,
              first_login, last_logout, weekend_pay_status, is_paid,
              sick_notified_hours
       FROM attendance_day
       WHERE user_id = $1
         AND for_date > ($2::date - ($3::int || ' days')::interval)
         AND for_date <= $2::date
       ORDER BY for_date DESC`,
      [targetUserId, today, days]
    );
    res.json({ days: r.rows, user_id: targetUserId });
  } catch (err) {
    console.error('[me/week] failed:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// GET /api/attendance/me/lateness
//   Lateness log + regularisation history for self or another user.
//   Same permission rules as /me/week.
router.get('/me/lateness', async (req, res) => {
  try {
    let days = parseInt(req.query.days, 10);
    if (!Number.isFinite(days) || days < 1) days = 30;
    if (days > 366) days = 366;

    let targetUserId = req.user.id;
    if (req.query.user_id) {
      const requested = parseInt(req.query.user_id, 10);
      if (!Number.isFinite(requested)) {
        return res.status(400).json({ error: 'user_id must be a number' });
      }
      if (requested !== req.user.id) {
        const canAny = req.user.can('attendance.view.any');
        const canDept = req.user.can('attendance.view.dept');
        if (!canAny && !canDept) {
          return res.status(403).json({ error: 'Cannot view other users' });
        }
        if (canDept && !canAny) {
          const sameDept = await db.query(
            `SELECT 1 FROM user_department_memberships m1
             JOIN user_department_memberships m2 ON m1.department_id = m2.department_id
             WHERE m1.user_id = $1 AND m2.user_id = $2
               AND m1.deleted_at IS NULL AND m2.deleted_at IS NULL
             LIMIT 1`,
            [req.user.id, requested]
          );
          if (sameDept.rows.length === 0) {
            return res.status(403).json({ error: 'User is not in your department' });
          }
        }
        targetUserId = requested;
      }
    }

    const today = nowInLondon().date;
    const lates = await db.query(
      `SELECT for_date, late_minutes, first_login, shift_start_local
       FROM attendance_day
       WHERE user_id = $1
         AND late_minutes > 0
         AND for_date > ($2::date - ($3::int || ' days')::interval)
         AND for_date <= $2::date
       ORDER BY for_date DESC`,
      [targetUserId, today, days]
    );
    const regs = await db.query(
      `SELECT id, for_date, reason, status, requested_first_login,
              requested_last_logout, created_at, decided_at
       FROM attendance_regularisations
       WHERE user_id = $1
         AND for_date > ($2::date - ($3::int || ' days')::interval)
         AND for_date <= $2::date
       ORDER BY created_at DESC`,
      [targetUserId, today, days]
    );
    res.json({
      user_id: targetUserId,
      lates: lates.rows,
      regularisations: regs.rows
    });
  } catch (err) {
    console.error('[me/lateness] failed:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/attendance/regularise — agent submits a correction
router.post('/regularise', async (req, res) => {
  const { for_date, reason, requested_first_login, requested_last_logout } = req.body || {};
  if (!for_date || !reason || reason.trim().length < 3) {
    return res.status(400).json({ error: 'Date and reason are required.' });
  }
  // Can only regularise a PAST day — today isn't finished and the future hasn't
  // happened, so there's nothing settled to correct.
  if (for_date >= nowInLondon().date) {
    return res.status(400).json({ error: "You can only regularise a past day — today isn't finished yet." });
  }
  try {
    // The form may send bare times ("07:30"); the columns are TIMESTAMPTZ.
    // Combine HH:MM with for_date; pass through anything already full.
    const combineDT = (time) => {
      if (!time) return null;
      const t = String(time).trim();
      if (/^\d{1,2}:\d{2}$/.test(t)) return for_date + ' ' + (t.length === 4 ? '0' + t : t) + ':00';
      return t; // already a full timestamp / ISO string
    };
    const firstLogin = combineDT(requested_first_login);
    const lastLogout = combineDT(requested_last_logout);
    const r = await db.query(
      `INSERT INTO attendance_regularisations
        (user_id, for_date, reason, requested_first_login, requested_last_logout)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [req.user.id, for_date, reason.trim(),
       firstLogin, lastLogout]
    );
    await logAudit({ req, module: 'attendance', action: 'regularise.requested',
                    target_type: 'attendance_regularisation', target_id: r.rows[0].id,
                    after: { for_date, reason } });
    await notifyEvent('attendance.regularise.requested', {
      actorUserId: req.user.id,
      name: req.user.display_name || req.user.full_name,
      forDate: for_date,
      reason: reason.trim().slice(0, 80),
      related_id: r.rows[0].id,
    });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error('[regularise] failed:', err.message);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// GET /api/attendance/regularise/pending — visible if you have approve.dept or approve.any
router.get('/regularise/pending', async (req, res) => {
  const canAny = req.user.can('attendance.regularise.approve.any');
  const canDept = req.user.can('attendance.regularise.approve.dept');
  if (!canAny && !canDept) return res.status(403).json({ error: 'Forbidden' });

  try {
    let sql, params;
    if (canAny) {
      sql = `SELECT r.id, r.user_id, u.full_name, r.for_date, r.reason,
                    r.requested_first_login, r.requested_last_logout, r.created_at
             FROM attendance_regularisations r
             JOIN users u ON u.id = r.user_id
             WHERE r.status = 'pending'
             ORDER BY r.created_at DESC`;
      params = [];
    } else {
      sql = `SELECT r.id, r.user_id, u.full_name, r.for_date, r.reason,
                    r.requested_first_login, r.requested_last_logout, r.created_at
             FROM attendance_regularisations r
             JOIN users u ON u.id = r.user_id
             WHERE r.status = 'pending'
               AND r.user_id IN (
                 SELECT m2.user_id FROM user_department_memberships m2
                 WHERE m2.deleted_at IS NULL
                   AND m2.department_id IN (
                     SELECT m1.department_id FROM user_department_memberships m1
                     WHERE m1.user_id = $1 AND m1.deleted_at IS NULL
                       AND m1.role IN ('manager','lead')
                   )
               )
             ORDER BY r.created_at DESC`;
      params = [req.user.id];
    }
    const r = await db.query(sql, params);
    res.json({ requests: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/attendance/regularise/:id/decide  body: { decision: 'approve'|'deny', note? }
router.post('/regularise/:id/decide', async (req, res) => {
  const { id } = req.params;
  const { decision, note } = req.body || {};
  if (decision !== 'approve' && decision !== 'deny') {
    return res.status(400).json({ error: 'decision must be approve or deny' });
  }
  const canAny = req.user.can('attendance.regularise.approve.any');
  const canDept = req.user.can('attendance.regularise.approve.dept');
  if (!canAny && !canDept) return res.status(403).json({ error: 'Forbidden' });

  try {
    const reg = await db.query(
      `SELECT id, user_id, for_date, requested_first_login, requested_last_logout, status
       FROM attendance_regularisations WHERE id = $1`,
      [id]
    );
    if (reg.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (reg.rows[0].status !== 'pending') return res.status(400).json({ error: 'Already decided' });

    // Dept-only check: caller must be a manager of one of this user's depts
    if (!canAny && canDept) {
      const overlap = await db.query(
        `SELECT 1 FROM user_department_memberships m1
         JOIN user_department_memberships m2 ON m2.department_id = m1.department_id
         WHERE m1.user_id = $1 AND m1.role IN ('manager','lead') AND m1.deleted_at IS NULL
           AND m2.user_id = $2 AND m2.deleted_at IS NULL
         LIMIT 1`,
        [req.user.id, reg.rows[0].user_id]
      );
      if (overlap.rows.length === 0) return res.status(403).json({ error: 'Not your department' });
    }

    const newStatus = decision === 'approve' ? 'approved' : 'denied';
    await db.query(
      `UPDATE attendance_regularisations
       SET status = $1, decided_by_user_id = $2, decided_at = NOW(), decided_note = $3
       WHERE id = $4`,
      [newStatus, req.user.id, note || null, id]
    );

    // If approved AND there are requested timestamps, patch attendance_day
    if (decision === 'approve') {
      const r = reg.rows[0];
      const patch = {};
      if (r.requested_first_login) patch.first_login = r.requested_first_login;
      if (r.requested_last_logout) patch.last_logout = r.requested_last_logout;
      if (Object.keys(patch).length > 0) {
        // Recompute status against first_login
        // (we only do simple status adjust here — full recompute happens at midnight)
        const ad = await db.query(
          `SELECT id, shift_start_local FROM attendance_day
           WHERE user_id = $1 AND for_date = $2`,
          [r.user_id, r.for_date]
        );
        if (ad.rows[0]) {
          // Recompute late_minutes vs shift_start_local if we have a new first_login
          let setStatus = null;
          let setLateMin = null;
          if (patch.first_login && ad.rows[0].shift_start_local) {
            // Convert requested_first_login to London HH:MM
            const fmt = new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Europe/London',
              hour: '2-digit', minute: '2-digit', hour12: false
            });
            const hhmm = fmt.format(new Date(patch.first_login));
            const lateMin = minutesBetween(hhmm, ad.rows[0].shift_start_local);
            setLateMin = Math.max(0, lateMin);
            // Status: get the policy grace
            const u = await db.query(
              `SELECT d.slug FROM user_department_memberships m
               JOIN departments d ON d.id = m.department_id
               WHERE m.user_id = $1 AND m.deleted_at IS NULL
               ORDER BY d.sort_order LIMIT 1`,
              [r.user_id]
            );
            const pol = await getShiftPolicy(u.rows[0] ? u.rows[0].slug : null);
            const grace = pol ? pol.grace_minutes : 5;
            if (setLateMin <= grace) setStatus = 'on_time';
            else if (setLateMin <= 30) setStatus = 'late';
            else setStatus = 'very_late';
          }
          await db.query(
            `UPDATE attendance_day
             SET first_login = COALESCE($1, first_login),
                 last_logout = COALESCE($2, last_logout),
                 status = COALESCE($3, status),
                 late_minutes = COALESCE($4, late_minutes),
                 updated_at = NOW()
             WHERE id = $5`,
            [patch.first_login || null, patch.last_logout || null,
             setStatus, setLateMin, ad.rows[0].id]
          );
        }
      }
    }

    await logAudit({ req, module: 'attendance', action: `regularise.${decision}`,
                    target_type: 'attendance_regularisation', target_id: id,
                    after: { note: note || null } });

    // Notify the requester
    await notifyEvent('attendance.regularise.decided', {
      targetUserId: reg.rows[0].user_id,
      newStatus,
      decision,
      note: note || null,
      related_id: id,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[regularise.decide] failed:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/attendance/idle/ack — agent dismisses the "still there?" banner
router.post('/idle/ack', async (req, res) => {
  try {
    await db.query(
      `UPDATE idle_events
       SET agent_acknowledged_at = NOW(), ended_at = NOW(),
           duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at))/60
       WHERE user_id = $1 AND ended_at IS NULL`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================================================
//  ENDPOINTS — admin / policy management
// ============================================================================

router.get('/policy', requirePermission('attendance.view.any'), async (req, res) => {
  const r = await db.query(
    `SELECT department_slug, start_time, end_time, grace_minutes, tz
     FROM shift_policies ORDER BY department_slug`
  );
  res.json({ policies: r.rows });
});

router.put('/policy/:slug', requirePermission('attendance.policy.edit'), async (req, res) => {
  const { slug } = req.params;
  // r0.9 — break_start/break_end no longer accepted. Break time is company-wide
  // and edited via Admin → Settings → Break time (team_break_schedule).
  const { start_time, end_time, grace_minutes, tz } = req.body || {};
  if (!/^\d{2}:\d{2}$/.test(start_time || '') || !/^\d{2}:\d{2}$/.test(end_time || '')) {
    return res.status(400).json({ error: 'Times must be HH:MM' });
  }
  try {
    await db.query(
      `UPDATE shift_policies SET
        start_time = $1, end_time = $2,
        grace_minutes = COALESCE($3, grace_minutes),
        tz = COALESCE($4, tz),
        updated_at = NOW()
       WHERE department_slug = $5`,
      [start_time, end_time, grace_minutes, tz || null, slug]
    );
    await logAudit({ req, module: 'attendance', action: 'policy.updated',
                    target_type: 'shift_policy', target_id: slug,
                    after: req.body });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/anchor', requirePermission('attendance.view.any'), async (req, res) => {
  const r = await db.query('SELECT anchor_monday, updated_at FROM pattern_anchor WHERE id = 1');
  res.json(r.rows[0] || {});
});

router.put('/anchor', requirePermission('attendance.policy.edit'), async (req, res) => {
  const { anchor_monday } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor_monday || '')) {
    return res.status(400).json({ error: 'anchor_monday must be YYYY-MM-DD' });
  }
  try {
    await db.query(
      `INSERT INTO pattern_anchor (id, anchor_monday, set_by_user_id, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET
         anchor_monday = EXCLUDED.anchor_monday,
         set_by_user_id = EXCLUDED.set_by_user_id,
         updated_at = NOW()`,
      [anchor_monday, req.user.id]
    );
    await logAudit({ req, module: 'attendance', action: 'anchor.updated',
                    target_type: 'pattern_anchor', after: { anchor_monday } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/holidays', requirePermission('attendance.view.any'), async (req, res) => {
  const r = await db.query(
    `SELECT id, holiday_date, name, office_closed_for_cs
     FROM holidays WHERE deleted_at IS NULL ORDER BY holiday_date`
  );
  res.json({ holidays: r.rows });
});

router.post('/holidays', requirePermission('attendance.policy.edit'), async (req, res) => {
  const { holiday_date, name, office_closed_for_cs } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday_date || '') || !name) {
    return res.status(400).json({ error: 'holiday_date and name required' });
  }
  try {
    const r = await db.query(
      `INSERT INTO holidays (holiday_date, name, office_closed_for_cs)
       VALUES ($1, $2, $3)
       ON CONFLICT (holiday_date) DO UPDATE
       SET name = EXCLUDED.name, office_closed_for_cs = EXCLUDED.office_closed_for_cs, deleted_at = NULL
       RETURNING id`,
      [holiday_date, name, !!office_closed_for_cs]
    );
    await logAudit({ req, module: 'attendance', action: 'holiday.added',
                    target_type: 'holiday', target_id: r.rows[0].id,
                    after: { holiday_date, name } });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.delete('/holidays/:id', requirePermission('attendance.policy.edit'), async (req, res) => {
  try {
    await db.query(
      `UPDATE holidays SET deleted_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    await logAudit({ req, module: 'attendance', action: 'holiday.removed',
                    target_type: 'holiday', target_id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================================================
//  CS rota
// ============================================================================

// GET /api/attendance/cs-rota/template — return a CSV with CS users + 28 dates
// from next Monday onwards. Caller fills it in and posts back.
router.get('/cs-rota/template', requirePermission('attendance.cs_rota.upload'), async (req, res) => {
  try {
    // Find next Monday (London)
    const today = new Date();
    const londonDay = parseInt(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', weekday: 'short'
    }).format(today).slice(0, 3), 10);
    // Map Mon..Sun -> 1..7 (we'll just use Date.getUTCDay below to find next Monday)
    const todayUtc = new Date(today.toISOString().slice(0, 10) + 'T00:00:00Z');
    const dow = todayUtc.getUTCDay(); // 0 Sun, 1 Mon, ..., 6 Sat
    const offsetToNextMonday = dow === 0 ? 1 : (8 - dow);
    const nextMon = new Date(todayUtc);
    nextMon.setUTCDate(nextMon.getUTCDate() + offsetToNextMonday);

    // Build 28 dates
    const dates = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(nextMon);
      d.setUTCDate(nextMon.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    // Find CS users
    const users = await db.query(
      `SELECT u.id, u.full_name
       FROM users u
       JOIN user_department_memberships m ON m.user_id = u.id AND m.deleted_at IS NULL
       JOIN departments d ON d.id = m.department_id
       WHERE d.slug = 'cs' AND u.deleted_at IS NULL AND u.employment_status = 'active'
       ORDER BY u.full_name`
    );

    // Build CSV
    const header = ['Agent', ...dates].join(',');
    const rows = users.rows.map(u => [u.full_name, ...dates.map(() => 'Working')].join(','));
    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=cs-rota-${dates[0]}.csv`);
    res.send(csv);
  } catch (err) {
    console.error('[cs-rota/template] failed:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/attendance/cs-rota  body: { csv: "..." }
router.post('/cs-rota', requirePermission('attendance.cs_rota.upload'), async (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'CSV body required' });
  }
  try {
    // Parse CSV
    const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + at least one row' });

    const header = lines[0].split(',').map(s => s.trim());
    if (header[0].toLowerCase() !== 'agent') {
      return res.status(400).json({ error: 'First column must be "Agent"' });
    }
    const dates = header.slice(1);
    if (dates.length < 1) return res.status(400).json({ error: 'No date columns' });
    for (const dStr of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
        return res.status(400).json({ error: `Bad date column: ${dStr} (must be YYYY-MM-DD)` });
      }
    }

    // Get CS user lookup
    const usersRes = await db.query(
      `SELECT u.id, u.full_name
       FROM users u
       JOIN user_department_memberships m ON m.user_id = u.id AND m.deleted_at IS NULL
       JOIN departments d ON d.id = m.department_id
       WHERE d.slug = 'cs' AND u.deleted_at IS NULL AND u.employment_status = 'active'`
    );
    const userByName = new Map();
    for (const u of usersRes.rows) {
      userByName.set(u.full_name.trim().toLowerCase(), u);
      // also map first name only
      const first = u.full_name.split(/\s+/)[0].toLowerCase();
      if (!userByName.has(first)) userByName.set(first, u);
    }

    // Parse rows
    const entries = [];
    const unknownAgents = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(s => s.trim());
      const agentName = parts[0];
      if (!agentName) continue;
      const u = userByName.get(agentName.toLowerCase());
      if (!u) {
        unknownAgents.push(agentName);
        continue;
      }
      for (let j = 0; j < dates.length; j++) {
        const cell = (parts[j + 1] || '').toLowerCase();
        let status;
        if (cell === 'working' || cell === 'w') status = 'working';
        else if (cell === 'off') status = 'off';
        else if (cell === 'leave' || cell === 'l') status = 'leave';
        else if (!cell) status = 'working'; // empty defaults to working
        else return res.status(400).json({ error: `Row ${i+1}, col ${j+2}: bad value "${cell}" (use Working / off / leave)` });
        entries.push({ user_id: u.id, entry_date: dates[j], status });
      }
    }
    if (unknownAgents.length > 0) {
      return res.status(400).json({ error: `Unknown CS agent(s): ${unknownAgents.join(', ')}` });
    }
    if (entries.length === 0) return res.status(400).json({ error: 'No valid entries' });

    // Insert rota header + entries
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    const rotaInsert = await db.query(
      `INSERT INTO cs_rotas (start_date, end_date, uploaded_by_user_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [startDate, endDate, req.user.id]
    );
    const rotaId = rotaInsert.rows[0].id;

    for (const e of entries) {
      await db.query(
        `INSERT INTO cs_rota_entries (rota_id, user_id, entry_date, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (rota_id, user_id, entry_date) DO UPDATE SET status = EXCLUDED.status`,
        [rotaId, e.user_id, e.entry_date, e.status]
      );
    }

    await logAudit({ req, module: 'attendance', action: 'cs_rota.uploaded',
                    target_type: 'cs_rota', target_id: rotaId,
                    after: { start_date: startDate, end_date: endDate, entry_count: entries.length } });

    res.json({ ok: true, rota_id: rotaId, entries: entries.length, start: startDate, end: endDate });
  } catch (err) {
    console.error('[cs-rota.upload] failed:', err.message);
    res.status(500).json({ error: 'Failed to parse / save rota' });
  }
});

// GET /api/attendance/cs-rota/current — list the most recent rota's entries
router.get('/cs-rota/current', async (req, res) => {
  if (!req.user.can('attendance.cs_rota.view') && !req.user.can('attendance.view.any')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const rota = await db.query(
      `SELECT id, start_date, end_date, uploaded_at, uploaded_by_user_id
       FROM cs_rotas WHERE deleted_at IS NULL ORDER BY uploaded_at DESC LIMIT 1`
    );
    if (rota.rows.length === 0) return res.json({ rota: null, entries: [] });
    const entries = await db.query(
      `SELECT e.user_id, u.full_name, e.entry_date, e.status
       FROM cs_rota_entries e
       JOIN users u ON u.id = e.user_id
       WHERE e.rota_id = $1
       ORDER BY u.full_name, e.entry_date`,
      [rota.rows[0].id]
    );
    res.json({ rota: rota.rows[0], entries: entries.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================================================
//  HR DASHBOARD ENDPOINTS
// ============================================================================

router.get('/hr/today', requirePermission('hr.dashboard.view'), async (req, res) => {
  try {
    const today = nowInLondon().date;
    const r = await db.query(
      `SELECT a.user_id, u.full_name, a.status, a.first_login, a.late_minutes,
              d.slug AS dept_slug, d.name AS dept_name,
              CASE WHEN s.status = 'wfh' THEN s.wfh_lat END AS wfh_lat,
              CASE WHEN s.status = 'wfh' THEN s.wfh_lng END AS wfh_lng
       FROM attendance_day a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_status s ON s.user_id = a.user_id
       LEFT JOIN LATERAL (
         SELECT d2.slug, d2.name FROM user_department_memberships m
         JOIN departments d2 ON d2.id = m.department_id
         WHERE m.user_id = u.id AND m.deleted_at IS NULL
         ORDER BY d2.sort_order LIMIT 1
       ) d ON TRUE
       WHERE a.for_date = $1 AND u.deleted_at IS NULL AND u.employment_status = 'active'
       ORDER BY u.full_name`,
      [today]
    );
    const hol = await getHoliday(today);
    res.json({ rows: r.rows, holiday: hol });
  } catch (err) {
    console.error('[hr/today] failed:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// GET /api/attendance/dept/today — same shape as /hr/today, filtered to caller's primary dept.
// Used by dept managers (Sitar for CS, etc.) to see only their team.
router.get('/dept/today', requirePermission('attendance.view.dept'), async (req, res) => {
  try {
    const today = nowInLondon().date;
    const myDept = await getUserPrimaryDept(req.user.id);
    if (!myDept) {
      return res.json({ rows: [], holiday: null, dept_slug: null, dept_name: null });
    }
    const r = await db.query(
      `SELECT a.user_id, u.full_name, a.status, a.first_login, a.late_minutes,
              d.slug AS dept_slug, d.name AS dept_name,
              CASE WHEN s.status = 'wfh' THEN s.wfh_lat END AS wfh_lat,
              CASE WHEN s.status = 'wfh' THEN s.wfh_lng END AS wfh_lng
       FROM attendance_day a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_status s ON s.user_id = a.user_id
       JOIN LATERAL (
         SELECT d2.slug, d2.name FROM user_department_memberships m
         JOIN departments d2 ON d2.id = m.department_id
         WHERE m.user_id = u.id AND m.deleted_at IS NULL
         ORDER BY d2.sort_order LIMIT 1
       ) d ON TRUE
       WHERE a.for_date = $1 AND d.slug = $2
         AND u.deleted_at IS NULL AND u.employment_status = 'active'
       ORDER BY u.full_name`,
      [today, myDept]
    );
    const hol = await getHoliday(today);
    const deptName = await db.query(`SELECT name FROM departments WHERE slug = $1 LIMIT 1`, [myDept]);
    res.json({
      rows: r.rows,
      holiday: hol,
      dept_slug: myDept,
      dept_name: deptName.rows[0] ? deptName.rows[0].name : myDept
    });
  } catch (err) {
    console.error('[dept/today] failed:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/hr/chronic-idle', requirePermission('hr.dashboard.view'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT f.id, f.user_id, u.full_name, f.detected_at,
              f.window_start, f.window_end, f.days_affected,
              f.events_total, f.total_idle_minutes, f.status,
              f.hr_note, f.hr_actioned_at
       FROM hr_chronic_idle_flags f
       JOIN users u ON u.id = f.user_id
       WHERE f.status = 'open'
       ORDER BY f.detected_at DESC`
    );
    res.json({ flags: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/hr/chronic-idle/:id/decide',
  requirePermission('hr.chronic_idle.action'),
  async (req, res) => {
    const { decision, note } = req.body || {};
    if (decision !== 'acknowledge' && decision !== 'dismiss') {
      return res.status(400).json({ error: 'decision must be acknowledge|dismiss' });
    }
    try {
      const newStatus = decision === 'acknowledge' ? 'acknowledged' : 'dismissed';
      await db.query(
        `UPDATE hr_chronic_idle_flags
         SET status = $1, hr_user_id = $2, hr_note = $3, hr_actioned_at = NOW()
         WHERE id = $4`,
        [newStatus, req.user.id, note || null, req.params.id]
      );
      await logAudit({ req, module: 'hr', action: `chronic_idle.${decision}`,
                      target_type: 'hr_chronic_idle_flag', target_id: req.params.id,
                      after: { note: note || null } });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed' });
    }
  }
);

// ============================================================================
//  CRON HOOKS
// ============================================================================

// ---- 5-minute tick: mark late, fire alerts, escalate idle ----------------
async function tickFiveMinute() {
  try {
    const now = nowInLondon();

    // 1) For every user with status='pending' for today, check if they are past shift_start + grace -> mark late
    //    and if past shift_start + 30 min and still no login -> mark very_late + no_show notification.
    const todays = await db.query(
      `SELECT a.id, a.user_id, a.status, a.shift_start_local, a.shift_end_local,
              a.first_login, a.late_notified_at, a.no_show_notified_at,
              p.grace_minutes,
              COALESCE(u.display_name, u.full_name, 'Someone') AS name
       FROM attendance_day a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN LATERAL (
         SELECT sp.grace_minutes FROM user_department_memberships m
         JOIN departments d ON d.id = m.department_id
         JOIN shift_policies sp ON sp.department_slug = d.slug
         WHERE m.user_id = a.user_id AND m.deleted_at IS NULL
         ORDER BY d.sort_order LIMIT 1
       ) p ON TRUE
       WHERE a.for_date = $1 AND a.status = 'pending' AND a.shift_start_local IS NOT NULL`,
      [now.date]
    );

    for (const row of todays.rows) {
      const grace = row.grace_minutes || 5;
      const minsLate = minutesBetween(now.hhmm, row.shift_start_local);
      if (minsLate <= grace) continue; // still within grace

      // No login yet — mark late, fire alert.
      if (minsLate <= 30 && !row.late_notified_at) {
        await db.query(
          `UPDATE attendance_day SET late_notified_at = NOW(), updated_at = NOW()
           WHERE id = $1`, [row.id]);
        await notifyEvent('attendance.late_arrival', {
          actorUserId: row.user_id,
          name: row.name,
          expectedTime: row.shift_start_local,
          nowTime: now.hhmm,
          related_id: row.id,
        });
      } else if (minsLate > 30 && !row.no_show_notified_at) {
        await db.query(
          `UPDATE attendance_day SET no_show_notified_at = NOW(),
            status = CASE WHEN status='pending' THEN status ELSE status END,
            updated_at = NOW() WHERE id = $1`, [row.id]);
        await notifyEvent('attendance.no_show', {
          actorUserId: row.user_id,
          name: row.name,
          expectedTime: row.shift_start_local,
          nowTime: now.hhmm,
          related_id: row.id,
        });
      }
    }

    // 2) Idle detection — find users with last_active_at > 10 min ago and no open idle_event
    //    Also escalate open events that have crossed 20 min.
    const idleNew = await db.query(
      `SELECT us.user_id, us.last_active_at,
              EXTRACT(EPOCH FROM (NOW() - us.last_active_at))/60 AS mins
       FROM user_status us
       LEFT JOIN idle_events ie
         ON ie.user_id = us.user_id AND ie.ended_at IS NULL
       WHERE us.last_active_at IS NOT NULL
         AND us.status IN ('active','idle')
         AND ie.id IS NULL
         AND us.last_active_at < NOW() - INTERVAL '10 minutes'`
    );

    // Pre-fetch company-wide break window (one read, used in the loop below)
    const companyBreak = await getCompanyBreak();

    for (const u of idleNew.rows) {
      // Skip if during break window (company-wide, set in Admin → Settings)
      let duringBreak = false;
      if (companyBreak) {
        duringBreak = isInWindow(now.hhmm, companyBreak.start_hhmm, companyBreak.end_hhmm);
      }
      if (duringBreak) continue;

      await db.query(
        `INSERT INTO idle_events (user_id, for_date, started_at, hit_10min, during_break)
         VALUES ($1, $2, $3, TRUE, FALSE)`,
        [u.user_id, now.date, u.last_active_at]
      );
    }

    // 3) Escalate 20-minute idle events
    const idleEscalate = await db.query(
      `SELECT ie.id, ie.user_id, ie.started_at,
              EXTRACT(EPOCH FROM (NOW() - ie.started_at))/60 AS mins,
              COALESCE(u.display_name, u.full_name, 'Someone') AS name
       FROM idle_events ie
       JOIN users u ON u.id = ie.user_id
       WHERE ie.ended_at IS NULL
         AND ie.hit_20min = FALSE
         AND ie.agent_acknowledged_at IS NULL
         AND NOW() - ie.started_at >= INTERVAL '20 minutes'`
    );

    for (const e of idleEscalate.rows) {
      await db.query(
        `UPDATE idle_events
         SET hit_20min = TRUE, manager_notified_at = NOW()
         WHERE id = $1`, [e.id]);
      // Format started_at in London 24h time, e.g. "19:05"
      const startedLondon = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(e.started_at));
      await notifyEvent('attendance.idle_extended', {
        actorUserId: e.user_id,
        name: e.name,
        sinceLocalTime: startedLondon,
        related_id: e.id,
      });
    }

    // 4) Close idle events when user becomes active again
    await db.query(
      `UPDATE idle_events
       SET ended_at = NOW(),
           duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at))/60
       WHERE ended_at IS NULL
         AND user_id IN (
           SELECT user_id FROM user_status
           WHERE last_active_at > NOW() - INTERVAL '2 minutes'
             AND status = 'active'
         )`
    );

    // 5) Status maintenance: flip 'active' -> 'idle' after 5 min of no heartbeat;
    //    flip 'idle' -> 'offline' after 30 min of no heartbeat. Don't touch 'on_leave', 'off_sick' etc.
    await db.query(
      `UPDATE user_status
       SET status = 'idle', changed_at = NOW()
       WHERE status = 'active'
         AND last_active_at IS NOT NULL
         AND last_active_at < NOW() - INTERVAL '5 minutes'`
    );
    await db.query(
      `UPDATE user_status
       SET status = 'offline', changed_at = NOW()
       WHERE status = 'idle'
         AND last_active_at IS NOT NULL
         AND last_active_at < NOW() - INTERVAL '30 minutes'`
    );

    // 6) r0.14 — Status nudges. For users sitting on a transient status
    //    (off_sick / heads_down / in_meeting), remind them after 1 hour to
    //    come off it; escalate to their manager after 1.5 hours if still on it.
    //    'changed_at' is when the status was set; status_nudge_at / status_escalated
    //    guard against repeat firing.
    const nudgeStatuses = ['off_sick', 'heads_down', 'in_meeting'];
    const statusNudge = await db.query(
      `SELECT us.user_id, us.status, us.changed_at, us.status_nudge_at, us.status_escalated,
              EXTRACT(EPOCH FROM (NOW() - us.changed_at))/60 AS mins,
              COALESCE(u.display_name, u.full_name, 'Someone') AS name
         FROM user_status us
         JOIN users u ON u.id = us.user_id
        WHERE us.status = ANY($1)
          AND us.changed_at IS NOT NULL`,
      [nudgeStatuses]
    );

    const STATUS_LABELS = { off_sick: 'Feeling sick', heads_down: 'Heads down', in_meeting: 'In meeting' };
    for (const u of statusNudge.rows) {
      const mins = u.mins || 0;
      const label = STATUS_LABELS[u.status] || u.status;
      // 1-hour self nudge (once)
      if (mins >= 60 && !u.status_nudge_at) {
        await db.query(`UPDATE user_status SET status_nudge_at = NOW() WHERE user_id = $1`, [u.user_id]);
        await notifyEvent('status.self_nudge', {
          targetUserId: u.user_id,
          statusLabel: label,
          related_id: u.user_id,
        });
      }
      // 1.5-hour manager escalation (once)
      if (mins >= 90 && !u.status_escalated) {
        await db.query(`UPDATE user_status SET status_escalated = TRUE WHERE user_id = $1`, [u.user_id]);
        await notifyEvent('status.manager_escalation', {
          actorUserId: u.user_id,
          name: u.name,
          statusLabel: label,
          related_id: u.user_id,
        });
      }
    }

  } catch (err) {
    console.error('[cron tickFiveMinute] failed:', err.message);
  }
}

// ---- Daily midnight tick: close yesterday's rows, generate today's --------
async function tickDailyMidnight() {
  try {
    const now = nowInLondon();

    // Close any still-open idle events that are over 30 min — treat as ended at last_active_at.
    await db.query(
      `UPDATE idle_events
       SET ended_at = NOW(),
           duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at))/60
       WHERE ended_at IS NULL AND NOW() - started_at > INTERVAL '30 minutes'`
    );

    // For every active user, ensure today's attendance_day row exists.
    const users = await db.query(
      `SELECT id FROM users WHERE deleted_at IS NULL AND employment_status = 'active'`
    );

    for (const u of users.rows) {
      const expected = await computeExpectedStatus(u.id, now.date);
      const deptSlug = await getUserPrimaryDept(u.id);
      const pol = await getShiftPolicy(deptSlug);
      await db.query(
        `INSERT INTO attendance_day (user_id, for_date, status, shift_start_local, shift_end_local)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, for_date) DO UPDATE
         SET status = CASE WHEN attendance_day.status = 'pending' THEN EXCLUDED.status ELSE attendance_day.status END`,
        [u.id, now.date, expected, pol ? pol.start_time : null, pol ? pol.end_time : null]
      );
    }

    // Finalise yesterday's data — compute active/idle/last_logout from shift_log + idle_events
    // For each yesterday's row, set last_logout from latest logout event on yesterday's calendar day.
    const yesterday = new Date(now.date);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yDate = yesterday.toISOString().slice(0, 10);

    await db.query(
      `UPDATE attendance_day a
       SET last_logout = sub.last_logout,
           updated_at = NOW()
       FROM (
         SELECT user_id, MAX(occurred_at) AS last_logout
         FROM shift_log
         WHERE event_type = 'logout'
           AND (occurred_at AT TIME ZONE 'Europe/London')::date = $1::date
         GROUP BY user_id
       ) sub
       WHERE a.user_id = sub.user_id
         AND a.for_date = $1
         AND a.last_logout IS NULL`,
      [yDate]
    );

    // Recompute idle_minutes from idle_events for yesterday.
    await db.query(
      `UPDATE attendance_day a
       SET idle_minutes = COALESCE(sub.idle_min, 0)
       FROM (
         SELECT user_id, FLOOR(SUM(COALESCE(duration_minutes, 0))) AS idle_min
         FROM idle_events
         WHERE for_date = $1
         GROUP BY user_id
       ) sub
       WHERE a.user_id = sub.user_id AND a.for_date = $1`,
      [yDate]
    );

    // Lock yesterday's daily reports (no more edits allowed).
    await db.query(
      `UPDATE daily_reports
       SET locked_at = NOW()
       WHERE for_date = $1 AND locked_at IS NULL`,
      [yDate]
    );

  } catch (err) {
    console.error('[cron tickDailyMidnight] failed:', err.message);
  }
}

// ---- Weekly Sunday tick: detect chronic idle patterns ---------------------
async function tickWeeklySunday() {
  try {
    // Look at last 10 working days (i.e. last 14 calendar days minus weekends-off if pattern says so).
    // To keep it simple: just count any user who has 4+ days in the last 14 calendar days where they had 2+ idle events.
    const r = await db.query(
      `SELECT user_id,
              COUNT(DISTINCT for_date) FILTER (WHERE event_count >= 2) AS days_with_2plus,
              SUM(event_count) AS total_events,
              SUM(total_min) AS total_min
       FROM (
         SELECT user_id, for_date,
                COUNT(*) AS event_count,
                SUM(COALESCE(duration_minutes, 10)) AS total_min
         FROM idle_events
         WHERE for_date >= (CURRENT_DATE - INTERVAL '14 days')
           AND during_break = FALSE
         GROUP BY user_id, for_date
       ) per_day
       GROUP BY user_id
       HAVING COUNT(DISTINCT for_date) FILTER (WHERE event_count >= 2) >= 4`
    );

    for (const row of r.rows) {
      // Skip if there's already an OPEN flag for this user in the last 14 days
      const existing = await db.query(
        `SELECT id FROM hr_chronic_idle_flags
         WHERE user_id = $1 AND status = 'open'
           AND detected_at > NOW() - INTERVAL '14 days'`,
        [row.user_id]
      );
      if (existing.rows.length > 0) continue;

      const ins = await db.query(
        `INSERT INTO hr_chronic_idle_flags
          (user_id, window_start, window_end, days_affected, events_total, total_idle_minutes)
         VALUES ($1, CURRENT_DATE - INTERVAL '14 days', CURRENT_DATE,
                 $2, $3, $4)
         RETURNING id`,
        [row.user_id, row.days_with_2plus, row.total_events, Math.floor(row.total_min)]
      );

      // Notify HR (one per flag, no spam — this only runs weekly)
      const hr = await db.query(
        `SELECT ug.user_id FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
         WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL`
      );
      const userInfo = await db.query(`SELECT COALESCE(display_name, full_name) AS name FROM users WHERE id = $1`, [row.user_id]);
      await notifyEvent('hr.chronic_idle_flagged', {
        targetUserId: row.user_id,
        targetName: userInfo.rows[0] ? userInfo.rows[0].name : null,
        daysAffected: row.days_with_2plus,
        hrUserIds: hr.rows.map(x => x.user_id),
        related_id: ins.rows[0].id,
      });
    }
  } catch (err) {
    console.error('[cron tickWeeklySunday] failed:', err.message);
  }
}

// Hook: when a user logs in, update attendance_day if status was 'pending'.
// Called from auth.js login flow.
async function recordLogin(userId) {
  try {
    const now = nowInLondon();
    // Ensure today's row exists
    const expected = await computeExpectedStatus(userId, now.date);
    const deptSlug = await getUserPrimaryDept(userId);
    const pol = await getShiftPolicy(deptSlug);
    await db.query(
      `INSERT INTO attendance_day (user_id, for_date, status, shift_start_local, shift_end_local)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, for_date) DO NOTHING`,
      [userId, now.date, expected, pol ? pol.start_time : null, pol ? pol.end_time : null]
    );

    // Now update first_login + status if applicable
    const ad = await db.query(
      `SELECT id, status, first_login, shift_start_local FROM attendance_day
       WHERE user_id = $1 AND for_date = $2`,
      [userId, now.date]
    );
    if (ad.rows.length === 0) return;
    const row = ad.rows[0];

    // Don't override leave/sick/off-pattern with a status flip — but DO note the login.
    const offCategories = ['on_leave','off_sick','off_holiday','off_pattern','off_cs_rota'];

    if (offCategories.includes(row.status)) {
      // User logged in on their day off — track it
      await db.query(
        `UPDATE attendance_day
         SET first_login = COALESCE(first_login, NOW()),
             status = CASE WHEN status IN ('on_leave','off_sick') THEN status ELSE 'worked_voluntary' END,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id]
      );
      return;
    }

    // pending / late / very_late / on_time path
    if (!row.first_login) {
      // First login of the day — set the timestamp & decide status from shift_start_local.
      let newStatus = 'on_time';
      let lateMin = 0;
      if (row.shift_start_local) {
        const lateRaw = minutesBetween(now.hhmm, row.shift_start_local);
        lateMin = Math.max(0, lateRaw);
        const grace = pol ? pol.grace_minutes : 5;
        if (lateMin <= grace) newStatus = 'on_time';
        else if (lateMin <= 30) newStatus = 'late';
        else newStatus = 'very_late';
      }
      await db.query(
        `UPDATE attendance_day
         SET first_login = NOW(),
             status = $1,
             late_minutes = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [newStatus, lateMin, row.id]
      );
    }
  } catch (err) {
    console.error('[recordLogin] failed:', err.message);
  }
}

// Hook: when user logs out, update last_logout for today.
async function recordLogout(userId) {
  try {
    const now = nowInLondon();
    await db.query(
      `UPDATE attendance_day
       SET last_logout = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND for_date = $2`,
      [userId, now.date]
    );
  } catch (err) {
    console.error('[recordLogout] failed:', err.message);
  }
}

// ============================================================================
// Daily Reports — agent submits free-text + auto-fill snapshot.
// One row per user per date. Editable through the day, locks at midnight London.
// HR-2 will add manager review queue on top of these rows.
// ============================================================================

// GET /api/daily-report/today — get today's report for the caller (may not exist yet)
router.get('/daily-report/today', async (req, res) => {
  try {
    const today = nowInLondon().date;
    const r = await db.query(
      `SELECT id, for_date, notes, snapshot_first_login, snapshot_last_logout,
              snapshot_active_min, snapshot_idle_min, snapshot_break_min,
              created_at, updated_at, locked_at
       FROM daily_reports
       WHERE user_id = $1 AND for_date = $2`,
      [req.user.id, today]
    );
    if (!r.rows[0]) {
      return res.json({ report: null, for_date: today, locked: false });
    }
    const row = r.rows[0];
    res.json({ report: row, for_date: today, locked: !!row.locked_at });
  } catch (err) {
    console.error('[daily-report/today] failed:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/daily-report — create or update today's report (upsert)
router.post('/daily-report', requirePermission('daily_report.submit.own'), async (req, res) => {
  const { notes } = req.body || {};
  if (typeof notes !== 'string') {
    return res.status(400).json({ error: 'notes (string) required' });
  }
  if (notes.length > 5000) {
    return res.status(400).json({ error: 'notes too long (max 5000 chars)' });
  }
  try {
    const today = nowInLondon().date;

    // Check if this date is already locked (past midnight in London).
    const existing = await db.query(
      `SELECT id, locked_at FROM daily_reports WHERE user_id = $1 AND for_date = $2`,
      [req.user.id, today]
    );
    if (existing.rows[0] && existing.rows[0].locked_at) {
      return res.status(409).json({ error: 'Report locked (past midnight)' });
    }

    // Pull current attendance snapshot.
    const snap = await db.query(
      `SELECT first_login, last_logout, active_minutes, idle_minutes, break_taken_minutes
       FROM attendance_day WHERE user_id = $1 AND for_date = $2`,
      [req.user.id, today]
    );
    const s = snap.rows[0] || {};

    // Format snapshot times as HH:MM:SS for storage; null if absent.
    const snapFirst = s.first_login ? new Date(s.first_login).toISOString().slice(11, 19) : null;
    const snapLast = s.last_logout ? new Date(s.last_logout).toISOString().slice(11, 19) : null;

    if (existing.rows[0]) {
      // Update path.
      await db.query(
        `UPDATE daily_reports
         SET notes = $1,
             snapshot_first_login = $2,
             snapshot_last_logout = $3,
             snapshot_active_min = $4,
             snapshot_idle_min = $5,
             snapshot_break_min = $6,
             updated_at = NOW()
         WHERE id = $7`,
        [notes, snapFirst, snapLast,
         s.active_minutes || 0, s.idle_minutes || 0, s.break_taken_minutes || 0,
         existing.rows[0].id]
      );
    } else {
      // Insert path.
      await db.query(
        `INSERT INTO daily_reports
           (user_id, for_date, notes,
            snapshot_first_login, snapshot_last_logout,
            snapshot_active_min, snapshot_idle_min, snapshot_break_min)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.user.id, today, notes, snapFirst, snapLast,
         s.active_minutes || 0, s.idle_minutes || 0, s.break_taken_minutes || 0]
      );
    }

    res.json({ ok: true, for_date: today });
  } catch (err) {
    console.error('[daily-report POST] failed:', err.message);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

module.exports = router;
module.exports.tickFiveMinute = tickFiveMinute;
module.exports.tickDailyMidnight = tickDailyMidnight;
module.exports.tickWeeklySunday = tickWeeklySunday;
module.exports.recordLogin = recordLogin;
module.exports.recordLogout = recordLogout;
module.exports.computeExpectedStatus = computeExpectedStatus;
