// FK Home — Leave engine (r0.7)
// ----------------------------------------------------------------------------
// Handles:
//   * Monthly leave accrual based on tenure (1/mo first 6, 1.5/mo after)
//   * Weekly weekend conditional pay calculation
//   * Manual balance adjustments
//   * Balance recompute from joined_date
//
// Accrual rule:
//   tenure_months <= 6 → 1.0 days per month
//   tenure_months >  6 → 1.5 days per month
//   Anniversary day = the day-of-month of joined_date.
//   E.g. joined 15 March 2026 → accrual events on 15 April, 15 May, 15 June…
//
// Weekend pay rule:
//   For each Mon–Sun week, count "qualifying days":
//     - attendance_day status in (on_time, late, very_late, worked_voluntary)
//     - approved annual leave (any request_type in ('annual','compassionate'))
//     - paid sick leave (off_sick AND sick_notified_hours >= 4)
//     - public holidays (off_holiday)
//   If qualifying_days >= 5 → Sat + Sun marked 'paid'
//   If qualifying_days <  5 → Sat + Sun marked 'unpaid' (full loss, no proration)
//
// All accrual events are logged to leave_accrual_log for full audit history.
// ============================================================================

const { db } = require('../db');

// --- Date helpers ----------------------------------------------------------

function nowLondonDate() {
  // Same approach as attendance.js — TZ-naive date string in London.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date());  // 'YYYY-MM-DD'
}

