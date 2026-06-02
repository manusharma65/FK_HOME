# FK Home r0.26.2 — fix "Could not create" on recruitment

## What was wrong
Creating an opening failed: null value in column "assignee_user_id" violates not-null.
The tasks table requires every row to have an assignee. A recruitment opening/candidate
had none set, so the insert was rejected.

## Fix
1. Both recruitment INSERTs (opening + candidate) now set assignee_user_id = the creator
   (HR person). Satisfies the constraint honestly — the creator owns the opening.
2. My Work now excludes ALL recruitment tasks (was: only openings). Since candidates now
   have an assignee, this stops them cluttering the creator's personal task list — they
   belong on the recruitment board, not My Work.

## Files
server/modules/recruitment.js
server/modules/tasks.js

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_26_2.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_26_2/server/modules/recruitment.js server/modules/recruitment.js && cp ~/Downloads/fk-r0_26_2/server/modules/tasks.js server/modules/tasks.js && cp ~/Downloads/fk-r0_26_2/R0_26_2_DEPLOY_NOTES.md . && git add server/modules/recruitment.js server/modules/tasks.js R0_26_2_DEPLOY_NOTES.md && git commit -m "r0.26.2 fix recruitment create (assignee not-null) + exclude all recruitment from My Work" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
