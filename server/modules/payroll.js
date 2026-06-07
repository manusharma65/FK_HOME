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

// ============================================================================
// PAYROLL GENERATION ENGINE (r0.45) — generate -> review -> approve -> publish
// India only. 60/30/10 split. Actual pro-rated by calendar days less LOP.
// Net = total earnings (actual) - total deductions. Snapshot frozen on publish.
// ============================================================================

const { notify } = require('../notify');
const leaveEngine = require('./leave-engine');

const COMPANY = {
  name: 'FK Enterprises',
  addr1: 'B-719 Tower B, 7th Floor Noida One, B-8 Sector 62,',
  addr2: 'Noida, Uttar Pradesh 201301',
  location: 'Noida',
};
const MONTHS = ['', 'January','February','March','April','May','June','July',
                'August','September','October','November','December'];

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function dateStr(d) {
  if (!d) return null;
  return (d instanceof Date) ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
function fmtDayMonYear(d) {
  const s = dateStr(d); if (!s) return '\u2014';
  const [y, m, dd] = s.split('-');
  const mon = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m)] || '';
  return `${dd} ${mon} ${y}`;
}

// INR amount formatted with Indian digit grouping + 2 decimals.
function fmtINR(n) {
  let v = Number(n) || 0;
  const neg = v < 0; v = Math.abs(v);
  const [intp, dec] = v.toFixed(2).split('.');
  const last3 = intp.length > 3 ? intp.slice(-3) : intp;
  let rest = intp.length > 3 ? intp.slice(0, -3) : '';
  if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + (rest ? rest + ',' + last3 : last3) + '.' + dec;
}

// Number to Indian-system words: "Rupees ... Only".
function inrInWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Rupees Zero Only';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
    'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two = (n) => n < 20 ? ones[n] : (tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : ''));
  const three = (n) => {
    const h = Math.floor(n/100), r = n%100;
    return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
  };
  const crore = Math.floor(num/10000000); num %= 10000000;
  const lakh = Math.floor(num/100000); num %= 100000;
  const thousand = Math.floor(num/1000); num %= 1000;
  const parts = [];
  if (crore)    parts.push(three(crore) + ' Crore');
  if (lakh)     parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (num)      parts.push(three(num));
  return 'Rupees ' + parts.join(' ').replace(/\s+/g, ' ').trim() + ' Only';
}

function splitSalary(gross) {
  const g = Math.round(Number(gross) || 0);
  const basic = Math.round(g * 0.6);
  const hra = Math.round(g * 0.3);
  const special = g - basic - hra;   // remainder so the three always sum to g
  return { basic, hra, special };
}

// Collect the LOP (unpaid) dates for a user in a month — mirrors rollupForUser's
// unpaid counting exactly, so a Sunday / day-off / holiday / approved paid leave
// is never treated as LOP.
async function lopDatesForUser(userId, range) {
  const att = await db.query(
    `SELECT for_date, status, is_paid, sick_notified_hours
       FROM attendance_day
      WHERE user_id = $1 AND for_date BETWEEN $2 AND $3
      ORDER BY for_date`,
    [userId, range.start, range.end]
  );
  const dates = [];
  for (const row of att.rows) {
    const s = row.status;
    let unpaid = false;
    if (row.is_paid === true) unpaid = false;
    else if (row.is_paid === false) unpaid = true;
    else if (['on_time','late','very_late','worked_voluntary','on_leave','off_holiday'].includes(s)) unpaid = false;
    else if (s === 'off_sick') unpaid = !(Number(row.sick_notified_hours) >= 4);
    else if (s === 'off_pattern' || s === 'off_cs_rota') unpaid = false; // no expectation
    else unpaid = false;
    if (unpaid) dates.push(dateStr(row.for_date));
  }
  return dates;
}

// Build the full snapshot object for one employee for one month.
// lopOverride (number) lets HR override the detected LOP during review.
// Days in the month the person was NOT yet on payroll (joined mid-month).
function nonEmployedDays(u, range) {
  if (!u.hire_date) return 0;
  const hd = dateStr(u.hire_date);
  const hy = +hd.slice(0, 4), hm = +hd.slice(5, 7), hday = +hd.slice(8, 10);
  if (hy > range.year || (hy === range.year && hm > range.month)) return Number(range.end.slice(8, 10)); // joined after this month
  if (hy === range.year && hm === range.month) return hday - 1;                                          // joined this month
  return 0;                                                                                              // joined earlier
}

