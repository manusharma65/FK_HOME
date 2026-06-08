// FK Home — /api/daily/* — HR performance & conduct engine (r0.72)
// ----------------------------------------------------------------------------
// One engine, three views. assessDay() builds a person's day (drives "Today",
// "HR today", and the midnight freeze). scoreWeek() turns frozen days into the
// weekly band. The conduct ledger accumulates breaches separately from the
// score. Reuses the LIVE pieces — daily_reports submit/lock, lateness marking,
// and chronic-idle flags — rather than rebuilding them.
//
// Endpoints:
//   GET  /api/daily/me?date=            — my day (Today)
//   GET  /api/daily/team?date=          — direct reports' days (HR today; owner/mgr)
//   POST /api/daily/manual-item         — add an off-system item to my day
//   POST /api/daily/submit              — submit my day (sets submitted_at)
//   GET  /api/daily/score?week=&user_id=— weekly score + breakdown + trend + ledger
//   POST /api/daily/score/quality       — owner quality override (logged)
//   POST /api/daily/recognition         — manager logs a positive
//
// Weights/bands/points are CONSTANTS here (tunable) — not a config table.
// ----------------------------------------------------------------------------

const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePermission, logAudit } = require('../auth');
const { notify, notifyManagersOf } = require('../notify');
const attendance = require('./attendance');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------- constants
const OFF_STATUSES     = ['on_leave', 'off_sick', 'off_pattern', 'off_cs_rota', 'off_holiday'];
const LATE_STATUSES    = ['late', 'very_late'];
const OPEN_STATUSES    = ['pending', 'open', 'due', 'overdue'];

const HIRING_CATS   = ['recruitment', 'hiring', 'interview'];
const ACCURACY_CATS = ['onboarding', 'offboarding', 'paperwork', 'compliance'];

const WEIGHTS      = { sla: 40, hiring: 20, accuracy: 15, conduct: 10, quality: 15 };
const LATE_CREDIT  = 0.4;            // a late-but-done item earns 40% credit
const QUALITY_NEUTRAL = 15;          // quality defaults to full unless owner lowers it

const LEDGER_POINTS = {
  late_reported: 0.5, late_nonotice: 1, left_early: 1,
  unauth_absence: 2, noshow_nonotify: 3, over_break: 1, chronic_idle: 1,
};
const LEDGER_STEPS = [               // checked high→low
  { at: 9, step: 'Final / formal review' },
  { at: 6, step: 'Written warning' },
  { at: 4, step: 'Coaching conversation' },
];

const DETAIL_RETENTION_DAYS = 395;   // storage: keep day detail ~13 months (scores kept forever)
const SELF_VIEW_DAYS        = 90;    // a person sees their own day detail 90 days back
const MANUAL_DAILY_CAP      = 5;     // manual items that count toward score per day

const BAND_ORDER = ['Poor', 'Average', 'Good', 'Excellent', 'Above Expectations'];
const BAND_RAISE = {
  'Poor': '0% + performance plan', 'Average': 'up to 5%', 'Good': 'up to 10%',
  'Excellent': 'up to 15%', 'Above Expectations': 'up to 20%',
};

// HR is held to a high bar: 95%+ correct = Good (the expected level).
function hrBandFromCorrectness(pct) {
  if (pct >= 99.5) return 'Above Expectations';
  if (pct >= 98)   return 'Excellent';
  if (pct >= 95)   return 'Good';
  if (pct >= 90)   return 'Average';
  return 'Poor';
}
function capBandAt(band, capName) {
  if (BAND_ORDER.indexOf(band) > BAND_ORDER.indexOf(capName)) return capName;
  return band;
}
function dropOneBand(band) {
  const i = BAND_ORDER.indexOf(band);
  return BAND_ORDER[Math.max(0, i - 1)];
}

// ---------------------------------------------------------------- date utils
function londonDate(d) {
  const dt = d ? new Date(d) : new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(dt); // YYYY-MM-DD
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();               // 0=Sun..6=Sat
  const back = (dow === 0) ? 6 : dow - 1;  // days back to Monday
  return addDays(dateStr, -back);
}
function pillarFor(category) {
  const c = (category || '').toLowerCase();
  if (HIRING_CATS.includes(c)) return 'hiring';
  if (ACCURACY_CATS.includes(c)) return 'accuracy';
  return 'sla';
}

