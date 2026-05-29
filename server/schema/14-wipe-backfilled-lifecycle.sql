-- FK Home — r0.15.3: wipe backfilled lifecycle records
-- The r0.14 backfill generated phantom-overdue reviews and pre-onboarding items
-- for every existing employee, dating back to their hire_date. This created a
-- mess of 80+ overdue tasks in Insights for staff who've been here for years.
--
-- Per Bobby: wipe it clean. HR (Tanu) will manually add the small number of
-- records that actually matter going forward. No history retention.
--
-- This migration ONLY removes lifecycle-driven profile_notes (kind in
-- 'review','onboarding') and their related tasks. It leaves all other
-- profile_notes (performance, general notes) UNTOUCHED.
--
-- Idempotent: after the first run, the rows are gone; subsequent runs do
-- nothing because the WHERE clauses match no rows.

-- 1. Delete tasks tied to lifecycle profile_notes that we're about to wipe.
--    The tasks table has ON DELETE CASCADE on related_profile_note_id, so the
--    profile_notes DELETE below would cascade — but we do this explicitly first
--    so it's clear what's happening and the audit makes sense.
DELETE FROM tasks
 WHERE related_profile_note_id IN (
   SELECT id FROM profile_notes WHERE kind IN ('review', 'onboarding')
 );

-- 2. Delete the review + onboarding profile_notes themselves.
DELETE FROM profile_notes WHERE kind IN ('review', 'onboarding');

-- 3. Mark this wipe as done in system_state so we have an audit anchor.
INSERT INTO system_state (key, value)
VALUES ('r0_15_3_lifecycle_wipe_done', 'true')
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW();
