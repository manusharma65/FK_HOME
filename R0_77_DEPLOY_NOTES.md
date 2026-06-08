# FK Home r0.77 — Audit fixes (approvals hardening + platform hardening)

Branch: **r10-test** (FK Home). Do NOT deploy to main.

**This zip is cumulative.** It contains the r0.77 fixes **plus** the r0.76 two-stage
approvals and the r0.75 owner-identity files, so it's correct whether or not those
were already deployed (identical files are a no-op in git).

---

## A. Approvals hardening (same area as r0.76)

1. **HR can no longer approve their own leave/correction.** If an HR person with no
   line manager applies, the HR-stage task used to be able to land on themselves.
   Now `hrStageOwner()` excludes the applicant — it routes to the *other* HR member,
   and if there isn't one, to the owner (you).

2. **Approvals page now shows the stage and gates the buttons.** Each pending row
   shows a chip:
   - **Awaiting manager: <name>** — and **no** Approve/Reject (HR can't action it yet).
   - **Manager agreed** — with Approve/Reject, because it's now HR's call.
   Leave and corrections both. (The server already refused premature approvals; this
   makes the page match the rule instead of letting HR click into a 400.)

## B. Platform hardening (cross-cutting)

3. **Login brute-force protection.** In-memory throttle, no new dependencies:
   8 failed attempts per IP+email, or 40 per IP (spray), → 15-minute lockout with a
   clear "try again in N minutes" message. Cleared on a successful login.

4. **Soft-deleted groups no longer grant permissions.** `loadUserPermissions` now
   filters `groups.deleted_at` (it already did for group membership; this closes the
   gap where a deleted group's permissions lingered).

5. **Migrations are now atomic.** Each `.sql` file runs inside its own transaction on
   a single connection — a failure mid-file rolls back cleanly instead of half-applying.
   (Verified no migration uses non-transactional statements like `CONCURRENTLY`.)

6. **Cron rewritten.** The seven copy-pasted London-time scheduler blocks are replaced
   by two helpers (`scheduleDaily` / `scheduleWeekly`). **All times are identical** to
   before (5-min, 00:00, 01:00, 02:00, 03:00, 06:00, Sun 23:00, Sun 23:30). server.js
   dropped from 290 to ~203 lines.

7. **Single version source.** `VERSION = 'r0.77'` — `/healthz` and the boot log now
   read from it (they previously disagreed: r0.20.5 vs r0.16.3 vs r0.15).

8. **Dead code removed.** The inert `hr-task-router` leave/regularisation entries and
   the orphaned `/api/tasks/hr-queue` endpoint are gone. The orphaned frontend file
   `public/modules/hr-queue.js` is removed via `git rm` in the deploy below.

## Deliberately NOT in this ship (with reason)
- **Per-request auth query consolidation.** It's the hottest path in the app (every
  request) and currently fine at ~30 users; rewriting it alongside security + behaviour
  changes is the wrong risk trade. Flagged as a standalone follow-up.
- **Automated tests.** A real need, but it's a process/setup change, not a fix — better
  as its own focused piece than bolted onto this batch.

---

## Files in this zip
server.js, server/auth.js, server/approval-flow.js, server/hr-task-router.js,
server/schema/index.js, server/schema/35-two-stage-approvals.sql,
server/modules/{auth,leaves,attendance,tasks,me,daily}.js,
public/index.html, public/modules/{my-work,approvals}.js

## Deploy (branch-guarded; also removes the orphan file)
```bash
cd ~/Downloads && unzip -o fkhome-r0.77-hardening.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -r ~/Downloads/fkhome-r0.77-hardening/server.js ~/Downloads/fkhome-r0.77-hardening/server/ ~/Downloads/fkhome-r0.77-hardening/public/ . && \
  git rm -f --ignore-unmatch public/modules/hr-queue.js && \
  cp ~/Downloads/fkhome-r0.77-hardening/R0_77_DEPLOY_NOTES.md . && \
  git add server.js server/ public/ R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.77: HR self-approval fix, approvals stage gating, login throttle, atomic migrations, cron refactor, dead-code cleanup" && \
  git push origin r10-test; fi
```

## Verify after deploy (hard-refresh)
1. **Login throttle:** enter a wrong password ~8 times → you get locked out with a
   "try again in N minutes" message; a correct login clears it.
2. **Approvals page:** a request still awaiting its manager shows "Awaiting manager:
   <name>" with no Approve button; once the manager agrees it flips to "Manager agreed"
   with Approve/Reject.
3. **HR self-approval:** if an HR person with no manager applies, the approve task lands
   on the *other* HR person (or you), not on themselves.
4. **Boot log / healthz** both report r0.77; all cron lines still appear in logs.
5. **Nothing else regressed:** attendance, leaves, payroll, chat all load normally.

## Still prerequisite (unchanged from r0.76)
Set each person's **manager** (People → Manager) and HR people's **hr_area**
(daily_ops / recruitment_judgement). Empty manager → request goes straight to HR;
unset hr_area → HR-stage owner falls back to first HR by ID.
