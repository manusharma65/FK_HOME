-- FK Home — monthly scores
-- One locked row per person per month. The monthly band is DERIVED from that
-- month's weekly bands by strict rules (see daily.js monthlyBandFromWeeks):
--   * rounded average of weekly bands is the base
--   * STRICT FLOOR: any 'Poor' week caps the month at 'Average'
--   * ALL-WEEKS GATE: 'Excellent' needs every week (>=4) Excellent-or-above;
--     'Above Expectations' needs every week Above Expectations; else cap at 'Good'
--   * 'Excellent' / 'Above Expectations' require DIRECTOR (owner) approval —
--     until approved the effective (paying) band is 'Good'.
CREATE TABLE IF NOT EXISTS monthly_scores (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_start     DATE NOT NULL,                 -- first day of the month
  computed_band   TEXT,                          -- raw band from the rules (may be Excellent/Above)
  effective_band  TEXT,                          -- the band that pays (Good until approved)
  week_count      INTEGER NOT NULL DEFAULT 0,    -- weekly scores that fed this month
  reasons         JSONB,                         -- human-readable explanation lines
  needs_approval  BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status TEXT NOT NULL DEFAULT 'n/a',    -- n/a | pending | approved | rejected
  approved_band   TEXT,                          -- the band that was signed off
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  approval_note   TEXT,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month_start)
);

CREATE INDEX IF NOT EXISTS idx_monthly_scores_user ON monthly_scores(user_id, month_start DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_scores_pending ON monthly_scores(approval_status) WHERE approval_status = 'pending';
