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
const leaveEngine = require('./server/modules/leave-engine');
const backupEngine = require('./server/modules/backup');
const lifecycle = require('./server/modules/lifecycle');

const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1); // Railway sits behind a proxy
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true, app: 'fk-home', version: 'r0.20.4' }));

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

// 404 for unknown APIs (avoid SPA HTML fallback for /api/*)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback — everything else returns index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Cron jobs -----------------------------------------------------------
// We use simple setInterval rather than node-cron to avoid adding deps.
// All ticks are wrapped to never throw.
function startCronJobs() {
  // Every 5 minutes (300_000 ms) — late detection, idle escalation
  setInterval(() => {
    attendanceRoutes.tickFiveMinute().catch(e => console.error('[cron 5min]', e.message));
  }, 5 * 60 * 1000);

  // Every 1 minute, check if we just crossed midnight London time. If so, run daily tick.
  let lastMidnightRun = null;
  setInterval(() => {
    try {
      const londonDate = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date()).split('/').reverse().join('-'); // dd/mm/yyyy -> yyyy-mm-dd
      const hhmm = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
      // Run between 00:00 and 00:05 London time, once per date
      if (hhmm < '00:05' && lastMidnightRun !== londonDate) {
        lastMidnightRun = londonDate;
        console.log('[cron] daily midnight tick @', londonDate);
        attendanceRoutes.tickDailyMidnight().catch(e => console.error('[cron midnight]', e.message));
      }
    } catch (e) {
      console.error('[cron midnight check]', e.message);
    }
  }, 60 * 1000);

  // Weekly tick — Sunday 23:00 London. Same check pattern.
  let lastWeeklyRun = null;
  setInterval(() => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(new Date());
      const get = (t) => parts.find(p => p.type === t).value;
      const isoDate = `${get('year')}-${get('month')}-${get('day')}`;
      const hhmm = `${get('hour')}:${get('minute')}`;
      const weekday = get('weekday');
      if (weekday === 'Sunday' && hhmm >= '23:00' && hhmm < '23:30' && lastWeeklyRun !== isoDate) {
        lastWeeklyRun = isoDate;
        console.log('[cron] weekly Sunday tick @', isoDate);
        attendanceRoutes.tickWeeklySunday().catch(e => console.error('[cron weekly]', e.message));
      }
    } catch (e) {
      console.error('[cron weekly check]', e.message);
    }
  }, 60 * 1000);

  // r0.7 — Daily accrual tick at 01:00 London. Credits leave days on user anniversaries.
  let lastAccrualRun = null;
  setInterval(() => {
    try {
      const londonDate = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date()).split('/').reverse().join('-');
      const hhmm = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
      if (hhmm >= '01:00' && hhmm < '01:05' && lastAccrualRun !== londonDate) {
        lastAccrualRun = londonDate;
        console.log('[cron] daily accrual tick @', londonDate);
        leaveEngine.tickMonthlyAccrual().catch(e => console.error('[cron accrual]', e.message));
      }
    } catch (e) {
      console.error('[cron accrual check]', e.message);
    }
  }, 60 * 1000);

  // r0.7 — Weekend pay calc Sunday 23:30 London (right after weekly Sunday tick at 23:00).
  let lastWeekendPayRun = null;
  setInterval(() => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(new Date());
      const get = (t) => parts.find(p => p.type === t).value;
      const isoDate = `${get('year')}-${get('month')}-${get('day')}`;
      const hhmm = `${get('hour')}:${get('minute')}`;
      const weekday = get('weekday');
      if (weekday === 'Sunday' && hhmm >= '23:30' && hhmm < '23:55' && lastWeekendPayRun !== isoDate) {
        lastWeekendPayRun = isoDate;
        console.log('[cron] weekly weekend-pay tick @', isoDate);
        leaveEngine.tickWeeklyWeekendPay().catch(e => console.error('[cron weekend-pay]', e.message));
      }
    } catch (e) {
      console.error('[cron weekend-pay check]', e.message);
    }
  }, 60 * 1000);

  // r0.8 — Nightly backup at 02:00 London. Off-site pg_dump → Backblaze B2.
  let lastBackupRun = null;
  setInterval(() => {
    try {
      const londonDate = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date()).split('/').reverse().join('-');
      const hhmm = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
      if (hhmm >= '02:00' && hhmm < '02:05' && lastBackupRun !== londonDate) {
        lastBackupRun = londonDate;
        console.log('[cron] nightly backup tick @', londonDate);
        backupEngine.tickNightlyBackup().catch(e => console.error('[cron backup]', e.message));
      }
    } catch (e) {
      console.error('[cron backup check]', e.message);
    }
  }, 60 * 1000);

  // r0.9 — Daily file hard-purge at 03:00 London. Removes soft-deleted files
  // past 90-day retention from the bytea store.
  let lastFilePurgeRun = null;
  setInterval(() => {
    try {
      const londonDate = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date()).split('/').reverse().join('-');
      const hhmm = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
      if (hhmm >= '03:00' && hhmm < '03:05' && lastFilePurgeRun !== londonDate) {
        lastFilePurgeRun = londonDate;
        console.log('[cron] daily file-purge tick @', londonDate);
        filesRoutes.tickHardPurge().catch(e => console.error('[cron file-purge]', e.message));
      }
    } catch (e) {
      console.error('[cron file-purge check]', e.message);
    }
  }, 60 * 1000);

  // r0.10 — Daily task tick at 06:00 London. Promotes review tasks
  // pending → open → due → overdue, fires notifications, re-nudges overdue.
  let lastTaskTickRun = null;
  setInterval(() => {
    try {
      const londonDate = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date()).split('/').reverse().join('-');
      const hhmm = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
      if (hhmm >= '06:00' && hhmm < '06:05' && lastTaskTickRun !== londonDate) {
        lastTaskTickRun = londonDate;
        console.log('[cron] daily task tick @', londonDate);
        lifecycle.tickTasks()
          .then(r => console.log('[cron task tick] opened=' + r.opened + ' due=' + r.dued + ' overdue=' + r.overdued + ' renudged=' + r.reNudged))
          .catch(e => console.error('[cron task tick]', e.message));
        // r0.11 — Also run probation end nudge (fires when a user's
        // probation_end_date arrives and they still need a decision).
        lifecycle.tickProbationNudges()
          .then(r => console.log('[cron probation nudge] nudged=' + r.nudged))
          .catch(e => console.error('[cron probation nudge]', e.message));
        // r0.14 — Birthday pre-notify: tell HR one day before each
        // active employee's birthday (no task, just a notification).
        lifecycle.tickBirthdayNudges()
          .then(r => console.log('[cron birthday nudge] nudged=' + r.nudged + ' candidates=' + r.candidates))
          .catch(e => console.error('[cron birthday nudge]', e.message));
      }
    } catch (e) {
      console.error('[cron task tick check]', e.message);
    }
  }, 60 * 1000);

  console.log('[boot] cron jobs scheduled (5min, midnight, 01:00 accrual, 02:00 backup, 03:00 file-purge, 06:00 task tick, Sun 23:00 weekly, Sun 23:30 weekend-pay)');
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
    app.listen(PORT, () => {
      console.log(`[boot] FK Home r0.16.3 listening on port ${PORT}`);
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
