# R0.45 — Payroll generation engine + logos

## What ships
- **Migration 29** (`server/schema/29-payroll-runs.sql`): `payroll_runs` + `payslips`
  (frozen snapshot per employee per month). Runs automatically on boot.
- **`server/modules/payroll.js`**: generation engine on top of the existing rollup.
  - 60% Basic / 30% HRA / 10% Special (Basic+HRA rounded, Special = remainder → always sums).
  - Actual = round(CTC × (calendar days − LOP) / calendar days), split 60/30/10.
  - Deductions = flat, from `salary_structures.deduction_1..3`. Net = total earnings (actual) − deductions.
  - India only (`salary_currency = 'INR'`, owner excluded). LOP reuses `rollupForUser` (no
    Sunday / day-off / holiday / approved-leave miscounted).
  - Endpoints: POST `/run`, GET `/run`, PUT `/payslip/:id/override`, POST `/payslip/:id/regenerate`,
    POST `/run/:id/approve`, POST `/payslip/:id/revoke`, POST `/payslip/:id/publish`,
    GET `/user/:userId`, GET `/payslip/:id/html`.
  - Approve publishes every draft, locks figures, fires "Your payslip is ready" notification.
  - Payslip HTML renderer reproduces the approved design; logo at `/assets/payslip-logo.png`.
- **`public/modules/hr-payroll.js`**: Run / review (net + LOP by date) / Override (corrected LOP +
  reason) / Re-generate / Approve & publish / Revoke / Re-publish. Proper modal, full-size buttons.
- **`public/modules/profile.js`**: Pay tab lists published payslips with View; manual upload kept as fallback.
- **`public/index.html` + `public/assets/sidebar-logo.png`**: sidebar logo (fk-logo.png, dark surface).
- **`public/assets/payslip-logo.png`**: from `logo_fk_sports.pdf` (white-sheet payslip).

## Field notes (cosmetic — design shows "—" gracefully)
- Designation, PF No, PF UAN: no DB field → show "—". Add fields later if wanted.
- Location: constant "Noida".
- Override model = corrected LOP days + reason (re-pro-rates, stays internally consistent).

## Validation
- `node --check` clean: payroll.js, hr-payroll.js, profile.js, index.html inline JS.
- Unit-tested: inrInWords (lakh/crore), 60/30/10 split sums exactly, Indian formatting, renderer.
