-- ============================================================================
-- FK Home — r0.25: HR area routing
-- ============================================================================
-- Adds `hr_area` to users so HR tasks route to the right owner by area, per
-- Tanu & Deepanshi's actual SOPs (confirmed 1 Jun 2026):
--   'daily_ops'  — attendance, leave, regularisation, sick, payroll, warehouse,
--                  onboarding paperwork, CS/Google/Ops recruitment   (Deepanshi)
--   'recruitment_judgement' — appraisals/reviews, probation decisions, KPI flags,
--                  Amazon-PPC recruitment, policy, insurance          (Tanu, senior)
--
-- Routing falls back to the whole hr-team if hr_area is unset, so nothing is
-- ever dropped. Either HR person can COVER the other's items (when one is off),
-- and whoever completes a task is recorded as the doer (audit + future scoring).
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS hr_area TEXT
  CHECK (hr_area IS NULL OR hr_area IN ('daily_ops','recruitment_judgement'));

COMMENT ON COLUMN users.hr_area IS
  'For HR-team members only: which area of HR work routes to them by default. '
  'daily_ops = attendance/leave/regularisation/sick/payroll/onboarding-paperwork/CS+Google+Ops recruitment. '
  'recruitment_judgement = appraisals/probation/KPI/Amazon-PPC recruitment/policy. '
  'Null = no default; HR tasks fall to the whole hr-team.';