async function buildSnapshot(u, salaryRow, range, lopOverride) {
  const calendarDays = Number(range.end.slice(8, 10));
  const nonEmp = nonEmployedDays(u, range);
  const employedDays = calendarDays - nonEmp;
  const lopDates = await lopDatesForUser(u.id, range);
  let lop = (lopOverride != null && lopOverride !== '') ? Number(lopOverride) : lopDates.length;
  lop = Math.max(0, Math.min(employedDays, lop));      // clamp 0..employed days

  const ctc = salaryRow ? Number(salaryRow.monthly_ctc) : 0;   // drawer is the source of truth
  const flagged = !salaryRow || !ctc;
  const flagNote = !salaryRow ? 'No salary on file — add it in the salary drawer' : (!ctc ? 'Salary is zero' : null);

  const master = splitSalary(ctc);
  const payDays = Math.max(0, employedDays - lop);
  const actualGross = (payDays >= calendarDays) ? ctc : Math.round(ctc * payDays / calendarDays);
  const actual = splitSalary(actualGross);

  const earnings = [
    { label: 'Basic (60%)',             master: master.basic,   actual: actual.basic },
    { label: 'HRA (30%)',               master: master.hra,     actual: actual.hra },
    { label: 'Special Allowance (10%)', master: master.special, actual: actual.special },
  ];
  const deductions = [];
  if (salaryRow) {
    for (const i of [1, 2, 3]) {
      const label = salaryRow['deduction_' + i + '_label'];
      const amt = Number(salaryRow['deduction_' + i + '_amount']) || 0;
      if (label && amt > 0) deductions.push({ label, actual: amt });
    }
  }
  const totalEarnMaster = master.basic + master.hra + master.special;
  const totalEarnActual = actualGross;
  const totalExtra = 0;                                // none at generation; HR adds in the editor
  const totalDeductions = deductions.reduce((s, d) => s + Number(d.actual || 0), 0);
  const net = totalEarnActual + totalExtra - totalDeductions;

  return {
    emp_name: u.display_name || u.full_name,
    emp_designation: null,
    emp_department: u.dept_name || null,
    emp_code: u.emp_id || null,
    emp_location: COMPANY.location,
    pf_no: null, pf_uan: null,
    bank_name: u.bank_name || null,
    bank_account: u.bank_account_number || null,
    pan: u.pan || null,
    doj: dateStr(u.hire_date),
    currency: (salaryRow && salaryRow.currency) || u.salary_currency || 'INR',
    monthly_ctc: ctc,
    calendar_days: calendarDays,
    employed_days: employedDays,
    lop_days: lop,
    paid_days: payDays,
    lop_dates: JSON.stringify(lopDates),
    earnings: JSON.stringify(earnings),
    extra_earnings: JSON.stringify([]),
    deductions: JSON.stringify(deductions),
    total_earn_master: totalEarnMaster,
    total_earn_actual: totalEarnActual,
    total_extra: totalExtra,
    total_deductions: totalDeductions,
    net_pay: net,
    net_in_words: inrInWords(net),
    flagged, flag_note: flagNote,
  };
}

// Gather eligible employees (active, non-owner, India/INR) + their salary row.
async function eligibleEmployees() {
  const users = await db.query(
    `SELECT u.id, u.full_name, u.display_name, u.hire_date, u.monthly_salary,
            u.salary_currency, u.emp_id, u.pan, u.bank_name, u.bank_account_number,
            (SELECT d.name FROM user_department_memberships m
              JOIN departments d ON d.id = m.department_id
              WHERE m.user_id = u.id AND m.deleted_at IS NULL AND m.is_primary = TRUE
              LIMIT 1) AS dept_name,
            EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug.group_id
                    WHERE ug.user_id = u.id AND g.slug = 'owner') AS is_owner
       FROM users u
      WHERE u.deleted_at IS NULL AND u.employment_status = 'active'
        AND COALESCE(u.salary_currency, 'INR') = 'INR'
      ORDER BY u.full_name`
  );
  const out = [];
  for (const u of users.rows) {
    if (u.is_owner) continue;                       // owner is not paid via payroll
    const s = await db.query(
      `SELECT monthly_ctc, currency,
              deduction_1_label, deduction_1_amount,
              deduction_2_label, deduction_2_amount,
              deduction_3_label, deduction_3_amount
         FROM salary_structures WHERE user_id = $1`, [u.id]);
    out.push({ user: u, salaryRow: s.rows[0] || null });
  }
  return out;
}

