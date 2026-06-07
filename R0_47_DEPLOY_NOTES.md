# R0.47 — Payroll salary source = drawer (fixes "No salary on file" + phantom total)

## The bug
The review screen showed a real total net (₹5,07,533) while every row said
"No salary on file". Cause: the payslip flagged rows because `salary_structures`
(the audited salary drawer) was empty, but still computed a net from the legacy
`users.monthly_salary`. Contradiction — a figure you could not see or publish.

## Fix
- **Migration 31** (`31-payroll-salary-seed.sql`): one-time, idempotent seed of the
  salary drawer from existing `monthly_salary` for active India staff who have a
  figure but no drawer row. Makes payroll work immediately with real, editable data.
- **payroll.js**: salary now reads ONLY from the drawer (`salary_structures`). No
  silent `monthly_salary` fallback. A row is flagged "No salary on file" only when
  there is genuinely no drawer figure — and then shows no net (no phantom number).
- **hr-payroll.js**: header total net now excludes flagged rows.

## After deploy
1. Migration 31 seeds the drawer on boot.
2. Hit **Re-generate all** → rows show real nets; flagged only for anyone with no
   salary anywhere. Total net reflects only payable rows.
3. Correct any figure (or add deductions / effective date) in each person's salary
   drawer; Re-generate to refresh.

## Validation
- node --check clean: payroll.js, hr-payroll.js. Module loads clean.
- Seed SQL references only existing user columns; idempotent (NOT EXISTS + ON CONFLICT).
