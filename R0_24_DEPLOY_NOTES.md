# FK Home r0.24 — SIMPLE task creator (Request is just a category option)

## What changed (and why)
The r0.22/r0.23 creator over-complicated assignment with permission tiers, an
auto-detect engine, and greyed-out controls — which broke normal assigning and
made everything fall through to "request". Reverted to the simple model Bobby
asked for:

- The category dropdown (Meeting / Admin / Helping / Project / Other) gains ONE
  more option: **Request**.
- The right dropdown picks the person (everyone listed, no greying, no rules).
- On Add:
    * No person picked         → your own task
    * Person + normal category → assigned straight to them (task.assigned)
    * Person + "Request"        → goes as a request; they Accept/Reject; you see
                                  it as "awaiting" and get notified of the outcome
- Removed entirely: the /assignable direct-vs-request split, the greyed-out
  Assign control, the can('*')/department permission gymnastics, the dead helper
  functions (shareDept, actorManagesTarget, deptIdsFor).

Everything else from r0.23 is unchanged and intact:
  Start/Done, Edit (pencil), Cancel a task (x), Done section, decline an
  assignment (back-arrow), Team Work view, the in_progress status fix.

## Files (7)
1. server/schema/19-task-model.sql  (unchanged from r0.23 — status fix + re-run-safe)
2. server/notify.js                 (unchanged from r0.23)
3. server/modules/tasks.js          (SIMPLIFIED create + assignable; dead helpers removed)
4. server/modules/lifecycle.js      (unchanged)
5. public/modules/my-work.js        (SIMPLE creator: Request in category dropdown)
6. public/modules/team-work.js      (unchanged from r0.23)
7. public/index.html                (r0.24 marker)

## NOTE — migration 19 still re-runs once
If r0.23 was NOT deployed, migration 19 re-runs on this deploy (checksum changed
since r0.21.1). It is re-run-safe and does ONE final dummy-task wipe (guarded by
the tasks_dummy_wiped marker), then never again. Staging test data only.

## Deploy (on r10-test) — unzip included
cd ~/Downloads && unzip -o fk-one-r0_24.zip && cd ~/Documents/GitHub/campaignpulse-setup && git branch --show-current && cp -R ~/Downloads/fk-one-r0_24/server/ server/ && cp -R ~/Downloads/fk-one-r0_24/public/ public/ && cp ~/Downloads/fk-one-r0_24/R0_24_DEPLOY_NOTES.md . && git add server/ public/ R0_24_DEPLOY_NOTES.md && git commit -m "r0.24 simple task creator: Request as a category option, removed permission machinery" && git push origin r10-test

## After deploy — verify
1. My work → Add task → Myself → Add task → appears → Start (no crash) → Done.
2. Add task → pick a normal category (Meeting) + pick Satyam → button says "Assign task"
   → it lands directly in Satyam's My Work. (NOT a request.)
3. Add task → category "Request" + pick Satyam → button says "Send request"
   → lands in Satyam's "Requests for you" (Accept/Reject); shows on yours as awaiting.
4. Edit, Cancel, Done section, Team work — all still work.
