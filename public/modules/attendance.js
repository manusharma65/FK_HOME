// FK Home — Team Attendance module (r0.19, Ship C) — NET-NEW
// ----------------------------------------------------------------------------
// Manager view: pick an employee on the left → see their month attendance
// calendar on the right. Reuses the same per-user endpoint the profile
// Attendance drawer uses (gated server-side on profile-view permission):
//   GET /api/admin/users                              people list
//   GET /api/profile/:userId/attendance-days?year=&month=
// Calendar rendering mirrors the profile module's attendance drawer.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/attendance'] = {
  title: 'Team attendance',

  render() {
    return '' +
      '<div id="ta-mod" class="fk-mod">' +
        '<style>' +
          '#ta-mod .ta-grid{display:grid;grid-template-columns:260px 1fr;gap:16px;align-items:start}' +
          '@media (max-width:820px){#ta-mod .ta-grid{grid-template-columns:1fr}}' +
          '#ta-mod .ta-people{max-height:560px;overflow:auto}' +
          '#ta-mod .ta-person{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;cursor:pointer}' +
          '#ta-mod .ta-person:hover{background:var(--bg)}' +
          '#ta-mod .ta-person.sel{background:#FBF6EC}' +
          '#ta-mod .avatar{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#3a3a36;flex-shrink:0}' +
          '#ta-mod .ta-empty{color:var(--muted);font-size:14px;text-align:center;padding:50px 10px}' +
          '#ta-mod .att-cal-head{display:flex;align-items:center;justify-content:center;margin-bottom:14px}' +
          '#ta-mod .att-cal-nav{display:inline-flex;align-items:center;gap:8px}' +
          '#ta-mod .att-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px}' +
          '#ta-mod .att-dow div{text-align:center;font-size:11px;color:var(--muted)}' +
          '#ta-mod .att-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}' +
          '#ta-mod .att-cell{min-height:48px;border-radius:6px;padding:5px 6px;background:#FAF7F2;position:relative;font-size:12px;color:var(--muted)}' +
          '#ta-mod .att-cell.att-on{background:var(--green-soft)}' +
          '#ta-mod .att-cell.att-late{background:var(--amber-soft)}' +
          '#ta-mod .att-cell.att-leave{background:#E6F1FB}' +
          '#ta-mod .att-cell.att-sick{background:var(--red-soft)}' +
          '#ta-mod .att-cell.att-holiday{background:#F1EFE8}' +
          '#ta-mod .att-flag{position:absolute;bottom:4px;left:6px;font-size:10px;font-weight:500;color:#5F5E5A}' +
          '#ta-mod .att-legend{display:flex;gap:14px;margin-top:14px;font-size:12px;color:var(--muted);flex-wrap:wrap}' +
          '#ta-mod .att-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:4px}' +
        '</style>' +

        '<div class="ta-grid">' +
          '<div class="card">' +
            '<input type="text" id="taSearch" placeholder="Search…" style="width:100%;padding:8px 11px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;margin-bottom:10px" />' +
            '<div class="ta-people" id="taPeople"><div class="loading-row" style="color:var(--muted);padding:14px;text-align:center">Loading…</div></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="ta-empty" id="taEmpty">Pick an employee to see their attendance.</div>' +
            '<div id="taCalWrap" style="display:none">' +
              '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
                '<span class="avatar" id="taSelAvatar"></span>' +
                '<div style="font-size:16px;font-weight:500" id="taSelName"></div>' +
              '</div>' +
              '<div class="att-cal-head">' +
                '<div class="att-cal-nav">' +
                  '<button class="btn" id="taPrev" style="padding:5px 9px"><i class="ti ti-chevron-left"></i></button>' +
                  '<div id="taMonthLabel" style="font-weight:500;min-width:140px;text-align:center">—</div>' +
                  '<button class="btn" id="taNext" style="padding:5px 9px"><i class="ti ti-chevron-right"></i></button>' +
                '</div>' +
              '</div>' +
              '<div class="att-dow"><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div></div>' +
              '<div class="att-grid" id="taGrid"></div>' +
              '<div class="att-legend">' +
                '<span><i style="background:var(--green-soft)"></i>Worked</span>' +
                '<span><i style="background:var(--amber-soft)"></i>Late</span>' +
                '<span><i style="background:#E6F1FB"></i>Leave</span>' +
                '<span><i style="background:var(--red-soft)"></i>Sick</span>' +
                '<span><i style="background:#F1EFE8"></i>Holiday</span>' +
              '</div>' +
            '</div>' +
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

    let people_ = [];
    let search_ = '';
    let selId_ = null;
    let selUser_ = null;
    const now = new Date();
    let year_ = now.getFullYear();
    let month_ = now.getMonth() + 1; // 1-12

    async function loadPeople() {
      try {
        const r = await fetch('/api/admin/users', { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const data = await r.json();
        people_ = (data.users || [])
          .filter(u => u.employment_status === 'active')
          .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
        renderPeople();
      } catch (e) {
        $('taPeople').innerHTML = '<div style="color:var(--red);padding:14px;text-align:center">Failed to load people.</div>';
      }
    }

    function renderPeople() {
      let rows = people_;
      if (search_) {
        const q = search_.toLowerCase();
        rows = rows.filter(u => (u.full_name || '').toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q));
      }
      if (rows.length === 0) { $('taPeople').innerHTML = '<div style="color:var(--muted);padding:14px;text-align:center;font-size:14px">No match.</div>'; return; }
      $('taPeople').innerHTML = rows.map(u =>
        '<div class="ta-person' + (u.id === selId_ ? ' sel' : '') + '" data-uid="' + u.id + '">' +
          '<span class="avatar" style="background:' + (u.avatar_colour || '#F1EFE8') + '">' + escapeHtml(u.initials || '—') + '</span>' +
          '<div><div style="font-size:14px;font-weight:500;color:var(--ink)">' + escapeHtml(u.display_name || u.full_name) + '</div>' +
          '<div style="font-size:12px;color:var(--muted)">' + escapeHtml((u.departments && u.departments[0] && u.departments[0].name) || '') + '</div></div>' +
        '</div>'
      ).join('');
    }

    function selectPerson(id) {
      selId_ = id;
      selUser_ = people_.find(u => u.id === id);
      renderPeople();
      if (!selUser_) return;
      $('taEmpty').style.display = 'none';
      $('taCalWrap').style.display = '';
      $('taSelAvatar').style.background = selUser_.avatar_colour || '#F1EFE8';
      $('taSelAvatar').textContent = selUser_.initials || '—';
      $('taSelName').textContent = selUser_.display_name || selUser_.full_name;
      loadMonth();
    }

    async function loadMonth() {
      const label = new Date(Date.UTC(year_, month_ - 1, 1))
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const labelEl = $('taMonthLabel'), grid = $('taGrid');
      if (!labelEl || !grid) return;
      labelEl.textContent = label;
      grid.innerHTML = '<div style="grid-column:span 7;color:var(--muted);text-align:center;padding:14px">Loading…</div>';
      try {
        const r = await fetch('/api/profile/' + selId_ + '/attendance-days?year=' + year_ + '&month=' + month_, { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const data = await r.json();
        const days = data.days || [];
        const byDay = {};
        for (const d of days) {
          const dt = String(d.for_date || d.date || '').slice(0, 10);
          if (dt) byDay[Number(dt.slice(8, 10))] = d.status;
        }
        // Build month grid (Mon-first)
        const first = new Date(Date.UTC(year_, month_ - 1, 1));
        const startDow = (first.getUTCDay() + 6) % 7; // Mon=0
        const daysInMonth = new Date(Date.UTC(year_, month_, 0)).getUTCDate();
        let html = '';
        for (let i = 0; i < startDow; i++) html += '<div></div>';
        for (let day = 1; day <= daysInMonth; day++) {
          const status = byDay[day];
          let cls = 'att-cell', flag = '';
          if (status === 'on_time' || status === 'worked_voluntary') { cls += ' att-on'; }
          else if (status === 'late' || status === 'very_late') { cls += ' att-late'; flag = 'L'; }
          else if (status === 'on_leave') { cls += ' att-leave'; flag = 'A.L.'; }
          else if (status === 'off_sick') { cls += ' att-sick'; flag = 'S'; }
          else if (status === 'off_holiday') { cls += ' att-holiday'; flag = 'H'; }
          html += '<div class="' + cls + '">' + day + (flag ? '<div class="att-flag">' + flag + '</div>' : '') + '</div>';
        }
        grid.innerHTML = html;
      } catch (e) {
        grid.innerHTML = '<div style="grid-column:span 7;color:var(--red);text-align:center;padding:14px">Failed to load</div>';
      }
    }

    $('taSearch').addEventListener('input', (e) => { search_ = e.target.value.trim(); renderPeople(); });
    $('taPeople').addEventListener('click', (e) => {
      const p = e.target.closest('[data-uid]');
      if (p) selectPerson(parseInt(p.getAttribute('data-uid'), 10));
    });
    $('taPrev').addEventListener('click', () => { month_--; if (month_ < 1) { month_ = 12; year_--; } loadMonth(); });
    $('taNext').addEventListener('click', () => { month_++; if (month_ > 12) { month_ = 1; year_++; } loadMonth(); });

    await loadPeople();
  }
};
