-- 33-idle-reason.sql
-- Lets an agent explain an away-from-desk idle gap in free text.
-- The reason is stored on the triggering idle_event; giving one also marks the
-- event acknowledged, which suppresses the 20-min manager escalation (managers
-- then only chase UNEXPLAINED idles). Idempotent.
ALTER TABLE idle_events ADD COLUMN IF NOT EXISTS reason TEXT;
