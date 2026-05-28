-- FK Home — r0.15 (HR-1.5): anniversary-based leave year + weekend pay correctness
-- - leave_balances gets a leave_year_start column (anniversary date for that balance row)
-- - Index migrated from (user_id, year) to (user_id, leave_year_start)
-- - system_state table for one-time backfill flag
-- Idempotent: safe to re-run.

ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS leave_year_start DATE;

-- For any existing row without a leave_year_start, derive it from the user's
-- most recent hire-anniversary on or before today. If hire_date is null we
-- leave leave_year_start null and the row will be ignored by the engine.
UPDATE leave_balances lb
   SET leave_year_start = (
     SELECT (
       DATE_TRUNC('day', u.hire_date)::date
       + ((EXTRACT(YEAR FROM AGE(CURRENT_DATE, u.hire_date)))::int || ' years')::interval
     )::date
     FROM users u
     WHERE u.id = lb.user_id AND u.hire_date IS NOT NULL
   )
 WHERE leave_year_start IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS leave_balances_user_anniv_uniq
  ON leave_balances(user_id, leave_year_start)
  WHERE leave_year_start IS NOT NULL;

CREATE TABLE IF NOT EXISTS system_state (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
