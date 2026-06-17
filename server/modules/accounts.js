// FK Home — Accounts module (FK Enterprises India books)
// ---------------------------------------------------------------------------
// Internal bookkeeping for FK Enterprises (the India entity that bills FK Sports
// UK). Base currency INR; GBP invoices booked to INR at a captured rate. The UI
// speaks bills/invoices/reconcile — never debits/credits — but every posting
// writes balanced journal lines here so the trial balance, P&L and balance
// sheet are real and the CA gets clean registers.
//
// Safety model (matches what Bobby locked): records are never silently deleted.
//   draft  -> editable/voidable freely, NOT in the books yet (no journal)
//   posted -> in the ledger; "undo" = a dated REVERSAL, history preserved
//   filed  -> period locked; corrections post into the current open month only
// The DB enforces both balance (deferred trigger) and the lock (insert trigger);
// this layer enforces them too and fails fast with a readable message.
// ---------------------------------------------------------------------------

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { db } = require('../db');
const { requireAuth, requirePermission, logAudit } = require('../auth');

const sha = (x) => crypto.createHash('sha1').update(x).digest('hex');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router();
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const period = (d) => String(d).slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'

// ===========================================================================
// Chart of accounts
// ===========================================================================
// Services-company flavour. system_tag is how the engine finds control
// accounts — names can be renamed in the UI without breaking posting.
const DEFAULT_COA = [
  // assets
  { code: '1000', name: 'IDFC current account', type: 'asset', tag: 'idfc_bank', sort: 10 },
  { code: '1100', name: 'Accounts receivable', type: 'asset', tag: 'accounts_receivable', sort: 20 },
  { code: '1200', name: 'Input GST', type: 'asset', tag: 'input_gst', sort: 30 },
  // liabilities
  { code: '2000', name: 'Accounts payable', type: 'liability', tag: 'accounts_payable', sort: 40 },
  { code: '2100', name: 'Output GST', type: 'liability', tag: 'output_gst', sort: 50 },
  { code: '2200', name: 'TDS payable', type: 'liability', tag: 'tds_payable', sort: 60 },
  // equity
  { code: '3000', name: "Owner's capital", type: 'equity', tag: 'owner_capital', sort: 70 },
  { code: '3100', name: 'Retained earnings', type: 'equity', tag: 'retained_earnings', sort: 80 },
  { code: '3900', name: 'Opening balance equity', type: 'equity', tag: 'opening_balance_equity', sort: 90 },
  // income
  { code: '4000', name: 'Sales — services', type: 'income', tag: 'sales', sort: 100 },
  { code: '4900', name: 'FX gain / loss', type: 'income', tag: 'fx_gain_loss', sort: 110 },
  // expenses (editable / extendable in the UI)
  { code: '5000', name: 'Purchases / cost of services', type: 'expense', tag: 'purchases', sort: 120 },
  { code: '5100', name: 'Salaries', type: 'expense', tag: null, sort: 130 },
  { code: '5200', name: 'Rent', type: 'expense', tag: null, sort: 140 },
  { code: '5300', name: 'Software & subscriptions', type: 'expense', tag: null, sort: 150 },
  { code: '5400', name: 'Freight & courier', type: 'expense', tag: null, sort: 160 },
  { code: '5500', name: 'Professional fees', type: 'expense', tag: null, sort: 170 },
  { code: '5900', name: 'Other expenses', type: 'expense', tag: null, sort: 180 },
];

async function seedChartOfAccounts(conn = db) {
  for (const a of DEFAULT_COA) {
    await conn.query(
      `INSERT INTO acc_account (code, name, type, system_tag, sort)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO NOTHING`,
      [a.code, a.name, a.type, a.tag, a.sort]
    );
  }
}

async function accountIdByTag(client, tag) {
  const r = await client.query('SELECT id FROM acc_account WHERE system_tag = $1', [tag]);
  if (!r.rows.length) throw new Error(`acc: missing control account for tag '${tag}'`);
  return r.rows[0].id;
}

// ===========================================================================
// Core posting — the one funnel everything goes through
// ===========================================================================
// lines: [{ account_id|tag, debit, credit, memo?, currency?, fx_rate?, orig_amount? }]
async function postJournal(client, j) {
  const lines = [];
  let totalD = 0, totalC = 0;
  for (const ln of j.lines) {
    const debit = r2(ln.debit || 0);
    const credit = r2(ln.credit || 0);
    if (debit === 0 && credit === 0) continue;           // skip zero lines (e.g. gst=0)
    if (debit > 0 && credit > 0) throw new Error('acc: a line cannot be both debit and credit');
    const accId = ln.account_id || await accountIdByTag(client, ln.tag);
    lines.push({ accId, debit, credit, memo: ln.memo || null,
      currency: ln.currency || 'INR', fx_rate: ln.fx_rate || null, orig_amount: ln.orig_amount || null });
    totalD = r2(totalD + debit);
    totalC = r2(totalC + credit);
  }
  if (lines.length < 2) throw new Error('acc: a journal needs at least two lines');
  if (totalD !== totalC) throw new Error(`acc: journal does not balance (debits=${totalD}, credits=${totalC})`);

  const jr = await client.query(
    `INSERT INTO acc_journal (entry_date, narration, source_type, source_id, status, reverses_journal_id, created_by, contact_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [j.entry_date, j.narration || null, j.source_type, j.source_id || null,
     j.status || 'posted', j.reverses_journal_id || null, j.created_by || null, j.contact_id || null]
  );
  const journalId = jr.rows[0].id;
  for (const ln of lines) {
    await client.query(
      `INSERT INTO acc_journal_line (journal_id, account_id, debit, credit, memo, currency, fx_rate, orig_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [journalId, ln.accId, ln.debit, ln.credit, ln.memo, ln.currency, ln.fx_rate, ln.orig_amount]
    );
  }
  return journalId;
}

// ===========================================================================
// Bills
// ===========================================================================
function computeBill(d) {
  const taxable = r2(d.taxable_amount);
  const gst = r2(d.gst_amount != null ? d.gst_amount : taxable * (Number(d.gst_rate || 0) / 100));
  const tds = r2(d.tds_amount != null ? d.tds_amount : taxable * (Number(d.tds_rate || 0) / 100));
  const net = r2(taxable + gst - tds);
  return { taxable, gst, tds, net };
}

async function createBill(conn, d) {
  const { taxable, gst, tds, net } = computeBill(d);
  const r = await conn.query(
    `INSERT INTO acc_bill
       (contact_id, bill_date, due_date, category_account_id, currency, fx_rate,
        taxable_amount, gst_rate, gst_amount, tds_section, tds_rate, tds_amount,
        net_payable, status, pdf_file_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$16)
     RETURNING *`,
    [d.contact_id || null, d.bill_date, d.due_date || null, d.category_account_id || null,
     d.currency || 'INR', d.fx_rate || 1, taxable, d.gst_rate || 0, gst,
     d.tds_section || null, d.tds_rate || 0, tds, net, d.pdf_file_id || null,
     d.notes || null, d.created_by || null]
  );
  return r.rows[0];
}

// Post a draft bill to the ledger. Lines (all * fx_rate -> INR):
//   Dr expense        taxable
//   Dr input GST      gst
//   Cr TDS payable    tds
//   Cr accounts payable  net (= taxable + gst - tds)
async function postBill(client, billId, userId) {
  const br = await client.query('SELECT * FROM acc_bill WHERE id = $1 FOR UPDATE', [billId]);
  if (!br.rows.length) throw new Error('acc: bill not found');
  const b = br.rows[0];
  if (b.status !== 'draft') throw new Error(`acc: bill is ${b.status}, only a draft can be posted`);
  const fx = Number(b.fx_rate) || 1;
  const expenseAcc = b.category_account_id || await accountIdByTag(client, 'purchases');

  const lines = [
    { account_id: expenseAcc, debit: Number(b.taxable_amount) * fx, memo: 'Bill ' + billId },
    { tag: 'input_gst', debit: Number(b.gst_amount) * fx },
    { tag: 'tds_payable', credit: Number(b.tds_amount) * fx },
    { tag: 'accounts_payable', credit: Number(b.net_payable) * fx },
  ];
  const journalId = await postJournal(client, {
    entry_date: String(b.bill_date).slice(0, 10),
    narration: 'Purchase bill #' + billId,
    source_type: 'bill', source_id: billId, created_by: userId, contact_id: b.contact_id || null, lines,
  });
  await client.query(
    `UPDATE acc_bill SET status='posted', journal_id=$2, posted_at=NOW() WHERE id=$1`,
    [billId, journalId]
  );
  return journalId;
}

