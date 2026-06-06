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

      '<div class="card" id="prGenCard" style="margin-bottom:14px">' +
        '<div id="prGenWrap"><div style="color:var(--muted);font-size:13px;padding:6px 0">Loading payroll run…</div></div>' +
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

    // ===== Payroll generation (run -> review -> approve -> publish) =========
    const moneyINR = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN',
      { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    function statusChip(s, flagged) {
      if (flagged) return '<span class="chip amber">No salary</span>';
      if (s === 'published') return '<span class="chip green">Published</span>';
      if (s === 'revoked') return '<span class="chip red">Revoked</span>';
      return '<span class="chip muted">Draft</span>';
    }

    async function loadGen() {
      const { y, m } = getYM();
      const wrap = document.getElementById('prGenWrap');
      if (!wrap) return;
      wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:6px 0">Loading payroll run…</div>';
      try {
        const r = await fetch('/api/payroll/run?year=' + y + '&month=' + m, { credentials: 'include' });
        if (!r.ok) { wrap.innerHTML = '<div style="color:var(--red);font-size:13px">Permission denied or failed.</div>'; return; }
        renderGenPanel(await r.json(), y, m);
      } catch (e) {
        console.error('[payroll gen]', e);
        wrap.innerHTML = '<div style="color:var(--red);font-size:13px">Failed to load run.</div>';
      }
    }

    function renderGenPanel(d, y, m) {
      const wrap = document.getElementById('prGenWrap');
      const label = monthName(y, m);
      if (!d.run) {
        wrap.dataset.runId = '';
        wrap.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">' +
            '<div><div style="font-size:15px;font-weight:600">Generate payslips for ' + esc(label) + '</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:3px;max-width:520px">Creates a draft payslip for every active India employee from their salary and attendance. Nothing is published until you review and approve.</div></div>' +
            '<button class="btn pr-run" style="background:var(--green);color:#fff;border-color:var(--green);padding:10px 18px;font-size:14px"><i class="ti ti-player-play"></i> Run payroll</button>' +
          '</div>';
        return;
      }
      const run = d.run;
      const rows = d.rows || [];
      const approved = run.status === 'approved';
      wrap.dataset.runId = run.id;
      const totalNet = rows.filter(r => r.status !== 'revoked').reduce((s, r) => s + Number(r.net_pay || 0), 0);
      const flagged = rows.filter(r => r.flagged).length;

      const head =
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">' +
          '<div><div style="font-size:15px;font-weight:600">Payroll — ' + esc(label) + ' ' +
            (approved ? '<span class="chip green">Approved</span>' : '<span class="chip muted">Draft</span>') + '</div>' +
          '<div style="font-size:12px;color:var(--muted);margin-top:3px">' + rows.length + ' payslips · total net ' + moneyINR(totalNet) +
            (flagged ? ' · <span style="color:var(--amber-deep)">' + flagged + ' with no salary on file</span>' : '') +
            (approved && run.approved_by_name ? ' · approved by ' + esc(run.approved_by_name) : '') + '</div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            (approved ? '' :
              '<button class="btn pr-rerun" style="padding:9px 14px"><i class="ti ti-refresh"></i> Re-generate all</button>' +
              '<button class="btn pr-approve" style="background:var(--green);color:#fff;border-color:var(--green);padding:9px 16px;font-size:14px"><i class="ti ti-check"></i> Approve &amp; publish all</button>') +
          '</div>' +
        '</div>';

      const list = rows.map(r => {
        const lopTxt = Number(r.lop_days) > 0
          ? '<span style="color:var(--red);font-weight:500">' + r.lop_days + '</span>'
          : '<span style="color:var(--muted)">0</span>';
        const lopDates = (Array.isArray(r.lop_dates) && r.lop_dates.length)
          ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">LOP: ' + r.lop_dates.map(esc).join(', ') + '</div>' : '';
        const ovr = r.override_reason
          ? '<div style="font-size:11px;color:var(--amber-deep);margin-top:2px"><i class="ti ti-pencil"></i> Override: ' + esc(r.override_reason) + '</div>' : '';
        const actions = approved
          ? '<button class="btn pr-pview" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-eye"></i> View</button>' +
            (r.status === 'published'
              ? '<button class="btn pr-revoke" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-ban"></i> Revoke</button>'
              : '<button class="btn pr-republish" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-upload"></i> Re-publish</button>')
          : '<button class="btn pr-pview" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-eye"></i> Preview</button>' +
            '<button class="btn pr-override" data-id="' + r.id + '" data-lop="' + r.lop_days + '" data-name="' + esc(r.emp_name) + '" style="padding:8px 12px"><i class="ti ti-pencil"></i> Override</button>' +
            '<button class="btn pr-regen" data-id="' + r.id + '" style="padding:8px 12px"><i class="ti ti-refresh"></i> Re-generate</button>';
        return '<tr style="border-top:0.5px solid var(--line)">' +
          '<td style="padding:10px 12px"><div style="display:flex;align-items:center;gap:8px">' +
            '<span style="width:24px;height:24px;border-radius:50%;background:' + (r.avatar_colour || '#888780') + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;flex:none">' + esc(r.initials || '') + '</span>' +
            '<div>' + esc(r.emp_name) + lopDates + ovr + '</div>' +
          '</div></td>' +
          '<td style="padding:10px 8px;color:var(--muted)">' + esc(r.emp_department || '\u2014') + '</td>' +
          '<td style="padding:10px 8px;text-align:right">' + lopTxt + '</td>' +
          '<td style="padding:10px 8px;text-align:right;font-weight:600">' + moneyINR(r.net_pay) + '</td>' +
          '<td style="padding:10px 8px">' + statusChip(r.status, r.flagged) + '</td>' +
          '<td style="padding:10px 8px"><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">' + actions + '</div></td>' +
        '</tr>';
      }).join('');

      wrap.innerHTML = head +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:680px">' +
          '<thead><tr style="background:var(--bg)">' +
            '<th style="text-align:left;padding:9px 12px;font-weight:500;color:var(--muted)">Employee</th>' +
            '<th style="text-align:left;padding:9px 8px;font-weight:500;color:var(--muted)">Dept</th>' +
            '<th style="text-align:right;padding:9px 8px;font-weight:500;color:var(--muted)">LOP</th>' +
            '<th style="text-align:right;padding:9px 8px;font-weight:500;color:var(--muted)">Net pay</th>' +
            '<th style="text-align:left;padding:9px 8px;font-weight:500;color:var(--muted)">Status</th>' +
            '<th style="padding:9px 8px"></th>' +
          '</tr></thead><tbody>' + list + '</tbody></table></div>';
    }

    // Small modal (reuses the drill overlay) for Override / Revoke reasons.
    function openReasonModal(opts) {
      const wrap = document.getElementById('prDrillWrap');
      wrap.style.display = 'flex';
      const lopField = opts.withLop
        ? '<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 4px">Corrected LOP days</label>' +
          '<input id="prmLop" type="number" min="0" step="0.5" value="' + esc(opts.lop || 0) + '" style="width:100%;padding:9px 12px;border:0.5px solid var(--line);border-radius:8px;font-size:14px">'
        : '';
      wrap.innerHTML =
        '<div class="card" style="max-width:460px;width:100%;padding:18px 20px;background:var(--surface)">' +
          '<div style="font-size:15px;font-weight:600;margin-bottom:4px">' + esc(opts.title) + '</div>' +
          '<div style="font-size:12px;color:var(--muted)">' + esc(opts.sub || '') + '</div>' +
          lopField +
          '<label style="display:block;font-size:12px;color:var(--muted);margin:10px 0 4px">Reason (logged)</label>' +
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
        const body = { reason };
        if (opts.withLop) body.lop_days = Number(document.getElementById('prmLop').value || 0);
        const btn = document.getElementById('prmSave'); btn.disabled = true;
        try {
          const r = await fetch(opts.url, { method: opts.method, credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Failed'); btn.disabled = false; return; }
          wrap.style.display = 'none'; wrap.innerHTML = '';
          await loadGen();
        } catch (e) { console.error(e); alert('Failed'); btn.disabled = false; }
      };
    }

    document.addEventListener('click', async function payrollGenHandler(ev) {
      const t = ev.target.closest && ev.target.closest(
        '.pr-run,.pr-rerun,.pr-approve,.pr-regen,.pr-revoke,.pr-republish,.pr-override,.pr-pview');
      if (!t) return;
      ev.preventDefault();
      const { y, m } = getYM();
      const genWrap = document.getElementById('prGenWrap');
      const runId = genWrap ? genWrap.dataset.runId : '';

      if (t.classList.contains('pr-pview')) {
        window.open('/api/payroll/payslip/' + t.dataset.id + '/html', '_blank', 'noopener');
        return;
      }
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
      if (t.classList.contains('pr-approve')) {
        if (!runId) return;
        if (!confirm('Approve and publish all payslips for this month? Each employee will be notified and the figures will be locked.')) return;
        t.disabled = true;
        try {
          const r = await fetch('/api/payroll/run/' + runId + '/approve', { method: 'POST', credentials: 'include' });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Failed'); t.disabled = false; return; }
          await loadGen();
        } catch (e) { console.error(e); alert('Failed'); t.disabled = false; }
        return;
      }
      if (t.classList.contains('pr-regen')) {
        t.disabled = true;
        try {
          const r = await fetch('/api/payroll/payslip/' + t.dataset.id + '/regenerate', { method: 'POST', credentials: 'include' });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Failed'); t.disabled = false; return; }
          await loadGen();
        } catch (e) { console.error(e); alert('Failed'); t.disabled = false; }
        return;
      }
      if (t.classList.contains('pr-override')) {
        openReasonModal({
          title: 'Override ' + (t.dataset.name || 'payslip'),
          sub: 'Set the corrected unpaid (LOP) days. The payslip is recomputed and the reason is logged.',
          withLop: true, lop: t.dataset.lop, cta: 'Save override',
          url: '/api/payroll/payslip/' + t.dataset.id + '/override', method: 'PUT',
        });
        return;
      }
      if (t.classList.contains('pr-revoke')) {
        openReasonModal({
          title: 'Revoke payslip', sub: 'The employee will no longer see this payslip. You can fix and re-publish.',
          withLop: false, cta: 'Revoke', url: '/api/payroll/payslip/' + t.dataset.id + '/revoke', method: 'POST',
        });
        return;
      }
      if (t.classList.contains('pr-republish')) {
        if (!confirm('Re-publish this payslip? The employee will be notified again.')) return;
        try {
          const r = await fetch('/api/payroll/payslip/' + t.dataset.id + '/publish', { method: 'POST', credentials: 'include' });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Failed'); return; }
          await loadGen();
        } catch (e) { console.error(e); alert('Failed'); }
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
    const wrap = document.getElementById('prDrillWrap');
    if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
  }
};
