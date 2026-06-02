# FK Home r0.27 — candidate cards + files + offer→join flow + reversible end

Supersedes r0.26.1 and r0.26.2 (both fixes included).

## Pipeline (new stages)
Sourced → Screening → Interview → Offer → Accepted (awaiting join) → Joined, plus Standby.
- Dragging to most stages asks "how did this round go?" (kept on the card, per round).
- Dragging to **Accepted** asks for the agreed **joining date**. NO employee record is created yet —
  if they ghost/back out, just End the candidate. This is the safe holding pen.
- Dragging to **Joined** (they actually started) shows a copyable panel of their details
  (name/email/phone/salary/joining date/notice) and a "Mark joined & open People →" button that
  takes Tanu to the People page (#hr/users) to create the employee record — which triggers onboarding.
  No fake prefill: the create-user form only takes name/email/dept; the rest is filled on the
  Employment tab, so Tanu copies from the panel (everything stays editable, by her hand).

## Candidate card
Light add (name/source/why-shortlist). Full card fills in over time: current company, experience,
current+expected salary, notice, phone, email, joining date, why-shortlist line, "days in stage" badge,
per-round outcomes, stage history, notes, CV/photo upload.

## Files
CV/photo reuse the existing files system. Migration 22 adds files.task_id (nullable user_id, a
'candidate' drawer, owner check user_id-or-task_id). Ended candidates' files soft-delete and the
existing 03:00 cron purges after 90 days; bringing them back within 90 days restores files.

## Other
- Edit / Close / Reopen an opening.
- End candidate: we-passed / they-withdrew + reason, archived, reversible ("Bring back").
  A declined offer = End with reason "declined" (no separate lane).
- Everything timestamped + attributed for a future scorecard. No scoring logic built.

## Files
server/schema/22-candidate-files.sql   NEW
server/modules/recruitment.js          rewritten (cards, offer→join, files, end)
server/modules/tasks.js                (includes r0.26.1 perm fix + r0.26.2 exclusion)
public/modules/recruitment.js          rewritten (rich card UI + offer→join modals)

## After deploy — quick check
Open any employee profile that has a document and confirm it still opens (migration 22 touches the
shared files table; this confirms the change is clean).

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_27.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_27/server/modules/recruitment.js server/modules/recruitment.js && cp ~/Downloads/fk-r0_27/server/modules/tasks.js server/modules/tasks.js && cp ~/Downloads/fk-r0_27/server/schema/22-candidate-files.sql server/schema/22-candidate-files.sql && cp ~/Downloads/fk-r0_27/public/modules/recruitment.js public/modules/recruitment.js && cp ~/Downloads/fk-r0_27/R0_27_DEPLOY_NOTES.md . && git add server/modules/recruitment.js server/modules/tasks.js server/schema/22-candidate-files.sql public/modules/recruitment.js R0_27_DEPLOY_NOTES.md && git commit -m "r0.27 candidate cards + files + offer-to-join flow + reversible end" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