// ===========================================================================
// Invoices
// ===========================================================================
async function createInvoice(conn, d) {
  const taxable = r2(d.taxable_amount);
  const gst = d.tax_treatment === 'domestic_gst'
    ? r2(d.gst_amount != null ? d.gst_amount : taxable * (Number(d.gst_rate || 0) / 100)) : 0;
  const fx = Number(d.fx_rate || 1);
  const amountInr = r2((taxable + gst) * fx);
  const r = await conn.query(
    `INSERT INTO acc_invoice
       (contact_id, invoice_date, due_date, tax_treatment, currency, fx_rate,
        taxable_amount, gst_rate, gst_amount, amount_inr, status, pdf_file_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13)
     RETURNING *`,
    [d.contact_id || null, d.invoice_date, d.due_date || null, d.tax_treatment || 'export_zero',
     d.currency || 'INR', fx, taxable, d.gst_rate || 0, gst, amountInr,
     d.pdf_file_id || null, d.notes || null, d.created_by || null]
  );
  return r.rows[0];
}

// Post a draft invoice. Export (zero-rated): Dr AR / Cr Sales. Domestic:
//   Dr AR (taxable+gst) ; Cr Sales taxable ; Cr Output GST gst   (all * fx)
async function postInvoice(client, invoiceId, userId) {
  const ir = await client.query('SELECT * FROM acc_invoice WHERE id = $1 FOR UPDATE', [invoiceId]);
  if (!ir.rows.length) throw new Error('acc: invoice not found');
  const inv = ir.rows[0];
  if (inv.status !== 'draft') throw new Error(`acc: invoice is ${inv.status}, only a draft can be posted`);
  const fx = Number(inv.fx_rate) || 1;
  const taxableInr = r2(Number(inv.taxable_amount) * fx);
  const gstInr = r2(Number(inv.gst_amount) * fx);

  const lines = [
    { tag: 'accounts_receivable', debit: Number(inv.amount_inr),
      currency: inv.currency, fx_rate: fx, orig_amount: r2(Number(inv.taxable_amount) + Number(inv.gst_amount)) },
    { tag: 'sales', credit: taxableInr },
  ];
  if (gstInr > 0) lines.push({ tag: 'output_gst', credit: gstInr });

  const journalId = await postJournal(client, {
    entry_date: String(inv.invoice_date).slice(0, 10),
    narration: 'Sales invoice #' + invoiceId,
    source_type: 'invoice', source_id: invoiceId, created_by: userId, contact_id: inv.contact_id || null, lines,
  });
  await client.query(
    `UPDATE acc_invoice SET status='posted', journal_id=$2, posted_at=NOW() WHERE id=$1`,
    [invoiceId, journalId]
  );
  return journalId;
}

// ===========================================================================
// Reversal — the universal "undo" for anything posted
// ===========================================================================
// Mirrors every line of the source journal into a new journal dated `onDate`
// (default today, which must be in an OPEN period), swapping debit<->credit.
// The original is marked 'reversed' and kept; nothing is deleted.
async function reverseJournal(client, journalId, opts = {}) {
  const jr = await client.query('SELECT * FROM acc_journal WHERE id = $1 FOR UPDATE', [journalId]);
  if (!jr.rows.length) throw new Error('acc: journal not found');
  if (jr.rows[0].status === 'reversed') throw new Error('acc: already reversed');
  if (jr.rows[0].status === 'reversal') throw new Error('acc: cannot reverse a reversal');
  const lr = await client.query('SELECT * FROM acc_journal_line WHERE journal_id = $1', [journalId]);

  const onDate = opts.date || new Date().toISOString().slice(0, 10);
  const lines = lr.rows.map(l => ({
    account_id: l.account_id,
    debit: Number(l.credit),   // swapped
    credit: Number(l.debit),
    memo: 'Reversal of J' + journalId,
  }));
  const newId = await postJournal(client, {
    entry_date: onDate,
    narration: (opts.reason ? opts.reason + ' — ' : '') + 'Reversal of journal #' + journalId,
    source_type: 'reversal', status: 'reversal', reverses_journal_id: journalId,
    created_by: opts.created_by, lines,
  });
  await client.query(`UPDATE acc_journal SET status='reversed' WHERE id=$1`, [journalId]);
  return newId;
}

// ===========================================================================
// Reports
// ===========================================================================
async function trialBalance(conn, asOf) {
  const r = await conn.query(
    `SELECT a.id, a.code, a.name, a.type,
            COALESCE(SUM(l.debit),0)  AS debit,
            COALESCE(SUM(l.credit),0) AS credit
       FROM acc_account a
       LEFT JOIN acc_journal_line l ON l.account_id = a.id
       LEFT JOIN acc_journal j ON j.id = l.journal_id
            AND ($1::date IS NULL OR j.entry_date <= $1::date)
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.sort, a.code`,
    [asOf || null]
  );
  let totalD = 0, totalC = 0;
  const rows = r.rows.map(x => {
    const net = r2(Number(x.debit) - Number(x.credit));
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? r2(-net) : 0;
    totalD = r2(totalD + debit);
    totalC = r2(totalC + credit);
    return { code: x.code, name: x.name, type: x.type, debit, credit, net };
  }).filter(x => x.debit !== 0 || x.credit !== 0);
  return { rows, total_debit: totalD, total_credit: totalC, balanced: totalD === totalC };
}

async function profitAndLoss(conn, from, to) {
  const r = await conn.query(
    `SELECT a.type, a.code, a.name,
            COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0) AS amount
       FROM acc_account a
       LEFT JOIN acc_journal_line l ON l.account_id = a.id
       LEFT JOIN acc_journal j ON j.id = l.journal_id
            AND ($1::date IS NULL OR j.entry_date >= $1::date)
            AND ($2::date IS NULL OR j.entry_date <= $2::date)
      WHERE a.type IN ('income','expense')
      GROUP BY a.id, a.type, a.code, a.name ORDER BY a.sort`,
    [from || null, to || null]
  );
  let income = 0, expense = 0;
  for (const x of r.rows) {
    if (x.type === 'income') income = r2(income + Number(x.amount));
    else expense = r2(expense - Number(x.amount)); // expense net is debit-positive
  }
  return { lines: r.rows, income, expense, net_profit: r2(income - expense) };
}

// Balance sheet. Equity includes current-year profit (income − expense) since
// the books aren't closed to retained earnings mid-year. Balances when
// assets = liabilities + equity(booked) + net profit.
async function balanceSheet(conn, asOf) {
  const r = await conn.query(
    `SELECT a.type, COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0) AS net
       FROM acc_account a
       LEFT JOIN acc_journal_line l ON l.account_id = a.id
       LEFT JOIN acc_journal j ON j.id = l.journal_id
            AND ($1::date IS NULL OR j.entry_date <= $1::date)
      GROUP BY a.type`,
    [asOf || null]
  );
  let assets = 0, liabilities = 0, equityBooked = 0, income = 0, expense = 0;
  for (const x of r.rows) {
    const net = Number(x.net);
    if (x.type === 'asset') assets = r2(assets + net);
    else if (x.type === 'liability') liabilities = r2(liabilities - net); // normal credit
    else if (x.type === 'equity') equityBooked = r2(equityBooked - net);
    else if (x.type === 'income') income = r2(income - net);
    else if (x.type === 'expense') expense = r2(expense + net);
  }
  const netProfit = r2(income - expense);
  const equity = r2(equityBooked + netProfit);
  return {
    assets, liabilities, equity, equity_booked: equityBooked, net_profit: netProfit,
    balanced: assets === r2(liabilities + equity),
  };
}

