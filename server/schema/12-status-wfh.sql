-- FK Home — r0.14: status set expansion + WFH geolocation
-- Adds 'in_meeting' and 'wfh' to the allowed status set, and stores a single
-- location stamp captured when a user switches to WFH.
-- Idempotent: safe to re-run.

-- 1. Replace the status CHECK constraint to include the two new values.
--    (Old set kept so existing rows + running_late/on_break flows still pass.)
ALTER TABLE user_status DROP CONSTRAINT IF EXISTS user_status_status_check;
ALTER TABLE user_status ADD CONSTRAINT user_status_status_check
  CHECK (status IN (
    'active','idle','running_late','on_break','heads_down','off_sick',
    'on_leave','offline','in_meeting','wfh'
  ));

-- 2. WFH location stamp (single capture at the moment WFH is set).
ALTER TABLE user_status ADD COLUMN IF NOT EXISTS wfh_lat            DOUBLE PRECISION;
ALTER TABLE user_status ADD COLUMN IF NOT EXISTS wfh_lng            DOUBLE PRECISION;
ALTER TABLE user_status ADD COLUMN IF NOT EXISTS wfh_location_at    TIMESTAMPTZ;
ALTER TABLE user_status ADD COLUMN IF NOT EXISTS wfh_accuracy_m     DOUBLE PRECISION;

-- 3. Nudge tracking for sick / heads_down / in_meeting auto-reminders.
--    last_nudge_at = when we last reminded the person to come off the status.
--    nudge_escalated = whether the 1.5h manager escalation has fired.
ALTER TABLE user_status ADD COLUMN IF NOT EXISTS status_nudge_at    TIMESTAMPTZ;
ALTER TABLE user_status ADD COLUMN IF NOT EXISTS status_escalated   BOOLEAN NOT NULL DEFAULT FALSE;
