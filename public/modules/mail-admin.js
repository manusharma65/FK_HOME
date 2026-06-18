// FK Home — Mail admin (department mailboxes, routing, access)
window.fkModules = window.fkModules || {};

window.fkModules['system/mail'] = {
  title: 'Mail admin',

  render() {
    return '' +
      '<div id="mailadm-mod" class="fk-mod">' +
        '<div class="card">' +
          '<div class="card-head"><div><h2 style="margin:0">Department mailboxes</h2>' +
            '<span class="meta">Shared inboxes linked to departments. CS reps see mailboxes for their team only.</span></div>' +
            '<button class="btn btn-primary" id="maNewMb">New mailbox</button></div>' +
          '<table class="fk-stack"><thead><tr><th>Name</th><th>Gmail</th><th>Department</th><th>Status</th><th></th></tr></thead>' +
            '<tbody id="maMbBody"><tr><td colspan="5">Loading…</td></tr></tbody></table>' +
        '</div>' +
        '<div class="card" id="maDetail" style="display:none;margin-top:16px">' +
          '<div class="card-head"><h2 style="margin:0" id="maDetailTitle">Mailbox</h2></div>' +
          '<div style="padding:18px;display:grid;gap:20px">' +
            '<div id="maAliases"></div>' +
            '<div id="maRules"></div>' +
            '<div id="maAccess"></div>' +
          '</div>' +
        '</div>' +
        '<div class="card" style="margin-top:16px">' +
          '<div class="card-head"><div><h2 style="margin:0">Departments</h2>' +
            '<span class="meta">Create departments for future mailboxes.</span></div>' +
            '<button class="btn btn-ghost" id="maNewDept">New department</button></div>' +
          '<table class="fk-stack"><thead><tr><th>Name</th><th>Slug</th></tr></thead>' +
            '<tbody id="maDeptBody"><tr><td colspan="2">Loading…</td></tr></tbody></table>' +
        '</div>' +
        '<div class="card" style="margin-top:16px">' +
          '<div class="card-head"><h2 style="margin:0">Routing preview</h2></div>' +
          '<div style="padding:18px;display:flex;gap:10px;max-width:560px">' +
            '<input id="maRouteAddr" placeholder="e.g. support@fksports.co.uk" style="flex:1;padding:10px 12px;border:0.5px solid var(--line);border-radius:9px">' +
            '<button class="btn btn-primary" id="maRouteBtn">Test route</button></div>' +
          '<div id="maRouteOut" style="padding:0 18px 18px;font-size:14px;color:var(--muted)"></div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let users = [];

    async function api(path, opts) {
      const r = await fetch(path, Object.assign({ credentials: 'include' }, opts));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed');
      return d;
    }

    async function loadDepts() {
      const d = await api('/api/admin/departments');
      $('maDeptBody').innerHTML = (d.departments || []).map(dep =>
        '<tr><td>' + esc(dep.name) + '</td><td><code>' + esc(dep.slug) + '</code></td></tr>'
      ).join('') || '<tr><td colspan="2">No departments.</td></tr>';
    }

    async function loadUsers() {
      try {
        const d = await api('/api/admin/users');
        users = d.users || [];
      } catch (e) { users = []; }
    }

   async function loadMailboxes() {
  try {
    const d = await api('/api/admin/mail/mailboxes');

    const mailboxes = d.mailboxes || [];

    $('maMbBody').innerHTML =
      mailboxes.map(mb => `
        <tr>
          <td class="cell-head">
            <div class="nm">${esc(mb.display_name)}</div>
          </td>

          <td>${esc(mb.gmail_address)}</td>

          <td>${esc(mb.department_name || '—')}</td>

          <td>
            ${
              mb.is_active
                ? '<span class="chip ok">Active</span>'
                : '<span class="chip muted">Inactive</span>'
            }
          </td>

          <td>
            <button
              class="btn btn-ghost ma-edit"
              data-id="${mb.id}">
              Manage
            </button>
          </td>
        </tr>
      `).join('') ||
      '<tr><td colspan="5">No mailboxes found.</td></tr>';

    el.querySelectorAll('.ma-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        showDetail(Number(btn.dataset.id));
      });
    });

  } catch (err) {
    console.error(err);

    $('maMbBody').innerHTML =
      '<tr><td colspan="5">Failed to load mailboxes.</td></tr>';
  }
}

    async function showDetail(id) {
      const { mailbox: mb } = await api('/api/admin/mail/mailboxes/' + id);
      $('maDetail').style.display = '';
      $('maDetailTitle').textContent = mb.display_name;

      const aliasHtml = (mb.aliases || []).length
        ? (mb.aliases || []).map(a => '<div><code>' + esc(a.alias_address) + '</code>' + (a.is_primary ? ' (primary)' : '') + '</div>').join('')
        : '<div style="color:var(--muted)">Primary only: <code>' + esc(mb.gmail_address) + '</code></div>';

      $('maAliases').innerHTML =
        '<h3 style="margin:0 0 8px;font-size:16px">Email aliases</h3>' +
        '<div style="display:flex;gap:8px;margin-bottom:10px">' +
          '<input id="maAliasIn" placeholder="alias@fksports.co.uk" style="flex:1;padding:8px 10px;border:0.5px solid var(--line);border-radius:8px">' +
          '<button class="btn btn-primary" id="maAliasAdd">Add alias</button></div>' +
        '<div id="maAliasList" style="font-size:14px">' + aliasHtml + '</div>';

      $('maRules').innerHTML =
        '<h3 style="margin:0 0 8px;font-size:16px">Routing rules</h3>' +
        '<div style="display:grid;grid-template-columns:120px 1fr 80px auto;gap:8px;margin-bottom:10px">' +
          '<select id="maRuleType" style="padding:8px;border:0.5px solid var(--line);border-radius:8px"><option value="alias">alias</option><option value="to">to</option><option value="from">from</option><option value="subject">subject</option></select>' +
          '<input id="maRuleVal" placeholder="Match value" style="padding:8px;border:0.5px solid var(--line);border-radius:8px">' +
          '<input id="maRulePri" type="number" value="100" style="padding:8px;border:0.5px solid var(--line);border-radius:8px">' +
          '<button class="btn btn-primary" id="maRuleAdd">Add</button></div>' +
        '<ul id="maRuleList" style="margin:0;padding-left:18px">' +
          (mb.routing_rules || []).map(r => '<li>' + esc(r.match_type) + ': <code>' + esc(r.match_value) + '</code> (priority ' + r.priority + ')</li>').join('') +
        '</ul>';

      const grants = mb.access_grants || [];
      $('maAccess').innerHTML =
        '<h3 style="margin:0 0 8px;font-size:16px">Explicit access grants</h3>' +
        '<p style="font-size:13px;color:var(--muted);margin:0 0 10px">Department members with mail.view.dept get access automatically. Use grants for cross-team access.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
          '<select id="maAccessUser" style="min-width:200px;padding:8px;border:0.5px solid var(--line);border-radius:8px">' +
            users.map(u => '<option value="' + u.id + '">' + esc(u.full_name || u.email) + '</option>').join('') +
          '</select>' +
          '<label style="font-size:14px"><input type="checkbox" id="maAccessRead" checked> Read</label>' +
          '<label style="font-size:14px"><input type="checkbox" id="maAccessSend"> Send</label>' +
          '<button class="btn btn-primary" id="maAccessAdd">Grant access</button></div>' +
        '<div id="maAccessList" style="font-size:14px">' +
          (grants.length ? grants.map(g => '<div>' + esc(g.full_name) + ' — read: ' + g.can_read + ', send: ' + g.can_send + '</div>').join('') : '<span style="color:var(--muted)">No explicit grants.</span>') +
        '</div>';

      $('maAliasAdd').onclick = async () => {
        const alias_address = $('maAliasIn').value.trim();
        if (!alias_address) return;
        try {
          await api('/api/admin/mail/mailboxes/' + id + '/aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias_address }) });
          await showDetail(id);
        } catch (e) { alert(e.message); }
      };

      $('maRuleAdd').onclick = async () => {
        try {
          await api('/api/admin/mail/routing-rules', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mailbox_id: id, match_type: $('maRuleType').value, match_value: $('maRuleVal').value.trim(), priority: parseInt($('maRulePri').value, 10) || 100 })
          });
          await showDetail(id);
        } catch (e) { alert(e.message); }
      };

      $('maAccessAdd').onclick = async () => {
        try {
          await api('/api/admin/mail/mailboxes/' + id + '/access', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: parseInt($('maAccessUser').value, 10), can_read: $('maAccessRead').checked, can_send: $('maAccessSend').checked })
          });
          await showDetail(id);
        } catch (e) { alert(e.message); }
      };
    }

    $('maNewMb').addEventListener('click', async () => {
      const display_name = prompt('Mailbox display name (e.g. Customer Support):');
      if (!display_name) return;
      const gmail_address = prompt('Gmail address for this shared inbox:');
      if (!gmail_address) return;
      const deptSlug = prompt('Department slug (e.g. cs, hr, sales) — optional:', 'cs');
      try {
        await api('/api/admin/mail/mailboxes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name, gmail_address, department_slug: deptSlug || null })
        });
        await loadMailboxes();
      } catch (e) { alert(e.message); }
    });

    $('maNewDept').addEventListener('click', async () => {
      const name = prompt('Department name:');
      if (!name) return;
      const slug = prompt('Slug (lowercase, e.g. sales):', name.toLowerCase().replace(/\s+/g, '-'));
      if (!slug) return;
      try {
        await api('/api/admin/departments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, slug }) });
        await loadDepts();
      } catch (e) { alert(e.message); }
    });

    $('maRouteBtn').addEventListener('click', async () => {
      const address = $('maRouteAddr').value.trim();
      if (!address) return;
      try {
        const d = await api('/api/admin/mail/route-preview?address=' + encodeURIComponent(address));
        if (d.route && d.route.mailbox) {
          $('maRouteOut').innerHTML = 'Routes to <strong>' + esc(d.route.mailbox.display_name) + '</strong> (' + esc(d.route.mailbox.gmail_address) + ') via ' + esc(d.route.matched_by);
        } else {
          $('maRouteOut').textContent = 'No routing rule matched this address.';
        }
      } catch (e) { $('maRouteOut').textContent = e.message; }
    });

    try {
      await loadUsers();
      await Promise.all([loadDepts(), loadMailboxes()]);
    } catch (e) {
      $('maMbBody').innerHTML = '<tr><td colspan="5" style="color:var(--red)">' + esc(e.message) + '</td></tr>';
    }
  }
};
