# FK Home r0.22 — Ship 2a: universal task model + My Work + assign/request engine

## What this is
The foundation of the task system, built to last: one task table for every
department, the My Work view, and the full assignment/request engine.

## The model (locked decisions)
- Tasks are personal by default. A task reaches someone else 3 ways, AUTO-DETECTED
  from the relationship between creator and target (creator never picks a mode):
    * assignment — manager/owner → someone in a dept they run → lands DIRECT
    * handoff    — my own task → a teammate (same dept)        → lands DIRECT
    * request    — anyone → someone in ANOTHER department      → ACCEPT/DECLINE
- Permission to originate a NEW task onto others = managers-and-up only.
  Regular agents: self only. ANYONE may send a cross-dept request.
- Scoring: the DOER scores (whoever completes it). assignee_user_id = current doer;
  assigned_by_user_id = who put it there; reassign_history logs handoffs.
- Cross-dept request loop: sits in requester's My Work as "awaiting"; receiver gets
  a notification + Accept/Decline; on accept it's theirs (they score), requester
  notified; on decline (optional reason) it bounces back to requester, notified.
  Uses existing notifyEvent rails (templates added to notify.js).

## Files (6)
1. server/schema/19-task-model.sql  (NEW migration — auto-applies)
   - Extends `tasks` ADDITIVELY: + source, parent_task_id, department_id, category,
     moved_at, movement_note, meta, AND assigned_by_user_id, request_status,
     requester_user_id, decline_reason, reassign_history.
   - Widens kind CHECK → review/onboarding/probation/event/recurring/ad_hoc/recruitment.
   - Relaxes review-only NOT NULLs (related_user_id, reason, opens_at, due_at).
   - Wipes dummy task rows (staging — confirmed). profile_notes NOT touched.
   - Review/onboarding/probation lifecycle UNCHANGED (only tagged source='cron').
2. server/notify.js  (added 4 templates: task.assigned, request.received,
   request.accepted, request.declined). Existing templates untouched.
3. server/modules/tasks.js  (rebuilt — the assign/request engine)
   - /mine returns {groups, incoming_requests, my_requests, total}
   - /summary (home card), /assignable (permission-scoped people list),
     POST / (auto-detect self/assign/request), /:id/action, /:id/accept, /:id/decline
4. server/modules/lifecycle.js  (2-word change: review tasks tagged source='cron')
5. public/modules/my-work.js  (NEW — My Work view + adaptive 3-state creator +
   incoming requests Accept/Decline + your sent requests awaiting/declined)
6. public/index.html  (My work nav + mobile route to #my-work; home card live via
   /api/tasks/summary; loadMyTasks repointed; my-work.js registered; r0.22 marker)

## Deploy (on r10-test) — unzip included
cd ~/Downloads && unzip -o fk-one-r0_22.zip && cd ~/Documents/GitHub/campaignpulse-setup && git branch --show-current && cp -R ~/Downloads/fk-one-r0_22/server/ server/ && cp -R ~/Downloads/fk-one-r0_22/public/ public/ && cp ~/Downloads/fk-one-r0_22/R0_22_DEPLOY_NOTES.md . && git add server/ public/ R0_22_DEPLOY_NOTES.md && git commit -m "r0.22 Ship 2a: universal task model + My Work + assign/request engine" && git push origin r10-test

## After deploy — verify (walk the journey)
1. Boot log clean (migration 19 applied, no constraint errors).
2. "My work" in nav → view loads (empty: "Nothing on your plate").
3. Add task → "Myself" → "Add task" → appears under Needs action. Start → In progress. Done → clears.
4. As a manager (Tanu/owner): Add task → pick someone in your dept → blue line
   "Goes straight to X's work", button "Assign task" → lands in their My Work tagged "Assigned by you".
5. Pick someone in ANOTHER dept → amber line "Sent as a request", button "Send request"
   → appears in their "Requests for you" with Accept/Decline; in your "Your requests" as awaiting.
6. They Accept → moves to their tasks, you get a notification. They Decline (reason) → bounces back to you, you're notified.
7. Home "My work" card shows counts + taps through.

## Notes
- Handing off an EXISTING task (agent → teammate) is a future action on a task row,
  not in this creator (creator = new tasks; agents self-only for new, by design).
- Recruitment openings excluded from My Work (live in Recruitment view, Ship 2c).
