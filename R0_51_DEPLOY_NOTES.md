# R0.51 — Salary edit (right place this time) + attendance redesigned to People theme

## 1. Salary edit form — fixed placement
r0.50 put the salary form on a code path the Pay tab never renders (my mistake), so you
could not see it. The Pay tab is rendered by `renderPaySection`; the editable
**Add / Update salary** form now lives there, right under "Current salary", gated to
salary-edit permission. Monthly CTC + effective-from + up to 3 deduction lines, saving to
the record payroll reads. Where to find it: open a person -> **Pay** tab.

## 2. Attendance (Time tab) redesigned to match People
- The four stats (**Days worked / Late / Annual leave / Sick**) moved to the **TOP** as
  big energised tiles (were small, at the bottom).
- Bigger month label (display font) and **larger month nav buttons**.
- Day click still opens the detail modal (login/logout) from before.

## Cumulative
Includes everything since r0.48: People redesign + add-user wizard + merged record
(users.js), editable salary + attendance redesign (profile.js), 4-tier role titles
(users.js/admin.js/team.js + migration 32 — Executive/Senior Executive/Team Lead/Manager),
and `last_working_day` on bulk-employment. One push lands it all. The old **Employment nav
still stays** as a fallback until you confirm the new People in production.

## Validation
- node --check clean: profile.js, users.js, admin.js, team.js.

## After deploy
- Open a person -> Pay -> set/correct salary; re-run payroll to see it flow.
- Open a person -> Time -> stats now sit on top, bigger; nav buttons larger.
