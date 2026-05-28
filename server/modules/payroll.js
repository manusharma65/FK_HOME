// FK Home — Payroll module (r0.15, HR-1.5)
// ----------------------------------------------------------------------------
// Endpoints (all gated on profile.salary.view — Owner + HR only):
//   GET /api/payroll/month?year=2026&month=5      monthly rollup, every employee
//   GET /api/payroll/month/:userId/days?year=&month=   day-by-day drill
//   GET /api/payroll/month.csv?year=&month=       CSV download
// ----------------------------------------------------------------------------

const express = require('express');
const { db } = require('../db');

const router = express.Router();

function requireSalary(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.user.can('profile.salary.view')) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  next();
}

function pad2(n) { return String(n).padStart(2, '0'); }
function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const start = `${y}-${pad2(m)}-01`;
  // Last day of month
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${pad2(m)}-${pad2(last)}`;
  return { start, end, year: y, month: m };
}

// Per-user month rollup (computed from attendance_day + leave_requests).
async function rollupForUser(userId, range) {
  const att = await db.query(
    `SELECT for_date, status, is_paid, weekend_pay_status, sick_notified_hours, late_minutes
       FROM attendance_day
      WHERE user_id = $1 AND for_date BETWEEN $2 AND $3`,
    [userId, range.start, range.end]
  );
  let paid = 0, unpaid = 0;
  let annualLeave = 0;
  let sickPaid = 0, sickUnpaid = 0;
  let lateCount = 0;
  let weekendsPaid = 0, weekendsUnpaid = 0;
  for (const row of att.rows) {
    const s = row.status;
    const dow = new Date(row.for_date).getUTCDay(); // 0=Sun, 6=Sat
    const isWeekend = (dow === 0 || dow === 6);
    // Paid / unpaid counts (use the is_paid flag if set, else infer from status)
    if (row.is_paid === true) paid++;
    else if (row.is_paid === false) unpaid++;
    else if (['on_time','late','very_late','worked_voluntary','on_leave','off_holiday'].includes(s)) paid++;
    else if (s === 'off_sick') {
      if (Number(row.sick_notified_hours) >= 4) paid++; else unpaid++;
    } else if (s === 'off_pattern' || s === 'off_cs_rota') {
      // weekend-flag covers this; non-weekend "off_pattern" = neither paid nor unpaid (no expectation)
    }
    // Specific category counts
    if (s === 'on_leave') annualLeave++;
    if (s === 'off_sick') {
      if (Number(row.sick_notified_hours) >= 4) sickPaid++; else sickUnpaid++;
    }
    if (s === 'late' || s === 'very_late' || Number(row.late_minutes) > 0) lateCount++;
    if (isWeekend) {
      if (row.weekend_pay_status === 'paid') weekendsPaid++;
      else if (row.weekend_pay_status === 'unpaid') weekendsUnpaid++;
    }
  }
  // Count number of weekend pairs in the month for the "X of Y paid" pill.
  // Easier: weekendsPaid + weekendsUnpaid is the total weekend-days with a status.
  // Pair them up: most weeks have Sat+Sun both flagged.
  const weekendDays = weekendsPaid + weekendsUnpaid;
  const weekendPairs = Math.round(weekendDays / 2);
  const weekendPairsPaid = Math.round(weekendsPaid / 2);
  return {
    paid_days: paid,
    unpaid_days: unpaid,
    annual_leave: annualLeave,
    sick_paid: sickPaid,
    sick_unpaid: sickUnpaid,
    late_count: lateCount,
    weekend_pairs_total: weekendPairs,
    weekend_pairs_paid: weekendPairsPaid,
  };
}

// GET /api/payroll/month?year=&month=
router.get('/month', requireSalary, async (req, res) => {
  const range = monthRange(req.query.year, req.query.month);
  if (!range) return res.status(400).json({ error: 'Bad year/month' });
  try {
    const users = await db.query(
      `SELECT u.id, u.full_name, u.display_name, u.initials, u.avatar_colour,
              u.hire_date, u.monthly_salary,
              (SELECT d.name FROM user_department_memberships m
                JOIN departments d ON d.id = m.department_id
                WHERE m.user_id = u.id AND m.deleted_at IS NULL AND m.is_primary = TRUE
                LIMIT 1) AS dept_name,
              EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug.group_id
                WHERE ug.user_id = u.id AND g.slug = 'owner'
              ) AS is_owner
         FROM users u
        WHERE u.deleted_at IS NULL AND u.employment_status = 'active'
        ORDER BY u.full_name`
    );
    const rows = [];
    for (const u of users.rows) {
      if (u.is_owner) {
        rows.push({
          user_id: u.id, name: u.display_name || u.full_name, initials: u.initials,
          avatar_colour: u.avatar_colour, dept_name: u.dept_name || '—',
          hire_date: u.hire_date, monthly_salary: null, is_owner: true,
          paid_days: null, unpaid_days: null, annual_leave: null,
          sick_paid: null, sick_unpaid: null, late_count: null,
          weekend_pairs_total: null, weekend_pairs_paid: null,
        });
        continue;
      }
      const r = await rollupForUser(u.id, range);
      rows.push({
        user_id: u.id, name: u.display_name || u.full_name, initials: u.initials,
        avatar_colour: u.avatar_colour, dept_name: u.dept_name || '—',
        hire_date: u.hire_date, monthly_salary: u.monthly_salary,
        is_owner: false, ...r,
      });
    }
    // Totals (excluding owner)
    const totals = rows.filter(r => !r.is_owner).reduce((acc, r) => ({
      paid_days: acc.paid_days + (r.paid_days || 0),
      unpaid_days: acc.unpaid_days + (r.unpaid_days || 0),
      weekends_unpaid: acc.weekends_unpaid + ((r.weekend_pairs_total || 0) - (r.weekend_pairs_paid || 0)),
    }), { paid_days: 0, unpaid_days: 0, weekends_unpaid: 0 });
    res.json({
      year: range.year, month: range.month, start: range.start, end: range.end,
      employees: rows.filter(r => !r.is_owner).length,
      totals, rows,
    });
  } catch (err) {
    console.error('[payroll/month] error:', err);
    res.status(500).json({ error: 'Failed to load payroll' });
  }
});

// GET /api/payroll/month/:userId/days?year=&month=
router.get('/month/:userId/days', requireSalary, async (req, res) => {
  const range = monthRange(req.query.year, req.query.month);
  if (!range) return res.status(400).json({ error: 'Bad year/month' });
  const userId = parseInt(req.params.userId, 10);
  if (!userId) return res.status(400).json({ error: 'Bad userId' });
  try {
    const u = await db.query(
      `SELECT id, full_name, display_name FROM users WHERE id = $1`, [userId]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const days = await db.query(
      `SELECT for_date, status, is_paid, weekend_pay_status,
              first_login, late_minutes, sick_notified_hours, active_minutes
         FROM attendance_day
        WHERE user_id = $1 AND for_date BETWEEN $2 AND $3
        ORDER BY for_date`,
      [userId, range.start, range.end]
    );
    res.json({
      user: { id: u.rows[0].id, name: u.rows[0].display_name || u.rows[0].full_name },
      year: range.year, month: range.month,
      days: days.rows,
    });
  } catch (err) {
    console.error('[payroll/days] error:', err);
    res.status(500).json({ error: 'Failed to load drill' });
  }
});

// GET /api/payroll/month.csv?year=&month=
router.get('/month.csv', requireSalary, async (req, res) => {
  const range = monthRange(req.query.year, req.query.month);
  if (!range) return res.status(400).json({ error: 'Bad year/month' });
  try {
    // Reuse the rollup
    const users = await db.query(
      `SELECT u.id, u.full_name, u.display_name, u.hire_date, u.monthly_salary,
              (SELECT d.name FROM user_department_memberships m
                JOIN departments d ON d.id = m.department_id
                WHERE m.user_id = u.id AND m.deleted_at IS NULL AND m.is_primary = TRUE
                LIMIT 1) AS dept_name,
              EXISTS (SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug.group_id
                WHERE ug.user_id = u.id AND g.slug = 'owner') AS is_owner
         FROM users u
        WHERE u.deleted_at IS NULL AND u.employment_status = 'active'
        ORDER BY u.full_name`
    );
    const lines = [
      ['Name','Department','Hire date','Monthly salary','Paid days','Unpaid days',
       'Annual leave','Sick (paid)','Sick (unpaid)','Late count',
       'Weekends paid','Weekends total'].join(',')
    ];
    for (const u of users.rows) {
      const name = (u.display_name || u.full_name || '').replace(/"/g, '""');
      const dept = (u.dept_name || '').replace(/"/g, '""');
      const hire = u.hire_date ? String(u.hire_date).slice(0, 10) : '';
      if (u.is_owner) {
        lines.push([`"${name}"`, `"${dept}"`, hire, '', 'n/a','n/a','n/a','n/a','n/a','n/a','n/a','n/a'].join(','));
        continue;
      }
      const r = await rollupForUser(u.id, range);
      lines.push([
        `"${name}"`, `"${dept}"`, hire,
        u.monthly_salary != null ? u.monthly_salary : '',
        r.paid_days, r.unpaid_days, r.annual_leave,
        r.sick_paid, r.sick_unpaid, r.late_count,
        r.weekend_pairs_paid, r.weekend_pairs_total,
      ].join(','));
    }
    const csv = lines.join('\n');
    const filename = `payroll-${range.year}-${pad2(range.month)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[payroll/csv] error:', err);
    res.status(500).json({ error: 'Failed to build CSV' });
  }
});

module.exports = router;
