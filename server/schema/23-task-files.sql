-- ============================================================================
-- FK Home — r0.28: task-card files (allow drawer='task')
-- ============================================================================
-- r0.27 added files.task_id + a 'candidate' drawer. The task card (r0.28) also
-- attaches files to a task, under drawer='task'. Widen the drawer CHECK to
-- include it. Additive + safe to re-run.
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
    'candidate','task'
  ));
END $$;
