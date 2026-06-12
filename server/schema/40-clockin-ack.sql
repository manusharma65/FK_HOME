-- FK Home r1.11 — clock-in prompt acknowledgement.
-- Marks that the user has HANDLED today's clock-in photo prompt, by EITHER taking
-- a photo OR tapping "skip / no photo". Without this, a skipper has no selfie_id,
-- so the modal re-fired on every refresh. Gating the modal on this (not on the
-- photo) means: ask once after the day's clock-in, then never again that day.
-- Additive, idempotent.
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS clockin_ack_at TIMESTAMPTZ;
