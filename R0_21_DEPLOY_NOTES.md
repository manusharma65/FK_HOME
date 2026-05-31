# FK Home r0.21 — HR-1.5 anniversary leave fix + 2 cleanups

## What changed (5 files)
1. server/schema/17-accrual-event-types.sql  (NEW migration — auto-applies on deploy)
   - Widens leave_accrual_log.event_type CHECK to allow 'anniversary_reset' + 'backfill'
     (the engine was already writing these; the old constraint rejected them, which
     silently broke the boot backfill and would crash the anniversary accrual).
2. server/modules/leave-engine.js
   - getBalance: reads the CURRENT anniversary row (leave_year_start), not calendar year.
   - recomputeBalanceFor: anniversary model — accrues only within current leave year,
     writes with ON CONFLICT (user_id, leave_year_start); counts taken/pending since anniversary.
   - exports nowLondonDate.
3. server/modules/leaves.js
   - recomputeBalance: updates current anniversary row; counts within leave year.
   - /request: removed flat-25 calendar-row creation; defers to engine balance row.
   - cancel + decide handlers: recomputeBalance() no longer takes a year arg.
4. server/modules/attendance.js
   - /hr/today + /dept/today: return wfh_lat/wfh_lng (only when status='wfh') for the
     "Who's in today" people modal pin.
5. public/index.html
   - renderPeopleTable: WFH map-pin in the Company-today modal rows; row click now in-shell (#profile/<id>).
   - findOpenProfile: in-shell #profile/<id> instead of full-page /profile.html jump.
   - r0.21 version marker.

## NOT changed (deliberate)
- Weekend-pay logic (tickWeeklyWeekendPay / recomputeWeekendPayForRange): already correct.
- runBackfillIfNeeded: already correct (anniversary model) — only the constraint blocked it.
- Accrual rate rule (1/1.5): already correct.
- 4 other /profile.html jumps that carry drawers (#reviews/#onboarding): left for Profile-module polish.
- server.js: no change (cron already wired correctly).

## Deploy (on r10-test)
git branch --show-current   # MUST be r10-test
cp -R server/ public/ + the new schema file into repo, then:
git add server/ public/ R0_21_DEPLOY_NOTES.md
git commit -m "r0.21 HR-1.5 anniversary leave fix + WFH pin in company-today + in-shell profile link"
git push origin r10-test

## After deploy — verify (since this is leave/pay)
- Boot log shows: "[leave-engine] backfill complete — processed N user(s)"  (not an error)
- A user's My Growth → Leaves shows correct accrued days (not 25, not 0 after anniversary).
- Approve a leave → balance decrements against current leave year only.
- "Who's in today" modal: a WFH person shows a green map-pin; clicking opens Google Maps.
- Clicking a person in that modal opens their profile IN-SHELL (no full reload).
