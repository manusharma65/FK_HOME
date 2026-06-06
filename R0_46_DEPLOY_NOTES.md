# R0.46 — Payroll line editor, per-person publish, joiner proration, sidebar logo

## Changes
- **Migration 30** (`30-payroll-edits.sql`): payslips gains `held`, `extra_earnings`,
  `total_extra`, `employed_days`. Runs on boot.
- **payroll.js**
  - `buildSnapshot`: mid-month joiner proration (pay from joining date, not the 1st);
    LOP clamped 0..employed-days; stores employed_days/extra_earnings/total_extra.
  - `PUT /payslip/:id/override` is now a full line editor: { lop_days, extra_earnings[],
    deductions[], reason, publish }. Recomputes base 60/30/10 from pay-days, adds extra
    earnings (bonus/arrears/incentive/reimbursement/leave encashment), applies deductions,
    net = gross + extra − deductions. Editing holds the row unless publish:true.
  - **Per-person publish** (`POST /payslip/:id/publish`) clears held + notifies; **bulk
    `POST /run/:id/publish-ready`** publishes only ready rows (draft, not held, not flagged).
    Run auto-marks 'approved' (Complete) once all non-flagged payslips are published.
  - Renderer shows extra-earning rows + correct totals + Effective Work Days (employed days).
  - GET /run rows carry leave balance + daily rate (for the leave-encashment quick-add).
- **hr-payroll.js**: review table with per-row status (Draft·ready / Edited·held /
  Published / No salary), per-row Publish, "Publish all ready (N)", and the line editor modal
  (LOP, auto earnings, leave-encashment quick-add, add earning/deduction, live net, negative
  warning, reason, Save draft (hold) / Save & publish). Matches the approved mock.
- **sidebar-logo.png**: rebuilt from `logo_fk_sports.pdf` — transparent, dumbbell recoloured
  light so it reads on the dark sidebar, tagline dropped (illegible at that size).

## Validation
- node --check clean: payroll.js, hr-payroll.js.
- Renderer tested with LOP + bonus + leave encashment + deduction → totals + net words correct.
