-- ============================================================================
-- FK Home — Section 11: Personal info expansion
-- ============================================================================
-- Introduced in r0.12. Adds:
--   * users.date_of_birth  — date type. Only HR + owner + self can view.
--
-- No new tables.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