// ---------------------------------------------------------------- assessDay
// Builds one person's day: what they did (auto + manual), what's on their
// plate, attendance, and any flags. Pure read — used live and at freeze.
async function assessDay(userId, dateStr) {
  // Tasks completed that day, by this person
  const done = await db.query(
    `SELECT id, title, category, completed_at
       FROM tasks
      WHERE completed_by_user_id = $1 AND status = 'done'
        AND (completed_at AT TIME ZONE 'Europe/London')::date = $2::date
      ORDER BY completed_at`,
    [userId, dateStr]
  );

  // Open queue assigned to them
  const queue = await db.query(
    `SELECT id, title, category, due_at, status
       FROM tasks
      WHERE assignee_user_id = $1 AND status = ANY($2)
      ORDER BY due_at NULLS LAST
      LIMIT 50`,
    [userId, OPEN_STATUSES]
  );

  // Attendance row + manual items from the day's report
  const att = await db.query(
    `SELECT status, first_login, last_logout, active_minutes, idle_minutes,
            break_taken_minutes, late_minutes, shift_start_local, shift_end_local
       FROM attendance_day WHERE user_id = $1 AND for_date = $2`,
    [userId, dateStr]
  );
  const rep = await db.query(
    `SELECT manual_items, submitted_at, locked_at
       FROM daily_reports WHERE user_id = $1 AND for_date = $2`,
    [userId, dateStr]
  );
  const a = att.rows[0] || {};
  const r = rep.rows[0] || {};
  const manual = Array.isArray(r.manual_items) ? r.manual_items : [];

  // Flags (for HR today). Off days never flag.
  const flags = [];
  const isOff = OFF_STATUSES.includes(a.status);
  if (!isOff) {
    if (a.status === 'no_show') flags.push({ kind: 'absence', text: 'Unauthorised absence — no clock-in, no leave/sick' });
    if (LATE_STATUSES.includes(a.status)) flags.push({ kind: 'late', text: 'Logged in late' });
    if (done.rows.length === 0 && manual.length === 0 && a.first_login) {
      flags.push({ kind: 'quiet', text: 'Nothing cleared yet today' });
    }
    if (!r.submitted_at && a.status !== 'pending') {
      flags.push({ kind: 'unsubmitted', text: 'Day not submitted' });
    }
  }
  // An item that tipped overdue today
  const breached = await db.query(
    `SELECT COUNT(*)::int AS n FROM tasks
      WHERE assignee_user_id = $1 AND status = 'overdue'
        AND (due_at AT TIME ZONE 'Europe/London')::date = $2::date`,
    [userId, dateStr]
  );
  if (breached.rows[0] && breached.rows[0].n > 0) {
    flags.push({ kind: 'sla', text: breached.rows[0].n + ' item(s) went past their deadline today' });
  }

  return {
    date: dateStr,
    did: done.rows,
    manual,
    queue: queue.rows,
    attendance: a,
    off: isOff,
    submitted: !!r.submitted_at,
    flags,
  };
}

// ---------------------------------------------------------------- conduct ledger
// Derive conduct rows for a day from confirmed signals. Idempotent (UNIQUE).
async function ledgerForDay(userId, dateStr) {
  const att = await db.query(
    `SELECT status, break_taken_minutes, no_show_notified_at, late_notified_at
       FROM attendance_day WHERE user_id = $1 AND for_date = $2`,
    [userId, dateStr]
  );
  const a = att.rows[0];
  if (!a || OFF_STATUSES.includes(a.status)) return; // off days never accrue

  const expires = addDays(dateStr, 365);
  const add = async (kind, note) => {
    await db.query(
      `INSERT INTO attendance_ledger (user_id, occurred_on, kind, points, note, expires_on)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, occurred_on, kind) DO NOTHING`,
      [userId, dateStr, kind, LEDGER_POINTS[kind], note || null, expires]
    );
  };

  // Lateness — reported (notice given) vs no notice
  if (LATE_STATUSES.includes(a.status)) {
    const ln = await db.query(
      `SELECT hr_status FROM lateness_log
        WHERE user_id = $1 AND for_date = $2 AND deleted_at IS NULL
        ORDER BY reported_at DESC LIMIT 1`,
      [userId, dateStr]
    );
    const row = ln.rows[0];
    if (!row || row.hr_status !== 'excused') {
      await add(row ? 'late_reported' : 'late_nonotice', 'Auto from attendance');
    }
  }
  // Unauthorised absence (no_show = expected, never logged in, not covered)
  if (a.status === 'no_show') {
    await add(a.no_show_notified_at ? 'unauth_absence' : 'noshow_nonotify', 'Auto from attendance');
  }
  // Over-break
  const brk = await db.query(`SELECT duration_minutes FROM team_break_schedule WHERE active = TRUE LIMIT 1`);
  const allow = brk.rows[0] ? brk.rows[0].duration_minutes : 0;
  if (allow && a.break_taken_minutes > allow) await add('over_break', 'Break over allowance');
}