function monthsBetween(startDate, endDate) {
  // Full months elapsed from startDate to endDate (both as YYYY-MM-DD strings).
  // Returns integer count of completed monthly anniversaries.
  const s = new Date(startDate + 'T00:00:00Z');
  const e = new Date(endDate + 'T00:00:00Z');
  if (e < s) return 0;
  let months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  // If the day-of-month hasn't been reached yet this month, subtract 1.
  if (e.getUTCDate() < s.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function isAnniversaryToday(joinedDate, today) {
  // Returns true if `today` (YYYY-MM-DD) is on the same day-of-month as joinedDate.
  // Handles month-end edges: e.g. joined 31 Jan, today = 28 Feb → treat as anniversary.
  const j = new Date(joinedDate + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  if (t <= j) return false;   // not yet a full month since joining
  const joinDay = j.getUTCDate();
  const todayDay = t.getUTCDate();
  if (joinDay === todayDay) return true;
  // End-of-month edge: if joinDay is 29/30/31 and today is the last day of a shorter month
  if (joinDay > todayDay) {
    const lastOfMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return todayDay === lastOfMonth && joinDay > lastOfMonth;
  }
  return false;
}

// --- Accrual rate ----------------------------------------------------------

// r0.15 (HR-1.5) — Returns the user's most recent hire-anniversary on or before today.
// E.g. hire 15 Apr 2024, today 28 May 2026 → returns 2026-04-15.
function lastAnniversary(hireDate, today) {
  const h = new Date(hireDate + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  let year = t.getUTCFullYear();
  let anniv = new Date(Date.UTC(year, h.getUTCMonth(), h.getUTCDate()));
  if (anniv > t) {
    anniv = new Date(Date.UTC(year - 1, h.getUTCMonth(), h.getUTCDate()));
  }
  return anniv.toISOString().slice(0, 10);
}

function accrualRateForTenure(tenureMonths) {
  // tenureMonths = how many months they'll have completed AFTER this accrual.
  if (tenureMonths <= 6) return 1.0;
  return 1.5;
}

// --- Recompute a single user's balance from joined_date --------------------

async function recomputeBalanceFor(userId, opts = {}) {
  const { actorUserId = null, note = 'Initial recompute' } = opts;
  const u = await db.query(
    `SELECT id, hire_date, full_name FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (u.rows.length === 0) return { ok: false, error: 'User not found' };
  const user = u.rows[0];
  if (!user.hire_date) {
    return { ok: false, error: 'User has no joined_date set' };
  }

  const today = nowLondonDate();
  const joined = String(user.hire_date).slice(0, 10);
  const totalMonths = monthsBetween(joined, today);

  // Compute total accrued days
  let accrued = 0;
  for (let m = 1; m <= totalMonths; m++) {
    accrued += accrualRateForTenure(m);
  }
  accrued = Math.round(accrued * 100) / 100; // 2dp

  const year = new Date().getFullYear();

  // Reset taken_days to actual approved leaves taken this year (best effort)
  const taken = await db.query(
    `SELECT COALESCE(SUM(total_days), 0) AS d
       FROM leave_requests
      WHERE user_id = $1
        AND status = 'approved'
        AND EXTRACT(YEAR FROM start_date) = $2`,
    [userId, year]
  );
  const pending = await db.query(
    `SELECT COALESCE(SUM(total_days), 0) AS d
       FROM leave_requests
      WHERE user_id = $1
        AND status = 'pending'
        AND EXTRACT(YEAR FROM start_date) = $2`,
    [userId, year]
  );

  // Upsert leave_balances — preserve adjustment_days
  await db.query(
    `INSERT INTO leave_balances
       (user_id, year, entitled_days, carryover_days, taken_days, pending_days, recomputed_at, updated_at)
     VALUES ($1, $2, $3, 0, $4, $5, NOW(), NOW())
     ON CONFLICT (user_id, year) DO UPDATE
       SET entitled_days = EXCLUDED.entitled_days,
           taken_days    = EXCLUDED.taken_days,
           pending_days  = EXCLUDED.pending_days,
           recomputed_at = NOW(),
           updated_at    = NOW()`,
    [userId, year, accrued, Number(taken.rows[0].d), Number(pending.rows[0].d)]
  );

  await db.query(
    `INSERT INTO leave_accrual_log
       (user_id, year, event_date, event_type, days_delta, tenure_months, note, actor_user_id)
     VALUES ($1, $2, $3, 'recompute_baseline', $4, $5, $6, $7)`,
    [userId, year, today, accrued, totalMonths, note, actorUserId]
  );

  return {
    ok: true,
    user_id: userId,
    full_name: user.full_name,
    joined_date: joined,
    tenure_months: totalMonths,
    accrued_days: accrued,
    taken_days: Number(taken.rows[0].d),
    pending_days: Number(pending.rows[0].d),
  };
}

// --- Apply a manual adjustment ---------------------------------------------

async function adjustBalance(userId, delta, note, actorUserId) {
  if (typeof delta !== 'number' || isNaN(delta)) {
    return { ok: false, error: 'delta must be a number' };
  }
  const year = new Date().getFullYear();
  const today = nowLondonDate();

  // Ensure a row exists.
  await db.query(
    `INSERT INTO leave_balances (user_id, year, adjustment_days, adjustment_note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, year) DO UPDATE
       SET adjustment_days = leave_balances.adjustment_days + $3,
           adjustment_note = COALESCE($4, leave_balances.adjustment_note),
           updated_at = NOW()`,
    [userId, year, delta, note || null]
  );

  await db.query(
    `INSERT INTO leave_accrual_log
       (user_id, year, event_date, event_type, days_delta, note, actor_user_id)
     VALUES ($1, $2, $3, 'manual_adjustment', $4, $5, $6)`,
    [userId, year, today, delta, note || null, actorUserId]
  );

  return { ok: true };
}

// --- Compute the displayed balance (with adjustment) -----------------------

async function getBalance(userId) {
  const year = new Date().getFullYear();
  const r = await db.query(
    `SELECT entitled_days, carryover_days, taken_days, pending_days,
            adjustment_days, adjustment_note, recomputed_at
       FROM leave_balances WHERE user_id = $1 AND year = $2`,
    [userId, year]
  );
  if (r.rows.length === 0) {
    return {
      annual: 0, carryover: 0, used: 0, pending: 0, adjustment: 0,
      remaining: 0, adjustment_note: null, recomputed_at: null,
    };
  }
  const b = r.rows[0];
  const annual = Number(b.entitled_days || 0);
  const carry = Number(b.carryover_days || 0);
  const used = Number(b.taken_days || 0);
  const pending = Number(b.pending_days || 0);
  const adj = Number(b.adjustment_days || 0);
  return {
    annual,
    carryover: carry,
    used,
    pending,
    adjustment: adj,
    remaining: Math.round((annual + carry + adj - used - pending) * 100) / 100,
    adjustment_note: b.adjustment_note,
    recomputed_at: b.recomputed_at,
  };
}

// --- Cron: monthly accrual tick --------------------------------------------
// Runs daily at 01:00 London. For each active user with a joined_date,
// checks if today is their anniversary-day. If yes, credit days based on tenure.

async function tickMonthlyAccrual() {
  try {
    const today = nowLondonDate();
    // r0.15 (HR-1.5): exclude owners — they don't accrue leave
    const users = await db.query(
      `SELECT u.id, u.hire_date FROM users u
        WHERE u.deleted_at IS NULL
          AND u.employment_status = 'active'
          AND u.hire_date IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_groups ug
            JOIN groups g ON g.id = ug.group_id
            WHERE ug.user_id = u.id AND g.slug = 'owner'
          )`
    );
    let accrued = 0;
    for (const u of users.rows) {
      const joined = String(u.hire_date).slice(0, 10);
      if (!isAnniversaryToday(joined, today)) continue;

      const tenure = monthsBetween(joined, today);
      const rate = accrualRateForTenure(tenure);
      // r0.15 (HR-1.5) — anniversary-based leave year. On the exact anniversary
      // we reset entitled_days to 0 then apply this month's accrual on top.
      // A different leave_year_start row is created for each new employment year.
      const newYearStart = today; // we're firing on the anniversary day
      const year = new Date().getUTCFullYear();

      // Check if this is a fresh anniversary (year-start) vs a regular monthly tick.
      // If a row already exists with this leave_year_start, just add the accrual;
      // otherwise create the new year-row at 0 + accrual.
      const existing = await db.query(
        `SELECT id FROM leave_balances WHERE user_id = $1 AND leave_year_start = $2`,
        [u.id, newYearStart]
      );
      if (existing.rows.length === 0) {
        // New employment year — reset and start fresh
        await db.query(
          `INSERT INTO leave_balances
             (user_id, year, leave_year_start, entitled_days, carryover_days, taken_days, pending_days)
           VALUES ($1, $2, $3, $4, 0, 0, 0)`,
          [u.id, year, newYearStart, rate]
        );
        await db.query(
          `INSERT INTO leave_accrual_log
             (user_id, year, event_date, event_type, days_delta, tenure_months, note)
           VALUES ($1, $2, $3, 'anniversary_reset', 0, $4, $5)`,
          [u.id, year, today, tenure,
           `Anniversary reset; new leave year starts ${newYearStart}`]
        );
        await db.query(
          `INSERT INTO leave_accrual_log
             (user_id, year, event_date, event_type, days_delta, tenure_months, note)
           VALUES ($1, $2, $3, 'monthly_accrual', $4, $5, $6)`,
          [u.id, year, today, rate, tenure,
           `Monthly accrual at tenure ${tenure}mo (rate ${rate}/mo)`]
        );
      } else {
        // Same employment year — accrue on top
        await db.query(
          `UPDATE leave_balances SET entitled_days = entitled_days + $1, updated_at = NOW()
            WHERE user_id = $2 AND leave_year_start = $3`,
          [rate, u.id, newYearStart]
        );
        await db.query(
          `INSERT INTO leave_accrual_log
             (user_id, year, event_date, event_type, days_delta, tenure_months, note)
           VALUES ($1, $2, $3, 'monthly_accrual', $4, $5, $6)`,
          [u.id, year, today, rate, tenure,
           `Monthly accrual at tenure ${tenure}mo (rate ${rate}/mo)`]
        );
      }
      accrued++;
    }
    // r0.15 — heartbeat even on zero accruals
    console.log(`[leave-engine] tickMonthlyAccrual ${today}: accrued=${accrued} candidates=${users.rows.length}`);
  } catch (err) {
    console.error('[leave-engine.tickMonthlyAccrual] failed:', err.message);
  }
}

// --- Cron: weekly weekend pay ----------------------------------------------
// Runs Sundays at 23:30 London. Computes weekend pay status for the
// just-finished week (Mon-Sun ending today).

async function tickWeeklyWeekendPay() {
  try {
    const today = nowLondonDate();
    const dt = new Date(today + 'T00:00:00Z');
    // Find Monday of this week (today is Sunday).
    const day = dt.getUTCDay(); // 0=Sun
    // If today is Sunday, Monday was 6 days ago.
    const daysBack = day === 0 ? 6 : (day - 1);
    const monday = new Date(dt);
    monday.setUTCDate(monday.getUTCDate() - daysBack);
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const saturday = new Date(monday);
    saturday.setUTCDate(saturday.getUTCDate() + 5);
    const mondayStr = monday.toISOString().slice(0, 10);
    const sundayStr = sunday.toISOString().slice(0, 10);
    const saturdayStr = saturday.toISOString().slice(0, 10);

    // For each user, count qualifying days in [monday, sunday]
    const users = await db.query(
      `SELECT id FROM users WHERE deleted_at IS NULL AND employment_status = 'active'`
    );

    for (const u of users.rows) {
      // Qualifying attendance days
      const attCount = await db.query(
        `SELECT COUNT(*)::int AS c
           FROM attendance_day
          WHERE user_id = $1
            AND for_date BETWEEN $2 AND $3
            AND (
              status IN ('on_time','late','very_late','worked_voluntary','off_holiday')
              OR (status = 'on_leave')
              OR (status = 'off_sick' AND sick_notified_hours >= 4)
            )`,
        [u.id, mondayStr, sundayStr]
      );
      const qualifying = Number(attCount.rows[0].c);
      const newStatus = qualifying >= 5 ? 'paid' : 'unpaid';

      // Update Saturday + Sunday rows. Create them if missing.
      for (const day of [saturdayStr, sundayStr]) {
        const existing = await db.query(
          `SELECT id FROM attendance_day WHERE user_id = $1 AND for_date = $2`,
          [u.id, day]
        );
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO attendance_day (user_id, for_date, status, weekend_pay_status, is_paid)
             VALUES ($1, $2, 'off_pattern', $3, $4)
             ON CONFLICT (user_id, for_date) DO NOTHING`,
            [u.id, day, newStatus, newStatus === 'paid']
          );
        } else {
          await db.query(
            `UPDATE attendance_day
                SET weekend_pay_status = $1,
                    is_paid = $2,
                    updated_at = NOW()
              WHERE id = $3`,
            [newStatus, newStatus === 'paid', existing.rows[0].id]
          );
        }
      }
    }
    console.log(`[leave-engine] weekend pay computed for ${users.rows.length} user(s), week ${mondayStr}–${sundayStr}`);
  } catch (err) {
    console.error('[leave-engine.tickWeeklyWeekendPay] failed:', err.message);
  }
}

