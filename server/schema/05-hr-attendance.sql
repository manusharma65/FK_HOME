-- ============================================================================
-- FK Home — Section 5: HR-1 (Attendance + Shift Policy + Holidays + Idle)
-- ============================================================================
-- Tables introduced in r0.6:
--   shift_policies              — per-dept start/end/grace + break window
--   pattern_anchor              — single row, anchor date for alternating weeks
--   holidays                    — public holidays (office closed except CS)
--   cs_rotas                    — 4-week CS rota uploads (Sitar)
--   cs_rota_entries             — one row per agent per date in a rota
--   attendance_day              — auto-populated per user per day
--   attendance_regularisations  — agent-submitted corrections
--   idle_events                 — every idle gap of >= 10 minutes
--
-- Design rules followed:
--   * Additive — no DROP on existing tables. New tables only.
--   * Idempotent — IF NOT EXISTS everywhere so re-applies are safe.
--   * Soft-deletable where it matters (deleted_at columns).
--   * Indexes for the queries we'll actually run (by-user-by-date is hot).
-- ============================================================================

-- ---------- shift_policies ----------
-- One row per department slug. start_time and end_time are LOCAL time strings
-- (HH:MM) — we store as TEXT not TIME because we don't want timezone games at
-- the column level. The tz column tells us how to interpret them.
CREATE TABLE IF NOT EXISTS shift_policies (
  id              SERIAL PRIMARY KEY,
  department_slug TEXT NOT NULL UNIQUE,
  start_time      TEXT NOT NULL,           -- e.g. '07:30'
  end_time        TEXT NOT NULL,           -- e.g. '16:30'
  grace_minutes   INTEGER NOT NULL DEFAULT 5,
  break_start     TEXT,                    -- DEPRECATED in r0.9 — break time is now company-wide
  break_end       TEXT,                    --   in team_break_schedule. Columns kept for backward compat.
  tz              TEXT NOT NULL DEFAULT 'Europe/London',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed defaults — most depts 07:30-16:30, CS 08:30-17:30. break_start/break_end
-- left null because break time is now read from team_break_schedule (company-wide).
INSERT INTO shift_policies (department_slug, start_time, end_time, grace_minutes, tz)
SELECT d.slug,
       CASE WHEN d.slug = 'cs' THEN '08:30' ELSE '07:30' END,
       CASE WHEN d.slug = 'cs' THEN '17:30' ELSE '16:30' END,
       5,
       'Europe/London'
FROM departments d
WHERE d.deleted_at IS NULL
ON CONFLICT (department_slug) DO NOTHING;

-- ---------- pattern_anchor ----------
-- Single-row table. The anchor_monday is the Monday of a 6-day week.
-- Alternates weekly from there. Set once via /admin.
CREATE TABLE IF NOT EXISTS pattern_anchor (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  anchor_monday   DATE NOT NULL,
  set_by_user_id  INTEGER REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: week of 26 May 2026 is the 6-day week per Bobby. Monday = 25 May 2026.
INSERT INTO pattern_anchor (id, anchor_monday)
VALUES (1, '2026-05-25')
ON CONFLICT (id) DO NOTHING;

-- ---------- holidays ----------
-- Public holidays. office_closed_for_cs=false means CS still works that day.
CREATE TABLE IF NOT EXISTS holidays (
  id                      SERIAL PRIMARY KEY,
  holiday_date            DATE NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  office_closed_for_cs    BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the 9 mandatory holidays for 2026-27 per Bobby. CS works through them.
INSERT INTO holidays (holiday_date, name, office_closed_for_cs) VALUES
  ('2026-08-15', 'Independence Day',        FALSE),
  ('2026-08-28', 'Raksha Bandhan',          FALSE),
  ('2026-10-02', 'Mahatma Gandhi Jayanti',  FALSE),
  ('2026-10-20', 'Vijaya Dashami',          FALSE),
  ('2026-11-08', 'Diwali',                  FALSE),
  ('2026-12-25', 'Christmas Day',           FALSE),
  ('2027-01-01', 'New Year',                FALSE),
  ('2027-01-26', 'Republic Day',            FALSE),
  ('2027-03-22', 'Holi',                    FALSE)
ON CONFLICT (holiday_date) DO NOTHING;

-- ---------- cs_rotas ----------
-- One row per rota upload by Sitar (or whoever has cs-lead). 4 weeks at a time.
CREATE TABLE IF NOT EXISTS cs_rotas (
  id              SERIAL PRIMARY KEY,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT,
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cs_rotas_dates ON cs_rotas(start_date, end_date) WHERE deleted_at IS NULL;

-- ---------- cs_rota_entries ----------
-- One row per agent per date inside a rota. status = 'working' | 'off' | 'leave'.
CREATE TABLE IF NOT EXISTS cs_rota_entries (
  id              SERIAL PRIMARY KEY,
  rota_id         INTEGER NOT NULL REFERENCES cs_rotas(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  entry_date      DATE NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('working','off','leave')),
  UNIQUE (rota_id, user_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_cs_rota_entries_user_date ON cs_rota_entries(user_id, entry_date);

-- ---------- attendance_day ----------
-- One row per user per date. Auto-populated by the nightly cron + updated by
-- the 5-minute cron through the day. Status fields summarise the day.
CREATE TABLE IF NOT EXISTS attendance_day (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  for_date              DATE NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending',          -- expected today, no login yet
                          'on_time',          -- logged in within grace
                          'late',             -- logged in after grace, within 30 min
                          'very_late',        -- logged in 30+ min after start
                          'no_show',          -- expected, never logged in
                          'on_leave',         -- approved leave
                          'off_sick',         -- sick log covers today
                          'off_pattern',      -- alternating pattern says off
                          'off_cs_rota',      -- CS rota says off
                          'off_holiday',      -- public holiday (non-CS)
                          'worked_voluntary'  -- off day but they worked anyway
                        )),
  first_login           TIMESTAMPTZ,
  last_logout           TIMESTAMPTZ,
  active_minutes        INTEGER NOT NULL DEFAULT 0,
  idle_minutes          INTEGER NOT NULL DEFAULT 0,
  break_taken_minutes   INTEGER NOT NULL DEFAULT 0,
  shift_start_local     TEXT,                 -- copied from policy at row creation
  shift_end_local       TEXT,
  late_minutes          INTEGER NOT NULL DEFAULT 0,
  no_show_notified_at   TIMESTAMPTZ,
  late_notified_at      TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, for_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_day_date_status ON attendance_day(for_date, status);
CREATE INDEX IF NOT EXISTS idx_attendance_day_user_date ON attendance_day(user_id, for_date DESC);

-- ---------- attendance_regularisations ----------
-- Agent-submitted corrections. Manager approves or denies.
CREATE TABLE IF NOT EXISTS attendance_regularisations (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  for_date              DATE NOT NULL,
  reason                TEXT NOT NULL,
  requested_first_login TIMESTAMPTZ,
  requested_last_logout TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','denied')),
  decided_by_user_id    INTEGER REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  decided_note          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regs_status ON attendance_regularisations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_regs_user ON attendance_regularisations(user_id, for_date DESC);

-- ---------- idle_events ----------
-- Recorded each time a user's idle period crosses 10 minutes.
-- Used for: (1) the 20-min manager escalation, (2) weekly chronic detection.
CREATE TABLE IF NOT EXISTS idle_events (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  for_date              DATE NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ,
  duration_minutes      INTEGER,             -- filled when ended; null while ongoing
  hit_10min             BOOLEAN NOT NULL DEFAULT TRUE,
  hit_20min             BOOLEAN NOT NULL DEFAULT FALSE,
  agent_acknowledged_at TIMESTAMPTZ,         -- when they tapped the banner
  manager_notified_at   TIMESTAMPTZ,
  during_break          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_idle_user_date ON idle_events(user_id, for_date DESC);
CREATE INDEX IF NOT EXISTS idx_idle_open ON idle_events(user_id) WHERE ended_at IS NULL;

-- ---------- hr_chronic_idle_flags ----------
-- Weekly cron writes entries here when a user shows chronic idle pattern.
-- Visible on /hr.html exceptions queue.
CREATE TABLE IF NOT EXISTS hr_chronic_idle_flags (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_start          DATE NOT NULL,
  window_end            DATE NOT NULL,
  days_affected         INTEGER NOT NULL,
  events_total          INTEGER NOT NULL,
  total_idle_minutes    INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','acknowledged','dismissed')),
  hr_user_id            INTEGER REFERENCES users(id),
  hr_note               TEXT,
  hr_actioned_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chronic_status ON hr_chronic_idle_flags(status, detected_at DESC);

-- ---------- daily_reports ----------
-- One row per user per date. Agent types free text at end of day; auto-fill
-- snapshot is recorded at submit time (in/out/active/idle/break). Editable
-- through the day, locks at midnight London time (enforced in the route).
-- HR-2 will add a manager review queue on top of these rows.
CREATE TABLE IF NOT EXISTS daily_reports (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  for_date              DATE NOT NULL,
  notes                 TEXT NOT NULL DEFAULT '',
  -- frozen snapshot of attendance signals at last save:
  snapshot_first_login  TIME,
  snapshot_last_logout  TIME,
  snapshot_active_min   INTEGER,
  snapshot_idle_min     INTEGER,
  snapshot_break_min    INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at             TIMESTAMPTZ,
  UNIQUE (user_id, for_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_reports_user_date ON daily_reports(user_id, for_date DESC);

