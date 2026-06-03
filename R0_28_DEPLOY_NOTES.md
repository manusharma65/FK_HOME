# FK Home r0.28 — the task card (My Work + Team Work)

Fixes root cause 1 from the HR review: tasks were thin rows with tiny icon buttons,
completed hidden, cancelled invisible, no card. Now every task opens a proper card.

## What's new
- **Task card** (opens on row click or "Open" button) — energised, category-coloured header.
  - "What did you do?" free text (flows to the daily report later).
  - **Timer**: Start begins it; the server is the clock. Stops on pause / done / switching
    to another task. Sessions accumulate. Live ticking display.
  - **Amend time**: type the real minutes; if it differs from the timer, a tiny hint shows
    "timer saw 45 · edited by Tanu" — both numbers kept, the human's wins.
  - **Outcome** pills: Done / Partly done / Blocked / Couldn't do.
  - **Files**: upload CV/contract/ID etc. with Upload / Replace / Delete (proper buttons).
  - **Proper full-size buttons**: Mark done (green), Save progress, Cancel task, Close.
    No tiny icon buttons anywhere.
- **Completed section** now loads by default (was hidden behind a tiny link) and **shows
  cancelled tasks struck-through with their reason** — answers "where did the task go?".
- **Team Work**: rows now open a read view card — manager sees what was done, time spent
  (+ edit hint), outcome, and files. Was previously a dead read-only list.

## Data model
No new tables. Card data lives in tasks.meta.work (did/outcome/timer_seconds/logged_minutes/
sessions/time_edited_by). Files reuse the files table via task_id + drawer='task'.

## Migrations (both included, safe to re-run, applied alphabetically)
- 22-candidate-files.sql — files.task_id + nullable user_id + owner check + 'candidate' drawer
  (from r0.27; included so task_id exists even if r0.27 wasn't deployed).
- 23-task-files.sql — adds 'task' to the files drawer CHECK.

## Files
server/modules/tasks.js          (+ /card, /timer, /work, /idle-stop, /:id/file, /file/:id; /done now includes cancelled)
server/schema/22-candidate-files.sql
server/schema/23-task-files.sql
public/modules/my-work.js        (the card + Completed-by-default + cancelled shown)
public/modules/team-work.js      (read view card)

## After deploy — quick checks
1. Open My Work → click a task → card opens. Start timer, type what you did, pick outcome, Save.
2. Reopen → your text/time/outcome are there.
3. Mark done → moves to Completed (visible by default). Cancel one → shows struck-through with reason.
4. Team Work (as a manager) → click a teammate's task → read view shows their work.
5. Confirm an existing employee profile file still opens (migration touches shared files table).

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_28.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_28/server/modules/tasks.js server/modules/tasks.js && cp ~/Downloads/fk-r0_28/server/schema/22-candidate-files.sql server/schema/22-candidate-files.sql && cp ~/Downloads/fk-r0_28/server/schema/23-task-files.sql server/schema/23-task-files.sql && cp ~/Downloads/fk-r0_28/public/modules/my-work.js public/modules/my-work.js && cp ~/Downloads/fk-r0_28/public/modules/team-work.js public/modules/team-work.js && cp ~/Downloads/fk-r0_28/R0_28_DEPLOY_NOTES.md . && git add server/modules/tasks.js server/schema/ public/modules/my-work.js public/modules/team-work.js R0_28_DEPLOY_NOTES.md && git commit -m "r0.28 task card: timer, work fields, outcome, files, completed+cancelled visible, team-work view" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