// --- r0.15 (HR-1.5) — Boot-time backfill ----------------------------------
// One-time per database: for every active non-owner user, fill in the leave
// balance from their most recent hire-anniversary to today using the 1/mo →
// 1.5/mo accrual. Marks itself complete in system_state so it never re-runs.
// Safe to call on every boot — it self-guards.
async function runBackfillIfNeeded() {
  try {
    const flag = await db.query(
      `SELECT value FROM system_state WHERE key = 'hr15_backfill_done'`
    );
    if (flag.rows.length > 0 && flag.rows[0].value === 'true') {
      console.log('[leave-engine] backfill already complete, skipping');
      return { skipped: true };
    }
    const today = nowLondonDate();
    const users = await db.query(
      `SELECT u.id, u.hire_date FROM users u
        WHERE u.deleted_at IS NULL AND u.employment_status = 'active'
          AND u.hire_date IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_groups ug
            JOIN groups g ON g.id = ug.group_id
            WHERE ug.user_id = u.id AND g.slug = 'owner'
          )`
    );
    let processed = 0;
    for (const u of users.rows) {
      const joined = String(u.hire_date).slice(0, 10);
      const anniv = lastAnniversary(joined, today);
      // Months elapsed from current anniversary up to today (inclusive of months
      // whose anniversary-day has passed).
      const monthsSinceAnniv = monthsBetween(anniv, today);
      // Tenure at each accrual moment governs the rate. Sum:
      let totalDays = 0;
      const tenureAtAnniv = monthsBetween(joined, anniv);
      for (let m = 1; m <= monthsSinceAnniv; m++) {
        const tenureAtThisAccrual = tenureAtAnniv + m;
        totalDays += accrualRateForTenure(tenureAtThisAccrual);
      }
      const year = new Date().getUTCFullYear();
      // Upsert the leave_balances row for this employment year.
      await db.query(
        `INSERT INTO leave_balances
           (user_id, year, leave_year_start, entitled_days, carryover_days, taken_days, pending_days)
         VALUES ($1, $2, $3, $4, 0, COALESCE((SELECT taken_days FROM leave_balances WHERE user_id = $1 AND leave_year_start = $3), 0), COALESCE((SELECT pending_days FROM leave_balances WHERE user_id = $1 AND leave_year_start = $3), 0))
         ON CONFLICT (user_id, leave_year_start) DO UPDATE
           SET entitled_days = EXCLUDED.entitled_days, updated_at = NOW()`,
        [u.id, year, anniv, totalDays]
      );
      await db.query(
        `INSERT INTO leave_accrual_log
           (user_id, year, event_date, event_type, days_delta, tenure_months, note)
         VALUES ($1, $2, $3, 'backfill', $4, $5, $6)`,
        [u.id, year, today, totalDays, tenureAtAnniv + monthsSinceAnniv,
         `r0.15 backfill: anniversary ${anniv}, ${monthsSinceAnniv} months accrued = ${totalDays} days`]
      );
      processed++;
    }
    await db.query(
      `INSERT INTO system_state (key, value) VALUES ('hr15_backfill_done', 'true')
       ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`
    );
    console.log(`[leave-engine] backfill complete — processed ${processed} user(s)`);
    return { processed };
  } catch (err) {
    console.error('[leave-engine.runBackfillIfNeeded] failed:', err.message);
    return { error: err.message };
  }
}

