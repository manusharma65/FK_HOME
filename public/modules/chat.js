// FK Home — Chat module (r0.20, Ship D)
// ----------------------------------------------------------------------------
// Faithful migration of chat.html (two-pane messenger: channels list +
// messages + composer, 5s polling) INTO the shell, PLUS custom groups:
//   - "New group" button → create-group modal (name + member picker; anyone can)
//   - per-group ⋯ menu: Add/remove people, Rename, Archive (hides for everyone)
// Server endpoints (chat.js): existing channels/messages/read/dm + new
//   POST /api/chat/groups
//   POST /api/chat/channels/:id/members  (add)
//   DELETE /api/chat/channels/:id/members/:userId  (remove)
//   GET  /api/chat/channels/:id/members
//   POST /api/chat/channels/:id/rename
//   POST /api/chat/channels/:id/archive
//
// LIFECYCLE: all lookups scoped to module root (el). Polling timer + the body
// click-away listener for the ⋯ menu are torn down in unmount().
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['chat'] = {
  title: 'Team chat',

  render() {
    return '' +
      '<div id="chat-mod" class="fk-mod">' +
        '<style>' +
          '#chat-mod .chat-layout{display:grid;grid-template-columns:260px 1fr;gap:0;border:0.5px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface);height:calc(100vh - 170px);min-height:420px}' +
          '@media (max-width:768px){#chat-mod .chat-layout{grid-template-columns:1fr}#chat-mod .channels-pane.hide-mobile,#chat-mod .messages-pane.hide-mobile{display:none}}' +
          '#chat-mod .channels-pane{border-right:0.5px solid var(--line);display:flex;flex-direction:column;min-height:0}' +
          '#chat-mod .channels-head{padding:13px 15px;border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between}' +
          '#chat-mod .channels-head h2{font-size:15px;font-weight:600;margin:0}' +
          '#chat-mod .new-group-btn{font-size:12px;padding:5px 9px;border:0.5px solid var(--line);border-radius:7px;background:var(--ink);color:var(--surface);cursor:pointer;display:inline-flex;align-items:center;gap:4px}' +
          '#chat-mod .channels-list{overflow-y:auto;flex:1}' +
          '#chat-mod .channel-section-label{font-size:11px;color:var(--soft);letter-spacing:0.06em;text-transform:uppercase;padding:12px 16px 4px}' +
          '#chat-mod .ch-row{display:flex;align-items:center;gap:9px;padding:8px 16px;cursor:pointer;border-left:2px solid transparent;position:relative}' +
          '#chat-mod .ch-row:hover{background:#FBFAF7}' +
          '#chat-mod .ch-row.on{background:var(--amber-soft,#FAEEDA);border-left-color:var(--amber,#EF9F27)}' +
          '#chat-mod .ch-icon{width:22px;height:22px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--ink)}' +
          '#chat-mod .ch-icon.amber{background:var(--amber-soft,#FAEEDA)}' +
          '#chat-mod .ch-info{flex:1;min-width:0}' +
          '#chat-mod .ch-name{font-size:14px;font-weight:500;line-height:1.2}' +
          '#chat-mod .ch-row.unread .ch-name{font-weight:600}' +
          '#chat-mod .ch-preview{font-size:13px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '#chat-mod .ch-unread-badge{background:var(--amber,#EF9F27);color:var(--nav,#14161B);font-size:12px;font-weight:600;border-radius:99px;padding:2px 7px;min-width:18px;text-align:center}' +
          '#chat-mod .ch-menu-btn{opacity:0;border:none;background:none;color:var(--muted);cursor:pointer;font-size:16px;padding:0 2px;flex-shrink:0}' +
          '#chat-mod .ch-row:hover .ch-menu-btn{opacity:1}' +
          '#chat-mod .messages-pane{display:flex;flex-direction:column;min-height:0;background:var(--bg)}' +
          '#chat-mod .msg-head{padding:12px 18px;border-bottom:0.5px solid var(--line);background:var(--surface);display:flex;align-items:center;gap:10px;flex-shrink:0}' +
          '#chat-mod .msg-head .back-btn{display:none;background:none;border:none;cursor:pointer;padding:4px;color:var(--muted)}' +
          '@media (max-width:768px){#chat-mod .msg-head .back-btn{display:inline-flex}}' +
          '#chat-mod .msg-head h2{font-size:16px;font-weight:500;margin:0}' +
          '#chat-mod .msg-head .sub{font-size:13px;color:var(--muted)}' +
          '#chat-mod .msg-list{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:8px}' +
          '#chat-mod .msg-group{display:flex;gap:10px}' +
          '#chat-mod .msg-avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:500;font-size:13px;color:var(--ink);flex-shrink:0}' +
          '#chat-mod .msg-content{flex:1;min-width:0}' +
          '#chat-mod .msg-meta{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}' +
          '#chat-mod .msg-sender{font-size:14px;font-weight:500}' +
          '#chat-mod .msg-time{font-size:12px;color:var(--soft)}' +
          '#chat-mod .msg-body{font-size:14px;line-height:1.45;color:var(--ink);word-wrap:break-word;white-space:pre-wrap}' +
          '#chat-mod .msg-day-divider{text-align:center;font-size:12px;color:var(--soft);margin:8px 0 4px;letter-spacing:0.04em;text-transform:uppercase}' +
          '#chat-mod .msg-empty{text-align:center;color:var(--muted);font-size:14px;padding:32px 16px}' +
          '#chat-mod .compose{border-top:0.5px solid var(--line);padding:12px 14px;background:var(--surface);display:flex;gap:10px;align-items:flex-end;flex-shrink:0}' +
          '#chat-mod .compose textarea{flex:1;resize:none;border:0.5px solid var(--line);border-radius:12px;padding:10px 14px;font-size:14px;outline:none;background:var(--surface);color:var(--ink);max-height:120px;min-height:40px;line-height:1.4}' +
          '#chat-mod .compose textarea:focus{border-color:var(--amber,#EF9F27)}' +
          '#chat-mod .compose button{background:var(--nav,#14161B);color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:14px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px}' +
          '#chat-mod .compose button:disabled{opacity:0.5;cursor:not-allowed}' +
          '#chat-mod .ch-popmenu{position:absolute;z-index:30;background:var(--surface);border:0.5px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:5px;min-width:170px}' +
          '#chat-mod .ch-popmenu button{display:block;width:100%;text-align:left;border:none;background:none;padding:8px 12px;font-size:14px;color:var(--ink);cursor:pointer;border-radius:7px}' +
          '#chat-mod .ch-popmenu button:hover{background:var(--bg)}' +
          '#chat-mod .ch-popmenu button.danger{color:var(--red,#A32D2D)}' +
          '#chat-mod .member-list{display:flex;flex-direction:column;gap:2px;border:0.5px solid var(--line);border-radius:8px;padding:6px;max-height:200px;overflow:auto}' +
          '#chat-mod .member-list label{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:6px;font-size:14px;cursor:pointer;margin:0}' +
          '#chat-mod .member-list label:hover{background:var(--bg)}' +
          '#chat-mod .member-list .avatar{width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#3a3a36}' +
          '#chat-mod .mrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border-radius:6px;font-size:14px}' +
          '#chat-mod .mrow .avatar{width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#3a3a36}' +
          '#chat-mod .modal-err{display:none;color:var(--red,#A32D2D);font-size:14px;margin:6px 0}' +
          '#chat-mod .modal-err.on{display:block}' +
        '</style>' +

        '<div class="chat-layout">' +
          '<aside class="channels-pane" id="chChannelsPane">' +
            '<div class="channels-head"><h2>Channels</h2><button class="new-group-btn" id="chNewGroup"><i class="ti ti-plus"></i> New group</button></div>' +
            '<div id="chChannelsList" class="channels-list"><div class="msg-empty" style="padding:24px 16px">Loading…</div></div>' +
          '</aside>' +
          '<main class="messages-pane hide-mobile" id="chMessagesPane">' +
            '<div class="msg-head">' +
              '<button class="back-btn" id="chBack"><i class="ti ti-arrow-left"></i></button>' +
              '<div style="flex:1"><h2 id="chChannelName">Select a channel</h2><div class="sub" id="chChannelSub"></div></div>' +
            '</div>' +
            '<div id="chMsgList" class="msg-list"><div class="msg-empty">Pick a channel to see messages.</div></div>' +
            '<form id="chComposeForm" class="compose" style="display:none">' +
              '<textarea id="chComposeInput" placeholder="Type a message…" rows="1"></textarea>' +
              '<button type="submit" id="chComposeBtn"><i class="ti ti-send"></i> Send</button>' +
            '</form>' +
          '</main>' +
        '</div>' +

        // Create / manage group modal
        '<div class="modal-bg" id="chGroupModal">' +
          '<div class="modal">' +
            '<h2 id="chGroupTitle">New group</h2>' +
            '<p class="modal-sub" id="chGroupSub">Create a named group and add members. Anyone you add can post.</p>' +
            '<div class="modal-err" id="chGroupErr"></div>' +
            '<label>Group name</label>' +
            '<input type="text" id="chGroupName" placeholder="e.g. peak-season-logistics" maxlength="80" />' +
            '<label style="margin-top:12px;display:block">Add members</label>' +
            '<input type="text" id="chMemberSearch" placeholder="Search people…" />' +
            '<div class="member-list" id="chMemberList" style="margin-top:8px">Loading…</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:6px" id="chMemberCount">you\'re added automatically</div>' +
            '<div class="modal-actions">' +
              '<button type="button" class="btn" id="chGroupCancel">Cancel</button>' +
              '<button type="button" class="btn btn-primary" id="chGroupSave">Create group</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Manage existing group members modal
        '<div class="modal-bg" id="chManageModal">' +
          '<div class="modal">' +
            '<h2 id="chManageTitle">Manage members</h2>' +
            '<div class="modal-err" id="chManageErr"></div>' +
            '<div style="font-size:13px;color:var(--muted);margin-bottom:6px">In this group</div>' +
            '<div id="chManageMembers" style="display:flex;flex-direction:column;gap:2px;margin-bottom:16px">Loading…</div>' +
            '<label>Add more people</label>' +
            '<input type="text" id="chManageSearch" placeholder="Search people…" />' +
            '<div class="member-list" id="chManageAddList" style="margin-top:8px">Loading…</div>' +
            '<div class="modal-actions">' +
              '<button type="button" class="btn" id="chManageClose">Done</button>' +
              '<button type="button" class="btn btn-primary" id="chManageAdd">Add selected</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el, ctx) {
    const $ = (id) => el.querySelector('#' + id);
    function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    let channels = [];
    let currentChannel = null;
    let pollTimer = null;
    let allUsers = [];          // for member pickers
    let openMenuEl = null;

    // ---- load channels ----
    async function loadChannels() {
      try {
        const r = await fetch('/api/chat/channels', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        channels = data.channels || [];
        renderChannels();
      } catch (e) {}
    }

    function renderChannels() {
      const list = $('chChannelsList');
      if (channels.length === 0) { list.innerHTML = '<div class="msg-empty" style="padding:24px 16px">No channels yet.</div>'; return; }
      const groups = {
        all_hands: channels.filter(c => c.type === 'all_hands'),
        department: channels.filter(c => c.type === 'department'),
        group: channels.filter(c => c.type === 'group'),
        dm: channels.filter(c => c.type === 'dm'),
      };
      let html = '';
      if (groups.all_hands.length) { html += '<div class="channel-section-label">Company</div>' + groups.all_hands.map(channelRow).join(''); }
      if (groups.department.length) { html += '<div class="channel-section-label">Departments</div>' + groups.department.map(channelRow).join(''); }
      if (groups.group.length) { html += '<div class="channel-section-label">Groups</div>' + groups.group.map(channelRow).join(''); }
      if (groups.dm.length) { html += '<div class="channel-section-label">Direct messages</div>' + groups.dm.map(channelRow).join(''); }
      list.innerHTML = html;
    }

    function channelRow(c) {
      const isOn = currentChannel === c.id;
      const unread = c.unread_count > 0;
      const icon = c.type === 'all_hands' ? '<i class="ti ti-broadcast"></i>'
        : c.type === 'department' ? '<i class="ti ' + (c.department_icon || 'ti-users') + '"></i>'
        : c.type === 'group' ? '<i class="ti ti-users-group"></i>'
        : c.type === 'dm' ? ((c.other_user && c.other_user.initials) || '·')
        : '#';
      const iconStyle = c.type === 'department' && c.department_colour ? 'background:' + c.department_colour + ';color:#fff'
        : c.type === 'dm' && c.other_user && c.other_user.avatar_colour ? 'background:' + c.other_user.avatar_colour : '';
      const preview = c.last_message
        ? escapeHtml(c.last_message.sender_name || 'someone') + ': ' + escapeHtml((c.last_message.body || '').slice(0, 50))
        : 'No messages yet';
      const menuBtn = c.type === 'group' ? '<button class="ch-menu-btn" data-menu="' + c.id + '">\u22ef</button>' : '';
      return '<div class="ch-row ' + (isOn ? 'on' : '') + ' ' + (unread ? 'unread' : '') + '" data-open="' + c.id + '">' +
        '<div class="ch-icon ' + (c.type === 'all_hands' ? 'amber' : c.type === 'department' ? 'dept' : '') + '" style="' + iconStyle + '">' + icon + '</div>' +
        '<div class="ch-info"><div class="ch-name">' + escapeHtml(c.name || 'Channel') + '</div><div class="ch-preview">' + preview + '</div></div>' +
        (unread ? '<div class="ch-unread-badge">' + (c.unread_count > 99 ? '99+' : c.unread_count) + '</div>' : '') +
        menuBtn +
        '</div>';
    }

    // ---- open channel + messages ----
    async function openChannel(id) {
      currentChannel = id;
      renderChannels();
      const ch = channels.find(c => c.id === id);
      if (!ch) return;
      $('chChannelName').textContent = ch.name || 'Channel';
      $('chChannelSub').textContent = ch.type === 'all_hands' ? 'Everyone is in this channel'
        : ch.type === 'department' ? (ch.department_name + ' team')
        : ch.type === 'group' ? 'Group'
        : ch.type === 'dm' ? 'Direct message' : '';
      $('chComposeForm').style.display = '';
      if (window.innerWidth <= 768) { $('chChannelsPane').classList.add('hide-mobile'); $('chMessagesPane').classList.remove('hide-mobile'); }
      await loadMessages(id);
      fetch('/api/chat/channels/' + id + '/read', { method: 'POST', credentials: 'include' }).catch(() => {});
      setTimeout(loadChannels, 500);
    }

    async function loadMessages(channelId) {
      const list = $('chMsgList');
      if (currentChannel !== channelId) return;
      try {
        const r = await fetch('/api/chat/channels/' + channelId + '/messages?limit=50', { credentials: 'include' });
        if (!r.ok) { list.innerHTML = '<div class="msg-empty">Failed to load.</div>'; return; }
        const data = await r.json();
        renderMessages(data.messages || []);
      } catch (e) { list.innerHTML = '<div class="msg-empty">Network error.</div>'; }
    }

    function renderMessages(messages) {
      const list = $('chMsgList');
      if (messages.length === 0) { list.innerHTML = '<div class="msg-empty">No messages yet. Be the first to say something.</div>'; return; }
      let html = '', lastDay = null, lastSender = null, lastTime = 0;
      for (const m of messages) {
        const day = new Date(m.created_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
        if (day !== lastDay) { html += '<div class="msg-day-divider">' + day + '</div>'; lastDay = day; lastSender = null; }
        const t = new Date(m.created_at).getTime();
        const showHeader = lastSender !== m.sender_id || (t - lastTime > 300000);
        if (showHeader) {
          html += '<div class="msg-group"><div class="msg-avatar" style="background:' + (m.sender_avatar_colour || '#FAEEDA') + '">' + escapeHtml(m.sender_initials || '\u00b7') + '</div>' +
            '<div class="msg-content"><div class="msg-meta"><span class="msg-sender">' + escapeHtml(m.sender_name || m.sender_full_name) + '</span><span class="msg-time">' + new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</span></div><div class="msg-body">' + escapeHtml(m.body) + '</div></div></div>';
        } else {
          html += '<div class="msg-group"><div style="width:32px;flex-shrink:0"></div><div class="msg-content"><div class="msg-body">' + escapeHtml(m.body) + '</div></div></div>';
        }
        lastSender = m.sender_id; lastTime = t;
      }
      list.innerHTML = html;
      list.scrollTop = list.scrollHeight;
    }

    function autoSize(elm) { elm.style.height = 'auto'; elm.style.height = Math.min(elm.scrollHeight, 120) + 'px'; }

    // ---- compose ----
    $('chComposeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentChannel) return;
      const input = $('chComposeInput');
      const body = input.value.trim();
      if (!body) return;
      const btn = $('chComposeBtn');
      btn.disabled = true;
      try {
        const r = await fetch('/api/chat/channels/' + currentChannel + '/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ body })
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        input.value = ''; autoSize(input);
        await loadMessages(currentChannel);
      } catch (e2) { alert('Network error'); }
      finally { btn.disabled = false; }
    });
    $('chComposeInput').addEventListener('input', (e) => autoSize(e.target));
    $('chComposeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chComposeForm').requestSubmit(); }
    });
    $('chBack').addEventListener('click', () => { $('chChannelsPane').classList.remove('hide-mobile'); $('chMessagesPane').classList.add('hide-mobile'); });

    // ---- channel list clicks (open + ⋯ menu) ----
    $('chChannelsList').addEventListener('click', (e) => {
      const menuBtn = e.target.closest('[data-menu]');
      if (menuBtn) { e.stopPropagation(); openChannelMenu(parseInt(menuBtn.getAttribute('data-menu'), 10), menuBtn); return; }
      const row = e.target.closest('[data-open]');
      if (row) openChannel(parseInt(row.getAttribute('data-open'), 10));
    });

    // ---- ⋯ group menu ----
    function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
    function openChannelMenu(id, anchor) {
      closeMenu();
      const ch = channels.find(c => c.id === id);
      if (!ch) return;
      const menu = document.createElement('div');
      menu.className = 'ch-popmenu';
      menu.innerHTML =
        '<button data-act="manage">Add / remove people</button>' +
        '<button data-act="rename">Rename group</button>' +
        '<button data-act="archive" class="danger">Archive group</button>';
      const rect = anchor.getBoundingClientRect();
      const paneRect = el.querySelector('.chat-layout').getBoundingClientRect();
      menu.style.top = (rect.bottom - paneRect.top + 4) + 'px';
      menu.style.left = (rect.left - paneRect.left - 130) + 'px';
      el.querySelector('.chat-layout').appendChild(menu);
      openMenuEl = menu;
      menu.addEventListener('click', (ev) => {
        const act = ev.target.getAttribute('data-act');
        if (!act) return;
        closeMenu();
        if (act === 'manage') openManage(ch);
        else if (act === 'rename') renameGroup(ch);
        else if (act === 'archive') archiveGroup(ch);
      });
    }
    function bodyClickAway(e) { if (openMenuEl && !openMenuEl.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu(); }
    document.addEventListener('click', bodyClickAway);

    // ---- users for pickers ----
    async function ensureUsers() {
      if (allUsers.length) return allUsers;
      try {
        const r = await fetch('/api/team/search', { credentials: 'include' });
        if (r.ok) { const d = await r.json(); allUsers = d.users || d.results || d || []; }
      } catch (e) {}
      // Fallback to admin users list if team/search shape differs
      if (!Array.isArray(allUsers) || allUsers.length === 0) {
        try { const r2 = await fetch('/api/admin/users', { credentials: 'include' }); if (r2.ok) { const d2 = await r2.json(); allUsers = (d2.users || []).filter(u => u.employment_status === 'active'); } } catch (e) {}
      }
      return allUsers;
    }

    // ---- create group ----
    async function openCreateGroup() {
      $('chGroupTitle').textContent = 'New group';
      $('chGroupName').value = '';
      $('chGroupErr').classList.remove('on');
      $('chGroupModal').classList.add('on');
      await ensureUsers();
      renderMemberPicker('');
      $('chMemberSearch').value = '';
    }
    function renderMemberPicker(q) {
      const list = $('chMemberList');
      let rows = allUsers;
      if (q) { const s = q.toLowerCase(); rows = rows.filter(u => ((u.full_name || u.display_name || '').toLowerCase().includes(s))); }
      if (!rows.length) { list.innerHTML = '<div style="color:var(--muted);font-size:14px;padding:10px;text-align:center">No match.</div>'; return; }
      const checked = new Set(Array.from(el.querySelectorAll('#chMemberList input:checked')).map(x => x.value));
      list.innerHTML = rows.map(u =>
        '<label><input type="checkbox" value="' + u.id + '" ' + (checked.has(String(u.id)) ? 'checked' : '') + ' style="width:auto" />' +
        '<span class="avatar" style="background:' + (u.avatar_colour || '#F1EFE8') + '">' + escapeHtml(u.initials || '\u00b7') + '</span>' +
        '<span>' + escapeHtml(u.display_name || u.full_name) + '</span></label>'
      ).join('');
      updateMemberCount();
    }
    function updateMemberCount() {
      const n = el.querySelectorAll('#chMemberList input:checked').length;
      $('chMemberCount').textContent = n + ' selected · you\'re added automatically';
    }
    $('chMemberSearch').addEventListener('input', (e) => renderMemberPicker(e.target.value.trim()));
    $('chMemberList').addEventListener('change', updateMemberCount);
    $('chGroupCancel').addEventListener('click', () => $('chGroupModal').classList.remove('on'));
    $('chGroupSave').addEventListener('click', async () => {
      const name = $('chGroupName').value.trim();
      const err = $('chGroupErr');
      err.classList.remove('on');
      if (!name) { err.textContent = 'Give the group a name.'; err.classList.add('on'); return; }
      const ids = Array.from(el.querySelectorAll('#chMemberList input:checked')).map(x => parseInt(x.value, 10));
      const btn = $('chGroupSave'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await fetch('/api/chat/groups', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ name, member_ids: ids })
        });
        const d = await r.json();
        if (!r.ok) { err.textContent = d.error || 'Failed'; err.classList.add('on'); return; }
        $('chGroupModal').classList.remove('on');
        await loadChannels();
        if (d.channel_id) openChannel(d.channel_id);
      } catch (e) { err.textContent = 'Network error'; err.classList.add('on'); }
      finally { btn.disabled = false; btn.textContent = 'Create group'; }
    });

    // ---- rename / archive ----
    async function renameGroup(ch) {
      const name = prompt('Rename group:', ch.name || '');
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const r = await fetch('/api/chat/channels/' + ch.id + '/rename', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ name: trimmed })
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        await loadChannels();
        if (currentChannel === ch.id) $('chChannelName').textContent = trimmed;
      } catch (e) { alert('Network error'); }
    }
    async function archiveGroup(ch) {
      if (!confirm('Archive "' + (ch.name || 'this group') + '"? It will be hidden for everyone in it.')) return;
      try {
        const r = await fetch('/api/chat/channels/' + ch.id + '/archive', { method: 'POST', credentials: 'include' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        if (currentChannel === ch.id) { currentChannel = null; $('chMsgList').innerHTML = '<div class="msg-empty">Pick a channel to see messages.</div>'; $('chChannelName').textContent = 'Select a channel'; $('chChannelSub').textContent = ''; $('chComposeForm').style.display = 'none'; }
        await loadChannels();
      } catch (e) { alert('Network error'); }
    }

    // ---- manage members ----
    let manageGroup = null;
    async function openManage(ch) {
      manageGroup = ch;
      $('chManageTitle').textContent = 'Manage: ' + (ch.name || 'group');
      $('chManageErr').classList.remove('on');
      $('chManageModal').classList.add('on');
      $('chManageSearch').value = '';
      await ensureUsers();
      await loadManageMembers();
      renderManageAdd('');
    }
    async function loadManageMembers() {
      const box = $('chManageMembers');
      box.innerHTML = 'Loading…';
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/members', { credentials: 'include' });
        const d = await r.json();
        const members = d.members || [];
        box.innerHTML = members.map(m =>
          '<div class="mrow"><span style="display:flex;align-items:center;gap:9px"><span class="avatar" style="background:' + (m.avatar_colour || '#F1EFE8') + '">' + escapeHtml(m.initials || '\u00b7') + '</span>' + escapeHtml(m.display_name || m.full_name) + '</span>' +
          '<button class="btn" style="font-size:12px;padding:4px 9px" data-remove="' + m.id + '">Remove</button></div>'
        ).join('');
      } catch (e) { box.innerHTML = '<div style="color:var(--red)">Failed to load members.</div>'; }
    }
    function renderManageAdd(q) {
      const list = $('chManageAddList');
      let rows = allUsers;
      if (q) { const s = q.toLowerCase(); rows = rows.filter(u => ((u.full_name || u.display_name || '').toLowerCase().includes(s))); }
      if (!rows.length) { list.innerHTML = '<div style="color:var(--muted);font-size:14px;padding:10px;text-align:center">No match.</div>'; return; }
      list.innerHTML = rows.map(u =>
        '<label><input type="checkbox" value="' + u.id + '" style="width:auto" />' +
        '<span class="avatar" style="background:' + (u.avatar_colour || '#F1EFE8') + '">' + escapeHtml(u.initials || '\u00b7') + '</span>' +
        '<span>' + escapeHtml(u.display_name || u.full_name) + '</span></label>'
      ).join('');
    }
    $('chManageSearch').addEventListener('input', (e) => renderManageAdd(e.target.value.trim()));
    $('chManageMembers').addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-remove]');
      if (!rm) return;
      const uid = parseInt(rm.getAttribute('data-remove'), 10);
      if (!confirm('Remove this person from the group?')) return;
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/members/' + uid, { method: 'DELETE', credentials: 'include' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        await loadManageMembers();
        await loadChannels();
      } catch (e2) { alert('Network error'); }
    });
    $('chManageAdd').addEventListener('click', async () => {
      const ids = Array.from(el.querySelectorAll('#chManageAddList input:checked')).map(x => parseInt(x.value, 10));
      if (!ids.length) return;
      const err = $('chManageErr'); err.classList.remove('on');
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/members', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ member_ids: ids })
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); err.textContent = d.error || 'Failed'; err.classList.add('on'); return; }
        await loadManageMembers();
        renderManageAdd($('chManageSearch').value.trim());
        await loadChannels();
      } catch (e) { err.textContent = 'Network error'; err.classList.add('on'); }
    });
    $('chManageClose').addEventListener('click', () => $('chManageModal').classList.remove('on'));

    $('chNewGroup').addEventListener('click', openCreateGroup);

    // ---- polling ----
    function startPolling() {
      pollTimer = setInterval(() => {
        if (document.hidden) return;
        if (currentChannel) loadMessages(currentChannel);
        loadChannels();
      }, 5000);
    }

    // ---- init: open deep-linked channel or All Hands ----
    await loadChannels();
    const wanted = ctx && ctx.params && ctx.params.userId ? parseInt(ctx.params.userId, 10) : null;
    if (wanted && channels.find(c => c.id === wanted)) {
      openChannel(wanted);
    } else {
      const ah = channels.find(c => c.type === 'all_hands');
      if (ah) openChannel(ah.id);
    }
    startPolling();

    // expose teardown
    this._teardown = () => {
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener('click', bodyClickAway);
      closeMenu();
    };
  },

  unmount() {
    if (this._teardown) this._teardown();
  }
};
