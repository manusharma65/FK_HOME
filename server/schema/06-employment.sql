-- ============================================================================
-- FK Home — Section 6: Employment, leave engine, weekend pay, report reviews
-- ============================================================================
-- Introduced in r0.7. Adds:
--   * Employment columns on users (joined_date already exists as hire_date)
--   * leave_accrual_log — one row per monthly accrual event
--   * leave_balances additions — adjustment_days column
--   * attendance_day additions — weekend_pay_status + is_paid columns
--   * daily_report_reviews — manager review of agent reports
-- ============================================================================

-- ---------- users — employment fields (idempotent) ----------
-- hire_date already exists on users. We keep that as joined_date.
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_salary       NUMERIC(12, 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS salary_currency      TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type      TEXT NOT NULL DEFAULT 'full_time'
                                            CHECK (employment_type IN ('full_time','part_time','contractor'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS work_pattern         TEXT NOT NULL DEFAULT 'alternating'
                                            CHECK (work_pattern IN ('alternating','cs_rota'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_end_date   DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notice_period_days   INTEGER NOT NULL DEFAULT 30;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact    TEXT;

-- ---------- leave_balances — adjustment column ----------
-- Transparent manual adjustment, separate from natural accrual.
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS adjustment_days  NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS adjustment_note  TEXT;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS recomputed_at    TIMESTAMPTZ;

-- ---------- leave_accrual_log ----------
-- One row per accrual event. Lets you audit every credit ever made to a balance.
-- The accrual cron writes here; manual adjustments via admin also write here.
CREATE TABLE IF NOT EXISTS leave_accrual_log (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  event_date      DATE NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'monthly_accrual',        -- normal monthly grant
                    'recompute_baseline',     -- from "wipe and recompute" button
                    'manual_adjustment',      -- admin tweaked adjustment_days
                    'leave_taken',            -- approved leave consumed days
                    'leave_cancelled',        -- approved leave was later cancelled, days returned
                    'sick_late_notice'        -- sick reported <4hr → no balance hit (audit only)
                  )),
  days_delta      NUMERIC(5, 2) NOT NULL,       -- positive = credit, negative = debit
  tenure_months   INTEGER,                       -- months at the company on this event
  note            TEXT,
  actor_user_id   INTEGER REFERENCES users(id), -- whoever triggered manual events
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accrual_user_year ON leave_accrual_log(user_id, year, event_date DESC);

-- ---------- attendance_day — weekend pay flag ----------
-- weekend_pay_status only relevant for Sat + Sun rows.
-- is_paid is the broader "did this day count as paid" — used by payroll export.
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS weekend_pay_status  TEXT
                                            CHECK (weekend_pay_status IN ('paid','unpaid','pending'));
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS is_paid             BOOLEAN;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS sick_notified_hours NUMERIC(5, 2);
-- Reset weekend_pay_status to 'pending' on Sat/Sun rows that don't have it set yet.
-- (Safe: only touches rows that haven't been processed.)

-- ---------- daily_report_reviews ----------
-- Manager review of an agent's daily report.
CREATE TABLE IF NOT EXISTS daily_report_reviews (
  id              SERIAL PRIMARY KEY,
  report_id       INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  reviewer_id     INTEGER NOT NULL REFERENCES users(id),
  decision        TEXT NOT NULL CHECK (decision IN ('not_satisfactory','satisfactory','good')),
  comment         TEXT,
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id)   -- one review per report (latest review wins via upsert)
);
CREATE INDEX IF NOT EXISTS idx_drr_decision ON daily_report_reviews(decision, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_drr_reviewer ON daily_report_reviews(reviewer_id, reviewed_at DESC);