// Opening balances at go-live. Caller passes each known opening figure; the
// helper plugs the difference to opening balance equity so the entry balances.
async function postOpeningBalances(client, { date, items, created_by }) {
  let d = 0, c = 0;
  const lines = [];
  for (const it of items) {
    const debit = r2(it.debit || 0), credit = r2(it.credit || 0);
    if (debit === 0 && credit === 0) continue;
    lines.push({ account_id: it.account_id, tag: it.tag, debit, credit, memo: 'Opening balance' });
    d = r2(d + debit); c = r2(c + credit);
  }
  const plug = r2(d - c);
  if (plug > 0) lines.push({ tag: 'opening_balance_equity', credit: plug, memo: 'Opening balance' });
  else if (plug < 0) lines.push({ tag: 'opening_balance_equity', debit: r2(-plug), memo: 'Opening balance' });
  return postJournal(client, {
    entry_date: date, source_type: 'opening', narration: 'Opening balances as at ' + date,
    created_by, lines,
  });
}


async function lockPeriod(conn, p, userId, note) {
  await conn.query(
    `INSERT INTO acc_period_lock (period, locked_by, note) VALUES ($1,$2,$3)
     ON CONFLICT (period) DO NOTHING`, [p, userId || null, note || null]);
}
async function isPeriodLocked(conn, p) {
  const r = await conn.query('SELECT 1 FROM acc_period_lock WHERE period = $1', [p]);
  return r.rows.length > 0;
}

// ===========================================================================
// Weekday task generator (Mahima's recurring accounts work)
// ===========================================================================
// Her routine, from the Week_workflow she already uses. The schedule GENERATES
// her tasks each morning so she never has to remember — Tuesday's courier-invoice
// check is simply on her list. Idempotent per user/day. Unfinished tasks are NOT
// touched here, so anything open just carries over to the next day.
const WEEKDAY_TASKS = {
  every: [
    { title: "Record yesterday's sales", category: 'billing' },
    { title: 'Check emails & courier invoices', category: 'chasing' },
    { title: 'Enter FK Enterprises purchases', category: 'bill_entry' },
  ],
  Monday:    [{ title: 'Amazon & Parcelhub invoices', category: 'chasing' }, { title: 'Update Monday.com', category: 'admin' }],
  Tuesday:   [{ title: 'DX & Hermes invoices', category: 'chasing' }],
  Wednesday: [{ title: 'Monday.com + Lily / ETA', category: 'chasing' }],
  Thursday:  [{ title: 'Reconcile (Xero + IDFC)', category: 'reconciliation' }],
  Friday:    [{ title: 'Origin invoices', category: 'chasing' }],
  Saturday:  [{ title: 'Weekly follow-up + update Monday.com', category: 'admin' }],
};

