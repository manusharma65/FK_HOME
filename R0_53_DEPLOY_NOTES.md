# R0.53 — Salary (self-view, no deductions) + attendance calendar properly redesigned

Combined ship — deploy once.

## Salary
- Form is **Monthly CTC + Effective from** only (recurring deductions removed; one-off
  amounts live on the monthly payslip editor).
- **Employees can view their OWN salary** (read-only) on their Pay tab; editing stays
  Owner/HR-only; nobody sees anyone else's.

## Attendance calendar — full redesign (not just the header this time)
- **Date numbers** now large (Fraunces display, 18px) — were 11px in the corner.
- **Cells** properly sized and rounded; blank leading cells no longer drawn as boxes.
- **Today** is a clear orange gradient cell with a white number and white "Today" label
  (was tiny dark text on flat amber).
- Bigger day-of-week header; bigger status flags; stats already on top from before.
- Matches the People page warmth/energy throughout the grid, not just the frame.

## Cumulative
One push lands everything current: People redesign + add-user wizard + merged record,
4-tier role titles (+ migration 32), editable salary on the Pay tab, and the attendance
redesign. Old Employment nav still kept as fallback.

## Validation
- node --check clean: public/profile.js, server/profile.js, users.js, admin.js, team.js.
