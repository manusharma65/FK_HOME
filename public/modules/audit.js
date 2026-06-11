// FK Home — Audit log module (r0.17, Ship A)
// ----------------------------------------------------------------------------
// Migrates admin.html#audit into the shell.
//   GET /api/admin/audit?module=<optional>
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['system/audit'] = {
  title: 'Audit log',

  render() {
    return '' +
      '<div id="aud-mod" class="fk-mod">' +
        '<div class="card">' +
          '<div class="card-head">' +
            '<h2 style="margin:0">Audit log</h2>' +
            '<span class="meta" id="audMeta">—</span>' +
          '</div>' +
          '<div class="filter-bar">' +
            '<span style="font-size:14px;color:var(--muted)">Filter:</span>' +
            '<select id="audModule">' +
              '<option value="">All modules</option>' +
              '<option value="auth">auth</option>' +
              '<option value="me">me</option>' +
              '<option value="leaves">leaves</option>' +
              '<option value="admin">admin</option>' +
            '</select>' +
          '</div>' +
          '<table class="fk-stack">' +
            '<thead><tr><th>When</th><th>Who</th><th>Module · Action</th><th>Target</th></tr></thead>' +
            '<tbody id="audBody"><tr class="loading-row"><td colspan="4">Loading…</td></tr></tbody>' +
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
    function formatWhen(iso) {
      const d = new Date(iso);
      return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    async function load() {
      const tbody = $('audBody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading…</td></tr>';
      const mod = $('audModule').value;
      const qs = mod ? '?module=' + encodeURIComponent(mod) : '';
      try {
        const r = await fetch('/api/admin/audit' + qs, { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const data = await r.json();
        const entries = data.entries || [];
        $('audMeta').textContent = entries.length + ' entries shown';
        if (entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--muted)">No audit entries.</td></tr>';
          return;
        }
        tbody.innerHTML = entries.map(e =>
          '<tr class="audit-row">' +
            '<td data-label="When" style="color:var(--muted);white-space:nowrap">' + formatWhen(e.occurred_at) + '</td>' +
            '<td data-label="Who">' + escapeHtml(e.actor_name || '—') + '</td>' +
            '<td data-label="Action"><span class="mod">' + escapeHtml(e.module) + '</span> · <span class="act">' + escapeHtml(e.action) + '</span></td>' +
            '<td class="det cell-block" data-label="Target">' + escapeHtml(e.target_type || '') + (e.target_id ? ' #' + e.target_id : '') +
              (e.details ? ' · ' + escapeHtml(e.details) : '') + '</td>' +
          '</tr>'
        ).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--red)">Failed to load.</td></tr>';
      }
    }

    $('audModule').addEventListener('change', load);
    await load();
  }
};
