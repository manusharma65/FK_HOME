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
          '#lt-mod .att-cal{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:14px 16px}' +
          '#lt-mod .att-cal-head{display:flex;align-items:center;justify-content:center;margin-bottom:18px}' +
          '#lt-mod .att-cal-nav{display:inline-flex;align-items:center;gap:14px}' +
          '#lt-mod .att-cal-nav .header-action-btn{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:18px;border:1px solid var(--line);background:var(--surface);cursor:pointer}' +
          '#lt-mod .att-month{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:23px;min-width:190px;text-align:center}' +
          '#lt-mod .att-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}' +
          '#lt-mod .att-cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:10px;text-align:center;text-transform:uppercase;letter-spacing:.04em}' +
          '#lt-mod .att-day{min-height:74px;border-radius:13px;padding:9px 11px;position:relative;display:block}' +
          '#lt-mod .att-day .att-num{font-family:"Fraunces",Georgia,serif;font-size:18px;font-weight:600;line-height:1}' +
          '#lt-mod .att-day .att-flag{position:absolute;bottom:9px;left:11px;font-size:11.5px;font-weight:700;letter-spacing:.02em}' +
          '#lt-mod .att-day.att-empty{background:var(--bg);color:var(--muted)}' +
          '#lt-mod .att-day.att-worked{background:var(--green-soft);color:var(--green)}' +
          '#lt-mod .att-day.att-late{background:var(--amber-soft);color:var(--amber-deep)}' +
          '#lt-mod .att-day.att-wfh{background:rgba(13,148,136,0.12);color:#0F766E}' +
          '#lt-mod .att-day.att-sick{background:var(--red-soft);color:var(--red)}' +
          '#lt-mod .att-day.att-leave{background:rgba(40,90,180,0.10);color:#2D5BAF}' +
          '#lt-mod .att-day.att-holiday{background:var(--bg);color:var(--muted)}' +
          '#lt-mod .att-day.att-future{background:transparent;border:1px dashed var(--line);color:var(--muted)}' +
          '#lt-mod .att-day.att-today{background:linear-gradient(135deg,#F3992E,#E8722B);box-shadow:0 6px 16px rgba(232,114,43,.35)}' +
          '#lt-mod .att-day.att-today .att-num{color:#fff}' +
          '#lt-mod .att-day.att-today .att-flag{color:#fff}' +
          '#lt-mod .att-legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;font-size:12.5px}' +
          '#lt-mod .att-legend span{display:flex;align-items:center;gap:4px}' +
          '#lt-mod .att-legend .swatch{display:inline-block;width:10px;height:10px;border-radius:2px}' +
          '#lt-mod .att-rollup{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}' +
          '#lt-mod .att-tile{background:#FBF6EC;border:1px solid #EFE6D5;border-radius:14px;padding:16px 18px}' +
          '#lt-mod .att-tile .num{font-family:"Fraunces",Georgia,serif;font-size:30px;font-weight:700;line-height:1}' +
          '#lt-mod .att-tile .lbl{font-size:13.5px;color:var(--muted);margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}' +
          '#lt-mod .att-counts{display:flex;gap:20px;margin-bottom:12px}' +
          '#lt-mod .att-counts .v{font-size:18px;font-weight:600}' +
          '#lt-mod .att-counts .l{font-size:14.5px;color:var(--muted)}' +
          '#lt-mod .empty{text-align:center;color:var(--muted);padding:18px;font-size:14px}' +
          // Company-holidays redesign (cards): date block + Fraunces name + weekday + CS chip + countdown.
          '#ltHolidaysModal .modal{max-width:540px}' +
          '#ltHolidaysModal .hpanel{max-height:60vh;overflow:auto;margin:4px 0 2px}' +
          '#ltHolidaysModal .hol{display:flex;align-items:center;gap:14px;padding:11px 8px;position:relative}' +
          '#ltHolidaysModal .hol+.hol{border-top:0.5px solid var(--line)}' +
          '#ltHolidaysModal .hol .date{flex-shrink:0;width:54px;height:58px;border-radius:12px;background:var(--canvas,#F4EFE7);border:0.5px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}' +
          '#ltHolidaysModal .hol .date .d{font-family:var(--disp,"Fraunces"),serif;font-weight:600;font-size:22px;color:var(--ink)}' +
          '#ltHolidaysModal .hol .date .m{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#C2562E;margin-top:3px}' +
          '#ltHolidaysModal .hol .info{flex:1;min-width:0}' +
          '#ltHolidaysModal .hol .nm{font-family:var(--disp,"Fraunces"),serif;font-weight:600;font-size:17px;line-height:1.15}' +
          '#ltHolidaysModal .hol .meta{font-size:12.5px;color:var(--muted);margin-top:3px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}' +
          '#ltHolidaysModal .hol .dow{font-weight:500;color:#6B6358}' +
          '#ltHolidaysModal .hol .cs{font-size:11px;font-weight:600;color:#8A6A3A;background:#F7EBD8;padding:2px 8px;border-radius:99px}' +
          '#ltHolidaysModal .hol .away{flex-shrink:0;text-align:right;min-width:44px}' +
          '#ltHolidaysModal .hol .away .n{font-family:var(--disp,"Fraunces"),serif;font-weight:600;font-size:16px;color:var(--ink)}' +
          '#ltHolidaysModal .hol .away .u{font-size:10.5px;color:var(--muted)}' +
          '#ltHolidaysModal .hol.next{background:linear-gradient(90deg,#FBF1E6,transparent 72%);border-radius:12px}' +
          '#ltHolidaysModal .hol.next .nextchip{position:absolute;top:7px;right:7px;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--orange,#E8722B);padding:3px 9px;border-radius:99px}' +
          '#ltHolidaysModal .hol.past{opacity:.5}' +
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
          '<button class="btn-secondary" id="ltHolidaysBtn"><i class="ti ti-calendar-star" style="vertical-align:-2px"></i> Company holidays</button>' +
        '</div>' +

        // My leave
        '<p class="sec-lbl">My leave</p>' +
        '<div class="panel" id="ltLeavePanel"><div class="empty">Loading\u2026</div></div>' +

        // My attendance (monthly calendar)
        '<p class="sec-lbl">My attendance</p>' +
        '<div class="att-cal" id="ltAttPanel">' +
          '<div class="att-rollup" id="ltAttRollup"></div>' +
          '<div class="att-cal-head">' +
            '<div class="att-cal-nav">' +
              '<button class="header-action-btn" id="ltAttPrev"><i class="ti ti-chevron-left"></i></button>' +
              '<div id="ltAttMonthLabel" class="att-month">\u2014</div>' +
              '<button class="header-action-btn" id="ltAttNext"><i class="ti ti-chevron-right"></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="att-cal-dow"><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div></div>' +
          '<div class="att-cal-grid" id="ltAttGrid"></div>' +
          '<div class="att-legend">' +
            '<span><span class="swatch" style="background:var(--green-soft)"></span>Worked (W)</span>' +
            '<span><span class="swatch" style="background:var(--amber-soft)"></span>Late (L)</span>' +
            '<span><span class="swatch" style="background:var(--red-soft)"></span>Sick (S)</span>' +
            '<span><span class="swatch" style="background:rgba(40,90,180,0.10)"></span>Leave (A.L.)</span>' +
            '<span><span class="swatch" style="background:var(--bg)"></span>Off (H)</span>' +
          '</div>' +
        '</div>' +

        // Company holidays now live in a modal opened by the action button above.

        // Lateness & corrections
        '<p class="sec-lbl">Lateness &amp; corrections</p>' +
        '<div class="panel" id="ltLatePanel"><div class="empty">Loading\u2026</div></div>' +

      '</div>' +
      // Company holidays modal (opened by the "Company holidays" action button)
      '<div class="modal-bg" id="ltHolidaysModal">' +
        '<div class="modal">' +
          '<h2>Company holidays</h2>' +
          '<div class="modal-sub">The days the office is closed this year. CS works through the ones marked.</div>' +
          '<div class="hpanel" id="ltHolidaysPanel"><div class="empty">Loading\u2026</div></div>' +
          '<div class="modal-actions" style="margin-top:14px"><button class="btn-secondary" id="ltHolidaysClose">Close</button></div>' +
        '</div>' +
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
    // Company holidays modal (3rd action, beside Request leave / correction)
    $('ltHolidaysBtn').addEventListener('click', () => {
      $('ltHolidaysModal').classList.add('on');
      loadHolidays();
    });
    $('ltHolidaysClose').addEventListener('click', () => $('ltHolidaysModal').classList.remove('on'));
    $('ltHolidaysModal').addEventListener('click', (e) => { if (e.target.id === 'ltHolidaysModal') $('ltHolidaysModal').classList.remove('on'); });

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

    // Monthly attendance calendar (ported from the profile Attendance drawer).
    // Browses any calendar month via /api/attendance/me/month.
    let attYear = new Date().getFullYear();
    let attMonth = new Date().getMonth() + 1;

    function fmtLtT(ts) {
      if (!ts) return '\u2014';
      try { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
      catch (e) { return '\u2014'; }
    }
    function ltDayMeta(rec) {
      const s = rec ? rec.status : null;
      if (s === 'on_time') return { label: 'On time', color: 'var(--green)' };
      if (s === 'worked_voluntary') return { label: 'Worked (rest day)', color: 'var(--green)' };
      if (s === 'late' || s === 'very_late') return { label: (rec.late_minutes || 0) + ' min late', color: 'var(--amber-deep)' };
      if (s === 'on_leave') return { label: 'Approved leave', color: '#2D6CA8' };
      if (s === 'off_sick') return { label: 'Off sick', color: 'var(--red)' };
      if (s === 'off_holiday') return { label: 'Public holiday', color: '#2D6CA8' };
      if (s === 'no_show') return { label: 'Absent \u2014 no login', color: 'var(--red)' };
      if (s === 'pending') return { label: 'No login recorded', color: 'var(--muted)' };
      if (s && s.indexOf('off_') === 0) return { label: 'Rest day', color: 'var(--muted)' };
      return { label: (s || 'No record'), color: 'var(--muted)' };
    }
    function showLtDayModal(rec, ds) {
      const m = ltDayMeta(rec);
      const worked = rec && ['on_time', 'late', 'very_late', 'worked_voluntary'].indexOf(rec.status) >= 0;
      let ov = document.getElementById('ltAttDayModal');
      if (!ov) { ov = document.createElement('div'); ov.id = 'ltAttDayModal'; document.body.appendChild(ov); }
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,22,27,.5);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px';
      const line = (k, v, last) => '<div style="display:flex;justify-content:space-between;padding:10px 0' + (last ? '' : ';border-bottom:0.5px solid var(--line)') + '"><span style="color:var(--muted)">' + k + '</span><span style="font-weight:600">' + v + '</span></div>';
      const rows =
        '<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:0.5px solid var(--line)"><span style="color:var(--muted)">Status</span><span style="font-weight:600;color:' + m.color + '">' + m.label + '</span></div>' +
        line('Logged in', worked ? fmtLtT(rec.first_login) : '\u2014') +
        line('Logged out', worked ? fmtLtT(rec.last_logout) : '\u2014', !(worked && rec.active_minutes)) +
        (worked && rec.active_minutes ? line('Active time', (Math.round(rec.active_minutes / 60 * 10) / 10) + ' h', true) : '');
      ov.innerHTML =
        '<div style="background:var(--surface);border-radius:14px;max-width:380px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.4);overflow:hidden">' +
          '<div style="padding:15px 18px;border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
            '<div style="font-size:15px;font-weight:700">' + dOnly(ds) + '</div>' +
            '<button id="ltAttModalClose" style="border:0.5px solid var(--line);background:var(--surface);border-radius:8px;width:30px;height:30px;cursor:pointer;color:var(--muted);font-size:15px">\u2715</button>' +
          '</div>' +
          '<div style="padding:4px 18px 16px">' + rows + '</div>' +
        '</div>';
      const close = () => { ov.style.display = 'none'; };
      ov.onclick = (e) => { if (e.target === ov) close(); };
      document.getElementById('ltAttModalClose').onclick = close;
      ov.style.display = 'flex';
    }

    async function loadAttendance() {
      const grid = document.getElementById('ltAttGrid');
      const rollup = document.getElementById('ltAttRollup');
      const labelEl = document.getElementById('ltAttMonthLabel');
      if (!grid || !rollup || !labelEl) return; // scaffold not in DOM
      // Wire month navigation once.
      const prev = document.getElementById('ltAttPrev');
      const next = document.getElementById('ltAttNext');
      if (prev && !prev._wired) { prev._wired = true; prev.addEventListener('click', () => { attMonth--; if (attMonth < 1) { attMonth = 12; attYear--; } loadAttendance(); }); }
      if (next && !next._wired) { next._wired = true; next.addEventListener('click', () => { attMonth++; if (attMonth > 12) { attMonth = 1; attYear++; } loadAttendance(); }); }

      labelEl.textContent = new Date(Date.UTC(attYear, attMonth - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      grid.innerHTML = '<div style="grid-column:span 7;color:var(--muted);text-align:center;padding:14px">Loading\u2026</div>';
      rollup.innerHTML = '';
      try {
        let days = [];
        const r = await fetch('/api/attendance/me/month?year=' + attYear + '&month=' + attMonth, { credentials: 'include' });
        if (r.ok) { const d = await r.json(); days = d.days || []; }

        const first = new Date(Date.UTC(attYear, attMonth - 1, 1));
        const firstDow = first.getUTCDay();
        const leading = firstDow === 0 ? 6 : (firstDow - 1);
        const daysInMonth = new Date(Date.UTC(attYear, attMonth, 0)).getUTCDate();
        const today = new Date();
        const todayIso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

        const byDate = {};
        for (const d of days) { byDate[String(d.for_date).slice(0, 10)] = d; }

        let html = '';
        for (let i = 0; i < leading; i++) html += '<div></div>';
        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = attYear + '-' + String(attMonth).padStart(2, '0') + '-' + String(day).padStart(2, '0');
          const rec = byDate[dateStr];
          const status = rec ? rec.status : null;
          let cls = 'att-day';
          let flag = '';
          if (dateStr > todayIso) { cls += ' att-future'; }
          else if (dateStr === todayIso) { cls += ' att-today'; flag = 'Today'; }
          else if (status === 'on_time' || status === 'worked_voluntary') { cls += ' att-worked'; flag = 'W'; }
          else if (status === 'late' || status === 'very_late') { cls += ' att-late'; flag = 'L'; }
          else if (status === 'on_leave') { cls += ' att-leave'; flag = 'A.L.'; }
          else if (status === 'off_sick') { cls += ' att-sick'; flag = 'S'; }
          else if (status === 'off_holiday') { cls += ' att-holiday'; flag = 'H'; }
          else { cls += ' att-empty'; }
          const clickable = rec && dateStr <= todayIso;
          html += '<div class="' + cls + '"' + (clickable ? ' data-d="' + dateStr + '" style="cursor:pointer"' : '') + '><span class="att-num">' + day + '</span>' +
            (flag ? '<div class="att-flag">' + flag + '</div>' : '') + '</div>';
        }
        grid.innerHTML = html;

        let worked = 0, late = 0, al = 0, sick = 0;
        for (const d of days) {
          if (d.status === 'on_time' || d.status === 'worked_voluntary') worked++;
          if (d.status === 'late' || d.status === 'very_late') { worked++; late++; }
          if (d.status === 'on_leave') al++;
          if (d.status === 'off_sick') sick++;
        }
        rollup.innerHTML =
          '<div class="att-tile"><div class="num" style="color:var(--green)">' + worked + '</div><div class="lbl">Days worked</div></div>' +
          '<div class="att-tile"><div class="num" style="color:var(--amber-deep)">' + late + '</div><div class="lbl">Late</div></div>' +
          '<div class="att-tile"><div class="num" style="color:#2D5BAF">' + al + '</div><div class="lbl">Annual leave</div></div>' +
          '<div class="att-tile"><div class="num" style="color:var(--red)">' + sick + '</div><div class="lbl">Sick</div></div>';

        grid._byDate = byDate;
        if (!grid._wiredClick) {
          grid._wiredClick = true;
          grid.addEventListener('click', (ev) => {
            const cell = ev.target.closest('[data-d]');
            if (!cell) return;
            showLtDayModal(grid._byDate[cell.getAttribute('data-d')], cell.getAttribute('data-d'));
          });
        }
      } catch (e) {
        grid.innerHTML = '<div style="grid-column:span 7;color:var(--red);text-align:center;padding:14px">Failed to load</div>';
      }
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

        const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const parse = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

        let nextDone = false;
        panel.innerHTML = list.map(h => {
          const dt = parse(h.holiday_date); if (!dt) return '';
          const days = Math.round((dt - today) / 86400000);
          const past = days < 0;
          let cls = 'hol' + (past ? ' past' : '');
          let nextChip = '';
          if (!past && !nextDone) { cls += ' next'; nextDone = true; nextChip = '<span class="nextchip">Next up</span>'; }
          const csWorks = !h.office_closed_for_cs; // office_closed_for_cs=false => CS works that day
          const away = (!past && days >= 0 && days <= 31)
            ? '<div class="away"><div class="n">' + (days === 0 ? '\u2014' : days) + '</div><div class="u">' + (days === 0 ? 'today' : 'days') + '</div></div>'
            : '';
          return '<div class="' + cls + '">' + nextChip +
            '<div class="date"><div class="d">' + dt.getDate() + '</div><div class="m">' + MON[dt.getMonth()] + '</div></div>' +
            '<div class="info"><div class="nm">' + esc(h.name || 'Holiday') + '</div>' +
            '<div class="meta"><span class="dow">' + DOW[dt.getDay()] + '</span><span>\u00b7 ' + dt.getFullYear() + '</span>' +
            (csWorks ? '<span class="cs">CS works</span>' : '') + '</div></div>' +
            away + '</div>';
        }).join('');
      } catch (e) { panel.innerHTML = '<div class="empty">Network error.</div>'; }
    }

    loadLeaves();
    loadAttendance();
    loadLateness();

    // Let the global leave modal refresh this page after an edit/request.
    window.__fkLeavesReload = function () {
      if (!document.body.contains(el)) return;
      try { loadLeaves(); loadAttendance(); loadLateness(); } catch (e) {}
    };
  },

  unmount() { window.__fkLeavesReload = null; }
};
