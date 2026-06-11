# Ship A — backend safety + correctness (VERSION r0.99)

Branch: r10-test (FK Home). 3 files. No UI change, no schema/data change.
Everything here is behaviour-preserving except where noted; all verified in the
sandbox before shipping.

## 1. server/schema/index.js — migrations are APPEND-ONLY
A previously-applied .sql whose content changed is no longer re-run on boot
(re-running a non-idempotent migration could duplicate/damage live data). New
files still apply; unchanged files still skip; a CHANGED applied file now logs a
warning and is skipped. Verified by simulation (new=applied, unchanged=skipped,
changed=warned+not-run, no spurious writes).
RULE: never edit a shipped migration — add the next-numbered file instead.

## 2. server.js — cron reliability
(a) `db` was never imported (`const { initDb } = ...`), so loadCronState/
    saveCronRun threw silently and the r0.94 "persist last-run" guard never
    worked — after a restart, jobs whose start time had passed re-ran (e.g.
    midnight freeze + 01:00 accrual firing again at 2pm). Fixed: import `db`.
(b) Weekly jobs only fired on the exact weekday, so a job missed across a whole
    day (server down all Sunday) waited a full week. Now backfills: it runs once
    when the server is back if the most recent due occurrence hasn't run. Verified
    across 6 cases incl. the missed-Sunday backfill. Daily jobs unchanged.
VERSION bumped r0.98 -> r0.99 (also refreshes the module cache-bust).

## 3. server/modules/auth.js — login can't be enumerated
Unknown/deleted emails now run a bcrypt compare against a fixed dummy hash
(constant time), and an inactive account is only revealed AFTER a correct
password — without the password, active vs inactive both return the same 401.
Verified against the real router: unknown=401 (bcrypt ran), wrong-pw=401,
inactive+right-pw=403, inactive+wrong-pw=401, active+right-pw=200.

## After deploy
- App boots normally; /healthz reads r0.99. No visible change for users.
- Logs: each migration "already applied"/"applied"; cron lines now persist.
