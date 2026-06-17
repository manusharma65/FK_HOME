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
const { db } = require('../db');
const { requireAuth, requirePermission, logAudit } = require('../auth');

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
    `INSERT INTO acc_journal (entry_date, narration, source_type, source_id, status, reverses_journal_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [j.entry_date, j.narration || null, j.source_type, j.source_id || null,
     j.status || 'posted', j.reverses_journal_id || null, j.created_by || null]
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
    source_type: 'bill', source_id: billId, created_by: userId, lines,
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
    source_type: 'invoice', source_id: invoiceId, created_by: userId, lines,
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
      GROUP BY a.type, a.code, a.name ORDER BY a.sort`,
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


router.use(requireAuth);

router.get('/accounts', requirePermission('accounts.view'), async (req, res) => {
  const r = await db.query('SELECT * FROM acc_account WHERE NOT is_archived ORDER BY sort, code');
  res.json(r.rows);
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
  await lockPeriod(db, req.params.period, req.user.id, req.body?.note);
  await logAudit({ req, module: 'accounts', action: 'period.lock', target_type: 'acc_period', target_id: req.params.period });
  res.json({ ok: true });
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
router.get('/bills', requirePermission('accounts.view'), async (req, res) => {
  const where = req.query.status ? 'WHERE b.status = $1' : '';
  const r = await db.query(
    `SELECT b.*, c.name AS contact_name, a.name AS category_name
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
    `SELECT i.*, c.name AS contact_name
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

router.post('/opening', requirePermission('accounts.period.lock'), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const journalId = await postOpeningBalances(client, {
      date: req.body.date, items: req.body.items || [], created_by: req.user.id,
    });
    await client.query('COMMIT');
    await logAudit({ req, module: 'accounts', action: 'opening.post', target_type: 'acc_journal', target_id: journalId });
    res.json({ ok: true, journal_id: journalId });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

module.exports = router;
// Cron tick called from server.js's 06:00 task job.
module.exports.tickAccountsDailyTasks = tickAccountsDailyTasks;
// Engine exports for the test harness + cron wiring.
module.exports.engine = {
  seedChartOfAccounts, accountIdByTag, postJournal, computeBill, createBill, postBill,
  createInvoice, postInvoice, reverseJournal, trialBalance, profitAndLoss, balanceSheet,
  postOpeningBalances, lockPeriod, isPeriodLocked, period,
  generateAccountsDailyTasks, weekdayName,
};
