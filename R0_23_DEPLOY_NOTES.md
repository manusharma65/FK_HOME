# FK Home r0.23 — task lifecycle: explicit assign/request, edit/cancel/done, Team Work

## Fixes the two bugs from r0.22 + completes the task lifecycle

### Bug fixes
- **Start button crash** — `tasks_status_check` didn't allow 'in_progress'. Migration 19
  now widens the status CHECK. (This was: "violates check constraint tasks_status_check".)
- **"Everything becomes a request"** — create now uses an EXPLICIT mode the user picks
  (Assign vs Request), server validates the permission. No more silent auto-detect.

### New in this ship
- **Explicit Assign/Request** — pick a person, then choose Assign (direct) or Request
  (accept/decline). "Assign" is disabled unless you manage them (managers-and-up). Owner
  can assign anyone.
- **Edit** a task (pencil icon) — title / category.
- **Cancel** a task (x icon) — status='cancelled', kept for history, not hard-deleted.
- **Done section** — collapsed "show recent" at the bottom of My Work; last 14 days; Reopen.
- **Decline a direct assignment** (back-arrow icon, only on tasks someone assigned to you) —
  bounces it back to the assigner with a reason + notifies them.
- **Team Work view** (new nav item, managers/leads/owner only) — see your team's active
  tasks grouped by person, with status pills (overdue/due/in progress/open).

## IMPORTANT — migration 19 re-runs
The migration runner re-applies a file when its checksum changes. Migration 19 changed
(status fix + safety hardening), so it WILL re-run on this deploy. It is now safe to re-run:
- constraint drops use unique tokens (overdue/kind/reviewer), looped, guarded re-adds
- the dummy-wipe is one-time, guarded by a `tasks_dummy_wiped` marker in settings
NOTE: since the marker didn't exist before, this deploy does ONE more wipe of test tasks,
then never again. On staging that's fine (test data only).

## Files (7)
1. server/schema/19-task-model.sql  (UPDATED — status fix + re-run-safe)
2. server/notify.js                 (added task.assignment_declined template)
3. server/modules/tasks.js          (explicit-mode create; +PATCH edit, /cancel,
                                      /decline-assignment, /done, /team endpoints)
4. server/modules/lifecycle.js      (unchanged from r0.22 — source='cron' tag)
5. public/modules/my-work.js        (explicit mode UI, edit/cancel, Done section, decline)
6. public/modules/team-work.js      (NEW — manager team view)
7. public/index.html                (Team work nav item + reveal; team-work.js script; r0.23 marker)

## Deploy (on r10-test) — unzip included
cd ~/Downloads && unzip -o fk-one-r0_23.zip && cd ~/Documents/GitHub/campaignpulse-setup && git branch --show-current && cp -R ~/Downloads/fk-one-r0_23/server/ server/ && cp -R ~/Downloads/fk-one-r0_23/public/ public/ && cp ~/Downloads/fk-one-r0_23/R0_23_DEPLOY_NOTES.md . && git add server/ public/ R0_23_DEPLOY_NOTES.md && git commit -m "r0.23 task lifecycle: explicit assign/request, edit/cancel/done, Team Work, status fix" && git push origin r10-test

## After deploy — verify (walk it)
1. Boot log: "19-task-model.sql — re-applied (checksum changed)", no errors.
2. My work → Add task → Myself → appears → **Start** (no crash now) → In progress → Done.
3. Done section: "show recent" → completed task appears → Reopen works.
4. Edit (pencil) a task → change text → Save → updates.
5. Cancel (x) a task → confirm → leaves the list.
6. As owner: Add task → pick someone → **Assign** enabled → assign → lands in their work "Assigned by you".
7. Pick someone you do NOT manage (as a non-owner) → Assign greyed, Request only → send → their Requests for you.
8. Team work nav (managers/owner) → see team tasks grouped by person + status.
