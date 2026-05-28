-- ============================================================================
-- FK Home — Section 2: Presence, schedule, leaves, lateness, breaks
-- ============================================================================
-- Tables: user_status, shift_log, leave_policies, leave_balances,
--         leave_requests, lateness_log, sick_log, team_break_schedule
--
-- Design notes:
--  * user_status holds CURRENT status only. History goes in shift_log.
--  * leave_policies sets annual entitlement (one row per year × policy).
--    leave_balances is per-user-per-year cache for fast reads.
--  * leave_requests is the source of truth: an approved request decrements
--    the balance. A cancelled/rejected request doesn't.
--  * Sick days have their own table (sick_log) because they're often
--    same-day notifications, not requests (you wake up sick, you call in).
--  * team_break_schedule is a global config table: one row "everyone breaks
--    at HH:MM for N minutes". Easy to amend in /admin later.
-- ============================================================================

-- ---------- user_status ----------
-- One row per user — their CURRENT status. UPSERT pattern.
CREATE TABLE IF NOT EXISTS user_status (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'offline' CHECK (
                      status IN ('active','idle','running_late','on_break','heads_down','off_sick','on_leave','offline')
                    ),
  status_note       TEXT,                        -- free text e.g. "back at 9:30"
  status_until      TIMESTAMPTZ,                 -- when this status auto-clears (e.g. running_late until 9:30)
  last_active_at    TIMESTAMPTZ,                 -- last heartbeat from the client
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_status_status ON user_status(status);
CREATE INDEX IF NOT EXISTS idx_status_last_active ON user_status(last_active_at DESC);

-- ---------- shift_log ----------
-- Every login/logout and every explicit status change. The history.
CREATE TABLE IF NOT EXISTS shift_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'login','logout','status_change','heartbeat_idle','heartbeat_active','break_start','break_end'
                  )),
  status_before   TEXT,
  status_after    TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address      TEXT,
  user_agent      TEXT,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_shift_user_time ON shift_log(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_time ON shift_log(occurred_at DESC);

-- ---------- leave_policies ----------
-- One row per (year, policy). Lets you change entitlement year-on-year without rewriting old data.
CREATE TABLE IF NOT EXISTS leave_policies (
  id              SERIAL PRIMARY KEY,
  year            INTEGER NOT NULL,
  policy_name     TEXT NOT NULL DEFAULT 'standard',
  annual_days     NUMERIC(5,2) NOT NULL,         -- e.g. 25.00
  carryover_days  NUMERIC(5,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, policy_name)
);

-- ---------- leave_balances ----------
-- Cached balance per user per year. Recomputed when requests change.
CREATE TABLE IF NOT EXISTS leave_balances (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  entitled_days   NUMERIC(5,2) NOT NULL DEFAULT 0,
  carryover_days  NUMERIC(5,2) NOT NULL DEFAULT 0,
  taken_days      NUMERIC(5,2) NOT NULL DEFAULT 0,
  pending_days    NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, year)
);
CREATE INDEX IF NOT EXISTS idx_balance_user_year ON leave_balances(user_id, year);

-- ---------- leave_requests ----------
CREATE TABLE IF NOT EXISTS leave_requests (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  request_type    TEXT NOT NULL DEFAULT 'annual' CHECK (request_type IN ('annual','unpaid','compassionate','other')),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  total_days      NUMERIC(5,2) NOT NULL,
  is_half_day     BOOLEAN NOT NULL DEFAULT FALSE,
  half_day_part   TEXT CHECK (half_day_part IN ('am','pm')),
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by_user_id INTEGER REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status, start_date);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_requests(start_date, end_date);

-- ---------- lateness_log + sick_log ----------
-- Defined canonically in 04-attendance.sql (with the columns the app actually uses).
-- Earlier versions of FK Home defined them here too; that was removed in r0.9
-- to remove the contradictory pair of definitions. DO NOT re-add them here.

-- ---------- team_break_schedule ----------
-- Global config: one row that defines team break time.
-- A future version may have per-department schedules; for now, one company-wide rule.
CREATE TABLE IF NOT EXISTS team_break_schedule (
  id              SERIAL PRIMARY KEY,
  scope           TEXT NOT NULL DEFAULT 'company' UNIQUE,
  break_start_time TIME NOT NULL,                -- e.g. 11:30:00
  duration_minutes INTEGER NOT NULL,             -- e.g. 50
  timezone        TEXT NOT NULL DEFAULT 'Europe/London',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
