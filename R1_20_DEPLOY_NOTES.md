# FK Home r1.20 — Owner home cockpit + deputy powers + task due dates

Branch: **r10-test** only. One tested ship.

## What's in it
1. **Task due dates** (`public/modules/my-work.js`) — due field on the create card, sent on
   create and edit, prefilled when reopening a task, shown as a "Due 18 Jun" chip on each row
   (timezone-safe formatting). Reassign ("Hand over") was already present.
2. **Owner/manager home cockpit** (`server/modules/me.js` `GET /api/me/attention`; `public/index.html`)
   — four panels: Waiting on you (with 3-working-day escalation flag), Out today (Whole company /
   My team toggle), Watch (probation / leavers / overdue reviews), Yesterday in brief. Renders for
   owner + managers only; everyone else keeps the existing home untouched. Message + Open verbs wired.
   Single replaceable click handler (cannot stack listeners on reload).
3. **Deputy power #2 — late-notify** (`server/modules/me.js`) — the Operations Deputy is notified of
   every reported lateness (notify-only; HR still owns the action).
4. **Deputy power #3 — away-cover** (`server/schema/41-approval-cover.sql`, `server/modules/leaves.js`,
   `server/modules/me.js`, cockpit toggle) — hand your leave-approval queue to a deputy while away.
   Captures your own approval scope so the deputy inherits exactly that. Decisions are stamped + audited
   under the deputy's own id, so oversight is preserved. One-tap (auto-resolves the single Operations
   Deputy) and reversible.
5. **Rides along:** the stranded nav-collapse fix and selfie-skip fix (held since r1.13).

## Verified
- 25/25 automated suite green (approval path unchanged in behaviour for normal approvers).
- Task due date: create persists `due_at` and returns on the list.
- `/api/me/attention`: all four panels' SQL runs clean.
- Away-cover lifecycle: deputy 403 before → sees queue when on → can decide (decision stamped under
  deputy) → cockpit shows "covered" → 403 again after take-back.

## Still to come (r1.21, minor)
Reports date filter; Insights "overdue" → team-scoped; attendance hover in team/company view;
leave-balance ring "—" cosmetic fix.
