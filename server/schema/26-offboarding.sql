-- ============================================================================
-- FK Home — Section 26: Offboarding (exit mirror of onboarding)
-- ============================================================================
-- Reuses profile_notes (kind='offboarding') + the ob_* workflow columns from
-- section 25. Adds an owner (which area clears the item) and a leaver-visible
-- flag (which items the departing person sees in their own panel). Plus the
-- exit fields on users. All ADDITIVE + IDEMPOTENT.
-- ============================================================================

-- Allow kind = 'offboarding' on profile_notes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_notes_kind_check') THEN
    ALTER TABLE profile_notes DROP CONSTRAINT profile_notes_kind_check;
  END IF;
  ALTER TABLE profile_notes
    ADD CONSTRAINT profile_notes_kind_check
    CHECK (kind IN ('review','onboarding','offboarding'));
END $$;

ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_owner   TEXT;     -- it|finance|manager|hr|leaver
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_leaver  BOOLEAN DEFAULT FALSE;  -- shown in leaver panel

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_working_day DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notice_date      DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS exit_reason      TEXT;

CREATE INDEX IF NOT EXISTS idx_users_offboarding
  ON users(last_working_day) WHERE last_working_day IS NOT NULL AND employment_status <> 'left';
