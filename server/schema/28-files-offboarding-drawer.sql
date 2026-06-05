-- ============================================================================
-- FK Home — Section 28: allow 'offboarding' files
-- ============================================================================
-- The files.drawer CHECK (last set in 23-task-files) did not include
-- 'offboarding', so uploading a relieving letter / FnF statement against an
-- exit item failed. Re-assert the constraint with 'offboarding' added.
-- Uses the same robust drop-any-drawer-check pattern as 22/23. Idempotent.
-- ============================================================================

DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'files'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%drawer%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE files DROP CONSTRAINT %I', c); END IF;

  ALTER TABLE files ADD CONSTRAINT files_drawer_chk CHECK (drawer IN (
    'personal','employment','salary','appraisals','reviews',
    'payroll','insurance','performance','onboarding',
    'candidate','task','offboarding'
  ));
END $$;
