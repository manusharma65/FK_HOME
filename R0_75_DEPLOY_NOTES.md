# FK Home r0.75 — automatic coverage, hand-over, HR queue retired (half 2 of 2)

Branch: r10-test. Cumulative on top of r0.74 (deployed). Completes the coverage work.

## What's in it
1. **Automatic coverage** (server/modules/tasks.js → /api/tasks/mine).
   When a teammate is OFF today — approved leave, sick (live, the moment it's
   reported, even mid-shift), or an unauthorised no-show — their open tasks
   surface in your My Work under "Covering while they're off", tagged with whose
   they are and why. We do NOT move the task; it stays theirs until you take it,
   so anything you don't touch simply remains theirs and reverts for free when
   they're back. Scoped to teammates (shared department).
2. **Take a covered task** — the "I'll do it" button calls the existing /cover,
   which flips it to you and records the cover in history, so the doer is scored
   and the absent owner isn't (their deadline is already paused by r0.74).
3. **Hand over an existing task** (server/modules/tasks.js → /api/tasks/:id/handover,
   + My Work "Hand over" button + teammate picker). Your own task → a teammate;
   owner/manager → within a dept they run. No accept step; doer scores; logged.
4. **HR queue page retired** (public/index.html) — nav item, reveal, and script
   include removed. HR work now runs through My Work (auto-routed by area from
   r0.74, plus coverage) and the Approvals page. The /api/tasks/hr-queue endpoint
   and the orphaned public/modules/hr-queue.js are left in place as dead code —
   say the word and I'll hard-delete them in a follow-up.

## Nothing existing rebuilt
Additive: a new query in /mine, a new endpoint, new My Work UI, three removals in
the shell. The /cover endpoint was already there and is reused.

## Verify after deploy (hard-refresh first)
1. **HR Queue** is gone from the left nav.
2. **Hand over**: open My Work, a task row now has "Hand over" → pick a teammate →
   it moves to their My Work (and you get it back if they decline an assigned one).
3. **Coverage**: mark someone off (approved leave or a sick report) for today, then
   open their teammate's My Work — the off person's open tasks appear under
   "Covering while they're off", with "I'll do it". Taking one moves it to the doer.
   (Leave/sick reflect immediately; a no-show appears once the morning cutoff marks it.)
