-- ============================================================================
-- FK Home — Section 10: Probation lifecycle refinement
-- ============================================================================
-- Introduced in r0.11. Adds a new probation_status value:
--   * probation_pass_expected — set when 4-month review passes. Means "on track,
--                                expected to be confirmed at 6 months". HR still
--                                does the final confirm manually at the 6-month
--                                mark.
--
-- No new tables. Just relaxing the CHECK constraint to allow the new value.
-- ============================================================================

DO $$
DECLARE
  cname TEXT;
  col_id INT;
BEGIN
  -- Find the attnum of users.probation_status
  SELECT attnum INTO col_id
    FROM pg_attribute
   WHERE attrelid = 'users'::regclass AND attname = 'probation_status';

  IF col_id IS NULL THEN
    -- Column doesn't exist yet (schema 09 hasn't run). Add it.
    EXECUTE 'ALTER TABLE users ADD COLUMN probation_status TEXT';
    SELECT attnum INTO col_id FROM pg_attribute
     WHERE attrelid = 'users'::regclass AND attname = 'probation_status';
  END IF;

  -- Find any existing CHECK constraint that references this column
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'users'::regclass
     AND contype = 'c'
     AND col_id = ANY(conkey)
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_probation_status_check
  CHECK (probation_status IS NULL OR probation_status IN
    ('in_probation','probation_pass_expected','confirmed','extended','failed'));

-- r0.11 — self-service personal info field (address). phone + emergency_contact
-- already exist.
ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_address TEXT;
