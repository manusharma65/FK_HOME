// FK Home — Mail module (r0.82, Ship 1: personal inbox — read + reply)
// ----------------------------------------------------------------------------
// First working slice of the in-house mailbox. Reads the logged-in person's
// own Gmail via the proven engine (GET /api/mail/inbox, /message/:id) and sends
// replies (POST /api/mail/send). Native FK Home theme (orange accent, app fonts,
// no serif). AI brief/draft, notes, labels, snooze and the shared CS mode are
// later ships — this proves the personal inbox end to end.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['mail'] = {
  title: 'My Mail',
  noHero: true,

  render() {
    return `
<div id="mail-mod" class="fk-mod">
  <style>
    #mail-mod{display:flex;flex-direction:column;height:calc(100vh - 92px);min-height:520px;font-family:var(--body,'Hanken Grotesk',-apple-system,sans-serif)}
    #mail-mod h2{font-family:var(--body,'Hanken Grotesk',sans-serif)!important;letter-spacing:-.01em}
    #mail-mod .msplit{flex:1;min-height:0;display:grid;grid-template-columns:380px 1fr;
      border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}
    #mail-mod .mlist{border-right:1px solid var(--line);overflow:auto;background:var(--canvas,#F4EFE7)}
    #mail-mod .mlhead{padding:16px 18px 10px;position:sticky;top:0;background:var(--canvas,#F4EFE7);z-index:2}
    #mail-mod .mlhead h2{font-size:22px;font-weight:700;letter-spacing:-.01em;margin:0}
    #mail-mod .mlhead .sub{font-size:13px;color:var(--muted);margin-top:2px}
    #mail-mod .mrow{padding:13px 16px;border-top:1px solid var(--line);cursor:pointer}
    #mail-mod .mrow:hover{background:#fff}
    #mail-mod .mrow.on{background:#fff;box-shadow:inset 3px 0 0 var(--orange,#E8722B)}
    #mail-mod .mr1{display:flex;align-items:center;gap:8px}
    #mail-mod .mr1 .un{width:8px;height:8px;border-radius:50%;background:var(--orange,#E8722B);flex:none}
    #mail-mod .mr1 .who{font-size:15px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .mr1 .tm{font-size:12px;color:var(--soft,#988f82);flex:none}
    #mail-mod .msub{font-size:14px;font-weight:500;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .msnip{font-size:13px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .mread{overflow:auto;display:flex;flex-direction:column}
    #mail-mod .mr-empty{margin:auto;color:var(--muted);font-size:15px;text-align:center;padding:40px}
    #mail-mod .mr-pad{padding:22px 26px 30px}
    #mail-mod .mr-h{font-size:22px;font-weight:700;letter-spacing:-.01em;line-height:1.25}
    #mail-mod .mr-from{display:flex;align-items:center;gap:12px;margin-top:14px}
    #mail-mod .mr-av{width:42px;height:42px;border-radius:50%;background:#EFE0D2;color:#9A4A2B;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:none}
    #mail-mod .mr-nm{font-size:15px;font-weight:600}
    #mail-mod .mr-em{font-size:12.5px;color:var(--muted)}
    #mail-mod .mr-when{margin-left:auto;font-size:12.5px;color:var(--soft,#988f82)}
    #mail-mod .mr-body{font-size:15px;line-height:1.7;margin-top:18px;white-space:pre-wrap;word-wrap:break-word}
    #mail-mod .mr-body.html{white-space:normal}
    #mail-mod .mr-body.html img{max-width:100%;height:auto}
    #mail-mod .composer{margin:18px 26px 26px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface)}
    #mail-mod .cm-top{padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted);background:var(--canvas,#F4EFE7)}
    #mail-mod .cm-top b{color:inherit;font-weight:600}
    #mail-mod .cm-body{width:100%;border:none;outline:none;resize:vertical;min-height:120px;padding:14px 16px;font-family:inherit;font-size:15px;line-height:1.6;background:var(--surface);color:inherit}
    #mail-mod .cm-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:11px 14px;border-top:1px solid var(--line);background:var(--canvas,#F4EFE7)}
    #mail-mod .cm-note{margin-right:auto;font-size:12.5px;color:var(--soft,#988f82)}
    #mail-mod .btn{font-family:inherit;font-size:14.5px;font-weight:700;padding:10px 18px;border:none;border-radius:10px;cursor:pointer}
    #mail-mod .btn-send{background:var(--orange,#E8722B);color:#fff;display:inline-flex;align-items:center;gap:7px}
    #mail-mod .btn-send:disabled{opacity:.5;cursor:default}
    #mail-mod .loading,#mail-mod .errbox{padding:30px;color:var(--muted);font-size:14.5px}
    #mail-mod .errbox{color:#A32D2D}
    @media(max-width:840px){#mail-mod .msplit{grid-template-columns:1fr}#mail-mod .mread{display:none}#mail-mod.reading .mlist{display:none}#mail-mod.reading .mread{display:flex}}
  </style>
  <div class="msplit">
    <aside class="mlist" id="mailList">
      <div class="mlhead"><h2>Inbox</h2><div class="sub" id="mailSub">Loading…</div></div>
      <div id="mailRows"><div class="loading">Loading your mail…</div></div>
    </aside>
    <section class="mread" id="mailRead">
      <div class="mr-empty">Select a message to read it here.</div>
    </section>
  </div>
</div>`;
  },

  async mount(root) {
    const $ = (id) => root.querySelector(id);
    const rowsEl = $('#mailRows'), subEl = $('#mailSub'), readEl = $('#mailRead'), modEl = $('#mail-mod');
    let messages = [], selectedId = null;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const parseFrom = (from) => {
      const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
      if (m) return { name: m[1].trim() || m[2], email: m[2].trim() };
      return { name: from || '', email: (from || '').trim() };
    };
    const shortDate = (d) => { try { const dt = new Date(d); return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d || ''; } };

    async function loadInbox() {
      try {
        const r = await fetch('/api/mail/inbox', { credentials: 'include' });
        if (!r.ok) throw new Error('Could not load your mailbox (' + r.status + ').');
        const data = await r.json();
        messages = data.messages || [];
        subEl.textContent = data.mailbox + ' · ' + messages.length + ' message' + (messages.length === 1 ? '' : 's');
        renderRows();
        if (messages.length) openMessage(messages[0].id);
      } catch (e) {
        rowsEl.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>';
        subEl.textContent = '';
      }
    }

    function renderRows() {
      if (!messages.length) { rowsEl.innerHTML = '<div class="loading">Your inbox is empty.</div>'; return; }
      rowsEl.innerHTML = messages.map(m => {
        const f = parseFrom(m.from);
        return '<div class="mrow' + (m.id === selectedId ? ' on' : '') + '" data-id="' + m.id + '">' +
          '<div class="mr1">' + (m.unread ? '<span class="un"></span>' : '') +
          '<span class="who">' + esc(f.name) + '</span><span class="tm">' + esc(shortDate(m.date)) + '</span></div>' +
          '<div class="msub">' + esc(m.subject) + '</div>' +
          '<div class="msnip">' + esc(m.snippet) + '</div></div>';
      }).join('');
      rowsEl.querySelectorAll('.mrow').forEach(el => el.addEventListener('click', () => openMessage(el.dataset.id)));
    }

    async function openMessage(id) {
      selectedId = id; renderRows(); modEl.classList.add('reading');
      readEl.innerHTML = '<div class="loading">Opening…</div>';
      try {
        const r = await fetch('/api/mail/message/' + encodeURIComponent(id), { credentials: 'include' });
        if (!r.ok) throw new Error('Could not open this message.');
        const m = await r.json();
        const f = parseFrom(m.from);
        const bodyHtml = m.text
          ? '<div class="mr-body">' + esc(m.text) + '</div>'
          : '<div class="mr-body html">' + String(m.html || '').replace(/<script[\s\S]*?<\/script>/gi, '') + '</div>';
        const reSub = /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject;
        const initials = (f.name || f.email).slice(0, 2).toUpperCase();
        readEl.innerHTML =
          '<div class="mr-pad">' +
            '<div class="mr-h">' + esc(m.subject) + '</div>' +
            '<div class="mr-from"><div class="mr-av">' + esc(initials) + '</div>' +
              '<div><div class="mr-nm">' + esc(f.name) + '</div><div class="mr-em">' + esc(f.email) + '</div></div>' +
              '<div class="mr-when">' + esc(shortDate(m.date)) + '</div></div>' +
            bodyHtml +
          '</div>' +
          '<div class="composer">' +
            '<div class="cm-top">Reply to <b>' + esc(f.name) + '</b></div>' +
            '<textarea class="cm-body" id="cmBody" placeholder="Write your reply…"></textarea>' +
            '<div class="cm-foot"><span class="cm-note" id="cmNote"></span>' +
              '<button class="btn btn-send" id="cmSend"><i class="ti ti-send" style="font-size:15px"></i> Send reply</button></div>' +
          '</div>';
        const sendBtn = readEl.querySelector('#cmSend'), bodyEl = readEl.querySelector('#cmBody'), noteEl = readEl.querySelector('#cmNote');
        sendBtn.addEventListener('click', async () => {
          const text = bodyEl.value.trim();
          if (!text) { noteEl.textContent = 'Write a reply first.'; return; }
          sendBtn.disabled = true; noteEl.textContent = 'Sending…';
          try {
            const resp = await fetch('/api/mail/send', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: f.email, subject: reSub, text, inReplyTo: m.messageId, references: m.messageId, threadId: m.threadId }),
            });
            const out = await resp.json();
            if (!resp.ok) throw new Error(out.error || 'Send failed.');
            noteEl.textContent = 'Sent ✓'; bodyEl.value = '';
          } catch (e) { noteEl.textContent = e.message; sendBtn.disabled = false; }
        });
      } catch (e) {
        readEl.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>';
      }
    }

    await loadInbox();
  }
};
