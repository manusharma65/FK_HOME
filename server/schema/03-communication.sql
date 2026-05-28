-- ============================================================================
-- FK Home — Section 3: Communication (chat + notifications)
-- ============================================================================
-- Tables: chat_channels, chat_channel_members, chat_messages, chat_reads,
--         notifications
--
-- Design notes:
--  * Channel types: 'department' (auto, per dept), 'all_hands' (one global),
--    'dm' (1:1 between two users), 'custom' (manually created groups).
--  * dm channels: dm_pair_key is the lower_id-higher_id (e.g. "3-7") so we
--    never create duplicates regardless of who initiates.
--  * chat_messages soft-delete via deleted_at — keep history for audit but
--    hide from UI when deleted.
--  * chat_reads stores last_read_message_id per (user_id, channel_id) —
--    unread count = messages newer than this.
--  * notifications: unified bell feed. type identifies the source
--    (leave.requested, leave.approved, leave.rejected, lateness.reported,
--    sick.reported, chat.mention, system.welcome, etc.).
--  * notifications.action_url tells the client where to go on click.
-- ============================================================================

-- ---------- chat_channels ----------
CREATE TABLE IF NOT EXISTS chat_channels (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE,                          -- e.g. 'dept-amazon', 'all-hands', 'dm-3-7'
  name            TEXT NOT NULL,                         -- 'Amazon team', 'All hands', or "" for DMs (UI computes)
  type            TEXT NOT NULL CHECK (type IN ('department','all_hands','dm','custom')),
  department_id   INTEGER REFERENCES departments(id),    -- set for department channels
  dm_pair_key     TEXT UNIQUE,                          -- "lowerId-higherId" for dms, null otherwise
  description     TEXT,
  is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_channels_type ON chat_channels(type) WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_chat_channels_dept ON chat_channels(department_id) WHERE is_archived = FALSE;

-- ---------- chat_channel_members ----------
CREATE TABLE IF NOT EXISTS chat_channel_members (
  channel_id      INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_muted        BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ccm_user ON chat_channel_members(user_id);

-- ---------- chat_messages ----------
CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  channel_id      INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_user_id  INTEGER NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  reply_to_id     BIGINT REFERENCES chat_messages(id),   -- threading (optional)
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_user_id, created_at DESC);

-- ---------- chat_reads ----------
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id         INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  last_read_message_id BIGINT,
  last_read_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel_id)
);

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,           -- e.g. 'leave.requested', 'lateness.reported'
  title           TEXT NOT NULL,
  body            TEXT,
  action_url      TEXT,                    -- where to go on click (e.g. '/admin#leaves/123')
  related_user_id INTEGER REFERENCES users(id),   -- who triggered this
  related_type    TEXT,                    -- e.g. 'leave_request', 'lateness_log'
  related_id      TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_all ON notifications(user_id, created_at DESC);

-- ---------- triggers ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_chat_channels_updated_at') THEN
    CREATE TRIGGER trg_chat_channels_updated_at BEFORE UPDATE ON chat_channels
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
END $$;
