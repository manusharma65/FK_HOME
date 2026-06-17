// FK Home — Accounts (FINANCE) module. FK Enterprises India books.
// Ship 1: Overview, Bills, Invoices, Reports (trial balance / P&L / balance sheet).
// Bank reconcile = Ship 2; CA pack + attachments = Ship 3.
window.fkModules = window.fkModules || {};

(function () {
  const API = '/api/accounts';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const gbp = (n) => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  async function api(path, opts) {
    const r = await fetch(API + path, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  const TABS = [
    { key: 'overview', hash: '#accounts', label: 'Overview', icon: 'ti-layout-dashboard' },
    { key: 'bills', hash: '#accounts/bills', label: 'Bills', icon: 'ti-file-invoice' },
    { key: 'invoices', hash: '#accounts/invoices', label: 'Invoices', icon: 'ti-receipt' },
    { key: 'reports', hash: '#accounts/reports', label: 'Reports', icon: 'ti-chart-bar' },
  ];
  function activeTab(fullKey) {
    const seg = (fullKey || 'accounts').split('/')[1] || 'overview';
    return TABS.find(t => t.key === seg) ? seg : 'overview';
  }

  const STYLE = `
    <style>
    .acct-wrap{font-size:15px;color:var(--ink)}
    .acct-ctx{font-size:13px;color:var(--muted);margin:-4px 0 14px}
    .acct-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px;border-bottom:1px solid var(--line,#E8E0D3)}
    .acct-tab{display:flex;align-items:center;gap:7px;padding:9px 15px;font-size:14px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;background:none;border-top:none;border-left:none;border-right:none;font-family:inherit}
    .acct-tab.on{color:var(--ink);border-bottom-color:var(--orange);font-weight:500}
    .acct-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px}
    .acct-kpi{background:var(--canvas);border-radius:12px;padding:14px 16px}
    .acct-kpi .l{font-size:13px;color:var(--muted);margin-bottom:4px}
    .acct-kpi .v{font-size:21px;font-weight:500}
    .acct-card{background:var(--card,#fff);border:1px solid var(--line,#E8E0D3);border-radius:12px;padding:16px 18px;margin-bottom:16px}
    .acct-card h3{font-size:16px;margin:0 0 10px}
    table.acct{width:100%;border-collapse:collapse;font-size:14px}
    table.acct th{text-align:left;color:var(--muted);font-weight:500;font-size:13px;padding:8px 10px;border-bottom:1px solid var(--line,#E8E0D3)}
    table.acct td{padding:10px;border-bottom:1px solid var(--line,#F0EADF)}
    table.acct td.num,table.acct th.num{text-align:right;font-variant-numeric:tabular-nums}
    .acct-pill{font-size:12px;padding:3px 10px;border-radius:7px;font-weight:500}
    .p-draft{background:#F1EADF;color:#7a5a35}.p-posted{background:#E1F0EA;color:#0F6E56}
    .p-void{background:#EFE7E4;color:#8a857c}.p-reversed{background:#FBE3C3;color:#854F0B}
    .acct-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;font-size:14px;font-family:inherit;border-radius:9px;border:1px solid var(--line,#D8D0C1);background:var(--card,#fff);color:var(--ink);cursor:pointer}
    .acct-btn.primary{background:var(--orange);color:#fff;border-color:var(--orange);font-weight:500}
    .acct-btn.ghost{background:none}
    .acct-btn.danger{color:var(--red);border-color:#E6C9C9}
    .acct-btn:disabled{opacity:.5;cursor:default}
    .acct-actions{display:flex;gap:8px;flex-wrap:wrap}
    .acct-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
    .acct-field label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}
    .acct-field input,.acct-field select{width:100%;padding:9px 11px;font-size:14px;font-family:inherit;border:1px solid var(--line,#D8D0C1);border-radius:8px;background:var(--bg);color:var(--ink)}
    .acct-net{display:flex;justify-content:space-between;align-items:center;background:var(--canvas);border-radius:10px;padding:12px 15px;margin-top:14px}
    .acct-net .v{font-size:19px;font-weight:500}
    .acct-msg{font-size:13px;margin-top:10px}.acct-msg.err{color:var(--red)}.acct-msg.ok{color:var(--green,#3B6D11)}
    .acct-empty{padding:18px;text-align:center;color:var(--muted);font-size:14px}
    </style>`;

  function tabBar(active) {
    return '<div class="acct-tabs">' + TABS.map(t =>
      '<button class="acct-tab' + (t.key === active ? ' on' : '') + '" onclick="location.hash=\'' + t.hash + '\'">' +
      '<i class="ti ' + t.icon + '"></i>' + t.label + '</button>').join('') + '</div>';
  }

  // ---------------- Overview ----------------
  async function renderOverview(body) {
    const o = await api('/overview');
    const kpi = (l, v) => '<div class="acct-kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div></div>';
    body.innerHTML =
      '<div class="acct-kpis">' +
        kpi('IDFC bank', inr(o.bank)) +
        kpi('FK Sports owes', inr(o.receivable)) +
        kpi('Owed to suppliers', inr(o.payable)) +
        kpi('Net GST', inr(r2(o.output_gst - o.input_gst))) +
        kpi('TDS to deposit', inr(o.tds_payable)) +
        kpi('Drafts to post', (o.draft_bills + o.draft_invoices)) +
      '</div>' +
      '<div class="acct-card"><h3>Quick actions</h3><div class="acct-actions">' +
        '<button class="acct-btn primary" onclick="location.hash=\'#accounts/bills\'"><i class="ti ti-plus"></i>New bill</button>' +
        '<button class="acct-btn" onclick="location.hash=\'#accounts/invoices\'"><i class="ti ti-plus"></i>New invoice</button>' +
        '<button class="acct-btn ghost" onclick="location.hash=\'#accounts/reports\'"><i class="ti ti-chart-bar"></i>Reports</button>' +
      '</div>' +
      ((o.draft_bills + o.draft_invoices) ? '<div class="acct-msg" style="margin-top:12px;color:var(--muted)">You have ' + (o.draft_bills + o.draft_invoices) + ' draft(s) waiting to be posted to the books.</div>' : '') +
      '</div>';
  }

  // ---------------- Bills ----------------
  let contactsCache = null, accountsCache = null;
  async function lookups() {
    if (!contactsCache) contactsCache = await api('/contacts');
    if (!accountsCache) accountsCache = await api('/accounts');
    return { contacts: contactsCache, accounts: accountsCache };
  }
  function statusPill(s) { return '<span class="acct-pill p-' + s + '">' + s + '</span>'; }

  async function renderBills(body) {
    const { contacts, accounts } = await lookups();
    const expenses = accounts.filter(a => a.type === 'expense');
    const supplierOpts = contacts.filter(c => c.kind !== 'customer').map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    body.innerHTML =
      '<div class="acct-card"><h3>New bill</h3>' +
        '<div class="acct-form">' +
          '<div class="acct-field"><label>Supplier</label><select id="bSupplier"><option value="">— select —</option>' + supplierOpts + '<option value="__new">+ Add supplier…</option></select></div>' +
          '<div class="acct-field"><label>Bill date</label><input id="bDate" type="date" value="' + today() + '"></div>' +
          '<div class="acct-field"><label>Category</label><select id="bCat">' + expenses.map(a => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('') + '</select></div>' +
          '<div class="acct-field"><label>Taxable amount (₹)</label><input id="bAmt" type="number" min="0" step="0.01" oninput="window.__acctBillCalc()"></div>' +
          '<div class="acct-field"><label>GST rate %</label><input id="bGst" type="number" min="0" step="0.01" value="18" oninput="window.__acctBillCalc()"></div>' +
          '<div class="acct-field"><label>TDS section</label><select id="bTdsSec" onchange="window.__acctBillCalc()">' +
            '<option value="">None</option><option value="194C" data-rate="2">194C contractor (2%)</option>' +
            '<option value="194J" data-rate="10">194J professional (10%)</option><option value="194I" data-rate="10">194I rent (10%)</option></select></div>' +
          '<div class="acct-field"><label>TDS rate %</label><input id="bTds" type="number" min="0" step="0.01" value="0" oninput="window.__acctBillCalc()"></div>' +
        '</div>' +
        '<div class="acct-net"><span style="color:var(--muted);font-size:13px">Net payable to supplier</span><span class="v" id="bNet">₹0</span></div>' +
        '<div class="acct-actions" style="margin-top:14px"><button class="acct-btn primary" id="bSave"><i class="ti ti-check"></i>Save as draft</button></div>' +
        '<div class="acct-msg" id="bMsg"></div>' +
      '</div>' +
      '<div class="acct-card"><h3>Bills</h3><div id="bList"><div class="acct-empty">Loading…</div></div></div>';

    window.__acctBillCalc = function () {
      const amt = Number(document.getElementById('bAmt').value || 0);
      const gst = r2(amt * Number(document.getElementById('bGst').value || 0) / 100);
      const tds = r2(amt * Number(document.getElementById('bTds').value || 0) / 100);
      document.getElementById('bNet').textContent = inr(r2(amt + gst - tds));
    };
    document.getElementById('bTdsSec').addEventListener('change', function () {
      const rate = this.options[this.selectedIndex].getAttribute('data-rate') || 0;
      document.getElementById('bTds').value = rate; window.__acctBillCalc();
    });
    document.getElementById('bSupplier').addEventListener('change', async function () {
      if (this.value !== '__new') return;
      const name = prompt('New supplier name:'); this.value = '';
      if (!name) return;
      try { const c = await api('/contacts', { method: 'POST', body: JSON.stringify({ name, kind: 'supplier' }) }); contactsCache = null; await renderBills(body); document.getElementById('bSupplier').value = c.id; } catch (e) { alert(e.message); }
    });
    document.getElementById('bSave').addEventListener('click', async function () {
      const msg = document.getElementById('bMsg'); msg.className = 'acct-msg';
      try {
        await api('/bills', { method: 'POST', body: JSON.stringify({
          contact_id: document.getElementById('bSupplier').value || null,
          bill_date: document.getElementById('bDate').value,
          category_account_id: document.getElementById('bCat').value,
          taxable_amount: Number(document.getElementById('bAmt').value || 0),
          gst_rate: Number(document.getElementById('bGst').value || 0),
          tds_section: document.getElementById('bTdsSec').value || null,
          tds_rate: Number(document.getElementById('bTds').value || 0),
        }) });
        msg.className = 'acct-msg ok'; msg.textContent = 'Saved as draft.';
        document.getElementById('bAmt').value = ''; window.__acctBillCalc();
        await loadBillList();
      } catch (e) { msg.className = 'acct-msg err'; msg.textContent = e.message; }
    });
    await loadBillList();
  }

  async function loadBillList() {
    const el = document.getElementById('bList'); if (!el) return;
    const bills = await api('/bills');
    if (!bills.length) { el.innerHTML = '<div class="acct-empty">No bills yet.</div>'; return; }
    el.innerHTML = '<table class="acct"><thead><tr><th>Date</th><th>Supplier</th><th>Category</th><th class="num">Net</th><th>Status</th><th></th></tr></thead><tbody>' +
      bills.map(b => '<tr><td>' + esc(String(b.bill_date).slice(0, 10)) + '</td><td>' + esc(b.contact_name || '—') + '</td><td>' + esc(b.category_name || '—') + '</td>' +
        '<td class="num">' + inr(b.net_payable) + '</td><td>' + statusPill(b.status) + '</td><td class="acct-actions">' +
        (b.status === 'draft'
          ? '<button class="acct-btn primary" onclick="window.__acctBill(\'post\',' + b.id + ')">Post</button><button class="acct-btn danger" onclick="window.__acctBill(\'void\',' + b.id + ')">Void</button>'
          : b.status === 'posted'
            ? '<button class="acct-btn" onclick="window.__acctReverse(' + b.journal_id + ')">Reverse</button>'
            : '') +
        '</td></tr>').join('') + '</tbody></table>';
  }
  window.__acctBill = async function (action, id) {
    if (action === 'void' && !confirm('Void this draft bill? It will be kept but marked void.')) return;
    try { await api('/bills/' + id + '/' + action, { method: 'POST' }); await loadBillList(); } catch (e) { alert(e.message); }
  };
  window.__acctReverse = async function (journalId) {
    const reason = prompt('Reverse this posted entry — the original is kept and a dated reversal is recorded. Reason:');
    if (reason === null) return;
    try { await api('/journals/' + journalId + '/reverse', { method: 'POST', body: JSON.stringify({ reason }) }); await loadBillList(); if (document.getElementById('iList')) await loadInvoiceList(); } catch (e) { alert(e.message); }
  };

  // ---------------- Invoices ----------------
  async function renderInvoices(body) {
    const { contacts } = await lookups();
    const custOpts = contacts.filter(c => c.kind !== 'supplier').map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    body.innerHTML =
      '<div class="acct-card"><h3>New invoice</h3>' +
        '<div class="acct-form">' +
          '<div class="acct-field"><label>Customer</label><select id="iCust"><option value="">— select —</option>' + custOpts + '<option value="__new">+ Add customer…</option></select></div>' +
          '<div class="acct-field"><label>Invoice date</label><input id="iDate" type="date" value="' + today() + '"></div>' +
          '<div class="acct-field"><label>Tax treatment</label><select id="iTreat" onchange="window.__acctInvCalc()"><option value="export_zero">Export — zero-rated (LUT)</option><option value="domestic_gst">Domestic — GST</option></select></div>' +
          '<div class="acct-field"><label>Currency</label><select id="iCur" onchange="window.__acctInvCalc()"><option value="INR">INR</option><option value="GBP">GBP</option></select></div>' +
          '<div class="acct-field"><label>FX rate → INR</label><input id="iFx" type="number" min="0" step="0.0001" value="1" oninput="window.__acctInvCalc()"></div>' +
          '<div class="acct-field"><label>Amount</label><input id="iAmt" type="number" min="0" step="0.01" oninput="window.__acctInvCalc()"></div>' +
          '<div class="acct-field" id="iGstWrap" style="display:none"><label>GST rate %</label><input id="iGst" type="number" min="0" step="0.01" value="18" oninput="window.__acctInvCalc()"></div>' +
        '</div>' +
        '<div class="acct-net"><span style="color:var(--muted);font-size:13px">Booked to INR</span><span class="v" id="iInr">₹0</span></div>' +
        '<div class="acct-actions" style="margin-top:14px"><button class="acct-btn primary" id="iSave"><i class="ti ti-check"></i>Save as draft</button></div>' +
        '<div class="acct-msg" id="iMsg"></div>' +
      '</div>' +
      '<div class="acct-card"><h3>Invoices</h3><div id="iList"><div class="acct-empty">Loading…</div></div></div>';

    window.__acctInvCalc = function () {
      const dom = document.getElementById('iTreat').value === 'domestic_gst';
      document.getElementById('iGstWrap').style.display = dom ? '' : 'none';
      const amt = Number(document.getElementById('iAmt').value || 0);
      const fx = Number(document.getElementById('iFx').value || 1);
      const gst = dom ? r2(amt * Number(document.getElementById('iGst').value || 0) / 100) : 0;
      document.getElementById('iInr').textContent = inr(r2((amt + gst) * fx));
    };
    document.getElementById('iCust').addEventListener('change', async function () {
      if (this.value !== '__new') return;
      const name = prompt('New customer name:'); this.value = '';
      if (!name) return;
      try { const c = await api('/contacts', { method: 'POST', body: JSON.stringify({ name, kind: 'customer' }) }); contactsCache = null; await renderInvoices(body); document.getElementById('iCust').value = c.id; } catch (e) { alert(e.message); }
    });
    document.getElementById('iSave').addEventListener('click', async function () {
      const msg = document.getElementById('iMsg'); msg.className = 'acct-msg';
      try {
        await api('/invoices', { method: 'POST', body: JSON.stringify({
          contact_id: document.getElementById('iCust').value || null,
          invoice_date: document.getElementById('iDate').value,
          tax_treatment: document.getElementById('iTreat').value,
          currency: document.getElementById('iCur').value,
          fx_rate: Number(document.getElementById('iFx').value || 1),
          taxable_amount: Number(document.getElementById('iAmt').value || 0),
          gst_rate: document.getElementById('iTreat').value === 'domestic_gst' ? Number(document.getElementById('iGst').value || 0) : 0,
        }) });
        msg.className = 'acct-msg ok'; msg.textContent = 'Saved as draft.';
        document.getElementById('iAmt').value = ''; window.__acctInvCalc();
        await loadInvoiceList();
      } catch (e) { msg.className = 'acct-msg err'; msg.textContent = e.message; }
    });
    window.__acctInvCalc();
    await loadInvoiceList();
  }
  async function loadInvoiceList() {
    const el = document.getElementById('iList'); if (!el) return;
    const invs = await api('/invoices');
    if (!invs.length) { el.innerHTML = '<div class="acct-empty">No invoices yet.</div>'; return; }
    el.innerHTML = '<table class="acct"><thead><tr><th>Date</th><th>Customer</th><th>Treatment</th><th class="num">Amount</th><th class="num">INR</th><th>Status</th><th></th></tr></thead><tbody>' +
      invs.map(i => '<tr><td>' + esc(String(i.invoice_date).slice(0, 10)) + '</td><td>' + esc(i.contact_name || '—') + '</td>' +
        '<td>' + (i.tax_treatment === 'export_zero' ? 'Export 0%' : 'Domestic GST') + '</td>' +
        '<td class="num">' + (i.currency === 'GBP' ? gbp(i.taxable_amount) : inr(i.taxable_amount)) + '</td>' +
        '<td class="num">' + inr(i.amount_inr) + '</td><td>' + statusPill(i.status) + '</td><td class="acct-actions">' +
        (i.status === 'draft'
          ? '<button class="acct-btn primary" onclick="window.__acctInv(\'post\',' + i.id + ')">Post</button><button class="acct-btn danger" onclick="window.__acctInv(\'void\',' + i.id + ')">Void</button>'
          : i.status === 'posted'
            ? '<button class="acct-btn" onclick="window.__acctReverse(' + i.journal_id + ')">Reverse</button>'
            : '') +
        '</td></tr>').join('') + '</tbody></table>';
  }
  window.__acctInv = async function (action, id) {
    if (action === 'void' && !confirm('Void this draft invoice? It will be kept but marked void.')) return;
    try { await api('/invoices/' + id + '/' + action, { method: 'POST' }); await loadInvoiceList(); } catch (e) { alert(e.message); }
  };

  // ---------------- Reports ----------------
  async function renderReports(body) {
    body.innerHTML =
      '<div class="acct-actions" style="margin-bottom:16px">' +
        '<button class="acct-btn primary" id="rTB">Trial balance</button>' +
        '<button class="acct-btn" id="rPL">Profit &amp; loss</button>' +
        '<button class="acct-btn" id="rBS">Balance sheet</button>' +
      '</div><div id="rOut"></div>';
    const out = document.getElementById('rOut');
    document.getElementById('rTB').addEventListener('click', async () => {
      const tb = await api('/reports/trial-balance');
      out.innerHTML = '<div class="acct-card"><h3>Trial balance</h3><table class="acct"><thead><tr><th>Code</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>' +
        tb.rows.map(r => '<tr><td>' + esc(r.code) + '</td><td>' + esc(r.name) + '</td><td class="num">' + (r.debit ? inr(r.debit) : '') + '</td><td class="num">' + (r.credit ? inr(r.credit) : '') + '</td></tr>').join('') +
        '<tr style="font-weight:500"><td></td><td>Total</td><td class="num">' + inr(tb.total_debit) + '</td><td class="num">' + inr(tb.total_credit) + '</td></tr>' +
        '</tbody></table><div class="acct-msg ' + (tb.balanced ? 'ok' : 'err') + '">' + (tb.balanced ? 'Balanced.' : 'NOT balanced — check entries.') + '</div></div>';
    });
    document.getElementById('rPL').addEventListener('click', async () => {
      const pl = await api('/reports/profit-loss');
      out.innerHTML = '<div class="acct-card"><h3>Profit &amp; loss</h3>' +
        '<table class="acct"><tbody>' +
        '<tr><td>Income</td><td class="num">' + inr(pl.income) + '</td></tr>' +
        '<tr><td>Expenses</td><td class="num">' + inr(pl.expense) + '</td></tr>' +
        '<tr style="font-weight:500"><td>Net profit</td><td class="num">' + inr(pl.net_profit) + '</td></tr>' +
        '</tbody></table></div>';
    });
    document.getElementById('rBS').addEventListener('click', async () => {
      const bs = await api('/reports/balance-sheet');
      out.innerHTML = '<div class="acct-card"><h3>Balance sheet</h3><table class="acct"><tbody>' +
        '<tr><td>Assets</td><td class="num">' + inr(bs.assets) + '</td></tr>' +
        '<tr><td>Liabilities</td><td class="num">' + inr(bs.liabilities) + '</td></tr>' +
        '<tr><td>Equity (incl. profit ' + inr(bs.net_profit) + ')</td><td class="num">' + inr(bs.equity) + '</td></tr>' +
        '</tbody></table><div class="acct-msg ' + (bs.balanced ? 'ok' : 'err') + '">' + (bs.balanced ? 'Assets = liabilities + equity.' : 'Does not balance.') + '</div></div>';
    });
    document.getElementById('rTB').click();
  }

  window.fkModules['accounts'] = {
    title: 'Accounts',
    render() { return STYLE + '<div class="acct-wrap"><div class="acct-ctx">FK Enterprises · India books · INR</div><div id="acctTabs"></div><div id="acctBody"></div></div>'; },
    async mount(el, ctx) {
      const tab = activeTab(ctx && ctx.fullKey);
      document.getElementById('acctTabs').innerHTML = tabBar(tab);
      const body = document.getElementById('acctBody');
      body.innerHTML = '<div class="acct-empty">Loading…</div>';
      try {
        if (tab === 'overview') await renderOverview(body);
        else if (tab === 'bills') await renderBills(body);
        else if (tab === 'invoices') await renderInvoices(body);
        else if (tab === 'reports') await renderReports(body);
      } catch (e) {
        body.innerHTML = '<div class="acct-card"><div class="acct-msg err">Could not load: ' + esc(e.message) + '</div></div>';
      }
    },
    unmount() { contactsCache = null; accountsCache = null; },
  };
})();
