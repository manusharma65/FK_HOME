-- ============================================================================
-- FK Home — Section 24: Profile redesign (r0.33, Stage 1)
-- ============================================================================
-- Adds self-service profile fields, Emp ID, a profile photo store, and the
-- request-and-approve flow for sensitive detail changes (bank, PAN).
-- Everything here is ADDITIVE and IDEMPOTENT — safe to run on the shared
-- prod/staging database. No backfill, no destructive change.
-- ============================================================================

-- 1. New profile columns on users (all nullable). India-format pay fields.
-- NOTE: address + emergency contact already exist as users.personal_address
-- and users.emergency_contact (06/10) — we REUSE those, not duplicate them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS emp_id              TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_email      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blood_group         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_holder TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_ifsc           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pan                 TEXT;

-- Emp ID unique when present (FK### assigned in code; HR-editable).
CREATE UNIQUE INDEX IF NOT EXISTS users_emp_id_uniq
  ON users(emp_id) WHERE emp_id IS NOT NULL;

-- 2. Profile photo — one current photo per user, kept off the users row so
--    the row stays lean. Replaces the avatar initials on the profile + badge.
CREATE TABLE IF NOT EXISTS user_photos (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bytes       BYTEA NOT NULL,
  mime        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Request-and-approve for sensitive detail changes (bank, PAN).
--    One row = one pending change set. The live value on users is NEVER
--    touched until HR approves — so payroll can't follow an unverified edit.
--    changes is { users_column: new_value, ... } applied atomically on approve.
CREATE TABLE IF NOT EXISTS detail_change_requests (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changes              JSONB NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by_user_id INTEGER REFERENCES users(id),
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by_user_id   INTEGER REFERENCES users(id),
  decided_at           TIMESTAMPTZ,
  decided_note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_detail_change_pending
  ON detail_change_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_detail_change_user
  ON detail_change_requests(user_id);
