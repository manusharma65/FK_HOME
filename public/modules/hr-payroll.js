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
            '<div style="font-size:12px;color:var(--muted);margin-top:2px">Monthly pay breakdown for every active employee.</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<button class="btn" id="prPrev"><i class="ti ti-chevron-left"></i></button>' +
            '<div id="prMonthLabel" style="font-size:14px;font-weight:500;padding:6px 14px;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;min-width:140px;text-align:center">—</div>' +
            '<button class="btn" id="prNext"><i class="ti ti-chevron-right"></i></button>' +
            '<button class="btn" id="prCsv" style="background:var(--amber-deep);color:#FFF;border-color:var(--amber-deep)"><i class="ti ti-download"></i> Export CSV</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px" id="prSummary">' +
        '<div class="card" style="padding:10px 12px"><div style="font-size:11px;color:var(--muted);letter-spacing:0.04em">EMPLOYEES</div><div style="font-size:20px;font-weight:500" id="prTileEmp">—</div></div>' +
        '<div class="card" style="padding:10px 12px"><div style="font-size:11px;color:var(--muted);letter-spacing:0.04em">PAID DAYS</div><div style="font-size:20px;font-weight:500;color:var(--green)" id="prTilePaid">—</div></div>' +
        '<div class="card" style="padding:10px 12px"><div style="font-size:11px;color:var(--muted);letter-spacing:0.04em">UNPAID DAYS</div><div style="font-size:20px;font-weight:500;color:var(--red)" id="prTileUnpaid">—</div></div>' +
        '<div class="card" style="padding:10px 12px"><div style="font-size:11px;color:var(--muted);letter-spacing:0.04em">WEEKENDS UNPAID</div><div style="font-size:20px;font-weight:500;color:var(--amber-deep)" id="prTileWend">—</div></div>' +
      '</div>' +

      '<div class="card" style="padding:0">' +
        '<div style="overflow-x:auto">' +
          '<table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;min-width:820px">' +
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
                '<span style="width:24px;height:24px;border-radius:50%;background:' + (row.avatar_colour || '#888780') + ';color:#FFF;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500">' + esc(row.initials || '') + '</span>' +
                esc(row.name) + ' <span style="font-size:11px;padding:1px 6px;background:var(--surface);border-radius:4px">Owner</span>' +
              '</div></td>' +
              '<td colspan="9" style="padding:10px 8px;text-align:center;font-style:italic;font-size:12px">n/a — owner does not accrue</td>' +
              '<td></td>' +
              '</tr>';
          }
          const wendPaid = row.weekend_pairs_paid || 0;
          const wendTotal = row.weekend_pairs_total || 0;
          const wendOk = wendPaid === wendTotal;
          const wendCls = wendOk ? 'chip green' : 'chip red';
          return '<tr style="border-top:0.5px solid var(--line)">' +
            '<td style="padding:10px 12px"><div style="display:flex;align-items:center;gap:8px">' +
              '<span style="width:24px;height:24px;border-radius:50%;background:' + (row.avatar_colour || '#888780') + ';color:#FFF;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500">' + esc(row.initials || '') + '</span>' +
              esc(row.name) +
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
    document.addEventListener('click', function payrollClickHandler(ev) {
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
                              '<span style="font-size:12px;color:var(--muted)">—</span>';
              const wendTxt = day.weekend_pay_status ? (' · weekend ' + day.weekend_pay_status) : '';
              return '<tr style="border-top:0.5px solid var(--line)">' +
                '<td style="padding:8px 12px;width:40px;color:var(--muted)">' + esc(dayName) + '</td>' +
                '<td style="padding:8px 8px;width:30px">' + dayNum + '</td>' +
                '<td style="padding:8px 8px"><span class="chip ' + lbl.cls + '">' + esc(lbl.lbl) + '</span>' +
                  (wendTxt ? '<span style="font-size:11px;color:var(--muted);margin-left:6px">' + esc(wendTxt) + '</span>' : '') +
                '</td>' +
                '<td style="padding:8px 8px;text-align:right">' + paidTxt + '</td>' +
              '</tr>';
            }).join('');
        wrap.innerHTML =
          '<div class="card" id="prDrillCard" style="max-width:680px;width:100%;padding:14px 16px;background:var(--surface);max-height:90vh;overflow-y:auto">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
              '<div style="font-size:15px;font-weight:500">' + esc(name) + ' · ' + monthName(y, m) + '</div>' +
              '<button class="btn" id="prDrillClose" aria-label="Close"><i class="ti ti-x"></i></button>' +
            '</div>' +
            '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>' + rowsHtml + '</tbody></table></div>' +
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
    document.addEventListener('click', function (ev) {
      // close on X button
      if (ev.target.closest && ev.target.closest('#prDrillClose')) { closeDrill(); return; }
      // close on backdrop click (only when clicking the wrap itself, not inner card)
      if (ev.target.id === 'prDrillWrap') closeDrill();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        const wrap = document.getElementById('prDrillWrap');
        if (wrap && wrap.style.display !== 'none') closeDrill();
      }
    });

    document.getElementById('prPrev').addEventListener('click', () => {
      let { y, m } = getYM(); m--; if (m < 1) { m = 12; y--; } setYM(y, m); load();
    });
    document.getElementById('prNext').addEventListener('click', () => {
      let { y, m } = getYM(); m++; if (m > 12) { m = 1; y++; } setYM(y, m); load();
    });
    document.getElementById('prCsv').addEventListener('click', () => {
      const { y, m } = getYM();
      window.location.href = '/api/payroll/month.csv?year=' + y + '&month=' + m;
    });

    await load();
  },

  unmount() {
    const wrap = document.getElementById('prDrillWrap');
    if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
  }
};
