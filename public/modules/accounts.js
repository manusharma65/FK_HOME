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
    { key: 'reconcile', hash: '#accounts/reconcile', label: 'Reconcile', icon: 'ti-arrows-exchange' },
    { key: 'reports', hash: '#accounts/reports', label: 'Reports', icon: 'ti-chart-bar' },
    { key: 'chart', hash: '#accounts/chart', label: 'Chart of accounts', icon: 'ti-list-details' },
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
    .ov-card{background:var(--card,#fff);border:1px solid var(--line,#E8E0D3);border-radius:12px;padding:15px 17px}
    .ov-num{font-family:'Fraunces',Georgia,serif;font-weight:500;font-variant-numeric:tabular-nums}
    .ov-l{font-size:12px;color:var(--muted)}
    .ov-bar{border-radius:5px 5px 0 0}
    .rec-card{background:var(--card,#fff);border:1px solid var(--line,#E8E0D3);border-radius:12px;margin-bottom:12px;display:flex;overflow:hidden}
    .rec-left{flex:0 0 40%;padding:13px 15px;display:flex;gap:10px;align-items:flex-start}
    .rec-divide{width:1px;background:var(--line,#E8E0D3)}
    .rec-right{flex:1;padding:13px 15px;background:#FCFBF8}
    .rec-ico{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
    .rec-ico-in{background:#EAF3DE;color:#3B6D11}.rec-ico-out{background:#FAECE7;color:#D85A30}
    .rec-amt{font-family:'Fraunces',Georgia,serif;font-weight:500;font-variant-numeric:tabular-nums;font-size:17px;margin-top:5px}
    .rec-seg{font-size:12.5px;color:var(--muted);cursor:pointer;padding:0 0 4px;border:none;border-bottom:2px solid transparent;background:none;font-family:inherit}
    .rec-seg.on{color:var(--ink);font-weight:500;border-bottom-color:var(--orange)}
    .rec-lbl{font-size:11px;color:var(--muted);margin-bottom:3px;display:block}
    .rec-f{width:100%;padding:8px 10px;font-size:13px;font-family:inherit;border:1px solid var(--line,#D8D0C1);border-radius:8px;background:var(--bg);color:var(--ink);box-sizing:border-box}
    .rec-tab{padding:10px 18px;font-size:14px;font-family:inherit;border:none;background:none;color:var(--muted);cursor:pointer;border-radius:9px;display:inline-flex;align-items:center;gap:8px}
    .rec-tab.on{background:var(--ink);color:#fff;font-weight:500}
    .rec-cnt{font-size:11.5px;padding:1px 8px;border-radius:99px;background:rgba(0,0,0,.08)}.rec-tab.on .rec-cnt{background:rgba(255,255,255,.22)}
    .rec-pager .acct-btn{padding:7px 12px}.rec-pager .acct-btn.on{background:var(--ink);color:#fff;border-color:var(--ink)}
    </style>`;

  function tabBar(active) {
    return '<div class="acct-tabs">' + TABS.map(t =>
      '<button class="acct-tab' + (t.key === active ? ' on' : '') + '" onclick="location.hash=\'' + t.hash + '\'">' +
      '<i class="ti ' + t.icon + '"></i>' + t.label + '</button>').join('') + '</div>';
  }

  // ---------------- Overview ----------------
  // ---------------- Overview ----------------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monLabel(m) { if (!m) return ''; const [y, mm] = m.split('-'); return MONTHS[Number(mm) - 1] + ' ' + y; }
  function fmtShort(n) {
    n = Number(n || 0); const a = Math.abs(n); const sign = n < 0 ? '-' : '';
    if (a >= 1e7) return sign + '₹' + (a / 1e7).toFixed(1) + 'Cr';
    if (a >= 1e5) return sign + '₹' + (a / 1e5).toFixed(1) + 'L';
    if (a >= 1e3) return sign + '₹' + Math.round(a / 1e3) + 'k';
    return sign + '₹' + Math.round(a);
  }
  function bars(items, maxH) {
    const max = Math.max(1, ...items.map(i => i.v));
    return items.map(i => {
      const h = i.v > 0 ? Math.max(4, Math.round(maxH * i.v / max)) : 2;
      return '<div style="text-align:center"><div class="ov-bar" style="height:' + h + 'px;width:34px;background:' + i.c + '"></div>' +
        '<div class="ov-l" style="margin-top:6px">' + i.l + '</div>' + (i.s ? '<div style="font-size:12px;font-weight:500;color:' + i.sc + '">' + i.s + '</div>' : '') + '</div>';
    }).join('');
  }

  async function renderOverview(body) {
    const [o, op, sum, aging, cf] = await Promise.all([
      api('/overview'), api('/opening'), api('/bank/summary').catch(() => null),
      api('/reports/aging').catch(() => ({ receivables: [] })), api('/overview/cashflow').catch(() => null),
    ]);
    const unmatched = sum && sum.counts ? sum.counts.unmatched : 0;
    const stmtBal = sum ? sum.statement_balance : o.bank;
    const reconcileBtn = unmatched > 0
      ? '<button class="acct-btn primary" onclick="location.hash=\'#accounts/reconcile\'"><i class="ti ti-arrows-exchange"></i>Reconcile ' + unmatched + ' items</button>'
      : '<span style="display:inline-flex;align-items:center;gap:7px;color:var(--green,#3B6D11);font-size:14px"><i class="ti ti-circle-check"></i>Reconciled</span>';

    const ag = (aging.receivables || []).reduce((a, r) => ({
      b0: a.b0 + Number(r.b0 || 0), b30: a.b30 + Number(r.b30 || 0), b60: a.b60 + Number(r.b60 || 0), b90: a.b90 + Number(r.b90 || 0),
    }), { b0: 0, b30: 0, b60: 0, b90: 0 });
    const agTotal = ag.b0 + ag.b30 + ag.b60 + ag.b90;

    const cashCard = (cf && cf.month)
      ? '<div class="ov-card"><div style="font-size:13px;font-weight:500;margin-bottom:13px">Money in vs out · ' + esc(monLabel(cf.month)) + '</div>' +
          '<div style="display:flex;align-items:flex-end;gap:24px;height:104px;padding-left:4px">' +
            bars([{ l: 'In', v: cf.received, c: '#639922', s: fmtShort(cf.received), sc: '#3B6D11' }, { l: 'Out', v: cf.spent, c: '#D85A30', s: fmtShort(cf.spent), sc: '#993C1D' }], 90) +
            '<div style="border-left:1px dashed var(--line);align-self:stretch;margin:0 2px"></div>' +
            '<div style="align-self:center"><div class="ov-l">Net</div><div class="ov-num" style="font-size:19px;color:' + (cf.net >= 0 ? '#3B6D11' : '#A32D2D') + '">' + (cf.net >= 0 ? '+' : '') + fmtShort(cf.net) + '</div></div>' +
          '</div></div>'
      : '<div class="ov-card"><div style="font-size:13px;font-weight:500;margin-bottom:8px">Money in vs out</div><div class="acct-empty" style="padding:24px 8px">Import a statement to see your cashflow.</div></div>';

    const agingCard = agTotal > 0
      ? '<div class="ov-card"><div style="font-size:13px;font-weight:500;margin-bottom:13px">Receivables aging</div>' +
          '<div style="display:flex;align-items:flex-end;gap:14px;height:104px;justify-content:space-around">' +
            bars([{ l: '0–30', v: ag.b0, c: '#639922' }, { l: '31–60', v: ag.b30, c: '#FAC775' }, { l: '61–90', v: ag.b60, c: '#EF9F27' }, { l: '90+', v: ag.b90, c: '#E24B4A' }], 90) +
          '</div></div>'
      : '<div class="ov-card"><div style="font-size:13px;font-weight:500;margin-bottom:8px">Receivables aging</div><div class="acct-empty" style="padding:24px 8px">Nothing outstanding to age.</div></div>';

    const drafts = o.draft_bills + o.draft_invoices;
    const openingStrip = op.exists
      ? '<span style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)"><i class="ti ti-circle-check" style="color:var(--green,#3B6D11)"></i>Opening balances set · ' + esc(String(op.date).slice(0, 10)) + ' <button class="acct-btn ghost" id="opEdit" style="padding:4px 9px;font-size:12px">Edit</button></span>'
      : '<button class="acct-btn primary" id="opSet" style="padding:7px 13px"><i class="ti ti-adjustments"></i>Set opening balances</button>';

    body.innerHTML =
      '<div class="ov-card" style="border-left:4px solid #D4537E;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:13px">' +
        '<div style="display:flex;align-items:center;gap:13px"><div style="width:42px;height:42px;border-radius:10px;background:var(--canvas,#F4EFE7);display:flex;align-items:center;justify-content:center;color:#D4537E;font-size:20px"><i class="ti ti-building-bank"></i></div>' +
          '<div><div style="font-weight:500;font-size:15px">IDFC FIRST Bank</div><div class="ov-l">FK Enterprises · current account</div></div></div>' +
        '<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">' +
          '<div><div class="ov-num" style="font-size:20px">' + inr(stmtBal) + '</div><div class="ov-l">Statement balance</div></div>' +
          '<div style="width:1px;align-self:stretch;background:var(--line,#E8E0D3)"></div>' +
          '<div><div class="ov-num" style="font-size:20px">' + inr(o.bank) + '</div><div class="ov-l">Books balance</div></div>' +
          reconcileBtn +
        '</div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:13px;margin-bottom:13px">' +
        '<div class="ov-card"><div class="ov-l" style="display:flex;align-items:center;gap:6px;margin-bottom:5px"><i class="ti ti-arrow-down-left" style="color:#3B6D11"></i>FK Sports owes you</div><div class="ov-num" style="font-size:21px">' + inr(o.receivable) + '</div></div>' +
        '<div class="ov-card"><div class="ov-l" style="display:flex;align-items:center;gap:6px;margin-bottom:5px"><i class="ti ti-arrow-up-right" style="color:#D85A30"></i>Owed to suppliers</div><div class="ov-num" style="font-size:21px">' + inr(o.payable) + '</div></div>' +
        '<div class="ov-card"><div class="ov-l" style="display:flex;align-items:center;gap:6px;margin-bottom:5px"><i class="ti ti-receipt-tax" style="color:var(--muted)"></i>Net GST payable</div><div class="ov-num" style="font-size:21px">' + inr(r2(o.output_gst - o.input_gst)) + '</div><div class="ov-l" style="margin-top:3px">output ' + inr(o.output_gst) + ' − input ' + inr(o.input_gst) + '</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:13px">' + cashCard + agingCard + '</div>' +
      '<div class="ov-card" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center">' +
          '<button class="acct-btn" onclick="location.hash=\'#accounts/bills\'" style="padding:7px 13px"><i class="ti ti-plus"></i>New bill</button>' +
          '<button class="acct-btn" onclick="location.hash=\'#accounts/invoices\'" style="padding:7px 13px"><i class="ti ti-plus"></i>New invoice</button>' +
          (drafts ? '<span style="font-size:13px;color:var(--muted)"><strong style="font-weight:500;color:var(--ink)">' + drafts + '</strong> draft' + (drafts > 1 ? 's' : '') + ' to post</span>' : '') +
        '</div>' + openingStrip +
      '</div><div id="opFormWrap"></div>';
    const setBtn = document.getElementById('opSet'); if (setBtn) setBtn.addEventListener('click', () => renderOpeningForm(document.getElementById('opFormWrap')));
    const editBtn = document.getElementById('opEdit'); if (editBtn) editBtn.addEventListener('click', () => renderOpeningForm(document.getElementById('opFormWrap'), op));
  }

  // ---------------- Opening balances ----------------
  const OPENING_FIELDS = [
    { tag: 'idfc_bank', label: 'IDFC bank balance', side: 'debit' },
    { tag: 'accounts_receivable', label: 'FK Sports owes FK Enterprises', side: 'debit' },
    { tag: 'accounts_payable', label: 'Owed to suppliers', side: 'credit' },
    { tag: 'input_gst', label: 'GST input credit carried forward', side: 'debit' },
    { tag: 'output_gst', label: 'GST payable carried forward', side: 'credit' },
    { tag: 'tds_payable', label: 'TDS payable carried forward', side: 'credit' },
  ];
  function opSideLabel(side) { return side === 'debit' ? 'asset' : 'owed'; }

  async function renderOpeningForm(container, existing) {
    const { accounts } = await lookups();
    window.__opAcctOpts = accounts.map(a => '<option value="' + a.id + '">' + esc(a.code + ' · ' + a.name) + '</option>').join('');
    const pre = {}, others = [];
    if (existing && existing.lines) {
      for (const l of existing.lines) {
        if (l.system_tag === 'opening_balance_equity') continue; // auto plug — never edited directly
        const known = OPENING_FIELDS.find(f => f.tag === l.system_tag);
        const amt = Number(l.debit) > 0 ? Number(l.debit) : Number(l.credit);
        if (known) pre[l.system_tag] = amt; else others.push(l);
      }
    }
    const date = existing && existing.date ? String(existing.date).slice(0, 10) : '2026-03-31';
    const fieldRows = OPENING_FIELDS.map(f =>
      '<div class="acct-field"><label>' + f.label + ' (' + opSideLabel(f.side) + ')</label>' +
      '<input type="number" min="0" step="0.01" data-op-tag="' + f.tag + '" data-side="' + f.side + '" value="' + (pre[f.tag] || '') + '" oninput="window.__opCalc()"></div>').join('');
    container.innerHTML =
      '<div class="acct-card"><h3>' + (existing && existing.exists ? 'Edit opening balances' : 'Set opening balances') + '</h3>' +
      (existing && existing.exists ? '<div class="acct-msg" style="color:var(--muted);margin:0 0 12px">Saving replaces the previous opening entry — the old one is reversed and kept for the record.</div>' : '') +
      '<div class="acct-field" style="max-width:220px;margin-bottom:14px"><label>As at</label><input id="opDate" type="date" value="' + date + '"></div>' +
      '<div class="acct-form">' + fieldRows + '</div>' +
      '<div id="opOther"></div>' +
      '<div class="acct-actions" style="margin-top:10px"><button class="acct-btn ghost" id="opAddLine"><i class="ti ti-plus"></i>Add another line</button></div>' +
      '<div class="acct-net"><span style="color:var(--muted);font-size:13px">Balancing to Opening balance equity</span><span class="v" id="opPlug">₹0</span></div>' +
      '<div class="acct-actions" style="margin-top:14px"><button class="acct-btn primary" id="opSave"><i class="ti ti-check"></i>' + (existing && existing.exists ? 'Save changes' : 'Post opening balances') + '</button><button class="acct-btn ghost" id="opCancel">Cancel</button></div>' +
      '<div class="acct-msg" id="opMsg"></div></div>';
    others.forEach(o => addOpeningLine(o));
    document.getElementById('opAddLine').addEventListener('click', () => addOpeningLine());
    document.getElementById('opCancel').addEventListener('click', () => { container.innerHTML = ''; });
    document.getElementById('opSave').addEventListener('click', () => saveOpening(container));
    window.__opCalc();
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function addOpeningLine(line) {
    const wrap = document.getElementById('opOther');
    const row = document.createElement('div');
    row.className = 'acct-form op-other-row'; row.style.marginTop = '10px';
    row.innerHTML =
      '<div class="acct-field"><label>Account</label><select class="op-acct">' + window.__opAcctOpts + '</select></div>' +
      '<div class="acct-field"><label>Side</label><select class="op-side"><option value="debit">Debit (asset)</option><option value="credit">Credit (owed)</option></select></div>' +
      '<div class="acct-field"><label>Amount (₹)</label><input class="op-amt" type="number" min="0" step="0.01" oninput="window.__opCalc()"></div>' +
      '<div class="acct-field" style="align-self:end"><button class="acct-btn ghost op-del" title="Remove line"><i class="ti ti-trash"></i></button></div>';
    wrap.appendChild(row);
    if (line) {
      const acc = (accountsCache || []).find(a => a.system_tag === line.system_tag);
      if (acc) row.querySelector('.op-acct').value = acc.id;
      const side = Number(line.debit) > 0 ? 'debit' : 'credit';
      row.querySelector('.op-side').value = side;
      row.querySelector('.op-amt').value = Number(line.debit) > 0 ? line.debit : line.credit;
    }
    row.querySelector('.op-side').addEventListener('change', () => window.__opCalc());
    row.querySelector('.op-del').addEventListener('click', () => { row.remove(); window.__opCalc(); });
    window.__opCalc();
  }

  window.__opCalc = function () {
    let d = 0, c = 0;
    document.querySelectorAll('[data-op-tag]').forEach(inp => {
      const v = Number(inp.value || 0); if (!v) return;
      if (inp.getAttribute('data-side') === 'debit') d += v; else c += v;
    });
    document.querySelectorAll('.op-other-row').forEach(row => {
      const v = Number(row.querySelector('.op-amt').value || 0); if (!v) return;
      if (row.querySelector('.op-side').value === 'debit') d += v; else c += v;
    });
    const plug = r2(d - c), el = document.getElementById('opPlug'); if (!el) return;
    el.textContent = plug > 0 ? inr(plug) + ' (Cr)' : plug < 0 ? inr(-plug) + ' (Dr)' : '₹0 — already balanced';
  };

  async function saveOpening(container) {
    const msg = document.getElementById('opMsg'); msg.className = 'acct-msg';
    const items = [];
    document.querySelectorAll('[data-op-tag]').forEach(inp => {
      const v = Number(inp.value || 0); if (!v) return;
      items.push({ tag: inp.getAttribute('data-op-tag'), [inp.getAttribute('data-side')]: v });
    });
    document.querySelectorAll('.op-other-row').forEach(row => {
      const v = Number(row.querySelector('.op-amt').value || 0); if (!v) return;
      items.push({ account_id: Number(row.querySelector('.op-acct').value), [row.querySelector('.op-side').value]: v });
    });
    if (!items.length) { msg.className = 'acct-msg err'; msg.textContent = 'Enter at least one balance.'; return; }
    try {
      await api('/opening', { method: 'POST', body: JSON.stringify({ date: document.getElementById('opDate').value, items }) });
      const b = document.getElementById('acctBody'); if (b) await renderOverview(b);
    } catch (e) { msg.className = 'acct-msg err'; msg.textContent = e.message; }
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
      '<div class="acct-actions" style="margin-bottom:16px;flex-wrap:wrap">' +
        '<button class="acct-btn primary" id="rTB">Trial balance</button>' +
        '<button class="acct-btn" id="rPL">Profit &amp; loss</button>' +
        '<button class="acct-btn" id="rBS">Balance sheet</button>' +
        '<button class="acct-btn" id="rAR">AR aging</button>' +
        '<button class="acct-btn" id="rAP">AP aging</button>' +
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
    document.getElementById('rAR').addEventListener('click', async () => {
      const a = await api('/reports/aging'); out.innerHTML = agingTable('Receivables — what FK Sports owes you', a.receivables);
    });
    document.getElementById('rAP').addEventListener('click', async () => {
      const a = await api('/reports/aging'); out.innerHTML = agingTable('Payables — what you owe suppliers', a.payables);
    });
    document.getElementById('rTB').click();
  }

  function agingTable(title, rows) {
    if (!rows.length) return '<div class="acct-card"><h3>' + title + '</h3><div class="acct-empty">Nothing outstanding.</div></div>';
    const cell = v => inr(Number(v || 0));
    const tot = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    return '<div class="acct-card"><h3>' + title + '</h3><table class="acct"><thead><tr>' +
      '<th>Contact</th><th class="num">Current</th><th class="num">31–60</th><th class="num">61–90</th><th class="num">90+</th><th class="num">Total</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + esc(r.contact) + '</td><td class="num">' + cell(r.b0) + '</td><td class="num">' + cell(r.b30) + '</td><td class="num">' + cell(r.b60) + '</td><td class="num">' + cell(r.b90) + '</td><td class="num">' + cell(r.total) + '</td></tr>').join('') +
      '<tr style="font-weight:500"><td>Total</td><td class="num">' + cell(tot('b0')) + '</td><td class="num">' + cell(tot('b30')) + '</td><td class="num">' + cell(tot('b60')) + '</td><td class="num">' + cell(tot('b90')) + '</td><td class="num">' + cell(tot('total')) + '</td></tr>' +
      '</tbody></table></div>';
  }

  // ---------------- Reconcile ----------------
  async function renderReconcile(body) {
    const { accounts, contacts } = await lookups();
    window.__recAcctOpts = '<option value="">Choose account…</option>' +
      accounts.filter(a => a.system_tag !== 'idfc_bank')
        .map(a => '<option value="' + a.id + '">' + esc(a.code + ' · ' + a.name) + '</option>').join('');
    window.__recContactOpts = '<option value="">— who (optional) —</option>' +
      (contacts || []).map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    body.innerHTML =
      '<div id="recHeader"></div>' +
      '<div class="acct-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<div><h3 style="margin:0">Import a statement</h3><div style="font-size:13px;color:var(--muted);margin-top:3px">IDFC FIRST Excel export (.xlsx). A statement that overlaps one already imported will offer to replace it.</div></div>' +
        '<label class="acct-btn primary" style="cursor:pointer"><i class="ti ti-upload"></i>Choose file<input id="recFile" type="file" accept=".xlsx" style="display:none"></label>' +
      '</div><div class="acct-msg" id="recMsg"></div></div>' +
      '<div style="display:flex;gap:6px;background:var(--canvas,#F1EADF);padding:5px;border-radius:11px;width:fit-content;margin-bottom:16px">' +
        '<button class="rec-tab on" data-recview="unmatched">To reconcile <span class="rec-cnt" id="recCnt-unmatched">0</span></button>' +
        '<button class="rec-tab" data-recview="matched">Reconciled <span class="rec-cnt" id="recCnt-matched">0</span></button>' +
        '<button class="rec-tab" data-recview="ignored">Set aside <span class="rec-cnt" id="recCnt-ignored">0</span></button>' +
      '</div>' +
      '<div id="recList"><div class="acct-empty">Loading…</div></div>';
    document.getElementById('recFile').addEventListener('change', uploadStatement);
    body.querySelectorAll('[data-recview]').forEach(b => b.addEventListener('click', () => {
      body.querySelectorAll('[data-recview]').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); loadRecList(b.getAttribute('data-recview'));
    }));
    await refreshOpenDocs(); await loadSummary(); await loadRecList('unmatched');
  }

  async function refreshOpenDocs() {
    window.__recOpenInv = await api('/open-invoices').catch(() => []);
    window.__recOpenBill = await api('/open-bills').catch(() => []);
  }

  async function loadSummary() {
    const el = document.getElementById('recHeader'); if (!el) return;
    const s = await api('/bank/summary');
    const diffColour = s.difference === 0 ? 'var(--green,#3B6D11)' : 'var(--red)';
    el.innerHTML = '<div class="acct-kpis">' +
      '<div class="acct-kpi"><div class="l">Statement balance</div><div class="v">' + inr(s.statement_balance) + '</div></div>' +
      '<div class="acct-kpi"><div class="l">Books balance</div><div class="v">' + inr(s.books_balance) + '</div></div>' +
      '<div class="acct-kpi"><div class="l">Difference</div><div class="v" style="color:' + diffColour + '">' + inr(s.difference) + '</div></div>' +
      '<div class="acct-kpi"><div class="l">To reconcile</div><div class="v">' + s.counts.unmatched + '</div></div>' +
    '</div>';
    ['unmatched', 'matched', 'ignored'].forEach(k => { const c = document.getElementById('recCnt-' + k); if (c) c.textContent = s.counts[k]; });
  }

  const REC_PAGE = 50;
  async function loadRecList(view) {
    const el = document.getElementById('recList'); if (!el) return;
    el.innerHTML = '<div class="acct-empty">Loading…</div>';
    const lines = await api('/bank/lines?status=' + view);
    const suggMap = {};
    if (view === 'unmatched') { (await api('/bank/suggestions').catch(() => [])).forEach(s => { suggMap[s.line_id] = s; }); }
    window.__recState = { view, lines, suggMap, page: 1 };
    renderRecPage();
  }

  function currentRecView() { return (window.__recState && window.__recState.view) || 'unmatched'; }

  function renderRecPage() {
    const el = document.getElementById('recList'); const st = window.__recState; if (!el || !st) return;
    if (!st.lines.length) {
      el.innerHTML = '<div class="acct-empty">' + (st.view === 'unmatched' ? 'Nothing to reconcile — import a statement above.' : 'Nothing here.') + '</div>';
      return;
    }
    const pages = Math.ceil(st.lines.length / REC_PAGE);
    if (st.page > pages) st.page = pages;
    const start = (st.page - 1) * REC_PAGE;
    const slice = st.lines.slice(start, start + REC_PAGE);
    const bulk = st.view === 'unmatched';
    const toolbar = bulk
      ? '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);cursor:pointer"><input type="checkbox" id="recSelAll" onchange="window.__recSelAll(this.checked)"> Select all on this page</label>' +
          '<div id="recBulkBar" style="display:none;align-items:center;gap:9px;flex-wrap:wrap;background:var(--canvas);border-radius:10px;padding:8px 12px">' +
            '<span id="recBulkCount" style="font-size:13px;font-weight:500"></span>' +
            '<span style="font-size:12.5px;color:var(--muted)">code to</span>' +
            '<select id="recBulkAcct" class="rec-f" style="width:auto;min-width:190px">' + window.__recAcctOpts + '</select>' +
            '<button class="acct-btn primary" style="padding:7px 13px" onclick="window.__recBulkCode()">Code selected</button>' +
            '<button class="acct-btn ghost" style="padding:7px 9px" onclick="window.__recBulkClear()">Clear</button>' +
          '</div></div>'
      : '';
    el.innerHTML = toolbar + slice.map(l => recCard(l, st.suggMap[l.id], st.view)).join('') + pager(st.page, pages, st.lines.length, start, slice.length);
  }

  function pager(page, pages, total, start, shown) {
    if (pages <= 1) return '<div style="font-size:12.5px;color:var(--muted);margin-top:6px">' + total + ' line' + (total === 1 ? '' : 's') + '</div>';
    let nums = '';
    const set = new Set([1, pages, page, page - 1, page + 1]);
    let last = 0;
    for (let n = 1; n <= pages; n++) {
      if (!set.has(n) || n < 1) continue;
      if (last && n - last > 1) nums += '<span style="color:var(--muted);padding:0 4px">…</span>';
      nums += '<button class="acct-btn' + (n === page ? ' on' : '') + '" onclick="window.__recGoPage(' + n + ')">' + n + '</button>';
      last = n;
    }
    return '<div class="rec-pager" style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;flex-wrap:wrap;gap:10px">' +
      '<span style="font-size:12.5px;color:var(--muted)">Showing ' + (start + 1) + '–' + (start + shown) + ' of ' + total + '</span>' +
      '<div style="display:flex;gap:5px;align-items:center">' +
        '<button class="acct-btn" onclick="window.__recGoPage(' + (page - 1) + ')"' + (page === 1 ? ' disabled' : '') + '>‹ Prev</button>' + nums +
        '<button class="acct-btn" onclick="window.__recGoPage(' + (page + 1) + ')"' + (page === pages ? ' disabled' : '') + '>Next ›</button>' +
      '</div></div>';
  }

  window.__recGoPage = function (n) {
    const st = window.__recState; if (!st) return;
    const pages = Math.ceil(st.lines.length / REC_PAGE);
    st.page = Math.max(1, Math.min(pages, n)); renderRecPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function recCard(l, sugg, view) {
    const amt = Number(l.amount);
    const isIn = amt >= 0;
    const ico = isIn ? 'ti-arrow-down-left' : 'ti-arrow-up-right';
    const left =
      '<div class="rec-left">' +
        (view === 'unmatched' ? '<input type="checkbox" class="rec-chk" data-line="' + l.id + '" onchange="window.__recSelChanged()" style="margin-top:11px">' : '') +
        '<div class="rec-ico ' + (isIn ? 'rec-ico-in' : 'rec-ico-out') + '"><i class="ti ' + ico + '"></i></div>' +
        '<div style="min-width:0"><div style="font-size:11.5px;color:var(--muted)">' + esc(String(l.txn_date).slice(0, 10)) + '</div>' +
          '<div style="font-size:13px">' + esc(l.description || '') + '</div>' +
          '<div class="rec-amt" style="' + (isIn ? 'color:#3B6D11' : '') + '">' + inr(Math.abs(amt)) + '</div></div>' +
      '</div>';
    if (view !== 'unmatched') {
      const right = '<div class="rec-right" style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff">' +
        '<span style="font-size:12.5px;color:var(--muted)">' + (view === 'matched' ? 'Reconciled' : 'Set aside') + '</span>' +
        '<button class="acct-btn ghost" onclick="window.__recUndo(' + l.id + ')"><i class="ti ti-arrow-back-up"></i>Undo</button></div>';
      return '<div class="rec-card">' + left + '<div class="rec-divide"></div>' + right + '</div>';
    }
    const matchOn = !!sugg;
    const matchPane =
      '<div id="recpane-match-' + l.id + '" style="display:' + (matchOn ? 'block' : 'none') + '">' +
        (sugg
          ? '<div style="background:#EAF3DE;border-radius:8px;padding:8px 11px;font-size:12.5px;color:#3B6D11;margin-bottom:10px">' + (sugg.doc_type === 'invoice' ? 'Invoice #' : 'Bill #') + sugg.doc_id + (sugg.contact_name ? ' · ' + esc(sugg.contact_name) : '') + ' · ' + inr(sugg.amount) + '</div>' +
            '<div style="display:flex;justify-content:flex-end;gap:8px"><button class="acct-btn" onclick="window.__recMatch(' + l.id + ',' + amt + ')">Find another…</button><button class="acct-btn primary" onclick="window.__recMatchDoc(' + l.id + ",'" + sugg.doc_type + "'," + sugg.doc_id + ')">Match</button></div>'
          : '<div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">No suggested match.</div><div style="display:flex;justify-content:flex-end"><button class="acct-btn" onclick="window.__recMatch(' + l.id + ',' + amt + ')">Find &amp; match…</button></div>') +
      '</div>';
    const codePane =
      '<div id="recpane-code-' + l.id + '" style="display:' + (matchOn ? 'none' : 'block') + '">' +
        '<div style="display:flex;gap:8px;margin-bottom:9px">' +
          '<div style="flex:1"><span class="rec-lbl">What account</span><select class="rec-acct rec-f" data-line="' + l.id + '">' + window.__recAcctOpts + '</select></div>' +
          '<div style="flex:1"><span class="rec-lbl">Who</span><select id="recWho-' + l.id + '" class="rec-f">' + window.__recContactOpts + '</select></div>' +
        '</div>' +
        '<div style="margin-bottom:11px"><span class="rec-lbl">Why</span><input id="recWhy-' + l.id + '" class="rec-f" placeholder="Description (optional)"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px"><button class="acct-btn ghost" onclick="window.__recIgnore(' + l.id + ')">Set aside</button><button class="acct-btn primary" onclick="window.__recCode(' + l.id + ')">Code</button></div>' +
      '</div>';
    const right =
      '<div class="rec-right" id="recright-' + l.id + '">' +
        '<div style="display:flex;gap:16px;margin-bottom:11px;border-bottom:1px solid #EFE7DA">' +
          '<button class="rec-seg' + (matchOn ? ' on' : '') + '" id="recseg-match-' + l.id + '" onclick="window.__recSeg(' + l.id + ",'match')\">Match</button>" +
          '<button class="rec-seg' + (matchOn ? '' : ' on') + '" id="recseg-code-' + l.id + '" onclick="window.__recSeg(' + l.id + ",'code')\">Code</button>" +
        '</div>' + matchPane + codePane +
      '</div>';
    return '<div class="rec-card">' + left + '<div class="rec-divide"></div>' + right + '</div>';
  }

  window.__recSeg = function (id, mode) {
    document.getElementById('recseg-match-' + id).classList.toggle('on', mode === 'match');
    document.getElementById('recseg-code-' + id).classList.toggle('on', mode === 'code');
    document.getElementById('recpane-match-' + id).style.display = mode === 'match' ? 'block' : 'none';
    document.getElementById('recpane-code-' + id).style.display = mode === 'code' ? 'block' : 'none';
  };

  window.__recCode = async function (id) {
    const sel = document.querySelector('.rec-acct[data-line="' + id + '"]');
    if (!sel || !sel.value) { alert('Pick an account to code this to.'); return; }
    const who = document.getElementById('recWho-' + id);
    const why = document.getElementById('recWhy-' + id);
    const payload = { account_id: Number(sel.value) };
    if (who && who.value) payload.contact_id = Number(who.value);
    if (why && why.value.trim()) payload.note = why.value.trim();
    try { await api('/bank/lines/' + id + '/code', { method: 'POST', body: JSON.stringify(payload) }); await loadSummary(); await loadRecList('unmatched'); }
    catch (e) { alert(e.message); }
  };

  window.__recMatchDoc = async function (id, type, docId) {
    try { await api('/bank/lines/' + id + '/match', { method: 'POST', body: JSON.stringify({ doc_type: type, doc_id: docId }) }); await refreshOpenDocs(); await loadSummary(); await loadRecList('unmatched'); }
    catch (e) { alert(e.message); }
  };

  window.__recMatch = function (id, amt) {
    const type = amt > 0 ? 'invoice' : 'bill';
    const docs = amt > 0 ? (window.__recOpenInv || []) : (window.__recOpenBill || []);
    const pane = document.getElementById('recpane-match-' + id);
    if (!pane) return;
    if (!docs.length) { pane.innerHTML = '<div style="font-size:12.5px;color:var(--muted)">No open ' + (amt > 0 ? 'invoices' : 'bills') + ' to match against.</div>'; return; }
    const opts = docs.map(d => '<option value="' + d.id + '">' + (type === 'invoice'
      ? 'Inv #' + d.id + ' · ' + esc(d.contact_name || '—') + ' · ' + inr(d.amount_inr)
      : 'Bill #' + d.id + ' · ' + esc(d.contact_name || '—') + ' · ' + inr(d.net_payable)) + '</option>').join('');
    pane.innerHTML = '<select id="recMatchSel-' + id + '" class="rec-f" style="margin-bottom:10px">' + opts + '</select>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px"><button class="acct-btn ghost" onclick="window.__recReload()">Cancel</button><button class="acct-btn primary" onclick="window.__recMatchConfirm(' + id + ",'" + type + "')\">Match</button></div>";
  };

  window.__recMatchConfirm = async function (id, type) {
    const sel = document.getElementById('recMatchSel-' + id);
    try { await api('/bank/lines/' + id + '/match', { method: 'POST', body: JSON.stringify({ doc_type: type, doc_id: sel ? Number(sel.value) : null }) }); await refreshOpenDocs(); await loadSummary(); await loadRecList('unmatched'); }
    catch (e) { alert(e.message); }
  };

  window.__recIgnore = async function (id) {
    try { await api('/bank/lines/' + id + '/ignore', { method: 'POST' }); await loadSummary(); await loadRecList('unmatched'); }
    catch (e) { alert(e.message); }
  };
  window.__recUndo = async function (id) {
    try { await api('/bank/lines/' + id + '/unmatch', { method: 'POST' }); await refreshOpenDocs(); await loadSummary(); await loadRecList(currentRecView()); }
    catch (e) { alert(e.message); }
  };
  window.__recReload = function () { renderRecPage(); };

  window.__recSelAll = function (on) { document.querySelectorAll('.rec-chk').forEach(c => { c.checked = on; }); window.__recSelChanged(); };
  window.__recSelChanged = function () {
    const checked = document.querySelectorAll('.rec-chk:checked');
    const bar = document.getElementById('recBulkBar'); if (!bar) return;
    if (checked.length) { bar.style.display = 'flex'; document.getElementById('recBulkCount').textContent = checked.length + ' selected'; }
    else { bar.style.display = 'none'; const sa = document.getElementById('recSelAll'); if (sa) sa.checked = false; }
  };
  window.__recBulkClear = function () { document.querySelectorAll('.rec-chk').forEach(c => { c.checked = false; }); const sa = document.getElementById('recSelAll'); if (sa) sa.checked = false; window.__recSelChanged(); };
  window.__recBulkCode = async function () {
    const ids = Array.from(document.querySelectorAll('.rec-chk:checked')).map(c => Number(c.getAttribute('data-line')));
    if (!ids.length) return;
    const sel = document.getElementById('recBulkAcct');
    if (!sel || !sel.value) { alert('Pick an account to code these to.'); return; }
    try { await api('/bank/code-bulk', { method: 'POST', body: JSON.stringify({ line_ids: ids, account_id: Number(sel.value) }) }); await loadSummary(); await loadRecList('unmatched'); }
    catch (e) { alert(e.message); }
  };

  async function uploadStatement(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const msg = document.getElementById('recMsg'); msg.className = 'acct-msg'; msg.textContent = 'Importing…';
    const doUpload = async (replace) => {
      const fd = new FormData(); fd.append('file', file); if (replace) fd.append('replace', 'true');
      const r = await fetch(API + '/bank/import', { method: 'POST', credentials: 'include', body: fd });
      return { r, data: await r.json().catch(() => ({})) };
    };
    try {
      let { r, data } = await doUpload(false);
      if (r.status === 409 && data.needs_replace) {
        const ov = (data.overlaps || []).map(o => String(o.period_from).slice(0, 10) + ' to ' + String(o.period_to).slice(0, 10)).join(', ');
        if (confirm('A statement covering these dates is already imported (' + ov + '). Replace it with this file?')) {
          ({ r, data } = await doUpload(true));
        } else { msg.textContent = ''; return; }
      }
      if (!r.ok) { msg.className = 'acct-msg err'; msg.textContent = data.message || data.error || 'Import failed.'; return; }
      msg.className = 'acct-msg ok';
      msg.textContent = 'Imported ' + data.lines + ' transactions' + (data.replaced ? ' (replaced the previous statement)' : '') + '.';
      await loadSummary(); await loadRecList('unmatched');
    } catch (err) { msg.className = 'acct-msg err'; msg.textContent = err.message; }
  }

  // ---------------- Chart of accounts ----------------
  const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];
  const TYPE_LABEL = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
  const TAX_LABEL = { none: 'No GST', gst18: 'GST 18%', gst12: 'GST 12%', gst5: 'GST 5%', zero: 'Zero-rated' };
  let coaShowArchived = false;

  // Natural balance: assets/expenses are debit-positive, the rest credit-positive.
  function coaBalance(a) { const net = Number(a.net || 0); return (a.type === 'asset' || a.type === 'expense') ? net : -net; }

  async function renderChart(body) {
    const all = await api('/accounts/all');
    window.__coaAll = all;
    const visible = all.filter(a => coaShowArchived || !a.is_archived);
    let html =
      '<div class="acct-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<div><h3 style="margin:0">Chart of accounts</h3><div style="font-size:13px;color:var(--muted);margin-top:3px">The accounts your bills, invoices and bank coding post to. Control accounts (🔒) are fixed; the rest you can add, rename or archive.</div></div>' +
        '<div class="acct-actions">' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><input type="checkbox" id="coaArch"' + (coaShowArchived ? ' checked' : '') + '> Show archived</label>' +
          '<button class="acct-btn primary" id="coaAdd"><i class="ti ti-plus"></i>Add account</button>' +
        '</div>' +
      '</div><div id="coaFormWrap"></div></div>';

    for (const t of TYPE_ORDER) {
      const rows = visible.filter(a => a.type === t);
      if (!rows.length) continue;
      html += '<div class="acct-card"><h3>' + TYPE_LABEL[t] + '</h3><table class="acct"><thead><tr>' +
        '<th style="width:80px">Code</th><th>Name</th><th>Tax</th><th class="num">Balance</th><th style="width:180px"></th></tr></thead><tbody>' +
        rows.map(a => {
          const lock = a.is_system ? ' <span title="Control account — fixed" style="opacity:.6">🔒</span>' : '';
          const arch = a.is_archived ? ' <span class="acct-pill p-void">Archived</span>' : '';
          const acts = a.is_archived
            ? '<button class="acct-btn ghost" onclick="window.__coaUnarchive(' + a.id + ')"><i class="ti ti-arrow-back-up"></i>Restore</button>'
            : '<button class="acct-btn" onclick="window.__coaEdit(' + a.id + ')"><i class="ti ti-pencil"></i>Edit</button>' +
              (a.is_system ? '' : '<button class="acct-btn ghost" onclick="window.__coaArchive(' + a.id + ')">Archive</button>');
          return '<tr' + (a.is_archived ? ' style="opacity:.55"' : '') + '>' +
            '<td style="font-variant-numeric:tabular-nums">' + esc(a.code) + '</td>' +
            '<td>' + esc(a.name) + lock + arch + (a.description ? '<div style="font-size:12px;color:var(--muted)">' + esc(a.description) + '</div>' : '') + '</td>' +
            '<td style="font-size:13px;color:var(--muted)">' + (TAX_LABEL[a.tax_default] || 'No GST') + '</td>' +
            '<td class="num">' + inr(coaBalance(a)) + '</td>' +
            '<td><div class="acct-actions" style="justify-content:flex-end">' + acts + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    body.innerHTML = html;
    document.getElementById('coaArch').addEventListener('change', (e) => { coaShowArchived = e.target.checked; renderChart(body); });
    document.getElementById('coaAdd').addEventListener('click', () => coaOpenForm(null));
  }

  function coaOpenForm(acct) {
    const wrap = document.getElementById('coaFormWrap'); if (!wrap) return;
    const isEdit = !!acct, sys = !!(acct && acct.is_system);
    const v = acct || { code: '', name: '', type: 'expense', tax_default: 'none', description: '' };
    const typeOpts = TYPE_ORDER.map(t => '<option value="' + t + '"' + (v.type === t ? ' selected' : '') + '>' + TYPE_LABEL[t] + '</option>').join('');
    const taxOpts = Object.keys(TAX_LABEL).map(k => '<option value="' + k + '"' + (v.tax_default === k ? ' selected' : '') + '>' + TAX_LABEL[k] + '</option>').join('');
    wrap.innerHTML = '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line,#E8E0D3)">' +
      '<div class="acct-form">' +
        '<div class="acct-field"><label>Code</label><input id="coaCode" value="' + esc(v.code) + '"' + (sys ? ' disabled' : '') + '></div>' +
        '<div class="acct-field"><label>Name</label><input id="coaName" value="' + esc(v.name) + '"></div>' +
        '<div class="acct-field"><label>Type</label><select id="coaType"' + (sys ? ' disabled' : '') + '>' + typeOpts + '</select></div>' +
        '<div class="acct-field"><label>Default tax</label><select id="coaTax">' + taxOpts + '</select></div>' +
        '<div class="acct-field" style="grid-column:1/-1"><label>Description (optional)</label><input id="coaDesc" value="' + esc(v.description || '') + '"></div>' +
      '</div>' +
      (sys ? '<div style="font-size:12px;color:var(--muted);margin-top:8px">This is a control account — its code and type are fixed because the ledger posts to it. You can still rename it, add a description or change its default tax.</div>' : '') +
      '<div class="acct-actions" style="margin-top:12px">' +
        '<button class="acct-btn primary" id="coaSave">' + (isEdit ? 'Save changes' : 'Add account') + '</button>' +
        '<button class="acct-btn ghost" id="coaCancel">Cancel</button>' +
        '<span class="acct-msg" id="coaMsg"></span>' +
      '</div></div>';
    document.getElementById('coaCancel').addEventListener('click', () => { wrap.innerHTML = ''; });
    document.getElementById('coaSave').addEventListener('click', () => coaSave(isEdit ? acct.id : null, sys));
  }

  async function coaSave(id, sys) {
    const msg = document.getElementById('coaMsg'); msg.className = 'acct-msg'; msg.textContent = '';
    const payload = {
      name: document.getElementById('coaName').value.trim(),
      tax_default: document.getElementById('coaTax').value,
      description: document.getElementById('coaDesc').value.trim() || null,
    };
    if (!sys) { payload.code = document.getElementById('coaCode').value.trim(); payload.type = document.getElementById('coaType').value; }
    try {
      if (id) await api('/accounts/' + id, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/accounts', { method: 'POST', body: JSON.stringify(payload) });
      accountsCache = null; // coding dropdowns must pick up the change
      await renderChart(document.getElementById('acctBody'));
    } catch (e) { msg.className = 'acct-msg err'; msg.textContent = e.message; }
  }

  window.__coaEdit = function (id) { const a = (window.__coaAll || []).find(x => x.id === id); coaOpenForm(a); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  window.__coaArchive = async function (id) {
    if (!confirm('Archive this account? It stays in your history but won\u2019t show when coding.')) return;
    try { await api('/accounts/' + id + '/archive', { method: 'POST' }); accountsCache = null; await renderChart(document.getElementById('acctBody')); } catch (e) { alert(e.message); }
  };
  window.__coaUnarchive = async function (id) {
    try { await api('/accounts/' + id + '/unarchive', { method: 'POST' }); accountsCache = null; await renderChart(document.getElementById('acctBody')); } catch (e) { alert(e.message); }
  };

  window.fkModules['accounts'] = {
    title: 'Accounts',
    render() { return STYLE + '<div class="acct-wrap"><div class="acct-ctx">FK Enterprises · India books · INR</div><div id="acctBody"></div></div>'; },
    async mount(el, ctx) {
      const tab = activeTab(ctx && ctx.fullKey);
      const body = document.getElementById('acctBody');
      body.innerHTML = '<div class="acct-empty">Loading…</div>';
      try {
        if (tab === 'overview') await renderOverview(body);
        else if (tab === 'bills') await renderBills(body);
        else if (tab === 'invoices') await renderInvoices(body);
        else if (tab === 'reconcile') await renderReconcile(body);
        else if (tab === 'reports') await renderReports(body);
        else if (tab === 'chart') await renderChart(body);
      } catch (e) {
        body.innerHTML = '<div class="acct-card"><div class="acct-msg err">Could not load: ' + esc(e.message) + '</div></div>';
      }
    },
    unmount() { contactsCache = null; accountsCache = null; },
  };
})();
