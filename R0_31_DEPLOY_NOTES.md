# FK Home r0.31 (Ship 4 — last HR ship) — leave de-dup + recruitment 2 rounds + dashboard drill-ins

## 1. Leave de-duplication (root cause 3) — server/modules/leaves.js
The "leave appears twice" wasn't accidental: a leave makes one leave_request (the data) AND one
HR-queue task (HR's to-do to act on it). The real bug was the task never closed when the leave was
decided, so it lingered as "open". Fixes:
- **Close the routed task on decision**: when a leave is approved/rejected, the matching HR task
  (kind='event', category='leave', meta.event_related_id = leave id) is marked done.
- **Cancel the routed task** when the employee cancels their own pending leave.
- **Block same-day-twice**: POST /request now rejects (409) a new request that overlaps an existing
  pending/approved leave, telling the user which dates clash.

## 2. Recruitment — two interview rounds + carry-forward — server/modules/recruitment.js + public/modules/recruitment.js
- Added an **Interview 2** stage after Interview (now "Interview 1"). Backward compatible: existing
  'interview' candidates stay valid (they're round 1); the board's unknown-stage fallback means
  nothing ever vanishes.
- **Carry-forward**: when you move a candidate to the next round, the move dialog now shows the most
  recent prior round's outcome for context, instead of a blank box.

## 3. Dashboard stat drill-ins — public/index.html
The "Who's in today" KPI tiles (On time / Late / Not yet in / Leave / Sick) are now clickable —
clicking one opens the people list pre-filtered to that status, so you see WHO. (Reuses the existing
people modal + filter; rows are already clickable through to profiles.)

## IMPORTANT — index.html is a cumulative superset
public/index.html here includes r0.29 (notifications) + r0.30 (nav/mobile/idle/Leaves&time) + r0.31
(KPI drill-ins). If you've deployed r0.29 and r0.30 in order, this is the natural next state. The only
NEW non-index files in THIS ship are leaves.js + recruitment.js (server) + recruitment.js (public).

## Files
server/modules/leaves.js          (de-dup: block overlap, close/cancel routed task)
server/modules/recruitment.js     (interview_2 stage)
public/modules/recruitment.js     (interview_2 board + carry-forward)
public/index.html                 (KPI drill-ins; cumulative superset)

## After deploy — quick checks
1. Request leave for dates that overlap an existing pending/approved one -> blocked with a clear message.
2. Approve a leave in HR > Leaves -> the matching HR-queue task disappears (no longer lingers as open).
3. Recruitment board -> there's an "Interview 2" column; moving a candidate shows last round's note.
4. Dashboard "Who's in today" -> click the "Late" number -> people list opens filtered to late.

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_31.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_31/server/modules/leaves.js server/modules/leaves.js && cp ~/Downloads/fk-r0_31/server/modules/recruitment.js server/modules/recruitment.js && cp ~/Downloads/fk-r0_31/public/modules/recruitment.js public/modules/recruitment.js && cp ~/Downloads/fk-r0_31/public/index.html public/index.html && cp ~/Downloads/fk-r0_31/R0_31_DEPLOY_NOTES.md . && git add server/modules/leaves.js server/modules/recruitment.js public/modules/recruitment.js public/index.html R0_31_DEPLOY_NOTES.md && git commit -m "r0.31 leave de-dup + recruitment 2 rounds + carry-forward + dashboard KPI drill-ins" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