async function ledgerStanding(userId) {
  const r = await db.query(
    `SELECT COALESCE(SUM(points), 0)::numeric AS pts
       FROM attendance_ledger
      WHERE user_id = $1 AND excused = FALSE AND expires_on >= CURRENT_DATE`,
    [userId]
  );
  const pts = Number(r.rows[0].pts || 0);
  let nextStep = null;
  for (let i = LEDGER_STEPS.length - 1; i >= 0; i--) {
    if (pts < LEDGER_STEPS[i].at) { nextStep = LEDGER_STEPS[i]; break; }
  }
  let reached = null;
  for (const s of LEDGER_STEPS) { if (pts >= s.at) { reached = s; break; } }
  return { points: pts, nextStep, reached };
}

// ---------------------------------------------------------------- scoreWeek
// Shift a deadline forward over the owner's EXCUSED-off days (approved leave,
// sick, rostered/holiday off) to the end of their first working day back. An
// unauthorised absence (no_show) does NOT pause it, and a day they actually
// attended ends the walk — so an item already overdue before they went off is
// not retroactively excused. Reads finalised attendance_day statuses. Capped.
async function effectiveDue(userId, dueAt) {
  let d = new Date(dueAt);
  for (let i = 0; i < 21; i++) {
    const ds = d.toISOString().slice(0, 10);
    const r = await db.query(`SELECT status FROM attendance_day WHERE user_id = $1 AND for_date = $2`, [userId, ds]);
    const st = r.rows[0] ? r.rows[0].status : null;
    if (st && OFF_STATUSES.includes(st)) { d = new Date(d.getTime() + 86400000); continue; }
    break; // working / present / no_show / unknown → the deadline lands here
  }
  return d;
}

