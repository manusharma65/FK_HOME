-- ============================================================================
-- FK Home — r0.27: candidate files (attach a file to a task, not just a user)
-- ============================================================================
-- The files table (r0.9) requires user_id NOT NULL — every file belongs to an
-- employee. A recruitment candidate is NOT a user (no account until hired), so
-- a candidate CV/photo has no user_id to attach to.
--
-- Option A (chosen): extend the files table additively so a file can attach to
-- EITHER a user (employee docs, unchanged) OR a task (candidate CV/photo).
-- This reuses the entire existing upload / view / soft-delete / 90-day-purge
-- machinery — nothing parallel to maintain.
--
-- Additive + safe to re-run.
-- ============================================================================

-- 1. Allow a file to belong to a task (a recruitment candidate) instead of a user.
ALTER TABLE files ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;

-- 2. Relax user_id so a candidate file (no user) is valid.
ALTER TABLE files ALTER COLUMN user_id DROP NOT NULL;

-- 3. Guarantee every file still belongs to exactly one thing — a user OR a task.
--    (Prevents an orphan file with neither.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'files'::regclass AND conname = 'files_owner_chk'
  ) THEN
    ALTER TABLE files ADD CONSTRAINT files_owner_chk
      CHECK (user_id IS NOT NULL OR task_id IS NOT NULL);
  END IF;
END $$;

-- 4. Widen the drawer CHECK to allow a 'candidate' drawer for candidate files.
--    (Existing drawers untouched; just adds one.)
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

-- 5. Fast lookup of a candidate's files.
CREATE INDEX IF NOT EXISTS idx_files_task
  ON files(task_id, uploaded_at DESC)
  WHERE deleted_at IS NULL AND task_id IS NOT NULL;