// Upsert a payslip snapshot into the payslips table (draft).
async function upsertPayslip(runId, userId, range, snap) {
  await db.query(
    `INSERT INTO payslips
       (run_id, user_id, year, month, emp_name, emp_designation, emp_department,
        emp_code, emp_location, pf_no, pf_uan, bank_name, bank_account, pan, doj,
        currency, monthly_ctc, calendar_days, employed_days, lop_days, paid_days, lop_dates,
        earnings, extra_earnings, deductions, total_earn_master, total_earn_actual,
        total_extra, total_deductions, net_pay, net_in_words, flagged, flag_note,
        held, status, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,FALSE,'draft',NOW())
     ON CONFLICT (run_id, user_id) DO UPDATE SET
        emp_name=EXCLUDED.emp_name, emp_designation=EXCLUDED.emp_designation,
        emp_department=EXCLUDED.emp_department, emp_code=EXCLUDED.emp_code,
        emp_location=EXCLUDED.emp_location, pf_no=EXCLUDED.pf_no, pf_uan=EXCLUDED.pf_uan,
        bank_name=EXCLUDED.bank_name, bank_account=EXCLUDED.bank_account, pan=EXCLUDED.pan,
        doj=EXCLUDED.doj, currency=EXCLUDED.currency, monthly_ctc=EXCLUDED.monthly_ctc,
        calendar_days=EXCLUDED.calendar_days, employed_days=EXCLUDED.employed_days,
        lop_days=EXCLUDED.lop_days, paid_days=EXCLUDED.paid_days, lop_dates=EXCLUDED.lop_dates,
        earnings=EXCLUDED.earnings, extra_earnings=EXCLUDED.extra_earnings, deductions=EXCLUDED.deductions,
        total_earn_master=EXCLUDED.total_earn_master, total_earn_actual=EXCLUDED.total_earn_actual,
        total_extra=EXCLUDED.total_extra, total_deductions=EXCLUDED.total_deductions,
        net_pay=EXCLUDED.net_pay, net_in_words=EXCLUDED.net_in_words,
        flagged=EXCLUDED.flagged, flag_note=EXCLUDED.flag_note,
        override_reason=NULL, overridden_by=NULL, overridden_at=NULL,
        held=FALSE, status='draft', generated_at=NOW()
     WHERE payslips.status <> 'published'`,
    [runId, userId, range.year, range.month, snap.emp_name, snap.emp_designation,
     snap.emp_department, snap.emp_code, snap.emp_location, snap.pf_no, snap.pf_uan,
     snap.bank_name, snap.bank_account, snap.pan, snap.doj, snap.currency,
     snap.monthly_ctc, snap.calendar_days, snap.employed_days, snap.lop_days, snap.paid_days, snap.lop_dates,
     snap.earnings, snap.extra_earnings, snap.deductions, snap.total_earn_master, snap.total_earn_actual,
     snap.total_extra, snap.total_deductions, snap.net_pay, snap.net_in_words, snap.flagged, snap.flag_note]
  );
}

// ---------- POST /api/payroll/run  { year, month } ----------
// Generate (or regenerate) a draft run for the period.
router.post('/run', requireSalary, async (req, res) => {
  const range = monthRange(req.body.year, req.body.month);
  if (!range) return res.status(400).json({ error: 'Bad year/month' });
  try {
    let run = (await db.query(
      `SELECT * FROM payroll_runs WHERE year = $1 AND month = $2`,
      [range.year, range.month])).rows[0];
    if (!run) {
      run = (await db.query(
        `INSERT INTO payroll_runs (year, month, status, created_by)
         VALUES ($1,$2,'draft',$3) RETURNING *`,
        [range.year, range.month, req.user.id])).rows[0];
    }
    const emps = await eligibleEmployees();
    let flaggedCount = 0;
    for (const { user, salaryRow } of emps) {
      const snap = await buildSnapshot(user, salaryRow, range);
      if (snap.flagged) flaggedCount++;
      await upsertPayslip(run.id, user.id, range, snap);
    }
    res.json({ ok: true, run_id: run.id, generated: emps.length, flagged: flaggedCount });
  } catch (err) {
    console.error('[payroll/run] error:', err);
    res.status(500).json({ error: 'Failed to generate payroll' });
  }
});

