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
const cookieParser = require('cookie-parser');

const { initDb } = require('./server/db');
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

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = 'r0.85';

app.set('trust proxy', 1); // Railway sits behind a proxy
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true, app: 'fk-home', version: VERSION }));

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

// 404 for unknown APIs (avoid SPA HTML fallback for /api/*)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback — everything else returns index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

// Run fn once per London date when the time is within [startHHMM, endHHMM).
function scheduleDaily(label, startHHMM, endHHMM, fn) {
  let lastRun = null;
  setInterval(() => {
    try {
      const { date, hhmm } = londonParts();
      if (hhmm >= startHHMM && hhmm < endHHMM && lastRun !== date) {
        lastRun = date;
        console.log(`[cron] ${label} @ ${date}`);
        Promise.resolve().then(fn).catch(e => console.error(`[cron ${label}]`, e.message));
      }
    } catch (e) { console.error(`[cron ${label} check]`, e.message); }
  }, 60 * 1000);
}

// Run fn once per matching weekday/date when within [startHHMM, endHHMM).
function scheduleWeekly(label, weekday, startHHMM, endHHMM, fn) {
  let lastRun = null;
  setInterval(() => {
    try {
      const p = londonParts();
      if (p.weekday === weekday && p.hhmm >= startHHMM && p.hhmm < endHHMM && lastRun !== p.date) {
        lastRun = p.date;
        console.log(`[cron] ${label} @ ${p.date}`);
        Promise.resolve().then(fn).catch(e => console.error(`[cron ${label}]`, e.message));
      }
    } catch (e) { console.error(`[cron ${label} check]`, e.message); }
  }, 60 * 1000);
}

function startCronJobs() {
  // Frequent: every 5 minutes — late detection, idle escalation.
  setInterval(() => {
    attendanceRoutes.tickFiveMinute().catch(e => console.error('[cron 5min]', e.message));
  }, 5 * 60 * 1000);

  // Midnight: roll over the day, freeze yesterday's record + ledger, age off detail.
  scheduleDaily('midnight', '00:00', '00:05', () =>
    attendanceRoutes.tickDailyMidnight()
      .then(() => dailyRoutes.freezeDay())
      .then(() => dailyRoutes.retentionCleanup()));

  // 01:00 — monthly leave accrual on user anniversaries.
  scheduleDaily('accrual 01:00', '01:00', '01:05', () => leaveEngine.tickMonthlyAccrual());

  // 02:00 — nightly off-site pg_dump → Backblaze B2.
  scheduleDaily('backup 02:00', '02:00', '02:05', () => backupEngine.tickNightlyBackup());

  // 03:00 — hard-purge soft-deleted files past retention.
  scheduleDaily('file-purge 03:00', '03:00', '03:05', () => filesRoutes.tickHardPurge());

  // 06:00 — task promotion + probation/birthday nudges.
  scheduleDaily('task tick 06:00', '06:00', '06:05', async () => {
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
  scheduleWeekly('weekly Sunday 23:00', 'Sunday', '23:00', '23:30', () =>
    attendanceRoutes.tickWeeklySunday().then(() => dailyRoutes.scoreLastWeek()));

  // Sunday 23:30 — weekend conditional-pay calc (right after the weekly tick).
  scheduleWeekly('weekend-pay Sunday 23:30', 'Sunday', '23:30', '23:55', () =>
    leaveEngine.tickWeeklyWeekendPay());

  console.log('[boot] cron jobs scheduled (5min, 00:00, 01:00, 02:00, 03:00, 06:00, Sun 23:00, Sun 23:30)');
}

async function start() {
  try {
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
    app.listen(PORT, () => {
      console.log(`[boot] FK Home ${VERSION} listening on port ${PORT}`);
      startCronJobs();
      // Run one immediate 5-min tick on boot, in case the server was down for a while.
      attendanceRoutes.tickFiveMinute().catch(e => console.error('[cron boot tick]', e.message));
    });
  } catch (err) {
    console.error('[boot] FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

start();
