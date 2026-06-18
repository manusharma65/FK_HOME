// FK Home — Accounts (FINANCE) module. FK Enterprises India books.
// Ship 1: Overview, Bills, Invoices, Reports (trial balance / P&L / balance sheet).
// Bank reconcile = Ship 2; CA pack + attachments = Ship 3.
window.fkModules = window.fkModules || {};

(function () {
  const API = '/api/accounts';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function whoOptsFor(line) {
    const contacts = window.__recContacts || [];
    const sug = String((line && line.suggested_payee) || '').trim();
    const match = sug ? contacts.find(c => String(c.name || '').toLowerCase() === sug.toLowerCase()) : null;
    let html = '<option value="">— who (optional) —</option>';
    if (sug && !match) html += '<option value="__use" data-name="' + esc(sug) + '" selected>＋ Add &quot;' + esc(sug) + '&quot;</option>';
    html += '<option value="__add">＋ Add a contact…</option>';
    html += contacts.map(c => '<option value="' + c.id + '"' + (match && match.id === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
    return html;
  }
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

  // ---------- File attachments (shared across bills / invoices / reconcile) ----------
  // kind ∈ {bill, invoice, bank}. Renders a paperclip control; chips load lazily.
  function attControl(kind, id, count) {
    const c = Number(count || 0);
    return '<span class="att-wrap" id="att-' + kind + '-' + id + '">' +
      (c > 0 ? '<button class="att-count" onclick="window.__att(\'' + kind + '\',' + id + ')"><i class="ti ti-paperclip"></i>' + c + '</button>' : '') +
      '<button class="att-add" onclick="window.__attAdd(\'' + kind + '\',' + id + ')"><i class="ti ti-paperclip"></i>Attach</button></span>';
  }
  window.__att = async function (kind, id) {
    const wrap = document.getElementById('att-' + kind + '-' + id); if (!wrap) return;
    let files = [];
    try { files = await api('/attachments?' + kind + '_id=' + id); } catch (e) { alert(e.message); return; }
    const chips = files.map(f => '<span class="att-chip"><a href="' + API + '/attachments/' + f.id + '" target="_blank" rel="noopener"><i class="ti ti-file"></i>' + esc(f.filename) + '</a><button title="Remove" onclick="window.__attDel(\'' + kind + '\',' + id + ',' + f.id + ')">✕</button></span>').join('');
    wrap.innerHTML = chips + '<button class="att-add" onclick="window.__attAdd(\'' + kind + '\',' + id + ')"><i class="ti ti-paperclip"></i>Attach</button>';
  };
  window.__attAdd = function (kind, id) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf,image/*'; inp.style.display = 'none';
    inp.onchange = function () { if (inp.files && inp.files[0]) window.__attUpload(kind, id, inp.files[0]); inp.remove(); };
    document.body.appendChild(inp); inp.click();
  };
  window.__attUpload = async function (kind, id, file) {
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await fetch(API + '/attachments?' + kind + '_id=' + id, { method: 'POST', credentials: 'include', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      await window.__att(kind, id);
    } catch (e) { alert(e.message); }
  };
  window.__attDel = async function (kind, id, attId) {
    if (!window.confirm('Remove this file?')) return;
    try { await api('/attachments/' + attId, { method: 'DELETE' }); await window.__att(kind, id); } catch (e) { alert(e.message); }
  };

  const TABS = [
    { key: 'overview', hash: '#accounts', label: 'Overview', icon: 'ti-layout-dashboard' },
    { key: 'bills', hash: '#accounts/bills', label: 'Bills', icon: 'ti-file-invoice' },
    { key: 'invoices', hash: '#accounts/invoices', label: 'Invoices', icon: 'ti-receipt' },
    { key: 'credits', hash: '#accounts/credits', label: 'Credits', icon: 'ti-discount' },
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
    .rec-card{display:flex;gap:14px;margin-bottom:14px;align-items:stretch}
    .rec-tx{flex:0 0 48%;display:flex;gap:11px;align-items:center;padding:14px 15px;border-radius:12px;border:1px solid var(--line,#E8E0D3)}
    .rec-tx.rec-in{background:#EAF2DC;border-color:#D5E5BD}
    .rec-tx.rec-out{background:#FAE7DC;border-color:#EFD8C9}
    .rec-code{flex:1;padding:14px 15px;border-radius:12px;background:var(--card,#fff);border:1px solid var(--line,#E8E0D3);box-shadow:0 1px 2px rgba(20,22,27,.05)}
    .rec-col{width:104px;text-align:right;flex-shrink:0}
    .rec-hd{font-size:11px;color:var(--muted);margin-bottom:3px}
    .rec-ico{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
    .rec-ico-in{background:#EAF3DE;color:#3B6D11}.rec-ico-out{background:#FAECE7;color:#D85A30}
    .rec-amt{font-family:'Fraunces',Georgia,serif;font-weight:500;font-variant-numeric:tabular-nums;font-size:17px;margin-top:5px}
    .rec-seg{font-size:12.5px;color:var(--muted);cursor:pointer;padding:0 0 4px;border:none;border-bottom:2px solid transparent;background:none;font-family:inherit}
    .rec-seg.on{color:var(--ink);font-weight:500;border-bottom-color:var(--orange)}
    .rec-lbl{font-size:11px;color:var(--muted);margin-bottom:3px;display:block}
    .rec-f{width:100%;padding:8px 10px;font-size:13px;font-family:inherit;border:1px solid var(--line,#D8D0C1);border-radius:8px;background:#fff;color:var(--ink);box-sizing:border-box}
    .rec-tab{padding:10px 18px;font-size:14px;font-family:inherit;border:none;background:none;color:var(--muted);cursor:pointer;border-radius:9px;display:inline-flex;align-items:center;gap:8px}
    .rec-tab.on{background:var(--ink);color:#fff;font-weight:500}
    .rec-cnt{font-size:11.5px;padding:1px 8px;border-radius:99px;background:rgba(0,0,0,.08)}.rec-tab.on .rec-cnt{background:rgba(255,255,255,.22)}
    .rec-pager .acct-btn{padding:7px 12px}.rec-pager .acct-btn.on{background:var(--ink);color:#fff;border-color:var(--ink)}
    .att-wrap{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
    .att-add{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-family:inherit;color:var(--muted);background:none;border:1px dashed var(--line,#D8D0C1);border-radius:7px;padding:4px 9px;cursor:pointer}
    .att-add:hover{color:var(--ink);border-color:var(--muted)}
    .att-count{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-family:inherit;color:var(--ink);background:var(--canvas,#F4EFE7);border:1px solid var(--line,#E8E0D3);border-radius:7px;padding:4px 9px;cursor:pointer}
    .att-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;background:#fff;border:1px solid var(--line,#E8E0D3);border-radius:7px;padding:3px 4px 3px 9px;max-width:230px}
    .att-chip a{display:inline-flex;align-items:center;gap:5px;color:var(--ink);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .att-chip a:hover{color:var(--orange)}
    .att-chip button{border:none;background:none;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;padding:2px 4px}
    .att-chip button:hover{color:var(--red,#A32D2D)}
    .ca-seg{display:inline-flex;background:var(--canvas,#F4EFE7);border-radius:12px;padding:5px;gap:4px}
    .ca-seg button{font-family:inherit;font-size:13.5px;font-weight:500;border:none;background:transparent;color:var(--muted);padding:8px 16px;border-radius:9px;cursor:pointer}
    .ca-seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.07)}
    .ca-pill{font-family:inherit;font-size:13px;border:1px solid var(--line,#E8E0D3);background:#fff;border-radius:9px;padding:8px 14px;cursor:pointer;color:var(--ink)}
    .ca-pill.on{background:var(--ink);color:#fff;border-color:var(--ink)}
    .ca-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
    .ca-kpi{background:var(--card,#fff);border:1px solid var(--line,#E8E0D3);border-radius:13px;padding:14px 16px}
    .ca-kpi .l{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;margin-bottom:7px}
    .ca-kpi .v{font-family:'Fraunces',Georgia,serif;font-size:23px;font-weight:600}
    .ca-kpi .v.green{color:var(--green,#3B6D11)} .ca-kpi .v.coral{color:#993C1D}
    .ca-kpi .d{font-size:11.5px;color:var(--muted);margin-top:2px}
    .ca-send{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-top:1px solid var(--line,#E8E0D3);padding-top:16px;margin-top:16px}
    .ca-recip{font-size:13px;color:var(--muted)} .ca-recip b{color:var(--ink)} .ca-recip a{color:var(--orange,#E8722B);text-decoration:none;margin-left:6px;cursor:pointer}
    .bill-2col{display:grid;grid-template-columns:1.08fr .92fr;gap:26px;align-items:start}
    @media(max-width:880px){.bill-2col{grid-template-columns:1fr}}
    .vch{background:linear-gradient(180deg,#fff,#fffdfa);border:1px solid var(--line,#E8E0D3);border-radius:14px;overflow:hidden;box-shadow:0 10px 30px -20px rgba(60,40,20,.45)}
    .vch-top{background:var(--canvas,#F4EFE7);padding:15px 18px;border-bottom:1px dashed #d8cdba;display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
    .vch-tag{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
    .vch-name{font-size:17px;font-weight:600;font-family:'Fraunces',Georgia,serif;margin-top:3px}
    .vch-stamp{font-size:10.5px;font-weight:600;color:#993C1D;border:1.4px solid var(--coral,#D85A30);border-radius:7px;padding:3px 8px;transform:rotate(-4deg);letter-spacing:.04em;white-space:nowrap}
    .vch-stamp.in{color:#1f4d8a;border-color:#3f6fb0}
    .vch-lad{padding:6px 18px 2px}
    .vch-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1ebe0;font-size:13.5px}
    .vch-row .lab small{color:var(--muted);display:block;font-size:11px;margin-top:1px}
    .vch-row .val{font-family:'Fraunces',Georgia,serif;font-size:15px;font-weight:500}
    .vch-chip{display:inline-flex;align-items:center;font-size:10.5px;font-weight:600;border-radius:20px;padding:2px 8px;margin-left:7px}
    .vch-chip.add{background:#eaf3de;color:var(--green,#3B6D11)} .vch-chip.less{background:#fbe7de;color:#993C1D}
    .vch-net{background:var(--ink,#14161B);color:#fff;display:flex;justify-content:space-between;align-items:center;padding:15px 18px}
    .vch-net .l{font-size:12px;color:#cdc6ba} .vch-net .v{font-family:'Fraunces',Georgia,serif;font-size:24px;font-weight:600}
    .vch-perf{height:13px;background:radial-gradient(circle at 6.5px -2px,transparent 5.5px,#fff 5.5px) repeat-x;background-size:13px 13px}
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

  async function renderOverview(body) {
    const [o, op, sum, aging, cf, spend, recent] = await Promise.all([
      api('/overview'), api('/opening'), api('/bank/summary').catch(() => null),
      api('/reports/aging').catch(() => ({ receivables: [] })), api('/overview/cashflow').catch(() => null),
      api('/overview/spending').catch(() => ({ total: 0, segments: [] })),
      api('/overview/recent').catch(() => []),
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

    const plot = (items, maxH, w, gap) => {
      const max = Math.max(1, ...items.map(i => i.v));
      const b = items.map(i => '<div class="ov-bar" style="height:' + (i.v > 0 ? Math.max(4, Math.round(maxH * i.v / max)) : 2) + 'px;width:' + w + 'px;background:' + i.c + '"></div>').join('');
      const l = items.map(i => '<div style="width:' + w + 'px;text-align:center"><div class="ov-l">' + i.l + '</div>' + (i.s ? '<div style="font-size:12px;font-weight:500;color:' + i.sc + '">' + i.s + '</div>' : '') + '</div>').join('');
      return '<div><div style="display:flex;gap:' + gap + 'px;align-items:flex-end;height:110px">' + b + '</div>' +
        '<div style="display:flex;gap:' + gap + 'px;margin-top:8px">' + l + '</div></div>';
    };
    const graphStyle = 'min-height:212px';

    const cashCard = (cf && cf.month)
      ? '<div class="ov-card" style="' + graphStyle + '"><div style="font-size:13px;font-weight:500;margin-bottom:18px">Money in vs out · ' + esc(monLabel(cf.month)) + '</div>' +
          '<div style="display:flex;gap:30px;align-items:center">' +
            plot([{ l: 'In', v: cf.received, c: '#639922', s: fmtShort(cf.received), sc: '#3B6D11' }, { l: 'Out', v: cf.spent, c: '#D85A30', s: fmtShort(cf.spent), sc: '#993C1D' }], 100, 46, 20) +
            '<div style="border-left:1px dashed var(--line);align-self:stretch;margin:0"></div>' +
            '<div><div class="ov-l">Net this month</div><div class="ov-num" style="font-size:20px;color:' + (cf.net >= 0 ? '#3B6D11' : '#A32D2D') + '">' + (cf.net >= 0 ? '+' : '') + fmtShort(cf.net) + '</div></div>' +
          '</div></div>'
      : '<div class="ov-card" style="' + graphStyle + '"><div style="font-size:13px;font-weight:500;margin-bottom:8px">Money in vs out</div><div class="acct-empty" style="padding:40px 8px">Import a statement to see your cashflow.</div></div>';

    const agingCard = agTotal > 0
      ? '<div class="ov-card" style="' + graphStyle + '"><div style="font-size:13px;font-weight:500;margin-bottom:18px">Receivables aging</div>' +
          '<div style="display:flex;justify-content:center">' +
            plot([{ l: '0–30', v: ag.b0, c: '#639922' }, { l: '31–60', v: ag.b30, c: '#FAC775' }, { l: '61–90', v: ag.b60, c: '#EF9F27' }, { l: '90+', v: ag.b90, c: '#E24B4A' }], 100, 40, 18) +
          '</div></div>'
      : '<div class="ov-card" style="' + graphStyle + '"><div style="font-size:13px;font-weight:500;margin-bottom:8px">Receivables aging</div><div class="acct-empty" style="padding:40px 8px">Nothing outstanding to age.</div></div>';

    const netGst = r2(o.output_gst - o.input_gst);
    const palette = ['#639922', '#E8722B', '#EF9F27', '#D4537E', '#1D9E75', '#B4B2A9'];
    const donutCard = (spend && spend.total > 0)
      ? (() => {
          let acc = 0; const stops = []; const legend = [];
          spend.segments.forEach((s, i) => {
            const pct = s.amount / spend.total * 100; const c = palette[i % palette.length];
            stops.push(c + ' ' + acc.toFixed(2) + '% ' + (acc + pct).toFixed(2) + '%');
            legend.push('<div style="display:flex;align-items:center;gap:8px;font-size:12.5px"><span style="width:10px;height:10px;border-radius:3px;flex-shrink:0;background:' + c + '"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name) + '</span><span style="margin-left:auto;color:var(--muted)">' + Math.round(pct) + '%</span></div>');
            acc += pct;
          });
          return '<div class="ov-card" style="' + graphStyle + '"><div style="font-size:13px;font-weight:500;margin-bottom:14px">Where money goes · to date</div>' +
            '<div style="display:flex;align-items:center;gap:18px">' +
              '<div style="width:128px;height:128px;border-radius:50%;flex-shrink:0;background:conic-gradient(' + stops.join(',') + ');display:flex;align-items:center;justify-content:center">' +
                '<div style="width:80px;height:80px;border-radius:50%;background:var(--card,#fff);display:flex;flex-direction:column;align-items:center;justify-content:center"><div class="ov-num" style="font-size:16px">' + fmtShort(spend.total) + '</div><div class="ov-l" style="font-size:10.5px">spent</div></div>' +
              '</div>' +
              '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:7px">' + legend.join('') + '</div>' +
            '</div></div>';
        })()
      : '<div class="ov-card" style="' + graphStyle + '"><div style="font-size:13px;font-weight:500;margin-bottom:8px">Where money goes · to date</div><div class="acct-empty" style="padding:40px 8px">No spending recorded yet. Code some expenses to see the breakdown.</div></div>';

    const dirIco = d => d === 'in' ? '<i class="ti ti-arrow-down-left" style="color:#3B6D11"></i>' : '<i class="ti ti-arrow-up-right" style="color:#D85A30"></i>';
    const recentCard = (recent && recent.length)
      ? '<div class="ov-card" style="' + graphStyle + '"><div style="font-size:13px;font-weight:500;margin-bottom:14px">Recent activity</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px">' +
            recent.map(t => '<div style="display:flex;align-items:center;gap:9px;font-size:12.5px">' + dirIco(t.direction) +
              '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.account_name || t.narration || 'Bank entry') + '</span>' +
              '<span style="margin-left:auto;white-space:nowrap;' + (t.direction === 'in' ? 'color:#3B6D11' : '') + '">' + (t.direction === 'in' ? '+' : '−') + inr(t.amount) + '</span></div>').join('') +
          '</div></div>'
      : '<div class="ov-card" style="' + graphStyle + '"><div style="font-size:13px;font-weight:500;margin-bottom:8px">Recent activity</div><div class="acct-empty" style="padding:40px 8px">Nothing coded yet. Reconcile some transactions to see them here.</div></div>';

    const gstStat = (l, v, c) => '<div><div class="ov-l">' + l + '</div><div class="ov-num" style="font-size:22px' + (c ? ';color:' + c : '') + '">' + v + '</div></div>';
    const gstPanel = '<div class="ov-card" style="margin-bottom:13px">' +
      '<div style="font-size:13px;font-weight:500;margin-bottom:15px;display:flex;align-items:center;gap:7px"><i class="ti ti-receipt-tax" style="color:var(--muted)"></i>GST position</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:18px">' +
        gstStat('Output GST (collected)', inr(o.output_gst)) +
        gstStat('Input GST (paid)', inr(o.input_gst)) +
        gstStat(netGst >= 0 ? 'Net GST payable' : 'Net GST reclaimable', inr(Math.abs(netGst)), netGst >= 0 ? '#A32D2D' : '#3B6D11') +
        gstStat('TDS to deposit', inr(o.tds_payable)) +
      '</div></div>';

    const receivableCard = '<div class="ov-card"><div class="ov-l" style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><i class="ti ti-arrow-down-left" style="color:#3B6D11"></i>FK Sports owes you</div><div class="ov-num" style="font-size:22px">' + inr(o.receivable) + '</div></div>';
    const payableCard = '<div class="ov-card"><div class="ov-l" style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><i class="ti ti-arrow-up-right" style="color:#D85A30"></i>Owed to suppliers</div><div class="ov-num" style="font-size:22px">' + inr(o.payable) + '</div></div>';
    const netGstCard = '<div class="ov-card"><div class="ov-l" style="margin-bottom:6px">' + (netGst >= 0 ? 'Net GST payable' : 'Net GST reclaimable') + '</div><div class="ov-num" style="font-size:22px;color:' + (netGst >= 0 ? '#A32D2D' : '#3B6D11') + '">' + inr(Math.abs(netGst)) + '</div></div>';

    const drafts = o.draft_bills + o.draft_invoices;
    const openingStrip = op.exists
      ? '<span style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)"><i class="ti ti-circle-check" style="color:var(--green,#3B6D11)"></i>Opening balances set · ' + esc(String(op.date).slice(0, 10)) + ' <button class="acct-btn ghost" id="opEdit" style="padding:4px 9px;font-size:12px">Edit</button></span>'
      : '<button class="acct-btn primary" id="opSet" style="padding:7px 13px"><i class="ti ti-adjustments"></i>Set opening balances</button>';
    const strip = '<div class="ov-card" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">' +
      '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center">' +
        '<button class="acct-btn" onclick="location.hash=\'#accounts/bills\'" style="padding:7px 13px"><i class="ti ti-plus"></i>New bill</button>' +
        '<button class="acct-btn" onclick="location.hash=\'#accounts/invoices\'" style="padding:7px 13px"><i class="ti ti-plus"></i>New invoice</button>' +
        (drafts ? '<span style="font-size:13px;color:var(--muted)"><strong style="font-weight:500;color:var(--ink)">' + drafts + '</strong> draft' + (drafts > 1 ? 's' : '') + ' to post</span>' : '') +
      '</div>' + openingStrip + '</div>';

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
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:13px">' + donutCard + cashCard + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px;margin-bottom:13px">' + receivableCard + payableCard + netGstCard + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:13px">' + agingCard + recentCard + '</div>' +
      gstPanel + strip + '<div id="opFormWrap"></div>';
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
    let bfHint = '';
    if (!(existing && existing.exists)) {
      const sum = await api('/bank/summary').catch(() => null);
      if (sum && sum.brought_forward != null) {
        if (pre['idfc_bank'] == null) pre['idfc_bank'] = sum.brought_forward;
        bfHint = '<div class="acct-msg" style="color:var(--muted);margin:0 0 12px;line-height:1.5">Suggested IDFC opening of <strong>' + inr(sum.brought_forward) + '</strong> — your statement\'s brought-forward balance (the figure <em>before</em> the first transaction). Don\'t enter the closing balance here, or coding the statement will double-count the year.</div>';
      }
    }
    const date = existing && existing.date ? String(existing.date).slice(0, 10) : '2026-03-31';
    const fieldRows = OPENING_FIELDS.map(f =>
      '<div class="acct-field"><label>' + f.label + ' (' + opSideLabel(f.side) + ')</label>' +
      '<input type="number" min="0" step="0.01" data-op-tag="' + f.tag + '" data-side="' + f.side + '" value="' + (pre[f.tag] || '') + '" oninput="window.__opCalc()"></div>').join('');
    container.innerHTML =
      '<div class="acct-card"><h3>' + (existing && existing.exists ? 'Edit opening balances' : 'Set opening balances') + '</h3>' +
      (existing && existing.exists ? '<div class="acct-msg" style="color:var(--muted);margin:0 0 12px">Saving replaces the previous opening entry — the old one is reversed and kept for the record.</div>' : '') + bfHint +
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
        '<div class="bill-2col">' +
          '<div>' +
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
            '<div class="acct-actions" style="margin-top:16px"><button class="acct-btn primary" id="bSave"><i class="ti ti-check"></i>Save as draft</button></div>' +
            '<div class="acct-msg" id="bMsg"></div>' +
          '</div>' +
          '<div class="vch">' +
            '<div class="vch-top"><div><div class="vch-tag">Supplier bill · draft</div><div class="vch-name" id="bvName">—</div></div><div class="vch-stamp">UNPAID</div></div>' +
            '<div class="vch-lad">' +
              '<div class="vch-row"><div class="lab">Taxable value</div><div class="val" id="bvTax">₹0</div></div>' +
              '<div class="vch-row"><div class="lab">GST input <span class="vch-chip add" id="bvGstR">+0%</span><small>reclaimable on your CA pack</small></div><div class="val" style="color:var(--green,#3B6D11)" id="bvGst">+₹0</div></div>' +
              '<div class="vch-row" id="bvTdsRow"><div class="lab">TDS withheld <span class="vch-chip less" id="bvTdsR">−0%</span><small id="bvTdsNote">you owe the tax office</small></div><div class="val" style="color:#993C1D" id="bvTds">−₹0</div></div>' +
            '</div>' +
            '<div class="vch-net"><div class="l">Net payable to supplier</div><div class="v" id="bvNet">₹0</div></div>' +
            '<div class="vch-perf"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="acct-card"><h3>Bills</h3><div id="bList"><div class="acct-empty">Loading…</div></div></div>';

    window.__acctBillCalc = function () {
      const amt = Number(document.getElementById('bAmt').value || 0);
      const gr = Number(document.getElementById('bGst').value || 0), tr = Number(document.getElementById('bTds').value || 0);
      const gst = r2(amt * gr / 100), tds = r2(amt * tr / 100);
      const sup = document.getElementById('bSupplier'); const supTxt = sup && sup.value && sup.value !== '__new' ? (sup.options[sup.selectedIndex] || {}).text : '';
      const secSel = document.getElementById('bTdsSec'); const sec = secSel ? secSel.value : '';
      document.getElementById('bvName').textContent = supTxt || '—';
      document.getElementById('bvTax').textContent = inr(amt);
      document.getElementById('bvGst').textContent = '+' + inr(gst); document.getElementById('bvGstR').textContent = '+' + gr + '%';
      document.getElementById('bvTds').textContent = '−' + inr(tds); document.getElementById('bvTdsR').textContent = '−' + tr + '%';
      document.getElementById('bvTdsRow').style.display = tds > 0 ? 'flex' : 'none';
      document.getElementById('bvTdsNote').textContent = sec ? sec + ' · you owe the tax office' : 'you owe the tax office';
      document.getElementById('bvNet').textContent = inr(r2(amt + gst - tds));
    };
    document.getElementById('bTdsSec').addEventListener('change', function () {
      const rate = this.options[this.selectedIndex].getAttribute('data-rate') || 0;
      document.getElementById('bTds').value = rate; window.__acctBillCalc();
    });
    document.getElementById('bSupplier').addEventListener('change', async function () {
      if (this.value !== '__new') { window.__acctBillCalc(); return; }
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
    let bills, openCredits;
    try { [bills, openCredits] = await Promise.all([api('/bills'), api('/credits?kind=supplier&status=open').catch(() => [])]); }
    catch (e) { el.innerHTML = '<div class="acct-empty">Could not load bills.</div>'; return; }
    const credByContact = {};
    (openCredits || []).forEach(c => { credByContact[c.contact_id] = r2((credByContact[c.contact_id] || 0) + Number(c.remaining_amount)); });
    if (!bills.length) { el.innerHTML = '<div class="acct-empty">No bills yet.</div>'; return; }
    el.innerHTML = '<table class="acct"><thead><tr><th>Date</th><th>Supplier</th><th>Category</th><th class="num">Net</th><th>Status</th><th>Files</th><th></th></tr></thead><tbody>' +
      bills.map(b => {
        const out = Number(b.outstanding != null ? b.outstanding : b.net_payable);
        const settled = Number(b.settled || 0);
        const netCell = inr(b.net_payable) + (b.status === 'posted' && settled > 0.5 ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + inr(out) + ' left</div>' : '');
        const cred = credByContact[b.contact_id] || 0;
        const acts = b.status === 'draft'
          ? '<button class="acct-btn primary" onclick="window.__acctBill(\'post\',' + b.id + ')">Post</button><button class="acct-btn danger" onclick="window.__acctBill(\'delete\',' + b.id + ')">Delete</button>'
          : b.status === 'posted'
            ? ((out > 0.5 && cred > 0.5 ? '<button class="acct-btn" onclick="window.__billCredit(' + b.id + ',' + b.contact_id + ',' + out + ')">Apply ' + fmtShort(cred) + ' credit</button>' : '') +
               '<button class="acct-btn" onclick="window.__acctReverse(' + b.journal_id + ')">Reverse</button>')
            : '';
        return '<tr><td>' + esc(String(b.bill_date).slice(0, 10)) + '</td><td>' + esc(b.contact_name || '—') + '</td><td>' + esc(b.category_name || '—') + '</td>' +
          '<td class="num">' + netCell + '</td><td>' + statusPill(b.status) + '</td><td>' + attControl('bill', b.id, b.att_count) + '</td><td class="acct-actions">' + acts + '</td></tr>' +
          '<tr id="bcredrow-' + b.id + '" style="display:none"><td colspan="7" style="background:var(--canvas,#F4EFE7);padding:0"><div id="bcred-' + b.id + '"></div></td></tr>';
      }).join('') + '</tbody></table>';
  }
  window.__billCredit = async function (billId, contactId, outstanding) {
    const row = document.getElementById('bcredrow-' + billId), box = document.getElementById('bcred-' + billId);
    if (!row || !box) return;
    if (row.style.display !== 'none') { row.style.display = 'none'; return; }
    row.style.display = ''; box.innerHTML = '<div style="padding:12px;font-size:12.5px;color:var(--muted)">Loading credit…</div>';
    try { const data = await api('/credits/available?contact_id=' + contactId + '&kind=supplier'); box.innerHTML = creditApplyHTML(data.credits || [], 'bill', billId, outstanding); }
    catch (e) { box.innerHTML = '<div style="padding:12px;color:#993C1D">' + esc(e.message) + '</div>'; }
  };
  // Shared: render an apply panel + run the allocation (used by bills, invoices and the Credits tab).
  function creditApplyHTML(credits, targetType, targetId, outstanding) {
    if (!credits.length) return '<div style="padding:12px;font-size:12.5px;color:var(--muted)">No credit available for this contact.</div>';
    const rows = credits.map(c => {
      const def = r2(Math.min(Number(c.remaining_amount), Number(outstanding != null ? outstanding : c.remaining_amount)));
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--line,#E8E0D3)">' +
        '<div style="flex:1;font-size:12.5px"><b>' + inr(c.remaining_amount) + '</b> available<span style="color:var(--muted)"> · ' + esc(String(c.credit_date).slice(0, 10)) + ' · ' + (c.source_type === 'credit_note' ? 'credit note' : 'prepayment') + (c.narration ? ' · ' + esc(c.narration) : '') + '</span></div>' +
        '<input id="capp-' + targetType + '-' + targetId + '-' + c.id + '" class="rec-f" type="number" min="0" step="0.01" value="' + def + '" style="width:120px">' +
        '<button class="acct-btn primary" onclick="window.__applyCredit(' + c.id + ",'" + targetType + "'," + targetId + ')">Apply</button>' +
      '</div>';
    }).join('');
    return '<div style="padding:4px 0 10px"><div style="padding:8px 12px;font-size:12px;color:var(--muted)">Outstanding <b style="color:var(--ink)">' + inr(outstanding) + '</b> — apply credit to reduce it.</div>' + rows + '</div>';
  }
  window.__applyCredit = async function (creditId, targetType, targetId) {
    const inp = document.getElementById('capp-' + targetType + '-' + targetId + '-' + creditId);
    const amount = inp ? Number(inp.value || 0) : null;
    if (!amount || amount <= 0) { alert('Enter an amount to apply.'); return; }
    try {
      await api('/credits/' + creditId + '/apply', { method: 'POST', body: JSON.stringify({ target_type: targetType, target_id: targetId, amount: amount }) });
      if (targetType === 'bill' && document.getElementById('bList')) await loadBillList();
      if (targetType === 'invoice' && document.getElementById('iList')) await loadInvoiceList();
      if (document.getElementById('crList')) await loadCreditsList();
    } catch (e) { alert(e.message); }
  };
  window.__acctBill = async function (action, id) {
    if (action === 'delete' && !confirm('Delete this draft bill? It was never posted, so it will be removed completely.')) return;
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
        '<div class="bill-2col">' +
          '<div>' +
            '<div class="acct-form">' +
              '<div class="acct-field"><label>Customer</label><select id="iCust"><option value="">— select —</option>' + custOpts + '<option value="__new">+ Add customer…</option></select></div>' +
              '<div class="acct-field"><label>Invoice date</label><input id="iDate" type="date" value="' + today() + '"></div>' +
              '<div class="acct-field"><label>Tax treatment</label><select id="iTreat" onchange="window.__acctInvCalc()"><option value="export_zero">Export — zero-rated (LUT)</option><option value="domestic_gst">Domestic — GST</option></select></div>' +
              '<div class="acct-field"><label>Currency</label><select id="iCur" onchange="window.__acctInvCalc()"><option value="INR">INR</option><option value="GBP">GBP</option></select></div>' +
              '<div class="acct-field"><label>FX rate → INR</label><input id="iFx" type="number" min="0" step="0.0001" value="1" oninput="window.__acctInvCalc()"></div>' +
              '<div class="acct-field"><label>Amount</label><input id="iAmt" type="number" min="0" step="0.01" oninput="window.__acctInvCalc()"></div>' +
              '<div class="acct-field" id="iGstWrap" style="display:none"><label>GST rate %</label><input id="iGst" type="number" min="0" step="0.01" value="18" oninput="window.__acctInvCalc()"></div>' +
            '</div>' +
            '<div class="acct-actions" style="margin-top:16px"><button class="acct-btn primary" id="iSave"><i class="ti ti-check"></i>Save as draft</button></div>' +
            '<div class="acct-msg" id="iMsg"></div>' +
          '</div>' +
          '<div class="vch">' +
            '<div class="vch-top"><div><div class="vch-tag">Sales invoice · draft</div><div class="vch-name" id="ivName">—</div></div><div class="vch-stamp in">RECEIVABLE</div></div>' +
            '<div class="vch-lad">' +
              '<div class="vch-row"><div class="lab">Taxable value</div><div class="val" id="ivTax">₹0</div></div>' +
              '<div class="vch-row" id="ivGstRow" style="display:none"><div class="lab">GST output <span class="vch-chip add" id="ivGstR">+0%</span><small>collected from customer</small></div><div class="val" style="color:var(--green,#3B6D11)" id="ivGst">+₹0</div></div>' +
              '<div class="vch-row" id="ivFxRow" style="display:none"><div class="lab">FX to INR <span class="vch-chip add" id="ivFxR">×1</span><small>booked at this rate</small></div><div class="val" id="ivFxV">₹0</div></div>' +
            '</div>' +
            '<div class="vch-net"><div class="l">Booked to INR</div><div class="v" id="ivNet">₹0</div></div>' +
            '<div class="vch-perf"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="acct-card"><h3>Invoices</h3><div id="iList"><div class="acct-empty">Loading…</div></div></div>';

    window.__acctInvCalc = function () {
      const dom = document.getElementById('iTreat').value === 'domestic_gst';
      document.getElementById('iGstWrap').style.display = dom ? '' : 'none';
      const amt = Number(document.getElementById('iAmt').value || 0);
      const fx = Number(document.getElementById('iFx').value || 1);
      const cur = document.getElementById('iCur').value;
      const gstR = dom ? Number(document.getElementById('iGst').value || 0) : 0;
      const gst = r2(amt * gstR / 100);
      const money = v => cur === 'GBP' ? gbp(v) : inr(v);
      const cust = document.getElementById('iCust'); const custTxt = cust && cust.value && cust.value !== '__new' ? (cust.options[cust.selectedIndex] || {}).text : '';
      document.getElementById('ivName').textContent = custTxt || '—';
      document.getElementById('ivTax').textContent = money(amt);
      document.getElementById('ivGstRow').style.display = dom && gst > 0 ? 'flex' : 'none';
      document.getElementById('ivGst').textContent = '+' + money(gst); document.getElementById('ivGstR').textContent = '+' + gstR + '%';
      const subInr = r2((amt + gst) * fx);
      document.getElementById('ivFxRow').style.display = (cur === 'GBP' || fx !== 1) ? 'flex' : 'none';
      document.getElementById('ivFxR').textContent = '×' + fx;
      document.getElementById('ivFxV').textContent = inr(subInr);
      document.getElementById('ivNet').textContent = inr(subInr);
    };
    document.getElementById('iCust').addEventListener('change', async function () {
      if (this.value !== '__new') { window.__acctInvCalc(); return; }
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
    let invs, openCredits;
    try { [invs, openCredits] = await Promise.all([api('/invoices'), api('/credits?kind=customer&status=open').catch(() => [])]); }
    catch (e) { el.innerHTML = '<div class="acct-empty">Could not load invoices.</div>'; return; }
    const credByContact = {};
    (openCredits || []).forEach(c => { credByContact[c.contact_id] = r2((credByContact[c.contact_id] || 0) + Number(c.remaining_amount)); });
    if (!invs.length) { el.innerHTML = '<div class="acct-empty">No invoices yet.</div>'; return; }
    el.innerHTML = '<table class="acct"><thead><tr><th>Date</th><th>Customer</th><th>Treatment</th><th class="num">Amount</th><th class="num">INR</th><th>Status</th><th>Files</th><th></th></tr></thead><tbody>' +
      invs.map(i => {
        const out = Number(i.outstanding != null ? i.outstanding : i.amount_inr), settled = Number(i.settled || 0);
        const inrCell = inr(i.amount_inr) + (i.status === 'posted' && settled > 0.5 ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + inr(out) + ' left</div>' : '');
        const cred = credByContact[i.contact_id] || 0;
        const acts = i.status === 'draft'
          ? '<button class="acct-btn primary" onclick="window.__acctInv(\'post\',' + i.id + ')">Post</button><button class="acct-btn danger" onclick="window.__acctInv(\'delete\',' + i.id + ')">Delete</button>'
          : i.status === 'posted'
            ? ((out > 0.5 && cred > 0.5 && (i.currency || 'INR') === 'INR' ? '<button class="acct-btn" onclick="window.__invCredit(' + i.id + ',' + i.contact_id + ',' + out + ')">Apply ' + fmtShort(cred) + ' credit</button>' : '') +
               '<button class="acct-btn" onclick="window.__acctReverse(' + i.journal_id + ')">Reverse</button>')
            : '';
        return '<tr><td>' + esc(String(i.invoice_date).slice(0, 10)) + '</td><td>' + esc(i.contact_name || '—') + '</td>' +
          '<td>' + (i.tax_treatment === 'export_zero' ? 'Export 0%' : 'Domestic GST') + '</td>' +
          '<td class="num">' + (i.currency === 'GBP' ? gbp(i.taxable_amount) : inr(i.taxable_amount)) + '</td>' +
          '<td class="num">' + inrCell + '</td><td>' + statusPill(i.status) + '</td><td>' + attControl('invoice', i.id, i.att_count) + '</td><td class="acct-actions">' + acts + '</td></tr>' +
          '<tr id="icredrow-' + i.id + '" style="display:none"><td colspan="8" style="background:var(--canvas,#F4EFE7);padding:0"><div id="icred-' + i.id + '"></div></td></tr>';
      }).join('') + '</tbody></table>';
  }
  window.__invCredit = async function (invId, contactId, outstanding) {
    const row = document.getElementById('icredrow-' + invId), box = document.getElementById('icred-' + invId);
    if (!row || !box) return;
    if (row.style.display !== 'none') { row.style.display = 'none'; return; }
    row.style.display = ''; box.innerHTML = '<div style="padding:12px;font-size:12.5px;color:var(--muted)">Loading credit…</div>';
    try { const data = await api('/credits/available?contact_id=' + contactId + '&kind=customer'); box.innerHTML = creditApplyHTML(data.credits || [], 'invoice', invId, outstanding); }
    catch (e) { box.innerHTML = '<div style="padding:12px;color:#993C1D">' + esc(e.message) + '</div>'; }
  };
  window.__acctInv = async function (action, id) {
    if (action === 'delete' && !confirm('Delete this draft invoice? It was never posted, so it will be removed completely.')) return;
    try { await api('/invoices/' + id + '/' + action, { method: 'POST' }); await loadInvoiceList(); } catch (e) { alert(e.message); }
  };

  // ---------------- Reports ----------------
  // ---------------- Credits (prepayments + credit notes) ----------------
  async function renderCredits(body) {
    const { contacts, accounts } = await lookups();
    const contactOpts = contacts.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const acctOpts = accounts.map(a => '<option value="' + a.id + '">' + esc(a.code + ' · ' + a.name) + '</option>').join('');
    body.innerHTML =
      '<div class="acct-card"><h3>Add credit note</h3>' +
        '<div style="font-size:12.5px;color:var(--muted);margin:-4px 0 14px;line-height:1.55">A non-cash credit against a contact — e.g. a supplier rebate or a customer goodwill credit. Cash advances and deposits are recorded as prepayments on the Reconcile tab.</div>' +
        '<div class="acct-form">' +
          '<div class="acct-field"><label>Type</label><select id="crKind"><option value="supplier">Supplier credit (reduces a bill)</option><option value="customer">Customer credit (reduces an invoice)</option></select></div>' +
          '<div class="acct-field"><label>Contact</label><select id="crContact"><option value="">— select —</option>' + contactOpts + '</select></div>' +
          '<div class="acct-field"><label>Amount (₹)</label><input id="crAmt" type="number" min="0" step="0.01"></div>' +
          '<div class="acct-field"><label>From account</label><select id="crOffset">' + acctOpts + '</select></div>' +
          '<div class="acct-field"><label>Date</label><input id="crDate" type="date" value="' + today() + '"></div>' +
          '<div class="acct-field" style="grid-column:1/-1"><label>Note</label><input id="crNote" placeholder="Reason (optional)"></div>' +
        '</div>' +
        '<div class="acct-actions" style="margin-top:14px"><button class="acct-btn primary" id="crSave"><i class="ti ti-plus"></i>Add credit</button></div>' +
        '<div class="acct-msg" id="crMsg"></div>' +
      '</div>' +
      '<div class="acct-card"><h3>Open credits</h3><div id="crList"><div class="acct-empty">Loading…</div></div></div>';
    document.getElementById('crSave').addEventListener('click', async function () {
      const msg = document.getElementById('crMsg'); msg.className = 'acct-msg';
      try {
        await api('/credits', { method: 'POST', body: JSON.stringify({
          contact_id: document.getElementById('crContact').value || null,
          kind: document.getElementById('crKind').value,
          amount: Number(document.getElementById('crAmt').value || 0),
          offset_account_id: document.getElementById('crOffset').value || null,
          date: document.getElementById('crDate').value,
          note: document.getElementById('crNote').value.trim() || null,
        }) });
        msg.className = 'acct-msg ok'; msg.textContent = 'Credit added.';
        document.getElementById('crAmt').value = ''; document.getElementById('crNote').value = '';
        await loadCreditsList();
      } catch (e) { msg.className = 'acct-msg err'; msg.textContent = e.message; }
    });
    await loadCreditsList();
  }
  async function loadCreditsList() {
    const el = document.getElementById('crList'); if (!el) return;
    let credits;
    try { credits = await api('/credits?status=open'); } catch (e) { el.innerHTML = '<div class="acct-empty">Could not load credits.</div>'; return; }
    if (!credits.length) { el.innerHTML = '<div class="acct-empty">No open credits. Record a prepayment on the Reconcile tab, or add a credit note above.</div>'; return; }
    el.innerHTML = '<table class="acct"><thead><tr><th>Date</th><th>Contact</th><th>Type</th><th>Source</th><th class="num">Remaining</th><th></th></tr></thead><tbody>' +
      credits.map(c => '<tr><td>' + esc(String(c.credit_date).slice(0, 10)) + '</td><td>' + esc(c.contact_name) + '</td><td>' + (c.kind === 'supplier' ? 'Supplier' : 'Customer') + '</td><td>' + (c.source_type === 'credit_note' ? 'Credit note' : 'Prepayment') + '</td>' +
        '<td class="num">' + inr(c.remaining_amount) + '</td><td class="acct-actions"><button class="acct-btn" onclick="window.__credApplyOpen(' + c.id + ',' + c.contact_id + ",'" + c.kind + "'," + c.remaining_amount + ')">Apply…</button></td></tr>' +
        '<tr id="crtargrow-' + c.id + '" style="display:none"><td colspan="6" style="background:var(--canvas,#F4EFE7);padding:0"><div id="crtarg-' + c.id + '"></div></td></tr>'
      ).join('') + '</tbody></table>';
  }
  function creditTargetsHTML(credit, docs) {
    const tt = credit.kind === 'supplier' ? 'bill' : 'invoice';
    if (!docs.length) return '<div style="padding:12px;font-size:12.5px;color:var(--muted)">No open ' + (tt === 'bill' ? 'bills' : 'invoices') + ' for this contact to apply against.</div>';
    return docs.map(d => {
      const out = Number(d.outstanding), def = r2(Math.min(Number(credit.remaining_amount), out));
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--line,#E8E0D3)">' +
        '<div style="flex:1;font-size:12.5px">' + (tt === 'bill' ? 'Bill #' : 'Inv #') + d.id + ' · ' + esc(String(tt === 'bill' ? d.bill_date : d.invoice_date).slice(0, 10)) + ' · <b>' + inr(out) + '</b> outstanding</div>' +
        '<input id="ctap-' + credit.id + '-' + d.id + '" class="rec-f" type="number" min="0" step="0.01" value="' + def + '" style="width:120px">' +
        '<button class="acct-btn primary" onclick="window.__credApply(' + credit.id + ",'" + tt + "'," + d.id + ')">Apply</button>' +
      '</div>';
    }).join('');
  }
  window.__credApplyOpen = async function (creditId, contactId, kind, remaining) {
    const row = document.getElementById('crtargrow-' + creditId), box = document.getElementById('crtarg-' + creditId);
    if (!row || !box) return;
    if (row.style.display !== 'none') { row.style.display = 'none'; return; }
    row.style.display = ''; box.innerHTML = '<div style="padding:12px;font-size:12.5px;color:var(--muted)">Loading…</div>';
    try {
      const docs = kind === 'supplier' ? await api('/open-bills') : await api('/open-invoices');
      const mine = (docs || []).filter(d => Number(d.contact_id) === Number(contactId) && Number(d.outstanding) > 0.5);
      box.innerHTML = creditTargetsHTML({ id: creditId, contact_id: contactId, kind: kind, remaining_amount: remaining }, mine);
    } catch (e) { box.innerHTML = '<div style="padding:12px;color:#993C1D">' + esc(e.message) + '</div>'; }
  };
  window.__credApply = async function (creditId, tt, docId) {
    const inp = document.getElementById('ctap-' + creditId + '-' + docId);
    const amount = inp ? Number(inp.value || 0) : null;
    if (!amount || amount <= 0) { alert('Enter an amount to apply.'); return; }
    try { await api('/credits/' + creditId + '/apply', { method: 'POST', body: JSON.stringify({ target_type: tt, target_id: docId, amount: amount }) }); await loadCreditsList(); }
    catch (e) { alert(e.message); }
  };

  async function renderReports(body) {
    body.innerHTML =
      '<div class="acct-actions" style="margin-bottom:16px;flex-wrap:wrap">' +
        '<button class="acct-btn primary" id="rTB">Trial balance</button>' +
        '<button class="acct-btn" id="rPL">Profit &amp; loss</button>' +
        '<button class="acct-btn" id="rBS">Balance sheet</button>' +
        '<button class="acct-btn" id="rAR">AR aging</button>' +
        '<button class="acct-btn" id="rAP">AP aging</button>' +
        '<button class="acct-btn" id="rCA">CA pack · GST &amp; TDS</button>' +
        '<button class="acct-btn" id="rSS">Spend by supplier</button>' +
        '<button class="acct-btn" id="rPE">Month-end</button>' +
        '<button class="acct-btn" id="rMJ">Manual journal</button>' +
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
    document.getElementById('rCA').addEventListener('click', () => renderCaPack(out));
    document.getElementById('rSS').addEventListener('click', () => renderSpendSupplier(out));
    document.getElementById('rPE').addEventListener('click', () => renderPeriods(out));
    document.getElementById('rMJ').addEventListener('click', () => renderManualJournal(out));
    document.getElementById('rTB').click();
  }

  function indianFy(d) {
    const dt = d || new Date(); const y = dt.getFullYear();
    const start = dt.getMonth() >= 3 ? y : y - 1; // Indian FY starts 1 April
    return { from: start + '-04-01', to: (start + 1) + '-03-31' };
  }
  function toCsv(headers, rows) {
    const c = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [headers.map(c).join(',')].concat(rows.map(r => r.map(c).join(','))).join('\n');
  }
  function downloadCsv(filename, csv) {
    try {
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { alert('Could not download: ' + e.message); }
  }
  const d10 = v => esc(String(v).slice(0, 10));
  const pct = v => (Number(v) || 0) + '%';

  function caTable(title, sub, dlKey, head, bodyRows, totalsRow, empty) {
    return '<div class="acct-card" style="margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">' + title + '</h3>' +
        (bodyRows ? '<button class="acct-btn" onclick="window.__caCsv(\'' + dlKey + '\')"><i class="ti ti-download"></i>Download CSV</button>' : '') + '</div>' +
      (sub ? '<p style="color:var(--muted);font-size:12.5px;margin:3px 0 10px">' + sub + '</p>' : '') +
      (bodyRows
        ? '<table class="acct"><thead><tr>' + head + '</tr></thead><tbody>' + bodyRows + totalsRow + '</tbody></table>'
        : '<div class="acct-empty" style="padding:20px 8px">' + empty + '</div>') +
      '</div>';
  }

  async function renderCaPack(out) {
    const pad = n => String(n).padStart(2, '0');
    const monLbl = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monShort = ds => monLbl[Number(ds.slice(5, 7)) - 1];
    const monthRange = (y, m0) => { const last = new Date(y, m0 + 1, 0).getDate(); return { from: y + '-' + pad(m0 + 1) + '-01', to: y + '-' + pad(m0 + 1) + '-' + pad(last), label: monLbl[m0] + ' ' + y }; };
    const fyRange = s => ({ from: s + '-04-01', to: (s + 1) + '-03-31', label: 'FY ' + s + '–' + String(s + 1).slice(2) });
    const quarterRange = (s, q) => q === 1 ? { from: s + '-04-01', to: s + '-06-30', label: 'Q1 FY' + s + '–' + String(s + 1).slice(2) }
      : q === 2 ? { from: s + '-07-01', to: s + '-09-30', label: 'Q2 FY' + s + '–' + String(s + 1).slice(2) }
      : q === 3 ? { from: s + '-10-01', to: s + '-12-31', label: 'Q3 FY' + s + '–' + String(s + 1).slice(2) }
      : { from: (s + 1) + '-01-01', to: (s + 1) + '-03-31', label: 'Q4 FY' + s + '–' + String(s + 1).slice(2) };
    const curStart = Number(indianFy().from.slice(0, 4));

    out.innerHTML =
      '<div class="acct-card" style="margin-bottom:14px">' +
        '<h3 style="margin:0 0 4px">CA pack — GST &amp; TDS</h3>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 14px">Registers for your accountant. Pick a period — month, quarter or year — then download each as CSV, or email the whole pack in one click.</p>' +
        '<div class="ca-seg"><button id="caSegM">Month</button><button id="caSegQ">Quarter</button><button id="caSegY" class="on">Financial year</button></div>' +
        '<div id="caSub" style="margin-top:13px"></div>' +
        '<div class="ca-send">' +
          '<button class="acct-btn primary" onclick="window.__caEmail()"><i class="ti ti-mail-forward"></i>Email pack to CA</button>' +
          '<div class="ca-recip" id="caRecip"></div>' +
          '<div class="acct-msg" id="caSendMsg" style="margin:0"></div>' +
        '</div>' +
      '</div><div id="caOut"></div>';
    const caOut = document.getElementById('caOut');

    const st = await api('/settings').catch(() => ({}));
    window.__caEmailAddr = (st && st.ca_email) || '';
    updateRecip();

    function setRange(from, to, label) { window.__caRange = { from, to, label }; load(); }
    function setSeg(seg) { ['M', 'Q', 'Y'].forEach(s => document.getElementById('caSeg' + s).classList.toggle('on', s === seg.charAt(0).toUpperCase())); renderSub(seg); }
    function renderSub(seg) {
      const sub = document.getElementById('caSub');
      if (seg === 'month') {
        const now = new Date(); let opts = '';
        for (let i = 0; i < 15; i++) { const dd = new Date(now.getFullYear(), now.getMonth() - i, 1); const r = monthRange(dd.getFullYear(), dd.getMonth()); opts += '<option value="' + r.from + '|' + r.to + '|' + r.label + '"' + (i === 0 ? ' selected' : '') + '>' + r.label + '</option>'; }
        sub.innerHTML = '<select class="rec-f" id="caMonthSel" style="width:auto;min-width:160px">' + opts + '</select>';
        const sel = document.getElementById('caMonthSel');
        const apply = () => { const p = sel.value.split('|'); setRange(p[0], p[1], p[2]); };
        sel.addEventListener('change', apply); apply();
      } else if (seg === 'quarter') {
        let fyopts = ''; for (let k = 0; k < 3; k++) { const s = curStart - k; fyopts += '<option value="' + s + '">FY ' + s + '–' + String(s + 1).slice(2) + '</option>'; }
        sub.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><select class="rec-f" id="caQFy" style="width:auto">' + fyopts + '</select><div id="caQPills" style="display:flex;gap:8px;flex-wrap:wrap"></div></div>';
        const fySel = document.getElementById('caQFy'); let curQ = 1;
        const draw = () => {
          const s = Number(fySel.value), p = document.getElementById('caQPills');
          p.innerHTML = [1, 2, 3, 4].map(q => { const r = quarterRange(s, q); return '<button class="ca-pill' + (q === curQ ? ' on' : '') + '" data-q="' + q + '">Q' + q + ' · ' + monShort(r.from) + '–' + monShort(r.to) + '</button>'; }).join('');
          p.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { curQ = Number(b.getAttribute('data-q')); draw(); const r = quarterRange(Number(fySel.value), curQ); setRange(r.from, r.to, r.label); }));
        };
        fySel.addEventListener('change', () => { draw(); const r = quarterRange(Number(fySel.value), curQ); setRange(r.from, r.to, r.label); });
        draw(); const r0 = quarterRange(curStart, 1); setRange(r0.from, r0.to, r0.label);
      } else {
        let html = ''; for (let k = 0; k < 3; k++) { const s = curStart - k; html += '<button class="ca-pill' + (k === 0 ? ' on' : '') + '" data-fy="' + s + '">' + fyRange(s).label + '</button>'; }
        sub.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap">' + html + '</div>';
        sub.querySelectorAll('[data-fy]').forEach(b => b.addEventListener('click', () => { sub.querySelectorAll('[data-fy]').forEach(x => x.classList.remove('on')); b.classList.add('on'); const r = fyRange(Number(b.getAttribute('data-fy'))); setRange(r.from, r.to, r.label); }));
        const r = fyRange(curStart); setRange(r.from, r.to, r.label);
      }
    }
    document.getElementById('caSegM').addEventListener('click', () => setSeg('month'));
    document.getElementById('caSegQ').addEventListener('click', () => setSeg('quarter'));
    document.getElementById('caSegY').addEventListener('click', () => setSeg('year'));

    async function load() {
      const r = window.__caRange; if (!r) return;
      const q = '?from=' + r.from + '&to=' + r.to;
      caOut.innerHTML = '<div class="acct-empty" style="padding:24px">Loading…</div>';
      const [sales, purch, tds] = await Promise.all([api('/reports/gst-sales' + q), api('/reports/gst-purchases' + q), api('/reports/tds' + q)]);
      [sales, purch, tds].forEach(x => { x.rows = x.rows || []; x.totals = x.totals || {}; });
      window.__caData = { sales, purch, tds, from: r.from, to: r.to };
      const kpi = (ic, l, v, d, cls) => '<div class="ca-kpi"><div class="l"><i class="ti ' + ic + '"></i>' + l + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="d">' + d + '</div></div>';
      const netGst = r2((Number(sales.totals.gst) || 0) - (Number(purch.totals.gst) || 0));
      const kpis = '<div class="ca-kpis">' +
        kpi('ti-arrow-down-left', 'Output GST', inr(sales.totals.gst || 0), 'collected · ' + r.label, '') +
        kpi('ti-arrow-up-right', 'Input GST', inr(purch.totals.gst || 0), 'reclaimable', 'green') +
        kpi('ti-scale', 'Net GST', (netGst < 0 ? '−' : '') + inr(Math.abs(netGst)), netGst < 0 ? 'credit carried' : 'payable', '') +
        kpi('ti-receipt-tax', 'TDS deducted', inr(tds.totals.tds || 0), 'to deposit', 'coral') + '</div>';

      const salesBody = sales.rows.map(rw => '<tr><td>' + d10(rw.invoice_date) + '</td><td>#' + rw.id + '</td><td>' + esc(rw.party) + '</td><td>' + esc(rw.gstin || '—') + '</td><td>' + (rw.tax_treatment === 'export_zero' ? 'Export / zero' : 'Domestic GST') + '</td><td class="num">' + inr(rw.taxable_amount) + '</td><td class="num">' + pct(rw.gst_rate) + '</td><td class="num">' + inr(rw.gst_amount) + '</td><td class="num">' + inr(rw.total) + '</td></tr>').join('');
      const salesTot = '<tr style="font-weight:500"><td colspan="5">Total</td><td class="num">' + inr(sales.totals.taxable) + '</td><td></td><td class="num">' + inr(sales.totals.gst) + '</td><td class="num">' + inr(sales.totals.total) + '</td></tr>';
      const salesCard = caTable('GST sales register · output GST', 'Posted sales invoices. Output GST is what you collected.', 'sales',
        '<th>Date</th><th>Invoice</th><th>Customer</th><th>GSTIN</th><th>Treatment</th><th class="num">Taxable</th><th class="num">GST %</th><th class="num">GST</th><th class="num">Total</th>',
        salesBody, salesTot, 'No sales invoices in ' + r.label + '.');

      const purchBody = purch.rows.map(rw => '<tr><td>' + d10(rw.bill_date) + '</td><td>#' + rw.id + '</td><td>' + esc(rw.party) + '</td><td>' + esc(rw.gstin || '—') + '</td><td class="num">' + inr(rw.taxable_amount) + '</td><td class="num">' + pct(rw.gst_rate) + '</td><td class="num">' + inr(rw.gst_amount) + '</td><td class="num">' + inr(rw.total) + '</td></tr>').join('');
      const purchTot = '<tr style="font-weight:500"><td colspan="4">Total</td><td class="num">' + inr(purch.totals.taxable) + '</td><td></td><td class="num">' + inr(purch.totals.gst) + '</td><td class="num">' + inr(purch.totals.total) + '</td></tr>';
      const purchCard = caTable('GST purchase register · input GST', 'Posted bills. Input GST is what you can reclaim.', 'purch',
        '<th>Date</th><th>Bill</th><th>Supplier</th><th>GSTIN</th><th class="num">Taxable</th><th class="num">GST %</th><th class="num">GST</th><th class="num">Total</th>',
        purchBody, purchTot, 'No bills in ' + r.label + '.');

      const tdsBody = tds.rows.map(rw => '<tr><td>' + d10(rw.bill_date) + '</td><td>#' + rw.id + '</td><td>' + esc(rw.party) + '</td><td>' + esc(rw.tds_section || '—') + '</td><td class="num">' + inr(rw.taxable_amount) + '</td><td class="num">' + pct(rw.tds_rate) + '</td><td class="num">' + inr(rw.tds_amount) + '</td></tr>').join('');
      const tdsTot = '<tr style="font-weight:500"><td colspan="4">Total</td><td class="num">' + inr(tds.totals.taxable) + '</td><td></td><td class="num">' + inr(tds.totals.tds) + '</td></tr>';
      const tdsCard = caTable('TDS deducted', 'TDS withheld on supplier bills — what you owe the tax office.', 'tds',
        '<th>Date</th><th>Bill</th><th>Supplier</th><th>Section</th><th class="num">Taxable</th><th class="num">TDS %</th><th class="num">TDS</th>',
        tdsBody, tdsTot, 'No TDS deducted in ' + r.label + '.');

      caOut.innerHTML = kpis + salesCard + purchCard + tdsCard;
    }

    function updateRecip() {
      const el = document.getElementById('caRecip'); if (!el) return;
      el.innerHTML = window.__caEmailAddr
        ? 'To <b>' + esc(window.__caEmailAddr) + '</b><a onclick="window.__caChangeEmail()">change</a>'
        : '<a onclick="window.__caChangeEmail()">Set your accountant\u2019s email</a>';
    }
    window.__caChangeEmail = async function () {
      const e = (window.prompt('Your accountant\u2019s email — saved for next time', window.__caEmailAddr || '') || '').trim();
      if (!e) return;
      try { const r = await api('/settings', { method: 'PUT', body: JSON.stringify({ ca_email: e }) }); window.__caEmailAddr = r.ca_email; updateRecip(); } catch (err) { alert(err.message); }
    };
    window.__caEmail = async function () {
      const r = window.__caRange; if (!r) return;
      const msg = document.getElementById('caSendMsg');
      let email = window.__caEmailAddr || '';
      if (!email) { email = (window.prompt('Your accountant\u2019s email — saved for next time') || '').trim(); if (!email) return; }
      if (msg) { msg.className = 'acct-msg'; msg.textContent = 'Sending…'; }
      try {
        const res = await api('/reports/ca-pack/email', { method: 'POST', body: JSON.stringify({ from: r.from, to: r.to, label: r.label, to_email: email }) });
        window.__caEmailAddr = res.sent_to; updateRecip();
        if (msg) { msg.className = 'acct-msg ok'; msg.textContent = 'Pack for ' + r.label + ' emailed to ' + res.sent_to + '.'; }
      } catch (e) { if (msg) { msg.className = 'acct-msg err'; msg.textContent = e.message; } else alert(e.message); }
    };

    setSeg('year');
  }

  window.__caCsv = function (which) {
    const d = window.__caData; if (!d) return '';
    const tag = (d.from + '_' + d.to).replace(/-/g, '');
    let name = '', csv = '';
    if (which === 'sales') {
      name = 'gst-sales_' + tag + '.csv';
      csv = toCsv(['Date', 'Invoice #', 'Customer', 'GSTIN', 'Treatment', 'Taxable', 'GST %', 'GST', 'Total'],
        d.sales.rows.map(r => [String(r.invoice_date).slice(0, 10), r.id, r.party, r.gstin || '', r.tax_treatment, r.taxable_amount, r.gst_rate, r.gst_amount, r.total]));
    } else if (which === 'purch') {
      name = 'gst-purchases_' + tag + '.csv';
      csv = toCsv(['Date', 'Bill #', 'Supplier', 'GSTIN', 'Taxable', 'GST %', 'GST', 'Total'],
        d.purch.rows.map(r => [String(r.bill_date).slice(0, 10), r.id, r.party, r.gstin || '', r.taxable_amount, r.gst_rate, r.gst_amount, r.total]));
    } else if (which === 'tds') {
      name = 'tds_' + tag + '.csv';
      csv = toCsv(['Date', 'Bill #', 'Supplier', 'Section', 'Taxable', 'TDS %', 'TDS'],
        d.tds.rows.map(r => [String(r.bill_date).slice(0, 10), r.id, r.party, r.tds_section || '', r.taxable_amount, r.tds_rate, r.tds_amount]));
    } else { return ''; }
    downloadCsv(name, csv);
    return csv;
  };

  async function renderSpendSupplier(out) {
    const fy = indianFy();
    out.innerHTML =
      '<div class="acct-card" style="margin-bottom:14px">' +
        '<h3 style="margin:0 0 4px">Spend by supplier</h3>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 12px">Total expenses attributed to each supplier in the period. Coded transactions and bills both count.</p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
          '<div><span class="rec-lbl">From</span><input type="date" id="ssFrom" class="rec-f" style="width:170px" value="' + fy.from + '"></div>' +
          '<div><span class="rec-lbl">To</span><input type="date" id="ssTo" class="rec-f" style="width:170px" value="' + fy.to + '"></div>' +
          '<button class="acct-btn" id="ssFy">This FY</button>' +
          '<button class="acct-btn primary" id="ssRun"><i class="ti ti-refresh"></i>Show</button>' +
        '</div>' +
      '</div><div id="ssOut"></div>';
    const ssOut = document.getElementById('ssOut');
    document.getElementById('ssFy').addEventListener('click', () => { const x = indianFy(); document.getElementById('ssFrom').value = x.from; document.getElementById('ssTo').value = x.to; load(); });
    document.getElementById('ssRun').addEventListener('click', load);
    async function load() {
      const from = document.getElementById('ssFrom').value, to = document.getElementById('ssTo').value;
      ssOut.innerHTML = '<div class="acct-empty" style="padding:24px">Loading…</div>';
      const d = await api('/reports/spend-by-supplier?from=' + from + '&to=' + to);
      d.rows = d.rows || []; window.__ssData = d;
      if (!d.rows.length) { ssOut.innerHTML = '<div class="acct-card"><div class="acct-empty" style="padding:24px">No spend recorded in this period.</div></div>'; return; }
      const max = Math.max.apply(null, d.rows.map(r => r.spend).concat([1]));
      const body = d.rows.map(r => {
        const share = d.total ? Math.round(r.spend / d.total * 100) : 0;
        return '<tr><td>' + esc(r.supplier) + '</td>' +
          '<td style="width:42%"><div style="background:var(--canvas,#F4EFE7);border-radius:6px;height:16px;overflow:hidden"><div style="height:100%;width:' + Math.max(2, Math.round(r.spend / max * 100)) + '%;background:#639922"></div></div></td>' +
          '<td class="num">' + inr(r.spend) + '</td><td class="num">' + share + '%</td></tr>';
      }).join('');
      ssOut.innerHTML = '<div class="acct-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Spend by supplier</h3><button class="acct-btn" onclick="window.__ssCsv()"><i class="ti ti-download"></i>Download CSV</button></div>' +
        '<table class="acct" style="margin-top:10px"><thead><tr><th>Supplier</th><th></th><th class="num">Spend</th><th class="num">Share</th></tr></thead><tbody>' + body +
        '<tr style="font-weight:500"><td>Total</td><td></td><td class="num">' + inr(d.total) + '</td><td class="num">100%</td></tr>' +
        '</tbody></table></div>';
    }
    load();
  }
  window.__ssCsv = function () {
    const d = window.__ssData; if (!d) return '';
    const csv = toCsv(['Supplier', 'Spend', 'Share %'], (d.rows || []).map(r => [r.supplier, r.spend, d.total ? Math.round(r.spend / d.total * 100) : 0]));
    downloadCsv('spend-by-supplier_' + (d.from + '_' + d.to).replace(/-/g, '') + '.csv', csv);
    return csv;
  };

  async function renderPeriods(out) {
    const canLock = !!(window.fkUser && (window.fkUser.group_slugs || []).indexOf('owner') !== -1);
    out.innerHTML = '<div id="peOut"><div class="acct-empty" style="padding:24px">Loading…</div></div>';
    async function loadPeriods() {
      const peOut = document.getElementById('peOut');
      const rows = await api('/periods');
      const list = rows.length ? rows.map(p => {
        const badge = p.locked ? '<span class="acct-pill p-posted">Filed</span>' : '<span class="acct-pill p-draft">Open</span>';
        const action = !canLock ? ''
          : p.locked
            ? '<button class="acct-btn" onclick="window.__periodUnlock(\'' + p.period + '\')"><i class="ti ti-lock-open"></i>Unlock</button>'
            : '<button class="acct-btn primary" onclick="window.__periodLock(\'' + p.period + '\')"><i class="ti ti-lock"></i>File &amp; lock</button>';
        return '<tr><td>' + esc(monLabel(p.period)) + '</td><td class="num">' + p.entries + '</td><td>' + badge + '</td><td class="acct-actions">' + action + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="acct-empty" style="padding:18px">No posted entries yet.</td></tr>';
      peOut.innerHTML = '<div class="acct-card"><h3 style="margin:0 0 4px">Month-end</h3>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 12px">Filing a month locks it — entries dated in that month can no longer be posted or edited. Post any corrections in the current open month.' + (canLock ? '' : ' Only the owner can file or unlock a month.') + '</p>' +
        '<table class="acct"><thead><tr><th>Month</th><th class="num">Entries</th><th>Status</th><th></th></tr></thead><tbody>' + list + '</tbody></table></div>';
    }
    window.__periodLock = async function (period) {
      if (!window.confirm('File ' + period + '? This locks the month so no more entries can be posted in it.')) return;
      try { await api('/periods/' + period + '/lock', { method: 'POST', body: JSON.stringify({}) }); await loadPeriods(); } catch (e) { alert(e.message); }
    };
    window.__periodUnlock = async function (period) {
      if (!window.confirm('Unlock ' + period + '? Entries dated in that month can be edited again.')) return;
      try { await api('/periods/' + period + '/unlock', { method: 'POST', body: JSON.stringify({}) }); await loadPeriods(); } catch (e) { alert(e.message); }
    };
    await loadPeriods();
  }

  async function renderManualJournal(out) {
    const { accounts } = await lookups();
    window.__mjAcctOpts = accounts.map(a => '<option value="' + a.id + '">' + esc(a.code + ' · ' + a.name) + '</option>').join('');
    out.innerHTML =
      '<div class="acct-card"><h3 style="margin:0 0 4px">Manual journal</h3>' +
      '<p style="color:var(--muted);font-size:13px;margin:0 0 12px">A balanced entry for accruals, depreciation or corrections. Debits must equal credits before you can post.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">' +
        '<div><span class="rec-lbl">Date</span><input type="date" id="mjDate" class="rec-f" style="width:170px" value="' + today() + '"></div>' +
        '<div style="flex:1;min-width:220px"><span class="rec-lbl">Narration</span><input id="mjNarr" class="rec-f" placeholder="What is this entry for?"></div>' +
      '</div>' +
      '<table class="acct"><thead><tr><th>Account</th><th class="num" style="width:150px">Debit</th><th class="num" style="width:150px">Credit</th><th style="width:40px"></th></tr></thead><tbody id="mjLines"></tbody>' +
      '<tfoot><tr style="font-weight:500"><td>Total</td><td class="num" id="mjTD">₹0</td><td class="num" id="mjTC">₹0</td><td></td></tr></tfoot></table>' +
      '<div class="acct-actions" style="margin-top:10px"><button class="acct-btn ghost" id="mjAdd"><i class="ti ti-plus"></i>Add line</button></div>' +
      '<div class="acct-net"><span style="font-size:13px" id="mjBalMsg">Enter some amounts</span><span class="v" id="mjDiff">₹0</span></div>' +
      '<div class="acct-actions" style="margin-top:12px"><button class="acct-btn primary" id="mjPost" disabled><i class="ti ti-check"></i>Post journal</button></div>' +
      '<div class="acct-msg" id="mjMsg"></div></div>';
    const linesEl = document.getElementById('mjLines');
    window.__mjAddLine = function () {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><select class="rec-f mj-acct">' + window.__mjAcctOpts + '</select></td>' +
        '<td><input type="number" min="0" step="0.01" class="rec-f mj-d" oninput="window.__mjCalc()"></td>' +
        '<td><input type="number" min="0" step="0.01" class="rec-f mj-c" oninput="window.__mjCalc()"></td>' +
        '<td><button class="acct-btn ghost" onclick="this.closest(\'tr\').remove();window.__mjCalc()" style="padding:6px 9px">✕</button></td>';
      linesEl.appendChild(tr);
    };
    window.__mjCalc = function () {
      let td = 0, tc = 0;
      linesEl.querySelectorAll('tr').forEach(tr => { td += Number(tr.querySelector('.mj-d').value || 0); tc += Number(tr.querySelector('.mj-c').value || 0); });
      td = r2(td); tc = r2(tc);
      document.getElementById('mjTD').textContent = inr(td);
      document.getElementById('mjTC').textContent = inr(tc);
      const diff = r2(td - tc);
      document.getElementById('mjDiff').textContent = inr(Math.abs(diff));
      const balanced = diff === 0 && td > 0;
      const msg = document.getElementById('mjBalMsg');
      msg.textContent = balanced ? 'Balanced ✓' : (td === 0 && tc === 0 ? 'Enter some amounts' : 'Out by ' + inr(Math.abs(diff)));
      msg.style.color = balanced ? 'var(--green,#3B6D11)' : 'var(--muted)';
      document.getElementById('mjPost').disabled = !balanced;
    };
    document.getElementById('mjAdd').addEventListener('click', () => window.__mjAddLine());
    document.getElementById('mjPost').addEventListener('click', async () => {
      const msg = document.getElementById('mjMsg'); msg.className = 'acct-msg';
      const lines = [];
      linesEl.querySelectorAll('tr').forEach(tr => {
        const account_id = tr.querySelector('.mj-acct').value;
        const debit = Number(tr.querySelector('.mj-d').value || 0), credit = Number(tr.querySelector('.mj-c').value || 0);
        if (account_id && (debit > 0 || credit > 0)) lines.push({ account_id, debit, credit });
      });
      try {
        await api('/journals', { method: 'POST', body: JSON.stringify({ entry_date: document.getElementById('mjDate').value, narration: document.getElementById('mjNarr').value, lines }) });
        msg.className = 'acct-msg ok'; msg.textContent = 'Journal posted.';
        renderManualJournal(out);
      } catch (e) { msg.className = 'acct-msg err'; msg.textContent = e.message; }
    });
    window.__mjAddLine(); window.__mjAddLine(); window.__mjCalc();
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
    window.__recContactOpts = '<option value="">— who (optional) —</option><option value="__add">＋ Add a contact…</option>' +
      (contacts || []).map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    window.__recContacts = contacts || [];
    window.__recLineMap = {};
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
            '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="recBulkAuto" checked> auto-fill who from the statement</label>' +
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
    if (window.__recLineMap) window.__recLineMap[l.id] = l;
    const left =
      '<div class="rec-tx ' + (isIn ? 'rec-in' : 'rec-out') + '">' +
        (view === 'unmatched' ? '<input type="checkbox" class="rec-chk" data-line="' + l.id + '" onchange="window.__recSelChanged()">' : '') +
        '<div class="rec-ico ' + (isIn ? 'rec-ico-in' : 'rec-ico-out') + '"><i class="ti ' + ico + '"></i></div>' +
        '<div style="flex:1;min-width:0"><div style="font-size:11.5px;color:var(--muted)">' + esc(String(l.txn_date).slice(0, 10)) + '</div>' +
          '<div style="font-size:13px">' + esc(l.description || '') + '</div></div>' +
        '<div class="rec-col"><div class="rec-hd">Spent</div>' + (isIn ? '<div style="color:#C2BEB4">—</div>' : '<div class="rec-amt">' + inr(Math.abs(amt)) + '</div>') + '</div>' +
        '<div class="rec-col"><div class="rec-hd">Received</div>' + (isIn ? '<div class="rec-amt" style="color:#3B6D11">' + inr(amt) + '</div>' : '<div style="color:#C2BEB4">—</div>') + '</div>' +
      '</div>';
    if (view !== 'unmatched') {
      const right = '<div class="rec-code" style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
        '<span style="font-size:12.5px;color:var(--muted)">' + (view === 'matched' ? 'Reconciled' : 'Set aside') + '</span>' +
        '<button class="acct-btn ghost" onclick="window.__recUndo(' + l.id + ')"><i class="ti ti-arrow-back-up"></i>Undo</button></div>';
      return '<div class="rec-card">' + left + right + '</div>';
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
        '<div style="display:flex;gap:8px;margin-bottom:9px;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:150px"><span class="rec-lbl">What account</span><select class="rec-acct rec-f" data-line="' + l.id + '">' + window.__recAcctOpts + '</select></div>' +
          '<div style="flex:1;min-width:150px"><span class="rec-lbl">Who</span><select id="recWho-' + l.id + '" class="rec-f" onchange="window.__recWho(' + l.id + ')">' + whoOptsFor(l) + '</select></div>' +
        '</div>' +
        '<div style="margin-bottom:11px"><span class="rec-lbl">Why</span><input id="recWhy-' + l.id + '" class="rec-f" placeholder="Description (optional)"></div>' +
        '<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.55">Advance paid or deposit taken? Pick the contact under <b>Who</b>, then <b>Prepayment</b> — it sits as credit you can apply to their bill or invoice later.</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' + attControl('bank', l.id, l.att_count) +
          '<div style="display:flex;gap:8px;margin-left:auto"><button class="acct-btn ghost" onclick="window.__recIgnore(' + l.id + ')">Set aside</button><button class="acct-btn ghost" onclick="window.__recPrepay(' + l.id + ')">Prepayment</button><button class="acct-btn primary" onclick="window.__recCode(' + l.id + ')">Code</button></div>' +
        '</div>' +
      '</div>';
    const right =
      '<div class="rec-code" id="recright-' + l.id + '">' +
        '<div style="display:flex;gap:16px;margin-bottom:11px;border-bottom:1px solid #EFE7DA">' +
          '<button class="rec-seg' + (matchOn ? ' on' : '') + '" id="recseg-match-' + l.id + '" onclick="window.__recSeg(' + l.id + ",'match')\">Match</button>" +
          '<button class="rec-seg' + (matchOn ? '' : ' on') + '" id="recseg-code-' + l.id + '" onclick="window.__recSeg(' + l.id + ",'code')\">Code</button>" +
        '</div>' + matchPane + codePane +
      '</div>';
    return '<div class="rec-card">' + left + right + '</div>';
  }

  window.__recSeg = function (id, mode) {
    document.getElementById('recseg-match-' + id).classList.toggle('on', mode === 'match');
    document.getElementById('recseg-code-' + id).classList.toggle('on', mode === 'code');
    document.getElementById('recpane-match-' + id).style.display = mode === 'match' ? 'block' : 'none';
    document.getElementById('recpane-code-' + id).style.display = mode === 'code' ? 'block' : 'none';
  };

  window.__recWho = async function (id) {
    const sel = document.getElementById('recWho-' + id);
    if (!sel || sel.value !== '__add') return;
    const name = (window.prompt('New contact name (a supplier or customer you can reuse)') || '').trim();
    if (!name) { sel.value = ''; return; }
    try {
      const c = await api('/contacts', { method: 'POST', body: JSON.stringify({ name: name, kind: 'supplier' }) });
      window.__recContacts = await api('/contacts').catch(function () { return window.__recContacts || []; });
      document.querySelectorAll('select[id^="recWho-"]').forEach(function (s) {
        const lid = Number(s.id.replace('recWho-', ''));
        const keep = (s.value === '__add') ? '' : s.value;
        s.innerHTML = whoOptsFor((window.__recLineMap || {})[lid] || {});
        if (keep) s.value = keep;
      });
      sel.value = String(c.id);
    } catch (e) { alert(e.message); sel.value = ''; }
  };

  window.__recCode = async function (id) {
    const sel = document.querySelector('.rec-acct[data-line="' + id + '"]');
    if (!sel || !sel.value) { alert('Pick an account to code this to.'); return; }
    const who = document.getElementById('recWho-' + id);
    const why = document.getElementById('recWhy-' + id);
    const payload = { account_id: Number(sel.value) };
    if (who && who.value === '__use') {
      const opt = who.options[who.selectedIndex];
      const nm = opt ? (opt.getAttribute('data-name') || '').trim() : '';
      if (!nm) { alert('No name detected for this line — pick or add a contact, or leave Who blank.'); return; }
      try { const c = await api('/contacts', { method: 'POST', body: JSON.stringify({ name: nm, kind: 'supplier' }) }); payload.contact_id = c.id; }
      catch (e) { alert(e.message); return; }
    } else if (who && who.value && who.value !== '__add') {
      payload.contact_id = Number(who.value);
    }
    if (why && why.value.trim()) payload.note = why.value.trim();
    try { await api('/bank/lines/' + id + '/code', { method: 'POST', body: JSON.stringify(payload) }); await loadSummary(); await loadRecList('unmatched'); }
    catch (e) { alert(e.message); }
  };

  async function resolveWhoContact(id) {
    const who = document.getElementById('recWho-' + id);
    if (!who) return null;
    if (who.value === '__use') {
      const opt = who.options[who.selectedIndex];
      const nm = opt ? (opt.getAttribute('data-name') || '').trim() : '';
      if (!nm) throw new Error('No name detected — pick or add a contact first.');
      const c = await api('/contacts', { method: 'POST', body: JSON.stringify({ name: nm, kind: 'supplier' }) });
      return c.id;
    }
    if (who.value && who.value !== '__add') return Number(who.value);
    return null;
  }

  window.__recPrepay = async function (id) {
    let contactId;
    try { contactId = await resolveWhoContact(id); } catch (e) { alert(e.message); return; }
    if (!contactId) { alert('Pick the contact this advance or deposit is for (under Who), then tap Prepayment.'); return; }
    const why = document.getElementById('recWhy-' + id);
    const note = why && why.value.trim() ? why.value.trim() : undefined;
    try {
      await api('/bank/lines/' + id + '/prepayment', { method: 'POST', body: JSON.stringify({ contact_id: contactId, note: note }) });
      await loadSummary(); await loadRecList('unmatched');
    } catch (e) { alert(e.message); }
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
    const autoEl = document.getElementById('recBulkAuto');
    const autoWho = autoEl ? autoEl.checked : false;
    try {
      const r = await api('/bank/code-bulk', { method: 'POST', body: JSON.stringify({ line_ids: ids, account_id: Number(sel.value), auto_who: autoWho }) });
      if (autoWho) {
        const msg = document.getElementById('recMsg');
        if (msg) { msg.className = 'acct-msg ok'; msg.textContent = 'Coded ' + r.coded + ' · ' + r.named + ' got a name from the statement' + (r.no_name ? ' · ' + r.no_name + ' had no name (left blank)' : '') + '.'; }
      }
      await loadSummary(); await loadRecList('unmatched');
    } catch (e) { alert(e.message); }
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
        else if (tab === 'credits') await renderCredits(body);
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
