-- ============================================================================
-- FK Home — Section 27: Manager assignment
-- ============================================================================
-- A person can have an explicitly-assigned manager (set by HR), shown on their
-- profile. Distinct from review routing (which resolves a reviewer on the fly).
-- ADDITIVE + IDEMPOTENT.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_user_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_user_id) WHERE manager_user_id IS NOT NULL;
