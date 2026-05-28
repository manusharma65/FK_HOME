-- ============================================================================
-- FK Home — Section 9: Lifecycle (reviews, tasks, onboarding templates, settings)
-- ============================================================================
-- Introduced in r0.10. Adds the employee lifecycle layer:
--   * settings              — key/value config (review windows, probation length…)
--   * onboarding_templates  — company-wide checklist items copied to new hires
--   * tasks                 — actionable items assigned to users (reviews mostly)
--   * users extensions      — probation_status, probation_end_date, left_date
--   * profile_notes ext.    — review_type, review_date, status (for reviews)
--   * files ext.            — profile_note_id (so files attach to a review)
-- ============================================================================

-- ---------- settings ----------
-- Owner-editable key/value config. Used for things we want to tweak without
-- a code deploy (review grace days, probation length, etc).
CREATE TABLE IF NOT EXISTS settings (
  key                 TEXT PRIMARY KEY,
  value               JSONB NOT NULL,
  description         TEXT,
  updated_by_user_id  INTEGER REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- onboarding_templates ----------
-- Base checklist applied to every new hire. Tanu edits in Admin → Settings.
CREATE TABLE IF NOT EXISTS onboarding_templates (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- tasks ----------
-- An action someone owes. Right now only review tasks; designed to be extended.
CREATE TABLE IF NOT EXISTS tasks (
  id                      SERIAL PRIMARY KEY,
  kind                    TEXT NOT NULL CHECK (kind IN ('review')),
  related_user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  related_profile_note_id INTEGER REFERENCES profile_notes(id) ON DELETE CASCADE,
  assignee_user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason                  TEXT NOT NULL CHECK (reason IN ('reviewer','orchestrator')),
  title                   TEXT NOT NULL,
  body                    TEXT,
  opens_at                TIMESTAMPTZ NOT NULL,
  due_at                  TIMESTAMPTZ NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','open','due','overdue','done','cancelled')),
  last_nudged_at          TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  completed_by_user_id    INTEGER REFERENCES users(id),
  cancelled_at            TIMESTAMPTZ,
  cancel_reason           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee_user_id, status) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_tasks_related_user ON tasks(related_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_note ON tasks(related_profile_note_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at) WHERE status NOT IN ('done','cancelled');

-- ---------- users — probation + left_date ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_status   TEXT
  CHECK (probation_status IS NULL OR probation_status IN ('in_probation','confirmed','extended','failed'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_end_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS left_date          DATE;

-- ---------- profile_notes — extend for reviews ----------
-- We're collapsing 'performance' and 'appraisal' into 'review'.
-- The kind CHECK constraint needs to be updated to allow 'review'.
DO $$ BEGIN
  -- Drop the old constraint if present (it may have a generated name)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'profile_notes'::regclass
       AND conname = 'profile_notes_kind_check'
  ) THEN
    ALTER TABLE profile_notes DROP CONSTRAINT profile_notes_kind_check;
  END IF;
END $$;

-- Migrate old kind values to the new vocabulary first
UPDATE profile_notes SET kind = 'review' WHERE kind IN ('performance','appraisal');

-- Re-add the constraint with new allowed values
ALTER TABLE profile_notes
  ADD CONSTRAINT profile_notes_kind_check
  CHECK (kind IN ('review','onboarding'));

ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS review_type TEXT
  CHECK (review_type IS NULL OR review_type IN ('1_month','4_month','8_month','annual','ad_hoc'));
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS review_date DATE;
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS status      TEXT;
-- status vocabulary depends on review_type:
--   4_month       — scheduled / pass / extend / fail
--   others        — scheduled / needs_improvement / satisfactory / good
-- Enforced in application layer (too dynamic for a single CHECK constraint).

CREATE INDEX IF NOT EXISTS idx_profile_notes_review_date ON profile_notes(review_date) WHERE kind = 'review';

-- ---------- files — link to a specific review ----------
ALTER TABLE files ADD COLUMN IF NOT EXISTS profile_note_id INTEGER REFERENCES profile_notes(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_files_profile_note ON files(profile_note_id) WHERE profile_note_id IS NOT NULL AND deleted_at IS NULL;

-- Update files.drawer CHECK constraint: drop 'performance' and 'appraisals',
-- add 'reviews' to match the new drawer layout.
UPDATE files SET drawer = 'reviews' WHERE drawer IN ('performance','appraisals');

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'files'::regclass
       AND conname = 'files_drawer_check'
  ) THEN
    ALTER TABLE files DROP CONSTRAINT files_drawer_check;
  END IF;
END $$;

ALTER TABLE files
  ADD CONSTRAINT files_drawer_check
  CHECK (drawer IN ('personal','employment','salary','reviews',
                    'payroll','insurance','onboarding'));

-- ---------- triggers ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tasks_updated_at') THEN
    CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_onboarding_templates_updated_at') THEN
    CREATE TRIGGER trg_onboarding_templates_updated_at BEFORE UPDATE ON onboarding_templates
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
END $$;

-- ---------- seed onboarding templates ----------
-- These match a typical UK SME onboarding flow. Tanu can edit in Admin later.
INSERT INTO onboarding_templates (title, body, sort_order, is_active)
SELECT * FROM (VALUES
  ('Sign NDA',                 'Standard non-disclosure agreement. Upload signed copy to your Onboarding drawer.', 10, TRUE),
  ('Sign employment contract', 'Read and sign your contract. Upload signed copy.', 20, TRUE),
  ('Provide ID document',      'Passport or driving licence — upload a clear photo or scan.', 30, TRUE),
  ('Provide proof of address', 'Recent utility bill or bank statement (under 3 months old).', 40, TRUE),
  ('Provide bank details',     'For salary payments. Upload a bank statement or use the form.', 50, TRUE),
  ('Set emergency contact',    'Name, relationship, phone number of someone to contact if needed.', 60, TRUE),
  ('IT setup complete',        'Email account set up, system access granted, hardware received.', 70, TRUE),
  ('Read employee handbook',   'Tick once you have read the company handbook (HR will share).', 80, TRUE)
) AS t(title, body, sort_order, is_active)
WHERE NOT EXISTS (SELECT 1 FROM onboarding_templates LIMIT 1);

-- ---------- seed settings ----------
INSERT INTO settings (key, value, description)
VALUES
  ('review_open_window_days',    '7'::jsonb, 'Days before due date that a review task opens (becomes visible to assignee)'),
  ('review_grace_days',          '3'::jsonb, 'Days after due date before a review task turns red (overdue)'),
  ('review_nudge_interval_days', '7'::jsonb, 'How often (in days) to re-nudge an overdue review task'),
  ('probation_months',           '6'::jsonb, 'Default probation length in months for new hires')
ON CONFLICT (key) DO NOTHING;

-- ---------- backfill probation_status for existing users ----------
-- Anyone with a hire_date who has no probation_status set yet:
--   * If hire_date + probation_months > today → in_probation
--   * Else → confirmed (they're past probation already, retro-mark them)
UPDATE users
SET probation_status = 'in_probation',
    probation_end_date = (hire_date + INTERVAL '6 months')::date
WHERE hire_date IS NOT NULL
  AND probation_status IS NULL
  AND (hire_date + INTERVAL '6 months')::date > CURRENT_DATE
  AND deleted_at IS NULL;

UPDATE users
SET probation_status = 'confirmed'
WHERE hire_date IS NOT NULL
  AND probation_status IS NULL
  AND (hire_date + INTERVAL '6 months')::date <= CURRENT_DATE
  AND deleted_at IS NULL;
