# FK Home r0.76 — Two-stage approvals (manager → HR) for leave + regularisation

Branch: **r10-test** (FK Home). Do NOT deploy to main.

## What this changes
Leave and attendance-correction requests no longer land straight on HR. They now
flow **manager first, then HR**:

1. Employee applies.
2. Their **line manager** gets a *"Leave to review"* / *"Correction to review"* task
   in **My Work**, with the context to decide: the person's balance, what their
   balance would be after, and **who else on their team is already off those dates**.
   Manager taps **Agree** or **Disagree**.
   - **Disagree** → declined back to the employee. It never reaches HR.
   - **Agree** → a fresh **HR** task opens for the final eligibility check.
3. **HR** gets a *"Leave to approve"* task in My Work → **Approve** / **Reject**.
   Approve deducts the balance / patches the day as before. Reject bounces to the
   employee **and** notifies the manager (so they know the one they agreed didn't pass).

Both steps are **separate scored tasks**, so the manager is scored on their review
and HR on their approval.

### Notifications
- On apply: **manager** gets the actionable task; **you (owner) + HR** get a heads-up.
- No manager set: it goes **straight to HR** (actionable), you get the heads-up.
- Sick is unchanged in this ship (still HR-actioned).

### Where approvals are actioned
The decision happens on the **task in My Work** — that's where everyone already works.
The HR **Approvals page is unchanged in this ship** and still lists pending requests;
HR can still finalise HR-stage items there. (See "Known follow-up" below.)

## ⚠️ PREREQUISITE — set line managers
Stage 1 uses each person's **manager** (People → person → Manager).
**If a person has no manager set, their request skips the manager step and goes
straight to HR.** Populate `manager_user_id` for all staff via People admin before
relying on the manager step. A manager's own request goes to *their* manager
(top managers report to you, so those land on you).

## Migration
`server/schema/35-two-stage-approvals.sql` runs automatically on boot (idempotent).
It adds `approval_stage` + a manager-decision block to both tables and back-fills:
already-finalised rows → `done`; still-pending rows → `hr` (so nothing gets stuck
behind a step that didn't exist when it was raised).

## Files in this zip
- `server/schema/35-two-stage-approvals.sql` (new)
- `server/approval-flow.js` (new — shared routing/task helpers)
- `server/modules/leaves.js` (request routing, review-context, manager-decide, HR decide)
- `server/modules/attendance.js` (same for regularisation)
- `server/modules/tasks.js` (approval tasks excluded from peer-coverage; HR covers those)
- `public/modules/my-work.js` (the decision card)
- Cumulative owner-identity fixes (no-op if r0.75b already deployed):
  `server/auth.js`, `server/modules/me.js`, `server/modules/daily.js`, `public/index.html`

## Notes
- The old `hr-task-router` leave/regularisation entries are now **inert** (those
  events are no longer fired) — left in place, harmless, can be cleaned later.

## Known follow-up (NOT in this ship — deliberate)
HR **Approvals page** birds-eye polish: show an *"awaiting manager / awaiting HR"*
chip per row and hide Approve/Reject on awaiting-manager rows. Today the page still
works — it lists pending and HR can finalise HR-stage items; if HR taps approve on
an awaiting-manager item the server safely refuses with "Still awaiting manager
review". Flagged so this is a conscious next step, not a miss.

## Verify after deploy (hard-refresh first)
1. As an employee, apply for leave.
2. As that person's **manager**: My Work shows *"Leave to review — <name>"* with
   balance, balance-after, and team-overlap. Tap **Agree**.
3. As **HR**: My Work shows *"Leave to approve — <name>"*. Tap **Approve** → balance deducts.
4. Confirm HR no longer auto-owns everyone's leave from the moment it's raised.
5. Repeat with an attendance correction (regularisation).
6. Try **Disagree** at stage 1 → employee is declined, HR never sees it.
