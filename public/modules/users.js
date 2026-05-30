// FK Home — Users module (r0.18, Ship B)
// ----------------------------------------------------------------------------
// Migrates admin.html#users into the shell. Highest blast radius in the app
// (create/edit/status/password-reset + dept & group assignment), so this is a
// faithful port of the working logic — same endpoints, same payloads:
//   GET   /api/admin/users
//   POST  /api/admin/users                     create (+ returns temp pwd)
//   PATCH /api/admin/users/:id                 basic fields + status
//   PUT   /api/admin/users/:id/departments     memberships
//   PUT   /api/admin/users/:id/groups          group_slugs
//   POST  /api/admin/users/:id/reset-password
//   GET   /api/admin/departments  +  /api/admin/groups   (at mount)
//
// FK Home additions (not in admin.html): live search box + status filter, and
// clicking a row opens the Profile MODULE in-shell (#profile/<id>) instead of
// a full page jump to profile.html.
//
// Lifecycle convention: all lookups scoped to the module root (el).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/users'] = {
  title: 'People',

  render() {
    return '' +
      '<div id="usr-mod" class="fk-mod">' +
        '<style>' +
          '#usr-mod .usr-toolbar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}' +
          '#usr-mod .usr-toolbar input[type=text]{flex:1;min-width:180px}' +
          '#usr-mod .seg{display:inline-flex;border:0.5px solid var(--line);border-radius:8px;overflow:hidden}' +
          '#usr-mod .seg button{border:none;border-radius:0;background:var(--surface);padding:7px 13px;font-size:13px;color:var(--muted);cursor:pointer;border-left:0.5px solid var(--line)}' +
          '#usr-mod .seg button:first-child{border-left:none}' +
          '#usr-mod .seg button.on{background:var(--ink);color:var(--surface)}' +
          '#usr-mod .avatar{width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#3a3a36;flex-shrink:0}' +
          '#usr-mod .name-cell{display:flex;align-items:center;gap:10px;cursor:pointer}' +
          '#usr-mod .name-cell .em{font-size:13px;color:var(--muted)}' +
          '#usr-mod .status-pill{display:inline-flex;font-size:12px;font-weight:500;padding:3px 10px;border-radius:99px;background:#F1EFE8;color:var(--muted);text-transform:capitalize}' +
          '#usr-mod .status-pill.active{background:var(--green-soft);color:var(--green)}' +
          '#usr-mod .status-pill.on_leave{background:var(--amber-soft);color:var(--amber-deep)}' +
          '#usr-mod .status-pill.left{background:var(--red-soft);color:var(--red)}' +
          '#usr-mod .check-list{display:flex;flex-direction:column;gap:7px;border:0.5px solid var(--line);border-radius:8px;padding:10px;max-height:220px;overflow:auto}' +
          '#usr-mod .check-list label{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--ink);margin:0}' +
          '#usr-mod .check-list label .meta{color:var(--muted);font-size:12px}' +
          '#usr-mod .pwd-display{font-family:ui-monospace,monospace;font-size:18px;background:#F1EFE8;border-radius:8px;padding:10px 14px;letter-spacing:1px;margin-bottom:8px}' +
          '#usr-mod .modal-ok{display:none;color:var(--green);font-size:14px;margin:6px 0}' +
          '#usr-mod .modal-ok.on{display:block}' +
          '#usr-mod .modal-err{display:none;color:var(--red);font-size:14px;margin:6px 0}' +
          '#usr-mod .modal-err.on{display:block}' +
        '</style>' +

        '<div class="card">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">People</h2>' +
              '<span class="meta">Everyone in FK Home. Click a person to open their profile.</span>' +
            '</div>' +
            '<button class="btn btn-primary" id="usrAddBtn"><i class="ti ti-plus"></i> Add user</button>' +
          '</div>' +

          '<div class="usr-toolbar">' +
            '<input type="text" id="usrSearch" placeholder="Search name or email…" />' +
            '<div class="seg" id="usrFilter">' +
              '<button data-f="all" class="on">All</button>' +
              '<button data-f="active">Active</button>' +
              '<button data-f="on_leave">On leave</button>' +
              '<button data-f="left">Left</button>' +
            '</div>' +
          '</div>' +

          '<table>' +
            '<thead><tr><th>Name</th><th>Departments</th><th>Groups</th><th>Status</th><th></th></tr></thead>' +
            '<tbody id="usrBody"><tr class="loading-row"><td colspan="5">Loading users…</td></tr></tbody>' +
          '</table>' +
        '</div>' +

        // ----- Create user modal -----
        '<div class="modal-bg" id="cuModal">' +
          '<div class="modal">' +
            '<h2>Add a new user</h2>' +
            '<p class="modal-sub">They\'ll get a temporary password they must change on first login.</p>' +
            '<div class="modal-err" id="cuErr"></div>' +
            '<div class="modal-ok" id="cuOk"></div>' +
            '<div id="cuPwdBox" style="display:none">' +
              '<p style="font-size:14px;color:var(--muted);margin:0 0 6px">Share this password with the new user.</p>' +
              '<div class="pwd-display" id="cuPwdValue">—</div>' +
            '</div>' +
            '<form id="cuForm">' +
              '<label>Full name</label><input type="text" id="cuFullName" required placeholder="e.g. Satyam Kumar" />' +
              '<label>Email</label><input type="email" id="cuEmail" required placeholder="satyam@fksports.co.uk" />' +
              '<label>Display name (optional)</label><input type="text" id="cuDisplayName" placeholder="What people call them" />' +
              '<label>Primary department</label><select id="cuDept" required><option value="">— pick a department —</option></select>' +
              '<label>Groups (everyone gets "Employee" automatically)</label>' +
              '<div class="check-list" id="cuGroups">Loading…</div>' +
              '<div class="modal-actions">' +
                '<button type="button" class="btn" id="cuCancel">Cancel</button>' +
                '<button type="submit" class="btn btn-primary" id="cuBtn">Create user</button>' +
              '</div>' +
            '</form>' +
          '</div>' +
        '</div>' +

        // ----- Edit user modal -----
        '<div class="modal-bg" id="euModal">' +
          '<div class="modal">' +
            '<h2 id="euTitle">Edit user</h2>' +
            '<p class="modal-sub" id="euSub">—</p>' +
            '<div class="modal-err" id="euErr"></div>' +
            '<div class="modal-ok" id="euOk"></div>' +
            '<form id="euForm">' +
              '<input type="hidden" id="euId" />' +
              '<label>Full name</label><input type="text" id="euFullName" required />' +
              '<label>Display name</label><input type="text" id="euDisplayName" />' +
              '<label>Employment status</label>' +
              '<select id="euEmpStatus">' +
                '<option value="active">Active</option>' +
                '<option value="on_leave">On leave</option>' +
                '<option value="left">Left the company</option>' +
              '</select>' +
              '<label>Departments &amp; roles</label><div class="check-list" id="euDepts">Loading…</div>' +
              '<label>Groups</label><div class="check-list" id="euGroups">Loading…</div>' +
              '<div class="modal-actions">' +
                '<button type="button" class="btn" id="euCancel">Cancel</button>' +
                '<button type="button" class="btn btn-danger" id="euReset">Reset password</button>' +
                '<button type="submit" class="btn btn-primary" id="euBtn">Save changes</button>' +
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
    function roleDisplay(role) {
      if (role === 'manager') return 'Manager';
      if (role === 'lead') return 'Executive';
      return 'Specialist';
    }

    let departments_ = [];
    let groups_ = [];
    let users_ = [];
    let filter_ = 'all';
    let search_ = '';

    // ----- Load reference data + users -----
    async function init() {
      try {
        const [d, g] = await Promise.all([
          fetch('/api/admin/departments', { credentials: 'include' }).then(r => r.ok ? r.json() : { departments: [] }),
          fetch('/api/admin/groups', { credentials: 'include' }).then(r => r.ok ? r.json() : { groups: [] })
        ]);
        departments_ = d.departments || [];
        groups_ = g.groups || [];
      } catch (e) {}
      await loadUsers();
    }

    async function loadUsers() {
      const tbody = $('usrBody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Loading users…</td></tr>';
      try {
        const r = await fetch('/api/admin/users', { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const data = await r.json();
        users_ = data.users || [];
        renderRows();
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--red)">Failed to load users.</td></tr>';
      }
    }

    function renderRows() {
      const tbody = $('usrBody');
      let rows = users_;
      if (filter_ !== 'all') rows = rows.filter(u => u.employment_status === filter_);
      if (search_) {
        const q = search_.toLowerCase();
        rows = rows.filter(u =>
          (u.full_name || '').toLowerCase().includes(q) ||
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q));
      }
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--muted)">No users match.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(userRow).join('');
    }

    function userRow(u) {
      const depts = (u.departments || []).map(d => '<span class="chip">' + escapeHtml(d.name) + ' · ' + roleDisplay(d.role) + '</span>').join('') || '<span style="color:var(--muted);font-size:14px">none</span>';
      const grps = (u.groups || []).map(g => '<span class="chip ' + (g.slug === 'owner' ? 'amber' : '') + '">' + escapeHtml(g.name) + '</span>').join('') || '<span style="color:var(--muted);font-size:14px">none</span>';
      const st = u.employment_status || 'active';
      return '' +
        '<tr>' +
          '<td>' +
            '<div class="name-cell" data-profile="' + u.id + '" title="View profile">' +
              '<span class="avatar" style="background:' + (u.avatar_colour || '#F1EFE8') + '">' + escapeHtml(u.initials || '—') + '</span>' +
              '<div><div class="nm">' + escapeHtml(u.display_name || u.full_name) + '</div><div class="em">' + escapeHtml(u.email) + '</div></div>' +
            '</div>' +
          '</td>' +
          '<td>' + depts + '</td>' +
          '<td>' + grps + '</td>' +
          '<td><span class="status-pill ' + st + '">' + st.replace('_', ' ') + '</span></td>' +
          '<td class="action-col"><button class="btn" data-edit="' + u.id + '"><i class="ti ti-edit"></i> Edit</button></td>' +
        '</tr>';
    }

    // ----- Create user -----
    function openCreate() {
      $('cuDept').innerHTML = '<option value="">— pick a department —</option>' +
        departments_.map(d => '<option value="' + d.slug + '">' + escapeHtml(d.name) + '</option>').join('');
      $('cuGroups').innerHTML = groups_
        .filter(g => g.slug !== 'employee-base' && g.slug !== 'owner')
        .map(g => '<label><input type="checkbox" value="' + g.slug + '" /><span>' + escapeHtml(g.name) + '</span><span class="meta">' + escapeHtml(g.description || '') + '</span></label>').join('');
      $('cuFullName').value = ''; $('cuEmail').value = ''; $('cuDisplayName').value = '';
      $('cuPwdBox').style.display = 'none';
      $('cuErr').classList.remove('on'); $('cuOk').classList.remove('on');
      const btn = $('cuBtn'); btn.disabled = false; btn.textContent = 'Create user'; btn.type = 'submit'; btn.onclick = null;
      $('cuModal').classList.add('on');
    }

    $('cuForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('cuErr'), ok = $('cuOk'), btn = $('cuBtn');
      err.classList.remove('on'); ok.classList.remove('on');
      const checked = Array.from(el.querySelectorAll('#cuGroups input:checked')).map(x => x.value);
      const body = {
        full_name: $('cuFullName').value.trim(),
        email: $('cuEmail').value.trim(),
        display_name: $('cuDisplayName').value.trim() || undefined,
        primary_department_slug: $('cuDept').value || undefined,
        group_slugs: checked
      };
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await fetch('/api/admin/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(body)
        });
        const data = await r.json();
        if (!r.ok) { err.textContent = data.error || 'Failed'; err.classList.add('on'); btn.disabled = false; btn.textContent = 'Create user'; return; }
        $('cuPwdValue').textContent = data.initial_password;
        $('cuPwdBox').style.display = '';
        ok.textContent = 'User created. Share the password with ' + (data.user.display_name || data.user.full_name) + '.';
        ok.classList.add('on');
        btn.textContent = 'Done — close this'; btn.disabled = false; btn.type = 'button';
        btn.onclick = () => { $('cuModal').classList.remove('on'); btn.type = 'submit'; btn.onclick = null; loadUsers(); };
      } catch (er) {
        err.textContent = 'Network error'; err.classList.add('on'); btn.disabled = false; btn.textContent = 'Create user';
      }
    });

    // ----- Edit user -----
    function openEdit(id) {
      const u = users_.find(x => x.id === id);
      if (!u) return alert('User not found');
      $('euId').value = u.id;
      $('euTitle').textContent = u.full_name;
      $('euSub').textContent = u.email;
      $('euFullName').value = u.full_name;
      $('euDisplayName').value = u.display_name || '';
      $('euEmpStatus').value = u.employment_status;
      $('euErr').classList.remove('on'); $('euOk').classList.remove('on');

      const userDepts = (u.departments || []).reduce((acc, d) => { acc[d.slug] = d; return acc; }, {});
      $('euDepts').innerHTML = departments_.map(d => {
        const m = userDepts[d.slug];
        const checked = m ? 'checked' : '';
        const role = m ? m.role : 'agent';
        const isPrimary = m ? m.is_primary : false;
        return '<label style="display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:9px">' +
          '<input type="checkbox" data-slug="' + d.slug + '" ' + checked + ' />' +
          '<span>' + escapeHtml(d.name) + '</span>' +
          '<select data-slug-role="' + d.slug + '" style="font-size:14px;padding:3px 6px;border:0.5px solid var(--line);border-radius:6px">' +
            '<option value="agent"' + (role === 'agent' ? ' selected' : '') + '>Specialist</option>' +
            '<option value="lead"' + (role === 'lead' ? ' selected' : '') + '>Executive</option>' +
            '<option value="manager"' + (role === 'manager' ? ' selected' : '') + '>Manager</option>' +
          '</select>' +
          '<label style="display:flex;align-items:center;gap:4px;margin:0;font-size:14px;color:var(--muted)">' +
            '<input type="checkbox" data-slug-primary="' + d.slug + '" ' + (isPrimary ? 'checked' : '') + ' />primary</label>' +
          '</label>';
      }).join('');

      const userGroups = new Set((u.groups || []).map(g => g.slug));
      $('euGroups').innerHTML = groups_
        .filter(g => g.slug !== 'employee-base')
        .map(g => {
          const isOwner = g.slug === 'owner';
          return '<label><input type="checkbox" value="' + g.slug + '" ' + (userGroups.has(g.slug) ? 'checked' : '') + ' ' + (isOwner ? 'disabled' : '') + ' /><span>' + escapeHtml(g.name) + '</span><span class="meta">' + escapeHtml(g.description || '') + '</span></label>';
        }).join('') + '<div style="font-size:13px;color:var(--muted);padding:6px 2px">Employee (base) is always included.</div>';

      $('euModal').classList.add('on');
    }

    $('euForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = parseInt($('euId').value, 10);
      const err = $('euErr'), ok = $('euOk'), btn = $('euBtn');
      err.classList.remove('on'); ok.classList.remove('on');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const updateBody = {
          full_name: $('euFullName').value.trim(),
          display_name: $('euDisplayName').value.trim() || undefined,
          employment_status: $('euEmpStatus').value
        };
        let r = await fetch('/api/admin/users/' + id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(updateBody)
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Update failed'); }

        const deptInputs = Array.from(el.querySelectorAll('#euDepts input[data-slug]:checked'));
        const memberships = deptInputs.map(inp => {
          const slug = inp.dataset.slug;
          const role = el.querySelector('#euDepts select[data-slug-role="' + slug + '"]').value;
          const primary = el.querySelector('#euDepts input[data-slug-primary="' + slug + '"]').checked;
          return { department_slug: slug, role, is_primary: primary };
        });
        r = await fetch('/api/admin/users/' + id + '/departments', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ memberships })
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Departments failed'); }

        const groupSlugs = Array.from(el.querySelectorAll('#euGroups input:checked')).map(x => x.value);
        r = await fetch('/api/admin/users/' + id + '/groups', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ group_slugs: groupSlugs })
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Groups failed'); }

        ok.textContent = 'Saved.'; ok.classList.add('on');
        setTimeout(() => { $('euModal').classList.remove('on'); loadUsers(); }, 800);
      } catch (e2) {
        err.textContent = e2.message; err.classList.add('on');
      } finally {
        btn.disabled = false; btn.textContent = 'Save changes';
      }
    });

    async function resetPassword() {
      const id = parseInt($('euId').value, 10);
      const name = $('euTitle').textContent;
      if (!confirm('Reset password for ' + name + '? They\'ll be forced to change it on next login.')) return;
      try {
        const r = await fetch('/api/admin/users/' + id + '/reset-password', { method: 'POST', credentials: 'include' });
        const data = await r.json();
        if (!r.ok) return alert(data.error || 'Failed');
        alert('Password reset. Temporary password: ' + data.initial_password + '\n\nPlease share this with the user.');
      } catch (e) { alert('Network error'); }
    }

    // ----- Wire -----
    $('usrAddBtn').addEventListener('click', openCreate);
    $('cuCancel').addEventListener('click', () => $('cuModal').classList.remove('on'));
    $('euCancel').addEventListener('click', () => $('euModal').classList.remove('on'));
    $('euReset').addEventListener('click', resetPassword);

    $('usrBody').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) { openEdit(parseInt(edit.getAttribute('data-edit'), 10)); return; }
      const prof = e.target.closest('[data-profile]');
      if (prof) { location.hash = '#profile/' + prof.getAttribute('data-profile'); }
    });

    $('usrSearch').addEventListener('input', (e) => { search_ = e.target.value.trim(); renderRows(); });
    $('usrFilter').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      filter_ = b.getAttribute('data-f');
      el.querySelectorAll('#usrFilter button').forEach(x => x.classList.toggle('on', x === b));
      renderRows();
    });

    await init();
  }
};
