# r0.81 — Team review (owner-only combined view)

Branch: **r10-test** (FK Home).
(Note: r0.80 = the Gmail read-only mail engine from a separate chat. This is a
different, frontend-only ship — no file overlap with the mail work.)

## What & why
You were flipping between two pages — **HR today** (live daily scan) and
**Reports** (30-day review queue). This adds ONE owner-only page, **Team review**,
with two tabs:
  * **Today**     — the live scan (was HR today)
  * **To review** — the 30-day Good / Satisfactory / Not-satisfactory queue (was Reports)

It REUSES the existing hr/today and hr/reports modules unchanged — no logic was
rewritten or duplicated, so nothing about how they work can drift.

## Access (important)
- **You (owner):** see only **Team review**. HR today and Reports are hidden from
  your nav (folded into the tabs).
- **Managers / HR:** unchanged — they keep their **Reports** page exactly as
  before (team-scoped review). They never had HR today. Nothing is removed from
  them.

## Files
```
public/modules/team-review.js   ← new combined module (tabs, reuses both views)
public/index.html               ← nav: add owner-only "Team review"; hide Reports
                                   from the owner only (managers keep it); load script
R0_81_DEPLOY_NOTES.md
```
No server changes. No database changes. No package.json change.

## Verified
- Module syntax OK; combined module renders both tabs, mounts Today eagerly and
  To-review lazily on click (jsdom smoke test passed).
- Route `#hr/team-review` resolves via the existing loader (same mechanism as
  `hr/insights`), so no route whitelist change is needed.

## Deploy (branch-guarded, r10-test)
```bash
cd ~/Documents/GitHub/campaignpulse-setup
BR=$(git branch --show-current)
if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else
  STEM=fkhome-r0.81-team-review
  cp -R ~/Downloads/$STEM/public/. public/
  cp ~/Downloads/$STEM/R0_81_DEPLOY_NOTES.md .
  git add public/ R0_81_DEPLOY_NOTES.md
  git commit -m "r0.81 — Team review (owner-only combined HR today + Reports)"
  git push origin r10-test
fi
```

## After deploy
Log into FK Home as yourself:
- Nav shows **Team review**; **HR today** and **Reports** are gone from your nav.
- Open it → **Today** tab shows the live scan; **To review** tab shows the 30-day
  queue with the Good/Satisfactory/Not-satisfactory buttons (and they still work).
- (Optional) If you have a manager/HR login handy, confirm they still see **Reports**.
