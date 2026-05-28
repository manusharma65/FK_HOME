// FK Home — /api/me/*
// All endpoints here are about the LOGGED-IN user.
//   GET  /api/me/dashboard       — everything My FK Space needs in one call
//   POST /api/me/status          — set status (active / running_late / on_break / heads_down / off_sick)
//   POST /api/me/late            — report running late (creates lateness_log + sets status)
//   POST /api/me/sick            — report sick today (creates sick_log + sets status)
//   POST /api/me/heartbeat       — client tells us it's alive (every 30s)

const express = require('express');
const { db } = require('../db');
const { requireAuth, logAudit, logShift } = require('../auth');
const { notifyManagersOf, notifyEvent } = require('../notify');

const router = express.Router();

router.use(requireAuth);

// r0.9 — Always use London date for "today". UTC slicing causes off-by-one
// between 23:00-00:00 London during BST.
function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// ---------- DASHBOARD ----------
// Single endpoint that returns everything My FK Space displays.
// Helps avoid waterfall of fetches on page load.
router.get('/dashboard', async (req, res) => {
  const userId = req.user.id;
  // r0.9 — use London date, not UTC, to avoid off-by-one between 23:00-00:00 BST.
  const londonNow = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()); // YYYY-MM-DD in London
  const today = londonNow;
  const year = parseInt(londonNow.slice(0, 4), 10);
  const monthStartIso = londonNow.slice(0, 7) + '-01';

  try {
    const [
      statusRes,
      balanceRes,
      latenessRes,
      sickRes,
      breakRes,
      leaveReqRes,
    ] = await Promise.all([
      db.query(`SELECT status, status_note, status_until FROM user_status WHERE user_id = $1`, [userId]),
      db.query(
        `SELECT entitled_days, carryover_days, taken_days, pending_days,
                adjustment_days, adjustment_note
         FROM leave_balances WHERE user_id = $1 AND year = $2`,
        [userId, year]
      ),
      db.query(
        `SELECT COUNT(*)::int AS late_count_month
         FROM lateness_log
         WHERE user_id = $1 AND for_date >= $2 AND deleted_at IS NULL`,
        [userId, monthStartIso]
      ),
      db.query(
        `SELECT COUNT(*)::int AS sick_count_month
         FROM sick_log
         WHERE user_id = $1 AND start_date >= $2 AND deleted_at IS NULL`,
        [userId, monthStartIso]
      ),
      db.query(
        `SELECT break_start_time::text AS start_time, duration_minutes, timezone
         FROM team_break_schedule WHERE scope = 'company' AND active = TRUE`
      ),
      db.query(
        `SELECT id, request_type, start_date, end_date, total_days, status, decision_note, created_at
         FROM leave_requests
         WHERE user_id = $1 AND start_date >= CURRENT_DATE - INTERVAL '30 days'
         ORDER BY start_date DESC LIMIT 10`,
        [userId]
      ),
    ]);

    // Compute work-day count this month for "on time x of y"
    const workdaysSoFarRes = await db.query(`
      WITH days AS (
        SELECT generate_series(date_trunc('month', CURRENT_DATE)::date, CURRENT_DATE, INTERVAL '1 day')::date AS d
      )
      SELECT COUNT(*)::int AS n FROM days WHERE EXTRACT(DOW FROM d) NOT IN (0,6)
    `);
    const workdaysSoFar = workdaysSoFarRes.rows[0].n;

    const balance = balanceRes.rows[0] || { entitled_days: 0, carryover_days: 0, taken_days: 0, pending_days: 0, adjustment_days: 0, adjustment_note: null };
    const adjustment = Number(balance.adjustment_days || 0);
    const leavesLeft = Number(balance.entitled_days) + Number(balance.carryover_days) + adjustment - Number(balance.taken_days) - Number(balance.pending_days);

    const lateCount = latenessRes.rows[0].late_count_month;
    const sickCount = sickRes.rows[0].sick_count_month;
    const onTimeCount = Math.max(0, workdaysSoFar - lateCount - sickCount);

    res.json({
      user: {
        id: req.user.id,
        full_name: req.user.full_name,
        display_name: req.user.display_name,
        initials: req.user.initials,
        avatar_colour: req.user.avatar_colour,
        date_of_birth: req.user.date_of_birth,
        departments: req.user.departments,
      },
      status: statusRes.rows[0] || { status: 'active', status_note: null, status_until: null },
      leaves: {
        year,
        entitled: Number(balance.entitled_days),
        carryover: Number(balance.carryover_days),
        taken: Number(balance.taken_days),
        pending: Number(balance.pending_days),
        adjustment: adjustment,
        adjustment_note: balance.adjustment_note,
        remaining: Math.round(leavesLeft * 100) / 100,
        recent_requests: leaveReqRes.rows,
      },
      attendance: {
        month_so_far: monthStartIso,
        workdays_so_far: workdaysSoFar,
        on_time_count: onTimeCount,
        late_count: lateCount,
        sick_count: sickCount,
      },
      team_break: breakRes.rows[0] || null,
      permissions: Array.from(req.user.permissions),
    });
  } catch (err) {
    console.error('[me/dashboard] error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ---------- SET STATUS ----------
router.post('/status', async (req, res) => {
  if (!req.user.can('me.status.set')) return res.status(403).json({ error: 'Permission denied' });
  const { status, status_note, status_until, wfh_lat, wfh_lng, wfh_accuracy_m } = req.body || {};
  // r0.14 — added in_meeting + wfh. running_late/on_break kept for existing flows.
  const allowed = ['active','idle','running_late','on_break','heads_down','off_sick','in_meeting','wfh'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });

  // r0.14 — WFH requires a location stamp. No location = no WFH (enforced here;
  // the browser controls the actual permission prompt, but without coords the
  // status cannot be set).
  let lat = null, lng = null, acc = null, locAt = null;
  if (status === 'wfh') {
    const la = Number(wfh_lat), lo = Number(wfh_lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
      return res.status(400).json({ error: 'WFH requires location. Please allow location access to use this status.' });
    }
    lat = la; lng = lo;
    acc = Number.isFinite(Number(wfh_accuracy_m)) ? Number(wfh_accuracy_m) : null;
    locAt = new Date();
  }

  try {
    const prev = await db.query(`SELECT status FROM user_status WHERE user_id = $1`, [req.user.id]);
    const before = prev.rows[0]?.status || 'offline';

    await db.query(
      `INSERT INTO user_status (user_id, status, status_note, status_until, changed_at, last_active_at,
                                wfh_lat, wfh_lng, wfh_accuracy_m, wfh_location_at,
                                status_nudge_at, status_escalated)
       VALUES ($1,$2,$3,$4,NOW(),NOW(),$5,$6,$7,$8,NULL,FALSE)
       ON CONFLICT (user_id) DO UPDATE SET
         status = EXCLUDED.status,
         status_note = EXCLUDED.status_note,
         status_until = EXCLUDED.status_until,
         changed_at = NOW(),
         last_active_at = NOW(),
         wfh_lat = EXCLUDED.wfh_lat,
         wfh_lng = EXCLUDED.wfh_lng,
         wfh_accuracy_m = EXCLUDED.wfh_accuracy_m,
         wfh_location_at = EXCLUDED.wfh_location_at,
         status_nudge_at = NULL,
         status_escalated = FALSE`,
      [req.user.id, status, status_note || null, status_until || null, lat, lng, acc, locAt]
    );
    await logShift({ user_id: req.user.id, event_type: 'status_change', status_before: before, status_after: status, note: status_note, req });
    res.json({ ok: true, status, status_note, status_until });
  } catch (err) {
    console.error('[me/status] error:', err);
    res.status(500).json({ error: 'Failed to set status' });
  }
});

// ---------- REPORT LATE ----------
router.post('/late', async (req, res) => {
  if (!req.user.can('me.lateness.report')) return res.status(403).json({ error: 'Permission denied' });
  const { estimated_arrival, reason } = req.body || {};
  if (!estimated_arrival) return res.status(400).json({ error: 'estimated_arrival required (HH:MM)' });
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(estimated_arrival)) return res.status(400).json({ error: 'Bad time format' });

  const today = londonToday();
  try {
    // Avoid duplicate lateness rows for same user, same date — update instead.
    const existing = await db.query(
      `SELECT id FROM lateness_log WHERE user_id = $1 AND for_date = $2 AND deleted_at IS NULL`,
      [req.user.id, today]
    );
    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE lateness_log SET estimated_arrival = $1, reason = COALESCE($2, reason), reported_at = NOW()
         WHERE id = $3`,
        [estimated_arrival, reason || null, existing.rows[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO lateness_log (user_id, reported_by_user_id, for_date, estimated_arrival, reason)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.user.id, req.user.id, today, estimated_arrival, reason || null]
      );
    }

    // Set status to running_late with auto-clear at the estimated arrival
    const [hh, mm] = estimated_arrival.split(':').map(Number);
    const until = new Date();
    until.setHours(hh, mm, 0, 0);
    if (until < new Date()) until.setDate(until.getDate() + 1); // if past, push to tomorrow

    await db.query(
      `INSERT INTO user_status (user_id, status, status_note, status_until, changed_at)
       VALUES ($1, 'running_late', $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         status = 'running_late',
         status_note = EXCLUDED.status_note,
         status_until = EXCLUDED.status_until,
         changed_at = NOW()`,
      [req.user.id, reason || `Arriving ${estimated_arrival}`, until.toISOString()]
    );

    await logShift({ user_id: req.user.id, event_type: 'status_change', status_after: 'running_late', note: `Est ${estimated_arrival}`, req });
    await logAudit({ req, module: 'me', action: 'lateness.reported', after: { date: today, estimated_arrival, reason } });

    // Notify managers / Bobby / HR
    await notifyEvent('lateness.reported', {
      actorUserId: req.user.id,
      name: req.user.display_name || req.user.full_name,
      estimatedArrival: estimated_arrival,
      reason: reason || null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[me/late] error:', err);
    res.status(500).json({ error: 'Failed to report late' });
  }
});

// ---------- REPORT SICK ----------
router.post('/sick', async (req, res) => {
  if (!req.user.can('me.sick.report')) return res.status(403).json({ error: 'Permission denied' });
  const { reason, end_date } = req.body || {};
  const today = londonToday();

  try {
    const existing = await db.query(
      `SELECT id FROM sick_log WHERE user_id = $1 AND start_date = $2 AND deleted_at IS NULL`,
      [req.user.id, today]
    );
    if (existing.rows.length === 0) {
      await db.query(
        `INSERT INTO sick_log (user_id, reported_by_user_id, start_date, end_date, reason)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.user.id, req.user.id, today, end_date || null, reason || null]
      );
    } else {
      await db.query(
        `UPDATE sick_log SET end_date = $1, reason = COALESCE($2, reason), reported_at = NOW()
         WHERE id = $3`,
        [end_date || null, reason || null, existing.rows[0].id]
      );
    }

    await db.query(
      `INSERT INTO user_status (user_id, status, status_note, changed_at)
       VALUES ($1, 'off_sick', $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET status = 'off_sick', status_note = EXCLUDED.status_note, changed_at = NOW()`,
      [req.user.id, reason || 'Off sick today']
    );

    // r0.7 — Compute notice hours and write to attendance_day.
    // If notified ≥4 hours before shift start, treat as paid (deduct from annual leave balance).
    // If notified <4 hours, treat as unpaid (no balance hit).
    let noticeHours = null;
    try {
      const adRow = await db.query(
        `SELECT id, shift_start_local FROM attendance_day
         WHERE user_id = $1 AND for_date = $2`,
        [req.user.id, today]
      );
      let shiftStartLocal = adRow.rows[0]?.shift_start_local;
      if (!shiftStartLocal) {
        // Get from policy
        const pol = await db.query(
          `SELECT sp.start_time FROM shift_policies sp
           JOIN departments d ON d.slug = sp.department_slug
           JOIN user_department_memberships m ON m.department_id = d.id
           WHERE m.user_id = $1 AND m.deleted_at IS NULL
           ORDER BY m.is_primary DESC LIMIT 1`,
          [req.user.id]
        );
        if (pol.rows[0]) shiftStartLocal = pol.rows[0].start_time;
      }
      if (shiftStartLocal) {
        // shiftStartLocal is like '07:30:00'. Today's start in London = today + that time.
        const [hh, mm] = String(shiftStartLocal).split(':').map(Number);
        const shiftStart = new Date(today + 'T' + String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0') + ':00');
        const diffMs = shiftStart.getTime() - Date.now();
        noticeHours = Math.round((diffMs / 3600000) * 100) / 100; // hours, 2dp
        const isPaid = noticeHours >= 4;

        // Upsert attendance_day for today
        if (adRow.rows[0]) {
          await db.query(
            `UPDATE attendance_day
             SET status = 'off_sick',
                 sick_notified_hours = $1,
                 is_paid = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [noticeHours, isPaid, adRow.rows[0].id]
          );
        } else {
          await db.query(
            `INSERT INTO attendance_day (user_id, for_date, status, sick_notified_hours, is_paid)
             VALUES ($1, $2, 'off_sick', $3, $4)
             ON CONFLICT (user_id, for_date) DO UPDATE
               SET status = 'off_sick',
                   sick_notified_hours = EXCLUDED.sick_notified_hours,
                   is_paid = EXCLUDED.is_paid,
                   updated_at = NOW()`,
            [req.user.id, today, noticeHours, isPaid]
          );
        }

        if (isPaid) {
          // Deduct 1 day from annual leave (sick day paid out of annual balance per policy).
          const year = new Date(today).getFullYear();
          await db.query(
            `INSERT INTO leave_balances (user_id, year, taken_days)
             VALUES ($1, $2, 1)
             ON CONFLICT (user_id, year) DO UPDATE
               SET taken_days = leave_balances.taken_days + 1, updated_at = NOW()`,
            [req.user.id, year]
          );
          await db.query(
            `INSERT INTO leave_accrual_log
               (user_id, year, event_date, event_type, days_delta, note, actor_user_id)
             VALUES ($1, $2, $3, 'leave_taken', -1, $4, $5)`,
            [req.user.id, year, today,
             `Sick day paid from annual leave (notified ${noticeHours}h before shift)`,
             req.user.id]
          );
        } else {
          await db.query(
            `INSERT INTO leave_accrual_log
               (user_id, year, event_date, event_type, days_delta, note)
             VALUES ($1, $2, $3, 'sick_late_notice', 0, $4)`,
            [req.user.id, new Date(today).getFullYear(), today,
             `Sick reported only ${noticeHours}h before shift — unpaid day, no balance hit`]
          );
        }
      }
    } catch (err) {
      console.error('[me/sick] notice-hours calc failed:', err.message);
    }

    await logShift({ user_id: req.user.id, event_type: 'status_change', status_after: 'off_sick', note: reason, req });
    await logAudit({ req, module: 'me', action: 'sick.reported',
                     after: { date: today, reason, end_date, notice_hours: noticeHours } });

    // Notify managers / Bobby / HR
    const paidNote = noticeHours !== null
      ? (noticeHours >= 4 ? ' · Paid (from annual leave)' : ` · Unpaid (only ${noticeHours}h notice)`)
      : '';
    await notifyEvent('sick.reported', {
      actorUserId: req.user.id,
      name: req.user.display_name || req.user.full_name,
      reason: reason || null,
      paidNote,
    });

    res.json({ ok: true, notice_hours: noticeHours });
  } catch (err) {
    console.error('[me/sick] error:', err);
    res.status(500).json({ error: 'Failed to report sick' });
  }
});

// ---------- HEARTBEAT ----------
// Client sends every 30s while page is in focus.
// If we don't hear from a user for 10 min, they become idle.
router.post('/heartbeat', async (req, res) => {
  try {
    await db.query(
      `INSERT INTO user_status (user_id, status, last_active_at, changed_at)
       VALUES ($1, 'active', NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         last_active_at = NOW(),
         status = CASE
           WHEN user_status.status IN ('idle','offline') THEN 'active'
           ELSE user_status.status
         END`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

module.exports = router;
