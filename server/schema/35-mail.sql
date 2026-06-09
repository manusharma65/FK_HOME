-- FK Home — Mail: personal labels + pinned private notes.
-- These live in FK Home (not synced to Gmail), per the agreed design.
-- Personal mail is per-user, so everything keys on the owning user.

CREATE TABLE IF NOT EXISTS mail_labels (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  colour      TEXT NOT NULL DEFAULT '#6F57A0',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mail_labels_user ON mail_labels(user_id);

CREATE TABLE IF NOT EXISTS mail_message_labels (
  label_id    INTEGER NOT NULL REFERENCES mail_labels(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  TEXT NOT NULL,
  PRIMARY KEY (label_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_msglabels_user ON mail_message_labels(user_id, message_id);

CREATE TABLE IF NOT EXISTS mail_notes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  TEXT NOT NULL,
  body        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, message_id)
);