// ---------- GET /api/payroll/run?year=&month= ----------
// Fetch the run + payslips for the review screen.
router.get('/run', requireSalary, async (req, res) => {
  const range = monthRange(req.query.year, req.query.month);
  if (!range) return res.status(400).json({ error: 'Bad year/month' });
  try {
    const run = (await db.query(
      `SELECT r.*, (SELECT COALESCE(display_name, full_name) FROM users WHERE id = r.created_by) AS created_by_name,
              (SELECT COALESCE(display_name, full_name) FROM users WHERE id = r.approved_by) AS approved_by_name
         FROM payroll_runs r WHERE year = $1 AND month = $2`,
      [range.year, range.month])).rows[0] || null;
    if (!run) return res.json({ run: null, rows: [] });
    const ps = await db.query(
      `SELECT p.id, p.user_id, p.emp_name, p.emp_department, p.net_pay, p.total_earn_actual,
              p.total_extra, p.total_deductions, p.lop_days, p.lop_dates, p.calendar_days,
              p.employed_days, p.status, p.held, p.flagged, p.flag_note, p.override_reason,
              p.monthly_ctc, p.earnings, p.extra_earnings, p.deductions,
              u.initials, u.avatar_colour
         FROM payslips p JOIN users u ON u.id = p.user_id
        WHERE p.run_id = $1 ORDER BY p.emp_name`, [run.id]);
    // Attach leave balance + daily rate so the editor can offer leave encashment.
    for (const r of ps.rows) {
      const cd = Number(r.calendar_days) || 30;
      r.daily_rate = Math.round(Number(r.monthly_ctc || 0) / cd);
      try {
        const bal = await leaveEngine.getBalance(r.user_id);
        r.leave_remaining = bal && bal.remaining != null ? Number(bal.remaining) : 0;
      } catch (e) { r.leave_remaining = 0; }
    }
    res.json({ run, rows: ps.rows });
  } catch (err) {
    console.error('[payroll/run get] error:', err);
    res.status(500).json({ error: 'Failed to load run' });
  }
});

// ---------- PUT /api/payroll/payslip/:id/override ----------
// Full line editor: { lop_days, extra_earnings:[{label,amount,reason}],
//   deductions:[{label,amount,reason}], reason, publish:bool }
// Recomputes from the snapshot's CTC + calendar/employed days; editing holds the
// row (excluded from "publish all ready") unless publish:true is sent.
router.put('/payslip/:id/override', requireSalary, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = String(req.body.reason || '').trim();
  if (!id) return res.status(400).json({ error: 'Bad id' });
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  try {
    const p = (await db.query(`SELECT * FROM payslips WHERE id = $1`, [id])).rows[0];
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.status === 'published') return res.status(409).json({ error: 'This payslip is published. Revoke it first.' });

    const cd = Number(p.calendar_days);
    const employed = Number(p.employed_days != null ? p.employed_days : cd);
    const ctc = Number(p.monthly_ctc);
    let lop = Number(req.body.lop_days);
    if (!Number.isFinite(lop)) lop = Number(p.lop_days) || 0;
    lop = Math.max(0, Math.min(employed, lop));                 // clamp 0..employed days

    const payDays = Math.max(0, employed - lop);
    const gross = (payDays >= cd) ? ctc : Math.round(ctc * payDays / cd);
    const a = splitSalary(gross);
    const earnings = [
      { label: 'Basic (60%)',             master: Math.round(ctc * 0.6), actual: a.basic },
      { label: 'HRA (30%)',               master: Math.round(ctc * 0.3), actual: a.hra },
      { label: 'Special Allowance (10%)', master: ctc - Math.round(ctc * 0.6) - Math.round(ctc * 0.3), actual: a.special },
    ];

    const cleanLines = (arr) => (Array.isArray(arr) ? arr : [])
      .map(x => ({ label: String(x.label || '').trim(), amount: Math.round(Number(x.amount) || 0), reason: String(x.reason || '').trim() }))
      .filter(x => x.label && x.amount !== 0);
    const extra = cleanLines(req.body.extra_earnings);
    const deductions = cleanLines(req.body.deductions).map(d => ({ label: d.label, actual: d.amount, reason: d.reason }));

    const totalExtra = extra.reduce((s, e) => s + e.amount, 0);
    const totalDed = deductions.reduce((s, d) => s + Number(d.actual || 0), 0);
    const net = gross + totalExtra - totalDed;
    const publish = req.body.publish === true;

    await db.query(
      `UPDATE payslips SET lop_days=$1, paid_days=$2, earnings=$3, extra_earnings=$4, deductions=$5,
              total_earn_actual=$6, total_extra=$7, total_deductions=$8, net_pay=$9, net_in_words=$10,
              override_reason=$11, overridden_by=$12, overridden_at=NOW(),
              held = CASE WHEN $13 THEN FALSE ELSE TRUE END,
              status = CASE WHEN $13 THEN 'published' ELSE 'draft' END,
              published_at = CASE WHEN $13 THEN NOW() ELSE published_at END
        WHERE id=$14`,
      [lop, payDays, JSON.stringify(earnings), JSON.stringify(extra), JSON.stringify(deductions),
       gross, totalExtra, totalDed, net, inrInWords(net), reason, req.user.id, publish, id]);

    if (publish) {
      await notify({ userIds: [p.user_id], type: 'payslip.ready', title: 'Your payslip is ready',
        body: `Your payslip for ${MONTHS[p.month]} ${p.year} is now available in your Pay section.`,
        action_url: '/#me/profile?tab=pay', related_type: 'payslip' });
      await refreshRunStatus(p.run_id);
    }
    res.json({ ok: true, net_pay: net, negative: net < 0 });
  } catch (err) {
    console.error('[payroll/override] error:', err);
    res.status(500).json({ error: 'Failed to save changes' });
  }
});

