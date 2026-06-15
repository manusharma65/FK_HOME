// FK Home — bootstrap
// Build marker: r0.15 (2026-05-28) — HR-1.5: leave accrual + weekend
//                                    conditional pay. Engine fixes:
//                                    anniversary-based leave year (reset on
//                                    hire-date anniversary, no carryover),
//                                    owner excluded from accrual, boot-time
//                                    backfill (active non-owner users get
//                                    correct entitled_days), retroactive
//                                    weekend recompute when leave approved.
//                                    New Payroll module at #hr/payroll
//                                    (Owner + HR only) with monthly rollup,
//                                    day drill-through, and CSV export.
// Previous: r0.14 (2026-05-28) — Ship 2: module loading infrastructure
//                                    Sidebar regrouped into WORKSPACE/HR/DAY/
//                                    SYSTEM/YOU with permission-based item
//                                    hiding. Mobile hamburger + overlay
//                                    sidebar. Hash router foundation (Ship 2
//                                    will migrate modules into the shell).
//                                    All standalone pages still work as before.
// All real logic lives in /server/modules/. This file stays small on purpose.

const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const { initDb, db } = require('./server/db');
const { runMigrations } = require('./server/schema');
const { seedInitialData } = require('./server/schema/seed');
const { attachUserToRequest } = require('./server/auth');

const authRoutes = require('./server/modules/auth');
const meRoutes = require('./server/modules/me');
const teamRoutes = require('./server/modules/team');
const leavesRoutes = require('./server/modules/leaves');
const adminRoutes = require('./server/modules/admin');
const chatRoutes = require('./server/modules/chat');
const notificationsRoutes = require('./server/modules/notifications');
const attendanceRoutes = require('./server/modules/attendance');
const filesRoutes = require('./server/modules/files');
const payrollRoutes = require('./server/modules/payroll');
const profileRoutes = require('./server/modules/profile');
const tasksRoutes = require('./server/modules/tasks');
const recruitmentRoutes = require('./server/modules/recruitment');
const leaveEngine = require('./server/modules/leave-engine');
const backupEngine = require('./server/modules/backup');
const lifecycle = require('./server/modules/lifecycle');
const dailyRoutes = require('./server/modules/daily');
const mailRoutes = require('./server/modules/mail');
const learningRoutes = require('./server/modules/learning');
const monitoring = require('./server/modules/monitoring');

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = 'r1.28';

app.set('trust proxy', 1); // Railway sits behind a proxy
app.use(express.json({ limit: '30mb' }));
app.use(cookieParser());

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true, app: 'fk-home', version: VERSION }));

// Serve the SPA shell with cache-busting version stamps on every module URL.
// Each ship bumps VERSION, so /modules/x.js becomes /modules/x.js?v=r0.97 — a
// brand-new URL the browser has never cached, forcing a fresh fetch of all
// modules. Defeats browser cache, the SPA-never-reloads problem and edge cache.
function serveShell(req, res) {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) => {
    if (err) { res.status(500).send('Shell load error'); return; }
    const stamped = html.replace(/(\bsrc=")(\/?modules\/[^"?]+\.js)(")/g, '$1$2?v=' + VERSION + '$3');
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(stamped);
  });
}
app.get(['/', '/index.html'], serveShell);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Hydrate req.user on every API request
app.use('/api', attachUserToRequest);

// Module routers
app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/leaves', leavesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/daily', dailyRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/learning', learningRoutes);

// 404 for unknown APIs (avoid SPA HTML fallback for /api/*)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Lightweight liveness/health probe (public — no auth). Reports uptime, the last
// daily heartbeat, and the 24h error count from the monitoring sink.
app.get('/healthz', async (req, res) => {
  try { const h = await monitoring.health(); res.json({ ...h, version: VERSION }); }
  catch (e) { res.status(500).json({ ok: false }); }
});

// SPA fallback — everything else returns the version-stamped shell
app.get('*', serveShell);

