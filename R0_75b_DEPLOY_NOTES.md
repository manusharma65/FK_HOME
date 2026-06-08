# FK Home r0.75b — owner identity, fixed at the root

Your /api/auth/me proved you ARE set up correctly: group_slugs = ["owner",
"employee-base"], you hold leaves.approve.any, and there is no '*' in your
permissions (confirming the owner is real slugs + the owner group, never a wildcard).

## The real bug
The sidebar and nav don't read /api/auth/me. The client builds its user object
from **/api/me/dashboard -> dash.user**, and that user object was missing
`group_slugs`. So on the client `me.group_slugs` was undefined — which is why:
- the sidebar showed "FK Sports" instead of "Founder" (roleLabel checks the owner
  group first, but it was never given the groups), and
- HR today stayed hidden (its nav reveal keys off the owner group).
The server always knew you were the owner; the client was simply never told.

## Fix (root cause, not a patch)
1. **server/auth.js** — group membership is now loaded with every request, exactly
   like permissions and departments already are: `req.user.group_slugs` +
   `req.user.inGroup(slug)`.
2. **server/modules/me.js** — the dashboard user object now includes `group_slugs`,
   so the client's `me` finally carries it. This is what fixes the Founder label
   and the HR today nav for you.
3. **server/modules/daily.js, tasks.js** — the owner checks I added in r0.75a now
   use the one shared signal `req.user.inGroup('owner')` (dropped the extra DB
   queries). Also fixed one leftover `can('*')` in the task hand-over endpoint —
   owner is the group, never the wildcard.
4. **public/index.html** — unchanged logic from r0.75a (isOwner via group_slugs +
   HR today gate + HR Queue retired); included so prod is at the complete state.

## Everything else checked
The other `can('*')` spots (Team work, Recruitment nav; admin/chat profile view)
are all OR'd with real permissions you hold (leaves.approve.any, profile.view.any,
admin.users.edit), so they already work for you. Nothing else was broken.

## Verify after deploy (HARD REFRESH — this is a cached client object)
1. Sidebar under "Bobby" now reads **Founder** (not "FK Sports").
2. **HR today** appears in your left nav and loads the team's day.
3. My Work still shows only your own tasks.

## Leave flow (for reference, as asked)
Employee applies in Leaves & time -> request saved pending, balance shows pending,
nothing deducted -> auto-routed to the daily_ops area owner (Deepanshi), task on
her My Work + notification (falls back to whole HR team if daily_ops unowned) ->
HR reviews in the SHARED Approvals page (anyone with leaves.approve.any sees all
pending; a dept manager sees only their team) -> approve deducts the days, logs
the accrual, re-checks weekend pay for affected weeks, marks those days on-leave
in attendance, closes the routed task, and notifies the employee; reject just
notifies with a reason. Deepanshi is the default owner of leave; Tanu cross-covers.