async function scoreWeek(userId, weekStart) {
  const weekEnd = addDays(weekStart, 7); // exclusive
  // Deadline-bearing items due this week
  const items = await db.query(
    `SELECT category, status, due_at, completed_at
       FROM tasks
      WHERE assignee_user_id = $1
        AND due_at >= $2::date AND due_at < $3::date`,
    [userId, weekStart, weekEnd]
  );
  const tally = { sla: { e: 0, n: 0 }, hiring: { e: 0, n: 0 }, accuracy: { e: 0, n: 0 } };
  let anyNotDone = false;
  const nowMs = Date.now();
  for (const t of items.rows) {
    const p = pillarFor(t.category);
    const bucket = tally[p];
    // Pause the deadline across the owner's excused-off days (leave/sick).
    const effDue = await effectiveDue(userId, t.due_at);
    if (t.status === 'done') {
      bucket.n += 1;
      if (t.completed_at && new Date(t.completed_at) <= effDue) {
        bucket.e += 1;                       // on time vs the effective (paused) deadline
      } else {
        bucket.e += LATE_CREDIT;             // late but done
      }
    } else {
      // Not done. If the effective deadline is still ahead (they're off and
      // haven't had a working day back yet), it's paused — don't count it.
      if (effDue.getTime() > nowMs) continue;
      bucket.n += 1;
      anyNotDone = true;                     // genuinely not done = 0
    }
  }
  const ratio = (b) => (b.n === 0 ? 1 : b.e / b.n);
  const slaPts = WEIGHTS.sla * ratio(tally.sla);
  const hiringPts = WEIGHTS.hiring * ratio(tally.hiring);
  const accPts = WEIGHTS.accuracy * ratio(tally.accuracy);

  // Conduct pillar from the week's ledger (10 minus points, floored at 0)
  const led = await db.query(
    `SELECT COALESCE(SUM(points), 0)::numeric AS pts, BOOL_OR(kind = 'unauth_absence' OR kind = 'noshow_nonotify') AS bad
       FROM attendance_ledger
      WHERE user_id = $1 AND excused = FALSE AND occurred_on >= $2::date AND occurred_on < $3::date`,
    [userId, weekStart, weekEnd]
  );
  const ledPts = Number(led.rows[0].pts || 0);
  const conductPts = Math.max(0, WEIGHTS.conduct - ledPts);
  const hadAbsence = !!led.rows[0].bad;

  // Quality — neutral unless owner overrode (read existing override if present)
  const prev = await db.query(
    `SELECT quality_override, quality_override_by, quality_override_at, quality_override_note
       FROM weekly_scores WHERE user_id = $1 AND week_start = $2`,
    [userId, weekStart]
  );
  const ov = prev.rows[0] && prev.rows[0].quality_override != null ? Number(prev.rows[0].quality_override) : null;
  const qualityPts = ov != null ? ov : QUALITY_NEUTRAL;

  // Correctness % across the work pillars (volume-weighted)
  const totN = tally.sla.n + tally.hiring.n + tally.accuracy.n;
  const totE = tally.sla.e + tally.hiring.e + tally.accuracy.e;
  const correctness = totN === 0 ? 100 : (totE / totN) * 100;

  // Band: HR is driven by correctness; cap at Good if anything was dropped;
  // drop a band for an unauthorised absence that week.
  let band = hrBandFromCorrectness(correctness);
  let capped = false;
  if (anyNotDone) { const b2 = capBandAt(band, 'Good'); if (b2 !== band) { band = b2; capped = true; } }
  if (hadAbsence) band = dropOneBand(band);

  const total = slaPts + hiringPts + accPts + conductPts + qualityPts;
  const manualCounted = Math.min(MANUAL_DAILY_CAP * 7, 0); // counted manual items are added at freeze; placeholder roll-up

  await db.query(
    `INSERT INTO weekly_scores
       (user_id, week_start, dept_slug, sla_pts, hiring_pts, accuracy_pts, conduct_pts,
        correctness_pct, quality_pts, quality_override, quality_override_by, quality_override_at,
        quality_override_note, total, band, band_capped, manual_counted, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
     ON CONFLICT (user_id, week_start) DO UPDATE SET
       sla_pts=EXCLUDED.sla_pts, hiring_pts=EXCLUDED.hiring_pts, accuracy_pts=EXCLUDED.accuracy_pts,
       conduct_pts=EXCLUDED.conduct_pts, correctness_pct=EXCLUDED.correctness_pct,
       quality_pts=EXCLUDED.quality_pts, total=EXCLUDED.total, band=EXCLUDED.band,
       band_capped=EXCLUDED.band_capped, manual_counted=EXCLUDED.manual_counted, computed_at=NOW()`,
    [userId, weekStart, 'hr', slaPts, hiringPts, accPts, conductPts, correctness, qualityPts,
     ov, prev.rows[0] ? prev.rows[0].quality_override_by : null,
     prev.rows[0] ? prev.rows[0].quality_override_at : null,
     prev.rows[0] ? prev.rows[0].quality_override_note : null,
     total, band, capped, manualCounted]
  );
  return { correctness, band, total, slaPts, hiringPts, accPts, conductPts, qualityPts, capped };
}

// ---------------------------------------------------------------- cron hooks
// Called from server.js AFTER attendance.tickDailyMidnight (which locks reports).
// Freeze writes via direct UPDATE, so the lock doesn't block us.
async function freezeDay(dateStr) {
  if (!dateStr) dateStr = addDays(londonDate(), -1);   // default: freeze yesterday
  const users = await db.query(
    `SELECT id FROM users WHERE deleted_at IS NULL AND employment_status = 'active'`
  );
  for (const u of users.rows) {
    try {
      const day = await assessDay(u.id, dateStr);
      await ledgerForDay(u.id, dateStr);
      await db.query(
        `INSERT INTO daily_reports (user_id, for_date, notes, snapshot_tasks, snapshot_flags, auto_submitted)
         VALUES ($1, $2, '', $3::jsonb, $4::jsonb, TRUE)
         ON CONFLICT (user_id, for_date) DO UPDATE SET
           snapshot_tasks = EXCLUDED.snapshot_tasks,
           snapshot_flags = EXCLUDED.snapshot_flags,
           auto_submitted = (daily_reports.submitted_at IS NULL),
           updated_at = NOW()`,
        [u.id, dateStr, JSON.stringify(day.did), JSON.stringify(day.flags)]
      );
      // Bell: notify the person's managers/owner on a serious flag (absence).
      const serious = day.flags.find(f => f.kind === 'absence');
      if (serious) {
        await notifyManagersOf(u.id, {
          type: 'hr_flag',
          title: 'HR — needs a look',
          body: serious.text,
          action_url: '#hr/today',
        });
      }
    } catch (e) { console.error('[daily.freezeDay]', u.id, e.message); }
  }
}

