-- FK Home — trusted (office) devices
-- A device becomes "trusted" when an owner taps "Trust this device" on an office
-- machine: we store a hash of a long-lived device token (the raw token lives only
-- in the machine's cookie). Clock-in will later use this to tell an office punch
-- from a remote one — without needing a static office IP. Dormant until ship 2.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id           BIGSERIAL PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_by   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_active ON trusted_devices (token_hash) WHERE revoked_at IS NULL;