function weekdayName(dateStr) {
  // noon UTC: immune to DST / timezone edge cases
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

async function generateAccountsDailyTasks(conn, opts = {}) {
  const today = opts.date || new Date().toISOString().slice(0, 10);
  const weekday = opts.weekday || weekdayName(today);
  const dr = await conn.query("SELECT id FROM departments WHERE slug = 'accounts'");
  if (!dr.rows.length) return { created: 0, weekday };
  const deptId = dr.rows[0].id;

  const ur = await conn.query(
    `SELECT DISTINCT m.user_id
       FROM user_department_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.department_id = $1 AND m.deleted_at IS NULL AND u.deleted_at IS NULL`,
    [deptId]
  );
  const list = [].concat(WEEKDAY_TASKS.every, WEEKDAY_TASKS[weekday] || []);
  let created = 0;
  for (const row of ur.rows) {
    for (const t of list) {
      const exists = await conn.query(
        `SELECT 1 FROM tasks
          WHERE assignee_user_id = $1 AND kind = 'recurring'
            AND title = $2 AND opens_at::date = $3::date LIMIT 1`,
        [row.user_id, t.title, today]
      );
      if (exists.rows.length) continue; // already generated today → carry-over / no dupes
      await conn.query(
        `INSERT INTO tasks (kind, source, title, category, department_id, assignee_user_id, status, opens_at, due_at)
         VALUES ('recurring','recurring',$1,$2,$3,$4,'open',$5::date,$5::date)`,
        [t.title, t.category, deptId, row.user_id, today]
      );
      created++;
    }
  }
  return { created, weekday, users: ur.rows.length };
}

// Cron entry — opens its own connection. Wired to the 06:00 task tick in server.js.
async function tickAccountsDailyTasks() {
  return generateAccountsDailyTasks(db, {});
}

// ===========================================================================
// Bank statement import (IDFC FIRST xlsx)
// ===========================================================================
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function parseDmy(s) {
  const m = String(s || '').trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1]}` : null;
}
function cellNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
function cellStr(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.text != null) return String(v.text).trim();   // exceljs rich text
  if (typeof v === 'object' && v.result != null) return String(v.result).trim(); // formula cell
  return String(v).trim();
}

// Parse an IDFC FIRST "Account Statement" workbook (Buffer) into normalised lines.
// Layout confirmed against a real export: metadata rows, a summary block, then a
// header row "Transaction Date | Value Date | Particulars | Cheque No. | Debit | Credit | Balance".
async function parseBankStatement(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find(w => /statement/i.test(w.name)) || wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row) => { rows.push(row.values || []); }); // values[1] = col A
  let account = null, periodFrom = null, periodTo = null;
  for (const r of rows) {
    const a = (cellStr(r[1]) || '').toUpperCase();
    if (a === 'ACCOUNT NUMBER') account = cellStr(r[2]);
    if (a === 'STATEMENT PERIOD') {
      const m = (cellStr(r[2]) || '').match(/(\d{2}-[A-Za-z]{3}-\d{4})\s*TO\s*(\d{2}-[A-Za-z]{3}-\d{4})/i);
      if (m) { periodFrom = parseDmy(m[1]); periodTo = parseDmy(m[2]); }
    }
  }
  let hdr = -1;
  for (let i = 0; i < rows.length; i++) { if (cellStr(rows[i][1]) === 'Transaction Date') { hdr = i; break; } }
  if (hdr < 0) throw new Error('Could not find the transaction table — is this an IDFC statement export?');
  const dpat = /^\d{2}-[A-Za-z]{3}-\d{4}$/;
  const lines = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    const td = cellStr(r[1]);
    if (!td || !dpat.test(td)) continue;
    const debit = cellNum(r[5]) || 0;
    const credit = cellNum(r[6]) || 0;
    const amount = r2(credit - debit); // signed: + received, − spent
    const description = cellStr(r[3]);
    const balance = cellNum(r[7]);
    const row_hash = sha([account, td, description, amount, balance].join('|'));
    lines.push({ txn_date: parseDmy(td), description, ref: cellStr(r[4]), amount, running_balance: balance, row_hash });
  }
  return { account, periodFrom, periodTo, lines };
}


router.use(requireAuth);

router.get('/accounts', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query('SELECT * FROM acc_account WHERE NOT is_archived ORDER BY sort, code');
  res.json(r.rows);
});

const ACCT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
const TAX_DEFAULTS = ['none', 'gst18', 'gst12', 'gst5', 'zero'];

// Full chart for the management screen: every account incl. archived, each with
// its year-to-date net balance and whether it's a locked control account.
router.get('/accounts/all', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query(
    `SELECT a.*,
            COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS net,
            (a.system_tag IS NOT NULL) AS is_system
       FROM acc_account a
       LEFT JOIN acc_journal_line l ON l.account_id = a.id
      GROUP BY a.id
      ORDER BY a.sort, a.code`);
  res.json(r.rows);
});

router.post('/accounts', requirePermission('accounts.post'), async (req, res) => {
  const { code, name, type, tax_default = 'none', description = null } = req.body || {};
  if (!code || !String(code).trim()) return res.status(400).json({ error: 'Code is required.' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!ACCT_TYPES.includes(type)) return res.status(400).json({ error: 'Pick an account type.' });
  if (!TAX_DEFAULTS.includes(tax_default)) return res.status(400).json({ error: 'Invalid tax default.' });
  try {
    const dup = await db.query('SELECT 1 FROM acc_account WHERE lower(code) = lower($1)', [String(code).trim()]);
    if (dup.rows.length) return res.status(400).json({ error: 'That code is already in use.' });
    const s = await db.query('SELECT COALESCE(MAX(sort), 0) + 10 AS s FROM acc_account WHERE type = $1', [type]);
    const r = await db.query(
      `INSERT INTO acc_account (code, name, type, tax_default, description, sort)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [String(code).trim(), String(name).trim(), type, tax_default, description, s.rows[0].s]);
    await logAudit({ req, module: 'accounts', action: 'account.create', target_type: 'acc_account', target_id: r.rows[0].id });
    res.json(r.rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/accounts/:id', requirePermission('accounts.post'), async (req, res) => {
  const { name, type, tax_default, description, code } = req.body || {};
  try {
    const cur = await db.query('SELECT * FROM acc_account WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Account not found.' });
    const acct = cur.rows[0];
    const isSystem = acct.system_tag !== null;
    // Control accounts are resolved by tag during posting, so their name, description
    // and tax default are editable but their type + code stay locked.
    if (type !== undefined && type !== acct.type) {
      if (isSystem) return res.status(400).json({ error: 'A control account\u2019s type can\u2019t be changed.' });
      if (!ACCT_TYPES.includes(type)) return res.status(400).json({ error: 'Pick an account type.' });
    }
    if (code !== undefined && String(code).trim() !== acct.code) {
      if (isSystem) return res.status(400).json({ error: 'A control account\u2019s code can\u2019t be changed.' });
      const dup = await db.query('SELECT 1 FROM acc_account WHERE lower(code) = lower($1) AND id <> $2', [String(code).trim(), acct.id]);
      if (dup.rows.length) return res.status(400).json({ error: 'That code is already in use.' });
    }
    if (tax_default !== undefined && !TAX_DEFAULTS.includes(tax_default)) return res.status(400).json({ error: 'Invalid tax default.' });
    const r = await db.query(
      `UPDATE acc_account SET
         name        = COALESCE($2, name),
         type        = COALESCE($3, type),
         tax_default = COALESCE($4, tax_default),
         description = $5,
         code        = COALESCE($6, code)
       WHERE id = $1 RETURNING *`,
      [acct.id,
       name !== undefined ? String(name).trim() : null,
       (type !== undefined && !isSystem) ? type : null,
       tax_default !== undefined ? tax_default : null,
       description !== undefined ? description : acct.description,
       (code !== undefined && !isSystem) ? String(code).trim() : null]);
    await logAudit({ req, module: 'accounts', action: 'account.edit', target_type: 'acc_account', target_id: acct.id });
    res.json(r.rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Archive hides an account from coding dropdowns but keeps its history (Xero-style).
// Control accounts can never be archived — the ledger posts to them.
router.post('/accounts/:id/archive', requirePermission('accounts.post'), async (req, res) => {
  try {
    const cur = await db.query('SELECT * FROM acc_account WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Account not found.' });
    if (cur.rows[0].system_tag !== null) return res.status(400).json({ error: 'A control account can\u2019t be archived \u2014 the ledger needs it.' });
    await db.query('UPDATE acc_account SET is_archived = TRUE WHERE id = $1', [req.params.id]);
    await logAudit({ req, module: 'accounts', action: 'account.archive', target_type: 'acc_account', target_id: Number(req.params.id) });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/accounts/:id/unarchive', requirePermission('accounts.post'), async (req, res) => {
  await db.query('UPDATE acc_account SET is_archived = FALSE WHERE id = $1', [req.params.id]);
  await logAudit({ req, module: 'accounts', action: 'account.unarchive', target_type: 'acc_account', target_id: Number(req.params.id) });
  res.json({ ok: true });
});

router.post('/bills', requirePermission('accounts.post'), async (req, res) => {
  try {
    const bill = await createBill(db, { ...req.body, created_by: req.user.id });
    await logAudit({ req, module: 'accounts', action: 'bill.create', target_type: 'acc_bill', target_id: bill.id, after: bill });
    res.json(bill);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/bills/:id/post', requirePermission('accounts.post'), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const journalId = await postBill(client, Number(req.params.id), req.user.id);
    await client.query('COMMIT');
    await logAudit({ req, module: 'accounts', action: 'bill.post', target_type: 'acc_bill', target_id: req.params.id, details: 'journal ' + journalId });
    res.json({ ok: true, journal_id: journalId });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

router.post('/journals/:id/reverse', requirePermission('accounts.post'), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const newId = await reverseJournal(client, Number(req.params.id),
      { reason: req.body?.reason, created_by: req.user.id });
    await client.query('COMMIT');
    await logAudit({ req, module: 'accounts', action: 'journal.reverse', target_type: 'acc_journal', target_id: req.params.id, details: req.body?.reason || null });
    res.json({ ok: true, reversal_journal_id: newId });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

router.post('/invoices', requirePermission('accounts.post'), async (req, res) => {
  try {
    const inv = await createInvoice(db, { ...req.body, created_by: req.user.id });
    await logAudit({ req, module: 'accounts', action: 'invoice.create', target_type: 'acc_invoice', target_id: inv.id, after: inv });
    res.json(inv);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/invoices/:id/post', requirePermission('accounts.post'), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const journalId = await postInvoice(client, Number(req.params.id), req.user.id);
    await client.query('COMMIT');
    res.json({ ok: true, journal_id: journalId });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

router.get('/reports/trial-balance', requirePermission('accounts.view'), async (req, res) => {
  res.json(await trialBalance(db, req.query.as_of || null));
});
router.get('/reports/profit-loss', requirePermission('accounts.view'), async (req, res) => {
  res.json(await profitAndLoss(db, req.query.from || null, req.query.to || null));
});
router.get('/reports/balance-sheet', requirePermission('accounts.view'), async (req, res) => {
  res.json(await balanceSheet(db, req.query.as_of || null));
});

router.post('/periods/:period/lock', requirePermission('accounts.period.lock'), async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.period)) return res.status(400).json({ error: 'Period must be a real YYYY-MM month.' });
  await lockPeriod(db, req.params.period, req.user.id, req.body?.note);
  await logAudit({ req, module: 'accounts', action: 'period.lock', target_type: 'acc_period', target_id: req.params.period });
  res.json({ ok: true });
});
router.post('/periods/:period/unlock', requirePermission('accounts.period.lock'), async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.period)) return res.status(400).json({ error: 'Period must be a real YYYY-MM month.' });
  await db.query('DELETE FROM acc_period_lock WHERE period = $1', [req.params.period]);
  await logAudit({ req, module: 'accounts', action: 'period.unlock', target_type: 'acc_period', target_id: req.params.period });
  res.json({ ok: true });
});
// Months that have entries (or a lock), with filed status — for the month-end screen.
router.get('/periods', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query(
    `SELECT COALESCE(m.period, pl.period) AS period,
            COALESCE(m.entries, 0) AS entries,
            (pl.period IS NOT NULL) AS locked, pl.locked_at, pl.note
       FROM (SELECT to_char(entry_date, 'YYYY-MM') AS period, COUNT(*) AS entries
               FROM acc_journal WHERE status = 'posted' GROUP BY 1) m
       FULL OUTER JOIN acc_period_lock pl ON pl.period = m.period
      ORDER BY 1 DESC`);
  res.json(r.rows.map(x => ({ period: x.period, entries: Number(x.entries), locked: x.locked, locked_at: x.locked_at, note: x.note })));
});

// --- reads + lookups for the UI ---
async function tagBalance(tag) {
  const r = await db.query(
    `SELECT COALESCE(SUM(l.debit - l.credit),0) net
       FROM acc_journal_line l JOIN acc_account a ON a.id = l.account_id
      WHERE a.system_tag = $1`, [tag]);
  return Math.round(Number(r.rows[0].net) * 100) / 100;
}
router.get('/overview', requirePermission('accounts.view'), async (req, res) => {
  const d = await db.query(
    `SELECT (SELECT COUNT(*) FROM acc_bill    WHERE status='draft') AS bills,
            (SELECT COUNT(*) FROM acc_invoice WHERE status='draft') AS invoices`);
  res.json({
    bank: await tagBalance('idfc_bank'),
    receivable: Math.abs(await tagBalance('accounts_receivable')),
    payable: Math.abs(await tagBalance('accounts_payable')),
    input_gst: await tagBalance('input_gst'),
    output_gst: Math.abs(await tagBalance('output_gst')),
    tds_payable: Math.abs(await tagBalance('tds_payable')),
    draft_bills: Number(d.rows[0].bills),
    draft_invoices: Number(d.rows[0].invoices),
  });
});

// Money in vs out for the latest month that has bank data (cash basis, from the
// imported statement). Powers the Overview cashflow graph.
router.get('/overview/cashflow', requirePermission('accounts.view'), async (req, res) => {
  const m = await db.query("SELECT to_char(max(txn_date),'YYYY-MM') AS month FROM acc_bank_line WHERE status <> 'ignored'");
  const month = m.rows[0].month;
  if (!month) return res.json({ month: null, received: 0, spent: 0, net: 0 });
  const r = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS received,
            COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spent
       FROM acc_bank_line
      WHERE status <> 'ignored' AND to_char(txn_date,'YYYY-MM') = $1`, [month]);
  const received = Number(r.rows[0].received), spent = Number(r.rows[0].spent);
  res.json({ month, received, spent, net: Math.round((received - spent) * 100) / 100 });
});

// Expense breakdown for the spending donut: top expense accounts + "Other".
router.get('/overview/spending', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query(
    `SELECT a.name, COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS amt
       FROM acc_account a
       JOIN acc_journal_line l ON l.account_id = a.id
       JOIN acc_journal j ON j.id = l.journal_id AND j.status = 'posted'
      WHERE a.type = 'expense'
      GROUP BY a.id, a.name
     HAVING COALESCE(SUM(l.debit) - SUM(l.credit), 0) > 0
      ORDER BY amt DESC`);
  const rows = r.rows.map(x => ({ name: x.name, amount: Math.round(Number(x.amt) * 100) / 100 }));
  const total = Math.round(rows.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const segments = rows.slice(0, 5);
  const other = Math.round(rows.slice(5).reduce((s, x) => s + x.amount, 0) * 100) / 100;
  if (other > 0) segments.push({ name: 'Other', amount: other });
  res.json({ total, segments });
});

// Recent reconcile activity: the latest coded/matched bank entries.
router.get('/overview/recent', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query(
    `SELECT j.id, j.entry_date, j.narration,
            COALESCE((SELECT l.debit - l.credit FROM acc_journal_line l JOIN acc_account a ON a.id = l.account_id
                       WHERE l.journal_id = j.id AND a.system_tag = 'idfc_bank' LIMIT 1), 0) AS bank_delta,
            (SELECT a.name FROM acc_journal_line l JOIN acc_account a ON a.id = l.account_id
              WHERE l.journal_id = j.id AND (a.system_tag IS NULL OR a.system_tag <> 'idfc_bank')
              ORDER BY (l.debit + l.credit) DESC LIMIT 1) AS account_name
       FROM acc_journal j
      WHERE j.source_type = 'bank' AND j.status = 'posted'
      ORDER BY j.id DESC LIMIT 8`);
  res.json(r.rows.map(x => ({
    id: x.id, date: x.entry_date, account_name: x.account_name, narration: x.narration,
    amount: Math.abs(Number(x.bank_delta)), direction: Number(x.bank_delta) >= 0 ? 'in' : 'out',
  })));
});
router.get('/contacts', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query('SELECT * FROM acc_contact WHERE NOT is_archived ORDER BY name');
  res.json(r.rows);
});
router.post('/contacts', requirePermission('accounts.post'), async (req, res) => {
  const { name, kind, gstin } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = await db.query('INSERT INTO acc_contact (name, kind, gstin) VALUES ($1,$2,$3) RETURNING *',
    [String(name).trim(), kind || 'supplier', gstin || null]);
  res.json(r.rows[0]);
});

// ---------- File attachments (bills / invoices / bank lines) ----------
const ATT_COLS = { bill: 'bill_id', invoice: 'invoice_id', bank: 'bank_line_id' };
function attTarget(q) {
  const found = Object.entries(ATT_COLS).filter(([k]) => q[k + '_id']);
  if (found.length !== 1) return null;
  return { col: found[0][1], val: q[found[0][0] + '_id'] };
}
router.get('/attachments', requirePermission('accounts.view'), async (req, res) => {
  const t = attTarget(req.query);
  if (!t) return res.status(400).json({ error: 'Pass exactly one of bill_id, invoice_id, bank_id.' });
  const r = await db.query(
    `SELECT id, filename, mime_type, size_bytes, uploaded_at FROM acc_attachment WHERE ${t.col} = $1 ORDER BY id`, [t.val]);
  res.json(r.rows);
});
router.post('/attachments', requirePermission('accounts.post'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const t = attTarget(req.query);
  if (!t) return res.status(400).json({ error: 'Pass exactly one of bill_id, invoice_id, bank_id.' });
  if (!/^(application\/pdf|image\/(png|jpe?g|webp|gif))$/i.test(req.file.mimetype)) {
    return res.status(400).json({ error: 'Only PDF or image files are allowed.' });
  }
  const r = await db.query(
    `INSERT INTO acc_attachment (${t.col}, filename, mime_type, size_bytes, content, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, filename, mime_type, size_bytes, uploaded_at`,
    [t.val, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.user.id]);
  res.json(r.rows[0]);
});
router.get('/attachments/:id', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query('SELECT filename, mime_type, content FROM acc_attachment WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Not found.' });
  const f = r.rows[0];
  res.setHeader('Content-Type', f.mime_type);
  res.setHeader('Content-Disposition', 'inline; filename="' + String(f.filename).replace(/[\r\n"]/g, '') + '"');
  res.send(f.content);
});
router.delete('/attachments/:id', requirePermission('accounts.post'), async (req, res) => {
  await db.query('DELETE FROM acc_attachment WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});
router.get('/bills', requirePermission('accounts.view'), async (req, res) => {
  const where = req.query.status ? 'WHERE b.status = $1' : '';
  const r = await db.query(
    `SELECT b.*, c.name AS contact_name, a.name AS category_name,
            (SELECT COUNT(*) FROM acc_attachment x WHERE x.bill_id = b.id) AS att_count
       FROM acc_bill b
       LEFT JOIN acc_contact c ON c.id = b.contact_id
       LEFT JOIN acc_account a ON a.id = b.category_account_id
       ${where} ORDER BY b.bill_date DESC, b.id DESC`,
    req.query.status ? [req.query.status] : []);
  res.json(r.rows);
});
router.get('/invoices', requirePermission('accounts.view'), async (req, res) => {
  const where = req.query.status ? 'WHERE i.status = $1' : '';
  const r = await db.query(
    `SELECT i.*, c.name AS contact_name,
            (SELECT COUNT(*) FROM acc_attachment x WHERE x.invoice_id = i.id) AS att_count
       FROM acc_invoice i LEFT JOIN acc_contact c ON c.id = i.contact_id
       ${where} ORDER BY i.invoice_date DESC, i.id DESC`,
    req.query.status ? [req.query.status] : []);
  res.json(r.rows);
});
router.post('/bills/:id/void', requirePermission('accounts.post'), async (req, res) => {
  const r = await db.query("UPDATE acc_bill SET status='void' WHERE id=$1 AND status='draft' RETURNING id", [req.params.id]);
  if (!r.rows.length) return res.status(400).json({ error: 'Only a draft bill can be voided — post then reverse a posted one' });
  await logAudit({ req, module: 'accounts', action: 'bill.void', target_type: 'acc_bill', target_id: req.params.id });
  res.json({ ok: true });
});
router.post('/invoices/:id/void', requirePermission('accounts.post'), async (req, res) => {
  const r = await db.query("UPDATE acc_invoice SET status='void' WHERE id=$1 AND status='draft' RETURNING id", [req.params.id]);
  if (!r.rows.length) return res.status(400).json({ error: 'Only a draft invoice can be voided' });
  res.json({ ok: true });
});

// Opening balances. Owner + accounts team. Editable: re-posting reverses the
// previous opening entry and posts a fresh one, so the ledger stays auditable.
router.get('/opening', requirePermission('accounts.view'), async (req, res) => {
  const j = await db.query("SELECT id, entry_date FROM acc_journal WHERE source_type='opening' AND status='posted' ORDER BY id DESC LIMIT 1");
  if (!j.rows.length) return res.json({ exists: false });
  const lines = await db.query(
    `SELECT a.system_tag, a.code, a.name, l.debit, l.credit
       FROM acc_journal_line l JOIN acc_account a ON a.id = l.account_id
      WHERE l.journal_id = $1 ORDER BY l.id`, [j.rows[0].id]);
  res.json({ exists: true, journal_id: j.rows[0].id, date: j.rows[0].entry_date, lines: lines.rows });
});
router.post('/opening', requirePermission('accounts.post'), async (req, res) => {
  const items = (req.body.items || []).filter(it => Number(it.debit || 0) !== 0 || Number(it.credit || 0) !== 0);
  if (!items.length) return res.status(400).json({ error: 'Enter at least one opening balance.' });
  const date = req.body.date || '2026-03-31';
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const prev = await client.query("SELECT id FROM acc_journal WHERE source_type='opening' AND status='posted'");
    for (const r of prev.rows) {
      await reverseJournal(client, r.id, { reason: 'Opening balances edited', created_by: req.user.id, date });
    }
    const journalId = await postOpeningBalances(client, { date, items, created_by: req.user.id });
    await client.query('COMMIT');
    await logAudit({ req, module: 'accounts', action: prev.rows.length ? 'opening.edit' : 'opening.set', target_type: 'acc_journal', target_id: journalId });
    res.json({ ok: true, journal_id: journalId });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

// --- bank statement import + reconcile worklist data ---
router.post('/bank/import', requirePermission('accounts.reconcile'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const replace = String(req.body.replace || '') === 'true';
  let parsed;
  try { parsed = await parseBankStatement(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  if (!parsed.lines.length) return res.status(400).json({ error: 'No transactions found in that file.' });
  // Statement period: prefer the header, else fall back to the min/max transaction date.
  const dates = parsed.lines.map(l => l.txn_date).filter(Boolean).sort();
  const from = parsed.periodFrom || dates[0];
  const to = parsed.periodTo || dates[dates.length - 1];
  const fileHash = sha(req.file.buffer);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Block any statement whose date range overlaps one already imported.
    const ov = await client.query(
      `SELECT i.id, i.filename, i.period_from, i.period_to,
              (SELECT COUNT(*) FROM acc_bank_line l WHERE l.import_id = i.id AND l.status = 'matched') AS matched
         FROM acc_bank_import i
        WHERE i.period_from IS NOT NULL AND i.period_to IS NOT NULL
          AND i.period_from <= $1::date AND i.period_to >= $2::date`,
      [to, from]);
    if (ov.rows.length && !replace) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'overlap', needs_replace: true,
        message: 'A statement covering these dates has already been imported.',
        overlaps: ov.rows.map(r => ({ id: r.id, filename: r.filename, period_from: r.period_from, period_to: r.period_to, matched: Number(r.matched) })),
      });
    }
    if (ov.rows.length && replace) {
      const lockedMatched = ov.rows.reduce((s, r) => s + Number(r.matched), 0);
      if (lockedMatched > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'has_reconciled', message: `Can't replace — ${lockedMatched} line(s) in the existing statement are already reconciled. Unreconcile those first, then replace.` });
      }
      for (const r of ov.rows) await client.query('DELETE FROM acc_bank_import WHERE id = $1', [r.id]); // cascade clears its lines
    }
    const imp = await client.query(
      `INSERT INTO acc_bank_import (filename, hash, period_from, period_to, row_count, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (hash) DO NOTHING RETURNING id`,
      [req.file.originalname, fileHash, from, to, parsed.lines.length, req.user.id]);
    if (!imp.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'duplicate', message: 'This exact statement has already been imported.' }); }
    const importId = imp.rows[0].id;
    for (const l of parsed.lines) {
      await client.query(
        `INSERT INTO acc_bank_line (import_id, txn_date, description, ref, amount, running_balance, row_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [importId, l.txn_date, l.description, l.ref, l.amount, l.running_balance, l.row_hash]);
    }
    await client.query('COMMIT');
    await logAudit({ req, module: 'accounts', action: 'bank.import', target_type: 'acc_bank_import', target_id: importId });
    res.json({ ok: true, import_id: importId, account: parsed.account, lines: parsed.lines.length, period_from: from, period_to: to, replaced: ov.rows.length });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});
router.get('/bank/imports', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query(
    `SELECT i.*, (SELECT COUNT(*) FROM acc_bank_line l WHERE l.import_id = i.id AND l.status = 'unmatched') AS unmatched
       FROM acc_bank_import i ORDER BY i.id DESC`);
  res.json(r.rows);
});
router.get('/bank/lines', requirePermission('accounts.view'), async (req, res) => {
  const params = []; const clauses = [];
  if (req.query.status) { params.push(req.query.status); clauses.push('status = $' + params.length); }
  if (req.query.import_id) { params.push(req.query.import_id); clauses.push('import_id = $' + params.length); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const r = await db.query(`SELECT *, (SELECT COUNT(*) FROM acc_attachment a WHERE a.bank_line_id = acc_bank_line.id) AS att_count FROM acc_bank_line ${where} ORDER BY txn_date, id`, params);
  res.json(r.rows);
});
// Two-balance reconcile header: bank's statement balance vs the books, + progress.
router.get('/bank/summary', requirePermission('accounts.view'), async (req, res) => {
  const last = await db.query("SELECT running_balance FROM acc_bank_line ORDER BY txn_date DESC, id DESC LIMIT 1");
  const stmt = last.rows.length ? Number(last.rows[0].running_balance) : 0;
  const books = await tagBalance('idfc_bank');
  const counts = await db.query("SELECT status, COUNT(*) n FROM acc_bank_line GROUP BY status");
  const c = { unmatched: 0, matched: 0, ignored: 0 };
  counts.rows.forEach(r => { c[r.status] = Number(r.n); });
  res.json({ statement_balance: r2(stmt), books_balance: books, difference: r2(stmt - books), counts: c });
});
// Code a bank line to an account → posts the bank journal and marks it reconciled.
// Code one unmatched bank line to an account: money in -> credit the account,
// money out -> debit it, the bank control account takes the other leg.
// opts.contactId (Who) and opts.note (Why) are optional, Xero-style.
// Returns the new journal id. Caller owns the BEGIN/COMMIT.
async function codeBankLine(client, lineId, accountId, userId, opts = {}) {
  const lr = await client.query('SELECT * FROM acc_bank_line WHERE id = $1 FOR UPDATE', [lineId]);
  if (!lr.rows.length) throw new Error('Line not found.');
  const line = lr.rows[0];
  if (line.status !== 'unmatched') throw new Error('Line ' + line.id + ' is already reconciled.');
  const amt = Number(line.amount);
  const lines = amt >= 0
    ? [{ tag: 'idfc_bank', debit: amt }, { account_id: accountId, credit: amt }]   // money in
    : [{ tag: 'idfc_bank', credit: -amt }, { account_id: accountId, debit: -amt }]; // money out
  const note = opts.note && String(opts.note).trim();
  const jid = await postJournal(client, {
    entry_date: line.txn_date, source_type: 'bank',
    narration: note || ('Bank: ' + (line.description || '')),
    created_by: userId, contact_id: opts.contactId || null, lines,
  });
  await client.query("UPDATE acc_bank_line SET status='matched', match_type='manual', matched_journal_id=$2 WHERE id=$1", [line.id, jid]);
  return jid;
}

router.post('/bank/lines/:id/code', requirePermission('accounts.reconcile'), async (req, res) => {
  const { account_id, contact_id, note } = req.body || {};
  if (!account_id) return res.status(400).json({ error: 'Pick an account to code this to.' });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const jid = await codeBankLine(client, req.params.id, account_id, req.user.id, { contactId: contact_id || null, note: note || null });
    await client.query('COMMIT');
    await logAudit({ req, module: 'accounts', action: 'bank.code', target_type: 'acc_bank_line', target_id: Number(req.params.id) });
    res.json({ ok: true, journal_id: jid });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

// Bulk coding: tick several unmatched lines, code them all to one account at once.
// All-or-nothing — if any line is already reconciled the whole batch rolls back.
router.post('/bank/code-bulk', requirePermission('accounts.reconcile'), async (req, res) => {
  const { line_ids, account_id } = req.body || {};
  if (!account_id) return res.status(400).json({ error: 'Pick an account to code these to.' });
  if (!Array.isArray(line_ids) || !line_ids.length) return res.status(400).json({ error: 'No lines selected.' });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    let coded = 0;
    for (const id of line_ids) { await codeBankLine(client, id, account_id, req.user.id); coded++; }
    await client.query('COMMIT');
    await logAudit({ req, module: 'accounts', action: 'bank.code_bulk', target_type: 'acc_bank_line', target_id: null });
    res.json({ ok: true, coded });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});
router.post('/bank/lines/:id/ignore', requirePermission('accounts.reconcile'), async (req, res) => {
  const r = await db.query("UPDATE acc_bank_line SET status='ignored' WHERE id=$1 AND status='unmatched' RETURNING id", [req.params.id]);
  if (!r.rows.length) return res.status(400).json({ error: 'Only an unmatched line can be set aside.' });
  res.json({ ok: true });
});
router.post('/bank/lines/:id/unmatch', requirePermission('accounts.reconcile'), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const lr = await client.query('SELECT * FROM acc_bank_line WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!lr.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Line not found.' }); }
    const line = lr.rows[0];
    if (line.status === 'ignored') {
      await client.query("UPDATE acc_bank_line SET status='unmatched' WHERE id=$1", [line.id]);
      await client.query('COMMIT'); return res.json({ ok: true });
    }
    if (line.status !== 'matched' || !line.matched_journal_id) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Nothing to undo on that line.' }); }
    await reverseJournal(client, line.matched_journal_id, { reason: 'Bank line unreconciled', created_by: req.user.id, date: line.txn_date });
    // If this line had settled an invoice/bill, re-open it.
    await client.query("UPDATE acc_invoice SET status='posted', settled_journal_id=NULL WHERE settled_journal_id=$1", [line.matched_journal_id]);
    await client.query("UPDATE acc_bill SET status='posted', settled_journal_id=NULL WHERE settled_journal_id=$1", [line.matched_journal_id]);
    await client.query("UPDATE acc_bank_line SET status='unmatched', match_type=NULL, matched_journal_id=NULL WHERE id=$1", [line.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

// Open documents to match a bank line against.
router.get('/open-invoices', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query(
    `SELECT i.id, i.invoice_date, i.amount_inr, i.currency, i.taxable_amount, c.name AS contact_name
       FROM acc_invoice i LEFT JOIN acc_contact c ON c.id = i.contact_id
      WHERE i.status = 'posted' ORDER BY i.invoice_date, i.id`);
  res.json(r.rows);
});
router.get('/open-bills', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query(
    `SELECT b.id, b.bill_date, b.net_payable, c.name AS contact_name
       FROM acc_bill b LEFT JOIN acc_contact c ON c.id = b.contact_id
      WHERE b.status = 'posted' ORDER BY b.bill_date, b.id`);
  res.json(r.rows);
});

// Suggested matches: for each unmatched line, the open invoice (money in) or bill
// (money out) whose amount equals it to the paisa. Each open doc is offered once.
// A one-tap accept on the client runs the normal match flow.
router.get('/bank/suggestions', requirePermission('accounts.view'), async (req, res) => {
  const [linesR, invR, billR] = await Promise.all([
    db.query("SELECT id, amount FROM acc_bank_line WHERE status = 'unmatched' ORDER BY txn_date, id"),
    db.query("SELECT i.id, i.amount_inr, c.name AS contact_name FROM acc_invoice i LEFT JOIN acc_contact c ON c.id = i.contact_id WHERE i.status = 'posted' ORDER BY i.invoice_date, i.id"),
    db.query("SELECT b.id, b.net_payable, c.name AS contact_name FROM acc_bill b LEFT JOIN acc_contact c ON c.id = b.contact_id WHERE b.status = 'posted' ORDER BY b.bill_date, b.id"),
  ]);
  const invs = invR.rows.slice(), bills = billR.rows.slice();
  const usedInv = new Set(), usedBill = new Set();
  const out = [];
  for (const l of linesR.rows) {
    const amt = Number(l.amount);
    if (amt > 0) {
      const m = invs.find(i => !usedInv.has(i.id) && Math.abs(Number(i.amount_inr) - amt) < 0.01);
      if (m) { usedInv.add(m.id); out.push({ line_id: l.id, doc_type: 'invoice', doc_id: m.id, amount: amt, contact_name: m.contact_name || null }); }
    } else if (amt < 0) {
      const m = bills.find(b => !usedBill.has(b.id) && Math.abs(Number(b.net_payable) - (-amt)) < 0.01);
      if (m) { usedBill.add(m.id); out.push({ line_id: l.id, doc_type: 'bill', doc_id: m.id, amount: -amt, contact_name: m.contact_name || null }); }
    }
  }
  res.json(out);
});
// Match a bank line to an invoice (receipt) or bill (payment); books any FX difference.
router.post('/bank/lines/:id/match', requirePermission('accounts.reconcile'), async (req, res) => {
  const { doc_type, doc_id } = req.body || {};
  if (!['invoice', 'bill'].includes(doc_type) || !doc_id) return res.status(400).json({ error: 'Choose an invoice or bill to match.' });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const lr = await client.query('SELECT * FROM acc_bank_line WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!lr.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Line not found.' }); }
    const line = lr.rows[0];
    if (line.status !== 'unmatched') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'That line is already reconciled.' }); }
    const amt = Number(line.amount);
    let lines, jid;
    if (doc_type === 'invoice') {
      if (amt <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'A money-out line cannot settle a customer invoice.' }); }
      const d = await client.query("SELECT * FROM acc_invoice WHERE id=$1 AND status='posted' FOR UPDATE", [doc_id]);
      if (!d.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invoice not open.' }); }
      const ar = Number(d.rows[0].amount_inr);
      lines = [{ tag: 'idfc_bank', debit: amt }, { tag: 'accounts_receivable', credit: ar }];
      const fx = r2(amt - ar);
      if (fx > 0) lines.push({ tag: 'fx_gain_loss', credit: fx });
      else if (fx < 0) lines.push({ tag: 'fx_gain_loss', debit: -fx });
      jid = await postJournal(client, { entry_date: line.txn_date, source_type: 'bank', narration: 'Receipt settles invoice #' + doc_id, created_by: req.user.id, lines });
      await client.query("UPDATE acc_invoice SET status='paid', settled_journal_id=$2 WHERE id=$1", [doc_id, jid]);
    } else {
      if (amt >= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'A money-in line cannot settle a supplier bill.' }); }
      const paid = -amt;
      const d = await client.query("SELECT * FROM acc_bill WHERE id=$1 AND status='posted' FOR UPDATE", [doc_id]);
      if (!d.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Bill not open.' }); }
      const ap = Number(d.rows[0].net_payable);
      lines = [{ tag: 'accounts_payable', debit: ap }, { tag: 'idfc_bank', credit: paid }];
      const fx = r2(ap - paid);
      if (fx > 0) lines.push({ tag: 'fx_gain_loss', credit: fx });
      else if (fx < 0) lines.push({ tag: 'fx_gain_loss', debit: -fx });
      jid = await postJournal(client, { entry_date: line.txn_date, source_type: 'bank', narration: 'Payment settles bill #' + doc_id, created_by: req.user.id, lines });
      await client.query("UPDATE acc_bill SET status='paid', settled_journal_id=$2 WHERE id=$1", [doc_id, jid]);
    }
    await client.query("UPDATE acc_bank_line SET status='matched', match_type=$2, matched_journal_id=$3 WHERE id=$1", [line.id, doc_type, jid]);
    await client.query('COMMIT');
    await logAudit({ req, module: 'accounts', action: 'bank.match', target_type: 'acc_bank_line', target_id: line.id });
    res.json({ ok: true, journal_id: jid });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});
// AR / AP aging — open invoices and bills bucketed by age.
router.get('/reports/aging', requirePermission('accounts.view'), async (req, res) => {
  const buckets = (col) => `
      SUM(amt) AS total,
      SUM(CASE WHEN CURRENT_DATE - ${col} <= 30 THEN amt ELSE 0 END) AS b0,
      SUM(CASE WHEN CURRENT_DATE - ${col} BETWEEN 31 AND 60 THEN amt ELSE 0 END) AS b30,
      SUM(CASE WHEN CURRENT_DATE - ${col} BETWEEN 61 AND 90 THEN amt ELSE 0 END) AS b60,
      SUM(CASE WHEN CURRENT_DATE - ${col} > 90 THEN amt ELSE 0 END) AS b90`;
  const ar = await db.query(
    `SELECT contact, ${buckets('d')} FROM (
        SELECT COALESCE(c.name,'—') AS contact, i.amount_inr AS amt, i.invoice_date AS d
          FROM acc_invoice i LEFT JOIN acc_contact c ON c.id=i.contact_id
         WHERE i.status='posted') x GROUP BY contact ORDER BY total DESC`);
  const ap = await db.query(
    `SELECT contact, ${buckets('d')} FROM (
        SELECT COALESCE(c.name,'—') AS contact, b.net_payable AS amt, b.bill_date AS d
          FROM acc_bill b LEFT JOIN acc_contact c ON c.id=b.contact_id
         WHERE b.status='posted') x GROUP BY contact ORDER BY total DESC`);
  res.json({ receivables: ar.rows, payables: ap.rows });
});

// ---------- CA pack: GST registers + TDS summary (for the accountant) ----------
function caPeriod(req) {
  const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : '1900-01-01';
  const to = req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : '2999-12-31';
  return [from, to];
}
const n2 = v => Math.round(Number(v || 0) * 100) / 100;

// GSTR-1 style sales register (output GST) from posted invoices.
router.get('/reports/gst-sales', requirePermission('accounts.view'), async (req, res) => {
  const [from, to] = caPeriod(req);
  const r = await db.query(
    `SELECT i.id, i.invoice_date, COALESCE(c.name,'—') AS party, c.gstin, i.tax_treatment,
            i.taxable_amount, i.gst_rate, i.gst_amount, i.amount_inr AS total
       FROM acc_invoice i LEFT JOIN acc_contact c ON c.id = i.contact_id
      WHERE i.status IN ('posted','sent','paid') AND i.invoice_date BETWEEN $1 AND $2
      ORDER BY i.invoice_date, i.id`, [from, to]);
  const rows = r.rows;
  res.json({
    from, to, rows,
    totals: {
      taxable: n2(rows.reduce((s, x) => s + Number(x.taxable_amount), 0)),
      gst: n2(rows.reduce((s, x) => s + Number(x.gst_amount), 0)),
      total: n2(rows.reduce((s, x) => s + Number(x.total), 0)),
    },
  });
});

// GSTR-2 style purchase register (input GST) from posted bills.
router.get('/reports/gst-purchases', requirePermission('accounts.view'), async (req, res) => {
  const [from, to] = caPeriod(req);
  const r = await db.query(
    `SELECT b.id, b.bill_date, COALESCE(c.name,'—') AS party, c.gstin,
            b.taxable_amount, b.gst_rate, b.gst_amount,
            (b.taxable_amount + b.gst_amount) AS total
       FROM acc_bill b LEFT JOIN acc_contact c ON c.id = b.contact_id
      WHERE b.status IN ('posted','paid') AND b.bill_date BETWEEN $1 AND $2
      ORDER BY b.bill_date, b.id`, [from, to]);
  const rows = r.rows;
  res.json({
    from, to, rows,
    totals: {
      taxable: n2(rows.reduce((s, x) => s + Number(x.taxable_amount), 0)),
      gst: n2(rows.reduce((s, x) => s + Number(x.gst_amount), 0)),
      total: n2(rows.reduce((s, x) => s + Number(x.total), 0)),
    },
  });
});

// TDS deducted on supplier payments.
router.get('/reports/tds', requirePermission('accounts.view'), async (req, res) => {
  const [from, to] = caPeriod(req);
  const r = await db.query(
    `SELECT b.id, b.bill_date, COALESCE(c.name,'—') AS party, c.gstin,
            b.tds_section, b.taxable_amount, b.tds_rate, b.tds_amount
       FROM acc_bill b LEFT JOIN acc_contact c ON c.id = b.contact_id
      WHERE b.status IN ('posted','paid') AND b.tds_amount > 0 AND b.bill_date BETWEEN $1 AND $2
      ORDER BY b.bill_date, b.id`, [from, to]);
  const rows = r.rows;
  res.json({
    from, to, rows,
    totals: {
      taxable: n2(rows.reduce((s, x) => s + Number(x.taxable_amount), 0)),
      tds: n2(rows.reduce((s, x) => s + Number(x.tds_amount), 0)),
    },
  });
});

// Spend grouped by supplier (expense debits attributed to the journal's contact).
router.get('/reports/spend-by-supplier', requirePermission('accounts.view'), async (req, res) => {
  const [from, to] = caPeriod(req);
  const r = await db.query(
    `SELECT j.contact_id, COALESCE(c.name, '(unassigned)') AS supplier,
            COALESCE(SUM(l.debit - l.credit), 0) AS spend
       FROM acc_journal j
       JOIN acc_journal_line l ON l.journal_id = j.id
       JOIN acc_account a ON a.id = l.account_id AND a.type = 'expense'
       LEFT JOIN acc_contact c ON c.id = j.contact_id
      WHERE j.status = 'posted' AND j.entry_date BETWEEN $1 AND $2
      GROUP BY j.contact_id, c.name
     HAVING COALESCE(SUM(l.debit - l.credit), 0) <> 0
      ORDER BY spend DESC`, [from, to]);
  const rows = r.rows.map(x => ({ contact_id: x.contact_id, supplier: x.supplier, spend: n2(x.spend) }));
  res.json({ from, to, rows, total: n2(rows.reduce((s, x) => s + x.spend, 0)) });
});

module.exports = router;
// Cron tick called from server.js's 06:00 task job.
module.exports.tickAccountsDailyTasks = tickAccountsDailyTasks;
// Engine exports for the test harness + cron wiring.
module.exports.engine = {
  seedChartOfAccounts, accountIdByTag, postJournal, computeBill, createBill, postBill,
  createInvoice, postInvoice, reverseJournal, trialBalance, profitAndLoss, balanceSheet,
  postOpeningBalances, lockPeriod, isPeriodLocked, period,
  generateAccountsDailyTasks, weekdayName, parseBankStatement, parseDmy,
};
