// FK Home — Team Attendance module (r0.19.1, Ship C) — Design A
// ----------------------------------------------------------------------------
// TWO views in one module, sharing month state:
//   SUMMARY  — full-width table: everyone + month-to-date counts (worked/late/
//              leave/sick). Click a row → drill into that person.
//   CALENDAR — big full-width month calendar for one person + large roll-up
//              stat cards. "← Team" returns to summary.
// Data: GET /api/admin/users  +  GET /api/profile/:id/attendance-days?year=&month=
// Summary fetches each active person's month once (cached per month).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/attendance'] = {
  title: 'Team attendance',

  render() {
    return '' +
      '<div id="ta-mod" class="fk-mod">' +
        '<style>' +
          '#ta-mod .avatar{width:34px;height:34px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:14.5px;font-weight:500;color:#3a3a36;flex-shrink:0}' +
          '#ta-mod tbody tr.clickable{cursor:pointer}' +
          '#ta-mod tbody tr.clickable:hover td{background:rgba(20,22,27,0.015)}' +
          '#ta-mod .num{text-align:center;font-size:20px;font-weight:600;line-height:1}' +
          '#ta-mod .num.zero{color:#C9C7BE;font-weight:500}' +
          '#ta-mod .nav-btn{padding:6px 10px;border:0.5px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer}' +
          '#ta-mod .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}' +
          '@media (max-width:640px){#ta-mod .stat-grid{grid-template-columns:repeat(2,1fr)}}' +
          '#ta-mod .stat{border-radius:10px;padding:14px 16px}' +
          '#ta-mod .stat .v{font-size:28px;font-weight:600;line-height:1}' +
          '#ta-mod .stat .l{font-size:14.5px;color:#5F5E5A;margin-top:5px}' +
          '#ta-mod .att-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}' +
          '#ta-mod .att-dow div{text-align:center;font-size:13.5px;color:var(--muted)}' +
          '#ta-mod .att-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}' +
          '#ta-mod .att-cell{min-height:74px;border-radius:8px;padding:8px 9px;background:#FAF7F2;position:relative;font-size:14px;color:#5F5E5A}' +
          '#ta-mod .att-cell.on{background:var(--green-soft)}' +
          '#ta-mod .att-cell.late{background:var(--amber-soft)}' +
          '#ta-mod .att-cell.leave{background:#E6F1FB}' +
          '#ta-mod .att-cell.sick{background:var(--red-soft)}' +
          '#ta-mod .att-cell.holiday{background:#F1EFE8}' +
          '#ta-mod .att-flag{position:absolute;bottom:7px;left:9px;font-size:12.5px;font-weight:600;color:#5F5E5A}' +
          '#ta-mod .att-legend{display:flex;gap:16px;margin-top:16px;font-size:13.5px;color:var(--muted);flex-wrap:wrap}' +
          '#ta-mod .att-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:4px}' +
          '#ta-mod .monthnav{display:flex;align-items:center;gap:10px}' +
        '</style>' +

        // ---- SUMMARY VIEW ----
        '<div id="taSummary" class="card">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Team attendance</h2>' +
              '<span class="meta">Month to date. Click anyone to see their full calendar.</span>' +
            '</div>' +
            '<div class="monthnav">' +
              '<input type="text" id="taSearch" placeholder="Search…" style="padding:7px 11px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;width:140px" />' +
              '<button class="nav-btn" id="taSumPrev"><i class="ti ti-chevron-left"></i></button>' +
              '<span id="taSumMonth" style="font-weight:500;min-width:110px;text-align:center">—</span>' +
              '<button class="nav-btn" id="taSumNext"><i class="ti ti-chevron-right"></i></button>' +
            '</div>' +
          '</div>' +
          '<table>' +
            '<thead><tr>' +
              '<th>Name</th>' +
              '<th style="text-align:center">Worked</th>' +
              '<th style="text-align:center">Late</th>' +
              '<th style="text-align:center">Leave</th>' +
              '<th style="text-align:center">Sick</th>' +
              '<th></th>' +
            '</tr></thead>' +
            '<tbody id="taSumBody"><tr class="loading-row"><td colspan="6">Loading team…</td></tr></tbody>' +
          '</table>' +
        '</div>' +

        // ---- CALENDAR (drill-in) VIEW ----
        '<div id="taCalendar" class="card" style="display:none">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">' +
            '<button class="nav-btn" id="taBack"><i class="ti ti-arrow-left"></i> Team</button>' +
            '<span class="avatar" id="taSelAvatar"></span>' +
            '<div style="font-size:18px;font-weight:500" id="taSelName"></div>' +
          '</div>' +
          '<div class="stat-grid">' +
            '<div class="stat" style="background:#EAF6F0"><div class="v" id="taStatWorked" style="color:#0F6E56">—</div><div class="l">Days worked</div></div>' +
            '<div class="stat" style="background:#FBF1E0"><div class="v" id="taStatLate" style="color:#9A5B1F">—</div><div class="l">Late</div></div>' +
            '<div class="stat" style="background:#E9F1FA"><div class="v" id="taStatLeave" style="color:#2D6CA8">—</div><div class="l">On leave</div></div>' +
            '<div class="stat" style="background:#FBEAEA"><div class="v" id="taStatSick" style="color:#A32D2D">—</div><div class="l">Sick</div></div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:14px">' +
            '<button class="nav-btn" id="taCalPrev"><i class="ti ti-chevron-left"></i></button>' +
            '<span id="taCalMonth" style="font-weight:500;min-width:130px;text-align:center;font-size:15px">—</span>' +
            '<button class="nav-btn" id="taCalNext"><i class="ti ti-chevron-right"></i></button>' +
          '</div>' +
          '<div class="att-dow"><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div></div>' +
          '<div class="att-grid" id="taCalGrid"></div>' +
          '<div class="att-legend">' +
            '<span><i style="background:var(--green-soft)"></i>Worked</span>' +
            '<span><i style="background:var(--amber-soft)"></i>Late</span>' +
            '<span><i style="background:#E6F1FB"></i>Leave</span>' +
            '<span><i style="background:var(--red-soft)"></i>Sick</span>' +
            '<span><i style="background:#F1EFE8"></i>Holiday</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function monthLabel(y, m) {
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    // Classify a day status into one of our four buckets (+ holiday).
    function bucket(status) {
      if (status === 'on_time' || status === 'worked_voluntary') return 'worked';
      if (status === 'late' || status === 'very_late') return 'late';
      if (status === 'on_leave') return 'leave';
      if (status === 'off_sick') return 'sick';
      if (status === 'off_holiday') return 'holiday';
      return null;
    }

    let people_ = [];
    let search_ = '';
    let selId_ = null;
    let selUser_ = null;
    const now = new Date();
    let year_ = now.getFullYear();
    let month_ = now.getMonth() + 1;
    // Cache: key `${userId}:${year}:${month}` → days array
    const dayCache = {};

    async function fetchDays(userId, y, m) {
      const key = userId + ':' + y + ':' + m;
      if (dayCache[key]) return dayCache[key];
      try {
        const r = await fetch('/api/profile/' + userId + '/attendance-days?year=' + y + '&month=' + m, { credentials: 'include' });
        if (!r.ok) { dayCache[key] = []; return []; }
        const data = await r.json();
        dayCache[key] = data.days || [];
        return dayCache[key];
      } catch (e) { dayCache[key] = []; return []; }
    }

    function countDays(days) {
      const c = { worked: 0, late: 0, leave: 0, sick: 0 };
      for (const d of days) {
        const b = bucket(d.status);
        if (b && b !== 'holiday') c[b]++;
      }
      return c;
    }

    // ---------- SUMMARY (see loadSummaryWrapped below) ----------
    function renderSummaryRows(loading, counts) {
      let rows = people_;
      if (search_) {
        const q = search_.toLowerCase();
        rows = rows.filter(u => (u.full_name || '').toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q));
      }
      if (rows.length === 0) {
        $('taSumBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:22px">No match.</td></tr>';
        return;
      }
      const numCell = (v, color) => '<td><div class="num' + (v ? '' : ' zero') + '" style="' + (v ? 'color:' + color : '') + '">' + (loading ? '·' : v) + '</div></td>';
      $('taSumBody').innerHTML = rows.map(u => {
        const c = (counts && counts[u.id]) || { worked: 0, late: 0, leave: 0, sick: 0 };
        const dept = (u.departments && u.departments[0] && u.departments[0].name) || '';
        return '<tr class="clickable" data-uid="' + u.id + '">' +
          '<td><div style="display:flex;align-items:center;gap:11px"><span class="avatar" style="background:' + (u.avatar_colour || '#F1EFE8') + '">' + escapeHtml(u.initials || '—') + '</span>' +
            '<div><div style="font-weight:500;color:var(--ink)">' + escapeHtml(u.display_name || u.full_name) + '</div><div style="font-size:13.5px;color:var(--muted)">' + escapeHtml(dept) + '</div></div></div></td>' +
          numCell(c.worked, '#0F6E56') + numCell(c.late, '#9A5B1F') + numCell(c.leave, '#2D6CA8') + numCell(c.sick, '#A32D2D') +
          '<td style="text-align:right;color:var(--muted);font-size:14.5px;white-space:nowrap">View calendar <i class="ti ti-chevron-right" style="vertical-align:-1px"></i></td>' +
        '</tr>';
      }).join('');
    }

    // ---------- CALENDAR (drill-in) ----------
    function openCalendar(id) {
      selId_ = id;
      selUser_ = people_.find(u => u.id === id);
      if (!selUser_) return;
      $('taSummary').style.display = 'none';
      $('taCalendar').style.display = '';
      $('taSelAvatar').style.background = selUser_.avatar_colour || '#F1EFE8';
      $('taSelAvatar').textContent = selUser_.initials || '—';
      $('taSelName').innerHTML = escapeHtml(selUser_.display_name || selUser_.full_name) +
        ' <span style="color:var(--muted);font-weight:400">· ' + escapeHtml((selUser_.departments && selUser_.departments[0] && selUser_.departments[0].name) || '') + '</span>';
      renderCalendar();
    }

    async function renderCalendar() {
      $('taCalMonth').textContent = monthLabel(year_, month_);
      const grid = $('taCalGrid');
      grid.innerHTML = '<div style="grid-column:span 7;color:var(--muted);text-align:center;padding:20px">Loading…</div>';
      const days = await fetchDays(selId_, year_, month_);
      const byDay = {};
      for (const d of days) {
        const dt = String(d.for_date || '').slice(0, 10);
        if (dt) byDay[Number(dt.slice(8, 10))] = d.status;
      }
      const c = countDays(days);
      $('taStatWorked').textContent = c.worked;
      $('taStatLate').textContent = c.late;
      $('taStatLeave').textContent = c.leave;
      $('taStatSick').textContent = c.sick;

      const first = new Date(Date.UTC(year_, month_ - 1, 1));
      const startDow = (first.getUTCDay() + 6) % 7; // Mon=0
      const daysInMonth = new Date(Date.UTC(year_, month_, 0)).getUTCDate();
      const flags = { late: 'L', leave: 'A.L.', sick: 'S', holiday: 'H' };
      let html = '';
      for (let i = 0; i < startDow; i++) html += '<div></div>';
      for (let day = 1; day <= daysInMonth; day++) {
        const b = bucket(byDay[day]);
        const cls = b ? (b === 'worked' ? 'on' : b) : '';
        const fl = b && flags[b] ? '<div class="att-flag">' + flags[b] + '</div>' : '';
        html += '<div class="att-cell ' + cls + '">' + day + fl + '</div>';
      }
      grid.innerHTML = html;
    }

    // ---------- wiring ----------
    $('taSearch').addEventListener('input', (e) => { search_ = e.target.value.trim(); renderSummaryRows(false, _lastCounts()); });
    let _counts = null;
    function _lastCounts() { return _counts; }

    // Re-fetch wrapper that stashes counts for search re-render
    async function loadSummaryWrapped() {
      $('taSumMonth').textContent = monthLabel(year_, month_);
      const tbody = $('taSumBody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading team…</td></tr>';
      if (people_.length === 0) {
        try {
          const r = await fetch('/api/admin/users', { credentials: 'include' });
          if (!r.ok) throw new Error('load failed');
          const data = await r.json();
          people_ = (data.users || [])
            .filter(u => u.employment_status === 'active')
            .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
        } catch (e) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--red);padding:22px">Failed to load team.</td></tr>';
          return;
        }
      }
      renderSummaryRows(true);
      const counts = {};
      await Promise.all(people_.map(async u => {
        counts[u.id] = countDays(await fetchDays(u.id, year_, month_));
      }));
      _counts = counts;
      renderSummaryRows(false, counts);
    }

    $('taSumBody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-uid]');
      if (tr) openCalendar(parseInt(tr.getAttribute('data-uid'), 10));
    });
    $('taBack').addEventListener('click', () => { $('taCalendar').style.display = 'none'; $('taSummary').style.display = ''; selId_ = null; loadSummaryWrapped(); });

    $('taSumPrev').addEventListener('click', () => { month_--; if (month_ < 1) { month_ = 12; year_--; } loadSummaryWrapped(); });
    $('taSumNext').addEventListener('click', () => { month_++; if (month_ > 12) { month_ = 1; year_++; } loadSummaryWrapped(); });
    $('taCalPrev').addEventListener('click', () => { month_--; if (month_ < 1) { month_ = 12; year_--; } renderCalendar(); });
    $('taCalNext').addEventListener('click', () => { month_++; if (month_ > 12) { month_ = 1; year_++; } renderCalendar(); });

    await loadSummaryWrapped();
  }
};
