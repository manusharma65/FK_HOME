# R0.68 — Leaver payslip proration + auto leave-encashment (cumulative w/ r0.67)

## Payroll fixes (the real gaps found in the audit)
1. **Mid-month leaver proration** — payslip no longer pays a full month to someone who
   left mid-month. `nonEmployedDays` now also excludes days AFTER `last_working_day`
   (it already excluded days before a mid-month hire). Effective work days + net drop
   to the days actually worked.
2. **Leavers stay in the run** — `eligibleEmployees` now also includes anyone whose
   `last_working_day` falls in the run month, even if their status already flipped to
   'left', so the final payslip is generated.
3. **Auto leave-encashment line** — a leaver's final-month payslip auto-adds
   "Leave encashment (N days)" = remaining leave × daily rate (CTC ÷ calendar days),
   as an extra-earning. HR can still edit/remove it in the line editor.

No migration needed (last_working_day exists since migration 26).

## Carried from r0.67 (in case not yet deployed)
- Nav group labels bigger (HR/MY DAY/SYSTEM/ABOUT ME 13->15.5px).
- Idle notice -> free-text "why were you away" + HR sees reasons; migration 33 (idle_events.reason).

## Validation
node --check clean: payroll.js, attendance.js. index.html parses clean.

## Check after deploy
- Generate/regenerate payroll for a month with a mid-month leaver: their Effective Work
  Days = days up to last working day; net is prorated; a Leave encashment line appears.
- (r0.67) sidebar labels bigger; idle banner free-text on Home.
