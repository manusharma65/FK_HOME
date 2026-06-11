-- FK Home — system error log (monitoring)
-- Best-effort sink for unhandled errors, route throws and process-level
-- rejections, so breakage is visible (via /healthz and the daily heartbeat)
-- instead of vanishing into stdout. No FK on user_id (capture is best-effort and
-- must never fail because a user row is missing).
CREATE TABLE IF NOT EXISTS system_errors (
  id          BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context     TEXT,
  method      TEXT,
  path        TEXT,
  user_id     INTEGER,
  message     TEXT,
  stack       TEXT
);
CREATE INDEX IF NOT EXISTS idx_system_errors_occurred ON system_errors (occurred_at DESC);
