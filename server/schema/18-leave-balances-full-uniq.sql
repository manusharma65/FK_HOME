-- FK Home — r0.21.1 (HR-1.5 fix): full unique index on (user_id, leave_year_start)
-- ----------------------------------------------------------------------------
-- The anniversary migration (13) created a PARTIAL unique index:
--   ... ON leave_balances(user_id, leave_year_start) WHERE leave_year_start IS NOT NULL
-- Postgres will only use a partial index for ON CONFLICT if the INSERT repeats
-- the same WHERE predicate. The engine's plain
--   ON CONFLICT (user_id, leave_year_start)
-- does not, so the backfill + recompute threw:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Fix: replace the partial index with a FULL unique index on the same columns.
-- A full index needs no predicate, so plain ON CONFLICT (user_id, leave_year_start)
-- matches it. The engine only ever writes rows WITH a leave_year_start now, and
-- duplicate (user_id, leave_year_start) pairs were verified to be zero before
-- this migration, so the full index builds cleanly. (NULL leave_year_start rows,
-- if any legacy ones exist, are allowed — NULLs are distinct in a unique index.)
-- Idempotent + safe to re-run.
-- ----------------------------------------------------------------------------

DROP INDEX IF EXISTS leave_balances_user_anniv_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS leave_balances_user_anniv_uniq
  ON leave_balances(user_id, leave_year_start);

-- ----------------------------------------------------------------------------
-- Clean up legacy calendar-style rows that have a NULL leave_year_start.
-- These are pre-anniversary seed rows (flat-25). The engine now reads balances
-- by anniversary and ignores NULL rows, so they only cause confusion in the
-- table. Verified before this migration: the only NULL-hire_date user is the
-- owner (who does not accrue); all non-owner employees now have a hire_date, so
-- the boot backfill will build each a correct anniversary row. Safe to remove.
-- (No manual adjustment_days existed on these rows — checked — so nothing lost.)
-- ----------------------------------------------------------------------------
DELETE FROM leave_balances WHERE leave_year_start IS NULL;

