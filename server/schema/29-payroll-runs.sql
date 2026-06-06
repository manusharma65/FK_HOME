-- FK Home — Payroll generation (r0.45)
-- ----------------------------------------------------------------------------
-- Two tables that turn the read-only payroll rollup into a generate -> review
-- -> approve -> publish flow:
--   payroll_runs  — one row per (year, month). status draft|approved.
--   payslips      — one row per employee per run. Frozen snapshot of the
--                   figures + employee details at generation/publish time, so
--                   a published payslip never changes even if salary/attendance
--                   are later edited.
-- India only (currency INR). No PF/ESI auto-deductions; custom deductions come
-- from salary_structures.deduction_1..3. Net = total earnings (actual) minus
-- total deductions.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_runs (
  id           BIGSERIAL PRIMARY KEY,
  year         INTEGER NOT NULL,
  month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by  INTEGER REFERENCES users(id),
  approved_at  TIMESTAMPTZ,
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS payslips (
  id                 BIGSERIAL PRIMARY KEY,
  run_id             BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year               INTEGER NOT NULL,
  month              INTEGER NOT NULL,

  -- Frozen employee details (snapshot — never re-read after publish)
  emp_name           TEXT,
  emp_designation    TEXT,
  emp_department     TEXT,
  emp_code           TEXT,
  emp_location       TEXT,
  pf_no              TEXT,
  pf_uan             TEXT,
  bank_name          TEXT,
  bank_account       TEXT,
  pan                TEXT,
  doj                DATE,

  -- Calc inputs
  currency           TEXT NOT NULL DEFAULT 'INR',
  monthly_ctc        NUMERIC(12,2) NOT NULL DEFAULT 0,
  calendar_days      INTEGER NOT NULL,
  lop_days           NUMERIC(5,1) NOT NULL DEFAULT 0,
  paid_days          NUMERIC(5,1),
  lop_dates          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ['2026-04-12', ...]

  -- Lines (each: {label, master, actual} for earnings; {label, actual} for deductions)
  earnings           JSONB NOT NULL DEFAULT '[]'::jsonb,
  deductions         JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Totals
  total_earn_master  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_earn_actual  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions   NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay            NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_in_words       TEXT,

  -- Override (HR adjusts a generated figure, with a logged reason)
  override_reason    TEXT,
  overridden_by      INTEGER REFERENCES users(id),
  overridden_at      TIMESTAMPTZ,

  -- Lifecycle
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','published','revoked')),
  flagged            BOOLEAN NOT NULL DEFAULT FALSE,   -- e.g. no salary on file
  flag_note          TEXT,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at       TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  revoke_reason      TEXT,
  revoked_by         INTEGER REFERENCES users(id),

  UNIQUE (run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_user_period ON payslips(user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(run_id);
