# R0.48 — Pay from attendance, remove Employment tab, attendance day modal

## 1. Pay now follows attendance (no more silent overpay)
A day that was *expected but never logged in* (`no_show`, or a past day still
`pending`) used to count as neither paid nor unpaid — so it was silently paid.
Now those count as **unpaid (LOP)**. Worked / approved leave / public holiday /
notified sick / rostered rest days stay **paid** (monthly-salary semantics
preserved — weekends and rota offs are not docked). Net effect: people are paid
for days attendance positively accounts for; unexplained absence is not paid.
- Changed `lopDatesForUser` (drives payslip pay) and `rollupForUser` (drives the
  attendance breakdown) identically, so both screens agree.
- `today`'s pending day is NOT docked (day not over). Month-end runs unaffected.

## 2. Employment tab removed
The profile "Employment" tab was a document cabinet (contract/role files) that
isn't used. Removed from the profile section list. (HR-wide pages untouched.)

## 3. Attendance day → proper modal
On the Time tab, clicking a day now opens a **modal** showing status, **logged in**
and **logged out** times, and active hours — instead of writing a line of text
below the calendar. Added `last_logout` to the attendance-days endpoint.

## Validation
- node --check clean: payroll.js, server/profile.js, public/profile.js. Engine loads.
- Pay classification unit-checked: no_show & past-pending dock; worked/leave/holiday/
  rest/notified-sick paid; today-pending not docked.

## After deploy
Open Team attendance and confirm days are recorded, THEN Payroll -> Re-generate all.
Anyone with unlogged working days will now show LOP and reduced pay — that is the
system catching gaps, by design. Fix attendance (regularise), Re-generate, publish.
