-- ============================================================================
-- FK Home — Section 25: Onboarding checklist v2 (state + verify loop)
-- ============================================================================
-- Adds the fields that turn onboarding items from a simple done/not-done flag
-- into a proper workflow: To do -> Submitted -> Verified, with Needs-redo and
-- N/A branches, grouping, ordering, and an optional link to a profile field
-- (so filling it in My details auto-submits the item).
-- All ADDITIVE + IDEMPOTENT. is_completed is kept in sync by the app so the
-- existing onboarding counts keep working. Only onboarding rows use ob_*.
-- ============================================================================

ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_status        TEXT;     -- to_do|submitted|verified|needs_redo|na
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_required      BOOLEAN;  -- TRUE=mandatory, FALSE=optional
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_group         TEXT;     -- section label, e.g. 'The basics'
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_sort          INTEGER;  -- order within the whole checklist
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_redo_reason   TEXT;     -- HR's one-line reason when bouncing
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_field         TEXT;     -- linked profile field (auto-submit when filled)
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_decided_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE profile_notes ADD COLUMN IF NOT EXISTS ob_decided_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profile_notes_ob_status
  ON profile_notes(ob_status) WHERE kind = 'onboarding';
