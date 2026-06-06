-- FK Home — Payroll r0.46: line-item edits, per-person publish, joiner proration
-- ----------------------------------------------------------------------------
-- held          — an edited payslip is "held" (excluded from "publish all ready"
--                 bulk); HR publishes it deliberately.
-- extra_earnings — manual earning lines added in the editor (bonus, arrears,
--                  incentive, reimbursement, leave encashment): [{label,amount,reason}].
--                  Flat amounts (not pro-rated). Base Basic/HRA/Special stay in `earnings`.
-- employed_days  — days in the month the person was on payroll (handles mid-month
--                  joiners: pay is prorated from joining date, not the 1st).
-- Deductions already live in `deductions` (now also carry an optional reason).
-- ----------------------------------------------------------------------------

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS held           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS extra_earnings JSONB   NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS total_extra    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employed_days  INTEGER;
