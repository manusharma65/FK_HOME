// FK Home — Customer Service Agent Workspace (r0.1)
// ----------------------------------------------------------------------------
// Agent workspace: merged queue, filter chips, case detail with thread,
// reply composer, Linnworks order panel, internal notes, case details,
// reassign. Sample data for now — swap fetchQueue/fetchCase for live API.
//
//   GET  /api/cs/queue              -> { cases: [...] }     (future)
//   GET  /api/cs/cases/:id          -> { case, thread, ... } (future)
//   POST /api/cs/cases/:id/reply    -> { ok }               (future)
//   POST /api/cs/cases/:id/reassign -> { ok }               (future)
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['cs'] = {
  title: 'Customer Service',
  noHero: true,

  render() {
    return `
<div id="cs-mod" class="fk-mod">
  <style>
    #cs-mod{flex:1;min-width:0;height:calc(100vh - 120px);min-height:520px;display:flex;font-family:var(--body,'Hanken Grotesk',-apple-system,sans-serif);color:#2B2017}
    #cs-mod h1,#cs-mod h2,#cs-mod h3,#cs-mod .cs-name{font-family:var(--disp,'Fraunces'),Georgia,serif;letter-spacing:-.01em}
    #cs-mod .cswrap{flex:1;min-height:0;display:grid;grid-template-columns:200px 380px 1fr;background:var(--canvas,#F4EFE7);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(36,31,27,.05)}
    @media(max-width:1100px){#cs-mod .cswrap{grid-template-columns:56px 320px 1fr}}
    @media(max-width:860px){#cs-mod .cswrap{grid-template-columns:1fr}#cs-mod .cs-nav,#cs-mod .cs-list{display:none}#cs-mod .cs-nav.mob,#cs-mod .cs-list.mob{display:flex}}

    /* Nav */
    #cs-mod .cs-nav{background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:16px 12px;min-width:0}
    #cs-mod .cs-nav-brand{font-family:var(--disp,'Fraunces'),serif;font-size:17px;font-weight:600;margin:0 8px 14px;color:#2B2017}
    #cs-mod .cs-nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;font-size:14px;font-weight:500;color:#5b5249;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:inherit}
    #cs-mod .cs-nav-item i{font-size:18px;color:var(--muted)}
    #cs-mod .cs-nav-item:hover{background:#EFE7D8}
    #cs-mod .cs-nav-item.on{background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;box-shadow:0 4px 12px rgba(232,114,43,.22)}
    #cs-mod .cs-nav-item.on i{color:#fff}
    #cs-mod .cs-nav-sp{flex:1}

    /* Composer Actions Bar */
#cs-mod .cs-composer-actions {
  display: flex;
  padding: 0 18px 10px;
  gap: 12px;
  align-items: center;
}

#cs-mod .cs-composer-actions button {
  background: none; border: 1px solid var(--line);
  padding: 4px 8px; border-radius: 6px; cursor: pointer;
  color: var(--muted);
}

#cs-mod .cs-ai-hint {
  font-size: 11px; color: #6366f1;
  background: #eff6ff; padding: 2px 8px; border-radius: 4px;
}

/* Dropdown styling for mentions */
.mention-dropdown {
    position: absolute;
    background: white;
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999;
    width: 200px;
    display: none;
}

.mention-item {
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
    color: #2B2017;
}

.mention-item:hover {
    background: #FFF7F0;
    color: #E8722B;
}

    /* Queue */
    #cs-mod .cs-list{border-right:1px solid var(--line);display:flex;flex-direction:column;min-width:0;background:var(--canvas,#F4EFE7)}
    #cs-mod .cs-list-hd{padding:18px 16px 8px;background:var(--canvas,#F4EFE7);position:sticky;top:0;z-index:2}
    #cs-mod .cs-list-hd h2{font-size:22px;font-weight:600;margin:0 0 2px}
    #cs-mod .cs-list-sub{font-size:13px;color:var(--muted)}
    #cs-mod .cs-chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 16px 10px;background:var(--canvas,#F4EFE7);position:sticky;top:72px;z-index:2;border-bottom:1px solid var(--line)}
    #cs-mod .cs-chip{font-family:inherit;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:#5b5249;cursor:pointer}
    #cs-mod .cs-chip:hover{background:#fff}
    #cs-mod .cs-chip.on{background:#F5E5DA;border-color:#ECCDBC;color:#9A4A2B}
    #cs-mod .cs-rows{overflow:auto;flex:1;padding:8px 12px 16px}
    #cs-mod .cs-row{background:var(--surface);border:1px solid #F0E8DA;border-radius:12px;padding:12px 13px;margin-bottom:8px;cursor:pointer;box-shadow:0 1px 2px rgba(58,40,24,.04);transition:box-shadow .12s,transform .12s}
    #cs-mod .cs-row:hover{transform:translateY(-1px);box-shadow:0 2px 8px rgba(58,40,24,.08)}
    #cs-mod .cs-row.on{box-shadow:0 0 0 2px var(--orange,#E8722B),0 8px 24px rgba(58,40,24,.08)}
    #cs-mod .cs-row-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}
    #cs-mod .cs-name{font-size:15px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #cs-mod .cs-dl{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;flex:none;white-space:nowrap}
    #cs-mod .cs-dl.ok{background:#E1F5EE;color:#0F6E56}
    #cs-mod .cs-dl.soon{background:#FBF3DD;color:#8A6A1E}
    #cs-mod .cs-dl.urgent{background:#FCEBEB;color:#A32D2D}
    #cs-mod .cs-dl.over{background:#ECECEA;color:#6B6B66}
    #cs-mod .cs-subj{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
    #cs-mod .cs-snip{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #cs-mod .cs-row-foot{display:flex;align-items:center;gap:8px;margin-top:8px}
    #cs-mod .cs-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.03em}
    #cs-mod .cs-badge.amazon{background:#FFE8CC;color:#C26100}
    #cs-mod .cs-badge.ebay{background:#E8F0FE;color:#1A4FB5}
    #cs-mod .cs-badge.shopify{background:#E1F5EE;color:#0F6E56}
    #cs-mod .cs-cat{font-size:11px;color:var(--soft);margin-left:auto}

    /* Workspace */
    #cs-mod .cs-work{display:flex;flex-direction:column;min-width:0;background:var(--canvas,#F4EFE7);overflow:hidden}
    #cs-mod .cs-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:15px;padding:32px;text-align:center}
    #cs-mod .cs-case{display:none;flex:1;flex-direction:column;min-height:0}
    #cs-mod .cs-case.show{display:flex}
    #cs-mod .cs-case-hd{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}
    #cs-mod .cs-case-hd h2{font-size:20px;font-weight:600;margin:0;flex:1;line-height:1.25}
    #cs-mod .cs-case-meta{font-size:13px;color:var(--muted);margin-top:4px}
    #cs-mod .cs-reassign{font-family:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--surface);cursor:pointer;display:inline-flex;align-items:center;gap:6px;color:#5b5249}
    #cs-mod .cs-reassign:hover{background:#fff;border-color:#ECCDBC;color:#9A4A2B}

    #cs-mod .cs-body{flex:1;display:grid;grid-template-columns:1fr 320px;min-height:0;overflow:hidden}
    @media(max-width:1200px){#cs-mod .cs-body{grid-template-columns:1fr}}
    #cs-mod .cs-thread-col{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line)}
    #cs-mod .cs-thread{flex:1;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
    #cs-mod .cs-msg{max-width:92%}
    #cs-mod .cs-msg.in{align-self:flex-start}
    #cs-mod .cs-msg.out{align-self:flex-end}
    #cs-mod .cs-msg-bubble{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:11px 14px;font-size:14px;line-height:1.55;box-shadow:0 1px 2px rgba(58,40,24,.04)}
    #cs-mod .cs-msg.out .cs-msg-bubble{background:#FFF7F0;border-color:#F0CDB4}
    #cs-mod .cs-msg-meta{font-size:11.5px;color:var(--soft);margin-bottom:4px;display:flex;gap:8px}
    #cs-mod .cs-msg-meta .who{font-weight:600;color:var(--muted)}
    #cs-mod .cs-tabs { display: flex; gap: 20px; padding: 8px 18px 0; border-top: 1px solid var(--line); border-bottom: 1px solid #EAE4D9; background: var(--surface); }
#cs-mod .cs-tab-btn { background: none; border: none; padding: 8px 4px; font-weight: 600; color: var(--muted); cursor: pointer; font-size: 13px; }
#cs-mod .cs-tab-btn.active { color: var(--orange); border-bottom: 2px solid var(--orange); }
#cs-mod .cs-tab-content textarea { width: 100%; border: none; padding: 12px 18px; background: transparent; outline: none; box-sizing: border-box; font-family: inherit; }
    #cs-mod .cs-compose{border-top:1px solid var(--line);padding:12px 14px;background:var(--surface);flex-shrink:0}
    #cs-mod .cs-compose textarea{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-family:inherit;font-size:14px;resize:vertical;min-height:72px;outline:none;background:#fff}
    #cs-mod .cs-compose textarea:focus{border-color:var(--orange,#E8722B)}
    #cs-mod .cs-compose-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px}
    #cs-mod .cs-btn-send{font-family:inherit;font-size:14px;font-weight:700;padding:10px 18px;border:none;border-radius:10px;background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;cursor:pointer;box-shadow:0 4px 12px rgba(232,114,43,.25)}
    #cs-mod .cs-btn-send:disabled{opacity:.5;cursor:not-allowed}

    #cs-mod .cs-side{overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px;background:#FBFAF7}
    #cs-mod .cs-panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 1px 2px rgba(58,40,24,.04)}
    #cs-mod .cs-panel h3{font-size:15px;font-weight:600;margin:0 0 10px;display:flex;align-items:center;gap:7px}
    #cs-mod .cs-panel h3 i{color:var(--orange,#E8722B);font-size:17px}
    #cs-mod .cs-kv{display:grid;grid-template-columns:110px 1fr;gap:6px 10px;font-size:13.5px;margin-bottom:4px}
    #cs-mod .cs-kv .k{color:var(--muted)}
    #cs-mod .cs-kv .v{font-weight:500;word-break:break-word}
    #cs-mod .cs-order-items{margin-top:8px;border-top:1px solid var(--line);padding-top:8px}
    #cs-mod .cs-order-line{display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:4px 0;border-bottom:1px dashed #F0E8DA}
    #cs-mod .cs-order-line:last-child{border-bottom:none}
   <!-- #cs-mod .cs-notes-label{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8A6A1E;margin-bottom:6px}
    #cs-mod .cs-notes textarea{width:100%;box-sizing:border-box;border:1px solid #EDD9A6;border-radius:10px;padding:9px 11px;font-family:inherit;font-size:13.5px;min-height:80px;resize:vertical;background:#FFFDF7;outline:none}
    #cs-mod .cs-notes-hint{font-size:12px;color:var(--soft);margin-top:6px;font-style:italic}-->
    /* Style for the new inline section */
#cs-mod .cs-notes-inline {
  padding: 12px 18px;
  background: #FFFDF7; /* Matches your note panel theme */
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

#cs-mod .cs-notes-inline textarea {
  width: 100%;
  border: 1px solid #EDD9A6;
  border-radius: 10px;
  padding: 8px;
  margin-top: 6px;
  min-height: 60px;
}
    #cs-mod .cs-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2B2017;color:#fff;font-size:13.5px;padding:10px 16px;border-radius:10px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:50}
    #cs-mod .cs-toast.show{opacity:1}
    #cs-mod .cs-loading{padding:24px;text-align:center;color:var(--muted);font-size:14px}
  </style>

  <div class="cswrap">
    <nav class="cs-nav" id="csNav">
      <div class="cs-nav-brand">CS</div>
      <button type="button" class="cs-nav-item on" data-view="my-work"><i class="ti ti-inbox"></i> My Work</button>
      <div class="cs-nav-sp"></div>
    </nav>

    <section class="cs-list">
      <div class="cs-list-hd">
        <h2 id="csListTitle">My Work</h2>
        <div class="cs-list-sub" id="csListSub">Your assigned cases</div>
      </div>
      <div class="cs-chips" id="csChips">
        <button type="button" class="cs-chip on" data-filter="all">All</button>
        <button type="button" class="cs-chip" data-filter="returns">Returns</button>
        <button type="button" class="cs-chip" data-filter="item_not_received">Item not received</button>
        <button type="button" class="cs-chip" data-filter="claims">Claims</button>
        <button type="button" class="cs-chip" data-filter="unsorted">Unsorted</button>
      </div>
      <div class="cs-rows" id="csRows"><div class="cs-loading">Loading queue…</div></div>
    </section>

    <section class="cs-work">
      <div class="cs-empty" id="csEmpty">Select a case from the queue to open the workspace.</div>
      <div class="cs-case" id="csCase">
        <header class="cs-case-hd">
          <div style="min-width:0;flex:1">
            <h2 id="csCaseTitle">—</h2>
            <div class="cs-case-meta" id="csCaseMeta"></div>
          </div>
          <button type="button" class="cs-reassign" id="csReassign"><i class="ti ti-user-share"></i> Reassign</button>
        </header>
        <div class="cs-body">
        <div class="cs-thread-col">
  <div class="cs-thread" id="csThread"></div>
  
  <div class="cs-composer-wrapper">
    <div class="cs-tabs">
      <button type="button" class="cs-tab-btn active" data-target="reply">Reply</button>
      <button type="button" class="cs-tab-btn" data-target="note">Note</button>
    </div>

    <form id="csCompose">
      <div class="cs-tab-content" id="csTabReply">
        <textarea id="csReply" placeholder="Write your reply to the customer…" rows="3"></textarea>
        <div class="cs-composer-actions">
    <button type="button" onclick="$('#fileInput').click()" title="Attach image">
      <i class="ti ti-paperclip"></i>
    </button>
    <input type="file" id="fileInput" hidden multiple accept="image/*">
    
    <span class="cs-ai-hint">⚡ AI ready</span>
    </div>
      </div>
      <div class="cs-tab-content" id="csTabNote" style="display:none;">
        <textarea id="csNotes" placeholder="Add internal context for the team…" rows="3"></textarea>
      </div>

      <div class="cs-compose-foot">
        <button type="submit" class="cs-btn-send" id="csSendBtn"><i class="ti ti-send"></i> Send</button>
      </div>
    </form>
  </div>
</div>
          <aside class="cs-side">
            <div class="cs-panel" id="csOrderPanel">
              <h3><i class="ti ti-package"></i> Linnworks order</h3>
              <div id="csOrderBody"></div>
            </div>
           <!-- <div class="cs-panel cs-notes">
              <h3><i class="ti ti-note"></i> Internal notes</h3>
              <div class="cs-notes-label">Customer can't see this</div>
              <textarea id="csNotes" placeholder="Add internal context for the team…"></textarea>
              <div class="cs-notes-hint">Saved locally for now — wire to API later.</div>
            </div> -->
            <div class="cs-panel">
              <h3><i class="ti ti-info-circle"></i> Case details</h3>
              <div id="csDetails"></div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  </div>
  <div class="cs-toast" id="csToast"></div>
</div>`;
  },

  async mount(el) {
    const $ = (s) => el.querySelector(s);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const textareas = [$('#csReply'), $('#csNotes')];
    // Add to your mount(el) function
const agents = ['Alex Morgan', 'Sam Patel', 'Jordan Lee', 'Dhruv', 'Sitar']; // Your team

// Add event listener to textareas
[ $('#csReply'), $('#csNotes') ].forEach(area => {
    area.addEventListener('keyup', (e) => {
        // Detect if user typed '@'
        if (e.key === '@') {
            showMentionDropdown(area);
        }
    });
});

function showMentionDropdown(targetArea) {
    // Create dropdown div if it doesn't exist
    let dropdown = document.querySelector('.mention-dropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'mention-dropdown';
        document.body.appendChild(dropdown);
    }

    // Populate dropdown with agents
    dropdown.innerHTML = agents.map(name => 
        `<div class="mention-item" data-name="${name}">${name}</div>`
    ).join('');

    // Position it near the textarea (simplified)
    const rect = targetArea.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.top + 50}px`;
    dropdown.style.display = 'block';

    // Handle selection
    dropdown.onclick = (e) => {
        const name = e.target.dataset.name;
        if (name) {
            targetArea.value = targetArea.value.replace(/@$/, `@${name} `);
            dropdown.style.display = 'none';
        }
    };
}
    textareas.forEach(ta => {
  ta.addEventListener('keyup', (e) => {
    const val = ta.value;
    
    // Trigger @Mentions
    if (val.endsWith('@')) {
      showMentionsDropdown(ta);
    }
    
    // Trigger /Shortcuts
    if (val.endsWith('/')) {
      showSavedReplies(ta);
    }
  });
});
    const FILTER_LABELS = {
      returns: 'Returns',
      item_not_received: 'Item not received',
      claims: 'Claims',
      unsorted: 'Unsorted',
    };
    const PLATFORM_LABELS = { amazon: 'Amazon', ebay: 'eBay', shopify: 'Shopify' };
    const AGENTS = ['Alex Morgan', 'Sam Patel', 'Jordan Lee', 'You'];

    // --- Sample data (replace via fetchQueue / fetchCase) ---
    const SAMPLE_QUEUE = [
      { id: 'cs-1001', customer: 'Emma Richardson', subject: 'Return label not received', snippet: 'Hi, I requested a return 3 days ago but haven\'t got the label yet…', category: 'returns', platform: 'amazon', deadlineAt: hoursFromNow(5.5), caseRef: 'AMZ-88421' },
      { id: 'cs-1002', customer: 'James O\'Connor', subject: 'Parcel marked delivered — not here', snippet: 'Tracking says delivered yesterday but nothing on my doorstep.', category: 'item_not_received', platform: 'ebay', deadlineAt: hoursFromNow(1.2), caseRef: 'EBY-55201' },
      { id: 'cs-1003', customer: 'Priya Shah', subject: 'Damaged item — claim photos attached', snippet: 'The box was crushed and the product is unusable. Photos attached.', category: 'claims', platform: 'shopify', deadlineAt: hoursFromNow(18), caseRef: 'SHP-33109' },
      { id: 'cs-1004', customer: 'Michael Brooks', subject: 'Wrong size sent', snippet: 'Ordered medium, received large. Can I swap?', category: 'returns', platform: 'shopify', deadlineAt: hoursFromNow(-2), caseRef: 'SHP-33144' },
      { id: 'cs-1005', customer: 'Unknown sender', subject: 'Question about order', snippet: 'Can someone call me about my order please?', category: 'unsorted', platform: 'amazon', deadlineAt: hoursFromNow(26), caseRef: 'AMZ-88502' },
      { id: 'cs-1006', customer: 'Lisa Chen', subject: 'Refund status update', snippet: 'Return received at warehouse — when will refund hit?', category: 'claims', platform: 'ebay', deadlineAt: hoursFromNow(3.8), caseRef: 'EBY-55288' },
    ];

    const SAMPLE_DETAILS = {
      'cs-1001': {
        thread: [
          { dir: 'in', who: 'Emma Richardson', at: 'Today 09:14', body: 'Hi, I requested a return 3 days ago but haven\'t got the label yet. Order AMZ-88421.' },
          { dir: 'out', who: 'Alex Morgan', at: 'Today 09:42', body: 'Sorry about the delay — I\'m generating your label now and will email it within the hour.' },
          { dir: 'in', who: 'Emma Richardson', at: 'Today 11:05', body: 'Still nothing in my inbox. Can you resend?' },
        ],
        order: { ref: 'LW-992814', external: 'AMZ-88421', status: 'Dispatched', customer: 'Emma Richardson', address: '14 Oak Lane, Leeds LS1 4AB', items: [{ sku: 'FK-JER-M-BLU', name: 'FK Home Jersey — M Blue', qty: 1, price: '£34.99' }], total: '£34.99' },
        details: { status: 'Awaiting return label', priority: 'Normal', opened: '18 Jun 2026', channel: 'Amazon messages', assignee: 'You' },
        notes: 'Customer prefers email over phone. Label gen failed once — retry via Linnworks.',
      },
      'cs-1002': {
        thread: [
          { dir: 'in', who: 'James O\'Connor', at: 'Yesterday 16:20', body: 'Tracking says delivered yesterday but nothing on my doorstep. EBY-55201.' },
          { dir: 'out', who: 'You', at: 'Yesterday 17:01', body: 'I\'m checking with the carrier and will update you within 24 hours.' },
        ],
        order: { ref: 'LW-991002', external: 'EBY-55201', status: 'Delivered (disputed)', customer: 'James O\'Connor', address: '8 River View, Dublin D02', items: [{ sku: 'FK-CAP-OS-BLK', name: 'FK Cap — One Size Black', qty: 1, price: '€22.50' }], total: '€22.50' },
        details: { status: 'Investigation', priority: 'High', opened: '17 Jun 2026', channel: 'eBay messages', assignee: 'You' },
        notes: 'Open carrier trace before refund.',
      },
      'cs-1003': {
        thread: [
          { dir: 'in', who: 'Priya Shah', at: 'Today 08:30', body: 'The box was crushed and the product is unusable. Photos attached in Shopify inbox.' },
        ],
        order: { ref: 'LW-990441', external: 'SHP-33109', status: 'Delivered', customer: 'Priya Shah', address: '22 Maple Close, Manchester M1 2PQ', items: [{ sku: 'FK-BTL-750', name: 'FK Water Bottle 750ml', qty: 2, price: '£19.98' }], total: '£19.98' },
        details: { status: 'Claim review', priority: 'Normal', opened: '18 Jun 2026', channel: 'Shopify inbox', assignee: 'You' },
        notes: '',
      },
      'cs-1004': {
        thread: [
          { dir: 'in', who: 'Michael Brooks', at: '16 Jun 2026', body: 'Ordered medium, received large. Can I swap without paying return postage?' },
          { dir: 'out', who: 'Sam Patel', at: '17 Jun 2026', body: 'We can send a prepaid label — please confirm you still have the item.' },
        ],
        order: { ref: 'LW-989771', external: 'SHP-33144', status: 'Delivered', customer: 'Michael Brooks', address: '5 Hill Street, Bristol BS1 5TR', items: [{ sku: 'FK-TEE-L-GRY', name: 'FK Tee — L Grey (sent)', qty: 1, price: '£28.00' }], total: '£28.00' },
        details: { status: 'Overdue follow-up', priority: 'High', opened: '15 Jun 2026', channel: 'Shopify inbox', assignee: 'You' },
        notes: 'Wrong pick confirmed in Linnworks.',
      },
      'cs-1005': {
        thread: [{ dir: 'in', who: 'Unknown sender', at: 'Today 07:55', body: 'Can someone call me about my order please? I don\'t have the order number handy.' }],
        order: { ref: '—', external: 'AMZ-88502', status: 'Unknown', customer: '—', address: '—', items: [], total: '—' },
        details: { status: 'Unsorted', priority: 'Low', opened: '18 Jun 2026', channel: 'Amazon messages', assignee: 'You' },
        notes: 'Needs triage — ask for order ID.',
      },
      'cs-1006': {
        thread: [
          { dir: 'in', who: 'Lisa Chen', at: 'Today 10:22', body: 'Return received at warehouse — when will refund hit my eBay account?' },
        ],
        order: { ref: 'LW-988120', external: 'EBY-55288', status: 'Return received', customer: 'Lisa Chen', address: 'Unit 3, Birmingham B5 4ST', items: [{ sku: 'FK-SOCK-3PK', name: 'FK Socks 3-pack', qty: 1, price: '£12.99' }], total: '£12.99' },
        details: { status: 'Refund pending', priority: 'Normal', opened: '18 Jun 2026', channel: 'eBay messages', assignee: 'You' },
        notes: 'Refund queued in finance — ETA 2 business days.',
      },
    };

    function showMentionsDropdown(ta) {
  // Logic to show a floating <ul> of AGENTS near the cursor
  // When item clicked, insert 'Agent Name ' into textarea
  toast('Showing team members...');
}
    function hoursFromNow(h) {
      return new Date(Date.now() + h * 3600000).toISOString();
    }

    async function fetchQueue() {
      return SAMPLE_QUEUE.slice();
    }

    async function fetchCase(id) {
      return SAMPLE_DETAILS[id] || null;
    }

    let queue = [];
    let filter = 'all';
    let selectedId = null;
    let tickTimer = null;

    function toast(msg) {
      const t = $('#csToast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2200);
    }

    function deadlineInfo(iso) {
      const ms = new Date(iso).getTime() - Date.now();
      const abs = Math.abs(ms);
      const h = Math.floor(abs / 3600000);
      const m = Math.floor((abs % 3600000) / 60000);
      const part = h > 0 ? `${h}h ${m}m` : `${m}m`;
      if (ms < 0) return { text: `${part} overdue`, cls: 'over' };
      if (ms < 3600000) return { text: `${part} left`, cls: 'urgent' };
      if (ms < 14400000) return { text: `${part} left`, cls: 'soon' };
      return { text: `${part} left`, cls: 'ok' };
    }

    function filteredQueue() {
      if (filter === 'all') return queue;
      return queue.filter((c) => c.category === filter);
    }

    function rowHtml(c) {
      const dl = deadlineInfo(c.deadlineAt);
      const plat = PLATFORM_LABELS[c.platform] || c.platform;
      return `<article class="cs-row${selectedId === c.id ? ' on' : ''}" data-id="${esc(c.id)}">
        <div class="cs-row-top">
          <div class="cs-name">${esc(c.customer)}</div>
          <span class="cs-dl ${dl.cls}">${esc(dl.text)}</span>
        </div>
        <div class="cs-subj">${esc(c.subject)}</div>
        <div class="cs-snip">${esc(c.snippet)}</div>
        <div class="cs-row-foot">
          <span class="cs-badge ${esc(c.platform)}">${esc(plat)}</span>
          <span class="cs-cat">${esc(FILTER_LABELS[c.category] || c.category)}</span>
        </div>
      </article>`;
    }

    function renderQueue() {
      const rows = filteredQueue();
      $('#csListSub').textContent = rows.length + ' case' + (rows.length === 1 ? '' : 's') + ' in queue';
      if (!rows.length) {
        $('#csRows').innerHTML = '<div class="cs-loading">No cases in this filter.</div>';
        return;
      }
      $('#csRows').innerHTML = rows.map(rowHtml).join('');
      $('#csRows').querySelectorAll('.cs-row').forEach((row) => {
        row.addEventListener('click', () => openCase(row.dataset.id));
      });
    }

    function renderOrder(order) {
      if (!order) return '<div class="cs-kv"><span class="k">Status</span><span class="v">No order linked</span></div>';
      let items = '';
      if (order.items && order.items.length) {
        items = '<div class="cs-order-items">' + order.items.map((it) =>
          `<div class="cs-order-line"><span>${esc(it.qty)}× ${esc(it.name)}</span><span>${esc(it.price)}</span></div>`
        ).join('') + '</div>';
      }
      return `
        <div class="cs-kv"><span class="k">Linnworks</span><span class="v">${esc(order.ref)}</span></div>
        <div class="cs-kv"><span class="k">External</span><span class="v">${esc(order.external)}</span></div>
        <div class="cs-kv"><span class="k">Status</span><span class="v">${esc(order.status)}</span></div>
        <div class="cs-kv"><span class="k">Customer</span><span class="v">${esc(order.customer)}</span></div>
        <div class="cs-kv"><span class="k">Ship to</span><span class="v">${esc(order.address)}</span></div>
        ${items}
        <div class="cs-kv" style="margin-top:8px"><span class="k">Total</span><span class="v">${esc(order.total)}</span></div>`;
    }

    function renderDetails(d) {
      if (!d) return '';
      return `
        <div class="cs-kv"><span class="k">Status</span><span class="v">${esc(d.status)}</span></div>
        <div class="cs-kv"><span class="k">Priority</span><span class="v">${esc(d.priority)}</span></div>
        <div class="cs-kv"><span class="k">Opened</span><span class="v">${esc(d.opened)}</span></div>
        <div class="cs-kv"><span class="k">Channel</span><span class="v">${esc(d.channel)}</span></div>
        <div class="cs-kv"><span class="k">Assignee</span><span class="v">${esc(d.assignee)}</span></div>`;
    }

    function renderThread(messages) {
      if (!messages || !messages.length) return '<div class="cs-loading">No messages yet.</div>';
      return messages.map((m) => `
        <div class="cs-msg ${esc(m.dir)}">
          <div class="cs-msg-meta"><span class="who">${esc(m.who)}</span><span>${esc(m.at)}</span></div>
          <div class="cs-msg-bubble">${esc(m.body)}</div>
        </div>`).join('');
    }

    async function openCase(id) {
      selectedId = id;
      renderQueue();
      const item = queue.find((c) => c.id === id);
      const detail = await fetchCase(id);
      if (!item || !detail) {
        toast('Could not load case.');
        return;
      }
    el.addEventListener('click', (e) => {
    const btn = e.target.closest('.cs-tab-btn');
    if (!btn) return;

    el.querySelectorAll('.cs-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const target = btn.dataset.target;
    $('#csTabReply').style.display = target === 'reply' ? 'block' : 'none';
    $('#csTabNote').style.display = target === 'note' ? 'block' : 'none';
    (target === 'reply' ? $('#csReply') : $('#csNotes')).focus();
  });
    
    el.querySelector('[data-target="reply"]').classList.add('active');
    $('#csTabReply').style.display = 'block';
    $('#csTabNote').style.display = 'none';
      $('#csEmpty').style.display = 'none';
      $('#csCase').classList.add('show');
      $('#csCaseTitle').textContent = item.subject;
      $('#csCaseMeta').textContent = item.customer + ' · ' + (PLATFORM_LABELS[item.platform] || item.platform) + ' · ' + item.caseRef;
      $('#csThread').innerHTML = renderThread(detail.thread);
      $('#csOrderBody').innerHTML = renderOrder(detail.order);
      $('#csDetails').innerHTML = renderDetails(detail.details);
      $('#csNotes').value = detail.notes || '';
      $('#csReply').value = '';
      const th = $('#csThread');
      th.scrollTop = th.scrollHeight;
    }

    async function loadQueue() {
      $('#csRows').innerHTML = '<div class="cs-loading">Loading queue…</div>';
      try {
        queue = await fetchQueue();
        queue.sort((a, b) => new Date(a.deadlineAt) - new Date(b.deadlineAt));
        renderQueue();
      } catch (e) {
        $('#csRows').innerHTML = '<div class="cs-loading" style="color:var(--red)">Failed to load queue.</div>';
      }
    }

    // Filter chips
    $('#csChips').querySelectorAll('.cs-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        filter = chip.dataset.filter;
        $('#csChips').querySelectorAll('.cs-chip').forEach((c) => c.classList.toggle('on', c === chip));
        renderQueue();
      });
    });

    // Reply
$('#csCompose').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = $('#fileInput');
    const formData = new FormData();
    formData.append('text', $('#csReply').value);
  if (fileInput.files.length > 0) {
    formData.append('attachment', fileInput.files[0]);
  }
  toast('Sending with attachments...');
    const activeBtn = el.querySelector('.cs-tab-btn.active');
    const activeTab = activeBtn ? activeBtn.dataset.target : 'reply';
    
    if (activeTab === 'reply') {
      const text = $('#csReply').value.trim();
      if (!text || !selectedId) return;
      const detail = await fetchCase(selectedId);
      detail.thread.push({ dir: 'out', who: 'You', at: 'Just now', body: text });
      $('#csThread').innerHTML = renderThread(detail.thread);
      $('#csReply').value = '';
      toast('Reply sent');
    } else {
      const text = $('#csNotes').value.trim();
      if (!selectedId) return;
      const detail = await fetchCase(selectedId);
      detail.notes = text;
      SAMPLE_DETAILS[selectedId] = detail;
      toast('Note saved');
    }
  });

    // Reassign
    $('#csReassign').addEventListener('click', () => {
      if (!selectedId) return;
      const others = AGENTS.filter((a) => a !== 'You');
      const pick = others[Math.floor(Math.random() * others.length)];
      toast('Reassigned to ' + pick + ' (sample)');
      // later: modal + POST /api/cs/cases/:id/reassign
    });

    // Notes (local for now)
    $('#csNotes').addEventListener('blur', async () => {
      if (!selectedId) return;
      const detail = await fetchCase(selectedId);
      if (detail) {
        detail.notes = $('#csNotes').value;
        SAMPLE_DETAILS[selectedId] = detail;
      }
    });

    // Countdown refresh
    tickTimer = setInterval(() => {
      if (document.hidden) return;
      renderQueue();
    }, 60000);

    await loadQueue();
  },

  unmount() {
    if (this._tickTimer) clearInterval(this._tickTimer);
  },
};