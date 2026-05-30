// FK Home — Holidays module (r0.17, Ship A)
// ----------------------------------------------------------------------------
// Migrates admin.html#holidays into the shell. Same endpoints, same behaviour:
//   GET    /api/attendance/holidays         list
//   POST   /api/attendance/holidays         add
//   DELETE /api/attendance/holidays/:id     delete
//
// admin.html stays on disk (production team still uses it). Both work.
// Lifecycle convention (r0.16.4/.5): every lookup is scoped to the module root
// (el) — never document-wide — so a duplicate id elsewhere in the shell can't
// misbind, and unmount has nothing leaking on document/window.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['system/holidays'] = {
  title: 'Holidays',

  render() {
    return '' +
      '<div id="hol-mod">' +
        '<style>#hol-mod td.action-col{text-align:right;width:1%;white-space:nowrap}</style>' +
        '<div class="card">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Holidays</h2>' +
              '<span class="meta">Company holidays. Office closed except CS, unless marked otherwise.</span>' +
            '</div>' +
            '<button class="btn btn-primary" id="holAddBtn"><i class="ti ti-plus"></i> Add holiday</button>' +
          '</div>' +
          '<table>' +
            '<thead><tr><th>Date</th><th>Name</th><th>CS works?</th><th></th></tr></thead>' +
            '<tbody id="holBody"><tr class="loading-row"><td colspan="4">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>' +

        '<div class="modal-bg" id="holModal">' +
          '<div class="modal">' +
            '<h2>Add holiday</h2>' +
            '<p class="modal-sub">Office closed except CS (unless you tick the box below).</p>' +
            '<div class="modal-err" id="holErr"></div>' +
            '<form id="holForm">' +
              '<label>Date</label>' +
              '<input type="date" id="holDate" required />' +
              '<label>Name</label>' +
              '<input type="text" id="holName" placeholder="Christmas Day" required />' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
                '<input type="checkbox" id="holCsWorks" style="width:auto;margin:0" />' +
                '<span>CS works through this holiday (don\'t mark CS people as off)</span>' +
              '</label>' +
              '<div class="modal-actions">' +
                '<button type="button" class="btn" id="holCancel">Cancel</button>' +
                '<button type="submit" class="btn btn-primary" id="holBtn">Add holiday</button>' +
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
    function dateOnly(v) {
      if (!v) return '';
      if (typeof v === 'string') return v.slice(0, 10);
      try { return new Date(v).toISOString().slice(0, 10); } catch (e) { return String(v); }
    }

    async function load() {
      const tbody = $('holBody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading…</td></tr>';
      try {
        const r = await fetch('/api/attendance/holidays', { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const d = await r.json();
        const rows = d.holidays || [];
        if (rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:22px">No holidays set.</td></tr>';
          return;
        }
        tbody.innerHTML = rows.map(h =>
          '<tr>' +
            '<td>' + dateOnly(h.holiday_date) + '</td>' +
            '<td>' + escapeHtml(h.name) + '</td>' +
            '<td>' + (h.office_closed_for_cs ? '<span class="chip muted">CS off</span>' : '<span class="chip amber">CS works</span>') + '</td>' +
            '<td class="action-col"><button class="btn btn-danger" data-del="' + h.id + '" data-name="' + escapeHtml(h.name) + '">Delete</button></td>' +
          '</tr>'
        ).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--red);padding:22px">Failed to load.</td></tr>';
      }
    }

    function openModal() {
      $('holDate').value = '';
      $('holName').value = '';
      $('holCsWorks').checked = true;
      $('holErr').classList.remove('on');
      $('holModal').classList.add('on');
    }
    function closeModal() { $('holModal').classList.remove('on'); }

    async function del(id, name) {
      if (!confirm('Delete holiday "' + name + '"?')) return;
      try {
        const r = await fetch('/api/attendance/holidays/' + id, { method: 'DELETE', credentials: 'include' });
        if (!r.ok) { alert('Delete failed'); return; }
        load();
      } catch (e) { alert('Network error'); }
    }

    // Wire — all listeners are on el-scoped elements; they die when the loader
    // clears #moduleView, so unmount needs no teardown.
    $('holAddBtn').addEventListener('click', openModal);
    $('holCancel').addEventListener('click', closeModal);
    $('holBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (b) del(b.getAttribute('data-del'), b.getAttribute('data-name'));
    });
    $('holForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        holiday_date: $('holDate').value,
        name: $('holName').value.trim(),
        office_closed_for_cs: !$('holCsWorks').checked
      };
      const err = $('holErr');
      err.classList.remove('on');
      try {
        const r = await fetch('/api/attendance/holidays', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(body)
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          err.textContent = d.error || 'Save failed'; err.classList.add('on'); return;
        }
        closeModal();
        load();
      } catch (e2) { err.textContent = 'Network error'; err.classList.add('on'); }
    });

    await load();
  }
};
