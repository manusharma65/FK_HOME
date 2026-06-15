# FK Home — attendance-calendar sick fix + Company holidays redesign

Branch: r10-test (FK Home). Ships TWO files + one test. **No server.js, no index.html.**

## 1. "Leave & time" 30-day grid showed everything purple (sick)
Root cause: the grid reads each day's STORED attendance_day.status. An open-ended
sick log (end_date NULL) made computeExpectedStatus return off_sick for every day
since its start, and the nightly seed froze each day as off_sick. Migration 46
closed the open logs (fixing leave + future days) but never re-stamped the days
already frozen as off_sick — the grid reads those.

Fix (attendance.js): new fixSpuriousSick() re-stamps every off_sick day that has
NO sick_log actually covering it — worked days -> on_time/late, off days -> their
real reason (grey). Genuinely-sick days are untouched. It runs from the existing
boot-time reconcileTodayPattern() call and self-guards in system_state (key
fix:spurious_sick_v1), so it runs ONCE, ever, on the first boot after deploy.

## 2. Company holidays modal redesign (leaves-time.js)
The plain text dump is now dated cards: date block, festival name in Fraunces,
weekday, "CS works" chip (office_closed_for_cs=false => CS works), and a
days-away countdown for holidays within ~31 days. Soonest upcoming = "Next up";
past ones faded. Pulls the live list from /api/attendance/holidays (no API change).

## Tests
- test/spurious-sick-fix.test.js: reproduces the 30-day open-sick-log bug; proves
  30 off_sick -> 1 real sick day, worked days re-derived, genuine sick untouched,
  idempotent.
- Full suite: 31/31 pass (28 existing + 3 new).

## The correction to live data
Happens on the first boot after this deploys (one pass, then guarded off). Cannot
be run against the live DB from the build sandbox; logic is proven against the
real schema + migrations in the test above.
