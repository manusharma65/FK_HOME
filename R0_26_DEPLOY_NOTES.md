# FK Home r0.25 + r0.26 — HR Shared Queue + Recruitment (combined ship)

Two ships bundled so you deploy once. HR is now a complete system to test.

## r0.25 — HR Shared Queue + event routing
HR events (leave request, regularisation, sick, probation-due) auto-become TASKS
in a shared HR queue, routed by hr_area, visible to both Tanu & Deepanshi, with a
Cover button when one is off. Completing records who did it.
- daily_ops → leave/regularisation/sick (Deepanshi)
- recruitment_judgement → probation decision (Tanu, senior)
- Falls back to whole hr-team if hr_area unset (nothing dropped).

## r0.26 — Recruitment pipeline (Kanban, tracking only)
- Recruitment nav → openings list → open one → Kanban board.
- Stages: Sourced → Screening → Interview → Offer → Hired, + Standby (visible
  holding column for limbo/backup candidates), + Rejected (tucked-away list, with reason).
- Drag candidates between columns (desktop). Click a candidate → notes, details, reject.
- Mark Hired → flags "ready to onboard" (does NOT auto-create the user — you create
  their employee record in Admin → People, which triggers the existing onboarding).
- My Work now shows HR a pointer: "Recruitment — N candidates need action →" so HR
  has ONE home base, not three tabs.
- Scope: tracking only. No CV upload, no offer-letter generation, no job-board APIs (deferred).

## Files
server.js                         (mounts /api/recruitment)
server/schema/20-hr-area.sql      NEW (users.hr_area)
server/schema/21-recruitment.sql  NEW (recruitment indexes; reuses tasks table)
server/hr-task-router.js          NEW (HR event→task routing, one place)
server/notify.js                  (hook: events also create HR tasks)
server/modules/tasks.js           (+ GET /hr-queue, + POST /:id/cover)
server/modules/recruitment.js     NEW (openings/candidates/stages/notes/hire)
public/modules/hr-queue.js        NEW (HR shared queue view)
public/modules/recruitment.js     NEW (Kanban board)
public/modules/my-work.js         (+ recruitment pointer)
public/index.html                 (HR Queue + Recruitment nav, script tags, r0.26 marker)

## Routing verified
loader.js auto-resolves #hr-queue → fkModules['hr-queue'] and #recruitment →
fkModules['recruitment']. No loader change needed.

## Migrations
20 + 21 run automatically on boot (glob + checksum). Both additive, safe to re-run.
Schema reuses the existing tasks table for recruitment (no new tables).

## After deploy — optional
Set HR areas so routing splits (else both see all, which is fine):
  UPDATE users SET hr_area='daily_ops' WHERE <Deepanshi>;
  UPDATE users SET hr_area='recruitment_judgement' WHERE <Tanu>;

## Deploy (on r10-test) — unzip included
cd ~/Downloads && unzip -o fk-one-r0_26.zip && cd ~/Documents/GitHub/campaignpulse-setup && git branch --show-current && cp ~/Downloads/fk-one-r0_26/server.js server.js && cp -R ~/Downloads/fk-one-r0_26/server/ server/ && cp -R ~/Downloads/fk-one-r0_26/public/ public/ && cp ~/Downloads/fk-one-r0_26/R0_26_DEPLOY_NOTES.md . && git add server.js server/ public/ R0_26_DEPLOY_NOTES.md && git commit -m "r0.25+r0.26 HR shared queue + recruitment pipeline" && git push origin r10-test
