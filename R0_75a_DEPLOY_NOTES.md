# FK Home r0.75a — owner-identity fix (HR today + coverage)

You were right: I was treating you as a regular user. Both bugs were the same
mistake. I gated owner-only things on the `*` permission. But the server builds a
user's permissions as the literal slugs from their groups — there is no wildcard
expansion — and your account isn't granted a `*`; it's identified as owner by the
**`owner` group** (the same signal the sidebar already uses to label you "Founder").
So `can('*')` was false for you, which hid HR today from you, and the coverage code
treated you as a peer.

## Three corrections, all on the real owner signal (group = 'owner')
1. **HR today nav (public/index.html)** — now revealed by owner-group membership,
   not `can('*')`. You see it; Tanu, Deepanshi, Satyam do not.
2. **HR today data (server/modules/daily.js → /api/daily/team)** — the endpoint
   gate was `requirePermission('*')` (would 403 you). Replaced with a real
   owner-group check.
3. **Coverage (server/modules/tasks.js → /api/tasks/mine)** — the owner now never
   receives coverage items at all (you oversee; you don't cover). Coverage is also
   tightened to genuine peers: it only surfaces to a NON-manager member of the
   absent person's department. So Tanu <-> Deepanshi cover each other; you and
   Satyam are never roped in.

## What you should now see
- **HR today** back in your left nav, working — your founder's daily scan.
- **My Work** showing only YOUR tasks again — no more Tanu/Deepanshi items.
  (Their tasks only ever surface to each other, and only when one is actually off.)

## Verify (hard-refresh first)
1. HR today appears in your nav and loads the team's day.
2. Your My Work no longer lists Tanu's or Deepanshi's tasks.
3. (Optional) Log in as Tanu with Deepanshi marked off today — Deepanshi's open
   tasks appear under "Covering while they're off" for Tanu, not for you.
