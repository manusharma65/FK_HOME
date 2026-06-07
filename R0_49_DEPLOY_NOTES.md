# R0.49 — People page redesigned (the hub) + employment/manager/leave merged in

## What ships
- **public/modules/users.js** — People fully redesigned to the approved mock:
  - Warm gradient hero with live counts; the floating **Add user** pill (no more black bar).
  - Person cards (avatar, primary dept+role chip, status), search + filter pills, hover motion.
  - **4-step Add-user wizard** (Who -> Access -> Employment -> Pay): captures name/email,
    department + role + **manager**, **joining date** + type + work pattern, and **salary** —
    so a new joiner is complete on day one (no more half-created users). Orchestrates the
    existing endpoints: create -> departments(role) -> manager -> bulk-employment -> salary
    -> leave recompute, then shows the temp password.
  - **Merged person record** (Edit): Access (depts/roles + groups), Employment record
    (reports-to/manager, joining date, type, work pattern, probation, notice), **Leave**
    (animated balance ring + Recompute + Adjust), and **Status** (Active / On leave /
    Leaver -> last working day). Saves via PATCH + departments + groups + manager +
    bulk-employment. Reuses every existing endpoint — nothing new server-side.
- **server/modules/admin.js** — `bulk-employment` now also accepts `last_working_day`
  (for the leaver flow). Additive, COALESCE-guarded.

## Deliberately NOT in this ship (safety)
- The old **Employment nav page stays** as a fallback until you confirm the new People
  works in production. Removing it now, with no fallback if a wiring bug slips through,
  is the "break what works" risk — so it waits for your thumbs-up.
- Then r0.50 (small): remove the Employment nav, show these fields read-only in the
  employee's profile snapshot, and prorate a leaver's final payslip to last working day.

## Validation
- node --check clean: users.js, admin.js. All referenced endpoints exist.
- PATCH verified to only update fields sent (status-only save won't blank names).

## After deploy — test before we remove anything
1. People loads with the new look; hero counts right; search/filter work.
2. Add user: walk the 4 steps, create someone, confirm temp password shows and they
   appear in the list with the right dept/manager/joining date.
3. Edit someone: change manager, joining date, recompute leave, mark a test user "leaver"
   with a last working day. Confirm it saves and the old Employment page shows the same.
4. Tell me it's good -> I ship r0.50 (remove Employment nav + profile snapshot + leaver pay).
