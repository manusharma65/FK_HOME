// FK Home — Groups module (r0.17, Ship A)
// ----------------------------------------------------------------------------
// Migrates admin.html#groups into the shell. Read-only view (matches today).
//   GET /api/admin/groups
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['system/groups'] = {
  title: 'Groups',

  render() {
    return '' +
      '<div id="grp-mod" class="fk-mod">' +
        '<div class="card">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Groups</h2>' +
              '<span class="meta">Group permissions are read-only in this view. Coming soon: full group editor.</span>' +
            '</div>' +
          '</div>' +
          '<table class="fk-stack">' +
            '<thead><tr><th>Group</th><th>Description</th><th>Members</th><th>Permissions</th></tr></thead>' +
            '<tbody id="grpBody"><tr class="loading-row"><td colspan="4">Loading…</td></tr></tbody>' +
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

    const tbody = $('grpBody');
    tbody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading…</td></tr>';
    try {
      const r = await fetch('/api/admin/groups', { credentials: 'include' });
      if (!r.ok) throw new Error('load failed');
      const data = await r.json();
      const groups = data.groups || [];
      if (groups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--muted)">No groups.</td></tr>';
        return;
      }
      tbody.innerHTML = groups.map(g =>
        '<tr>' +
          '<td class="cell-head"><div class="nm">' + escapeHtml(g.name) + '</div>' +
            (g.is_system ? '<span class="chip muted" style="margin-top:3px">system</span>' : '') + '</td>' +
          '<td class="cell-block" data-label="Description" style="color:var(--muted);font-size:15px">' + escapeHtml(g.description || '') + '</td>' +
          '<td data-label="Members">' + (g.member_count != null ? g.member_count : 0) + '</td>' +
          '<td class="cell-block" data-label="Permissions">' +
            (g.permissions || []).slice(0, 5).map(p =>
              '<span class="chip" style="font-family:ui-monospace,monospace;font-size:13.5px">' + escapeHtml(p) + '</span>').join('') +
            ((g.permissions || []).length > 5 ?
              '<span class="chip muted" style="font-size:13.5px">+' + (g.permissions.length - 5) + ' more</span>' : '') +
          '</td>' +
        '</tr>'
      ).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--red)">Failed to load.</td></tr>';
    }
  }
};