// ---------- POST /api/payroll/payslip/:id/regenerate ----------
// Fix-at-source: recompute one payslip from current attendance.
router.post('/payslip/:id/regenerate', requireSalary, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const p = (await db.query(`SELECT * FROM payslips WHERE id = $1`, [id])).rows[0];
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.status === 'published') return res.status(409).json({ error: 'Published — revoke first.' });
    const range = monthRange(p.year, p.month);
    const u = (await db.query(
      `SELECT u.id, u.full_name, u.display_name, u.hire_date, u.monthly_salary,
              u.salary_currency, u.emp_id, u.pan, u.bank_name, u.bank_account_number,
              (SELECT d.name FROM user_department_memberships m JOIN departments d ON d.id=m.department_id
                WHERE m.user_id=u.id AND m.deleted_at IS NULL AND m.is_primary=TRUE LIMIT 1) AS dept_name
         FROM users u WHERE u.id = $1`, [p.user_id])).rows[0];
    const s = (await db.query(`SELECT * FROM salary_structures WHERE user_id = $1`, [p.user_id])).rows[0] || null;
    const snap = await buildSnapshot(u, s, range);
    await upsertPayslip(p.run_id, p.user_id, range, snap);
    res.json({ ok: true, net_pay: snap.net_pay });
  } catch (err) {
    console.error('[payroll/regenerate] error:', err);
    res.status(500).json({ error: 'Failed to regenerate' });
  }
});

// Mark the run 'approved' once every non-flagged payslip is published, else 'draft'.
async function refreshRunStatus(runId) {
  const left = (await db.query(
    `SELECT COUNT(*)::int AS n FROM payslips
       WHERE run_id=$1 AND status<>'published' AND flagged=FALSE`, [runId])).rows[0].n;
  if (left === 0) {
    await db.query(`UPDATE payroll_runs SET status='approved', approved_at=NOW() WHERE id=$1`, [runId]);
  } else {
    await db.query(`UPDATE payroll_runs SET status='draft', approved_at=NULL, approved_by=NULL WHERE id=$1`, [runId]);
  }
}

// ---------- POST /api/payroll/run/:id/publish-ready ----------
// Publish every payslip that is ready: draft, not held, not flagged. Notify each.
router.post('/run/:id/publish-ready', requireSalary, async (req, res) => {
  const runId = parseInt(req.params.id, 10);
  try {
    const run = (await db.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId])).rows[0];
    if (!run) return res.status(404).json({ error: 'Not found' });
    const published = await db.query(
      `UPDATE payslips SET status='published', published_at=NOW(), held=FALSE
        WHERE run_id=$1 AND status='draft' AND held=FALSE AND flagged=FALSE
        RETURNING user_id`, [runId]);
    if (published.rows.length > 0) {
      await db.query(`UPDATE payroll_runs SET approved_by=$1 WHERE id=$2`, [req.user.id, runId]);
    }
    const period = `${MONTHS[run.month]} ${run.year}`;
    for (const row of published.rows) {
      await notify({ userIds: [row.user_id], type: 'payslip.ready', title: 'Your payslip is ready',
        body: `Your payslip for ${period} is now available in your Pay section.`,
        action_url: '/#me/profile?tab=pay', related_type: 'payslip' });
    }
    await refreshRunStatus(runId);
    res.json({ ok: true, published: published.rows.length });
  } catch (err) {
    console.error('[payroll/publish-ready] error:', err);
    res.status(500).json({ error: 'Failed to publish' });
  }
});