// Called from server.js AFTER attendance.tickWeeklySunday. Scores the week just ended.
async function scoreLastWeek() {
  const lastWeekStart = mondayOf(addDays(londonDate(), -1)); // Monday of the week containing yesterday
  const users = await db.query(
    `SELECT id FROM users WHERE deleted_at IS NULL AND employment_status = 'active'`
  );
  for (const u of users.rows) {
    try { await scoreWeek(u.id, lastWeekStart); }
    catch (e) { console.error('[daily.scoreLastWeek]', u.id, e.message); }
  }
}

// Age off day-level detail past the storage window. Scores (weekly_scores) are kept.
async function retentionCleanup() {
  try {
    await db.query(
      `DELETE FROM daily_reports WHERE for_date < (CURRENT_DATE - ($1 || ' days')::interval)`,
      [DETAIL_RETENTION_DAYS]
    );
  } catch (e) { console.error('[daily.retentionCleanup]', e.message); }
}

// ---------------------------------------------------------------- endpoints
// My day
router.get('/me', async (req, res) => {
  try {
    const date = req.query.date || londonDate();
    const day = await assessDay(req.user.id, date);
    const standing = await ledgerStanding(req.user.id);
    res.json({ day, standing });
  } catch (e) { console.error('[daily/me]', e.message); res.status(500).json({ error: 'Failed' }); }
});

// Direct reports' days (HR today) — owner/manager only
router.get('/team', requirePermission('*'), async (req, res) => {
  try {
    const date = req.query.date || londonDate();
    // HR execs report to the owner; scope by HR department for now.
    const people = await db.query(
      `SELECT DISTINCT u.id, u.full_name, u.display_name, u.avatar_colour
         FROM users u
         JOIN user_department_memberships m ON m.user_id = u.id
         JOIN departments d ON d.id = m.department_id
        WHERE u.deleted_at IS NULL AND u.employment_status = 'active' AND d.slug = 'hr'
        ORDER BY u.full_name`
    );
    const out = [];
    for (const p of people.rows) {
      const day = await assessDay(p.id, date);
      out.push({ user: p, flags: day.flags, did: day.did.length, submitted: day.submitted, off: day.off });
    }
    res.json({ date, people: out });
  } catch (e) { console.error('[daily/team]', e.message); res.status(500).json({ error: 'Failed' }); }
});

// Add an off-system item to today
router.post('/manual-item', async (req, res) => {
  const { category, note } = req.body || {};
  if (typeof note !== 'string' || !note.trim()) return res.status(400).json({ error: 'note required' });
  if (note.length > 500) return res.status(400).json({ error: 'note too long' });
  try {
    const today = londonDate();
    const cur = await db.query(`SELECT manual_items, locked_at FROM daily_reports WHERE user_id = $1 AND for_date = $2`, [req.user.id, today]);
    if (cur.rows[0] && cur.rows[0].locked_at) return res.status(409).json({ error: 'Day locked' });
    const items = (cur.rows[0] && Array.isArray(cur.rows[0].manual_items)) ? cur.rows[0].manual_items : [];
    const counted = items.filter(i => i.counted).length < MANUAL_DAILY_CAP;
    items.push({ category: (category || 'admin'), note: note.trim(), counted, at: new Date().toISOString() });
    if (cur.rows[0]) {
      await db.query(`UPDATE daily_reports SET manual_items = $1::jsonb, updated_at = NOW() WHERE user_id = $2 AND for_date = $3`, [JSON.stringify(items), req.user.id, today]);
    } else {
      await db.query(`INSERT INTO daily_reports (user_id, for_date, notes, manual_items) VALUES ($1, $2, '', $3::jsonb)`, [req.user.id, today, JSON.stringify(items)]);
    }
    res.json({ ok: true, items });
  } catch (e) { console.error('[daily/manual-item]', e.message); res.status(500).json({ error: 'Failed' }); }
});

