-- 43-leave-approval-stage.sql
-- r1.25 — Two-stage leave approval. A request goes to the line manager first,
-- then (on manager approval) to HR. `stage` tracks where it is:
--   'manager' = awaiting the dept manager · 'hr' = awaiting HR · NULL = decided.
-- Previously every request fanned out to manager + owner + both HR at once with no
-- chain. Existing in-flight pending requests are moved to the HR stage so HR can
-- finalise them (they were already visible to HR under the old flow).
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS stage TEXT;
UPDATE leave_requests SET stage = 'hr' WHERE status = 'pending' AND stage IS NULL;