// ---------- POST /api/payroll/payslip/:id/revoke  { reason } ----------
router.post('/payslip/:id/revoke', requireSalary, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  try {
    const p = (await db.query(`SELECT status FROM payslips WHERE id = $1`, [id])).rows[0];
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.status !== 'published') return res.status(409).json({ error: 'Only published payslips can be revoked' });
    await db.query(
      `UPDATE payslips SET status='revoked', revoked_at=NOW(), revoke_reason=$1, revoked_by=$2 WHERE id=$3`,
      [reason, req.user.id, id]);
    const pr = (await db.query(`SELECT run_id FROM payslips WHERE id = $1`, [id])).rows[0];
    if (pr) await refreshRunStatus(pr.run_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[payroll/revoke] error:', err);
    res.status(500).json({ error: 'Failed to revoke' });
  }
});

// ---------- POST /api/payroll/payslip/:id/publish ----------
// Re-publish a single payslip after a fix (revoke -> fix -> reissue loop).
router.post('/payslip/:id/publish', requireSalary, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const p = (await db.query(`SELECT * FROM payslips WHERE id = $1`, [id])).rows[0];
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.status === 'published') return res.status(409).json({ error: 'Already published' });
    await db.query(
      `UPDATE payslips SET status='published', published_at=NOW(), held=FALSE,
              revoked_at=NULL, revoke_reason=NULL, revoked_by=NULL WHERE id=$1`, [id]);
    await refreshRunStatus(p.run_id);
    await notify({
      userIds: [p.user_id],
      type: 'payslip.ready',
      title: 'Your payslip is ready',
      body: `Your payslip for ${MONTHS[p.month]} ${p.year} is now available in your Pay section.`,
      action_url: '/#me/profile?tab=pay',
      related_type: 'payslip',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[payroll/publish] error:', err);
    res.status(500).json({ error: 'Failed to publish' });
  }
});

// ---------- GET /api/payroll/user/:userId  — published payslips for a user ----------
// Visible to the person themselves, or Owner/HR (salary.view).
router.get('/user/:userId', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const userId = parseInt(req.params.userId, 10);
  if (!userId) return res.status(400).json({ error: 'Bad userId' });
  const isSelf = req.user.id === userId;
  if (!isSelf && !req.user.can('profile.salary.view')) return res.status(403).json({ error: 'Permission denied' });
  try {
    const r = await db.query(
      `SELECT id, year, month, net_pay, published_at
         FROM payslips WHERE user_id = $1 AND status = 'published'
        ORDER BY year DESC, month DESC`, [userId]);
    res.json({ payslips: r.rows.map(p => ({
      id: p.id, year: p.year, month: p.month, net_pay: p.net_pay,
      label: `${MONTHS[p.month]} ${p.year}`, published_at: p.published_at,
    })) });
  } catch (err) {
    console.error('[payroll/user] error:', err);
    res.status(500).json({ error: 'Failed to load payslips' });
  }
});

// ---------- GET /api/payroll/payslip/:id/html — the rendered payslip ----------
// Owner/HR can view any (for preview); an employee can view their own published one.
router.get('/payslip/:id/html', async (req, res) => {
  if (!req.user) return res.status(401).send('Not signed in');
  const id = parseInt(req.params.id, 10);
  try {
    const p = (await db.query(`SELECT * FROM payslips WHERE id = $1`, [id])).rows[0];
    if (!p) return res.status(404).send('Not found');
    const isSelf = req.user.id === p.user_id;
    const isHr = req.user.can('profile.salary.view');
    if (!isHr && !(isSelf && p.status === 'published')) return res.status(403).send('Permission denied');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPayslipHtml(p));
  } catch (err) {
    console.error('[payroll/html] error:', err);
    res.status(500).send('Failed to render payslip');
  }
});

