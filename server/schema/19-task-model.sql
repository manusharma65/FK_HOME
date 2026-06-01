-- ============================================================================
-- FK Home — r0.22 (Ship 2a): universal task model
-- ============================================================================
-- Extends the existing `tasks` table (r0.10 lifecycle) into the one model that
-- holds ALL work-shapes for every department — without changing how the review
-- / onboarding / probation lifecycle already works.
--
-- PRINCIPLE (learned the hard way): do NOT rewrite working code to fit a new
-- shape — extend the shape so working code keeps working. Every existing column
-- is preserved; the review lifecycle (generate → pending → open → due → overdue
-- → done, reviewer + orchestrator routing, the 06:00 cron) is untouched.
--
-- This migration is ADDITIVE + idempotent:
--   1. Add the universal columns (source, parent_task_id, department_id,
--      category, moved_at, movement_note, meta).
--   2. Widen the kind CHECK (was 'review' only) to all work-shapes.
--   3. Relax NOT NULLs that are review-specific (related_user_id, reason,
--      opens_at, due_at) so ad-hoc / event / recruitment tasks are valid.
--   4. Wipe dummy task rows (staging only — confirmed no real tasks exist).
-- ============================================================================

-- ---------- 1. New universal columns ----------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source         TEXT;          -- auto_event | recurring | manual | cron
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS department_id  INTEGER REFERENCES departments(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category       TEXT;          -- free label within a kind (e.g. ad_hoc → 'recruitment')
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS moved_at       TIMESTAMPTZ;   -- multi-day work: when it last moved
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS movement_note  TEXT;          -- "what moved today" (feeds daily report later)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meta           JSONB;         -- per-type fields (candidate salary/notice/CV-ref, campaign_id, etc.)

-- ---------- Assignment / request model (Ship 2a) ----------
-- A task is normally personal (assignee_user_id = the doer). Three ways a task
-- reaches someone else, decided by the relationship between creator + target:
--   * assignment  — manager/owner → someone they manage / same dept. Lands direct.
--   * handoff     — my own task → a teammate. Lands direct.
--   * request     — anyone → someone in ANOTHER department. Needs accept/decline.
-- The doer (whoever completes it) is who gets scored — so assignee_user_id always
-- points at the current doer. assigned_by_user_id records who put it there.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by_user_id INTEGER REFERENCES users(id);  -- who assigned/requested it (null = self-created)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS request_status      TEXT
  CHECK (request_status IS NULL OR request_status IN ('awaiting','accepted','declined'));      -- only set on cross-dept requests
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requester_user_id   INTEGER REFERENCES users(id);  -- who to notify + who it bounces back to on decline
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS decline_reason      TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reassign_history    JSONB;                          -- append-only log of handoffs/assigns for scoring transparency

CREATE INDEX IF NOT EXISTS idx_tasks_request ON tasks(request_status) WHERE request_status IS NOT NULL;

-- ---------- Widen the status CHECK to allow in_progress ----------
-- Original (09-lifecycle) allowed: pending/open/due/overdue/done/cancelled.
-- The task system adds 'in_progress' (multi-day work being worked on).
-- NOTE: match on 'overdue' (unique to the main status CHECK) — NOT '%status%',
-- because the request_status CHECK also contains the word "status".
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'tasks'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%overdue%'
  LOOP EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', r.conname); END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='tasks'::regclass AND conname='tasks_status_chk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_status_chk CHECK (status IN (
      'pending','open','due','overdue','in_progress','done','cancelled'
    ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_kind_status ON tasks(kind, status) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_tasks_dept ON tasks(department_id) WHERE department_id IS NOT NULL;

-- ---------- 2. Widen the kind CHECK ----------
-- Was CHECK (kind IN ('review')). Add the new work-shapes + onboarding/probation.
-- Match on the column token 'kind' — only the kind CHECK references it.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'tasks'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%(kind%'
  LOOP EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', r.conname); END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='tasks'::regclass AND conname='tasks_kind_chk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_kind_chk CHECK (kind IN (
      'review','onboarding','probation','event','recurring','ad_hoc','recruitment'
    ));
  END IF;
END $$;

-- ---------- 3. Widen the reason CHECK + relax review-specific NOT NULLs ----------
-- Match on 'reviewer' (unique to the reason CHECK: reviewer/orchestrator).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'tasks'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%reviewer%'
  LOOP EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;
-- reason now free-form + nullable (review uses 'reviewer'/'orchestrator'; other kinds leave it null)
ALTER TABLE tasks ALTER COLUMN reason DROP NOT NULL;

-- related_user_id: nullable — a recruitment opening / generic ad-hoc has no related person
ALTER TABLE tasks ALTER COLUMN related_user_id DROP NOT NULL;

-- opens_at / due_at: nullable — ad-hoc / "what I did today" tasks have no schedule
ALTER TABLE tasks ALTER COLUMN opens_at DROP NOT NULL;
ALTER TABLE tasks ALTER COLUMN due_at   DROP NOT NULL;

-- ---------- 4. Tag existing rows + one-time wipe of dummy data ----------
-- Any pre-existing review tasks were generated by the lifecycle cron → source='cron'.
UPDATE tasks SET source = 'cron' WHERE source IS NULL AND kind = 'review';

-- One-time wipe of dummy/test task rows. This migration RE-RUNS whenever its
-- checksum changes (the runner re-applies on change), so the wipe MUST NOT fire
-- on re-runs or it would delete real tasks created since. We guard it with a
-- marker row in `settings`: the DELETE only happens the first time.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE key = 'tasks_dummy_wiped') THEN
    DELETE FROM tasks;  -- only real review RECORDS live in profile_notes; untouched
    INSERT INTO settings (key, value, description)
    VALUES ('tasks_dummy_wiped', 'true'::jsonb, 'Ship 2a one-time dummy task wipe done')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
