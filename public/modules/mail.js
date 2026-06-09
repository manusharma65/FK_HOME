// FK Home — Mail module (r0.84, personal inbox: card list, bulk actions, reply + forward)
// ----------------------------------------------------------------------------
// Card-styled inbox matching the approved mock, plus the everyday Gmail
// functions: select-all, bulk archive, bulk delete (to Trash), reply, forward.
// Reads the logged-in person's own Gmail via the proven engine.
// AI summary/draft, pinned notes, labels, snooze and the shared CS mode are the
// next layers — the look and the daily functions are here now.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['mail'] = {
  title: 'My Mail',
  noHero: true,

  render() {
    return `
<div id="mail-mod" class="fk-mod">
  <style>
    #mail-mod{display:flex;flex-direction:column;height:calc(100vh - 92px);min-height:520px;
      font-family:var(--body,'Hanken Grotesk',-apple-system,sans-serif);color:#2B2017}
    #mail-mod h2{font-family:var(--body,'Hanken Grotesk',sans-serif)!important;letter-spacing:-.01em}
    #mail-mod .msplit{flex:1;min-height:0;display:grid;grid-template-columns:404px 1fr;
      border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}
    #mail-mod .mlist{border-right:1px solid var(--line);overflow:auto;background:var(--canvas,#F4EFE7)}
    #mail-mod .mlhead{padding:16px 18px 6px;position:sticky;top:0;background:var(--canvas,#F4EFE7);z-index:3}
    #mail-mod .mlhead h2{font-size:23px;font-weight:700;margin:0}
    #mail-mod .mlhead .sub{font-size:13.5px;color:var(--muted);margin-top:2px}
    #mail-mod .mbar{display:flex;align-items:center;gap:10px;padding:8px 18px 10px;position:sticky;top:64px;background:var(--canvas,#F4EFE7);z-index:3}
    #mail-mod .selall{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--muted);cursor:pointer;user-select:none}
    #mail-mod .selall input{width:17px;height:17px;accent-color:var(--orange,#E8722B);cursor:pointer}
    #mail-mod .barbtns{margin-left:auto;display:none;gap:8px}
    #mail-mod .barbtns.show{display:flex}
    #mail-mod .bb{font-family:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:#5b5249;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
    #mail-mod .bb:hover{background:#fff}
    #mail-mod .bb.danger:hover{background:#FBECEC;color:#A32D2D;border-color:#E9C9C9}
    #mail-mod .scroll{padding:2px 12px 16px}
    #mail-mod .mrow{display:flex;gap:11px;background:var(--surface,#fff);border:1px solid #EFE7D8;border-radius:14px;
      padding:13px 14px;margin-bottom:10px;cursor:pointer;box-shadow:0 1px 2px rgba(58,40,24,.05),0 4px 14px rgba(58,40,24,.05);
      transition:box-shadow .12s,transform .12s}
    #mail-mod .mrow:hover{transform:translateY(-1px);box-shadow:0 2px 8px rgba(58,40,24,.08),0 16px 36px rgba(58,40,24,.10)}
    #mail-mod .mrow.on{box-shadow:0 0 0 2px var(--orange,#E8722B),0 16px 36px rgba(58,40,24,.10)}
    #mail-mod .mrow.sel{background:#FFF7F0;border-color:#F0CDB4}
    #mail-mod .mcheck{width:18px;height:18px;margin-top:3px;accent-color:var(--orange,#E8722B);cursor:pointer;flex:none}
    #mail-mod .mc{min-width:0;flex:1}
    #mail-mod .mr1{display:flex;align-items:center;gap:8px}
    #mail-mod .mr1 .un{width:8px;height:8px;border-radius:50%;background:var(--orange,#E8722B);flex:none}
    #mail-mod .mr1 .who{font-size:16px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .mrow.unread .who{font-weight:700}
    #mail-mod .mr1 .tm{font-size:12px;color:var(--soft,#988f82);flex:none}
    #mail-mod .msub{font-size:14.5px;font-weight:500;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .msnip{font-size:13px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .mread{overflow:auto;display:flex;flex-direction:column}
    #mail-mod .mr-empty{margin:auto;color:var(--muted);font-size:15px;text-align:center;padding:40px}
    #mail-mod .mr-pad{padding:22px 26px 8px}
    #mail-mod .mr-top{display:flex;align-items:flex-start;gap:14px}
    #mail-mod .mr-h{font-size:23px;font-weight:700;line-height:1.25;letter-spacing:-.01em;flex:1}
    #mail-mod .mr-acts{display:flex;gap:7px;flex:none}
    #mail-mod .ib{width:38px;height:38px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:#6A5C4E;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer}
    #mail-mod .ib:hover{background:#fff}
    #mail-mod .ib.danger:hover{background:#FBECEC;color:#A32D2D;border-color:#E9C9C9}
    #mail-mod .mr-from{display:flex;align-items:center;gap:12px;margin-top:16px}
    #mail-mod .mr-av{width:44px;height:44px;border-radius:50%;background:#EFE0D2;color:#9A4A2B;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:none}
    #mail-mod .mr-nm{font-size:15px;font-weight:600}
    #mail-mod .mr-em{font-size:12.5px;color:var(--muted)}
    #mail-mod .mr-when{margin-left:auto;font-size:12.5px;color:var(--soft,#988f82)}
    #mail-mod .mr-body{font-size:15px;line-height:1.72;margin:18px 0 6px;white-space:pre-wrap;word-wrap:break-word;max-width:760px}
    #mail-mod .mr-body.html{white-space:normal}
    #mail-mod .mr-body.html img{max-width:100%;height:auto}
    #mail-mod .composer{margin:16px 26px 26px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface);display:none}
    #mail-mod .composer.show{display:block}
    #mail-mod .cm-top{padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted);background:var(--canvas,#F4EFE7);display:flex;align-items:center;gap:8px}
    #mail-mod .cm-top b{color:#2B2017;font-weight:600}
    #mail-mod .cm-to{flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-family:inherit;font-size:13.5px;outline:none;display:none}
    #mail-mod .cm-to.show{display:block}
    #mail-mod .cm-body{width:100%;border:none;outline:none;resize:vertical;min-height:130px;padding:14px 16px;font-family:inherit;font-size:15px;line-height:1.6;background:var(--surface);color:inherit}
    #mail-mod .cm-foot{display:flex;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid var(--line);background:var(--canvas,#F4EFE7)}
    #mail-mod .cm-note{margin-right:auto;font-size:12.5px;color:var(--soft,#988f82)}
    #mail-mod .btn{font-family:inherit;font-size:14.5px;font-weight:700;padding:10px 18px;border:none;border-radius:10px;cursor:pointer}
    #mail-mod .btn-ghost{background:var(--surface);border:1px solid var(--line);color:#5b5249}
    #mail-mod .btn-send{background:var(--orange,#E8722B);color:#fff;display:inline-flex;align-items:center;gap:7px}
    #mail-mod .btn-send:disabled{opacity:.5;cursor:default}
    #mail-mod .loading,#mail-mod .errbox{padding:30px;color:var(--muted);font-size:14.5px}
    #mail-mod .errbox{color:#A32D2D}
    #mail-mod .toast{position:absolute;left:50%;transform:translateX(-50%);bottom:18px;background:#2B2017;color:#fff;font-size:13.5px;padding:10px 16px;border-radius:10px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}
    #mail-mod .toast.show{opacity:1}
    @media(max-width:880px){#mail-mod .msplit{grid-template-columns:1fr}#mail-mod .mread{display:none}#mail-mod.reading .mlist{display:none}#mail-mod.reading .mread{display:flex}}
  </style>
  <div class="msplit" style="position:relative">
    <aside class="mlist">
      <div class="mlhead"><h2>Inbox</h2><div class="sub" id="mailSub">Loading…</div></div>
      <div class="mbar">
        <label class="selall"><input type="checkbox" id="selAll"> Select all</label>
        <div class="barbtns" id="barBtns">
          <button class="bb" id="bArchive"><i class="ti ti-archive" style="font-size:15px"></i> Archive</button>
          <button class="bb danger" id="bTrash"><i class="ti ti-trash" style="font-size:15px"></i> Delete</button>
        </div>
      </div>
      <div class="scroll" id="mailRows"><div class="loading">Loading your mail…</div></div>
    </aside>
    <section class="mread" id="mailRead"><div class="mr-empty">Select a message to read it here.</div></section>
    <div class="toast" id="mailToast"></div>
  </div>
</div>`;
  },

  async mount(root) {
    const rowsEl = root.querySelector('#mailRows'), subEl = root.querySelector('#mailSub');
    const readEl = root.querySelector('#mailRead'), modEl = root.querySelector('#mail-mod');
    const selAll = root.querySelector('#selAll'), barBtns = root.querySelector('#barBtns'), toastEl = root.querySelector('#mailToast');
    let messages = [], selectedId = null, sel = new Set();

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const parseFrom = (from) => {
      const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
      if (m) return { name: m[1].trim() || m[2], email: m[2].trim() };
      return { name: from || '', email: (from || '').trim() };
    };
    const shortDate = (d) => { try { return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d || ''; } };
    const toast = (msg) => { toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), 2200); };

    async function loadInbox() {
      try {
        const r = await fetch('/api/mail/inbox', { credentials: 'include' });
        if (!r.ok) throw new Error('Could not load your mailbox (' + r.status + ').');
        const data = await r.json();
        messages = data.messages || []; sel.clear(); selAll.checked = false;
        subEl.textContent = data.mailbox + ' · ' + messages.length + ' message' + (messages.length === 1 ? '' : 's');
        renderRows(); updateBar();
        if (messages.length) openMessage(messages[0].id); else readEl.innerHTML = '<div class="mr-empty">Your inbox is empty.</div>';
      } catch (e) { rowsEl.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; subEl.textContent = ''; }
    }

    function renderRows() {
      if (!messages.length) { rowsEl.innerHTML = '<div class="loading">Your inbox is empty.</div>'; return; }
      rowsEl.innerHTML = messages.map(m => {
        const f = parseFrom(m.from);
        return '<div class="mrow' + (m.unread ? ' unread' : '') + (m.id === selectedId ? ' on' : '') + (sel.has(m.id) ? ' sel' : '') + '" data-id="' + m.id + '">' +
          '<input type="checkbox" class="mcheck"' + (sel.has(m.id) ? ' checked' : '') + ' data-id="' + m.id + '">' +
          '<div class="mc"><div class="mr1">' + (m.unread ? '<span class="un"></span>' : '') +
          '<span class="who">' + esc(f.name) + '</span><span class="tm">' + esc(shortDate(m.date)) + '</span></div>' +
          '<div class="msub">' + esc(m.subject) + '</div><div class="msnip">' + esc(m.snippet) + '</div></div></div>';
      }).join('');
      rowsEl.querySelectorAll('.mrow').forEach(el => el.addEventListener('click', (ev) => {
        if (ev.target.classList.contains('mcheck')) return;
        openMessage(el.dataset.id);
      }));
      rowsEl.querySelectorAll('.mcheck').forEach(cb => cb.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = cb.dataset.id;
        if (cb.checked) sel.add(id); else sel.delete(id);
        cb.closest('.mrow').classList.toggle('sel', cb.checked);
        selAll.checked = sel.size === messages.length && messages.length > 0;
        updateBar();
      }));
    }

    function updateBar() { barBtns.classList.toggle('show', sel.size > 0); }

    selAll.addEventListener('change', () => {
      sel.clear();
      if (selAll.checked) messages.forEach(m => sel.add(m.id));
      renderRows(); updateBar();
    });

    async function act(url, ids, verb) {
      try {
        const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
        if (!r.ok) throw new Error('Action failed.');
        messages = messages.filter(m => !ids.includes(m.id));
        if (ids.includes(selectedId)) { selectedId = null; readEl.innerHTML = '<div class="mr-empty">Select a message to read it here.</div>'; modEl.classList.remove('reading'); }
        ids.forEach(id => sel.delete(id)); selAll.checked = false;
        subEl.textContent = subEl.textContent.replace(/· \d+ message/, '· ' + messages.length + ' message');
        renderRows(); updateBar();
        toast(ids.length + ' ' + verb);
      } catch (e) { toast(e.message); }
    }
    root.querySelector('#bArchive').addEventListener('click', () => { if (sel.size) act('/api/mail/archive', [...sel], 'archived'); });
    root.querySelector('#bTrash').addEventListener('click', () => { if (sel.size) act('/api/mail/trash', [...sel], 'deleted'); });

    async function openMessage(id) {
      selectedId = id; renderRows(); modEl.classList.add('reading');
      readEl.innerHTML = '<div class="loading">Opening…</div>';
      try {
        const r = await fetch('/api/mail/message/' + encodeURIComponent(id), { credentials: 'include' });
        if (!r.ok) throw new Error('Could not open this message.');
        const m = await r.json();
        const f = parseFrom(m.from);
        const bodyHtml = m.text ? '<div class="mr-body">' + esc(m.text) + '</div>'
          : '<div class="mr-body html">' + String(m.html || '').replace(/<script[\s\S]*?<\/script>/gi, '') + '</div>';
        const initials = (f.name || f.email).slice(0, 2).toUpperCase();
        readEl.innerHTML =
          '<div class="mr-pad"><div class="mr-top"><div class="mr-h">' + esc(m.subject) + '</div>' +
            '<div class="mr-acts">' +
              '<button class="ib" id="aReply" title="Reply"><i class="ti ti-arrow-back-up"></i></button>' +
              '<button class="ib" id="aFwd" title="Forward"><i class="ti ti-arrow-forward-up"></i></button>' +
              '<button class="ib" id="aArch" title="Archive"><i class="ti ti-archive"></i></button>' +
              '<button class="ib danger" id="aDel" title="Delete"><i class="ti ti-trash"></i></button>' +
            '</div></div>' +
            '<div class="mr-from"><div class="mr-av">' + esc(initials) + '</div><div><div class="mr-nm">' + esc(f.name) + '</div><div class="mr-em">' + esc(f.email) + '</div></div><div class="mr-when">' + esc(shortDate(m.date)) + '</div></div>' +
            bodyHtml + '</div>' +
          '<div class="composer" id="composer">' +
            '<div class="cm-top" id="cmTopLabel">Reply to <b>' + esc(f.name) + '</b></div>' +
            '<input class="cm-to" id="cmTo" placeholder="Forward to (email address)">' +
            '<textarea class="cm-body" id="cmBody" placeholder="Write your message…"></textarea>' +
            '<div class="cm-foot"><span class="cm-note" id="cmNote"></span>' +
              '<button class="btn btn-ghost" id="cmCancel">Cancel</button>' +
              '<button class="btn btn-send" id="cmSend"><i class="ti ti-send" style="font-size:15px"></i> Send</button></div>' +
          '</div>';

        const composer = readEl.querySelector('#composer'), cmTo = readEl.querySelector('#cmTo'), cmBody = readEl.querySelector('#cmBody');
        const cmTopLabel = readEl.querySelector('#cmTopLabel'), cmNote = readEl.querySelector('#cmNote'), cmSend = readEl.querySelector('#cmSend');
        let mode = 'reply';
        const plain = m.text || String(m.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim();

        function showReply() {
          mode = 'reply'; composer.classList.add('show'); cmTo.classList.remove('show');
          cmTopLabel.innerHTML = 'Reply to <b>' + esc(f.name) + '</b>'; cmBody.value = ''; cmBody.focus();
        }
        function showForward() {
          mode = 'forward'; composer.classList.add('show'); cmTo.classList.add('show'); cmTo.value = '';
          cmTopLabel.innerHTML = 'Forward this message';
          cmBody.value = '\n\n---------- Forwarded message ----------\nFrom: ' + (m.from || '') + '\nDate: ' + (m.date || '') + '\nSubject: ' + (m.subject || '') + '\n\n' + plain;
          cmTo.focus();
        }
        readEl.querySelector('#aReply').addEventListener('click', showReply);
        readEl.querySelector('#aFwd').addEventListener('click', showForward);
        readEl.querySelector('#aArch').addEventListener('click', () => act('/api/mail/archive', [id], 'archived'));
        readEl.querySelector('#aDel').addEventListener('click', () => act('/api/mail/trash', [id], 'deleted'));
        readEl.querySelector('#cmCancel').addEventListener('click', () => composer.classList.remove('show'));

        cmSend.addEventListener('click', async () => {
          const text = cmBody.value.trim();
          const to = mode === 'forward' ? cmTo.value.trim() : f.email;
          if (mode === 'forward' && !to) { cmNote.textContent = 'Enter an address to forward to.'; return; }
          if (!text) { cmNote.textContent = 'Write a message first.'; return; }
          const subject = mode === 'forward'
            ? (/^fwd:/i.test(m.subject) ? m.subject : 'Fwd: ' + m.subject)
            : (/^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject);
          cmSend.disabled = true; cmNote.textContent = 'Sending…';
          try {
            const body = { to, subject, text };
            if (mode === 'reply') { body.inReplyTo = m.messageId; body.references = m.messageId; body.threadId = m.threadId; }
            const resp = await fetch('/api/mail/send', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const out = await resp.json();
            if (!resp.ok) throw new Error(out.error || 'Send failed.');
            cmNote.textContent = ''; composer.classList.remove('show'); toast(mode === 'forward' ? 'Forwarded' : 'Reply sent');
          } catch (e) { cmNote.textContent = e.message; cmSend.disabled = false; }
        });

        showReply();
      } catch (e) { readEl.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; }
    }

    await loadInbox();
  }
};
