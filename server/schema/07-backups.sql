-- ============================================================================
-- FK Home — Section 7: Backup log
-- ============================================================================
-- Introduced in r0.8. Adds:
--   * backup_log — one row per backup attempt (cron or manual)
-- ============================================================================

CREATE TABLE IF NOT EXISTS backup_log (
  id              SERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','success','failed')),
  trigger         TEXT NOT NULL
                    CHECK (trigger IN ('cron','manual')),
  size_bytes      BIGINT,
  duration_ms     INTEGER,
  object_key      TEXT,                       -- key in B2 bucket
  error_message   TEXT,
  actor_user_id   INTEGER REFERENCES users(id) -- null for cron, set for manual
);
CREATE INDEX IF NOT EXISTS idx_backup_log_started ON backup_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_log_status  ON backup_log(status, started_at DESC);
