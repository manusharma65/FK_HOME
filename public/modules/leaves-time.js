// FK Home — Leaves & time module (r0.30, Ship 3 / Option B)
// ----------------------------------------------------------------------------
// The employee's self-service page: leave balance + history + Request leave,
// attendance (this period), and lateness + Request a correction. Self only —
// no person switcher (you don't file someone else's leave). Managers/HR review
// someone else's record via My Growth (which has the switcher).
//   /api/auth/me, /api/attendance/me/week, /api/attendance/me/lateness,
//   /api/leaves/mine
// Action buttons call the existing global modals openLeaveModal() /
// openRegulariseModal() defined in index.html.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['leaves-time'] = {
  title: 'Leaves & time',

  render() {
    return '' +
      '<div id="lt-mod" class="fk-mod">' +
        '<style>' +
          '#lt-mod .lt-head{margin-bottom:18px}' +
          '#lt-mod .lt-head h2{margin:0 0 2px}' +
          '#lt-mod .lt-sub{font-size:14.5px;color:var(--muted)}' +
          '#lt-mod .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}' +
          '#lt-mod .stat{background:var(--surface);border:0.5px solid var(--line);border-radius:10px;padding:13px 15px}' +
          '#lt-mod .stat .v{font-size:24px;font-weight:600;line-height:1.1}' +
          '#lt-mod .stat .l{font-size:13.5px;color:var(--muted);margin-top:4px}' +
          '#lt-mod .actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}' +
          '#lt-mod .btn-primary,#lt-mod .btn-secondary{padding:11px 20px;font-size:14px;border-radius:8px;cursor:pointer;border:0.5px solid var(--line)}' +
          '#lt-mod .btn-primary{background:var(--ink);color:var(--surface);border-color:var(--ink);font-weight:500}' +
          '#lt-mod .btn-secondary{background:var(--surface);color:var(--ink)}' +
          '#lt-mod .sec-lbl{font-size:13.5px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:0 0 8px}' +
          '#lt-mod .panel{background:var(--surface);border:0.5px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:24px}' +
          '#lt-mod .row{display:flex;justify-content:space-between;align-items:center;padding:12px 15px;border-bottom:0.5px solid var(--line)}' +
          '#lt-mod .row:last-child{border-bottom:none}' +
          '#lt-mod .row .t1{font-size:14px}' +
          '#lt-mod .row .t2{font-size:13.5px;color:var(--muted);margin-top:2px}' +
          '#lt-mod .pill{display:inline-flex;font-size:13.5px;font-weight:500;padding:4px 11px;border-radius:99px;background:#F1EFE8;color:var(--muted)}' +
          '#lt-mod .pill.green{background:#EAF3DE;color:#3B6D11}' +
          '#lt-mod .pill.amber{background:#FAEEDA;color:#9A5B1F}' +
          '#lt-mod .pill.red{background:#FCEBEB;color:#A32D2D}' +
          '#lt-mod .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin:4px 0 10px}' +
          '#lt-mod .cal .d{aspect-ratio:1;border-radius:5px;background:#ECEAE3;cursor:default;position:relative}' +
          '#lt-mod .cal .d.on_time{background:#CDE8D6}' +
          '#lt-mod .cal .d.late{background:#F6DEB0;outline:1px solid #C98A2E}' +
          '#lt-mod .cal .d.no_show{background:#F2C7C7}' +
          '#lt-mod .cal .d.leave{background:#CBDCF0}' +
          '#lt-mod .cal .d.sick{background:#E0D5EC}' +
          '#lt-mod .cal-key{font-size:13.5px;color:var(--soft);margin-bottom:6px}' +
          '#lt-mod .att-counts{display:flex;gap:20px;margin-bottom:12px}' +
          '#lt-mod .att-counts .v{font-size:18px;font-weight:600}' +
          '#lt-mod .att-counts .l{font-size:14.5px;color:var(--muted)}' +
          '#lt-mod .empty{text-align:center;color:var(--muted);padding:18px;font-size:14px}' +
        '</style>' +

        '<div class="lt-head">' +
          '<h2>Leaves &amp; time</h2>' +
          '<div class="lt-sub">Your leave, attendance and corrections \u2014 all in one place.</div>' +
        '</div>' +

        // Leave balance stats
        '<div class="stat-grid">' +
          '<div class="stat"><div class="v" id="ltBalance">\u2014</div><div class="l">Leave balance (days)</div></div>' +
          '<div class="stat"><div class="v" id="ltUsed">\u2014</div><div class="l">Taken this year</div></div>' +
          '<div class="stat"><div class="v" id="ltPending">\u2014</div><div class="l">Pending</div></div>' +
        '</div>' +

        // Actions
        '<div class="actions">' +
          '<button class="btn-primary" id="ltReqLeave"><i class="ti ti-plus" style="vertical-align:-2px"></i> Request leave</button>' +
          '<button class="btn-secondary" id="ltReqCorrection"><i class="ti ti-edit" style="vertical-align:-2px"></i> Request a correction</button>' +
        '</div>' +

        // My leave
        '<p class="sec-lbl">My leave</p>' +
        '<div class="panel" id="ltLeavePanel"><div class="empty">Loading\u2026</div></div>' +

        // My attendance (this period)
        '<p class="sec-lbl">My attendance \u00b7 last 30 days</p>' +
        '<div class="panel" style="padding:14px 15px" id="ltAttPanel">' +
          '<div class="att-counts" id="ltAttCounts"><span class="l">Loading\u2026</span></div>' +
          '<div class="cal" id="ltCal"></div>' +
          '<div class="cal-key">Green on time \u00b7 amber late \u00b7 red unauthorised \u00b7 blue leave \u00b7 purple sick \u00b7 grey off.</div>' +
        '</div>' +

        // Lateness & corrections
        '<p class="sec-lbl">Lateness &amp; corrections</p>' +
        '<div class="panel" id="ltLatePanel"><div class="empty">Loading\u2026</div></div>' +

        // Company holidays (r1.25 — so staff can see the national holidays)
        '<p class="sec-lbl">Company holidays</p>' +
        '<div class="panel" id="ltHolidaysPanel"><div class="empty">Loading\u2026</div></div>' +

      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    let leaveRows = [];
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function fdays(n){ if(n==null) return '\u2014'; const x=Number(n); return Number.isInteger(x)?String(x):x.toFixed(1); }
    function dOnly(v){ if(!v) return '\u2014'; var s=String(v); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[3]+'/'+m[2]+'/'+m[1]; var d=new Date(s); return isNaN(d.getTime())?s:d.toLocaleDateString('en-GB'); }
    function tOnly(v){ if(!v) return '\u2014'; if(typeof v==='string'&&/^\d{2}:\d{2}/.test(v)) return v.slice(0,5); try{return new Date(v).toTimeString().slice(0,5);}catch(e){return '\u2014';} }
    function leavePill(s){ const m={pending:['amber','Pending'],approved:['green','Approved'],denied:['red','Denied'],rejected:['red','Rejected'],cancelled:['muted','Cancelled'],recorded:['muted','Recorded']}; const v=m[s]||['muted',s||'\u2014']; return '<span class="pill '+v[0]+'">'+v[1]+'</span>'; }
    function regPill(s){ const m={pending:['amber','Pending'],approved:['green','Approved'],denied:['red','Denied']}; const v=m[s]||['muted',s||'\u2014']; return '<span class="pill '+v[0]+'">'+v[1]+'</span>'; }

    // Action buttons -> existing global modals in index.html
    $('ltReqLeave').addEventListener('click', () => {
      if (typeof window.openLeaveModal === 'function') window.openLeaveModal();
      else location.hash = '#home';
    });
    $('ltReqCorrection').addEventListener('click', () => {
      if (typeof window.openRegulariseModal === 'function') window.openRegulariseModal();
      else location.hash = '#home';
    });

    async function loadLeaves() {
      const panel = $('ltLeavePanel');
      try {
        const r = await fetch('/api/leaves/mine', { credentials: 'include' });
        if (!r.ok) { panel.innerHTML = '<div class="empty">Cannot load leaves.</div>'; return; }
        const data = await r.json();
        const rows = data.requests || data.leaves || [];
        leaveRows = rows;
        const b = data.balance || {};
        $('ltBalance').textContent = fdays(b.remaining);
        $('ltUsed').textContent = fdays(b.used);
        $('ltPending').textContent = fdays(b.pending);
        if (rows.length === 0) { panel.innerHTML = '<div class="empty">No leave requests this year.</div>'; return; }
        const typeLabels = { annual: 'Annual leave', unpaid: 'Unpaid leave', compassionate: 'Compassionate', sick: 'Sick', other: 'Other' };
        // r1.25 — collapsible: show the 5 most recent, hide the rest behind a toggle
        // so a long leave history doesn't dominate the page.
        const COLLAPSE_AT = 5;
        const perRow = [];
        rows.forEach(l => {
          const typeLabel = (typeLabels[l.request_type] || l.request_type || 'Leave');
          const dys = (l.total_days != null) ? fdays(l.total_days) : '\u2014';
          const halfPart = l.half_day_part === 'am' ? 'morning' : l.half_day_part === 'pm' ? 'afternoon' : l.half_day_part;
          const half = l.is_half_day ? ' (half day' + (halfPart ? ', ' + halfPart : '') + ')' : '';
          const actions = (l.status === 'pending')
            ? '<div style="display:flex;gap:8px;margin-top:10px">' +
                '<button class="btn-secondary" data-edit-leave="' + l.id + '" style="padding:10px 18px;font-size:14px">Edit</button>' +
                '<button class="btn-secondary" data-cancel-leave="' + l.id + '" style="padding:10px 18px;font-size:14px;color:var(--red)">Cancel</button>' +
              '</div>'
            : '';
          perRow.push('<div class="row" style="align-items:flex-start"><div style="flex:1"><div class="t1">' + dOnly(l.start_date) + ' \u2192 ' + dOnly(l.end_date) + '</div>' +
            '<div class="t2">' + esc(typeLabel) + ' \u00b7 ' + dys + (Number(l.total_days) === 1 ? ' day' : ' days') + half +
            (l.reason ? ' \u00b7 ' + esc(l.reason) : '') + '</div>' + actions + '</div>' + leavePill(l.status) + '</div>');
        });
        let html = perRow.slice(0, COLLAPSE_AT).join('');
        if (perRow.length > COLLAPSE_AT) {
          html += '<div id="ltMoreLeaves" style="display:none">' + perRow.slice(COLLAPSE_AT).join('') + '</div>' +
            '<button id="ltLeavesToggle" class="btn-secondary" style="margin-top:10px;padding:9px 16px;font-size:14px">Show all ' + perRow.length + ' \u2192</button>';
        }
        panel.innerHTML = html;
        const tg = $('ltLeavesToggle');
        if (tg) tg.addEventListener('click', () => {
          const more = $('ltMoreLeaves');
          const open = more.style.display !== 'none';
          more.style.display = open ? 'none' : 'block';
          tg.textContent = open ? ('Show all ' + perRow.length + ' \u2192') : 'Show less';
        });
        panel.querySelectorAll('[data-edit-leave]').forEach(btn => btn.addEventListener('click', () => {
          const lv = leaveRows.find(x => String(x.id) === btn.getAttribute('data-edit-leave'));
          if (lv && typeof window.openLeaveModal === 'function') window.openLeaveModal(lv);
        }));
        panel.querySelectorAll('[data-cancel-leave]').forEach(btn => btn.addEventListener('click', async () => {
          if (!confirm('Cancel this leave request?')) return;
          try {
            const cr = await fetch('/api/leaves/' + btn.getAttribute('data-cancel-leave') + '/cancel', { method: 'POST', credentials: 'include' });
            if (!cr.ok) { const d = await cr.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
            loadLeaves();
          } catch (e) { alert('Network error'); }
        }));
      } catch (e) { panel.innerHTML = '<div class="empty">Network error.</div>'; }
    }

    async function loadAttendance() {
      try {
        const r = await fetch('/api/attendance/me/week?days=30', { credentials: 'include' });
        if (!r.ok) { $('ltAttCounts').innerHTML = '<span class="l">Cannot load attendance.</span>'; return; }
        const data = await r.json();
        const rows = (data.days || []).slice().reverse(); // oldest -> newest for the grid
        let onTime = 0, late = 0, noShow = 0, leave = 0;
        const cells = rows.map(d => {
          let cls = 'd';
          if (d.status === 'on_time' || d.status === 'worked_voluntary') { cls += ' on_time'; onTime++; }
          else if (d.status === 'late' || d.status === 'very_late' || (d.late_minutes > 0)) { cls += ' late'; late++; }
          else if (d.status === 'not_yet_in') { cls += ' no_show'; noShow++; }
          else if (d.status === 'on_leave') { cls += ' leave'; leave++; }
          else if (d.status === 'off_sick') { cls += ' sick'; }
          // off_* and pending stay grey
          const title = dOnly(d.for_date) + ' \u00b7 ' + (d.status || 'pending') + (d.late_minutes > 0 ? ' (' + d.late_minutes + 'm late)' : '');
          return '<div class="' + cls + '" title="' + title + '"></div>';
        }).join('');
        $('ltCal').innerHTML = cells || '<div class="empty" style="grid-column:1/-1">No attendance recorded in the last 30 days.</div>';
        $('ltAttCounts').innerHTML =
          (rows.length === 0
            ? '<span class="l">Nothing yet for the last 30 days.</span>'
            : '<div><span class="v" style="color:#3B6D11">' + onTime + '</span> <span class="l">on time</span></div>' +
          '<div><span class="v" style="color:#9A5B1F">' + late + '</span> <span class="l">late</span></div>' +
          (noShow ? '<div><span class="v" style="color:#A32D2D">' + noShow + '</span> <span class="l">unauthorised</span></div>' : '') +
          '<div><span class="v">' + leave + '</span> <span class="l">leave</span></div>');
      } catch (e) { $('ltAttCounts').innerHTML = '<span class="l">Network error.</span>'; }
    }

    async function loadLateness() {
      const panel = $('ltLatePanel');
      try {
        const r = await fetch('/api/attendance/me/lateness?days=30', { credentials: 'include' });
        if (!r.ok) { panel.innerHTML = '<div class="empty">Cannot load lateness.</div>'; return; }
        const data = await r.json();
        const lates = data.lates || [], regs = data.regularisations || [];
        if (lates.length === 0 && regs.length === 0) { panel.innerHTML = '<div class="empty">No late arrivals or corrections in the last 30 days.</div>'; return; }
        let html = '';
        html += lates.map(l =>
          '<div class="row"><div><div class="t1">' + dOnly(l.for_date) + '</div>' +
          '<div class="t2">Logged in ' + tOnly(l.first_login) + ', shift ' + (l.shift_start_local || '\u2014').slice(0,5) + '</div></div>' +
          '<span class="pill amber">' + l.late_minutes + 'm late</span></div>'
        ).join('');
        html += regs.map(rr =>
          '<div class="row"><div><div class="t1">Correction \u00b7 ' + dOnly(rr.for_date) + '</div>' +
          '<div class="t2">' + esc(rr.reason || '\u2014') + '</div></div>' + regPill(rr.status) + '</div>'
        ).join('');
        panel.innerHTML = html;
      } catch (e) { panel.innerHTML = '<div class="empty">Network error.</div>'; }
    }

    async function loadHolidays() {
      const panel = $('ltHolidaysPanel');
      try {
        const r = await fetch('/api/attendance/holidays', { credentials: 'include' });
        if (!r.ok) { panel.innerHTML = '<div class="empty">Cannot load holidays.</div>'; return; }
        const data = await r.json();
        const list = (data.holidays || []).filter(h => h && h.holiday_date)
          .sort((a, b) => String(a.holiday_date).localeCompare(String(b.holiday_date)));
        if (list.length === 0) { panel.innerHTML = '<div class="empty">No company holidays listed yet.</div>'; return; }
        panel.innerHTML = list.map(h =>
          '<div class="row"><div><div class="t1">' + esc(h.name || 'Holiday') + '</div>' +
          '<div class="t2">' + dOnly(h.holiday_date) + (h.office_closed_for_cs ? ' \u00b7 office closed (CS)' : '') + '</div></div></div>'
        ).join('');
      } catch (e) { panel.innerHTML = '<div class="empty">Network error.</div>'; }
    }

    loadLeaves();
    loadAttendance();
    loadLateness();
    loadHolidays();

    // Let the global leave modal refresh this page after an edit/request.
    window.__fkLeavesReload = function () {
      if (!document.body.contains(el)) return;
      try { loadLeaves(); loadAttendance(); loadLateness(); loadHolidays(); } catch (e) {}
    };
  },

  unmount() { window.__fkLeavesReload = null; }
};
