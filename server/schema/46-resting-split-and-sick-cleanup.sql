-- r1.27 — split casual "Take rest" (resting) from genuine off-sick, and clean up the
-- stale data that was blocking leave and sticking people on "Sick".
--
-- This migration is one-time and idempotent in effect. It only touches sick_log and
-- user_status (both long-standing tables) — nothing to do with the Academy schema.

-- 0) Allow the new 'resting' presence value at the database level. The casual "Take rest"
--    status is separate from off_sick; without this the INSERT/UPDATE would be rejected by
--    the existing CHECK constraint.
ALTER TABLE user_status DROP CONSTRAINT IF EXISTS user_status_status_check;
ALTER TABLE user_status ADD CONSTRAINT user_status_status_check
  CHECK (status IN ('active','idle','running_late','on_break','heads_down','resting','off_sick','on_leave','offline','in_meeting','wfh'));

-- 1) THE LEAVE BLOCK. The old "report sick" flow wrote sick_log rows with end_date = NULL.
--    isUserSickOn() treats start_date <= D AND (end_date IS NULL OR end_date >= D), so an
--    open-ended row made every FUTURE date read as off-sick, and leave requests were
--    rejected with "you're recorded as off sick that day". Close each open row to its own
--    start date, so it covers only the day it was actually reported.
UPDATE sick_log
   SET end_date = start_date
 WHERE end_date IS NULL
   AND deleted_at IS NULL;

-- 2) STUCK "SICK" PRESENCE. Casual rest used to write user_status='off_sick' and didn't
--    always clear on return, so people stayed shown as Sick. Genuine off-sick is a dated
--    day (attendance_day / Leave & Time), never a live presence — so any off_sick presence
--    is stale casual-rest. Drop it to offline; it re-derives on the next heartbeat, and the
--    new casual flow writes 'resting' instead.
UPDATE user_status
   SET status = 'offline', changed_at = NOW()
 WHERE status = 'off_sick';
