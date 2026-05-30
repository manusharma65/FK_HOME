// FK Home — Attendance Policy module (r0.17, Ship A)
// ----------------------------------------------------------------------------
// Migrates admin.html#attpolicy into the shell. Endpoints unchanged:
//   GET /api/attendance/anchor              get pattern anchor Monday
//   PUT /api/attendance/anchor              save anchor { anchor_monday }
//   GET /api/attendance/policy              list per-dept shift policies
//   PUT /api/attendance/policy/:slug        save policy { start_time, end_time, grace_minutes }
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['system/attpolicy'] = {
  title: 'Attendance policy',

  render() {
    return '' +
      '<div id="pol-mod" class="fk-mod">' +
        '<div class="card" style="margin-bottom:16px">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Pattern anchor</h2>' +
              '<span class="meta">Sets the Monday that marks the start of the 6-day-week cycle. Alternates 6 / 5 / 6 / 5 from this date.</span>' +
            '</div>' +
          '</div>' +
          '<div style="padding:18px">' +
            '<form id="anchorForm" style="display:grid;grid-template-columns:1fr auto;gap:12px;max-width:480px;align-items:end">' +
              '<div>' +
                '<label style="font-size:15px;color:var(--muted)">Anchor Monday</label>' +
                '<input type="date" id="anchorDate" style="width:100%;padding:10px 12px;border:0.5px solid var(--line);border-radius:9px" />' +
              '</div>' +
              '<button type="submit" class="btn btn-primary">Save anchor</button>' +
            '</form>' +
            '<p class="modal-sub" style="margin-top:14px" id="anchorMeta">—</p>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Shift policies (per department)</h2>' +
              '<span class="meta">Start/end time, grace, break window.</span>' +
            '</div>' +
          '</div>' +
          '<table>' +
            '<thead><tr><th>Department</th><th>Start</th><th>End</th><th>Grace (m)</th><th></th></tr></thead>' +
            '<tbody id="policyBody"><tr class="loading-row"><td colspan="5">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>' +

        '<div class="modal-bg" id="policyModal">' +
          '<div class="modal">' +
            '<h2 id="polTitle">Edit shift policy</h2>' +
            '<p class="modal-sub" id="polSub">—</p>' +
            '<div class="modal-err" id="polErr"></div>' +
            '<form id="polForm">' +
              '<input type="hidden" id="polSlug" />' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
                '<div><label>Start time</label><input type="time" id="polStart" required /></div>' +
                '<div><label>End time</label><input type="time" id="polEnd" required /></div>' +
              '</div>' +
              '<label>Grace minutes</label>' +
              '<input type="number" id="polGrace" min="0" max="60" required />' +
              '<p class="hint" style="font-size:12px;color:var(--muted);margin:6px 0 0">Break time is set company-wide in Settings → Team break.</p>' +
              '<div class="modal-actions">' +
                '<button type="button" class="btn" id="polCancel">Cancel</button>' +
                '<button type="submit" class="btn btn-primary" id="polBtn">Save policy</button>' +
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
    function formatTime(t) {
      if (!t) return '—';
      if (typeof t === 'string' && /^\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
      return '—';
    }

    async function load() {
      // Anchor
      try {
        const r = await fetch('/api/attendance/anchor', { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          if (d && d.anchor_monday) {
            const v = dateOnly(d.anchor_monday);
            $('anchorDate').value = v;
            $('anchorMeta').textContent = 'Currently set to ' + v + ' (6-day week). Alternates every Monday from here.';
          } else {
            $('anchorMeta').textContent = 'Not yet set.';
          }
        }
      } catch (e) {}

      // Policies
      const tbody = $('policyBody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Loading…</td></tr>';
      try {
        const r = await fetch('/api/attendance/policy', { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const d = await r.json();
        const rows = d.policies || [];
        if (rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:22px">No policies set.</td></tr>';
          return;
        }
        tbody.innerHTML = rows.map(p =>
          '<tr>' +
            '<td>' + escapeHtml(p.department_slug) + '</td>' +
            '<td>' + formatTime(p.start_time) + '</td>' +
            '<td>' + formatTime(p.end_time) + '</td>' +
            '<td>' + (p.grace_minutes != null ? p.grace_minutes : '—') + '</td>' +
            '<td class="action-col"><button class="btn" data-edit="' + escapeHtml(JSON.stringify(p)) + '">Edit</button></td>' +
          '</tr>'
        ).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--red);padding:22px">Failed to load.</td></tr>';
      }
    }

    function openEdit(p) {
      $('polSlug').value = p.department_slug;
      $('polTitle').textContent = 'Edit policy: ' + p.department_slug;
      $('polSub').textContent = 'All times are local (London).';
      $('polStart').value = (p.start_time || '').slice(0, 5);
      $('polEnd').value = (p.end_time || '').slice(0, 5);
      $('polGrace').value = p.grace_minutes != null ? p.grace_minutes : 5;
      $('polErr').classList.remove('on');
      $('policyModal').classList.add('on');
    }
    function closeModal() { $('policyModal').classList.remove('on'); }

    $('policyBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-edit]');
      if (b) { try { openEdit(JSON.parse(b.getAttribute('data-edit'))); } catch (_) {} }
    });
    $('polCancel').addEventListener('click', closeModal);

    $('anchorForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = $('anchorDate').value;
      if (!d) return;
      try {
        const r = await fetch('/api/attendance/anchor', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ anchor_monday: d })
        });
        if (!r.ok) { const data = await r.json().catch(() => ({})); alert(data.error || 'Failed to save'); return; }
        $('anchorMeta').textContent = 'Saved. Anchor = ' + d + '.';
      } catch (e2) { alert('Network error'); }
    });

    $('polForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const slug = $('polSlug').value;
      const body = {
        start_time: $('polStart').value,
        end_time: $('polEnd').value,
        grace_minutes: parseInt($('polGrace').value, 10)
      };
      const err = $('polErr');
      err.classList.remove('on');
      try {
        const r = await fetch('/api/attendance/policy/' + encodeURIComponent(slug), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(body)
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); err.textContent = d.error || 'Save failed'; err.classList.add('on'); return; }
        closeModal();
        load();
      } catch (e2) { err.textContent = 'Network error'; err.classList.add('on'); }
    });

    await load();
  }
};
