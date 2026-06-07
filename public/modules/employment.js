// FK Home — Employment module (r0.18, Ship B)
// ----------------------------------------------------------------------------
// Migrates admin.html#employment into the shell, REDESIGNED per approved mock:
// calm readable list on the left + focused per-person edit drawer on the right
// (instead of the wide inline grid). Same endpoints/behaviour:
//   GET  /api/admin/users                       (active filter)
//   POST /api/admin/users/bulk-employment       { updates: [ {id, ...fields} ] }
//   POST /api/admin/leaves/recompute            { user_id } | { all:true }
//   POST /api/admin/leaves/adjust               { user_id, delta, note }
//
// The drawer Save sends a single-row bulk-employment update (deliberate, one
// person at a time — see Ship B discussion). Balance isn't returned by the
// users list endpoint (admin.html showed N/A); we show "—" and rely on the
// Adjust/Recompute actions for accurate numbers, same as before.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/employment'] = {
  title: 'Employment',

  render() {
    return '' +
      '<div id="emp-mod" class="fk-mod">' +
        '<style>' +
          '#emp-mod .emp-grid{display:grid;grid-template-columns:1fr 340px;gap:16px;align-items:start}' +
          '@media (max-width:820px){#emp-mod .emp-grid{grid-template-columns:1fr}}' +
          '#emp-mod .avatar{width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:13.5px;font-weight:500;color:#3a3a36;flex-shrink:0}' +
          '#emp-mod tbody tr{cursor:pointer}' +
          '#emp-mod tbody tr.sel td{background:#FBF6EC}' +
          '#emp-mod .status-pill{display:inline-flex;font-size:13.5px;font-weight:500;padding:3px 10px;border-radius:99px;background:#F1EFE8;color:var(--muted);text-transform:capitalize}' +
          '#emp-mod .status-pill.active{background:var(--green-soft);color:var(--green)}' +
          '#emp-mod .status-pill.probation{background:var(--amber-soft);color:var(--amber-deep)}' +
          '#emp-mod .drawer .row2{display:grid;grid-template-columns:1fr 90px;gap:10px}' +
          '#emp-mod .drawer label{font-size:14.5px;color:var(--muted);display:block;margin-bottom:5px}' +
          '#emp-mod .drawer input,#emp-mod .drawer select{width:100%;padding:9px 11px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;margin-bottom:14px;background:var(--surface)}' +
          '#emp-mod .drawer-empty{color:var(--muted);font-size:14px;text-align:center;padding:40px 10px}' +
          '#emp-mod .modal-err{display:none;color:var(--red);font-size:14px;margin:6px 0}' +
          '#emp-mod .modal-err.on{display:block}' +
        '</style>' +

        '<div class="emp-grid">' +
          '<div class="card">' +
            '<div class="card-head">' +
              '<div>' +
                '<h2 style="margin:0">Employment records</h2>' +
                '<span class="meta" id="empMeta">Click a person to edit. Joined date drives leave accrual.</span>' +
              '</div>' +
              '<button class="btn" id="empRecomputeAll">Recompute all</button>' +
            '</div>' +
            '<table>' +
              '<thead><tr><th>Name</th><th>Joined</th><th>Type</th><th>Status</th><th style="text-align:right">Balance</th></tr></thead>' +
              '<tbody id="empBody"><tr class="loading-row"><td colspan="5">Loading…</td></tr></tbody>' +
            '</table>' +
          '</div>' +

          '<div class="card drawer" id="empDrawer">' +
            '<div class="drawer-empty" id="empDrawerEmpty">Select a person on the left to edit their employment record.</div>' +
            '<div id="empDrawerBody" style="display:none"></div>' +
          '</div>' +
        '</div>' +

        // ----- Adjust balance modal -----
        '<div class="modal-bg" id="adjModal">' +
          '<div class="modal">' +
            '<h2 id="adjTitle">Adjust leave balance</h2>' +
            '<p class="modal-sub">Positive adds days, negative subtracts. Shown transparently on the user\'s Time off card.</p>' +
            '<div class="modal-err" id="adjErr"></div>' +
            '<form id="adjForm">' +
              '<input type="hidden" id="adjUserId" />' +
              '<label>Delta (days)</label><input type="number" step="0.5" id="adjDelta" placeholder="e.g. +5 or -2" required />' +
              '<label>Note (required)</label><input type="text" id="adjNote" placeholder="e.g. Carryover from pre-FK-Home era" required />' +
              '<div class="modal-actions">' +
                '<button type="button" class="btn" id="adjCancel">Cancel</button>' +
                '<button type="submit" class="btn btn-primary">Apply adjustment</button>' +
              '</div>' +
            '</form>' +
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
    function dateOnly(v) { return v ? String(v).slice(0, 10) : ''; }
    function fmtDate(v) {
      if (!v) return '—';
      try { return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
      catch (e) { return String(v).slice(0, 10); }
    }
    function typeLabel(t) {
      return t === 'part_time' ? 'Part-time' : t === 'contractor' ? 'Contractor' : 'Full-time';
    }

    let users_ = [];
    let selectedId_ = null;

    async function load() {
      const tbody = $('empBody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Loading…</td></tr>';
      try {
        const r = await fetch('/api/admin/users', { credentials: 'include' });
        if (!r.ok) throw new Error('users fetch failed');
        const u = await r.json();
        users_ = (u.users || [])
          .filter(x => x.employment_status === 'active')
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        $('empMeta').textContent = users_.length + ' active employees · click to edit';
        if (users_.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--muted)">No active employees.</td></tr>';
          return;
        }
        renderRows();
        if (selectedId_) { const stillThere = users_.find(x => x.id === selectedId_); if (stillThere) openDrawer(selectedId_); }
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--red)">Failed to load.</td></tr>';
      }
    }

    function statusOf(u) {
      // Show "probation" if a probation end date is in the future, else active.
      if (u.probation_end_date) {
        const end = new Date(u.probation_end_date);
        if (!isNaN(end) && end >= new Date()) return 'probation';
      }
      return 'active';
    }

    function renderRows() {
      $('empBody').innerHTML = users_.map(u => {
        const st = statusOf(u);
        return '<tr data-uid="' + u.id + '"' + (u.id === selectedId_ ? ' class="sel"' : '') + '>' +
          '<td><div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="background:' + (u.avatar_colour || '#F1EFE8') + '">' + escapeHtml(u.initials || '—') + '</span><span style="font-weight:500">' + escapeHtml(u.full_name) + '</span></div></td>' +
          '<td style="color:var(--muted)">' + fmtDate(u.hire_date) + '</td>' +
          '<td style="color:var(--muted)">' + typeLabel(u.employment_type) + '</td>' +
          '<td><span class="status-pill ' + st + '">' + st + '</span></td>' +
          '<td style="text-align:right;color:var(--muted)">—</td>' +
        '</tr>';
      }).join('');
    }

    function openDrawer(id) {
      const u = users_.find(x => x.id === id);
      if (!u) return;
      selectedId_ = id;
      renderRows();
      $('empDrawerEmpty').style.display = 'none';
      const body = $('empDrawerBody');
      body.style.display = '';
      body.innerHTML = '' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
            '<span class="avatar" style="background:' + (u.avatar_colour || '#F1EFE8') + '">' + escapeHtml(u.initials || '—') + '</span>' +
            '<div style="font-size:16px;font-weight:500">' + escapeHtml(u.full_name) + '</div>' +
          '</div>' +
          '<button class="btn" id="dClose" aria-label="Close" style="padding:6px 9px;font-size:14px;line-height:1"><i class="ti ti-x"></i></button>' +
        '</div>' +
        '<div style="font-size:14.5px;color:var(--muted);margin:0 0 18px 40px">' + escapeHtml(u.email || '') + '</div>' +

        '<label>Joined date</label>' +
        '<input type="date" id="dHire" value="' + dateOnly(u.hire_date) + '" />' +

        '<div class="row2">' +
          '<div><label>Monthly salary</label><input type="number" step="0.01" id="dSalary" value="' + (u.monthly_salary != null ? u.monthly_salary : '') + '" placeholder="0.00" /></div>' +
          '<div><label>Currency</label><select id="dCurrency">' +
            '<option value="INR"' + ((u.salary_currency || 'INR') === 'INR' ? ' selected' : '') + '>INR</option>' +
            '<option value="GBP"' + (u.salary_currency === 'GBP' ? ' selected' : '') + '>GBP</option>' +
          '</select></div>' +
        '</div>' +

        '<label>Employment type</label>' +
        '<select id="dType">' +
          '<option value="full_time"' + ((u.employment_type || 'full_time') === 'full_time' ? ' selected' : '') + '>Full-time</option>' +
          '<option value="part_time"' + (u.employment_type === 'part_time' ? ' selected' : '') + '>Part-time</option>' +
          '<option value="contractor"' + (u.employment_type === 'contractor' ? ' selected' : '') + '>Contractor</option>' +
        '</select>' +

        '<label>Work pattern</label>' +
        '<select id="dPattern">' +
          '<option value="alternating"' + ((u.work_pattern || 'alternating') === 'alternating' ? ' selected' : '') + '>Alternating 5/6</option>' +
          '<option value="cs_rota"' + (u.work_pattern === 'cs_rota' ? ' selected' : '') + '>CS rota</option>' +
        '</select>' +

        '<div class="row2">' +
          '<div><label>Probation ends</label><input type="date" id="dProb" value="' + dateOnly(u.probation_end_date) + '" /></div>' +
          '<div><label>Notice (d)</label><input type="number" id="dNotice" value="' + (u.notice_period_days != null ? u.notice_period_days : 30) + '" /></div>' +
        '</div>' +

        '<label>Emergency contact</label>' +
        '<input type="text" id="dEmergency" value="' + escapeHtml(u.emergency_contact || '') + '" placeholder="Name + phone" />' +

        '<div style="border-top:0.5px solid var(--line);padding-top:14px;margin-top:4px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<div style="display:flex;gap:8px">' +
            '<button class="btn" id="dAdjust" style="font-size:14.5px;padding:7px 11px">Adjust balance</button>' +
            '<button class="btn" id="dRecompute" style="font-size:14.5px;padding:7px 11px">Recompute</button>' +
          '</div>' +
          '<button class="btn btn-primary" id="dSave">Save</button>' +
        '</div>' +
        '<div class="modal-err" id="dErr" style="margin-top:10px"></div>';

      body.querySelector('#dSave').addEventListener('click', () => saveOne(id));
      body.querySelector('#dAdjust').addEventListener('click', () => openAdjust(id, u.full_name));
      body.querySelector('#dRecompute').addEventListener('click', () => recomputeOne(id, u.full_name));
      body.querySelector('#dClose').addEventListener('click', closeDrawer);
    }

    function closeDrawer() {
      selectedId_ = null;
      const body = $('empDrawerBody');
      body.style.display = 'none';
      body.innerHTML = '';
      $('empDrawerEmpty').style.display = '';
      renderRows();
    }

    async function saveOne(id) {
      const body = $('empDrawerBody');
      const err = body.querySelector('#dErr');
      err.classList.remove('on');
      const update = {
        id: id,
        hire_date: body.querySelector('#dHire').value || null,
        monthly_salary: body.querySelector('#dSalary').value !== '' ? parseFloat(body.querySelector('#dSalary').value) : null,
        salary_currency: body.querySelector('#dCurrency').value,
        employment_type: body.querySelector('#dType').value,
        work_pattern: body.querySelector('#dPattern').value,
        probation_end_date: body.querySelector('#dProb').value || null,
        notice_period_days: body.querySelector('#dNotice').value !== '' ? parseInt(body.querySelector('#dNotice').value, 10) : null,
        emergency_contact: body.querySelector('#dEmergency').value.trim() || null
      };
      const btn = body.querySelector('#dSave');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const r = await fetch('/api/admin/users/bulk-employment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ updates: [update] })
        });
        const data = await r.json();
        if (!r.ok) { err.textContent = data.error || 'Save failed'; err.classList.add('on'); btn.disabled = false; btn.textContent = 'Save'; return; }
        if (data.errors && data.errors.length) { err.textContent = 'Saved with ' + data.errors.length + ' error(s).'; err.classList.add('on'); }
        btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1200);
        await load();
      } catch (e) {
        err.textContent = 'Network error'; err.classList.add('on'); btn.disabled = false; btn.textContent = 'Save';
      }
    }

    async function recomputeOne(id, name) {
      if (!confirm('Recompute ' + name + '\'s leave balance from joined date? Existing taken/pending will be re-summed from approved requests this year.')) return;
      try {
        const r = await fetch('/api/admin/leaves/recompute', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ user_id: id })
        });
        const data = await r.json();
        if (!r.ok) return alert(data.error || 'Failed');
        alert('Done. ' + name + ' now has ' + (data.accrued_days || 0) + ' days accrued (' + (data.tenure_months || 0) + ' months tenure).');
      } catch (e) { alert('Network error'); }
    }

    async function recomputeAll() {
      if (!confirm('Recompute leave balances for ALL active employees from their joined dates?\n\nThis wipes accrued days and rebuilds them based on tenure. Existing approved leaves remain counted as taken. Manual adjustments are preserved.\n\nProceed?')) return;
      const btn = $('empRecomputeAll');
      btn.disabled = true; btn.textContent = 'Recomputing…';
      try {
        const r = await fetch('/api/admin/leaves/recompute', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ all: true })
        });
        const data = await r.json();
        if (!r.ok) { alert(data.error || 'Failed'); } else { alert('Recomputed ' + data.count + ' user(s).'); }
      } catch (e) { alert('Network error'); }
      finally { btn.disabled = false; btn.textContent = 'Recompute all'; }
    }

    // ----- Adjust modal -----
    function openAdjust(id, name) {
      $('adjUserId').value = id;
      $('adjTitle').textContent = 'Adjust leave balance: ' + name;
      $('adjDelta').value = ''; $('adjNote').value = '';
      $('adjErr').classList.remove('on');
      $('adjModal').classList.add('on');
    }
    $('adjCancel').addEventListener('click', () => $('adjModal').classList.remove('on'));
    $('adjForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const uid = parseInt($('adjUserId').value, 10);
      const delta = parseFloat($('adjDelta').value);
      const note = $('adjNote').value.trim();
      const err = $('adjErr');
      err.classList.remove('on');
      if (!Number.isFinite(delta)) { err.textContent = 'Enter a number (positive to add, negative to subtract).'; err.classList.add('on'); return; }
      if (!note || note.length < 3) { err.textContent = 'Add a note so this adjustment is auditable.'; err.classList.add('on'); return; }
      try {
        const r = await fetch('/api/admin/leaves/adjust', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ user_id: uid, delta, note })
        });
        const data = await r.json();
        if (!r.ok) { err.textContent = data.error || 'Save failed'; err.classList.add('on'); return; }
        $('adjModal').classList.remove('on');
        alert('Adjustment saved.');
      } catch (e2) { err.textContent = 'Network error'; err.classList.add('on'); }
    });

    // ----- Wire -----
    $('empRecomputeAll').addEventListener('click', recomputeAll);
    $('empBody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-uid]');
      if (tr) openDrawer(parseInt(tr.getAttribute('data-uid'), 10));
    });

    await load();
  }
};
