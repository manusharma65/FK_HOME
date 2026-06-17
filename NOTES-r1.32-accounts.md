# r1.32 — Accounts: FK Enterprises India books (Ship 1)

Internal double-entry bookkeeping for FK Enterprises (the India entity that
bills FK Sports UK). Lives inside FK Home as a new FINANCE section. Base INR,
GBP invoices booked to INR. Bank reconcile = Ship 2; CA pack + PDF attachments = Ship 3.

## What's in this ship
- Double-entry engine: bills (GST + TDS), invoices (export zero-rated / domestic GST,
  INR + GBP), reversal (undo = a dated reversal, nothing ever deleted), period lock.
- Reports: trial balance, profit & loss, balance sheet.
- Opening balances (engine + endpoint; entry screen comes with your FY figures).
- FINANCE nav: Overview, Bills, Invoices, Reports.
- Mahima's weekday tasks auto-generate each morning from her routine (06:00 cron),
  with accounts categories, carry-over, no duplicates.

## Files
- NEW  server/schema/47-accounts.sql   (45 + 46 were taken; 47 is the next free number)
- NEW  server/modules/accounts.js       (engine + API + task generator)
- NEW  public/modules/accounts.js        (FINANCE UI)
- EDIT server.js                         (mount /api/accounts, VERSION r1.32, 06:00 cron)
- EDIT server/schema/seed.js             (accounts.* permissions + "Accounts Team" group)
- EDIT public/index.html                 (Finance nav group + reveal + script tag)
- EDIT public/modules/my-work.js         (accounts categories in add-task, for accounts users)

Academy / learning wiring untouched. Migration is additive + idempotent.

## Tested (local Postgres 16, before ship)
- Engine: 25/25 — balanced postings, GST/TDS split, GBP→INR, trial balance nets to
  zero, balance sheet balances, reversal unwinds cleanly, period lock bites,
  unbalanced refused at engine AND database.
- Generator: 7/7 — right categorised tasks per weekday, idempotent, weekday detection.

## After deploy (one-time)
1. System → Groups → add Mahima to "Accounts Team" (gives her FINANCE; you see it as owner).
2. Opening balances as at 31 Mar 2026 — send me the figures (bank, who owes FK Enterprises,
   what it owes) and I'll post them, or I'll add the entry screen next.
