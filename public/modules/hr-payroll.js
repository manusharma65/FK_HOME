// FK Home — Payroll module (r0.15 HR-1.5)
// ----------------------------------------------------------------------------
// Monthly payroll view for HR + Owner. Per-employee paid/unpaid breakdown,
// weekend pay status, salary, CSV export. Drill into any row for day-by-day.
// Route: #hr/payroll
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/payroll'] = {
  title: 'Payroll',

  render() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return '' +
      '<div id="prState" data-year="' + y + '" data-month="' + m + '"></div>' +

      '<div class="card" style="margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
          '<div>' +
            '<div class="card-title"><i class="ti ti-cash"></i> Payroll</div>' +
            '<div style="font-size:13.5px;color:var(--muted);margin-top:2px">Monthly pay breakdown for every active employee.</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<button class="btn" id="prPrev"><i class="ti ti-chevron-left"></i></button>' +
            '<div id="prMonthLabel" style="font-size:14px;font-weight:500;padding:6px 14px;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;min-width:140px;text-align:center">—</div>' +
            '<button class="btn" id="prNext"><i class="ti ti-chevron-right"></i></button>' +
            '<button class="btn" id="prCsv" style="background:var(--amber-deep);color:#FFF;border-color:var(--amber-deep)"><i class="ti ti-download"></i> Export CSV</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card" id="prGenCard" style="margin-bottom:14px">' +
        '<div id="prGenWrap"><div style="color:var(--muted);font-size:14.5px;padding:6px 0">Loading payroll run…</div></div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px" id="prSummary">' +
        '<div class="card" style="padding:10px 12px"><div style="font-size:12.5px;color:var(--muted);letter-spacing:0.04em">EMPLOYEES</div><div style="font-size:20px;font-weight:500" id="prTileEmp">—</div></div>' +
        '<div class="card" style="padding:10px 12px"><div style="font-size:12.5px;color:var(--muted);letter-spacing:0.04em">PAID DAYS</div><div style="font-size:20px;font-weight:500;color:var(--green)" id="prTilePaid">—</div></div>' +
        '<div class="card" style="padding:10px 12px"><div style="font-size:12.5px;color:var(--muted);letter-spacing:0.04em">UNPAID DAYS</div><div style="font-size:20px;font-weight:500;color:var(--red)" id="prTileUnpaid">—</div></div>' +
        '<div class="card" style="padding:10px 12px"><div style="font-size:12.5px;color:var(--muted);letter-spacing:0.04em">WEEKENDS UNPAID</div><div style="font-size:20px;font-weight:500;color:var(--amber-deep)" id="prTileWend">—</div></div>' +
      '</div>' +

      '<div class="card" style="padding:0">' +
        '<div style="overflow-x:auto">' +
          '<table class="data-table" style="width:100%;border-collapse:collapse;font-size:14.5px;min-width:820px">' +
            '<thead><tr style="background:var(--bg)">' +
              '<th style="text-align:left;padding:10px 12px;font-weight:500;color:var(--muted)">Employee</th>' +
              '<th style="text-align:left;padding:10px 8px;font-weight:500;color:var(--muted)">Dept</th>' +
              '<th style="text-align:right;padding:10px 8px;font-weight:500;color:var(--muted)">Salary</th>' +
              '<th style="text-align:right;padding:10px 8px;font-weight:500;color:var(--muted)">Paid</th>' +
              '<th style="text-align:right;padding:10px 8px;font-weight:500;color:var(--muted)">Unpaid</th>' +
              '<th style="text-align:right;padding:10px 8px;font-weight:500;color:var(--muted)">A.L.</th>' +
              '<th style="text-align:right;padding:10px 8px;font-weight:500;color:var(--muted)">Sick (paid)</th>' +
              '<th style="text-align:right;padding:10px 8px;font-weight:500;color:var(--muted)">Sick (unpaid)</th>' +
              '<th style="text-align:left;padding:10px 8px;font-weight:500;color:var(--muted)">Weekends</th>' +
              '<th style="text-align:right;padding:10px 8px;font-weight:500;color:var(--muted)">Late</th>' +
              '<th style="padding:10px 8px"></th>' +
            '</tr></thead>' +
            '<tbody id="prBody"><tr><td colspan="11" style="text-align:center;color:var(--muted);padding:18px">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<div id="prDrillWrap" style="display:none;position:fixed;inset:0;background:rgba(20,22,27,0.55);z-index:1000;align-items:flex-start;justify-content:center;padding:5vh 20px;overflow-y:auto"></div>';
  },

  async mount(rootEl) {
    // Document-level listeners must be tracked and removed, or they stack on
    // every revisit (that was the "preview opens 3 tabs" bug). Clear any left
    // over from a prior mount, then register through onDoc so unmount can undo.
    const MOD = window.fkModules['hr/payroll'];
    if (MOD._docHandlers) MOD._docHandlers.forEach(([t, f]) => document.removeEventListener(t, f));
    MOD._docHandlers = [];
    const onDoc = (type, fn) => { document.addEventListener(type, fn); MOD._docHandlers.push([type, fn]); };

    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const monthName = (y, m) =>
      new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const state = document.getElementById('prState');
    function getYM() {
      return { y: parseInt(state.dataset.year, 10), m: parseInt(state.dataset.month, 10) };
    }
    function setYM(y, m) { state.dataset.year = y; state.dataset.month = m; }

    async function load() {
      const { y, m } = getYM();
      document.getElementById('prMonthLabel').textContent = monthName(y, m);
      const body = document.getElementById('prBody');
      body.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:18px">Loading…</td></tr>';
      try {
        const r = await fetch('/api/payroll/month?year=' + y + '&month=' + m, { credentials: 'include' });
        if (!r.ok) {
          body.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--red);padding:18px">Permission denied or failed.</td></tr>';
          return;
        }
        const d = await r.json();
        document.getElementById('prTileEmp').textContent = d.employees;
        document.getElementById('prTilePaid').textContent = d.totals.paid_days;
        document.getElementById('prTileUnpaid').textContent = d.totals.unpaid_days;
        document.getElementById('prTileWend').textContent = d.totals.weekends_unpaid;
        body.innerHTML = d.rows.map(row => {
          if (row.is_owner) {
            return '<tr style="background:var(--bg);color:var(--muted)">' +
              '<td style="padding:10px 12px"><div style="display:flex;align-items:center;gap:8px">' +
                '<span style="width:24px;height:24px;border-radius:50%;background:' + (row.avatar_colour || '#888780') + ';color:#FFF;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:500">' + esc(row.initials || '') + '</span>' +
                '<span class="nm">' + esc(row.name) + '</span> <span style="font-size:12.5px;padding:1px 6px;background:var(--surface);border-radius:4px">Owner</span>' +
              '</div></td>' +
              '<td colspan="9" style="padding:10px 8px;text-align:center;font-style:italic;font-size:13.5px">n/a — owner does not accrue</td>' +
              '<td></td>' +
              '</tr>';
          }
          const wendPaid = row.weekend_pairs_paid || 0;
          const wendTotal = row.weekend_pairs_total || 0;
          const wendOk = wendPaid === wendTotal;
          const wendCls = wendOk ? 'chip green' : 'chip red';
          return '<tr style="border-top:0.5px solid var(--line)">' +
            '<td style="padding:10px 12px"><div style="display:flex;align-items:center;gap:8px">' +
              '<span style="width:24px;height:24px;border-radius:50%;background:' + (row.avatar_colour || '#888780') + ';color:#FFF;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:500">' + esc(row.initials || '') + '</span>' +
              '<span class="nm">' + esc(row.name) + '</span>' +
            '</div></td>' +
            '<td style="padding:10px 8px;color:var(--muted)">' + esc(row.dept_name) + '</td>' +
            '<td style="padding:10px 8px;text-align:right">' + (row.monthly_salary != null ? '£' + Number(row.monthly_salary).toLocaleString('en-GB') : '—') + '</td>' +
            '<td style="padding:10px 8px;text-align:right;font-weight:500;color:var(--green)">' + row.paid_days + '</td>' +
            '<td style="padding:10px 8px;text-align:right' + (row.unpaid_days > 0 ? ';color:var(--red);font-weight:500' : ';color:var(--muted)') + '">' + row.unpaid_days + '</td>' +
            '<td style="padding:10px 8px;text-align:right">' + row.annual_leave + '</td>' +
            '<td style="padding:10px 8px;text-align:right">' + row.sick_paid + '</td>' +
            '<td style="padding:10px 8px;text-align:right' + (row.sick_unpaid > 0 ? ';color:var(--red)' : '') + '">' + row.sick_unpaid + '</td>' +
            '<td style="padding:10px 8px"><span class="' + wendCls + '">' + wendPaid + ' of ' + wendTotal + ' paid</span></td>' +
            '<td style="padding:10px 8px;text-align:right' + (row.late_count > 0 ? ';color:var(--amber-deep)' : ';color:var(--muted)') + '">' + row.late_count + '</td>' +
            '<td style="padding:10px 8px;text-align:right"><button class="btn pr-view" data-uid="' + row.user_id + '" data-name="' + esc(row.name) + '">View</button></td>' +
          '</tr>';
        }).join('');
      } catch (e) {
        console.error('[payroll]', e);
        body.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--red);padding:18px">Failed to load.</td></tr>';
      }
    }

    // r0.15.2 — Event delegation for View buttons. Works even after re-renders.
    onDoc('click', function payrollClickHandler(ev) {
      const btn = ev.target.closest && ev.target.closest('.pr-view');
      if (!btn) return;
      ev.preventDefault();
      const uid = parseInt(btn.dataset.uid, 10);
      const name = btn.dataset.name || '';
      console.log('[payroll] View clicked for user', uid, name);
      drillUser(uid, name);
    });

    async function drillUser(userId, name) {
      const { y, m } = getYM();
      const wrap = document.getElementById('prDrillWrap');
      wrap.style.display = 'flex';
      wrap.innerHTML = '<div class="card" style="max-width:680px;width:100%;padding:14px 16px;background:var(--surface)"><div style="padding:14px;text-align:center;color:var(--muted)">Loading day-by-day for ' + esc(name) + '…</div></div>';
      try {
        const r = await fetch('/api/payroll/month/' + userId + '/days?year=' + y + '&month=' + m, { credentials: 'include' });
        if (!r.ok) {
          wrap.innerHTML = '<div class="card" style="max-width:680px;width:100%;padding:14px;color:var(--red);background:var(--surface)">Failed to load drill</div>';
          return;
        }
        const d = await r.json();
        const labels = {
          on_time: { lbl: 'On time', cls: 'green' },
          late: { lbl: 'Late', cls: 'amber' },
          very_late: { lbl: 'Very late', cls: 'red' },
          not_yet_in: { lbl: 'Not in', cls: 'muted' },
          on_leave: { lbl: 'Annual leave', cls: 'amber' },
          off_sick: { lbl: 'Sick', cls: 'red' },
          off_pattern: { lbl: 'Off (pattern)', cls: 'muted' },
          off_cs_rota: { lbl: 'Off (rota)', cls: 'muted' },
          off_holiday: { lbl: 'Off (holiday)', cls: 'muted' },
          worked_voluntary: { lbl: 'Worked', cls: 'green' },
          pending: { lbl: 'Pending', cls: 'muted' },
        };
        const rowsHtml = d.days.length === 0
          ? '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--muted)">No attendance records for this month.</td></tr>'
          : d.days.map(day => {
              const dt = new Date(day.for_date);
              const dayName = dt.toLocaleDateString('en-GB', { weekday: 'short' });
              const dayNum = dt.getUTCDate();
              const lbl = labels[day.status] || { lbl: day.status, cls: 'muted' };
              const paidTxt = day.is_paid === true ? '<span class="chip green">Paid</span>' :
                              day.is_paid === false ? '<span class="chip red">Unpaid</span>' :
                              '<span style="font-size:13.5px;color:var(--muted)">—</span>';
              const wendTxt = day.weekend_pay_status ? (' · weekend ' + day.weekend_pay_status) : '';
              return '<tr style="border-top:0.5px solid var(--line)">' +
                '<td style="padding:8px 12px;width:40px;color:var(--muted)">' + esc(dayName) + '</td>' +
                '<td style="padding:8px 8px;width:30px">' + dayNum + '</td>' +
                '<td style="padding:8px 8px"><span class="chip ' + lbl.cls + '">' + esc(lbl.lbl) + '</span>' +
                  (wendTxt ? '<span style="font-size:12.5px;color:var(--muted);margin-left:6px">' + esc(wendTxt) + '</span>' : '') +
                '</td>' +
                '<td style="padding:8px 8px;text-align:right">' + paidTxt + '</td>' +
              '</tr>';
            }).join('');
        wrap.innerHTML =
          '<div class="card" id="prDrillCard" style="max-width:680px;width:100%;padding:14px 16px;background:var(--surface);max-height:90vh;overflow-y:auto">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
              '<div style="font-size:15px"><span class="nm">' + esc(name) + '</span> · ' + monthName(y, m) + '</div>' +
              '<button class="btn" id="prDrillClose" aria-label="Close"><i class="ti ti-x"></i></button>' +
            '</div>' +
            '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14.5px"><tbody>' + rowsHtml + '</tbody></table></div>' +
          '</div>';
      } catch (e) {
        console.error('[payroll drill]', e);
        wrap.innerHTML = '<div class="card" style="max-width:680px;width:100%;padding:14px;color:var(--red);background:var(--surface)">Failed to load drill</div>';
      }
    }

    // r0.15.3 — Close handlers for the modal: close button, click outside, ESC.
    function closeDrill() {
      const wrap = document.getElementById('prDrillWrap');
      if (!wrap) return;
      wrap.style.display = 'none';
      wrap.innerHTML = '';
    }
    onDoc('click', function (ev) {
      // close on X button
      if (ev.target.closest && ev.target.closest('#prDrillClose')) { closeDrill(); return; }
      // close on backdrop click (only when clicking the wrap itself, not inner card)
      if (ev.target.id === 'prDrillWrap') closeDrill();
    });
    onDoc('keydown', function (ev) {
      if (ev.key === 'Escape') {
        const wrap = document.getElementById('prDrillWrap');
        if (wrap && wrap.style.display !== 'none') closeDrill();
      }
    });

    // ===== Payroll generation (run -> review -> approve -> publish) =========
    const moneyINR = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN',
      { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    function statusChip(r) {
      if (r.flagged) return '<span class="chip amber">No salary on file</span>';
      if (r.status === 'published') return '<span class="chip green">Published</span>';
      if (r.status === 'revoked') return '<span class="chip red">Revoked</span>';
      if (r.held || r.override_reason) return '<span class="chip amber">Edited · held</span>';
      return '<span class="chip muted">Draft · ready</span>';
    }

    var genRows = {};   // id -> row, so the editor has full data

    async function loadGen() {
      const { y, m } = getYM();
      const wrap = document.getElementById('prGenWrap');
      if (!wrap) return;
      wrap.innerHTML = '<div style="color:var(--muted);font-size:14.5px;padding:6px 0">Loading payroll run…</div>';
      try {
        const r = await fetch('/api/payroll/run?year=' + y + '&month=' + m, { credentials: 'include' });
        if (!r.ok) { wrap.innerHTML = '<div style="color:var(--red);font-size:14.5px">Permission denied or failed.</div>'; return; }
        renderGenPanel(await r.json(), y, m);
      } catch (e) {
        console.error('[payroll gen]', e);
        wrap.innerHTML = '<div style="color:var(--red);font-size:14.5px">Failed to load run.</div>';
      }
    }

    function renderGenPanel(d, y, m) {
      const wrap = document.getElementById('prGenWrap');
      const label = monthName(y, m);
      genRows = {};
      if (!d.run) {
        wrap.dataset.runId = '';
        wrap.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">' +
            '<div><div style="font-size:15px;font-weight:600">Generate payslips for ' + esc(label) + '</div>' +
            '<div style="font-size:13.5px;color:var(--muted);margin-top:3px;max-width:520px">Creates a draft payslip for every active India employee from their salary and attendance. Nothing is published until you review and publish.</div></div>' +
            '<button class="btn pr-run" style="background:var(--green);color:#fff;border-color:var(--green);padding:10px 18px;font-size:14px"><i class="ti ti-player-play"></i> Run payroll</button>' +
          '</div>';
        return;
      }
      const run = d.run;
      const rows = d.rows || [];
      rows.forEach(r => { genRows[r.id] = r; });
      wrap.dataset.runId = run.id;
      const totalNet = rows.filter(r => r.status !== 'revoked' && !r.flagged).reduce((s, r) => s + Number(r.net_pay || 0), 0);
      const flagged = rows.filter(r => r.flagged).length;
      const publishedCount = rows.filter(r => r.status === 'published').length;
      const readyCount = rows.filter(r => r.status === 'draft' && !r.held && !r.flagged).length;

      const head =
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:4px">' +
          '<div><div style="font-size:15px;font-weight:600">Payroll — ' + esc(label) + ' ' +
            (run.status === 'approved' ? '<span class="chip green">Complete</span>' : '<span class="chip muted">Draft</span>') + '</div>' +
          '<div style="font-size:13.5px;color:var(--muted);margin-top:3px">' + rows.length + ' payslips · ' + publishedCount + ' published · total net ' + moneyINR(totalNet) +
            (flagged ? ' · <span style="color:var(--amber-deep)">' + flagged + ' with no salary on file</span>' : '') + '</div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button class="btn pr-rerun" style="padding:9px 14px"><i class="ti ti-refresh"></i> Re-generate all</button>' +
            '<button class="btn pr-publishready" ' + (readyCount ? '' : 'disabled ') + 'style="background:var(--green);color:#fff;border-color:var(--green);padding:9px 16px;font-size:14px' + (readyCount ? '' : ';opacity:.5') + '"><i class="ti ti-upload"></i> Publish all ready (' + readyCount + ')</button>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:13.5px;color:var(--muted);background:var(--bg);border:0.5px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0 12px">Publish each person when their figures are right — individually, or “Publish all ready” to push everyone with no unresolved edits. Edited rows are held until you publish them.</div>';

      const list = rows.map(r => {
        const lopTxt = Number(r.lop_days) > 0
          ? '<span style="color:var(--red);font-weight:500">' + r.lop_days + '</span>'
          : '<span style="color:var(--muted)">0</span>';
        const lopDates = (Array.isArray(r.lop_dates) && r.lop_dates.length)
          ? '<div style="font-size:12.5px;color:var(--muted);margin-top:2px">LOP: ' + r.lop_dates.map(esc).join(', ') + '</div>' : '';
        const ovr = r.override_reason
          ? '<div style="font-size:12.5px;color:var(--amber-deep);margin-top:2px"><i class="ti ti-pencil"></i> ' + esc(r.override_reason) + '</div>' : '';
        const netCol = (Number(r.net_pay) < 0)
          ? '<span style="color:var(--red);font-weight:600">' + moneyINR(r.net_pay) + '</span>'
          : (r.flagged ? '<span style="color:var(--muted)">—</span>' : '<span style="font-weight:600">' + moneyINR(r.net_pay) + '</span>');
        let actions;
        if (r.status === 'published') {
          actions = '<button class="btn pr-pview" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-eye"></i> View</button>' +
                    '<button class="btn pr-revoke" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-ban"></i> Revoke</button>';
        } else if (r.status === 'revoked') {
          actions = '<button class="btn pr-pview" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-eye"></i> View</button>' +
                    '<button class="btn pr-edit" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-pencil"></i> Edit</button>' +
                    '<button class="btn pr-publish" data-id="' + r.id + '" style="padding:8px 12px;background:var(--green);color:#fff;border-color:var(--green)"><i class="ti ti-upload"></i> Re-publish</button>';
        } else if (r.flagged) {
          actions = '<button class="btn" disabled style="padding:8px 12px;opacity:.5"><i class="ti ti-upload"></i> Publish</button>';
        } else {
          actions = '<button class="btn pr-pview" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-eye"></i> Preview</button>' +
                    '<button class="btn pr-edit" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-pencil"></i> Edit</button>' +
                    '<button class="btn pr-publish" data-id="' + r.id + '" style="padding:8px 12px;background:var(--green);color:#fff;border-color:var(--green)"><i class="ti ti-upload"></i> Publish</button>';
        }
        return '<tr style="border-top:0.5px solid var(--line)' + (r.flagged ? ';background:var(--bg)' : '') + '">' +
          '<td style="padding:10px 12px"><div style="display:flex;align-items:center;gap:8px">' +
            '<span style="width:24px;height:24px;border-radius:50%;background:' + (r.avatar_colour || '#888780') + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12.5px;flex:none">' + esc(r.initials || '') + '</span>' +
            '<div><span class="nm">' + esc(r.emp_name) + '</span>' + lopDates + ovr + '</div>' +
          '</div></td>' +
          '<td style="padding:10px 8px;color:var(--muted)">' + esc(r.emp_department || '\u2014') + '</td>' +
          '<td style="padding:10px 8px;text-align:right">' + lopTxt + '</td>' +
          '<td style="padding:10px 8px;text-align:right">' + netCol + '</td>' +
          '<td style="padding:10px 8px">' + statusChip(r) + '</td>' +
          '<td style="padding:10px 8px"><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">' + actions + '</div></td>' +
        '</tr>';
      }).join('');

      wrap.innerHTML = head +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14.5px;min-width:680px">' +
          '<thead><tr style="background:var(--bg)">' +
            '<th style="text-align:left;padding:9px 12px;font-weight:500;color:var(--muted)">Employee</th>' +
            '<th style="text-align:left;padding:9px 8px;font-weight:500;color:var(--muted)">Dept</th>' +
            '<th style="text-align:right;padding:9px 8px;font-weight:500;color:var(--muted)">LOP</th>' +
            '<th style="text-align:right;padding:9px 8px;font-weight:500;color:var(--muted)">Net pay</th>' +
            '<th style="text-align:left;padding:9px 8px;font-weight:500;color:var(--muted)">Status</th>' +
            '<th style="padding:9px 8px"></th>' +
          '</tr></thead><tbody>' + list + '</tbody></table></div>';
    }

    // ---- Line editor (LOP + earnings + deductions + reason) ----------------
    var ed = { id: null, extra: [], deds: [] };
    function edCompute() {
      const row = genRows[ed.id]; if (!row) return;
      const cd = Number(row.calendar_days) || 30;
      const employed = Number(row.employed_days != null ? row.employed_days : cd);
      const ctc = Number(row.monthly_ctc) || 0;
      let lop = Number(document.getElementById('edLop').value) || 0;
      lop = Math.max(0, Math.min(employed, lop));
      const payDays = Math.max(0, employed - lop);
      const gross = (payDays >= cd) ? ctc : Math.round(ctc * payDays / cd);
      const basic = Math.round(gross * 0.6), hra = Math.round(gross * 0.3), spec = gross - basic - hra;
      document.getElementById('edBasic').textContent = moneyINR(basic);
      document.getElementById('edHra').textContent = moneyINR(hra);
      document.getElementById('edSpec').textContent = moneyINR(spec);
      const addE = ed.extra.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const totD = ed.deds.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const net = gross + addE - totD;
      document.getElementById('edNet').textContent = moneyINR(net);
      document.getElementById('edWarn').style.display = net < 0 ? 'block' : 'none';
    }
    function edRowHtml(kind, i, o) {
      return '<div class="ed-lrow" style="display:grid;grid-template-columns:1.4fr .9fr 1.4fr auto;gap:8px;align-items:center;margin-bottom:8px">' +
        '<input placeholder="Label" value="' + esc(o.label || '') + '" oninput="window.__edSet(\'' + kind + '\',' + i + ',\'label\',this.value)">' +
        '<input type="number" placeholder="Amount" value="' + (o.amount != null ? esc(o.amount) : '') + '" oninput="window.__edSet(\'' + kind + '\',' + i + ',\'amount\',this.value)">' +
        '<input placeholder="Reason" value="' + esc(o.reason || '') + '" oninput="window.__edSet(\'' + kind + '\',' + i + ',\'reason\',this.value)">' +
        '<button class="btn" style="padding:7px 10px" onclick="window.__edDel(\'' + kind + '\',' + i + ')"><i class="ti ti-x"></i></button></div>';
    }
    function edDraw() {
      document.getElementById('edExtra').innerHTML = ed.extra.map((o, i) => edRowHtml('extra', i, o)).join('');
      document.getElementById('edDeds').innerHTML = ed.deds.map((o, i) => edRowHtml('deds', i, o)).join('');
    }
    window.__edSet = function (kind, i, field, val) { ed[kind][i][field] = val; if (field === 'amount') edCompute(); };
    window.__edDel = function (kind, i) { ed[kind].splice(i, 1); edDraw(); edCompute(); };

    function openEditor(id) {
      const row = genRows[id]; if (!row) return;
      ed.id = id;
      ed.extra = (Array.isArray(row.extra_earnings) ? row.extra_earnings : []).map(o => ({ label: o.label, amount: o.amount, reason: o.reason || '' }));
      ed.deds = (Array.isArray(row.deductions) ? row.deductions : []).map(o => ({ label: o.label, amount: (o.actual != null ? o.actual : o.amount), reason: o.reason || '' }));
      const cd = Number(row.calendar_days) || 30;
      const employed = Number(row.employed_days != null ? row.employed_days : cd);
      const daily = Number(row.daily_rate || Math.round(Number(row.monthly_ctc || 0) / cd));
      const balDays = Number(row.leave_remaining || 0);
      const wrap = document.getElementById('prDrillWrap');
      wrap.style.display = 'flex';
      const encash = balDays > 0
        ? '<div style="background:#EAF6EE;border:1px solid #BFE3CA;border-radius:9px;padding:10px 12px;font-size:12.5px;display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0">' +
            '<div>\uD83D\uDCA1 <b>Leave encashment</b> available — balance <b>' + balDays + ' days</b> \u00D7 ' + moneyINR(daily) + ' = <b>' + moneyINR(balDays * daily) + '</b></div>' +
            '<button class="btn" id="edEncash" style="padding:7px 11px">Add as earning</button></div>'
        : '';
      wrap.innerHTML =
        '<div class="card" style="max-width:660px;width:100%;background:var(--surface);max-height:90vh;overflow:auto;padding:0">' +
          '<div style="padding:16px 20px;border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
            '<div><div style="font-size:16px;font-weight:600">Edit payslip — ' + esc(row.emp_name) + '</div>' +
            '<div style="font-size:13.5px;color:var(--muted);margin-top:2px">Base CTC ' + moneyINR(row.monthly_ctc) + ' · ' + employed + ' work days in month · daily rate ' + moneyINR(daily) + '</div></div>' +
            '<button class="btn" id="edClose" style="padding:7px 10px"><i class="ti ti-x"></i></button>' +
          '</div>' +
          '<div style="padding:16px 20px">' +
            '<div style="font-size:13.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:4px 0 8px">1 · Unpaid days (LOP)</div>' +
            '<div style="display:flex;gap:10px;align-items:center">' +
              '<input id="edLop" type="number" min="0" max="' + employed + '" value="' + esc(row.lop_days || 0) + '" style="width:120px;padding:8px 10px;border:0.5px solid var(--line);border-radius:9px" oninput="(' + 'function(){})();">' +
              '<div style="font-size:11.5px;color:var(--muted)">0–' + employed + ' only. Pay is pro-rated. Mid-month joiners are prorated from joining date automatically.</div>' +
            '</div>' +
            '<div style="font-size:13.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px">2 · Earnings</div>' +
            '<div style="display:grid;grid-template-columns:1.4fr .9fr;gap:8px;background:var(--bg);border-radius:9px;padding:8px 10px;margin-bottom:6px"><div>Basic (60%)</div><div style="text-align:right" id="edBasic">—</div></div>' +
            '<div style="display:grid;grid-template-columns:1.4fr .9fr;gap:8px;background:var(--bg);border-radius:9px;padding:8px 10px;margin-bottom:6px"><div>HRA (30%)</div><div style="text-align:right" id="edHra">—</div></div>' +
            '<div style="display:grid;grid-template-columns:1.4fr .9fr;gap:8px;background:var(--bg);border-radius:9px;padding:8px 10px;margin-bottom:6px"><div>Special Allowance (10%)</div><div style="text-align:right" id="edSpec">—</div></div>' +
            encash +
            '<div id="edExtra"></div>' +
            '<button class="btn" id="edAddE" style="padding:8px 12px"><i class="ti ti-plus"></i> Add earning (bonus, arrears, incentive, reimbursement…)</button>' +
            '<div style="font-size:13.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px">3 · Deductions</div>' +
            '<div id="edDeds"></div>' +
            '<button class="btn" id="edAddD" style="padding:8px 12px"><i class="ti ti-plus"></i> Add deduction (advance recovery, loan, penalty…)</button>' +
            '<div style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;background:#FCF1E8;border:1px solid #F0CFB4;border-left:4px solid var(--amber-deep);border-radius:11px;padding:13px 18px">' +
              '<div style="font-size:13.5px;color:var(--muted)">Net pay for ' + esc(monthName(getYM().y, getYM().m)) + '</div>' +
              '<div style="font-size:22px;font-weight:800" id="edNet">—</div></div>' +
            '<div id="edWarn" style="display:none;margin-top:10px;background:#FBEAE8;border:1px solid #F0C9C3;color:var(--red);font-size:12.5px;padding:9px 12px;border-radius:9px">\u26A0 Net pay is negative — deductions exceed earnings. You can still save, but please double-check.</div>' +
            '<div style="font-size:13.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px">4 · Reason for changes (logged)</div>' +
            '<input id="edReason" type="text" placeholder="e.g. 3 days LOP plus festival bonus" style="width:100%;padding:9px 11px;border:0.5px solid var(--line);border-radius:9px">' +
          '</div>' +
          '<div style="padding:14px 20px;border-top:0.5px solid var(--line);display:flex;gap:9px;justify-content:flex-end;background:var(--bg)">' +
            '<button class="btn" id="edCancel" style="padding:9px 16px">Cancel</button>' +
            '<button class="btn" id="edSaveHold" style="padding:9px 16px"><i class="ti ti-device-floppy"></i> Save draft (hold)</button>' +
            '<button class="btn" id="edSavePub" style="padding:9px 16px;background:var(--green);color:#fff;border-color:var(--green)"><i class="ti ti-upload"></i> Save &amp; publish</button>' +
          '</div>' +
        '</div>';
      document.getElementById('edLop').addEventListener('input', edCompute);
      document.getElementById('edAddE').onclick = () => { ed.extra.push({ label: '', amount: '', reason: '' }); edDraw(); };
      document.getElementById('edAddD').onclick = () => { ed.deds.push({ label: '', amount: '', reason: '' }); edDraw(); };
      const enc = document.getElementById('edEncash');
      if (enc) enc.onclick = () => { ed.extra.push({ label: 'Leave encashment (' + balDays + ' days)', amount: balDays * daily, reason: 'Leave encashment on ' + balDays + ' days balance' }); edDraw(); edCompute(); };
      document.getElementById('edClose').onclick = closeEditor;
      document.getElementById('edCancel').onclick = closeEditor;
      document.getElementById('edSaveHold').onclick = () => saveEditor(false);
      document.getElementById('edSavePub').onclick = () => saveEditor(true);
      edDraw(); edCompute();
    }
    function closeEditor() { const w = document.getElementById('prDrillWrap'); w.style.display = 'none'; w.innerHTML = ''; }
    async function saveEditor(publish) {
      const reason = (document.getElementById('edReason').value || '').trim();
      if (!reason) { alert('Please enter a reason for the changes.'); return; }
      const lop = Number(document.getElementById('edLop').value) || 0;
      const extra = ed.extra.filter(e => (e.label || '').trim() && Number(e.amount));
      const deds = ed.deds.filter(e => (e.label || '').trim() && Number(e.amount));
      const body = { lop_days: lop, extra_earnings: extra, deductions: deds, reason: reason, publish: publish };
      const btnH = document.getElementById('edSaveHold'), btnP = document.getElementById('edSavePub');
      btnH.disabled = true; btnP.disabled = true;
      try {
        const r = await fetch('/api/payroll/payslip/' + ed.id + '/override', { method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json();
        if (!r.ok) { alert(d.error || 'Failed'); btnH.disabled = false; btnP.disabled = false; return; }
        closeEditor();
        await loadGen();
      } catch (e) { console.error(e); alert('Failed'); btnH.disabled = false; btnP.disabled = false; }
    }

    function openReasonModal(opts) {
      const wrap = document.getElementById('prDrillWrap');
      wrap.style.display = 'flex';
      wrap.innerHTML =
        '<div class="card" style="max-width:460px;width:100%;padding:18px 20px;background:var(--surface)">' +
          '<div style="font-size:15px;font-weight:600;margin-bottom:4px">' + esc(opts.title) + '</div>' +
          '<div style="font-size:13.5px;color:var(--muted)">' + esc(opts.sub || '') + '</div>' +
          '<label style="display:block;font-size:13.5px;color:var(--muted);margin:12px 0 4px">Reason (logged)</label>' +
          '<textarea id="prmReason" rows="3" style="width:100%;padding:9px 12px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;resize:vertical" placeholder="Why this change?"></textarea>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
            '<button class="btn" id="prmCancel" style="padding:9px 16px">Cancel</button>' +
            '<button class="btn" id="prmSave" style="padding:9px 16px;background:var(--amber-deep);color:#fff;border-color:var(--amber-deep)">' + esc(opts.cta || 'Save') + '</button>' +
          '</div>' +
        '</div>';
      document.getElementById('prmCancel').onclick = () => { wrap.style.display = 'none'; wrap.innerHTML = ''; };
      document.getElementById('prmSave').onclick = async () => {
        const reason = (document.getElementById('prmReason').value || '').trim();
        if (!reason) { alert('Please enter a reason.'); return; }
        const btn = document.getElementById('prmSave'); btn.disabled = true;
        try {
          const r = await fetch(opts.url, { method: opts.method, credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason }) });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Failed'); btn.disabled = false; return; }
          wrap.style.display = 'none'; wrap.innerHTML = '';
          await loadGen();
        } catch (e) { console.error(e); alert('Failed'); btn.disabled = false; }
      };
    }

    onDoc('click', async function payrollGenHandler(ev) {
      const t = ev.target.closest && ev.target.closest(
        '.pr-run,.pr-rerun,.pr-publishready,.pr-publish,.pr-edit,.pr-revoke,.pr-pview');
      if (!t) return;
      ev.preventDefault();
      const { y, m } = getYM();
      const genWrap = document.getElementById('prGenWrap');
      const runId = genWrap ? genWrap.dataset.runId : '';

      if (t.classList.contains('pr-pview')) {
        window.open('/api/payroll/payslip/' + t.dataset.id + '/html', '_blank', 'noopener'); return;
      }
      if (t.classList.contains('pr-edit')) { openEditor(parseInt(t.dataset.id, 10)); return; }
      if (t.classList.contains('pr-run') || t.classList.contains('pr-rerun')) {
        t.disabled = true;
        try {
          const r = await fetch('/api/payroll/run', { method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: y, month: m }) });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Failed to generate'); t.disabled = false; return; }
          await loadGen();
        } catch (e) { console.error(e); alert('Failed to generate'); t.disabled = false; }
        return;
      }
      if (t.classList.contains('pr-publishready')) {
        if (!runId) return;
        if (!confirm('Publish all ready payslips? Each of those employees will be notified and their figures locked.')) return;
        t.disabled = true;
        try {
          const r = await fetch('/api/payroll/run/' + runId + '/publish-ready', { method: 'POST', credentials: 'include' });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Failed'); t.disabled = false; return; }
          await loadGen();
        } catch (e) { console.error(e); alert('Failed'); t.disabled = false; }
        return;
      }
      if (t.classList.contains('pr-publish')) {
        if (!confirm('Publish this payslip? The employee will be notified and the figures locked.')) return;
        t.disabled = true;
        try {
          const r = await fetch('/api/payroll/payslip/' + t.dataset.id + '/publish', { method: 'POST', credentials: 'include' });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Failed'); t.disabled = false; return; }
          await loadGen();
        } catch (e) { console.error(e); alert('Failed'); t.disabled = false; }
        return;
      }
      if (t.classList.contains('pr-revoke')) {
        openReasonModal({
          title: 'Revoke payslip', sub: 'The employee will no longer see this payslip. You can edit and re-publish.',
          withLop: false, cta: 'Revoke', url: '/api/payroll/payslip/' + t.dataset.id + '/revoke', method: 'POST',
        });
        return;
      }
    });


    document.getElementById('prPrev').addEventListener('click', () => {
      let { y, m } = getYM(); m--; if (m < 1) { m = 12; y--; } setYM(y, m); load(); loadGen();
    });
    document.getElementById('prNext').addEventListener('click', () => {
      let { y, m } = getYM(); m++; if (m > 12) { m = 1; y++; } setYM(y, m); load(); loadGen();
    });
    document.getElementById('prCsv').addEventListener('click', () => {
      const { y, m } = getYM();
      window.location.href = '/api/payroll/month.csv?year=' + y + '&month=' + m;
    });

    await load();
    await loadGen();
  },

  unmount() {
    const MOD = window.fkModules['hr/payroll'];
    if (MOD._docHandlers) { MOD._docHandlers.forEach(([t, f]) => document.removeEventListener(t, f)); MOD._docHandlers = []; }
    const wrap = document.getElementById('prDrillWrap');
    if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
  }
};
