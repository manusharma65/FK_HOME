-- 36-mail-settings.sql — per-user Mail preferences (email signature).
-- Idempotent: safe to run repeatedly.
CREATE TABLE IF NOT EXISTS mail_settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  signature  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