// Render the approved payslip design from a stored snapshot row.
function renderPayslipHtml(p) {
  const period = `${MONTHS[p.month]} ${p.year}`;
  const earnings = Array.isArray(p.earnings) ? p.earnings : [];
  const extra = Array.isArray(p.extra_earnings) ? p.extra_earnings : [];
  const deductions = Array.isArray(p.deductions) ? p.deductions : [];
  const v = (x) => (x == null || x === '') ? '\u2014' : escHtml(x);
  let earnRows = earnings.map(e =>
    `<tr><td>${escHtml(e.label)}</td><td class="num">${fmtINR(e.master)}</td><td class="num">${fmtINR(e.actual)}</td></tr>`
  ).join('');
  earnRows += extra.map(e =>
    `<tr><td>${escHtml(e.label)}</td><td class="num">&mdash;</td><td class="num">${fmtINR(e.amount)}</td></tr>`
  ).join('');
  const totalEarnActual = Number(p.total_earn_actual || 0) + Number(p.total_extra || 0);
  let dedRows;
  if (deductions.length) {
    dedRows = deductions.map(d =>
      `<tr><td>${escHtml(d.label)}</td><td class="num">${fmtINR(d.actual)}</td></tr>`).join('');
    while (deductions.length + (dedRows.match(/<tr>/g) || []).length < 3) break;
  } else {
    dedRows = `<tr><td class="empty">No deductions</td><td class="num">&mdash;</td></tr>`;
  }
  // pad deduction rows up to 3 for visual balance with the earnings pane
  const dedCount = deductions.length || 1;
  let pad = '';
  for (let i = dedCount; i < 3; i++) pad += `<tr><td>&nbsp;</td><td class="num"></td></tr>`;
  const banner = (p.status === 'draft')
    ? `<div style="background:#FFF7E6;border:1px solid #F2D88A;color:#8A6D1F;font-size:11px;padding:8px 14px;border-radius:6px;margin-bottom:14px;text-align:center">DRAFT — not yet approved or published</div>`
    : (p.status === 'revoked')
    ? `<div style="background:#FDEDED;border:1px solid #F2B8B8;color:#9B2C2C;font-size:11px;padding:8px 14px;border-radius:6px;margin-bottom:14px;text-align:center">REVOKED</div>`
    : '';

  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escHtml(COMPANY.name)} — Payslip ${escHtml(period)}</title>
