# FK Home r0.21.1 — fix backfill ON CONFLICT (1 file)

## The error this fixes
[leave-engine.runBackfillIfNeeded] failed: there is no unique or exclusion
constraint matching the ON CONFLICT specification

## Cause
Migration 13 created a PARTIAL unique index on leave_balances(user_id, leave_year_start)
WHERE leave_year_start IS NOT NULL. Postgres only uses a partial index for ON CONFLICT
if the INSERT repeats the same WHERE predicate; the engine's plain
ON CONFLICT (user_id, leave_year_start) does not, so backfill + recompute threw.

## Fix (server/schema/18-leave-balances-full-uniq.sql — auto-applies on deploy)
- DROP the partial index, CREATE a full unique index on (user_id, leave_year_start).
- DELETE the 2 legacy NULL-leave_year_start rows (pre-anniversary flat-25 seed rows).
  Verified safe: only NULL-hire_date user is the owner (no accrual); all employees
  now have hire_date so the boot backfill rebuilds correct anniversary rows; no
  manual adjustment_days on the deleted rows.

## Deploy (on r10-test)
git branch --show-current   # MUST be r10-test
(unzip first, then:)
cp -R ~/Downloads/fk-one-r0_21_1/server/ server/
git add server/ R0_21_1_DEPLOY_NOTES.md
git commit -m "r0.21.1 fix backfill ON CONFLICT — full unique index + drop legacy null rows"
git push origin r10-test

## After deploy — verify
- Boot log: "[leave-engine] backfill complete — processed N user(s)"  (NOT the ON CONFLICT error)
- My Growth → Leaves for an employee: accrued days reflect tenure (not 0, not 25).
- Run once to confirm: SELECT user_id, leave_year_start, entitled_days FROM leave_balances ORDER BY user_id;
  Every active non-owner employee should have one row with a real leave_year_start.
