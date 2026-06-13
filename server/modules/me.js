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
const { notify, notifyManagersOf, notifyEvent, getGroupMembers } = require('../notify');
const { isMobileRequest } = require('./device');

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
        group_slugs: req.user.group_slugs,
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

// ---------- GET /api/me/attention — owner / manager home cockpit (r1.20) ----------
// Four panels: decisions waiting on you, who's out today, things to watch,
// and yesterday's quiet digest. Scoped to what the viewer can actually act on.
router.get('/attention', async (req, res) => {
  const fmtLondon = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = fmtLondon(new Date());
  const yest = fmtLondon(new Date(Date.now() - 86400000));
  const canViewAnyAtt = req.user.can('attendance.view.any');
  const ownDeptIds = (req.user.departments || []).filter(d => d.role === 'manager' || d.role === 'lead').map(d => d.id);
  // r1.20 away-cover — inherit the leave-approval scope of anyone I'm currently covering.
  let cover = { any: false, deptIds: [] };
  try {
    const cv = await db.query(`SELECT scope_any, dept_ids FROM approval_cover WHERE deputy_user_id=$1 AND active=TRUE`, [req.user.id]);
    for (const row of cv.rows) { if (row.scope_any) cover.any = true; if (Array.isArray(row.dept_ids)) cover.deptIds = cover.deptIds.concat(row.dept_ids); }
  } catch (e) { /* table may not exist before migration */ }
  const canAnyLeave = req.user.can('leaves.approve.any') || cover.any;
  const effDeptIds = Array.from(new Set([...ownDeptIds, ...cover.deptIds]));

  // Working days elapsed since an ISO timestamp (for the 3-day escalation rule).
  function workingDaysSince(iso) {
    if (!iso) return 0;
    let c = 0; const cur = new Date(iso); const now = new Date();
    while (cur < now) { const dow = cur.getDay(); if (dow !== 0 && dow !== 6) c++; cur.setDate(cur.getDate() + 1); }
    return Math.max(0, c - 1);
  }

  try {
    // ---- 1. WAITING: pending leave approvals I can action ----
    let waiting = [];
    if (canAnyLeave || effDeptIds.length) {
      const q = canAnyLeave
        ? { sql: `SELECT lr.id, lr.user_id, lr.request_type, lr.start_date::text AS start_date,
                          lr.end_date::text AS end_date, lr.total_days, lr.created_at,
                          u.display_name, u.full_name, u.avatar_colour, u.initials
                   FROM leave_requests lr JOIN users u ON u.id=lr.user_id
                   WHERE lr.status='pending' ORDER BY lr.created_at ASC`, p: [] }
        : { sql: `SELECT DISTINCT lr.id, lr.user_id, lr.request_type, lr.start_date::text AS start_date,
                          lr.end_date::text AS end_date, lr.total_days, lr.created_at,
                          u.display_name, u.full_name, u.avatar_colour, u.initials
                   FROM leave_requests lr JOIN users u ON u.id=lr.user_id
                   JOIN user_department_memberships m ON m.user_id=u.id AND m.deleted_at IS NULL
                   WHERE lr.status='pending' AND m.department_id = ANY($1::int[]) ORDER BY lr.created_at ASC`, p: [effDeptIds] };
      waiting = (await db.query(q.sql, q.p)).rows.map(r => {
        const age = workingDaysSince(r.created_at);
        return {
          type: 'leave', id: r.id, user_id: r.user_id,
          name: r.display_name || r.full_name, initials: r.initials, colour: r.avatar_colour,
          title: 'Leave request — ' + (r.display_name || r.full_name),
          detail: (r.total_days ? r.total_days + ' day' + (Number(r.total_days) === 1 ? '' : 's') + ' · ' : '') + r.start_date + ' to ' + r.end_date,
          severity: age >= 3 ? 'now' : 'soon', escalated: age >= 3, age_days: age,
        };
      });
    }

    // ---- 2. PRESENCE: who's out today (company-wide; 'mine' flags my own team) ----
    const present = (await db.query(
      `SELECT u.id, u.display_name, u.full_name, u.initials, u.avatar_colour, ad.status,
              (SELECT d.name FROM user_department_memberships m JOIN departments d ON d.id=m.department_id
                 WHERE m.user_id=u.id AND m.deleted_at IS NULL ORDER BY m.is_primary DESC LIMIT 1) AS dept,
              (SELECT lr.end_date::text FROM leave_requests lr
                 WHERE lr.user_id=u.id AND lr.status='approved' AND $1 BETWEEN lr.start_date AND lr.end_date
                 ORDER BY lr.end_date DESC LIMIT 1) AS leave_until,
              (u.manager_user_id = $2 OR EXISTS (
                 SELECT 1 FROM user_department_memberships mm
                   JOIN user_department_memberships mgr ON mgr.department_id = mm.department_id
                  WHERE mm.user_id = u.id AND mm.deleted_at IS NULL
                    AND mgr.user_id = $2 AND mgr.role IN ('manager','lead') AND mgr.deleted_at IS NULL
              )) AS mine
       FROM users u JOIN attendance_day ad ON ad.user_id=u.id AND ad.for_date=$1
       WHERE u.deleted_at IS NULL AND u.employment_status='active'
         AND ad.status IN ('on_leave','off_sick','wfh','off_holiday')
       ORDER BY ad.status, u.display_name`,
      [today, req.user.id])).rows;

    // ---- 3. WATCH ----
    const overdue_reviews = (await db.query(
      `SELECT t.id, t.title, t.kind, t.due_at::text AS due_at, u.display_name, u.full_name
       FROM tasks t LEFT JOIN users u ON u.id=t.assignee_user_id
       WHERE t.kind IN ('review','probation','onboarding') AND t.status='overdue'
       ORDER BY t.due_at ASC NULLS LAST LIMIT 20`)).rows;
    const leavers = (await db.query(
      `SELECT id, display_name, full_name, last_working_day::text AS last_working_day
       FROM users WHERE last_working_day IS NOT NULL AND employment_status <> 'left'
         AND last_working_day >= CURRENT_DATE AND last_working_day <= CURRENT_DATE + INTERVAL '21 days'
       ORDER BY last_working_day ASC`)).rows;
    const probation = (await db.query(
      `SELECT id, display_name, full_name, probation_end_date::text AS probation_end_date
       FROM users WHERE probation_end_date IS NOT NULL AND employment_status='active'
         AND probation_end_date >= CURRENT_DATE - INTERVAL '3 days'
         AND probation_end_date <= CURRENT_DATE + INTERVAL '10 days'
       ORDER BY probation_end_date ASC`)).rows;

    // ---- 4. YESTERDAY DIGEST ----
    const dig = (await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND employment_status='active') AS active,
         (SELECT COUNT(*)::int FROM daily_reports WHERE for_date=$1 AND submitted_at IS NOT NULL) AS filed,
         (SELECT COUNT(*)::int FROM lateness_log WHERE for_date=$1 AND deleted_at IS NULL) AS late`,
      [yest])).rows[0];

    // Am I (the viewer) currently being covered by a deputy?
    let cover_state = { active: false };
    try {
      const mc = (await db.query(
        `SELECT c.active, c.deputy_user_id, u.display_name, u.full_name
           FROM approval_cover c JOIN users u ON u.id=c.deputy_user_id
          WHERE c.covered_user_id=$1`, [req.user.id])).rows[0];
      if (mc) cover_state = { active: !!mc.active, deputy_id: mc.deputy_user_id, deputy_name: mc.display_name || mc.full_name };
    } catch (e) { /* table may not exist before migration */ }

    res.json({
      today, yesterday: yest,
      waiting,
      present,
      watch: { overdue_reviews, leavers, probation },
      yesterday_digest: { active: dig.active, filed: dig.filed, late: dig.late },
      can_view_any_attendance: canViewAnyAtt,
      cover_state,
      can_set_cover: req.user.can('leaves.approve.any') || ownDeptIds.length > 0,
    });
  } catch (e) {
    console.error('[me/attention] failed:', e.message);
    res.status(500).json({ error: 'Failed to load attention view' });
  }
});

// ---------- POST /api/me/cover — away-cover toggle (deputy power #3) ----------
// Hand my own leave-approval queue to a deputy while I'm away (and take it back).
// Captures MY current approval scope so the deputy inherits exactly that — no more.
// Oversight is preserved: the deputy's decisions are stamped + audited under their
// own id, so it's always visible who actually decided.
router.post('/cover', async (req, res) => {
  const on = !!(req.body || {}).on;
  const me = req.user.id;
  const canAny = req.user.can('leaves.approve.any');
  const ownDeptIds = (req.user.departments || []).filter(d => d.role === 'manager' || d.role === 'lead').map(d => d.id);
  if (!canAny && ownDeptIds.length === 0) return res.status(403).json({ error: 'You have no approval queue to hand over' });
  try {
    if (!on) {
      await db.query(`UPDATE approval_cover SET active=FALSE, updated_at=now() WHERE covered_user_id=$1`, [me]);
      await logAudit({ req, module: 'me', action: 'cover.ended', target_type: 'user', target_id: me });
      return res.json({ ok: true, active: false });
    }
    // Resolve the deputy: explicit pick, else the single active Operations Deputy.
    let deputyId = (req.body || {}).deputy_user_id ? parseInt((req.body).deputy_user_id, 10) : null;
    if (!deputyId) {
      const dep = await db.query(
        `SELECT u.id FROM users u JOIN user_groups ug ON ug.user_id=u.id JOIN groups g ON g.id=ug.group_id
          WHERE g.slug='ops-deputy' AND u.deleted_at IS NULL AND u.employment_status='active'`);
      if (dep.rows.length === 1) deputyId = dep.rows[0].id;
      else if (dep.rows.length === 0) return res.status(400).json({ error: 'No deputy available — pick one' });
      else return res.status(400).json({ error: 'More than one deputy — pick one', candidates: dep.rows.map(r => r.id) });
    }
    if (deputyId === me) return res.status(400).json({ error: 'You can\'t cover yourself' });
    const dchk = await db.query(`SELECT id, display_name, full_name FROM users WHERE id=$1 AND deleted_at IS NULL AND employment_status='active'`, [deputyId]);
    if (dchk.rows.length === 0) return res.status(400).json({ error: 'Unknown deputy' });
    await db.query(
      `INSERT INTO approval_cover (covered_user_id, deputy_user_id, scope_any, dept_ids, active, started_at, updated_at)
       VALUES ($1,$2,$3,$4,TRUE,now(),now())
       ON CONFLICT (covered_user_id) DO UPDATE SET deputy_user_id=$2, scope_any=$3, dept_ids=$4, active=TRUE, started_at=now(), updated_at=now()`,
      [me, deputyId, canAny, ownDeptIds]);
    await logAudit({ req, module: 'me', action: 'cover.started', target_type: 'user', target_id: deputyId, after: { covered: me, scope_any: canAny, dept_ids: ownDeptIds } });
    const d = dchk.rows[0];
    return res.json({ ok: true, active: true, deputy_id: deputyId, deputy_name: d.display_name || d.full_name });
  } catch (e) {
    console.error('[me/cover] failed:', e.message);
    res.status(500).json({ error: 'Failed to set cover' });
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

    // r0.20.2 — when WFH is set, notify owner + HR so they can see where the
    // person is (location pin shows on their status in My People).
    if (status === 'wfh') {
      try {
        const [owners, hr] = await Promise.all([getGroupMembers('owner'), getGroupMembers('hr-team')]);
        const recips = [...new Set([...owners, ...hr])].filter(uid => uid !== req.user.id);
        if (recips.length > 0) {
          await notifyEvent('status.wfh_set', {
            userIds: recips,
            name: req.user.display_name || req.user.full_name,
            hasLocation: lat != null && lng != null,
            actorUserId: req.user.id,
          });
        }
      } catch (e) { console.error('[me/status] wfh notify failed:', e.message); }
    }

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

    // r1.20 deputy power #2 — also notify the Operations Deputy of every lateness
    // (notify-only; HR still owns the action).
    try {
      const deps = (await getGroupMembers('ops-deputy')).filter(id => id !== req.user.id);
      if (deps.length) await notify({ userIds: deps, type: 'lateness_deputy',
        title: 'Someone\u2019s running late',
        body: (req.user.display_name || req.user.full_name) + ' \u2014 arriving ' + estimated_arrival,
        action_url: '#hr/today', related_user_id: req.user.id });
    } catch (e) { console.error('[me/late] deputy notify failed:', e.message); }

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
    const mobile = isMobileRequest(req);
    // On a phone we keep the session alive (last_active_at) but never flip the
    // user to 'active' — presence and arrival are office-device actions, so a
    // phone in someone's pocket can't show them "at work".
    await db.query(
      `INSERT INTO user_status (user_id, status, last_active_at, changed_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         last_active_at = NOW(),
         status = CASE
           WHEN $3::bool THEN user_status.status
           WHEN user_status.status IN ('idle','offline') THEN 'active'
           ELSE user_status.status
         END`,
      [req.user.id, mobile ? 'offline' : 'active', mobile]
    );
    // r0.30 — login = clock-in. On the first heartbeat of the day, record
    // first_login + late_minutes + flip the day's status, so the calendar
    // (reads attendance_day) and the late count agree. Cheap no-op after the
    // first write because first_login is already set. Mobile is gated inside.
    try { await recordClockIn(req.user.id, mobile); } catch (e) { console.error('[clock-in]', e.message); }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// Record the clock-in for today on the user's first activity. Idempotent: only
// writes first_login/late_minutes/status if first_login is not yet set, and only
// for days the user was expected to work (status 'pending'/'working'/late) — never
// overrides on_leave/off_sick/off_holiday/off_pattern/off_cs_rota.
async function recordClockIn(userId, isMobile) {
  const today = londonToday();
  const ad = await db.query(
    `SELECT id, status, first_login, shift_start_local FROM attendance_day
      WHERE user_id = $1 AND for_date = $2`, [userId, today]);
  let row = ad.rows[0];
  // If the day row doesn't exist yet (cron hasn't seeded), create a 'pending' one
  // with the shift start from policy so we can compute lateness.
  if (!row) {
    const pol = await db.query(
      `SELECT sp.start_time FROM shift_policies sp
         JOIN departments d ON d.slug = sp.department_slug
         JOIN user_department_memberships m ON m.department_id = d.id
        WHERE m.user_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.is_primary DESC LIMIT 1`, [userId]);
    const shiftStart = pol.rows[0] ? pol.rows[0].start_time : null;
    const ins = await db.query(
      `INSERT INTO attendance_day (user_id, for_date, status, shift_start_local)
       VALUES ($1, $2, 'pending', $3)
       ON CONFLICT (user_id, for_date) DO UPDATE SET updated_at = NOW()
       RETURNING id, status, first_login, shift_start_local`,
      [userId, today, shiftStart]);
    row = ins.rows[0];
  }
  // Already clocked in today, or the day is an off/leave/sick day — leave it.
  if (row.first_login) return;
  const offStatuses = ['on_leave','off_sick','off_holiday','off_pattern','off_cs_rota'];
  if (offStatuses.includes(row.status)) return;

  // Mobile keeps you logged in but does NOT stamp the official arrival — that
  // happens on an office device. The day row already exists (pending), so the
  // calendar isn't blank; it just waits for the desk login to set the time.
  if (isMobile) return;

  // Compute lateness vs shift start (London wall-clock).
  const now = nowLondonHHMM();
  let lateMinutes = 0;
  let newStatus = 'on_time';
  if (row.shift_start_local) {
    lateMinutes = Math.max(0, minutesBetweenHHMM(now, String(row.shift_start_local).slice(0,5)));
    // grace is applied by the lateness pipeline elsewhere; store raw minutes,
    // mark late only if past start. Must use values the attendance_day status
    // CHECK allows ('on_time'/'late'/'very_late') — never 'working'.
    if (lateMinutes > 30) newStatus = 'very_late';
    else if (lateMinutes > 0) newStatus = 'late';
  }
  await db.query(
    `UPDATE attendance_day
        SET first_login = NOW(),
            late_minutes = $1,
            status = CASE WHEN status = 'pending' THEN $2 ELSE status END,
            updated_at = NOW()
      WHERE id = $3`,
    [lateMinutes, newStatus, row.id]);
}

// London HH:MM now.
function nowLondonHHMM() {
  return new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/London', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date());
}
// minutes that `hhmm` is after `startHHMM` (0 if before/equal).
function minutesBetweenHHMM(hhmm, startHHMM) {
  const [h1,m1] = hhmm.split(':').map(Number);
  const [h2,m2] = startHHMM.split(':').map(Number);
  return (h1*60+m1) - (h2*60+m2);
}

module.exports = router;
