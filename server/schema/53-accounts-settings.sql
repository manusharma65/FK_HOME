-- r1.47 — small key/value settings for the accounts module (CA email, etc.).
CREATE TABLE IF NOT EXISTS acc_setting (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
