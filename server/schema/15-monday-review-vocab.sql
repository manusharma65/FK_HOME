-- FK Home — r0.16: Align review schema with Bobby's Monday board "Employee Records" (5096480375)
--
-- New review_type values: 3_month, 6_month (added alongside existing 1_month/4_month/8_month/annual/ad_hoc)
-- New review outcomes (status values): needs_improvement, passed, excellent, salary_reviewed, in_process
-- Existing rows keep their current status; engine maps them in app layer.
-- Idempotent: safe to re-run.

-- Drop old CHECK constraint on review_type (if it exists) and recreate with new values
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'profile_notes'::regclass
       AND conname LIKE '%review_type%check%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE profile_notes DROP CONSTRAINT ' || conname
        FROM pg_constraint
       WHERE conrelid = 'profile_notes'::regclass
         AND conname LIKE '%review_type%check%'
       LIMIT 1
    );
  END IF;
END $$;

ALTER TABLE profile_notes ADD CONSTRAINT profile_notes_review_type_check
  CHECK (review_type IS NULL OR review_type IN (
    '1_month','3_month','4_month','6_month','8_month','annual','ad_hoc'
  ));

-- Add a 'cancelled' flag column so r0.16 cancel-as-strike-through can work
-- (we DON'T delete the row; we strike it through and keep it).
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS cancelled_by  INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_profile_notes_cancelled
  ON profile_notes(user_id, kind) WHERE cancelled_at IS NOT NULL;
