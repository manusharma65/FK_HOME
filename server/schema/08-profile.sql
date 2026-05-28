-- ============================================================================
-- FK Home — Section 8: Employee profiles + document storage (HR-3)
-- ============================================================================
-- Introduced in r0.9. Adds:
--   * files               — bytea-backed file storage, attached to a user + drawer
--   * salary_structures   — one CURRENT salary row per user (history in audit_log)
--   * profile_notes       — performance / appraisal / onboarding text entries
-- ============================================================================

-- ---------- files ----------
-- One row per uploaded file. Content lives inline (bytea) so backups capture
-- the lot in a single pg_dump. Soft-delete via deleted_at, hard-purge after
-- 90 days via the daily 03:00 cron.
CREATE TABLE IF NOT EXISTS files (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drawer          TEXT NOT NULL CHECK (drawer IN (
                    'personal','employment','salary','appraisals',
                    'payroll','insurance','performance','onboarding'
                  )),
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  content         BYTEA NOT NULL,
  description     TEXT,
  uploaded_by_user_id  INTEGER REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  deleted_by_user_id   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_files_user_drawer ON files(user_id, drawer, uploaded_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(deleted_at) WHERE deleted_at IS NOT NULL;

-- ---------- salary_structures ----------
-- One CURRENT salary row per user. Edits write to audit_log for history.
CREATE TABLE IF NOT EXISTS salary_structures (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_ctc         NUMERIC(12,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  effective_from      DATE NOT NULL,
  deduction_1_label   TEXT,
  deduction_1_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  deduction_2_label   TEXT,
  deduction_2_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  deduction_3_label   TEXT,
  deduction_3_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  updated_by_user_id  INTEGER REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- profile_notes ----------
-- Free-text entries on three drawers: performance, appraisal, onboarding.
-- Onboarding entries can be checklist items (is_completed flag).
CREATE TABLE IF NOT EXISTS profile_notes (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('performance','appraisal','onboarding')),
  title           TEXT NOT NULL,
  body            TEXT,
  is_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  completed_by_user_id INTEGER REFERENCES users(id),
  author_user_id  INTEGER NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profile_notes_user_kind ON profile_notes(user_id, kind, created_at DESC);

-- ---------- triggers ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_profile_notes_updated_at') THEN
    CREATE TRIGGER trg_profile_notes_updated_at BEFORE UPDATE ON profile_notes
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_salary_structures_updated_at') THEN
    CREATE TRIGGER trg_salary_structures_updated_at BEFORE UPDATE ON salary_structures
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
END $$;