// Submit my day
router.post('/submit', async (req, res) => {
  try {
    const today = londonDate();
    const cur = await db.query(`SELECT id, locked_at FROM daily_reports WHERE user_id = $1 AND for_date = $2`, [req.user.id, today]);
    if (cur.rows[0] && cur.rows[0].locked_at) return res.status(409).json({ error: 'Day locked' });
    if (cur.rows[0]) {
      await db.query(`UPDATE daily_reports SET submitted_at = NOW(), auto_submitted = FALSE, updated_at = NOW() WHERE id = $1`, [cur.rows[0].id]);
    } else {
      await db.query(`INSERT INTO daily_reports (user_id, for_date, notes, submitted_at) VALUES ($1, $2, '', NOW())`, [req.user.id, today]);
    }
    res.json({ ok: true });
  } catch (e) { console.error('[daily/submit]', e.message); res.status(500).json({ error: 'Failed' }); }
});

// Weekly score + breakdown + trend + ledger standing
router.get('/score', async (req, res) => {
  try {
    let uid = req.user.id;
    if (req.query.user_id && String(req.query.user_id) !== String(req.user.id)) {
      const perms = req.user.permissions || [];
      if (!perms.includes('attendance.view.any')) return res.status(403).json({ error: 'Forbidden' });
      uid = parseInt(req.query.user_id, 10);
    }
    const week = req.query.week || mondayOf(londonDate());
    const trend = await db.query(
      `SELECT week_start, total, band, correctness_pct FROM weekly_scores
        WHERE user_id = $1 ORDER BY week_start DESC LIMIT 8`, [uid]
    );
    const cur = await db.query(
      `SELECT week_start, sla_pts, hiring_pts, accuracy_pts, conduct_pts, quality_pts,
              correctness_pct, total, band, band_capped
         FROM weekly_scores WHERE user_id = $1 ORDER BY week_start DESC LIMIT 1`, [uid]
    );
    const standing = await ledgerStanding(uid);
    const raiseMap = BAND_RAISE;
    res.json({ user_id: uid, week, current: cur.rows[0] || null, trend: trend.rows.reverse(), standing, raiseBands: raiseMap, weights: WEIGHTS });
  } catch (e) { console.error('[daily/score]', e.message); res.status(500).json({ error: 'Failed' }); }
});

// Owner quality override (logged), then recompute that week
router.post('/score/quality', requirePermission('attendance.view.any'), async (req, res) => {
  const { user_id, week, value, note } = req.body || {};
  const v = Number(value);
  if (!user_id || !week || isNaN(v) || v < 0 || v > WEIGHTS.quality) return res.status(400).json({ error: 'Bad input' });
  try {
    await db.query(
      `INSERT INTO weekly_scores (user_id, week_start, quality_override, quality_override_by, quality_override_at, quality_override_note)
       VALUES ($1,$2,$3,$4,NOW(),$5)
       ON CONFLICT (user_id, week_start) DO UPDATE SET
         quality_override = EXCLUDED.quality_override, quality_override_by = EXCLUDED.quality_override_by,
         quality_override_at = NOW(), quality_override_note = EXCLUDED.quality_override_note`,
      [user_id, mondayOf(week), v, req.user.id, note || null]
    );
    await scoreWeek(user_id, mondayOf(week));
    await logAudit(req.user.id, 'weekly_score.quality_override', { user_id, week, value: v });
    res.json({ ok: true });
  } catch (e) { console.error('[daily/score/quality]', e.message); res.status(500).json({ error: 'Failed' }); }
});

// Manager logs a positive
router.post('/recognition', requirePermission('attendance.view.any'), async (req, res) => {
  const { user_id, note } = req.body || {};
  if (!user_id || typeof note !== 'string' || !note.trim()) return res.status(400).json({ error: 'Bad input' });
  try {
    await db.query(`INSERT INTO recognition_log (user_id, logged_by_user_id, note) VALUES ($1, $2, $3)`, [user_id, req.user.id, note.trim()]);
    res.json({ ok: true });
  } catch (e) { console.error('[daily/recognition]', e.message); res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
module.exports.assessDay = assessDay;
module.exports.scoreWeek = scoreWeek;
module.exports.freezeDay = freezeDay;
module.exports.scoreLastWeek = scoreLastWeek;
module.exports.retentionCleanup = retentionCleanup;
module.exports.londonDate = londonDate;
module.exports.mondayOf = mondayOf;
