# r0.79 — Monthly score rollup + director sign-off

Branch: **r10-test** (FK Home).

## Why
Weekly scoring existed, but there was no real monthly score — "This month's
score" in My Growth was actually just showing the latest *weekly* band, and the
monthly design (weekly bands → monthly band → annual raise) was never built.
Averaging weeks would let a see-saw worker (great one week, bad the next) read
"Good", which hides the gap. This ship fixes that with strict rules.

## The monthly rules (server/modules/daily.js → monthlyBandFromWeeks)
A month's band is derived from that month's weekly bands:
1. Base = rounded average of the weekly bands.
2. **Strict floor** — ONE Poor week caps the whole month at **Average**.
3. **All-weeks gate** — "Excellent" needs *every* week (and >=4 weeks) at
   Excellent-or-above; "Above Expectations" needs every week at Above
   Expectations; otherwise capped at **Good**. A partial month (<4 weeks) can't
   reach the top bands.
4. **Director sign-off** — "Excellent" / "Above Expectations" need the **owner**
   to approve. Until then the effective (paying) band is **Good**.

Same 5 bands and 0/5/10/15/20% raise caps as the rest of the company — unchanged.

## What's in the ship
```
server/schema/36-monthly-scores.sql   ← new monthly_scores table (+ approval state)
server/modules/daily.js               ← monthlyBandFromWeeks + computeMonth + 3 endpoints:
                                          GET  /api/daily/month
                                          POST /api/daily/month/approve   (OWNER only)
                                          GET  /api/daily/month/pending   (owner panel feed)
public/modules/my-growth.js           ← real monthly band in the headline tile,
                                          a "This month" breakdown with the rule reasons,
                                          and owner Approve/Reject buttons when pending
test/scoring.test.js                  ← + monthly rule tests + approval test
test/helpers/db.js                    ← resets monthly_scores between tests
```
Approval is locked to the **owner** group on both the server and the UI.

**Verified:** all scoring tests pass against a real Postgres 16, including the new
migration, the strict-floor / all-weeks-gate / partial-month rules, and the
approve-flow (effective stays Good until the owner signs off, then becomes the
real band).

## NOT in this ship (still open, by design)
- **Annual rollup** (months → year-end raise %) — next.
- A dedicated owner "all months awaiting sign-off" panel (the endpoint exists;
  for now you approve from each person's My Growth).
- The Excel CS/Sales trackers still use averaging — mirror the strict logic there
  separately if you want it identical everywhere.

## Deploy (branch-guarded, r10-test)
```bash
cd ~/Documents/GitHub/campaignpulse-setup
BR=$(git branch --show-current)
if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else
  STEM=fkhome-r0.79-monthly-score
  cp -R ~/Downloads/$STEM/server/. server/
  cp -R ~/Downloads/$STEM/public/. public/
  cp -R ~/Downloads/$STEM/test/. test/
  cp ~/Downloads/$STEM/R0_79_DEPLOY_NOTES.md .
  git add server/ public/ test/ R0_79_DEPLOY_NOTES.md
  git commit -m "r0.79 — monthly score rollup + director sign-off"
  git push origin r10-test
fi
```
