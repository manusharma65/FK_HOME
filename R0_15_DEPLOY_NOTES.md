# FK Home r0.15 — HR-1.5 Deploy Notes

**Branch:** `r10-test`
**Deploy:** `cd ~/Documents/GitHub/campaignpulse-setup && git push origin r10-test`

Healthz returns `r0.15` after deploy. Migration `13-leave-year-anniversary.sql`
applies on boot. Backfill runs **once** on first boot (self-guarded via
`system_state` table).

---

## What shipped in r0.15 (HR-1.5)

### Leave engine — corrected
- **Anniversary-based leave year.** Each employee's leave year now starts on
  their hire-date anniversary, not 1 January. Reset to 0 on anniversary.
  No carryover. New `leave_year_start` column on `leave_balances`.
- **Owner excluded from accrual.** Bobby's seeded balance changed from 25 → 0.
  Accrual cron now skips anyone in the `owner` group.
- **Boot-time backfill.** For every active non-owner employee, the engine
  calculates correct entitled_days from their most recent anniversary using
  the 1/mo → 1.5/mo accrual rule, and overwrites the row. Self-guarded so it
  only runs once.
- **Retroactive weekend recompute.** When a leave is approved, every weekend
  in the affected date range is re-evaluated against the 5-day rule. Past
  weekends can flip paid ↔ unpaid as the leave makes the week's count change.
- **Heartbeat logging.** Both cron ticks now log every run including zero
  accruals, so you can verify in Railway logs that they fire.

### Payroll page (new)
- Sidebar item **Payroll** under HR group. Visible to Owner + HR only
  (gated on `profile.salary.view`).
- Month picker (← → arrows) + summary tiles (Employees / Paid days / Unpaid
  days / Weekends unpaid).
- Per-employee table with: Salary, Paid, Unpaid, Annual Leave, Sick (paid),
  Sick (unpaid), Weekends paid ratio, Late count, View button.
- Click **View** on any row → day-by-day drill for that month showing each
  day's status, weekend pay reason, and paid/unpaid flag.
- **Export CSV** button → downloads `payroll-YYYY-MM.csv` with every column
  for the selected month.
- Owner row shows "n/a — owner does not accrue".

### Endpoints (new, all require `profile.salary.view`)
- `GET /api/payroll/month?year=&month=`
- `GET /api/payroll/month/:userId/days?year=&month=`
- `GET /api/payroll/month.csv?year=&month=`

---

## POST-DEPLOY CHECKS

1. **Healthz** = r0.15.
2. **Backfill ran** — check Railway logs for
   `[leave-engine] backfill complete — processed N user(s)`
   and `[leave-engine] tickMonthlyAccrual ... candidates=N` heartbeat.
3. **Open Payroll** — click Payroll in the HR sidebar.
   - Month label shows current month.
   - Tiles show real numbers.
   - Bobby's row is greyed "n/a — owner does not accrue".
4. **Click View on any row** → day-by-day drill loads with weekend flags.
5. **Click Export CSV** → file downloads.
6. **Test as Tanu** — log in as Tanu (HR), confirm Payroll visible in sidebar
   and editing salary still works.
7. **Test as an agent** — log in as e.g. Aryan, confirm Payroll is **not**
   visible in their sidebar.

---

## NOT in this ship (deferred)
- Profile module (file View/Replace/download-gate, Monday-style reviews card,
  attendance calendar with payslip roll-up) — next ship.
- Leaves admin tab migration to module + leave-from-notification — later.

---

## Migration safety notes
- `13-leave-year-anniversary.sql` only ADDS the `leave_year_start` column and a
  new unique index — it does NOT drop the old `(user_id, year)` index. Existing
  reads continue to work.
- Backfill is idempotent and self-guards via `system_state.hr15_backfill_done`.
  If it fails partway, the flag isn't set, so it retries on next boot.
- The `STANDARD_ANNUAL_DAYS = 25` constant and `leave_policies` table are
  unchanged (dead code, harmless). Will clean up in a later ship.
