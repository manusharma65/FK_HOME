# FK Home r0.25 — HR Shared Queue + event routing (one ship)

## What this does
HR events that already fire (leave request, regularisation, sick, probation-due)
now also become TASKS in a shared HR queue, routed to the right owner by their
hr_area, visible to both Tanu & Deepanshi, with a Cover button for when one is off.
Completing a task records who did it (audit + feeds future scoring).

## Routing (per their SOPs, 1 Jun 2026)
- daily_ops             → leave, regularisation, sick   (Deepanshi)
- recruitment_judgement → probation decision            (Tanu, senior)
Falls back to whole hr-team if hr_area unset → nothing dropped.

## Files (6)
1. server/schema/20-hr-area.sql   NEW — adds users.hr_area (daily_ops / recruitment_judgement)
2. server/hr-task-router.js       NEW — the ONE place HR event→task routing lives
3. server/notify.js               hook: after a notification fires, maybeCreateHrTask() runs
                                   (restructured so the hook always runs; guarded — can't break notifications)
4. server/modules/tasks.js        + GET /hr-queue (shared view), + POST /:id/cover
5. public/modules/hr-queue.js     NEW — the HR Queue view (full-size buttons, helper text, plain labels)
6. public/index.html              HR Queue nav item + reveal (hr-team/owner) + script tag + r0.25 marker

## IMPORTANT after deploy — set HR areas
The routing needs each HR person's area set. Until set, all HR tasks fall to the
whole team (safe, nothing dropped, just not split). Set via SQL or the user record:
  UPDATE users SET hr_area='daily_ops' WHERE <Deepanshi>;
  UPDATE users SET hr_area='recruitment_judgement' WHERE <Tanu>;
(Or leave unset for now — both see everything in the shared queue regardless.)

## Deploy (on r10-test) — unzip included
cd ~/Downloads && unzip -o fk-one-r0_25.zip && cd ~/Documents/GitHub/campaignpulse-setup && git branch --show-current && cp -R ~/Downloads/fk-one-r0_25/server/ server/ && cp -R ~/Downloads/fk-one-r0_25/public/ public/ && cp ~/Downloads/fk-one-r0_25/R0_25_DEPLOY_NOTES.md . && git add server/ public/ R0_25_DEPLOY_NOTES.md && git commit -m "r0.25 HR shared queue: events auto-route to tasks by area, cover mechanism" && git push origin r10-test

## Tanu's test tomorrow — what to check
1. Someone requests leave → an item appears in HR Queue ("Leave request — X").
2. Open it → goes to the Leaves page to approve (with balance shown).
3. Report a test sick → "Sick review — X" appears.
4. A probation-due → "Probation decision — X" appears (Tanu's, links to profile/reviews).
5. Cover button: on a colleague's item, tap Cover → it becomes yours.
6. Buttons are proper size, labels plain. Report anything that feels off.
