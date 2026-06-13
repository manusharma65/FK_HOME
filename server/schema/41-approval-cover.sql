-- r1.20 — Away-cover (deputy power #3).
-- When a person (e.g. the owner) is away, their leave-approval queue can be
-- handed to a named deputy (e.g. Satyam). The cover row CAPTURES the covered
-- person's own approval scope at the moment it's switched on, so the deputy
-- inherits EXACTLY that scope and nothing more — no broad permission grants.
-- Owner oversight is unaffected: decisions are still stamped with the deputy's
-- own user id and audited, so it's always visible who actually decided.
CREATE TABLE IF NOT EXISTS approval_cover (
  covered_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  deputy_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_any       BOOLEAN NOT NULL DEFAULT FALSE,   -- captured: covered person had leaves.approve.any
  dept_ids        INTEGER[] NOT NULL DEFAULT '{}',   -- captured: dept ids the covered person could approve
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_cover_deputy ON approval_cover(deputy_user_id) WHERE active = TRUE;