// Error sink — last in the chain. Catches unhandled route throws / next(err).
app.use(monitoring.errorMiddleware);

// ---- Cron jobs -----------------------------------------------------------
// Simple setInterval scheduling (no node-cron dep). Every gated job checks
// London wall-clock once a minute and runs at most once per day/week. All ticks
// are wrapped so a throw can never take the process down.
function londonParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${get('hour')}:${get('minute')}`, weekday: get('weekday') };
}

// Last-run date per job, persisted in system_state so a restart neither
// re-runs a completed job nor permanently skips one whose window was missed.
const cronLastRun = {};
async function loadCronState() {
  try {
    const r = await db.query("SELECT key, value FROM system_state WHERE key LIKE 'cron:%'");
    for (const row of r.rows) cronLastRun[row.key.slice(5)] = row.value;
  } catch (e) { console.error('[cron] loadState', e.message); }
}
function saveCronRun(label, date) {
  cronLastRun[label] = date; // in-memory guard updates immediately
  db.query("INSERT INTO system_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", ['cron:' + label, date])
    .catch(e => console.error('[cron] saveState', e.message));
}

// Run fn once per London date, at or after startHHMM. No end bound — if the
// server was down through the usual minute, it runs as soon as it's back.
function scheduleDaily(label, startHHMM, fn) {
  setInterval(() => {
    try {
      const { date, hhmm } = londonParts();
      if (hhmm >= startHHMM && cronLastRun[label] !== date) {
        saveCronRun(label, date);
        console.log(`[cron] ${label} @ ${date}`);
        Promise.resolve().then(fn).catch(e => console.error(`[cron ${label}]`, e.message));
      }
    } catch (e) { console.error(`[cron ${label} check]`, e.message); }
  }, 60 * 1000);
}

// Calendar-date of the most recent <weekday> occurrence whose startHHMM has
// already passed (London). Returns a 'YYYY-MM-DD' string. Used so a weekly job
// missed across a whole day still runs once when the server is back, instead of
// silently waiting a full week.
const _WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function subtractDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC: immune to DST/tz shifts
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function lastDueWeekdayDate(p, weekday, startHHMM) {
  const todayIdx = _WD.indexOf(p.weekday);
  const targetIdx = _WD.indexOf(weekday);
  if (todayIdx < 0 || targetIdx < 0) return null;
  let back = (todayIdx - targetIdx + 7) % 7;        // days since the most recent <weekday>
  if (back === 0 && p.hhmm < startHHMM) back = 7;   // it's the day but before the time → last week's
  return subtractDays(p.date, back);
}

// Run fn once per scheduled weekly occurrence, at or after startHHMM. If the
// most recent occurrence was missed (server down that day), it runs on the next
// tick the server is up — then records that occurrence's date so it won't repeat.
function scheduleWeekly(label, weekday, startHHMM, fn) {
  setInterval(() => {
    try {
      const p = londonParts();
      const due = lastDueWeekdayDate(p, weekday, startHHMM);
      if (due && (!cronLastRun[label] || cronLastRun[label] < due)) {
        saveCronRun(label, due);
        console.log(`[cron] ${label} @ ${p.date} (for ${weekday} ${startHHMM}, due ${due})`);
        Promise.resolve().then(fn).catch(e => console.error(`[cron ${label}]`, e.message));
      }
    } catch (e) { console.error(`[cron ${label} check]`, e.message); }
  }, 60 * 1000);
}

function startCronJobs() {
  // Frequent: every 5 minutes — late detection, idle escalation.
  setInterval(() => {
    attendanceRoutes.tickFiveMinute().catch(e => console.error('[cron 5min]', e.message));
    attendanceRoutes.tickAutoClockout().catch(e => console.error('[cron 5min auto-clockout]', e.message));
  }, 5 * 60 * 1000);

  // Midnight: roll over the day, freeze yesterday's record + ledger, age off detail.
  scheduleDaily('midnight', '00:00', () =>
    attendanceRoutes.tickDailyMidnight()
      .then(() => dailyRoutes.freezeDay())
      .then(() => dailyRoutes.retentionCleanup()));

  // 01:00 — monthly leave accrual on user anniversaries.
  scheduleDaily('accrual 01:00', '01:00', () => leaveEngine.tickMonthlyAccrual());

  // 02:00 — nightly off-site pg_dump → Backblaze B2.
  scheduleDaily('backup 02:00', '02:00', () => backupEngine.tickNightlyBackup());

  // 03:00 — hard-purge soft-deleted files past retention.
  scheduleDaily('file-purge 03:00', '03:00', () => filesRoutes.tickHardPurge());

  // 06:00 — task promotion + probation/birthday nudges.
  scheduleDaily('task tick 06:00', '06:00', async () => {
    await lifecycle.tickTasks()
      .then(r => console.log('[cron task tick] opened=' + r.opened + ' due=' + r.dued + ' overdue=' + r.overdued + ' renudged=' + r.reNudged))
      .catch(e => console.error('[cron task tick]', e.message));
    await lifecycle.tickProbationNudges()
      .then(r => console.log('[cron probation nudge] nudged=' + r.nudged))
      .catch(e => console.error('[cron probation nudge]', e.message));
    await lifecycle.tickBirthdayNudges()
      .then(r => console.log('[cron birthday nudge] nudged=' + r.nudged + ' candidates=' + r.candidates))
      .catch(e => console.error('[cron birthday nudge]', e.message));
  });

  // Sunday 23:00 — close the week + score it.
  scheduleWeekly('weekly Sunday 23:00', 'Sunday', '23:00', () =>
    attendanceRoutes.tickWeeklySunday().then(() => dailyRoutes.scoreLastWeek()));

  // Sunday 23:30 — weekend conditional-pay calc (right after the weekly tick).
  scheduleWeekly('weekend-pay Sunday 23:30', 'Sunday', '23:30', () =>
    leaveEngine.tickWeeklyWeekendPay());

  // 07:00 — daily heartbeat + 24h error rollup (monitoring).
  scheduleDaily('heartbeat 07:00', '07:00', () => monitoring.tickHeartbeat());

  // 14:00 — nudge today's HR approver if clock-in exceptions are still unreviewed.
  scheduleDaily('clockin-nudge 14:00', '14:00', () => attendanceRoutes.nudgeClockinExceptions());

  // 03:30 — purge clock-in selfies older than 90 days.
  scheduleDaily('selfie-purge 03:30', '03:30', () => attendanceRoutes.purgeOldSelfies());

  console.log('[boot] cron jobs scheduled (5min, 00:00, 01:00, 02:00, 03:00, 06:00, 07:00, Sun 23:00, Sun 23:30)');
}

async function start() {
  try {
    monitoring.installProcessHandlers();
    await initDb();
    console.log('[boot] database connected');
    await runMigrations();
    console.log('[boot] migrations applied');
    await seedInitialData();
    console.log('[boot] seed verified');
    // r0.15 (HR-1.5) — one-time leave-balance backfill. Self-guards via system_state.
    await leaveEngine.runBackfillIfNeeded();
    // r0.33 — assign FK### Emp IDs to any staff without one. Idempotent.
    await require('./server/modules/emp-id').runEmpIdBackfillIfNeeded();
    await loadCronState();
    app.listen(PORT, () => {
      console.log(`[boot] FK Home ${VERSION} listening on port ${PORT}`);
      startCronJobs();
      // Run one immediate 5-min tick on boot, in case the server was down for a while.
      attendanceRoutes.tickFiveMinute().catch(e => console.error('[cron boot tick]', e.message));
      // r1.25 — after migrations correct the pattern anchor, re-derive today's already-written
      // attendance rows (the midnight tick won't heal non-pending rows on its own).
      attendanceRoutes.reconcileTodayPattern().catch(e => console.error('[boot reconcile]', e.message));
    });
  } catch (err) {
    console.error('[boot] FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

start();