<style>
  :root{ --ink:#1A1C22; --muted:#6B6F76; --line:#E2E4E8; --orange:#E8722B; --tint:#FCF1E8; }
  *{box-sizing:border-box} html,body{margin:0}
  body{background:#73767D;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       color:var(--ink);padding:28px 14px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{width:794px;max-width:100%;margin:0 auto;background:#fff;padding:38px 42px 34px;box-shadow:0 16px 46px rgba(0,0,0,.30)}
  .top{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:16px}
  .top img{height:60px;width:auto;display:block}
  .top .co{text-align:right}
  .top .co h1{margin:0;font-size:20px;font-weight:700}
  .top .co p{margin:4px 0 0;font-size:11px;color:var(--muted);line-height:1.55;max-width:320px;margin-left:auto}
  .rule{height:3px;background:var(--orange);border-radius:2px}
  .title{text-align:center;font-size:15px;font-weight:600;letter-spacing:.02em;margin:18px 0 20px}
  .title span{color:var(--muted);font-weight:500}
  .meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .meta .c:first-child{border-right:1px solid var(--line)}
  .meta .row{display:flex;justify-content:space-between;gap:10px;padding:8px 14px;font-size:12px;border-bottom:1px solid var(--line)}
  .meta .c .row:last-child{border-bottom:none}
  .meta .k{color:var(--muted)} .meta .v{font-weight:600;text-align:right}
  .tables{display:grid;grid-template-columns:1.35fr 1fr;margin-top:18px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .tables .pane:first-child{border-right:1px solid var(--line)}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#F6F7F9;text-align:left;padding:9px 14px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom:1px solid var(--line)}
  th.num{text-align:right}
  td{padding:8px 14px;border-bottom:1px solid var(--line)}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  tfoot td{font-weight:700;background:#FAFBFC;border-top:1px solid var(--ink);border-bottom:none}
  .empty{color:#A6A9AF}
  .net{margin-top:18px;display:flex;justify-content:space-between;align-items:center;background:var(--tint);
       border:1px solid #F0CFB4;border-left:4px solid var(--orange);border-radius:8px;padding:15px 20px}
  .net .lbl{font-size:12px;color:var(--muted)} .net .words{font-size:12px;font-style:italic;margin-top:3px}
  .net .amt{font-size:23px;font-weight:800}
  .foot{margin-top:22px;border-top:1px solid var(--line);padding-top:12px;text-align:center;color:#9A9DA3;font-size:10.5px;line-height:1.7}
  @media print{ @page{size:A4;margin:12mm} body{background:#fff;padding:0} .sheet{box-shadow:none;width:auto;max-width:none;padding:0} }
</style></head><body>
  <div class="sheet">
    ${banner}
    <div class="top">
      <img src="/assets/payslip-logo.png" alt="${escHtml(COMPANY.name)}"/>
      <div class="co"><h1>${escHtml(COMPANY.name)}</h1>
        <p>${escHtml(COMPANY.addr1)}<br/>${escHtml(COMPANY.addr2)}</p></div>
    </div>
    <div class="rule"></div>
    <div class="title">Payslip <span>for the month of</span> ${escHtml(period)}</div>
    <div class="meta">
      <div class="c">
        <div class="row"><span class="k">Name</span><span class="v">${v(p.emp_name)}</span></div>
        <div class="row"><span class="k">Designation</span><span class="v">${v(p.emp_designation)}</span></div>
        <div class="row"><span class="k">Department</span><span class="v">${v(p.emp_department)}</span></div>
        <div class="row"><span class="k">Location</span><span class="v">${v(p.emp_location)}</span></div>
        <div class="row"><span class="k">Joining Date</span><span class="v">${fmtDayMonYear(p.doj)}</span></div>
        <div class="row"><span class="k">Effective Work Days</span><span class="v">${escHtml(p.employed_days != null ? p.employed_days : p.calendar_days)}</span></div>
        <div class="row"><span class="k">LOP</span><span class="v">${escHtml(p.lop_days)}</span></div>
      </div>
      <div class="c">
        <div class="row"><span class="k">Employee No</span><span class="v">${v(p.emp_code)}</span></div>
        <div class="row"><span class="k">Bank Name</span><span class="v">${v(p.bank_name)}</span></div>
        <div class="row"><span class="k">Bank A/C No</span><span class="v">${v(p.bank_account)}</span></div>
        <div class="row"><span class="k">PAN</span><span class="v">${v(p.pan)}</span></div>
        <div class="row"><span class="k">PF No</span><span class="v">${v(p.pf_no)}</span></div>
        <div class="row"><span class="k">PF UAN</span><span class="v">${v(p.pf_uan)}</span></div>
        <div class="row"><span class="k">Currency</span><span class="v">${escHtml(p.currency)} (&#8377;)</span></div>
      </div>
    </div>
    <div class="tables">
      <div class="pane"><table>
        <thead><tr><th>Earnings</th><th class="num">Master</th><th class="num">Actual</th></tr></thead>
        <tbody>${earnRows}</tbody>
        <tfoot><tr><td>Total Earnings</td><td class="num">${fmtINR(p.total_earn_master)}</td><td class="num">${fmtINR(totalEarnActual)}</td></tr></tfoot>
      </table></div>
      <div class="pane"><table>
        <thead><tr><th>Deductions</th><th class="num">Actual</th></tr></thead>
        <tbody>${dedRows}${pad}</tbody>
        <tfoot><tr><td>Total Deductions</td><td class="num">${fmtINR(p.total_deductions)}</td></tr></tfoot>
      </table></div>
    </div>
    <div class="net">
      <div><div class="lbl">Net Pay for ${escHtml(period)}</div><div class="words">${escHtml(p.net_in_words)}</div></div>
      <div class="amt">&#8377; ${fmtINR(p.net_pay)}</div>
    </div>
    <div class="foot">This is a system-generated payslip and does not require a signature.<br/>Generated ${fmtDayMonYear(p.generated_at)} &middot; FK Home</div>
  </div>
</body></html>`;
}

module.exports = router;
// Exposed for tests / reuse (router stays the primary export).
module.exports.inrInWords = inrInWords;
module.exports.splitSalary = splitSalary;
module.exports.fmtINR = fmtINR;
module.exports.renderPayslipHtml = renderPayslipHtml;
