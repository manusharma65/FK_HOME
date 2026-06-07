# R0.50 — Editable salary + 4-tier role titles

## 1. Salary is now editable (the gap from before)
The profile Pay tab salary block was read-only. It now has an **Add / Update salary**
form (gated to salary permission, same as before): monthly CTC, effective-from date,
and up to three recurring deduction lines. Saves via the existing
`PUT /api/profile/:id/salary` to the record payroll reads — so seeded figures can finally
be corrected, and anyone created before the wizard existed can be given a salary.
Where to find it: open a person -> **Pay** tab -> Add/Update salary. (New joiners still
get salary set in the Add-user wizard, step 4.)

## 2. Role titles — four tiers (was: Specialist / Executive / Manager)
New ladder, matching how FK Sports actually titles people:
  **Executive -> Senior Executive -> Team Lead -> Manager**
Mapped onto the access roles `agent -> senior -> lead -> manager`. Permissions come
from GROUPS, not this title — and the new `senior` tier deliberately carries the SAME
base access as Executive (it is excluded from the manager/lead approver + reviewer
routing). So this is titles only; no permission change. Updated in: the Add-user wizard,
the People edit dropdown, the person-card chip, and org/team titles (team.js).
- **Migration 32** widens the role check to allow `senior`.

## Cumulative note
Built on the r0.49 working copy. If r0.49 is not yet deployed, this ship includes it
(users.js carries the People redesign + the new titles). The old **Employment nav still
stays** as a fallback until you confirm the new People works in production.

## Validation
- node --check clean: users.js, profile.js, admin.js, team.js.
- Confirmed `senior` is absent from all approver/reviewer filters (base access only).
- Salary form posts the exact fields the endpoint expects (monthly_ctc, effective_from,
  currency, 3 deduction pairs).

## After deploy
- Open a person -> Pay -> set/correct their salary; re-run payroll to see it flow through.
- Add user / edit someone: role picker now shows the four titles.
