// FK Home — My Growth module (r0.20, Ship D)
// ----------------------------------------------------------------------------
// Faithful migration of my-growth.html. Personal stats: optional person
// switcher (managers/HR can view others), 3 tabs — Attendance (30-day summary
// + table), Leaves (balance tiles + this year), Lateness (+ regularisations).
//   /api/auth/me, /api/team/search, /api/attendance/me/week,
//   /api/attendance/me/lateness, /api/leaves/mine   (all accept ?user_id=)
// All lookups scoped to module root (el).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['my-growth'] = {
  title: 'My Growth',

  render() {
    return '' +
      '<div id="mg-mod" class="fk-mod">' +
        '<style>' +
          '#mg-mod .switcher{display:none;margin-bottom:14px}' +
          '#mg-mod .switcher.on{display:block}' +
          '#mg-mod .switcher select{padding:8px 11px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;background:var(--surface)}' +
          '#mg-mod .tabs{display:flex;gap:6px;border-bottom:0.5px solid var(--line);margin-bottom:18px}' +
          '#mg-mod .tab{padding:8px 14px;color:var(--muted);font-size:14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}' +
          '#mg-mod .tab.on{color:var(--ink);font-weight:500;border-bottom-color:var(--ink)}' +
          '#mg-mod .summary-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px}' +
          '@media (max-width:720px){#mg-mod .summary-grid{grid-template-columns:repeat(3,1fr)}}' +
          '#mg-mod .summary-tile{background:#EAF6F0;border-radius:10px;padding:13px 14px}' +
          '#mg-mod .summary-tile.late{background:#FBF1E0}' +
          '#mg-mod .summary-tile.danger{background:#FBEAEA}' +
          '#mg-mod .summary-tile.green{background:#EAF3DE}' +
          '#mg-mod .summary-tile .v{font-size:24px;font-weight:600;line-height:1;color:var(--ink)}' +
          '#mg-mod .summary-tile .l{font-size:12px;color:var(--muted);margin-top:5px}' +
          '#mg-mod .pill{display:inline-flex;font-size:12px;font-weight:500;padding:3px 10px;border-radius:99px;background:#F1EFE8;color:var(--muted)}' +
          '#mg-mod .pill.green{background:var(--green-soft,#EAF3DE);color:var(--green,#3B6D11)}' +
          '#mg-mod .pill.amber{background:var(--amber-soft,#FAEEDA);color:#9A5B1F}' +
          '#mg-mod .pill.red{background:var(--red-soft,#FCEBEB);color:var(--red,#A32D2D)}' +
          '#mg-mod .pill.muted{background:#F1EFE8;color:var(--muted)}' +
          '#mg-mod .empty{text-align:center;color:var(--muted);padding:22px}' +
        '</style>' +

        '<div class="card">' +
          '<div class="card-head">' +
            '<div><h2 style="margin:0" id="mgTitle">My Growth</h2><span class="meta" id="mgSub">—</span></div>' +
            '<div class="switcher" id="mgSwitcher"><select id="mgUserSelect"></select></div>' +
          '</div>' +

          '<div class="tabs">' +
            '<div class="tab on" id="mgTabAttendance" data-tab="attendance">Attendance</div>' +
            '<div class="tab" id="mgTabLeaves" data-tab="leaves">Leaves</div>' +
            '<div class="tab" id="mgTabLateness" data-tab="lateness">Lateness</div>' +
          '</div>' +

          // Attendance pane
          '<div id="mgPaneAttendance">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px"><span style="font-size:13px;color:var(--muted)">Last 30 days</span><span class="meta" id="mgAttMeta">—</span></div>' +
            '<div class="summary-grid">' +
              '<div class="summary-tile"><div class="v" id="mgSumOnTime">—</div><div class="l">On time</div></div>' +
              '<div class="summary-tile late"><div class="v" id="mgSumLate">—</div><div class="l">Late</div></div>' +
              '<div class="summary-tile danger"><div class="v" id="mgSumNotIn">—</div><div class="l">No-show</div></div>' +
              '<div class="summary-tile"><div class="v" id="mgSumLeave">—</div><div class="l">On leave</div></div>' +
              '<div class="summary-tile"><div class="v" id="mgSumSick">—</div><div class="l">Sick</div></div>' +
              '<div class="summary-tile"><div class="v" id="mgSumOff">—</div><div class="l">Off</div></div>' +
            '</div>' +
            '<table><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Active</th><th>Late</th><th>Weekend pay</th></tr></thead>' +
            '<tbody id="mgAttBody"><tr class="loading-row"><td colspan="7">Loading…</td></tr></tbody></table>' +
          '</div>' +

          // Leaves pane
          '<div id="mgPaneLeaves" style="display:none">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px"><span style="font-size:13px;color:var(--muted)">Leaves this year</span><span class="meta" id="mgLeaveMeta">—</span></div>' +
            '<div class="summary-grid" style="grid-template-columns:repeat(5,1fr)">' +
              '<div class="summary-tile"><div class="v" id="mgLeaveAccrued">—</div><div class="l">Accrued</div></div>' +
              '<div class="summary-tile"><div class="v" id="mgLeaveUsed">—</div><div class="l">Used</div></div>' +
              '<div class="summary-tile late"><div class="v" id="mgLeavePending">—</div><div class="l">Pending</div></div>' +
              '<div class="summary-tile" id="mgLeaveAdjustTile" style="display:none"><div class="v" id="mgLeaveAdjust">—</div><div class="l">Adjustment</div></div>' +
              '<div class="summary-tile green"><div class="v" id="mgLeaveRemaining">—</div><div class="l">Remaining</div></div>' +
            '</div>' +
            '<div id="mgLeaveAdjustNote" style="display:none;padding:8px 0;font-size:12px;color:var(--muted)">Adjustment note: <span id="mgLeaveAdjustNoteText">—</span></div>' +
            '<table><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Reason</th></tr></thead>' +
            '<tbody id="mgLeaveBody"><tr class="loading-row"><td colspan="5">Loading…</td></tr></tbody></table>' +
          '</div>' +

          // Lateness pane
          '<div id="mgPaneLateness" style="display:none">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px"><span style="font-size:13px;color:var(--muted)">Lateness · last 30 days</span><span class="meta" id="mgLateMeta">—</span></div>' +
            '<table><thead><tr><th>Date</th><th>Shift start</th><th>Clocked in</th><th>Late by</th></tr></thead>' +
            '<tbody id="mgLateBody"><tr class="loading-row"><td colspan="4">Loading…</td></tr></tbody></table>' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;margin:18px 0 12px"><span style="font-size:13px;color:var(--muted)">Regularisation requests</span><span class="meta" id="mgRegMeta">—</span></div>' +
            '<table><thead><tr><th>Date</th><th>Reason</th><th>Requested</th><th>Status</th></tr></thead>' +
            '<tbody id="mgRegBody"><tr class="loading-row"><td colspan="4">Loading…</td></tr></tbody></table>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function escapeHtml(s) { if (s == null) return ''; return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
    function formatMins(m) { if (m == null) return '—'; m = Math.floor(m); if (m < 60) return m + 'm'; const h = Math.floor(m / 60), r = m % 60; return r === 0 ? h + 'h' : h + 'h ' + r + 'm'; }
    function formatDays(n) { if (n == null) return '—'; const num = Number(n); return Number.isInteger(num) ? String(num) : num.toFixed(1); }
    function dateOnly(v) { if (!v) return '—'; if (typeof v === 'string') return v.slice(0, 10); try { return new Date(v).toISOString().slice(0, 10); } catch (e) { return String(v); } }
    function timeOnly(v) { if (!v) return '—'; if (typeof v === 'string' && /^\d{2}:\d{2}/.test(v)) return v.slice(0, 5); try { return new Date(v).toTimeString().slice(0, 5); } catch (e) { return '—'; } }
    function statusPill(s) {
      const map = { on_time: ['green', 'On time'], late: ['amber', 'Late'], very_late: ['red', 'Very late'], not_yet_in: ['red', 'No-show'], on_leave: ['muted', 'On leave'], off_sick: ['muted', 'Sick'], off_pattern: ['muted', 'Off (pattern)'], off_cs_rota: ['muted', 'Off (rota)'], off_holiday: ['muted', 'Off (holiday)'], worked_voluntary: ['green', 'Worked extra'], pending: ['muted', '—'] };
      const v = map[s] || ['muted', s || '—']; return '<span class="pill ' + v[0] + '">' + v[1] + '</span>';
    }
    function leavePill(s) { const map = { pending: ['amber', 'Pending'], approved: ['green', 'Approved'], denied: ['red', 'Denied'], rejected: ['red', 'Rejected'], cancelled: ['muted', 'Cancelled'] }; const v = map[s] || ['muted', s || '—']; return '<span class="pill ' + v[0] + '">' + v[1] + '</span>'; }
    function regPill(s) { const map = { pending: ['amber', 'Pending'], approved: ['green', 'Approved'], denied: ['red', 'Denied'] }; const v = map[s] || ['muted', s || '—']; return '<span class="pill ' + v[0] + '">' + v[1] + '</span>'; }

    let me_ = null, viewingUserId = null, viewingName = null;

    async function init() {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        if (!r.ok) return;
        me_ = await r.json();
      } catch (e) { return; }
      viewingUserId = me_.id;
      viewingName = me_.display_name || me_.full_name;
      updateTitle();
      const perms = me_.permissions || [];
      if (perms.includes('attendance.view.any') || perms.includes('attendance.view.dept')) await loadSwitcher();
      reloadAll();
    }

    function updateTitle() {
      const isSelf = viewingUserId === me_.id;
      $('mgTitle').textContent = isSelf ? 'My Growth' : viewingName + "'s growth";
      $('mgSub').textContent = isSelf ? 'Your attendance, leaves and lateness history.' : 'Viewing as ' + (me_.display_name || me_.full_name) + '.';
    }

    async function loadSwitcher() {
      try {
        const r = await fetch('/api/team/search', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        let users = data.people || [];
        const perms = me_.permissions || [];
        if (!perms.includes('attendance.view.any') && perms.includes('attendance.view.dept')) {
          const myDeptSlugs = new Set((me_.departments || []).map(d => d.slug));
          users = users.filter(u => (u.departments || []).some(d => myDeptSlugs.has(d.slug)));
        }
        const sel = $('mgUserSelect');
        const meOpt = '<option value="' + me_.id + '" selected>' + escapeHtml(me_.display_name || me_.full_name) + ' (you)</option>';
        const otherOpts = users.map(u => '<option value="' + u.id + '">' + escapeHtml(u.name) + '</option>').join('');
        sel.innerHTML = meOpt + otherOpts;
        if (users.length > 0 || perms.includes('attendance.view.any')) $('mgSwitcher').classList.add('on');
      } catch (e) {}
    }

    $('mgUserSelect') && el.addEventListener('change', (e) => {
      if (e.target.id !== 'mgUserSelect') return;
      const sel = e.target;
      viewingUserId = parseInt(sel.value, 10);
      viewingName = sel.options[sel.selectedIndex].textContent.replace(' (you)', '');
      updateTitle();
      reloadAll();
    });

    function showTab(id) {
      el.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.getAttribute('data-tab') === id));
      $('mgPaneAttendance').style.display = id === 'attendance' ? '' : 'none';
      $('mgPaneLeaves').style.display = id === 'leaves' ? '' : 'none';
      $('mgPaneLateness').style.display = id === 'lateness' ? '' : 'none';
    }
    el.querySelector('.tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab'); if (t) showTab(t.getAttribute('data-tab'));
    });

    function reloadAll() { loadAttendance(); loadLeaves(); loadLateness(); }

    async function loadAttendance() {
      const body = $('mgAttBody');
      body.innerHTML = '<tr class="loading-row"><td colspan="7">Loading…</td></tr>';
      try {
        const params = new URLSearchParams({ days: '30' });
        if (viewingUserId !== me_.id) params.set('user_id', viewingUserId);
        const r = await fetch('/api/attendance/me/week?' + params.toString(), { credentials: 'include' });
        if (!r.ok) { body.innerHTML = '<tr><td colspan="7" class="empty">Cannot load attendance.</td></tr>'; return; }
        const data = await r.json();
        const rows = data.days || [];
        $('mgAttMeta').textContent = rows.length + ' days';
        const counts = { on_time: 0, late: 0, not_yet_in: 0, on_leave: 0, off_sick: 0, off: 0 };
        for (const d of rows) { if (counts[d.status] !== undefined) counts[d.status]++; else if (d.status && d.status.startsWith('off_')) counts.off++; }
        $('mgSumOnTime').textContent = counts.on_time; $('mgSumLate').textContent = counts.late; $('mgSumNotIn').textContent = counts.not_yet_in;
        $('mgSumLeave').textContent = counts.on_leave; $('mgSumSick').textContent = counts.off_sick; $('mgSumOff').textContent = counts.off;
        if (rows.length === 0) { body.innerHTML = '<tr><td colspan="7" class="empty">No attendance records yet.</td></tr>'; return; }
        body.innerHTML = rows.map(d => {
          const ds = String(d.for_date).slice(0, 10);
          const dow = new Date(ds + 'T12:00:00').getDay();
          const isWeekend = dow === 0 || dow === 6;
          let payCell = '<span style="color:var(--soft)">—</span>';
          if (isWeekend) {
            if (d.weekend_pay_status === 'paid') payCell = '<span class="pill green">Paid</span>';
            else if (d.weekend_pay_status === 'unpaid') payCell = '<span class="pill red">Unpaid</span>';
            else payCell = '<span class="pill muted">Pending</span>';
          } else if (d.status === 'off_sick') {
            const h = d.sick_notified_hours;
            if (h != null && h < 4) payCell = '<span class="pill red">Unpaid</span>';
            else if (h != null) payCell = '<span class="pill green">Paid</span>';
          }
          return '<tr><td>' + dateOnly(d.for_date) + '</td><td>' + statusPill(d.status) + '</td><td>' + timeOnly(d.first_login) + '</td><td>' + timeOnly(d.last_logout) + '</td><td>' + formatMins(d.active_minutes) + '</td><td>' + (d.late_minutes > 0 ? d.late_minutes + 'm' : '—') + '</td><td>' + payCell + '</td></tr>';
        }).join('');
      } catch (e) { body.innerHTML = '<tr><td colspan="7" class="empty">Network error.</td></tr>'; }
    }

    async function loadLeaves() {
      const body = $('mgLeaveBody');
      body.innerHTML = '<tr class="loading-row"><td colspan="5">Loading…</td></tr>';
      try {
        const url = (viewingUserId !== me_.id) ? ('/api/leaves/mine?user_id=' + viewingUserId) : '/api/leaves/mine';
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) { body.innerHTML = '<tr><td colspan="5" class="empty">Cannot load leaves.</td></tr>'; return; }
        const data = await r.json();
        const rows = data.requests || data.leaves || [];
        const balance = data.balance || {};
        $('mgLeaveAccrued').textContent = formatDays((balance.annual || 0) + (balance.carryover || 0));
        $('mgLeaveRemaining').textContent = formatDays(balance.remaining);
        $('mgLeaveUsed').textContent = formatDays(balance.used);
        $('mgLeavePending').textContent = formatDays(balance.pending);
        const adj = Number(balance.adjustment || 0);
        if (adj !== 0) {
          $('mgLeaveAdjustTile').style.display = '';
          const sign = adj > 0 ? '+' : '', colour = adj > 0 ? 'var(--green)' : 'var(--red)';
          $('mgLeaveAdjust').innerHTML = '<span style="color:' + colour + '">' + sign + formatDays(adj) + '</span>';
          if (balance.adjustment_note) { $('mgLeaveAdjustNote').style.display = ''; $('mgLeaveAdjustNoteText').textContent = balance.adjustment_note; }
        }
        $('mgLeaveMeta').textContent = rows.length + (rows.length === 1 ? ' request' : ' requests');
        if (rows.length === 0) { body.innerHTML = '<tr><td colspan="5" class="empty">No leave requests this year.</td></tr>'; return; }
        body.innerHTML = rows.map(l =>
          '<tr><td>' + (l.leave_type || l.type || '—') + '</td><td>' + dateOnly(l.start_date) + ' → ' + dateOnly(l.end_date) + '</td><td>' + (l.days || '—') + '</td><td>' + leavePill(l.status) + '</td><td style="color:var(--muted)">' + (escapeHtml(l.reason) || '—') + '</td></tr>'
        ).join('');
      } catch (e) { body.innerHTML = '<tr><td colspan="5" class="empty">Network error.</td></tr>'; }
    }

    async function loadLateness() {
      const lateBody = $('mgLateBody'), regBody = $('mgRegBody');
      lateBody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading…</td></tr>';
      regBody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading…</td></tr>';
      try {
        const params = new URLSearchParams({ days: '30' });
        if (viewingUserId !== me_.id) params.set('user_id', viewingUserId);
        const r = await fetch('/api/attendance/me/lateness?' + params.toString(), { credentials: 'include' });
        if (!r.ok) { lateBody.innerHTML = '<tr><td colspan="4" class="empty">Cannot load lateness.</td></tr>'; regBody.innerHTML = '<tr><td colspan="4" class="empty">Cannot load.</td></tr>'; return; }
        const data = await r.json();
        const lates = data.lates || [], regs = data.regularisations || [];
        $('mgLateMeta').textContent = lates.length + ' late arrivals';
        $('mgRegMeta').textContent = regs.length + ' requests';
        lateBody.innerHTML = lates.length === 0
          ? '<tr><td colspan="4" class="empty">No late arrivals in the last 30 days.</td></tr>'
          : lates.map(l => '<tr><td>' + dateOnly(l.for_date) + '</td><td>' + (l.shift_start_local || '—').slice(0, 5) + '</td><td>' + timeOnly(l.first_login) + '</td><td><span class="pill amber">' + l.late_minutes + 'm</span></td></tr>').join('');
        regBody.innerHTML = regs.length === 0
          ? '<tr><td colspan="4" class="empty">No regularisation requests.</td></tr>'
          : regs.map(rr => '<tr><td>' + dateOnly(rr.for_date) + '</td><td>' + escapeHtml(rr.reason || '—') + '</td><td style="font-size:14px;color:var(--muted)">' + ((rr.requested_first_login ? 'In: ' + (rr.requested_first_login || '').slice(0, 5) : '') + (rr.requested_first_login && rr.requested_last_logout ? ' · ' : '') + (rr.requested_last_logout ? 'Out: ' + (rr.requested_last_logout || '').slice(0, 5) : '') + (!rr.requested_first_login && !rr.requested_last_logout ? '—' : '')) + '</td><td>' + regPill(rr.status) + '</td></tr>').join('');
      } catch (e) { lateBody.innerHTML = '<tr><td colspan="4" class="empty">Network error.</td></tr>'; }
    }

    await init();
  }
};
