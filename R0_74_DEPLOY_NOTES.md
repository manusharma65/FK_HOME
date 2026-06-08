# FK Home r0.74 — coverage foundation (half 1 of 2)

Branch: r10-test. Cumulative on top of r0.73a (deployed). Five contained fixes,
each independently testable. The bigger coverage/hand-over/queue work is half 2,
coming separately so this stays small and verifiable.

## What's in it
1. **HR-area routing wired** (server/modules/lifecycle.js) — review tasks now route
   to the real area owner (judgement → Tanu) instead of "first HR member," with a
   safe fallback to any HR member so nothing is dropped. Fixes the coverage asymmetry
   at its root.
2. **Scoring deadline-pause** (server/modules/daily.js) — a deadline falling during the
   owner's approved leave/sick shifts to the end of their first working day back
   (on time if done by then). Unauthorised absence (no_show) does NOT pause. An item
   already overdue before they went off is not retroactively excused.
3. **HR today → owner-only** (public/index.html nav + server/modules/daily.js /team
   endpoint now require '*'). Tanu/Deepanshi no longer see it.
4. **Payslip preview triple-tab fixed** (public/modules/hr-payroll.js) — document
   listeners are now tracked and removed on unmount (and stale ones cleared on mount),
   so they can't stack across visits.
5. **Leave fail-safe + reason** (server/modules/leaves.js) — a day-classification error
   no longer silently blocks all leave (falls back to weekday); the error now says why
   ("you already have approved leave that day", "that's a public holiday", etc.).

## Nothing existing rebuilt
Only additive edits on the deployed r0.73a files. No schema change in this half.

## Verify after deploy (hard-refresh first)
1. **HR today** shows for you, and is GONE for Tanu/Deepanshi.
2. **Payslip → Preview** opens exactly one tab, even after opening the payroll page a few times.
3. **Leave**: try a half-day on a normal weekday for a normally-configured person — it books.
   On a genuine off day it now tells you the reason.
4. New probation/review tasks route to Tanu (judgement owner). (Takes a new review to observe.)
5. Scoring pause is internal — visible at week scoring; nothing to click.
