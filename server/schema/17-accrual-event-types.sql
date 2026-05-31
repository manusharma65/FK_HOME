-- FK Home — r0.21 (HR-1.5 fix): widen leave_accrual_log.event_type CHECK
-- ----------------------------------------------------------------------------
-- The accrual engine writes two event types the original CHECK never allowed:
--   * 'anniversary_reset' — written by tickMonthlyAccrual on a hire-anniversary
--   * 'backfill'          — written by runBackfillIfNeeded on first boot
-- The original constraint (06-employment.sql) rejected both, so:
--   - the boot backfill's audit-log INSERT threw, the success flag was never
--     set, and the backfill re-ran on every boot;
--   - the monthly accrual would throw on a real anniversary.
-- This migration drops the old CHECK and re-adds it with the full, correct set
-- of event types the code actually writes. Idempotent + safe to re-run.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  con_name TEXT;
BEGIN
  -- Find whatever the current CHECK constraint on event_type is called and drop it.
  SELECT conname INTO con_name
    FROM pg_constraint
   WHERE conrelid = 'leave_accrual_log'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%event_type%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE leave_accrual_log DROP CONSTRAINT %I', con_name);
  END IF;

  -- Re-add with the complete set of event types the engine + leaves.js write.
  ALTER TABLE leave_accrual_log
    ADD CONSTRAINT leave_accrual_log_event_type_chk
    CHECK (event_type IN (
      'monthly_accrual',
      'recompute_baseline',
      'manual_adjustment',
      'leave_taken',
      'leave_cancelled',
      'sick_late_notice',
      'anniversary_reset',
      'backfill'
    ));
END $$;
