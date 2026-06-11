// FK Home — Regularisations module (r0.19, Ship C)
// ----------------------------------------------------------------------------
// Migrates admin.html#regularisation into the shell. Attendance-correction queue.
//   GET  /api/attendance/regularise/pending
//   POST /api/attendance/regularise/:id/decide   { decision: 'approve'|'deny' }
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/regularisations'] = {
  title: 'Regularisations',

  render() {
    return '' +
      '<div id="reg-mod" class="fk-mod">' +
        '<div class="card">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Pending attendance corrections</h2>' +
              '<span class="meta">Someone forgot to clock in/out and asked to fix it.</span>' +
            '</div>' +
            '<span class="meta" id="regMeta">—</span>' +
          '</div>' +
          '<table class="fk-stack">' +
            '<thead><tr><th>Who</th><th>Date</th><th>Reason</th><th>Times</th><th></th></tr></thead>' +
            '<tbody id="regBody"><tr class="loading-row"><td colspan="5">Loading…</td></tr></tbody>' +
          '</table>' +
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
    function dateOnly(v) { if(!v) return ''; var s=String(v); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[3]+'/'+m[2]+'/'+m[1]; var d=new Date(s); return isNaN(d.getTime())?s:d.toLocaleDateString('en-GB'); }
    function fmtTime(t) {
      if (!t) return '—';
      if (typeof t === 'string' && /^\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
      return '—';
    }

    async function load() {
      const tbody = $('regBody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Loading…</td></tr>';
      try {
        const r = await fetch('/api/attendance/regularise/pending', { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const data = await r.json();
        const rows = data.requests || [];
        $('regMeta').textContent = rows.length + ' pending';
        if (rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:22px">All clear — no pending corrections.</td></tr>';
          return;
        }
        tbody.innerHTML = rows.map(row => {
          const times = (row.requested_first_login ? 'In: ' + fmtTime(row.requested_first_login) : '') +
            (row.requested_first_login && row.requested_last_logout ? ' · ' : '') +
            (row.requested_last_logout ? 'Out: ' + fmtTime(row.requested_last_logout) : '') || '—';
          return '<tr>' +
            '<td class="cell-head"><span class="nm">' + escapeHtml(row.full_name) + '</span></td>' +
            '<td data-label="Date">' + dateOnly(row.for_date) + '</td>' +
            '<td class="cell-block" data-label="Reason" style="color:var(--muted)">' + escapeHtml(row.reason) + '</td>' +
            '<td data-label="Times" style="font-size:14px;color:var(--muted)">' + times + '</td>' +
            '<td class="action-col">' +
              '<button class="btn btn-primary" data-decide="' + row.id + '" data-action="approve">Approve</button> ' +
              '<button class="btn btn-danger" data-decide="' + row.id + '" data-action="deny">Deny</button>' +
            '</td>' +
          '</tr>';
        }).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--red);padding:22px">Failed to load.</td></tr>';
      }
    }

    async function decide(id, decision) {
      try {
        const r = await fetch('/api/attendance/regularise/' + id + '/decide', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ decision })
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Action failed'); return; }
        load();
      } catch (e) { alert('Network error'); }
    }

    $('regBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-decide]');
      if (b) decide(parseInt(b.getAttribute('data-decide'), 10), b.getAttribute('data-action'));
    });

    await load();
  }
};
