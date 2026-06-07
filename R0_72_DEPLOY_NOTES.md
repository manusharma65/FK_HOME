# FK Home r0.72 — Person names → Fraunces (theme consistency)

## What
Completes the r0.71 "person names in Fraunces" rollout. Several modules were
rendering person names as bare text or inline `font-weight:500`, so they fell
back to the body sans (Hanken) instead of the theme display serif (Fraunces).
Recruitment already used `.rec-cand-name` so it was correct; the rest were not.

Fix: every visible person-name now carries `class="nm"`, which the existing
global rule (`#moduleView .nm { font-family:'Fraunces' !important; font-weight:600 }`
in index.html ~line 718) turns into the theme serif. No CSS / index.html change —
only the render call-sites were updated.

## Files changed (public/modules only)
- attendance.js — team list name + selected-person calendar header
- hr-payroll.js — run-table name, summary-table name, owner row, day drill header
- approvals.js — request table name
- regularisations.js — request table name
- employment.js — people list name + detail drawer header (legacy fallback page)
- hr-insights.js — person row name
- chat.js — member picker + manage-members row
- csrota.js — rota row name

(team-work.js `.tw-pname`, users.js `.nm`/`--udisp`, recruitment.js `.rec-cand-name`
were already on Fraunces — untouched.)

## Verify after deploy
1. Payroll → run table: employee names now serif (Fraunces), LOP dates stay small grey.
2. Team attendance → names in the list now serif, matching Recruitment.
3. Approvals / Regularisations / HR Insights / CS Rota → names serif.
All names across the app should now read in the same warm Insights serif.

No server, schema, or index.html changes. Branch: r10-test.
