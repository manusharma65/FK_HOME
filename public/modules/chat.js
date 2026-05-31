// FK Home — Chat module (r0.20.1, Ship D + chat round 2)
// ----------------------------------------------------------------------------
// Two-pane messenger in the shell, plus:
//   - "+ New" → New direct message (pick a person) OR New group
//   - Group management via a VISIBLE button in the message header (not hover):
//       Rename · Add/remove people · Archive · Delete (HR/owner only)
//   - Per-message actions on hover: Reply (quote) · Edit · Unsend (own only)
//   - Reply rendered as a quote above the message
// Server (chat.js): channels, messages(+reply context), send, read, dm/open,
//   groups, members add/remove/list, rename, archive, delete, edit, unsend.
// LIFECYCLE: lookups scoped to el; poll timer + body listener torn down in unmount.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['chat'] = {
  title: 'Team chat',

  render() {
    return '' +
      '<div id="chat-mod" class="fk-mod">' +
        '<style>' +
          '#chat-mod .chat-layout{display:grid;grid-template-columns:264px 1fr;border:0.5px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface);height:calc(100vh - 170px);min-height:420px}' +
          '@media (max-width:768px){#chat-mod .chat-layout{grid-template-columns:1fr}#chat-mod .channels-pane.hide-mobile,#chat-mod .messages-pane.hide-mobile{display:none}}' +
          '#chat-mod .channels-pane{border-right:0.5px solid var(--line);display:flex;flex-direction:column;min-height:0}' +
          '#chat-mod .channels-head{padding:13px 15px;border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between}' +
          '#chat-mod .channels-head h2{font-size:15px;font-weight:600;margin:0}' +
          '#chat-mod .new-btn{font-size:13px;padding:6px 11px;border:0.5px solid var(--line);border-radius:8px;background:var(--ink);color:var(--surface);cursor:pointer;display:inline-flex;align-items:center;gap:5px}' +
          '#chat-mod .channels-list{overflow-y:auto;flex:1}' +
          '#chat-mod .channel-section-label{font-size:11px;color:var(--soft);letter-spacing:0.06em;text-transform:uppercase;padding:12px 16px 4px}' +
          '#chat-mod .ch-row{display:flex;align-items:center;gap:9px;padding:9px 16px;cursor:pointer;border-left:2px solid transparent}' +
          '#chat-mod .ch-row:hover{background:#FBFAF7}' +
          '#chat-mod .ch-row.on{background:var(--amber-soft,#FAEEDA);border-left-color:var(--amber,#EF9F27)}' +
          '#chat-mod .ch-icon{width:24px;height:24px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--ink)}' +
          '#chat-mod .ch-icon.amber{background:var(--amber-soft,#FAEEDA)}' +
          '#chat-mod .ch-info{flex:1;min-width:0}' +
          '#chat-mod .ch-name{font-size:14px;font-weight:500;line-height:1.2}' +
          '#chat-mod .ch-row.unread .ch-name{font-weight:600}' +
          '#chat-mod .ch-preview{font-size:13px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '#chat-mod .ch-unread-badge{background:var(--amber,#EF9F27);color:var(--nav,#14161B);font-size:12px;font-weight:600;border-radius:99px;padding:2px 7px;min-width:18px;text-align:center}' +
          '#chat-mod .messages-pane{display:flex;flex-direction:column;min-height:0;background:var(--bg)}' +
          '#chat-mod .msg-head{padding:11px 18px;border-bottom:0.5px solid var(--line);background:var(--surface);display:flex;align-items:center;gap:10px;flex-shrink:0}' +
          '#chat-mod .msg-head .back-btn{display:none;background:none;border:none;cursor:pointer;padding:4px;color:var(--muted)}' +
          '@media (max-width:768px){#chat-mod .msg-head .back-btn{display:inline-flex}}' +
          '#chat-mod .msg-head h2{font-size:16px;font-weight:500;margin:0}' +
          '#chat-mod .msg-head .sub{font-size:13px;color:var(--muted)}' +
          '#chat-mod .manage-btn{margin-left:auto;border:0.5px solid var(--line);background:var(--surface);border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;display:none;align-items:center;gap:5px;color:var(--ink)}' +
          '#chat-mod .manage-btn.on{display:inline-flex}' +
          '#chat-mod .msg-list{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:8px}' +
          '#chat-mod .msg-group{display:flex;gap:10px;position:relative}' +
          '#chat-mod .msg-group:hover{background:rgba(20,22,27,0.02);border-radius:8px}' +
          '#chat-mod .msg-avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:500;font-size:13px;color:var(--ink);flex-shrink:0}' +
          '#chat-mod .msg-content{flex:1;min-width:0}' +
          '#chat-mod .msg-meta{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}' +
          '#chat-mod .msg-sender{font-size:14px;font-weight:500}' +
          '#chat-mod .msg-time{font-size:12px;color:var(--soft)}' +
          '#chat-mod .msg-edited{font-size:11px;color:var(--soft);font-style:italic}' +
          '#chat-mod .msg-body{font-size:14px;line-height:1.45;color:var(--ink);word-wrap:break-word;white-space:pre-wrap}' +
          '#chat-mod .msg-quote{border-left:3px solid var(--amber,#EF9F27);padding:3px 10px;margin-bottom:4px;background:rgba(239,159,39,0.07);border-radius:0 6px 6px 0;font-size:13px;color:var(--muted)}' +
          '#chat-mod .msg-quote b{color:var(--ink);font-weight:500}' +
          '#chat-mod .msg-actions{position:absolute;top:-8px;right:6px;display:none;gap:2px;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:2px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}' +
          '#chat-mod .msg-group:hover .msg-actions{display:flex}' +
          '#chat-mod .msg-actions button{border:none;background:none;cursor:pointer;font-size:13px;color:var(--muted);padding:4px 7px;border-radius:6px}' +
          '#chat-mod .msg-actions button:hover{background:var(--bg);color:var(--ink)}' +
          '#chat-mod .msg-day-divider{text-align:center;font-size:12px;color:var(--soft);margin:8px 0 4px;letter-spacing:0.04em;text-transform:uppercase}' +
          '#chat-mod .msg-empty{text-align:center;color:var(--muted);font-size:14px;padding:32px 16px}' +
          '#chat-mod .reply-banner{display:none;align-items:center;justify-content:space-between;gap:10px;padding:7px 14px;background:var(--amber-soft,#FAEEDA);border-top:0.5px solid var(--line);font-size:13px;color:var(--ink)}' +
          '#chat-mod .reply-banner.on{display:flex}' +
          '#chat-mod .reply-banner button{border:none;background:none;cursor:pointer;color:var(--muted);font-size:15px}' +
          '#chat-mod .compose{border-top:0.5px solid var(--line);padding:12px 14px;background:var(--surface);display:flex;gap:10px;align-items:flex-end;flex-shrink:0}' +
          '#chat-mod .compose textarea{flex:1;resize:none;border:0.5px solid var(--line);border-radius:12px;padding:10px 14px;font-size:14px;outline:none;background:var(--surface);color:var(--ink);max-height:120px;min-height:40px;line-height:1.4}' +
          '#chat-mod .compose textarea:focus{border-color:var(--amber,#EF9F27)}' +
          '#chat-mod .compose button{background:var(--nav,#14161B);color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:14px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px}' +
          '#chat-mod .compose button:disabled{opacity:0.5;cursor:not-allowed}' +
          '#chat-mod .popmenu{position:absolute;z-index:30;background:var(--surface);border:0.5px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:5px;min-width:200px}' +
          '#chat-mod .popmenu button{display:block;width:100%;text-align:left;border:none;background:none;padding:9px 12px;font-size:14px;color:var(--ink);cursor:pointer;border-radius:7px}' +
          '#chat-mod .popmenu button:hover{background:var(--bg)}' +
          '#chat-mod .popmenu button.danger{color:var(--red,#A32D2D)}' +
          '#chat-mod .member-list{display:flex;flex-direction:column;gap:2px;border:0.5px solid var(--line);border-radius:8px;padding:6px;max-height:200px;overflow:auto}' +
          '#chat-mod .member-list label{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:6px;font-size:14px;cursor:pointer;margin:0}' +
          '#chat-mod .member-list label:hover{background:var(--bg)}' +
          '#chat-mod .avatar{width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#3a3a36}' +
          '#chat-mod .mrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border-radius:6px;font-size:14px}' +
          '#chat-mod .modal-err{display:none;color:var(--red,#A32D2D);font-size:14px;margin:6px 0}' +
          '#chat-mod .modal-err.on{display:block}' +
        '</style>' +

        '<div class="chat-layout">' +
          '<aside class="channels-pane" id="chChannelsPane">' +
            '<div class="channels-head"><h2>Channels</h2><button class="new-btn" id="chNew"><i class="ti ti-plus"></i> New</button></div>' +
            '<div style="padding:8px 12px;border-bottom:0.5px solid var(--line)"><input type="text" id="chSearch" placeholder="Search messages…" style="width:100%;padding:7px 10px;border:0.5px solid var(--line);border-radius:8px;font-size:13px;background:var(--bg);color:var(--ink);outline:none" /></div>' +
            '<div id="chSearchResults" style="display:none;overflow-y:auto;flex:1"></div>' +
            '<div id="chChannelsList" class="channels-list"><div class="msg-empty" style="padding:24px 16px">Loading…</div></div>' +
          '</aside>' +
          '<main class="messages-pane hide-mobile" id="chMessagesPane">' +
            '<div class="msg-head">' +
              '<button class="back-btn" id="chBack"><i class="ti ti-arrow-left"></i></button>' +
              '<div><h2 id="chChannelName">Select a channel</h2><div class="sub" id="chChannelSub"></div></div>' +
              '<button class="manage-btn" id="chManageBtn"><i class="ti ti-settings"></i> Manage</button>' +
            '</div>' +
            '<div id="chMsgList" class="msg-list"><div class="msg-empty">Pick a channel to see messages.</div></div>' +
            '<div class="reply-banner" id="chReplyBanner"><span id="chReplyText"></span><button id="chReplyCancel">\u2715</button></div>' +
            '<form id="chComposeForm" class="compose" style="display:none">' +
              '<textarea id="chComposeInput" placeholder="Type a message…" rows="1"></textarea>' +
              '<button type="submit" id="chComposeBtn"><i class="ti ti-send"></i> Send</button>' +
            '</form>' +
          '</main>' +
        '</div>' +

        // New: choose DM or group
        '<div class="modal-bg" id="chNewModal">' +
          '<div class="modal">' +
            '<h2>Start something new</h2>' +
            '<p class="modal-sub">Message one person, or create a group.</p>' +
            '<div style="display:flex;gap:10px;margin-top:8px">' +
              '<button class="btn" id="chNewDm" style="flex:1;padding:16px;flex-direction:column;display:flex;gap:6px;align-items:center"><i class="ti ti-user" style="font-size:20px"></i>Direct message</button>' +
              '<button class="btn" id="chNewGroupBtn" style="flex:1;padding:16px;flex-direction:column;display:flex;gap:6px;align-items:center"><i class="ti ti-users-group" style="font-size:20px"></i>New group</button>' +
            '</div>' +
            '<div class="modal-actions"><button class="btn" id="chNewCancel">Cancel</button></div>' +
          '</div>' +
        '</div>' +

        // DM picker
        '<div class="modal-bg" id="chDmModal">' +
          '<div class="modal">' +
            '<h2>New direct message</h2>' +
            '<input type="text" id="chDmSearch" placeholder="Search people…" />' +
            '<div class="member-list" id="chDmList" style="margin-top:8px">Loading…</div>' +
            '<div class="modal-actions"><button class="btn" id="chDmCancel">Cancel</button></div>' +
          '</div>' +
        '</div>' +

        // Create group
        '<div class="modal-bg" id="chGroupModal">' +
          '<div class="modal">' +
            '<h2>New group</h2>' +
            '<p class="modal-sub">Create a named group and add members. Anyone you add can post.</p>' +
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

        // Manage group
        '<div class="modal-bg" id="chManageModal">' +
          '<div class="modal">' +
            '<h2 id="chManageTitle">Manage group</h2>' +
            '<div class="modal-err" id="chManageErr"></div>' +
            '<div style="display:flex;gap:8px;margin-bottom:14px">' +
              '<button class="btn" id="chMgRename">Rename</button>' +
              '<button class="btn" id="chMgArchive">Archive</button>' +
              '<button class="btn" id="chMgLeave">Leave group</button>' +
              '<button class="btn btn-danger" id="chMgDelete" style="display:none">Delete group</button>' +
            '</div>' +
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

        // Edit message
        '<div class="modal-bg" id="chEditModal">' +
          '<div class="modal">' +
            '<h2>Edit message</h2>' +
            '<textarea id="chEditInput" rows="3" style="width:100%;font-family:inherit;font-size:14px;padding:10px;border:0.5px solid var(--line);border-radius:8px;resize:vertical"></textarea>' +
            '<div class="modal-actions"><button class="btn" id="chEditCancel">Cancel</button><button class="btn btn-primary" id="chEditSave">Save</button></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el, ctx) {
    const $ = (id) => el.querySelector('#' + id);
    function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    let channels = [];
    let currentChannel = null;
    let currentChannelObj = null;
    let pollTimer = null;
    let allUsers = [];
    let openMenuEl = null;
    let me = null;
    let canDelete = false;
    let replyTo = null;      // { id, preview }
    let editId = null;

    // who am I + can I delete groups (HR/owner)?
    try { const r = await fetch('/api/auth/me', { credentials: 'include' }); if (r.ok) { me = await r.json(); const perms = me.permissions || []; canDelete = perms.includes('profile.view.any') || perms.includes('*'); } } catch (e) {}

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
      if (channels.length === 0) { list.innerHTML = '<div class="msg-empty" style="padding:24px 16px">No channels yet. Hit + New to start.</div>'; return; }
      const g = {
        all_hands: channels.filter(c => c.type === 'all_hands'),
        department: channels.filter(c => c.type === 'department'),
        group: channels.filter(c => c.type === 'group'),
        dm: channels.filter(c => c.type === 'dm'),
      };
      let html = '';
      if (g.all_hands.length) html += '<div class="channel-section-label">Company</div>' + g.all_hands.map(channelRow).join('');
      if (g.department.length) html += '<div class="channel-section-label">Departments</div>' + g.department.map(channelRow).join('');
      if (g.group.length) html += '<div class="channel-section-label">Groups</div>' + g.group.map(channelRow).join('');
      if (g.dm.length) html += '<div class="channel-section-label">Direct messages</div>' + g.dm.map(channelRow).join('');
      list.innerHTML = html;
    }

    function channelRow(c) {
      const isOn = currentChannel === c.id;
      const unread = c.unread_count > 0;
      const icon = c.type === 'all_hands' ? '<i class="ti ti-broadcast"></i>'
        : c.type === 'department' ? '<i class="ti ' + (c.department_icon || 'ti-users') + '"></i>'
        : c.type === 'group' ? '<i class="ti ti-users-group"></i>'
        : c.type === 'dm' ? ((c.other_user && c.other_user.initials) || '\u00b7') : '#';
      const iconStyle = c.type === 'department' && c.department_colour ? 'background:' + c.department_colour + ';color:#fff'
        : c.type === 'dm' && c.other_user && c.other_user.avatar_colour ? 'background:' + c.other_user.avatar_colour : '';
      const preview = c.last_message ? escapeHtml(c.last_message.sender_name || 'someone') + ': ' + escapeHtml((c.last_message.body || '').slice(0, 50)) : 'No messages yet';
      return '<div class="ch-row ' + (isOn ? 'on' : '') + ' ' + (unread ? 'unread' : '') + '" data-open="' + c.id + '">' +
        '<div class="ch-icon ' + (c.type === 'all_hands' ? 'amber' : c.type === 'department' ? 'dept' : '') + '" style="' + iconStyle + '">' + icon + '</div>' +
        '<div class="ch-info"><div class="ch-name">' + escapeHtml(c.name || 'Channel') + '</div><div class="ch-preview">' + preview + '</div></div>' +
        (unread ? '<div class="ch-unread-badge">' + (c.unread_count > 99 ? '99+' : c.unread_count) + '</div>' : '') +
        '</div>';
    }

    async function openChannel(id) {
      currentChannel = id;
      renderChannels();
      const ch = channels.find(c => c.id === id);
      currentChannelObj = ch;
      if (!ch) return;
      $('chChannelName').textContent = ch.name || 'Channel';
      $('chChannelSub').textContent = ch.type === 'all_hands' ? 'Everyone is in this channel'
        : ch.type === 'department' ? (ch.department_name + ' team')
        : ch.type === 'group' ? 'Group' : ch.type === 'dm' ? 'Direct message' : '';
      $('chComposeForm').style.display = '';
      $('chManageBtn').classList.toggle('on', ch.type === 'group');
      clearReply();
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
      let html = '', lastDay = null;
      for (const m of messages) {
        const day = new Date(m.created_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
        if (day !== lastDay) { html += '<div class="msg-day-divider">' + day + '</div>'; lastDay = day; }
        const mine = me && m.sender_id === me.id;
        const quote = m.reply_to_id && m.reply_body != null
          ? '<div class="msg-quote"><b>' + escapeHtml(m.reply_sender_name || 'someone') + '</b>: ' + escapeHtml((m.reply_body || '').slice(0, 90)) + '</div>' : '';
        const edited = m.edited_at ? ' <span class="msg-edited">(edited)</span>' : '';
        const actions = '<div class="msg-actions">' +
          '<button data-reply="' + m.id + '" title="Reply"><i class="ti ti-arrow-back-up"></i></button>' +
          (mine ? '<button data-edit="' + m.id + '" title="Edit"><i class="ti ti-pencil"></i></button><button data-unsend="' + m.id + '" title="Unsend"><i class="ti ti-trash"></i></button>' : '') +
          '</div>';
        html += '<div class="msg-group" data-mid="' + m.id + '">' +
          '<div class="msg-avatar" style="background:' + (m.sender_avatar_colour || '#FAEEDA') + '">' + escapeHtml(m.sender_initials || '\u00b7') + '</div>' +
          '<div class="msg-content"><div class="msg-meta"><span class="msg-sender">' + escapeHtml(m.sender_name || m.sender_full_name) + '</span><span class="msg-time">' + new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</span>' + edited + '</div>' + quote + '<div class="msg-body">' + escapeHtml(m.body) + '</div></div>' +
          actions + '</div>';
      }
      list.innerHTML = html;
      list.scrollTop = list.scrollHeight;
    }

    function autoSize(elm) { elm.style.height = 'auto'; elm.style.height = Math.min(elm.scrollHeight, 120) + 'px'; }

    // ---- reply ----
    function setReply(mid) {
      const grp = el.querySelector('.msg-group[data-mid="' + mid + '"]');
      const sender = grp ? grp.querySelector('.msg-sender').textContent : 'message';
      const body = grp ? grp.querySelector('.msg-body').textContent : '';
      replyTo = { id: mid, preview: body.slice(0, 60) };
      $('chReplyText').innerHTML = 'Replying to <b>' + escapeHtml(sender) + '</b>: ' + escapeHtml(body.slice(0, 50));
      $('chReplyBanner').classList.add('on');
      $('chComposeInput').focus();
    }
    function clearReply() { replyTo = null; $('chReplyBanner').classList.remove('on'); }
    $('chReplyCancel').addEventListener('click', clearReply);

    // ---- compose ----
    $('chComposeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentChannel) return;
      const input = $('chComposeInput');
      const body = input.value.trim();
      if (!body) return;
      const btn = $('chComposeBtn'); btn.disabled = true;
      try {
        const payload = { body };
        if (replyTo) payload.reply_to_id = replyTo.id;
        const r = await fetch('/api/chat/channels/' + currentChannel + '/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(payload)
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        input.value = ''; autoSize(input); clearReply();
        await loadMessages(currentChannel);
      } catch (e2) { alert('Network error'); }
      finally { btn.disabled = false; }
    });
    $('chComposeInput').addEventListener('input', (e) => autoSize(e.target));
    $('chComposeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chComposeForm').requestSubmit(); } });
    $('chBack').addEventListener('click', () => { $('chChannelsPane').classList.remove('hide-mobile'); $('chMessagesPane').classList.add('hide-mobile'); });

    // ---- message actions (reply/edit/unsend) ----
    $('chMsgList').addEventListener('click', (e) => {
      const rep = e.target.closest('[data-reply]'); if (rep) { setReply(parseInt(rep.getAttribute('data-reply'), 10)); return; }
      const ed = e.target.closest('[data-edit]'); if (ed) { openEdit(parseInt(ed.getAttribute('data-edit'), 10)); return; }
      const un = e.target.closest('[data-unsend]'); if (un) { unsend(parseInt(un.getAttribute('data-unsend'), 10)); return; }
    });
    function openEdit(mid) {
      const grp = el.querySelector('.msg-group[data-mid="' + mid + '"]');
      editId = mid;
      $('chEditInput').value = grp ? grp.querySelector('.msg-body').textContent : '';
      $('chEditModal').classList.add('on');
    }
    $('chEditCancel').addEventListener('click', () => $('chEditModal').classList.remove('on'));
    $('chEditSave').addEventListener('click', async () => {
      const body = $('chEditInput').value.trim();
      if (!body) return;
      try {
        const r = await fetch('/api/chat/messages/' + editId + '/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ body }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        $('chEditModal').classList.remove('on');
        await loadMessages(currentChannel);
      } catch (e) { alert('Network error'); }
    });
    async function unsend(mid) {
      if (!confirm('Unsend this message? It will be removed for everyone.')) return;
      try {
        const r = await fetch('/api/chat/messages/' + mid + '/unsend', { method: 'POST', credentials: 'include' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        await loadMessages(currentChannel);
      } catch (e) { alert('Network error'); }
    }

    // ---- users ----
    async function ensureUsers() {
      if (allUsers.length) return allUsers;
      try { const r = await fetch('/api/team/search', { credentials: 'include' }); if (r.ok) { const d = await r.json(); allUsers = (d.people || []).map(u => ({ id: u.id, name: u.name, initials: u.initials, avatar_colour: u.avatar_colour })); } } catch (e) {}
      if (!allUsers.length) { try { const r2 = await fetch('/api/admin/users', { credentials: 'include' }); if (r2.ok) { const d2 = await r2.json(); allUsers = (d2.users || []).filter(u => u.employment_status === 'active').map(u => ({ id: u.id, name: u.display_name || u.full_name, initials: u.initials, avatar_colour: u.avatar_colour })); } } catch (e) {} }
      return allUsers;
    }
    function pickerRows(listId, q, multi) {
      const list = $(listId);
      let rows = allUsers;
      if (q) { const s = q.toLowerCase(); rows = rows.filter(u => (u.name || '').toLowerCase().includes(s)); }
      if (!rows.length) { list.innerHTML = '<div style="color:var(--muted);font-size:14px;padding:10px;text-align:center">No match.</div>'; return; }
      const checked = new Set(Array.from(el.querySelectorAll('#' + listId + ' input:checked')).map(x => x.value));
      list.innerHTML = rows.map(u =>
        '<label>' + (multi ? '<input type="checkbox" value="' + u.id + '" ' + (checked.has(String(u.id)) ? 'checked' : '') + ' style="width:auto" />' : '<input type="radio" name="' + listId + 'r" value="' + u.id + '" style="width:auto" />') +
        '<span class="avatar" style="background:' + (u.avatar_colour || '#F1EFE8') + '">' + escapeHtml(u.initials || '\u00b7') + '</span><span>' + escapeHtml(u.name) + '</span></label>'
      ).join('');
    }

    // ---- New entry ----
    $('chNew').addEventListener('click', () => $('chNewModal').classList.add('on'));
    $('chNewCancel').addEventListener('click', () => $('chNewModal').classList.remove('on'));
    $('chNewDm').addEventListener('click', async () => { $('chNewModal').classList.remove('on'); await ensureUsers(); pickerRows('chDmList', '', false); $('chDmSearch').value = ''; $('chDmModal').classList.add('on'); });
    $('chNewGroupBtn').addEventListener('click', async () => { $('chNewModal').classList.remove('on'); openCreateGroup(); });
    $('chDmCancel').addEventListener('click', () => $('chDmModal').classList.remove('on'));
    $('chDmSearch').addEventListener('input', (e) => pickerRows('chDmList', e.target.value.trim(), false));
    $('chDmList').addEventListener('change', async (e) => {
      const uid = parseInt(e.target.value, 10);
      if (!uid) return;
      try {
        const r = await fetch('/api/chat/dm/' + uid + '/open', { method: 'POST', credentials: 'include' });
        const d = await r.json();
        if (!r.ok) { alert(d.error || 'Failed'); return; }
        $('chDmModal').classList.remove('on');
        await loadChannels();
        if (d.channel_id) openChannel(d.channel_id);
      } catch (e2) { alert('Network error'); }
    });

    // ---- create group ----
    async function openCreateGroup() {
      $('chGroupName').value = ''; $('chGroupErr').classList.remove('on'); $('chGroupModal').classList.add('on');
      await ensureUsers(); pickerRows('chMemberList', '', true); $('chMemberSearch').value = ''; updateMemberCount();
    }
    function updateMemberCount() { $('chMemberCount').textContent = el.querySelectorAll('#chMemberList input:checked').length + ' selected · you\'re added automatically'; }
    $('chMemberSearch').addEventListener('input', (e) => { pickerRows('chMemberList', e.target.value.trim(), true); updateMemberCount(); });
    $('chMemberList').addEventListener('change', updateMemberCount);
    $('chGroupCancel').addEventListener('click', () => $('chGroupModal').classList.remove('on'));
    $('chGroupSave').addEventListener('click', async () => {
      const name = $('chGroupName').value.trim();
      const err = $('chGroupErr'); err.classList.remove('on');
      if (!name) { err.textContent = 'Give the group a name.'; err.classList.add('on'); return; }
      const ids = Array.from(el.querySelectorAll('#chMemberList input:checked')).map(x => parseInt(x.value, 10));
      const btn = $('chGroupSave'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await fetch('/api/chat/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, member_ids: ids }) });
        const d = await r.json();
        if (!r.ok) { err.textContent = d.error || 'Failed'; err.classList.add('on'); return; }
        $('chGroupModal').classList.remove('on');
        await loadChannels();
        if (d.channel_id) openChannel(d.channel_id);
      } catch (e) { err.textContent = 'Network error'; err.classList.add('on'); }
      finally { btn.disabled = false; btn.textContent = 'Create group'; }
    });

    // ---- manage group (visible button in header) ----
    $('chManageBtn').addEventListener('click', () => { if (currentChannelObj && currentChannelObj.type === 'group') openManage(currentChannelObj); });
    let manageGroup = null;
    async function openManage(ch) {
      manageGroup = ch;
      $('chManageTitle').textContent = 'Manage: ' + (ch.name || 'group');
      $('chManageErr').classList.remove('on');
      $('chMgDelete').style.display = canDelete ? '' : 'none';
      $('chManageModal').classList.add('on');
      $('chManageSearch').value = '';
      await ensureUsers();
      await loadManageMembers();
      pickerRows('chManageAddList', '', true);
    }
    async function loadManageMembers() {
      const box = $('chManageMembers'); box.innerHTML = 'Loading…';
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/members', { credentials: 'include' });
        const d = await r.json();
        box.innerHTML = (d.members || []).map(m =>
          '<div class="mrow"><span style="display:flex;align-items:center;gap:9px"><span class="avatar" style="background:' + (m.avatar_colour || '#F1EFE8') + '">' + escapeHtml(m.initials || '\u00b7') + '</span>' + escapeHtml(m.display_name || m.full_name) + '</span><button class="btn" style="font-size:12px;padding:4px 9px" data-remove="' + m.id + '">Remove</button></div>'
        ).join('');
      } catch (e) { box.innerHTML = '<div style="color:var(--red)">Failed to load.</div>'; }
    }
    $('chManageSearch').addEventListener('input', (e) => pickerRows('chManageAddList', e.target.value.trim(), true));
    $('chManageMembers').addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-remove]'); if (!rm) return;
      if (!confirm('Remove this person from the group?')) return;
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/members/' + parseInt(rm.getAttribute('data-remove'), 10), { method: 'DELETE', credentials: 'include' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        await loadManageMembers(); await loadChannels();
      } catch (e2) { alert('Network error'); }
    });
    $('chManageAdd').addEventListener('click', async () => {
      const ids = Array.from(el.querySelectorAll('#chManageAddList input:checked')).map(x => parseInt(x.value, 10));
      if (!ids.length) return;
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ member_ids: ids }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); $('chManageErr').textContent = d.error || 'Failed'; $('chManageErr').classList.add('on'); return; }
        await loadManageMembers(); pickerRows('chManageAddList', $('chManageSearch').value.trim(), true); await loadChannels();
      } catch (e) { $('chManageErr').textContent = 'Network error'; $('chManageErr').classList.add('on'); }
    });
    $('chManageClose').addEventListener('click', () => $('chManageModal').classList.remove('on'));
    $('chMgLeave').addEventListener('click', async () => {
      if (!confirm('Leave "' + (manageGroup.name || 'this group') + '"? You\'ll stop receiving its messages.')) return;
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/leave', { method: 'POST', credentials: 'include' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        $('chManageModal').classList.remove('on'); resetToEmpty(); await loadChannels();
      } catch (e) { alert('Network error'); }
    });
    $('chMgRename').addEventListener('click', async () => {
      const name = prompt('Rename group:', manageGroup.name || ''); if (name == null) return;
      const t = name.trim(); if (!t) return;
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: t }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        manageGroup.name = t; $('chManageTitle').textContent = 'Manage: ' + t;
        if (currentChannel === manageGroup.id) $('chChannelName').textContent = t;
        await loadChannels();
      } catch (e) { alert('Network error'); }
    });
    $('chMgArchive').addEventListener('click', async () => {
      if (!confirm('Archive "' + (manageGroup.name || 'this group') + '"? It will be hidden for everyone in it.')) return;
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/archive', { method: 'POST', credentials: 'include' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        $('chManageModal').classList.remove('on'); resetToEmpty(); await loadChannels();
      } catch (e) { alert('Network error'); }
    });
    $('chMgDelete').addEventListener('click', async () => {
      if (!confirm('PERMANENTLY DELETE "' + (manageGroup.name || 'this group') + '" and all its messages?\n\nThis cannot be undone.')) return;
      try {
        const r = await fetch('/api/chat/channels/' + manageGroup.id + '/delete', { method: 'POST', credentials: 'include' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        $('chManageModal').classList.remove('on'); resetToEmpty(); await loadChannels();
      } catch (e) { alert('Network error'); }
    });

    function resetToEmpty() {
      currentChannel = null; currentChannelObj = null;
      $('chMsgList').innerHTML = '<div class="msg-empty">Pick a channel to see messages.</div>';
      $('chChannelName').textContent = 'Select a channel'; $('chChannelSub').textContent = '';
      $('chComposeForm').style.display = 'none'; $('chManageBtn').classList.remove('on');
    }

    // ---- channel open ----
    $('chChannelsList').addEventListener('click', (e) => { const row = e.target.closest('[data-open]'); if (row) openChannel(parseInt(row.getAttribute('data-open'), 10)); });

    // ---- message search ----
    let searchTimer = null;
    $('chSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchTimer);
      if (q.length < 2) { $('chSearchResults').style.display = 'none'; $('chChannelsList').style.display = ''; return; }
      searchTimer = setTimeout(() => runSearch(q), 250);
    });
    async function runSearch(q) {
      const panel = $('chSearchResults');
      panel.style.display = ''; $('chChannelsList').style.display = 'none';
      panel.innerHTML = '<div class="msg-empty" style="padding:18px 16px">Searching…</div>';
      try {
        const r = await fetch('/api/chat/search?q=' + encodeURIComponent(q), { credentials: 'include' });
        const d = await r.json();
        const rows = d.results || [];
        if (!rows.length) { panel.innerHTML = '<div class="msg-empty" style="padding:18px 16px">No messages found.</div>'; return; }
        panel.innerHTML = rows.map(m =>
          '<div class="ch-row" data-search-open="' + m.channel_id + '" style="flex-direction:column;align-items:flex-start;gap:2px">' +
          '<div style="font-size:12px;color:var(--soft)">' + escapeHtml(m.channel_label) + ' · ' + escapeHtml(m.sender_name) + '</div>' +
          '<div style="font-size:14px;color:var(--ink)">' + escapeHtml(m.body.slice(0, 80)) + '</div></div>'
        ).join('');
      } catch (e) { panel.innerHTML = '<div class="msg-empty" style="padding:18px 16px">Search failed.</div>'; }
    }
    $('chSearchResults').addEventListener('click', (e) => {
      const row = e.target.closest('[data-search-open]');
      if (!row) return;
      $('chSearch').value = ''; $('chSearchResults').style.display = 'none'; $('chChannelsList').style.display = '';
      openChannel(parseInt(row.getAttribute('data-search-open'), 10));
    });

    function startPolling() {
      pollTimer = setInterval(() => { if (document.hidden) return; if (currentChannel) loadMessages(currentChannel); loadChannels(); }, 5000);
    }

    await loadChannels();
    const wanted = ctx && ctx.params && ctx.params.userId ? parseInt(ctx.params.userId, 10) : null;
    if (wanted && channels.find(c => c.id === wanted)) openChannel(wanted);
    else { const ah = channels.find(c => c.type === 'all_hands'); if (ah) openChannel(ah.id); }
    startPolling();

    this._teardown = () => { if (pollTimer) clearInterval(pollTimer); };
  },

  unmount() { if (this._teardown) this._teardown(); }
};
