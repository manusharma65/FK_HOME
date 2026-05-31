# FK Home r0.22 — Ship 2a: universal task model + My Work

## What this is
The foundation of the HR task system: one task table holding all work-shapes,
plus the My Work view and home card. Auto-events (2b) and recruitment (2c) build
on this. Designed once to hold HR now and Amazon/Accounts later (verified against
CampaignPulse's campaign_tasks — it fits).

## Files (5)
1. server/schema/19-task-model.sql  (NEW migration — auto-applies)
   - Extends existing `tasks` table ADDITIVELY: + source, parent_task_id,
     department_id, category, moved_at, movement_note, meta (JSONB).
   - Widens kind CHECK ('review' only) → review/onboarding/probation/event/
     recurring/ad_hoc/recruitment.
   - Relaxes review-specific NOT NULLs (related_user_id, reason, opens_at, due_at)
     so ad-hoc/event/recruitment tasks are valid.
   - Wipes dummy task rows (staging — confirmed no real tasks). Review RECORDS in
     profile_notes are NOT touched.
   - Review/onboarding/probation lifecycle code is UNCHANGED (only tagged source='cron').
2. server/modules/tasks.js  (extended)
   - /api/tasks/mine now returns {groups:{needs_action,recurring,in_progress},total}
   - NEW /api/tasks/summary (home card), POST /api/tasks (ad-hoc create),
     POST /api/tasks/:id/action (start/complete/move/reopen).
   - Recruitment openings excluded from My Work (live in Recruitment view, 2c).
3. server/modules/lifecycle.js  (2-word change: tag review tasks source='cron')
4. public/modules/my-work.js  (NEW module — the My Work view)
5. public/index.html
   - My work nav item + mobile item now route to #my-work (was "soon" toast).
   - Home "My work" card now live (reads /api/tasks/summary), taps into My Work.
   - loadMyTasks() repointed to drive the new card (old tasksCard retired, hidden).
   - my-work.js script tag registered. r0.22 marker.

## Deploy (on r10-test) — unzip included
cd ~/Downloads && unzip -o fk-one-r0_22.zip && cd ~/Documents/GitHub/campaignpulse-setup && git branch --show-current && cp -R ~/Downloads/fk-one-r0_22/server/ server/ && cp -R ~/Downloads/fk-one-r0_22/public/ public/ && cp ~/Downloads/fk-one-r0_22/R0_22_DEPLOY_NOTES.md . && git add server/ public/ R0_22_DEPLOY_NOTES.md && git commit -m "r0.22 Ship 2a: universal task model + My Work view + home card" && git push origin r10-test

## After deploy — verify
- Boot log clean (migration 19 applied, no constraint errors).
- Click "My work" in nav → My Work view loads (empty: "Nothing on your plate").
- Click "Add task" → type "Test task" → Add → it appears under Needs action.
- Click "Start" → moves to In progress; "Done" → disappears.
- Home "My work" card shows the count and taps through to My Work.
- Reviews still work: existing review tasks (if any get generated) still show.
