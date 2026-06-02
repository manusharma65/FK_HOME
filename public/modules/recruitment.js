// FK Home — Recruitment module (r0.26)
// ----------------------------------------------------------------------------
// Hiring pipeline. Landing = openings list. Open one = Kanban board (drag cards
// between stage columns on desktop, with a backup "Move to" menu). Click a card
// = candidate detail (notes, source, salary, actions). Tracking only.
// Stages: sourced → screening → interview → offer → hired
//         + standby (visible holding column) + rejected (tucked away, with reason)
// Buttons are full-size with plain labels (no tiny icon-only controls).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['recruitment'] = {
  title: 'Recruitment',

  render() {
    return '<div id="rec-mod" class="fk-mod">' +
      '<style>' +
        '#rec-mod .rec-help{font-size:13px;color:var(--soft);background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:10px 13px;margin:12px 0 16px}' +
        '#rec-mod .rec-open-card{background:var(--surface);border:0.5px solid var(--line);border-radius:10px;padding:15px 17px;margin-bottom:10px;cursor:pointer}' +
        '#rec-mod .rec-open-card:hover{border-color:var(--ink)}' +
        '#rec-mod .rec-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}' +
        '#rec-mod .rec-chip{font-size:11px;background:var(--bg2,#F1EFE8);padding:3px 9px;border-radius:99px;color:var(--muted)}' +
        '#rec-mod .rec-chip.hired{background:#E1F5EE;color:#0F6E56}' +
        '#rec-mod .rec-btn{padding:10px 15px;font-size:14px;border-radius:8px;border:0.5px solid var(--line);background:var(--surface);cursor:pointer}' +
        '#rec-mod .rec-btn:hover{background:var(--hover,#F1EFE8)}' +
        '#rec-mod .rec-btn.primary{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}' +
        '#rec-mod .rec-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}' +
        '#rec-mod .rec-col{min-width:200px;width:200px;flex:none;background:var(--bg2,#F4F2EC);border-radius:10px;padding:10px}' +
        '#rec-mod .rec-col-head{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px;display:flex;justify-content:space-between}' +
        '#rec-mod .rec-cand{background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:11px 12px;margin-bottom:8px;cursor:grab}' +
        '#rec-mod .rec-cand:hover{border-color:var(--ink)}' +
        '#rec-mod .rec-cand.dragging{opacity:.5}' +
        '#rec-mod .rec-col.drop-target{outline:2px dashed var(--ink);outline-offset:-2px}' +
        '#rec-mod .rec-cand-name{font-size:14px;font-weight:500}' +
        '#rec-mod .rec-cand-sub{font-size:11px;color:var(--muted);margin-top:2px}' +
        '#rec-mod .rec-standby{background:#FFF8EC}' +
        '#rec-mod .rec-rejected-strip{margin-top:14px;border-top:0.5px solid var(--line);padding-top:12px}' +
        '#rec-mod .rec-rej-row{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);padding:7px 0}' +
        '#rec-mod .rec-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:1000}' +
        '#rec-mod .rec-modal{background:var(--surface);border-radius:12px;padding:20px 22px;max-width:480px;width:92%;max-height:86vh;overflow-y:auto}' +
        '#rec-mod .rec-field{margin-bottom:11px}' +
        '#rec-mod .rec-field label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}' +
        '#rec-mod .rec-field input,#rec-mod .rec-field select,#rec-mod .rec-field textarea{width:100%;padding:9px 11px;border:0.5px solid var(--line);border-radius:7px;font-size:14px;font-family:inherit}' +
        '#rec-mod .rec-note{font-size:13px;background:var(--bg2,#F4F2EC);border-radius:7px;padding:8px 10px;margin-bottom:6px}' +
        '#rec-mod .rec-note-meta{font-size:11px;color:var(--muted);margin-top:3px}' +
        '#rec-mod .rec-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}' +
        '#rec-mod .rec-empty{text-align:center;color:var(--muted);padding:30px;font-size:14px}' +
      '</style>' +
      '<div id="recRoot"><div class="rec-empty">Loading\u2026</div></div>' +
      '<div id="recModalMount"></div>' +
    '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    const STAGE_LABEL = { sourced:'Sourced', screening:'Screening', interview:'Interview',
                          offer:'Offer', hired:'Hired', standby:'Standby' };
    const BOARD_STAGES = ['sourced','screening','interview','offer','standby','hired'];
    let view = { mode:'list', openingId:null };

    // ---------- openings list ----------
    async function loadList() {
      view = { mode:'list', openingId:null };
      try {
        const r = await fetch('/api/recruitment/openings', { credentials:'include' });
        if (r.status === 403) { $('recRoot').innerHTML = '<div class="rec-empty">Recruitment is for the HR team.</div>'; return; }
        const d = await r.json();
        const ops = d.openings || [];
        let html = '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<h2 style="margin:0">Recruitment</h2>' +
          '<button class="rec-btn primary" id="recNewOpening">+ New opening</button></div>' +
          '<div class="rec-help">Each open position holds its candidates on a board. Drag a candidate between columns as they progress. ' +
          'Click a candidate to add notes or record an outcome. <strong>Standby</strong> keeps a backup candidate; <strong>Rejected</strong> keeps a record with the reason.</div>';
        if (ops.length === 0) {
          html += '<div class="rec-empty">No open positions yet. Create one to start tracking candidates.</div>';
        } else {
          for (const o of ops) {
            const sc = o.stage_counts || {};
            let chips = '';
            for (const st of ['screening','interview','offer']) {
              if (sc[st]) chips += '<span class="rec-chip">' + sc[st] + ' ' + STAGE_LABEL[st].toLowerCase() + '</span>';
            }
            if (sc.standby) chips += '<span class="rec-chip">' + sc.standby + ' standby</span>';
            if (sc.hired) chips += '<span class="rec-chip hired">' + sc.hired + ' hired</span>';
            html += '<div class="rec-open-card" data-opening="' + o.id + '">' +
              '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<div><div style="font-size:15px;font-weight:500">' + esc(o.title) + '</div>' +
                '<div class="rec-cand-sub">' + (o.dept_name ? esc(o.dept_name) + ' \u00b7 ' : '') + (o.active_count||0) + ' active candidate' + ((o.active_count==1)?'':'s') + (o.status!=='open'?' \u00b7 closed':'') + '</div></div>' +
                '<i class="ti ti-chevron-right" style="font-size:18px;color:var(--muted)"></i>' +
              '</div>' +
              (chips ? '<div class="rec-chips">' + chips + '</div>' : '') +
            '</div>';
          }
        }
        $('recRoot').innerHTML = html;
      } catch (e) { console.error('[rec list]', e); $('recRoot').innerHTML = '<div class="rec-empty">Could not load.</div>'; }
    }

    // ---------- board for one opening ----------
    async function loadBoard(openingId) {
      view = { mode:'board', openingId };
      try {
        const r = await fetch('/api/recruitment/openings/' + openingId, { credentials:'include' });
        const d = await r.json();
        if (!r.ok) { $('recRoot').innerHTML = '<div class="rec-empty">Could not load this opening.</div>'; return; }
        const op = d.opening; const bs = d.byStage;
        let cols = '';
        for (const st of BOARD_STAGES) {
          const cands = bs[st] || [];
          cols += '<div class="rec-col" data-stage="' + st + '">' +
            '<div class="rec-col-head"><span>' + STAGE_LABEL[st] + '</span><span>' + cands.length + '</span></div>' +
            cands.map(candCard).join('') +
          '</div>';
        }
        const rejected = (bs.rejected || []).concat(bs.dropped || []);
        let rejHtml = '';
        if (rejected.length) {
          rejHtml = '<div class="rec-rejected-strip"><div style="cursor:pointer;font-size:13px;font-weight:500" id="recRejToggle">Rejected (' + rejected.length + ') \u25b8</div>' +
            '<div id="recRejList" style="display:none;margin-top:8px">' +
            rejected.map(c => { const m=c.meta||{}; return '<div class="rec-rej-row"><span>' + esc(c.title) + '</span><span>' + esc(m.reject_reason||'no reason') + (m.reject_stage?' \u00b7 at '+esc(STAGE_LABEL[m.reject_stage]||m.reject_stage):'') + '</span></div>'; }).join('') +
            '</div></div>';
        }
        $('recRoot').innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
            '<div><div style="font-size:13px;color:var(--muted);cursor:pointer" id="recBack">\u2190 All openings</div>' +
            '<h2 style="margin:4px 0 0">' + esc(op.title) + '</h2></div>' +
            '<button class="rec-btn primary" id="recAddCand">+ Add candidate</button>' +
          '</div>' +
          '<div class="rec-help">Drag a candidate to the next column as they progress. Click a candidate to open their details, add notes, or record an outcome.</div>' +
          '<div class="rec-board">' + cols + '</div>' + rejHtml;
        wireBoard(openingId);
      } catch (e) { console.error('[rec board]', e); $('recRoot').innerHTML = '<div class="rec-empty">Could not load.</div>'; }
    }

    function candCard(c) {
      const m = c.meta || {};
      const sub = [m.source, m.salary_expectation].filter(Boolean).join(' \u00b7 ');
      const standbyNote = (m.stage === 'standby' && m.standby_note) ? '<div class="rec-cand-sub" style="font-style:italic">' + esc(m.standby_note) + '</div>' : '';
      return '<div class="rec-cand' + (m.stage==='standby'?' rec-standby':'') + '" draggable="true" data-cand="' + c.id + '">' +
        '<div class="rec-cand-name">' + esc(c.title) + '</div>' +
        (sub ? '<div class="rec-cand-sub">' + esc(sub) + '</div>' : '') + standbyNote +
      '</div>';
    }

    function wireBoard(openingId) {
      $('recBack').onclick = loadList;
      $('recAddCand').onclick = () => openAddCandidate(openingId);
      const rejT = $('recRejToggle');
      if (rejT) rejT.onclick = () => { const l = $('recRejList'); l.style.display = l.style.display==='none'?'block':'none'; };

      // drag and drop
      let dragId = null;
      el.querySelectorAll('.rec-cand').forEach(card => {
        card.addEventListener('dragstart', () => { dragId = card.getAttribute('data-cand'); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('click', () => openCandidate(card.getAttribute('data-cand'), openingId));
      });
      el.querySelectorAll('.rec-col').forEach(col => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-target'); });
        col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
        col.addEventListener('drop', async (e) => {
          e.preventDefault(); col.classList.remove('drop-target');
          const stage = col.getAttribute('data-stage');
          if (!dragId) return;
          if (stage === 'standby') { openStandby(dragId, openingId); return; }
          if (stage === 'hired') { if (!confirm('Mark as hired? This flags them ready to onboard — you then create their employee record to start onboarding.')) return; }
          await moveCandidate(dragId, stage, openingId);
        });
      });
    }

    async function moveCandidate(id, stage, openingId, extra) {
      try {
        const body = Object.assign({ stage }, extra || {});
        const r = await fetch('/api/recruitment/candidates/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
        if (!r.ok) { alert('Could not move candidate'); return; }
        const d = await r.json();
        if (d.ready_to_onboard) alert('Marked hired and ready to onboard. Create their employee record (Admin \u2192 People) to start onboarding.');
        await loadBoard(openingId);
      } catch (e) { alert('Network error'); }
    }

    // ---------- modals ----------
    function modal(html) {
      $('recModalMount').innerHTML = '<div class="rec-modal-bg" id="recModalBg"><div class="rec-modal">' + html + '</div></div>';
      $('recModalBg').addEventListener('click', (e) => { if (e.target.id==='recModalBg') closeModal(); });
    }
    function closeModal() { $('recModalMount').innerHTML = ''; }

    function openAddOpening() {
      modal('<h3 style="margin:0 0 14px">New opening</h3>' +
        '<div class="rec-field"><label>Role title</label><input id="recOpTitle" placeholder="e.g. Amazon PPC Agent" /></div>' +
        '<div class="rec-field"><label>Platform (optional)</label><input id="recOpPlatform" placeholder="Naukri / LinkedIn / Indeed" /></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recOpCancel">Cancel</button><button class="rec-btn primary" id="recOpSave">Create opening</button></div>');
      $('recOpCancel').onclick = closeModal;
      $('recOpSave').onclick = async () => {
        const title = $('recOpTitle').value.trim(); if (!title) { $('recOpTitle').focus(); return; }
        const r = await fetch('/api/recruitment/openings', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ title, platform: $('recOpPlatform').value.trim()||null }) });
        if (!r.ok) { alert('Could not create'); return; }
        closeModal(); await loadList();
      };
    }

    function openAddCandidate(openingId) {
      modal('<h3 style="margin:0 0 14px">Add candidate</h3>' +
        '<div class="rec-field"><label>Name</label><input id="recCName" placeholder="Candidate name" /></div>' +
        '<div class="rec-field"><label>Source</label><input id="recCSource" placeholder="Naukri / LinkedIn / referral" /></div>' +
        '<div class="rec-field"><label>Phone</label><input id="recCPhone" /></div>' +
        '<div class="rec-field"><label>Salary expectation</label><input id="recCSalary" placeholder="e.g. \u20b935k" /></div>' +
        '<div class="rec-field"><label>Notice period</label><input id="recCNotice" placeholder="e.g. 30 days" /></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recCCancel">Cancel</button><button class="rec-btn primary" id="recCSave">Add candidate</button></div>');
      $('recCCancel').onclick = closeModal;
      $('recCSave').onclick = async () => {
        const name = $('recCName').value.trim(); if (!name) { $('recCName').focus(); return; }
        const r = await fetch('/api/recruitment/openings/' + openingId + '/candidates', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
          body: JSON.stringify({ name, source:$('recCSource').value.trim()||null, phone:$('recCPhone').value.trim()||null, salary_expectation:$('recCSalary').value.trim()||null, notice_period:$('recCNotice').value.trim()||null }) });
        if (!r.ok) { alert('Could not add'); return; }
        closeModal(); await loadBoard(openingId);
      };
    }

    function openStandby(id, openingId) {
      modal('<h3 style="margin:0 0 14px">Move to Standby</h3>' +
        '<div class="rec-field"><label>Why standby? (e.g. backup to Priya)</label><input id="recSbNote" placeholder="Short note so you remember" /></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recSbCancel">Cancel</button><button class="rec-btn primary" id="recSbSave">Move to standby</button></div>');
      $('recSbCancel').onclick = closeModal;
      $('recSbSave').onclick = async () => { closeModal(); await moveCandidate(id, 'standby', openingId, { standby_note: $('recSbNote') ? '' : '' } ); };
      // capture note value before close
      $('recSbSave').onclick = async () => { const note = $('recSbNote').value.trim(); closeModal(); await moveCandidate(id, 'standby', openingId, { standby_note: note }); };
    }

    async function openCandidate(id, openingId) {
      const r = await fetch('/api/recruitment/openings/' + openingId, { credentials:'include' });
      const d = await r.json();
      let cand = null;
      for (const st of Object.keys(d.byStage||{})) { const f = (d.byStage[st]||[]).find(x=>String(x.id)===String(id)); if (f) cand = f; }
      if (!cand) { alert('Candidate not found'); return; }
      const m = cand.meta || {};
      const notes = Array.isArray(m.notes) ? m.notes : [];
      const fields = [['Source',m.source],['Phone',m.phone],['Salary expectation',m.salary_expectation],['Notice period',m.notice_period]]
        .filter(x=>x[1]).map(x=>'<div class="rec-cand-sub" style="font-size:13px">' + x[0] + ': ' + esc(x[1]) + '</div>').join('');
      const notesHtml = notes.length ? notes.map(n=>'<div class="rec-note">' + esc(n.text) + '<div class="rec-note-meta">' + esc(n.by_name||'') + ' \u00b7 ' + new Date(n.at).toLocaleDateString() + '</div></div>').join('') : '<div class="rec-cand-sub">No notes yet.</div>';
      modal('<h3 style="margin:0 0 4px">' + esc(cand.title) + '</h3>' +
        '<div style="margin-bottom:12px">' + fields + '</div>' +
        '<div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Notes</div>' +
        notesHtml +
        '<div class="rec-field" style="margin-top:10px"><textarea id="recNoteText" rows="2" placeholder="Add a note (e.g. good communication, available immediately)"></textarea></div>' +
        '<button class="rec-btn" id="recNoteSave" style="width:100%">Add note</button>' +
        '<div class="rec-actions" style="margin-top:18px;border-top:0.5px solid var(--line);padding-top:14px">' +
          '<button class="rec-btn" id="recCloseModal">Close</button>' +
          '<button class="rec-btn" id="recReject" style="color:#A32D2D">Reject candidate</button>' +
        '</div>');
      $('recCloseModal').onclick = closeModal;
      $('recNoteSave').onclick = async () => {
        const text = $('recNoteText').value.trim(); if (!text) return;
        const rr = await fetch('/api/recruitment/candidates/' + id + '/note', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ text }) });
        if (!rr.ok) { alert('Could not save note'); return; }
        openCandidate(id, openingId);
      };
      $('recReject').onclick = () => openReject(id, openingId);
    }

    function openReject(id, openingId) {
      modal('<h3 style="margin:0 0 14px">Reject candidate</h3>' +
        '<div class="rec-field"><label>Reason (kept on record)</label><input id="recRejReason" placeholder="e.g. not enough PPC experience" /></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recRejCancel">Cancel</button><button class="rec-btn primary" id="recRejSave" style="background:#A32D2D;border-color:#A32D2D">Reject</button></div>');
      $('recRejCancel').onclick = () => openCandidate(id, openingId);
      $('recRejSave').onclick = async () => {
        const reason = $('recRejReason').value.trim();
        const rr = await fetch('/api/recruitment/candidates/' + id + '/reject', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ reason }) });
        if (!rr.ok) { alert('Could not reject'); return; }
        closeModal(); await loadBoard(openingId);
      };
    }

    // root click delegation for list
    $('recRoot').addEventListener('click', (e) => {
      const opCard = e.target.closest('[data-opening]');
      if (opCard && view.mode === 'list') { loadBoard(parseInt(opCard.getAttribute('data-opening'),10)); return; }
      if (e.target.id === 'recNewOpening') openAddOpening();
    });

    await loadList();
  }
};
