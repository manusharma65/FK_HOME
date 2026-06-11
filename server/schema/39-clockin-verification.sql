-- FK Home — clock-in verification (office vs WFH, selfie, HR approval of exceptions)
-- Additive + dormant until the clock-in screen flips on in the final pass.
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS arrival_place   TEXT;     -- 'office' | 'remote'
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS approval_state  TEXT NOT NULL DEFAULT 'auto'; -- auto | pending | approved | flagged
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS approved_by     INTEGER;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS selfie_id       BIGINT;

-- Clock-in selfies. Stored as bytea, glanced at by HR, never face-matched, and
-- purged at 90 days by a daily cron.
CREATE TABLE IF NOT EXISTS clock_in_selfies (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  for_date    DATE NOT NULL,
  image       BYTEA NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'image/jpeg',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clock_in_selfies_purge ON clock_in_selfies (captured_at);
CREATE INDEX IF NOT EXISTS idx_clock_in_selfies_day ON clock_in_selfies (user_id, for_date);
