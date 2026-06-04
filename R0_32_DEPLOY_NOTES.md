# r0.32 — Close HR ship (2026-06-05)

Branch: r10-test (FK Home). Prod + staging share the DB.

## What changed

1. **Leave starts at 0 for new hires** — `server/modules/admin.js`
   New-user creation no longer grants a flat 25 days. New hires start at 0 and
   the accrual engine credits 1 day/month (first 6 months) then 1.5/month, on
   each monthly anniversary. Fixes the silent over-grant on every hire.

2. **Approvals merge** — `public/modules/approvals.js` (new), `public/index.html`
   Leaves + Regularisations are now ONE page (#hr/approvals) with two tabs:
   Leave and Corrections. Logic ported verbatim from the old modules (balance
   panel, reject-with-note, approve/deny all intact). Registered under
   hr/approvals, hr/leaves and hr/regularisations so existing notification
   deep-links still work with NO notify changes: leave notifications open the
   Leave tab (and #hr/leaves/<id> focuses that request); correction
   notifications open the Corrections tab. Bigger fonts + full-size buttons.
   The old `leaves.js` and `regularisations.js` modules are superseded (removed
   in the cleanup commit; script tags dropped from index.html).

3. **Onboarding nav item removed** — `public/index.html`
   No standalone Onboarding page (there never was a module — it routed to
   People as a stopgap). Onboarding lives in each person's Profile → Onboarding
   drawer, reached via People. The employee "Your onboarding" item is unchanged.

4. **Backups pill repointed** — `public/index.html`
   The top-bar Backups pill now opens `#system/backups` in-shell instead of
   `/admin.html#backups`. This was the last live link to the old admin page.

5. **HR Insights links in-shell** — `public/modules/hr-insights.js`
   The 5 "open person" links now route to `#profile/<id>` (and
   `/reviews`, `/onboarding` drawers) instead of jumping to the old
   `profile.html`. (Users module was already in-shell — no change.)

6. **Recruitment board fits on screen** — `public/modules/recruitment.js`
   Columns now share the board width (`flex:1 1 0; min-width:120px`) so all 8
   stages fit with no horizontal scroll; falls back to scroll only on very
   narrow widths.

## Cleanup commit (separate)
Removes superseded modules (`leaves.js`, `regularisations.js`) and CampaignPulse
leftovers that rode over from main and are unused on FK Home: `server/logistics.js`,
`google.html`, `logistics.html`, `agent.html`, `shell.html`, `supplier.html`,
`performance.html`, and the `*.before-r36` backup snapshots. Deleting on r10-test
does NOT affect main/CampaignPulse — each branch keeps its own copy.

KEPT (still used in production during parallel build): admin.html, profile.html,
chat.html, my-growth.html.

## Validated
All changed JS passes `node --check`; index.html inline scripts parse.
