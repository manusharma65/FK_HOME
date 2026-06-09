// FK Home — Mail module (r0.87, personal inbox to match the approved mock)
// ----------------------------------------------------------------------------
// 3-column layout INSIDE the current FK Home shell: collapsible Mail column
// (Mailbox sections + personal labels) | conversation list (search, cards,
// bulk actions, note chips, label dots) | reading pane (label chips, pinned
// private note, AI summary, reply/forward, AI draft, AI polish/spell-check).
// AI is on-demand + cached, defaulting to Haiku. Labels & notes live in FK Home.
// Deferred by agreement: the global icon-rail shell, snooze, attachments.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['mail'] = {
  title: 'My Mail',
  noHero: true,

  render() {
    return `
<div id="mail-mod" class="fk-mod">
  <style>
    #mail-mod{font-family:var(--body,'Hanken Grotesk',-apple-system,sans-serif);color:#2B2017}
    #mail-mod h1,#mail-mod h2,#mail-mod h3{font-family:var(--body,'Hanken Grotesk',sans-serif)!important;letter-spacing:-.01em}
    #mail-mod .mono{font-family:'JetBrains Mono',ui-monospace,monospace}
    #mail-mod .mwrap{display:grid;grid-template-columns:228px 384px 1fr;height:calc(100vh - 92px);min-height:540px;
      border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface);position:relative;transition:grid-template-columns .22s ease}
    #mail-mod .mwrap.collapsed{grid-template-columns:0px 384px 1fr}
    /* Mail column */
    #mail-mod .mnav{background:var(--canvas,#F4EFE7);border-right:1px solid var(--line);overflow:auto;padding:15px 13px;min-width:0;display:flex;flex-direction:column}
    #mail-mod .mnav-hd{display:flex;align-items:center;gap:8px;padding:2px 6px 12px}
    #mail-mod .mnav-hd .t{font-size:21px;font-weight:700;color:#2B2017;flex:1}
    #mail-mod .collapse,#mail-mod .expand{width:31px;height:31px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--muted);display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;flex:none}
    #mail-mod .collapse:hover,#mail-mod .expand:hover{background:#fff}
    #mail-mod .expand{display:none;margin-right:10px}
    #mail-mod .mwrap.collapsed .expand{display:flex}
    #mail-mod .mboxsw{display:flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:9px 11px;margin-bottom:6px;box-shadow:0 1px 2px rgba(58,40,24,.05);cursor:pointer;position:relative}
    #mail-mod .mboxsw .d1{font-size:11px;color:var(--soft,#9b8e7d)} #mail-mod .mboxsw .d2{font-size:14.5px;font-weight:700;color:#2B2017}
    #mail-mod .mboxsw .pill{font-size:10.5px;font-weight:700;color:#9A4A2B;background:#F5E5DA;border:1px solid #ECCDBC;padding:1px 7px;border-radius:10px;margin-left:6px}
    #mail-mod .mboxsw .cv{margin-left:auto;color:var(--soft);font-size:17px}
    #mail-mod .swmenu{position:absolute;top:100%;left:0;right:0;margin-top:5px;background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:0 12px 30px rgba(58,40,24,.16);padding:6px;z-index:20;display:none}
    #mail-mod .swmenu.show{display:block}
    #mail-mod .swmenu .it{padding:9px 10px;border-radius:8px;font-size:14px;cursor:pointer} #mail-mod .swmenu .it:hover{background:var(--canvas)}
    #mail-mod .swmenu .it.dim{color:var(--soft);cursor:default} #mail-mod .swmenu .it .tag{font-size:11px;color:var(--soft);margin-left:6px}
    #mail-mod .msec{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--soft,#9b8e7d);font-weight:700;padding:14px 9px 5px;display:flex;align-items:center}
    #mail-mod .msec .add{margin-left:auto;cursor:pointer;font-size:15px;color:var(--muted)} #mail-mod .msec .add:hover{color:var(--orange)}
    #mail-mod .mni{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:9px;color:#3A322A;cursor:pointer;font-size:14.5px;position:relative}
    #mail-mod .mni i.lead{font-size:18px;width:19px;text-align:center;color:var(--muted)}
    #mail-mod .mni .ct{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--soft)}
    #mail-mod .mni:hover{background:#EFE7D8} #mail-mod .mni.on{background:var(--orange,#E8722B);color:#fff;font-weight:600} #mail-mod .mni.on i.lead,#mail-mod .mni.on .ct{color:#fff}
    #mail-mod .mni .dot{width:10px;height:10px;border-radius:50%;flex:none}
    #mail-mod .mni .del{margin-left:auto;color:var(--soft);font-size:15px;opacity:0;cursor:pointer} #mail-mod .mni:hover .del{opacity:1} #mail-mod .mni.on .del{color:#fff}
    #mail-mod .newlab{margin:4px 4px 0;display:none;flex-direction:column;gap:7px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px}
    #mail-mod .newlab.show{display:flex}
    #mail-mod .newlab input{border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-family:inherit;font-size:13.5px;outline:none}
    #mail-mod .swatches{display:flex;gap:6px} #mail-mod .swatch{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid transparent} #mail-mod .swatch.on{border-color:#2B2017}
    #mail-mod .newlab .nb{display:flex;gap:6px} #mail-mod .newlab button{flex:1;font-family:inherit;font-size:13px;font-weight:600;border-radius:8px;padding:7px;cursor:pointer;border:1px solid var(--line);background:var(--surface)}
    #mail-mod .newlab .ok{background:var(--orange);color:#fff;border:none}
    /* List */
    #mail-mod .list{border-right:1px solid var(--line);overflow:auto;background:var(--canvas,#F4EFE7);display:flex;flex-direction:column}
    #mail-mod .lhd{display:flex;align-items:center;padding:15px 16px 6px;position:sticky;top:0;background:var(--canvas,#F4EFE7);z-index:4}
    #mail-mod .lhd h2{font-size:23px;font-weight:700;margin:0} #mail-mod .lhd .sub{font-size:13px;color:var(--muted);margin-top:1px}
    #mail-mod .srch{display:flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:9px 12px;margin:6px 16px 2px;box-shadow:0 1px 2px rgba(58,40,24,.05)}
    #mail-mod .srch i{color:var(--soft);font-size:17px} #mail-mod .srch input{border:none;background:none;font:inherit;font-size:14.5px;flex:1;outline:none;color:inherit}
    #mail-mod .mbar{display:flex;align-items:center;gap:10px;padding:8px 16px 6px}
    #mail-mod .selall{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);cursor:pointer;user-select:none}
    #mail-mod .selall input{width:17px;height:17px;accent-color:var(--orange);cursor:pointer}
    #mail-mod .barbtns{margin-left:auto;display:none;gap:8px} #mail-mod .barbtns.show{display:flex}
    #mail-mod .bb{font-family:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:#5b5249;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
    #mail-mod .bb:hover{background:#fff} #mail-mod .bb.danger:hover{background:#FBECEC;color:#A32D2D;border-color:#E9C9C9}
    #mail-mod .scroll{overflow:auto;padding:4px 12px 16px}
    #mail-mod .mrow{display:flex;gap:11px;background:var(--surface,#fff);border:1px solid #EFE7D8;border-radius:13px;padding:12px 14px;margin-bottom:9px;cursor:pointer;box-shadow:0 1px 2px rgba(58,40,24,.05),0 4px 14px rgba(58,40,24,.05);transition:box-shadow .12s,transform .12s}
    #mail-mod .mrow:hover{transform:translateY(-1px);box-shadow:0 2px 8px rgba(58,40,24,.08),0 16px 36px rgba(58,40,24,.10)}
    #mail-mod .mrow.on{box-shadow:0 0 0 2px var(--orange,#E8722B),0 16px 36px rgba(58,40,24,.10)}
    #mail-mod .mrow.sel{background:#FFF7F0;border-color:#F0CDB4}
    #mail-mod .mcheck{width:18px;height:18px;margin-top:3px;accent-color:var(--orange);cursor:pointer;flex:none}
    #mail-mod .mc{min-width:0;flex:1}
    #mail-mod .mr1{display:flex;align-items:center;gap:8px} #mail-mod .mr1 .un{width:8px;height:8px;border-radius:50%;background:var(--orange);flex:none}
    #mail-mod .mr1 .who{font-size:15.5px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #mail-mod .mrow.unread .who{font-weight:700}
    #mail-mod .mr1 .tm{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--soft);flex:none}
    #mail-mod .msub{font-size:14px;font-weight:500;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .msnip{font-size:12.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .rdots{display:flex;gap:5px;margin-top:7px;align-items:center}
    #mail-mod .rdots .ld{width:8px;height:8px;border-radius:50%}
    #mail-mod .pn{display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-size:11.5px;font-weight:600;color:#8A6A1E;background:#FBF3DD;border:1px solid #EDD9A6;padding:3px 8px;border-radius:6px;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    /* Read */
    #mail-mod .mread{overflow:auto;background:var(--canvas,#F4EFE7);display:flex;flex-direction:column}
    #mail-mod .mr-empty{margin:auto;color:var(--muted);font-size:15px;text-align:center;padding:40px}
    #mail-mod .mr-pad{padding:22px 28px 40px;max-width:860px;width:100%}
    #mail-mod .mr-top{display:flex;align-items:flex-start;gap:14px}
    #mail-mod .mr-h{font-size:24px;font-weight:700;line-height:1.25;flex:1}
    #mail-mod .mr-acts{display:flex;gap:7px;flex:none;position:relative}
    #mail-mod .ib{width:39px;height:39px;border-radius:11px;border:1px solid var(--line);background:var(--surface);color:#6A5C4E;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer}
    #mail-mod .ib:hover{background:#fff} #mail-mod .ib.danger:hover{background:#FBECEC;color:#A32D2D;border-color:#E9C9C9}
    #mail-mod .labmenu{position:absolute;top:46px;right:0;background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:0 12px 30px rgba(58,40,24,.16);padding:6px;z-index:20;display:none;min-width:190px}
    #mail-mod .labmenu.show{display:block}
    #mail-mod .labmenu .li{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;font-size:13.5px;cursor:pointer} #mail-mod .labmenu .li:hover{background:var(--canvas)}
    #mail-mod .labmenu .li .dot{width:10px;height:10px;border-radius:50%} #mail-mod .labmenu .li .tick{margin-left:auto;color:var(--orange);font-size:15px;visibility:hidden} #mail-mod .labmenu .li.on .tick{visibility:visible}
    #mail-mod .labmenu .none{padding:8px 9px;font-size:12.5px;color:var(--soft)}
    #mail-mod .chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px} #mail-mod .chip2{font-size:12px;font-weight:600;padding:4px 10px;border-radius:7px;display:inline-flex;align-items:center;gap:6px}
    #mail-mod .pinnote{display:flex;align-items:flex-start;gap:11px;margin:16px 0 0;background:#FBF3DD;border:1px solid #EDD9A6;border-radius:14px;padding:13px 15px}
    #mail-mod .pinnote .pi{color:#8A6A1E;font-size:19px;flex:none;margin-top:1px}
    #mail-mod .pinnote .pl{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8A6A1E}
    #mail-mod .pinnote .pt{font-size:14.5px;color:#5c4a22;margin-top:2px;line-height:1.5;white-space:pre-wrap}
    #mail-mod .pinnote .pe{display:flex;gap:6px;margin-left:auto;flex:none}
    #mail-mod .pinnote .pb{width:30px;height:30px;border-radius:8px;border:1px solid #EDD9A6;background:#fff;color:#8A6A1E;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer}
    #mail-mod .noteedit{margin:16px 0 0;background:#FBF3DD;border:1px solid #EDD9A6;border-radius:14px;padding:12px 14px}
    #mail-mod .noteedit textarea{width:100%;border:1px solid #EDD9A6;border-radius:9px;padding:9px;font-family:inherit;font-size:14px;outline:none;resize:vertical;min-height:60px;background:#fff}
    #mail-mod .noteedit .nf{display:flex;gap:7px;justify-content:flex-end;margin-top:8px}
    #mail-mod .addnote{margin:14px 0 0;font-size:13px;color:#8A6A1E;background:#FBF3DD;border:1px dashed #EDD9A6;border-radius:10px;padding:9px 12px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
    #mail-mod .mr-from{display:flex;align-items:center;gap:12px;margin-top:18px}
    #mail-mod .mr-av{width:44px;height:44px;border-radius:50%;background:#EFE0D2;color:#9A4A2B;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:none}
    #mail-mod .mr-nm{font-size:15px;font-weight:600} #mail-mod .mr-em{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)}
    #mail-mod .mr-when{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--soft)}
    #mail-mod .aisum{margin:16px 0 4px;background:#F1ECF8;border:1px solid #DED3EE;border-radius:13px;padding:13px 15px;display:none;gap:11px}
    #mail-mod .aisum.show{display:flex}
    #mail-mod .aisum .ic{width:28px;height:28px;border-radius:8px;background:#6F57A0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
    #mail-mod .aisum .t{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#4A3A78}
    #mail-mod .aisum .x{font-size:14.5px;color:#39335A;margin-top:2px;line-height:1.5}
    #mail-mod .aisum .ai-sumbtn{margin-top:6px;background:#6F57A0;color:#fff;border:none;border-radius:8px;padding:7px 13px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer} #mail-mod .aisum .ai-sumbtn:hover{background:#4A3A78} #mail-mod .aisum .ai-sumbtn:disabled{opacity:.6}
    #mail-mod .mr-body{font-size:15px;line-height:1.74;margin:16px 0 6px;white-space:pre-wrap;word-wrap:break-word} #mail-mod .mr-body.html{white-space:normal} #mail-mod .mr-body.html img{max-width:100%;height:auto}
    #mail-mod .body-acts{display:flex;gap:10px;margin:18px 0 4px}
    #mail-mod .composer{margin:8px 0 0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface);display:none} #mail-mod .composer.show{display:block}
    #mail-mod .cm-top{padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted);background:var(--canvas,#F4EFE7)} #mail-mod .cm-top b{color:#2B2017;font-weight:600}
    #mail-mod .ai-row{display:flex;align-items:center;gap:9px;padding:11px 14px;background:#F1ECF8;border-bottom:1px solid #DED3EE} #mail-mod .ai-row.hide{display:none}
    #mail-mod .ai-draft{display:inline-flex;align-items:center;gap:7px;background:#6F57A0;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;flex:none} #mail-mod .ai-draft:hover{background:#4A3A78} #mail-mod .ai-draft:disabled{opacity:.6}
    #mail-mod .ai-instr{flex:1;border:1px solid #DED3EE;border-radius:9px;padding:9px 11px;font-family:inherit;font-size:13.5px;outline:none;background:#fff;color:inherit}
    #mail-mod .cm-to{width:calc(100% - 28px);margin:12px 14px 0;border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-family:inherit;font-size:13.5px;outline:none;display:none} #mail-mod .cm-to.show{display:block}
    #mail-mod .cm-body{width:100%;border:none;outline:none;resize:vertical;min-height:140px;padding:14px 16px;font-family:inherit;font-size:15px;line-height:1.6;background:var(--surface);color:inherit}
    #mail-mod .cm-foot{display:flex;align-items:center;gap:9px;padding:11px 14px;border-top:1px solid var(--line);background:var(--canvas,#F4EFE7)}
    #mail-mod .cm-note{margin-right:auto;font-size:12.5px;color:var(--soft)}
    #mail-mod .polish{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid #DED3EE;color:#4A3A78;border-radius:9px;padding:8px 12px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer} #mail-mod .polish:hover{background:#F1ECF8} #mail-mod .polish:disabled{opacity:.6}
    #mail-mod .btn{font-family:inherit;font-size:14.5px;font-weight:700;padding:10px 18px;border:none;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
    #mail-mod .btn-ghost{background:var(--surface);border:1px solid var(--line);color:#5b5249} #mail-mod .btn-ghost:hover{background:#fff}
    #mail-mod .btn-send{background:var(--orange,#E8722B);color:#fff} #mail-mod .btn-send:disabled{opacity:.5}
    #mail-mod .loading,#mail-mod .errbox{padding:30px;color:var(--muted);font-size:14.5px} #mail-mod .errbox{color:#A32D2D}
    #mail-mod .toast{position:absolute;left:50%;transform:translateX(-50%);bottom:18px;background:#2B2017;color:#fff;font-size:13.5px;padding:10px 16px;border-radius:10px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:30} #mail-mod .toast.show{opacity:1}
    @media(max-width:1000px){#mail-mod .mwrap{grid-template-columns:0px 340px 1fr}#mail-mod .mwrap .expand{display:flex}}
  </style>
  <div class="mwrap" id="mwrap">
    <aside class="mnav" id="mnav">
      <div class="mnav-hd"><span class="t">Mail</span><button class="collapse" id="collapseBtn" title="Collapse"><i class="ti ti-layout-sidebar-left-collapse"></i></button></div>
      <div class="mboxsw" id="mboxsw"><div><div class="d1">Mailbox</div><div class="d2">Personal <span class="pill">you</span></div></div><i class="ti ti-chevron-down cv"></i>
        <div class="swmenu" id="swmenu"><div class="it">Personal <span class="tag">you</span></div><div class="it dim">Customer Service <span class="tag">coming soon</span></div></div>
      </div>
      <div class="msec">Mailbox</div>
      <div class="mni on" data-box="inbox"><i class="ti ti-inbox lead"></i> Inbox <span class="ct" id="ctInbox"></span></div>
      <div class="mni" data-box="sent"><i class="ti ti-send lead"></i> Sent</div>
      <div class="mni" data-box="archive"><i class="ti ti-archive lead"></i> Archive</div>
      <div class="msec">My labels <i class="ti ti-plus add" id="addLabel" title="New label"></i></div>
      <div id="labelList"></div>
      <div class="newlab" id="newLab">
        <input id="newLabName" placeholder="Label name" maxlength="40">
        <div class="swatches" id="swatches"></div>
        <div class="nb"><button id="newLabCancel">Cancel</button><button class="ok" id="newLabAdd">Add label</button></div>
      </div>
    </aside>
    <section class="list">
      <div class="lhd"><button class="expand" id="expandBtn" title="Show menu"><i class="ti ti-layout-sidebar-left-expand"></i></button><div><h2 id="listTitle">Inbox</h2><div class="sub" id="mailSub">Loading…</div></div></div>
      <div class="srch"><i class="ti ti-search"></i><input id="srch" placeholder="Search your mail"></div>
      <div class="mbar"><label class="selall"><input type="checkbox" id="selAll"> Select all</label>
        <div class="barbtns" id="barBtns"><button class="bb" id="bArchive"><i class="ti ti-archive" style="font-size:15px"></i> Archive</button><button class="bb danger" id="bTrash"><i class="ti ti-trash" style="font-size:15px"></i> Delete</button></div>
      </div>
      <div class="scroll" id="mailRows"><div class="loading">Loading your mail…</div></div>
    </section>
    <section class="mread" id="mailRead"><div class="mr-empty">Select a message to read it here.</div></section>
    <div class="toast" id="mailToast"></div>
  </div>
</div>`;
  },

  async mount(root) {
    const $ = (s) => root.querySelector(s);
    const rowsEl = $('#mailRows'), subEl = $('#mailSub'), listTitle = $('#listTitle');
    const readEl = $('#mailRead'), mwrap = $('#mwrap'), toastEl = $('#mailToast');
    const selAll = $('#selAll'), barBtns = $('#barBtns'), srchEl = $('#srch');
    let messages = [], box = 'inbox', selectedId = null, sel = new Set(), summaryCache = {};
    let labels = [], labelMap = {}, notesMap = {}, labelFilter = null, query = '';
    const SWATCHES = ['#6F57A0', '#2D6FB0', '#2E8C6F', '#9A4E8A', '#C2613B', '#B0892D'];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const parseFrom = (from) => { const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); return m ? { name: m[1].trim() || m[2], email: m[2].trim() } : { name: from || '', email: (from || '').trim() }; };
    const shortDate = (d) => { try { return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d || ''; } };
    const toast = (m) => { toastEl.textContent = m; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), 2200); };
    const labelById = (id) => labels.find(l => l.id === id);
    const j = (url, opts) => fetch(url, Object.assign({ credentials: 'include' }, opts)).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || ('Request failed (' + r.status + ').')); e.code = d.code; throw e; } return d; });
    const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

    // ---- Mail column: boxes ----
    root.querySelectorAll('.mni[data-box]').forEach(el => el.addEventListener('click', () => {
      root.querySelectorAll('.mni').forEach(n => n.classList.remove('on')); el.classList.add('on');
      box = el.dataset.box; labelFilter = null; loadBox();
    }));
    $('#collapseBtn').addEventListener('click', () => mwrap.classList.add('collapsed'));
    $('#expandBtn').addEventListener('click', () => mwrap.classList.remove('collapsed'));
    $('#mboxsw').addEventListener('click', (e) => { e.stopPropagation(); $('#swmenu').classList.toggle('show'); });
    document.addEventListener('click', () => { const s = $('#swmenu'); if (s) s.classList.remove('show'); });

    // ---- Labels ----
    function renderLabels() {
      const counts = {};
      Object.values(labelMap).forEach(ids => ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
      $('#labelList').innerHTML = labels.map(l =>
        '<div class="mni' + (labelFilter === l.id ? ' on' : '') + '" data-label="' + l.id + '"><span class="dot" style="background:' + esc(l.colour) + '"></span>' + esc(l.name) +
        (counts[l.id] ? '<span class="ct">' + counts[l.id] + '</span>' : '') + '<i class="ti ti-x del" data-del="' + l.id + '" title="Delete label"></i></div>'
      ).join('') || '<div style="font-size:13px;color:var(--soft);padding:4px 10px">No labels yet.</div>';
      $('#labelList').querySelectorAll('[data-label]').forEach(el => el.addEventListener('click', (ev) => {
        if (ev.target.dataset.del) return;
        const id = parseInt(el.dataset.label, 10);
        labelFilter = labelFilter === id ? null : id;
        root.querySelectorAll('.mni').forEach(n => n.classList.remove('on'));
        if (labelFilter) el.classList.add('on'); else root.querySelector('.mni[data-box="' + box + '"]').classList.add('on');
        renderRows();
      }));
      $('#labelList').querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('Delete this label? It will be removed from all emails.')) return;
        try { await j('/api/mail/labels/' + el.dataset.del, { method: 'DELETE' }); await refreshLabels(); if (selectedId) openMessage(selectedId); toast('Label deleted'); } catch (e) { toast(e.message); }
      }));
    }
    async function refreshLabels() {
      const [a, b] = await Promise.all([j('/api/mail/labels'), j('/api/mail/labelmap')]);
      labels = a.labels || []; labelMap = b.map || {}; renderLabels();
    }
    // New-label inline form
    let pickColour = SWATCHES[0];
    $('#swatches').innerHTML = SWATCHES.map((c, i) => '<span class="swatch' + (i === 0 ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></span>').join('');
    $('#swatches').querySelectorAll('.swatch').forEach(s => s.addEventListener('click', () => { pickColour = s.dataset.c; $('#swatches').querySelectorAll('.swatch').forEach(x => x.classList.remove('on')); s.classList.add('on'); }));
    const showNewLab = () => { $('#newLab').classList.add('show'); $('#newLabName').focus(); };
    $('#addLabel').addEventListener('click', showNewLab);
    $('#newLabCancel').addEventListener('click', () => { $('#newLab').classList.remove('show'); $('#newLabName').value = ''; });
    $('#newLabAdd').addEventListener('click', async () => {
      const name = $('#newLabName').value.trim(); if (!name) return;
      try { await post('/api/mail/labels', { name, colour: pickColour }); $('#newLab').classList.remove('show'); $('#newLabName').value = ''; await refreshLabels(); toast('Label added'); } catch (e) { toast(e.message); }
    });

    // ---- List ----
    async function loadBox() {
      sel.clear(); selAll.checked = false; updateBar();
      listTitle.textContent = box === 'sent' ? 'Sent' : box === 'archive' ? 'Archive' : 'Inbox';
      rowsEl.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const data = await j('/api/mail/inbox?box=' + box);
        messages = data.messages || [];
        $('#ctInbox').textContent = box === 'inbox' ? (messages.length || '') : $('#ctInbox').textContent;
        renderRows();
        const vis = visible();
        if (vis.length) openMessage(vis[0].id); else { readEl.innerHTML = '<div class="mr-empty">Nothing here.</div>'; mwrap.classList.remove('reading'); }
      } catch (e) { rowsEl.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; subEl.textContent = ''; }
    }
    function visible() {
      let ms = messages;
      if (labelFilter) ms = ms.filter(m => (labelMap[m.id] || []).includes(labelFilter));
      if (query) { const q = query.toLowerCase(); ms = ms.filter(m => (m.from + ' ' + m.subject + ' ' + m.snippet).toLowerCase().includes(q)); }
      return ms;
    }
    function renderRows() {
      const ms = visible();
      const unread = ms.filter(m => m.unread).length;
      subEl.textContent = ms.length + ' message' + (ms.length === 1 ? '' : 's') + (unread ? ' · ' + unread + ' unread' : '');
      if (!ms.length) { rowsEl.innerHTML = '<div class="loading">No matching messages.</div>'; return; }
      rowsEl.innerHTML = ms.map(m => {
        const f = parseFrom(m.from); const note = notesMap[m.id]; const lids = labelMap[m.id] || [];
        const dots = lids.length ? '<div class="rdots">' + lids.map(id => { const l = labelById(id); return l ? '<span class="ld" style="background:' + esc(l.colour) + '"></span>' : ''; }).join('') + '</div>' : '';
        const pn = note ? '<div class="pn"><i class="ti ti-note" style="font-size:12px"></i> ' + esc(note) + '</div>' : '';
        return '<div class="mrow' + (m.unread ? ' unread' : '') + (m.id === selectedId ? ' on' : '') + (sel.has(m.id) ? ' sel' : '') + '" data-id="' + m.id + '">' +
          '<input type="checkbox" class="mcheck"' + (sel.has(m.id) ? ' checked' : '') + ' data-id="' + m.id + '">' +
          '<div class="mc"><div class="mr1">' + (m.unread ? '<span class="un"></span>' : '') + '<span class="who">' + esc(f.name) + '</span><span class="tm">' + esc(shortDate(m.date)) + '</span></div>' +
          '<div class="msub">' + esc(m.subject) + '</div><div class="msnip">' + esc(m.snippet) + '</div>' + dots + pn + '</div></div>';
      }).join('');
      rowsEl.querySelectorAll('.mrow').forEach(el => el.addEventListener('click', (ev) => { if (ev.target.classList.contains('mcheck')) return; openMessage(el.dataset.id); }));
      rowsEl.querySelectorAll('.mcheck').forEach(cb => cb.addEventListener('click', (ev) => {
        ev.stopPropagation(); const id = cb.dataset.id; if (cb.checked) sel.add(id); else sel.delete(id);
        cb.closest('.mrow').classList.toggle('sel', cb.checked); selAll.checked = sel.size === visible().length && visible().length > 0; updateBar();
      }));
    }
    function updateBar() { barBtns.classList.toggle('show', sel.size > 0); }
    selAll.addEventListener('change', () => { sel.clear(); if (selAll.checked) visible().forEach(m => sel.add(m.id)); renderRows(); updateBar(); });
    srchEl.addEventListener('input', () => { query = srchEl.value.trim(); renderRows(); });

    async function act(url, ids, verb) {
      try {
        await post(url, { ids });
        messages = messages.filter(m => !ids.includes(m.id));
        if (ids.includes(selectedId)) { selectedId = null; readEl.innerHTML = '<div class="mr-empty">Select a message to read it here.</div>'; mwrap.classList.remove('reading'); }
        ids.forEach(id => sel.delete(id)); selAll.checked = false; renderRows(); updateBar(); toast(ids.length + ' ' + verb);
      } catch (e) { toast(e.message); }
    }
    $('#bArchive').addEventListener('click', () => { if (sel.size) act('/api/mail/archive', [...sel], 'archived'); });
    $('#bTrash').addEventListener('click', () => { if (sel.size) act('/api/mail/trash', [...sel], 'deleted'); });

    // ---- Reading pane ----
    async function openMessage(id) {
      selectedId = id; renderRows(); mwrap.classList.add('reading');
      readEl.innerHTML = '<div class="loading">Opening…</div>';
      try {
        const m = await j('/api/mail/message/' + encodeURIComponent(id));
        if (messages.find(x => x.id === id)) messages.find(x => x.id === id).unread = false;
        const f = parseFrom(m.from);
        const plain = m.text || String(m.html || '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
        const bodyHtml = m.text ? '<div class="mr-body">' + esc(m.text) + '</div>' : '<div class="mr-body html">' + String(m.html || '').replace(/<script[\s\S]*?<\/script>/gi, '') + '</div>';
        const initials = (f.name || f.email).slice(0, 2).toUpperCase();
        readEl.innerHTML =
          '<div class="mr-pad"><div class="mr-top"><div class="mr-h">' + esc(m.subject) + '</div>' +
            '<div class="mr-acts"><button class="ib" id="aTag" title="Labels"><i class="ti ti-tag"></i></button>' +
              '<button class="ib" id="aArch" title="Archive"><i class="ti ti-archive"></i></button>' +
              '<button class="ib danger" id="aDel" title="Delete"><i class="ti ti-trash"></i></button>' +
              '<div class="labmenu" id="labMenu"></div></div></div>' +
            '<div class="chips" id="chips"></div>' +
            '<div id="noteSlot"></div>' +
            '<div class="mr-from"><div class="mr-av">' + esc(initials) + '</div><div><div class="mr-nm">' + esc(f.name) + '</div><div class="mr-em">' + esc(f.email) + '</div></div><div class="mr-when">' + esc(shortDate(m.date)) + '</div></div>' +
            '<div class="aisum" id="aiSum"></div>' + bodyHtml +
            '<div class="body-acts"><button class="btn btn-send" id="bReply"><i class="ti ti-arrow-back-up" style="font-size:16px"></i> Reply</button>' +
              '<button class="btn btn-ghost" id="bFwd"><i class="ti ti-arrow-forward-up" style="font-size:16px"></i> Forward</button></div>' +
            '<div class="composer" id="composer"><div class="cm-top" id="cmTopLabel">Reply to <b>' + esc(f.name) + '</b></div>' +
              '<div class="ai-row" id="aiRow"><button class="ai-draft" id="aiDraftBtn"><i class="ti ti-sparkles" style="font-size:15px"></i> AI draft</button><input class="ai-instr" id="aiInstr" placeholder="…or tell the AI what to say"></div>' +
              '<input class="cm-to" id="cmTo" placeholder="Forward to (email address)">' +
              '<textarea class="cm-body" id="cmBody" spellcheck="true" placeholder="Write your message…"></textarea>' +
              '<div class="cm-foot"><span class="cm-note" id="cmNote"></span><button class="polish" id="polishBtn"><i class="ti ti-spell-check" style="font-size:15px"></i> Polish with AI</button>' +
                '<button class="btn btn-ghost" id="cmCancel">Cancel</button><button class="btn btn-send" id="cmSend"><i class="ti ti-send" style="font-size:15px"></i> Send</button></div>' +
            '</div></div>';

        renderChips(id); renderNote(id, plain);

        // labels menu
        const labMenu = $('#labMenu');
        $('#aTag').addEventListener('click', (e) => {
          e.stopPropagation(); const mine = labelMap[id] || [];
          labMenu.innerHTML = labels.length ? labels.map(l => '<div class="li' + (mine.includes(l.id) ? ' on' : '') + '" data-l="' + l.id + '"><span class="dot" style="background:' + esc(l.colour) + '"></span>' + esc(l.name) + '<i class="ti ti-check tick"></i></div>').join('') : '<div class="none">No labels yet — add one in the Mail menu.</div>';
          labMenu.classList.toggle('show');
          labMenu.querySelectorAll('[data-l]').forEach(it => it.addEventListener('click', async (ev) => {
            ev.stopPropagation(); const lid = parseInt(it.dataset.l, 10); const on = !it.classList.contains('on');
            try {
              await post('/api/mail/message/' + id + '/label', { labelId: lid, on });
              labelMap[id] = labelMap[id] || []; if (on) labelMap[id].push(lid); else labelMap[id] = labelMap[id].filter(x => x !== lid);
              it.classList.toggle('on', on); renderChips(id); renderLabels();
            } catch (e2) { toast(e2.message); }
          }));
        });
        document.addEventListener('click', () => labMenu.classList.remove('show'));

        $('#aArch').addEventListener('click', () => act('/api/mail/archive', [id], 'archived'));
        $('#aDel').addEventListener('click', () => act('/api/mail/trash', [id], 'deleted'));

        // composer
        const composer = $('#composer'), cmTo = $('#cmTo'), cmBody = $('#cmBody'), cmTopLabel = $('#cmTopLabel'), cmNote = $('#cmNote'), cmSend = $('#cmSend'), aiRow = $('#aiRow');
        let mode = 'reply';
        const openComposer = () => { composer.classList.add('show'); composer.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => cmBody.focus({ preventScroll: true }), 250); };
        const showReply = () => { mode = 'reply'; cmTo.classList.remove('show'); aiRow.classList.remove('hide'); cmTopLabel.innerHTML = 'Reply to <b>' + esc(f.name) + '</b>'; cmBody.value = ''; openComposer(); };
        const showForward = () => { mode = 'forward'; cmTo.classList.add('show'); aiRow.classList.add('hide'); cmTo.value = ''; cmTopLabel.innerHTML = 'Forward this message'; cmBody.value = '\n\n---------- Forwarded message ----------\nFrom: ' + (m.from || '') + '\nDate: ' + (m.date || '') + '\nSubject: ' + (m.subject || '') + '\n\n' + plain; openComposer(); };
        $('#bReply').addEventListener('click', showReply);
        $('#bFwd').addEventListener('click', showForward);
        $('#cmCancel').addEventListener('click', () => composer.classList.remove('show'));

        $('#aiDraftBtn').addEventListener('click', async () => {
          const btn = $('#aiDraftBtn'); btn.disabled = true; cmNote.textContent = 'AI is writing…';
          try { const out = await post('/api/mail/ai/draft', { original: plain, instruction: $('#aiInstr').value.trim() }); cmBody.value = out.draft || ''; cmNote.textContent = 'Drafted by AI — edit before sending.'; }
          catch (e) { cmNote.textContent = e.code === 'NO_KEY' ? 'AI needs a one-time key set up first.' : e.message; }
          btn.disabled = false;
        });
        $('#polishBtn').addEventListener('click', async () => {
          const btn = $('#polishBtn'); if (!cmBody.value.trim()) { cmNote.textContent = 'Write something first.'; return; }
          btn.disabled = true; cmNote.textContent = 'Polishing…';
          try { const out = await post('/api/mail/ai/polish', { text: cmBody.value }); if (out.polished) cmBody.value = out.polished; cmNote.textContent = 'Spelling & grammar polished.'; }
          catch (e) { cmNote.textContent = e.code === 'NO_KEY' ? 'AI needs a one-time key set up first.' : e.message; }
          btn.disabled = false;
        });
        cmSend.addEventListener('click', async () => {
          const text = cmBody.value.trim(); const to = mode === 'forward' ? cmTo.value.trim() : f.email;
          if (mode === 'forward' && !to) { cmNote.textContent = 'Enter an address to forward to.'; return; }
          if (!text) { cmNote.textContent = 'Write a message first.'; return; }
          const subject = mode === 'forward' ? (/^fwd:/i.test(m.subject) ? m.subject : 'Fwd: ' + m.subject) : (/^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject);
          cmSend.disabled = true; cmNote.textContent = 'Sending…';
          try {
            const body = { to, subject, text };
            if (mode === 'reply') { body.inReplyTo = m.messageId; body.references = m.messageId; body.threadId = m.threadId; }
            await post('/api/mail/send', body);
            cmNote.textContent = ''; composer.classList.remove('show'); toast(mode === 'forward' ? 'Forwarded' : 'Reply sent');
          } catch (e) { cmNote.textContent = e.message; cmSend.disabled = false; }
        });

        // AI summary — on demand, cached
        const sumEl = $('#aiSum'); const sumIcon = '<div class="ic"><i class="ti ti-sparkles"></i></div>';
        const paintSummary = (t) => { sumEl.className = 'aisum show'; sumEl.innerHTML = sumIcon + '<div style="flex:1"><div class="t">AI summary</div><div class="x">' + esc(t) + '</div></div>'; };
        function paintButton() { sumEl.className = 'aisum show'; sumEl.innerHTML = sumIcon + '<div style="flex:1"><div class="t">AI summary</div><button class="ai-sumbtn" id="aiSumBtn">Summarise this email</button></div>'; $('#aiSumBtn').addEventListener('click', runSummary); }
        async function runSummary() {
          const btn = $('#aiSumBtn'); if (btn) { btn.textContent = 'Summarising…'; btn.disabled = true; }
          try { const out = await post('/api/mail/ai/summary', { text: plain }); summaryCache[id] = out.summary || ''; if (summaryCache[id]) paintSummary(summaryCache[id]); else sumEl.innerHTML = sumIcon + '<div style="flex:1"><div class="t">AI summary</div><div class="x">Nothing much to summarise.</div></div>'; }
          catch (e) { sumEl.innerHTML = sumIcon + '<div style="flex:1"><div class="t">AI summary</div><div class="x" style="color:#A32D2D">' + esc(e.code === 'NO_KEY' ? 'AI needs a one-time key set up first.' : e.message) + '</div></div>'; }
        }
        if (summaryCache[id]) paintSummary(summaryCache[id]); else if (plain.length > 120) paintButton();
      } catch (e) { readEl.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; }
    }

    function renderChips(id) {
      const el = root.querySelector('#chips'); if (!el) return;
      const lids = labelMap[id] || [];
      el.innerHTML = lids.map(lid => { const l = labelById(lid); return l ? '<span class="chip2" style="color:#fff;background:' + esc(l.colour) + '">' + esc(l.name) + '</span>' : ''; }).join('');
    }
    function renderNote(id, plain) {
      const slot = root.querySelector('#noteSlot'); if (!slot) return;
      const note = notesMap[id];
      if (note) {
        slot.innerHTML = '<div class="pinnote"><i class="ti ti-note pi"></i><div style="flex:1"><div class="pl">Your note · private</div><div class="pt">' + esc(note) + '</div></div><div class="pe"><button class="pb" id="noteEdit" title="Edit"><i class="ti ti-pencil"></i></button><button class="pb" id="noteDel" title="Delete"><i class="ti ti-trash"></i></button></div></div>';
        root.querySelector('#noteEdit').addEventListener('click', () => editNote(id, note));
        root.querySelector('#noteDel').addEventListener('click', async () => { try { await j('/api/mail/note/' + id, { method: 'DELETE' }); delete notesMap[id]; renderNote(id); renderRows(); toast('Note deleted'); } catch (e) { toast(e.message); } });
      } else {
        slot.innerHTML = '<button class="addnote" id="noteAdd"><i class="ti ti-note"></i> Add a private note</button>';
        root.querySelector('#noteAdd').addEventListener('click', () => editNote(id, ''));
      }
    }
    function editNote(id, current) {
      const slot = root.querySelector('#noteSlot');
      slot.innerHTML = '<div class="noteedit"><textarea id="noteBody" placeholder="Private note — only you can see this">' + esc(current) + '</textarea><div class="nf"><button class="btn btn-ghost" id="noteCancel">Cancel</button><button class="btn btn-send" id="noteSave">Save note</button></div></div>';
      const ta = root.querySelector('#noteBody'); ta.focus();
      root.querySelector('#noteCancel').addEventListener('click', () => renderNote(id));
      root.querySelector('#noteSave').addEventListener('click', async () => {
        const body = ta.value.trim();
        try { const out = await j('/api/mail/note/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }); if (out.body) notesMap[id] = out.body; else delete notesMap[id]; renderNote(id); renderRows(); toast('Note saved'); } catch (e) { toast(e.message); }
      });
    }

    // ---- Boot ----
    try { await refreshLabels(); } catch (e) {}
    try { notesMap = (await j('/api/mail/notes')).map || {}; } catch (e) {}
    await loadBox();
  }
};
