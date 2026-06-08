# r0.78 — Automated test suite (+ a real bug fix the tests surfaced)

Branch: **r10-test** (FK Home). This ship adds an automated test suite and a CI
workflow, plus **one production-affecting fix in `server/db.js`** that the tests
caught the moment they ran.

---

## ⚠️ READ THIS FIRST — the tests found a real latent bug

There was **no Postgres DATE type-parser anywhere in the app**. node-postgres
returns `DATE` columns (like `hire_date`) as JavaScript `Date` objects, but the
leave engine assumes they're `'YYYY-MM-DD'` strings — e.g.
`String(hire_date).slice(0,10)`, which on a `Date` object produces `"Sun Mar 01"`,
giving a broken date and **`NaN` leave accrual**. The engine's own helper comment
even acknowledges dates "may come back as a Date object OR a string", but
`recomputeBalanceFor` didn't go through that helper.

**Fix (server/db.js):** register a global parser so DATE columns always come back
as the raw `'YYYY-MM-DD'` string — which is what the whole codebase already
assumes:

```js
const { Pool, types } = require('pg');
types.setTypeParser(1082, (v) => v);   // DATE → string, everywhere
```

This is a small, systemic fix that makes the code's existing assumption true. It
has no effect on timestamp columns (only DATE / oid 1082). Worth knowing it's in
this ship rather than buried as "test setup".

`server/db.js` also now disables SSL for `localhost` / `127.0.0.1` (as well as
`railway.internal`), so the suite can talk to a local / CI Postgres. Prod (the
external Railway URL) is unchanged — still SSL on.

---

## What's in the ship

```
server/db.js                  ← DATE parser + localhost SSL-off (see above)
server/modules/payroll.js     ← one added line: module.exports.rollupForUser (test hook)
test/helpers/db.js            ← spins up schema via the app's REAL migrations + seed
test/helpers/fixtures.js      ← users, group/dept membership, fake req.user, mini-app
test/leave-engine.test.js     ← 9 tests  (accrual, anniversary reset, balance math)
test/weekend-pay.test.js      ← 4 tests  (5-day rule, leave counts, sick threshold)
test/payroll.test.js          ← 4 tests  (paid/unpaid inference, sick, weekends, splitSalary)
test/approvals.test.js        ← 6 tests  (two-stage routing, self-approval guard, stage gate)
test/scoring.test.js          ← 3 tests  (correctness band, not-done cap, absence drop)
.github/workflows/test.yml    ← runs all 26 on every push / PR to r10-test
R0_78_DEPLOY_NOTES.md
```

**26 tests, all passing** against a real Postgres 16 (verified locally before
packaging — not just syntax-checked).

## How it works (so it's not a black box)

- Tests run with `node --test` (built into Node, no test framework dependency).
- The harness reuses the app's own `initDb` + `runMigrations` + `seedInitialData`,
  so it exercises the real migration path and real scaffolding — not a mock.
- Engine math (leave, weekend pay, payroll, scoring) is asserted by calling the
  real functions; the approval flow is driven through the **real route handlers**
  with an injected identity, so routing/guard logic is tested as it actually runs.
- Between tests it truncates the volatile tables and keeps the seeded groups/owner.

## CI

`.github/workflows/test.yml` stands up a `postgres:16` service, installs deps
(`npm install` for app deps, `npm install --no-save supertest` for the one
test-only dep), and runs `node --test test/*.test.js`. No change to `package.json`
is required. If you'd like a local shortcut you can optionally add
`"test": "node --test test/*.test.js"` to your scripts — not needed for CI.

## Deploy (branch-guarded, r10-test)

```bash
cd ~/Documents/GitHub/campaignpulse-setup
BR=$(git branch --show-current)
if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else
  STEM=fkhome-r0.78-test-suite
  cp -R ~/Downloads/$STEM/server/. server/
  cp -R ~/Downloads/$STEM/test/. test/
  mkdir -p .github/workflows && cp ~/Downloads/$STEM/.github/workflows/test.yml .github/workflows/test.yml
  cp ~/Downloads/$STEM/R0_78_DEPLOY_NOTES.md .
  git add server/ test/ .github/ R0_78_DEPLOY_NOTES.md
  git commit -m "r0.78 — automated test suite + DATE parser fix"
  git push origin r10-test
fi
```

Note the `git add` includes `test/` and `.github/` (not just `server/`) — those
are new top-level paths.
