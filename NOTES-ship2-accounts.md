# Ship 2 — Accounts: bank reconcile, FX, aging (+ held nav & opening)

Builds on the live r1.32 Accounts module. Bundles everything held since:

## What's new
- **Finance nav** — rose colour tile; one "Finance" door (tabs live on the page).
- **Opening balances** — entry screen on Overview (owner + Mahima, editable: a correction
  reverses the old entry and posts a fresh one).
- **IDFC importer** — upload the IDFC FIRST .xlsx; parses account, period and every line,
  signed (in +, out −). Proven against a real export — totals tie to the bank's own figures.
- **Overlap guard** — a statement whose dates overlap one already imported offers to REPLACE it;
  if any line in the existing statement is already reconciled it blocks instead (so a replace
  can't orphan an entry). Identical files are still blocked by hash.
- **Reconcile worklist** (new tab) — two-balance header (statement vs books, difference, count),
  each unmatched line: Code to an account, Match to an open invoice/bill, or Set aside.
  Reconciled/aside lines have Undo (reverses cleanly).
- **FX gain/loss** — matching a GBP receipt to an invoice books the rate difference to
  the FX gain/loss account automatically; same for bill payments.
- **AR/AP aging** — in Reports: receivables and payables bucketed Current / 31–60 / 61–90 / 90+.

## Files
- NEW  server/schema/48-accounts-settle.sql   (settlement link on invoices/bills; runs automatically)
- EDIT server/modules/accounts.js              (importer, reconcile, match+FX, aging, opening)
- EDIT public/modules/accounts.js              (reconcile + opening + aging UI)
- EDIT public/index.html                       (Finance nav: rose tile, single door)
- EDIT package.json                            (adds `exceljs` to read .xlsx — installs on deploy)

server.js / seed.js / my-work.js unchanged from r1.32. Academy untouched. Migration 48 is additive.

## Tested (local Postgres 16)
- Importer 16/16 — parse ties to statement totals; signed amounts net to closing balance; re-import blocked.
- Reconcile 10/10 — overlap detection, coding posts balanced journals, two-balance reconciliation, undo, replace-guard.
- FX + aging 13/13 — FX gain and loss both book correctly; undo re-opens the invoice; aging buckets correct.

## After deploy
- Nothing required. `exceljs` installs automatically; migration 48 runs on boot.
- (If not already done from r1.32: System → Groups → add Mahima to "Accounts Team".)
- Opening balances + first statement import are Bobby/Mahima's to enter when ready.