// --- r0.15 (HR-1.5) — Retroactive weekend recompute -----------------------
// Re-evaluates weekend pay status for every Mon–Sun week that overlaps the
// given date range, for one user. Called whenever a leave is approved /
// cancelled / modified so past weekends correctly reflect the change.
async function recomputeWeekendPayForRange(userId, fromDateStr, toDateStr) {
  try {
    const from = new Date(fromDateStr + 'T00:00:00Z');
    const to = new Date(toDateStr + 'T00:00:00Z');
    if (isNaN(from) || isNaN(to)) return { error: 'bad dates' };
    // Walk the Mondays from the week containing `from` to the week containing `to`.
    const firstMonday = new Date(from);
    const fromDow = firstMonday.getUTCDay(); // 0=Sun
    const fromBack = fromDow === 0 ? 6 : (fromDow - 1);
    firstMonday.setUTCDate(firstMonday.getUTCDate() - fromBack);

    let weeks = 0;
    let cursor = new Date(firstMonday);
    while (cursor <= to) {
      const monday = cursor.toISOString().slice(0, 10);
      const sundayDate = new Date(cursor);
      sundayDate.setUTCDate(sundayDate.getUTCDate() + 6);
      const sunday = sundayDate.toISOString().slice(0, 10);
      const saturdayDate = new Date(cursor);
      saturdayDate.setUTCDate(saturdayDate.getUTCDate() + 5);
      const saturday = saturdayDate.toISOString().slice(0, 10);

      // Count qualifying days for the week (same rule as tickWeeklyWeekendPay)
      const attCount = await db.query(
        `SELECT COUNT(*)::int AS c
           FROM attendance_day
          WHERE user_id = $1
            AND for_date BETWEEN $2 AND $3
            AND (
              status IN ('on_time','late','very_late','worked_voluntary','off_holiday')
              OR (status = 'on_leave')
              OR (status = 'off_sick' AND sick_notified_hours >= 4)
            )`,
        [userId, monday, sunday]
      );
      const qualifying = Number(attCount.rows[0].c);
      const newStatus = qualifying >= 5 ? 'paid' : 'unpaid';

      for (const day of [saturday, sunday]) {
        const existing = await db.query(
          `SELECT id FROM attendance_day WHERE user_id = $1 AND for_date = $2`,
          [userId, day]
        );
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO attendance_day (user_id, for_date, status, weekend_pay_status, is_paid)
             VALUES ($1, $2, 'off_pattern', $3, $4)
             ON CONFLICT (user_id, for_date) DO NOTHING`,
            [userId, day, newStatus, newStatus === 'paid']
          );
        } else {
          await db.query(
            `UPDATE attendance_day
                SET weekend_pay_status = $1, is_paid = $2, updated_at = NOW()
              WHERE id = $3`,
            [newStatus, newStatus === 'paid', existing.rows[0].id]
          );
        }
      }
      weeks++;
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return { weeks };
  } catch (err) {
    console.error('[leave-engine.recomputeWeekendPayForRange] failed:', err.message);
    return { error: err.message };
  }
}

// --- Module exports -------------------------------------------------------

module.exports = {
  recomputeBalanceFor,
  adjustBalance,
  getBalance,
  tickMonthlyAccrual,
  tickWeeklyWeekendPay,
  runBackfillIfNeeded,
  recomputeWeekendPayForRange,
  lastAnniversary,
  accrualRateForTenure,
  monthsBetween,
};
