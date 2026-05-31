-- FK Home — r0.20.2: allow custom chat groups
-- The chat_channels.type CHECK only permitted department / all_hands / dm,
-- so creating a custom group (type='group') failed at the DB. Widen the
-- constraint to include 'group'. Idempotent — safe to re-run.

ALTER TABLE chat_channels DROP CONSTRAINT IF EXISTS chat_channels_type_check;
ALTER TABLE chat_channels ADD CONSTRAINT chat_channels_type_check
  CHECK (type = ANY (ARRAY['department'::text, 'all_hands'::text, 'dm'::text, 'group'::text]));
