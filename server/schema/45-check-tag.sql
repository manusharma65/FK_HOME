-- 45-check-tag.sql — label a check (e.g. 'Aptitude') so the learner UI can show a
-- distinct kicker and aptitude/sanity checks read differently from job scenarios.
-- Idempotent: safe to re-run.
ALTER TABLE lms_checks ADD COLUMN IF NOT EXISTS tag TEXT;
