# FK Home r0.26.1 — permission fix (HR Queue + Recruitment access)

## What was wrong
The HR Queue and Recruitment pages rejected everyone — including the owner — with
"This queue is for the HR team" / "Recruitment is for the HR team".

Cause: the access check used `req.user.can('*')` as an "is owner" test. But in this
app `can(slug)` is an EXACT permission-name match (auth.js line 47) — `*` is not a
real wildcard permission, so `can('*')` is always false. The working Profile/People
pages gate HR access on `can('profile.view.any')` instead.

## Fix
Replaced `can('*')` with `can('profile.view.any')` everywhere it was used as the
owner/HR check, matching the working pages:
- server/modules/recruitment.js — isHr()
- server/modules/tasks.js — hr-queue route, cover route, and all owner action checks (10 spots)

Both you (owner) and Tanu/Deepanshi have `profile.view.any`, so all three get in.
hr-team group membership still works as a fallback.

## Files
server/modules/tasks.js
server/modules/recruitment.js

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_26_1.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_26_1/server/modules/tasks.js server/modules/tasks.js && cp ~/Downloads/fk-r0_26_1/server/modules/recruitment.js server/modules/recruitment.js && cp ~/Downloads/fk-r0_26_1/R0_26_1_DEPLOY_NOTES.md . && git add server/modules/tasks.js server/modules/recruitment.js R0_26_1_DEPLOY_NOTES.md && git commit -m "r0.26.1 fix HR queue + recruitment access (can wildcard bug)" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
