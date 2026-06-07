// FK Home — Recruitment module (r0.27 frontend)
// Openings list -> board -> rich candidate card. Per-round outcomes, stage
// history, days-in-stage, CV/photo upload, reversible end (passed/withdrew),
// archived exits, edit/close/reopen opening.
window.fkModules = window.fkModules || {};

window.fkModules['recruitment'] = {
  title: 'Recruitment',
  render() {
    return '<div id="rec-mod" class="fk-mod">' +
      '<style>' +
        '#rec-mod{font-family:"Hanken Grotesk",-apple-system,sans-serif}' +
        '#rec-mod .rec-hero{position:relative;overflow:hidden;border-radius:22px;padding:24px 28px;color:#fff;margin:6px 0 18px;background:linear-gradient(115deg,#2A2421 0%,#3a2e25 48%,#7a3d18 100%);display:flex;align-items:center;justify-content:space-between;gap:16px}' +
        '#rec-mod .rec-hero:after{content:"";position:absolute;right:-60px;top:-90px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle at 30% 30%,rgba(243,153,46,.5),rgba(243,153,46,0) 70%)}' +
        '#rec-mod .rec-hero h1{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:30px;margin:0;position:relative}' +
        '#rec-mod .rec-hero-sub{margin:7px 0 0;color:#E8DDD2;font-size:14px;position:relative}' +
        '#rec-mod .rec-help{font-size:13.5px;line-height:1.5;color:#5b524a;background:#FBF0DC;border:1px solid #F0E2CE;border-radius:14px;padding:14px 16px;margin:0 0 20px}' +
        '#rec-mod .rec-open-card{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:18px 22px;margin-bottom:14px;cursor:pointer;box-shadow:0 2px 10px rgba(36,31,27,.04);transition:transform .14s,box-shadow .14s}' +
        '#rec-mod .rec-open-card:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(36,31,27,.08)}' +
        '#rec-mod .rec-open-title{font-family:"Fraunces",Georgia,serif;font-size:18px;font-weight:600}' +
        '#rec-mod .rec-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}' +
        '#rec-mod .rec-chip{font-size:11.5px;font-weight:600;background:#F2ECE2;padding:5px 12px;border-radius:99px;color:#5b524a}' +
        '#rec-mod .rec-chip.hired{background:#E1F5EE;color:#0F6E56}' +
        '#rec-mod .rec-btn{padding:10px 22px;font-size:14px;font-weight:600;border-radius:11px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;font-family:inherit;transition:transform .12s,box-shadow .12s}' +
        '#rec-mod .rec-btn:hover{transform:translateY(-1px)}' +
        '#rec-mod .rec-btn.primary{background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;border:0;box-shadow:0 4px 12px rgba(232,114,43,.25);white-space:nowrap}' +
        '#rec-mod .rec-btn.danger{color:#A32D2D}' +
        '#rec-mod .rec-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}' +
        '#rec-mod .rec-col{flex:1 1 0;min-width:120px;background:var(--bg2,#F4F2EC);border-radius:10px;padding:10px}' +
        '#rec-mod .rec-col-head{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px;display:flex;justify-content:space-between}' +
        '#rec-mod .rec-cand{background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:11px 12px;margin-bottom:8px;cursor:grab}' +
        '#rec-mod .rec-cand:hover{border-color:var(--ink)}' +
        '#rec-mod .rec-cand.dragging{opacity:.5}' +
        '#rec-mod .rec-col.drop-target{outline:2px dashed var(--ink);outline-offset:-2px}' +
        '#rec-mod .rec-cand-name{font-size:14px;font-weight:500}' +
        '#rec-mod .rec-cand-sub{font-size:11px;color:var(--muted);margin-top:2px}' +
        '#rec-mod .rec-cand-age{font-size:10px;color:var(--soft);margin-top:4px}' +
        '#rec-mod .rec-standby{background:#FFF8EC}' +
        '#rec-mod .rec-ended-strip{margin-top:14px;border-top:0.5px solid var(--line);padding-top:12px}' +
        '#rec-mod .rec-end-row{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);padding:8px 0;border-bottom:0.5px solid var(--line);gap:10px}' +
        '#rec-mod .rec-end-row .reopen{font-size:12px;color:#185FA5;cursor:pointer;flex:none}' +
        '#rec-mod .rec-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:1000}' +
        '#rec-mod .rec-modal{background:var(--surface);border-radius:12px;padding:20px 22px;max-width:520px;width:94%;max-height:88vh;overflow-y:auto}' +
        '#rec-mod .rec-modal-bare{background:var(--surface);border-radius:12px;padding:0;max-width:600px;width:94%;max-height:90vh;overflow:hidden auto}' +
        '#rec-mod .rec-chead{background:#185FA5;color:#fff;padding:20px 24px}' +
        '#rec-mod .rec-chead .kick{font-size:12px;text-transform:uppercase;letter-spacing:.05em;opacity:.92;display:flex;align-items:center;gap:6px}' +
        '#rec-mod .rec-chead .nm{font-size:23px;font-weight:500;margin-top:5px}' +
        '#rec-mod .rec-chead .src{font-size:13px;opacity:.92;margin-top:7px}' +
        '#rec-mod .rec-chead .cpill{font-size:13px;background:rgba(255,255,255,.92);color:#0C447C;padding:6px 14px;border-radius:99px;font-weight:500;flex:none}' +
        '#rec-mod .rec-cbody{padding:22px 24px}' +
        '#rec-mod .rec-empty-line{background:var(--bg2,#F4F2EC);border-radius:8px;padding:14px;text-align:center;font-size:13px;color:var(--soft)}' +
        '#rec-mod .rec-panel{background:var(--bg2,#F4F2EC);border-radius:8px;padding:13px 15px}' +
        '#rec-mod .rec-sec-h2{font-size:13px;font-weight:500;display:flex;align-items:center;gap:7px;margin-bottom:8px}' +
        '#rec-mod .rec-field{margin-bottom:11px}' +
        '#rec-mod .rec-field label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}' +
        '#rec-mod .rec-field input,#rec-mod .rec-field select,#rec-mod .rec-field textarea{width:100%;padding:9px 11px;border:0.5px solid var(--line);border-radius:7px;font-size:14px;font-family:inherit;box-sizing:border-box}' +
        '#rec-mod .rec-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
        '#rec-mod .rec-avatar{width:46px;height:46px;border-radius:50%;background:var(--bg2,#E6F1FB);color:#185FA5;display:flex;align-items:center;justify-content:center;font-weight:500;font-size:15px;flex:none}' +
        '#rec-mod .rec-kv{font-size:13px}' +
        '#rec-mod .rec-kv .k{font-size:11px;color:var(--muted)}' +
        '#rec-mod .rec-sec{border-top:0.5px solid var(--line);padding-top:12px;margin-top:14px}' +
        '#rec-mod .rec-sec-h{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}' +
        '#rec-mod .rec-why{background:var(--bg2,#F4F2EC);border-radius:8px;padding:9px 12px;font-size:13px;margin:10px 0 4px}' +
        '#rec-mod .rec-note{font-size:13px;background:var(--bg2,#F4F2EC);border-radius:7px;padding:8px 10px;margin-bottom:6px}' +
        '#rec-mod .rec-note-meta{font-size:11px;color:var(--muted);margin-top:3px}' +
        '#rec-mod .rec-file{display:flex;align-items:center;gap:9px;font-size:13px;padding:6px 0}' +
        '#rec-mod .rec-file .del{margin-left:auto;font-size:12px;color:#A32D2D;cursor:pointer}' +
        '#rec-mod .rec-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}' +
        '#rec-mod .rec-empty{text-align:center;color:var(--muted);padding:30px;font-size:14px}' +
        '#rec-mod .rec-pill{font-size:11px;background:var(--bg2,#F1EFE8);color:var(--muted);padding:4px 10px;border-radius:99px;flex:none}' +
      '</style>' +
      '<div id="recRoot"><div class="rec-empty">Loading\u2026</div></div>' +
      '<div id="recModalMount"></div>' +
    '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    const STAGE_LABEL = { sourced:'Sourced', screening:'Screening', interview:'Interview 1', interview_2:'Interview 2', offer:'Offer', accepted:'Accepted', joined:'Joined', standby:'Standby' };
    const BOARD_STAGES = ['sourced','screening','interview','interview_2','offer','accepted','joined','standby'];
    function daysAgo(iso){ if(!iso) return null; const d=Math.floor((Date.now()-new Date(iso).getTime())/86400000); return d; }
    function ageLabel(iso){ const d=daysAgo(iso); if(d==null) return ''; if(d<=0) return 'today'; return d+(d===1?' day':' days'); }

    // ---------- openings list ----------
    async function loadList() {
      try {
        const r = await fetch('/api/recruitment/openings', { credentials:'include' });
        if (r.status === 403) { $('recRoot').innerHTML = '<div class="rec-empty">Recruitment is for the HR team.</div>'; return; }
        const d = await r.json(); const ops = d.openings || [];
        let html = '<div class="rec-hero"><div><h1>Recruitment</h1><div class="rec-hero-sub">' + ops.length + ' open position' + (ops.length===1?'':'s') + '</div></div>' +
          '<button class="rec-btn primary" id="recNewOpening">+ New opening</button></div>' +
          '<div class="rec-help">Each open position holds its candidates on a board. Drag a candidate between columns as they progress; you\u2019ll be asked how the round went. Click a candidate for full details, files and notes.</div>';
        if (ops.length === 0) html += '<div class="rec-empty">No open positions yet. Create one to start tracking candidates.</div>';
        else for (const o of ops) {
          const sc = o.stage_counts || {}; let chips = '';
          for (const st of ['screening','interview','offer']) if (sc[st]) chips += '<span class="rec-chip">' + sc[st] + ' ' + STAGE_LABEL[st].toLowerCase() + '</span>';
          if (sc.standby) chips += '<span class="rec-chip">' + sc.standby + ' standby</span>';
          if (sc.hired) chips += '<span class="rec-chip hired">' + sc.hired + ' hired</span>';
          html += '<div class="rec-open-card" data-opening="' + o.id + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<div><div class="rec-open-title">' + esc(o.title) + (o.status!=='open'?' <span style="font-size:12px;font-weight:400;color:var(--muted)">(closed)</span>':'') + '</div>' +
              '<div class="rec-cand-sub">' + (o.dept_name ? esc(o.dept_name)+' \u00b7 ' : '') + (o.active_count||0) + ' active candidate' + ((o.active_count==1)?'':'s') + '</div></div>' +
              '<i class="ti ti-chevron-right" style="font-size:18px;color:var(--muted)"></i></div>' +
            (chips ? '<div class="rec-chips">' + chips + '</div>' : '') + '</div>';
        }
        $('recRoot').innerHTML = html;
      } catch (e) { console.error('[rec list]', e); $('recRoot').innerHTML = '<div class="rec-empty">Could not load.</div>'; }
    }

    // ---------- board ----------
    async function loadBoard(openingId) {
      try {
        const r = await fetch('/api/recruitment/openings/' + openingId, { credentials:'include' });
        const d = await r.json();
        if (!r.ok) { $('recRoot').innerHTML = '<div class="rec-empty">Could not load this opening.</div>'; return; }
        const op = d.opening, bs = d.byStage, ended = d.ended || [];
        const isClosed = op.status && op.status !== 'open';
        let cols = '';
        for (const st of BOARD_STAGES) {
          const cands = bs[st] || [];
          cols += '<div class="rec-col" data-stage="' + st + '">' +
            '<div class="rec-col-head"><span>' + STAGE_LABEL[st] + '</span><span>' + cands.length + '</span></div>' +
            cands.map(candCard).join('') + '</div>';
        }
        let endedHtml = '';
        if (ended.length) {
          endedHtml = '<div class="rec-ended-strip"><div style="cursor:pointer;font-size:13px;font-weight:500" id="recEndToggle">Ended / archived (' + ended.length + ') \u25b8</div>' +
            '<div id="recEndList" style="display:none;margin-top:8px">' +
            ended.map(c => { const m=c.meta||{}; const e=m.ended||{}; const how=e.how==='withdrew'?'they withdrew':'we passed';
              return '<div class="rec-end-row"><span>' + esc(c.title) + ' <span style="color:var(--soft)">\u2014 ' + how + (e.reason?': '+esc(e.reason):'') + '</span></span>' +
                '<span class="reopen" data-reopen="' + c.id + '">Bring back</span></div>'; }).join('') +
            '</div></div>';
        }
        $('recRoot').innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;gap:12px">' +
            '<div><div style="font-size:13px;color:var(--muted);cursor:pointer" id="recBack">\u2190 All openings</div>' +
            '<h2 style="margin:4px 0 0">' + esc(op.title) + (isClosed?' <span style="font-size:13px;font-weight:400;color:var(--muted)">(closed)</span>':'') + '</h2></div>' +
            '<div style="display:flex;gap:9px;flex-wrap:wrap">' +
              '<button class="rec-btn" id="recEditOpening">Edit</button>' +
              (isClosed ? '<button class="rec-btn" id="recReopenOpening">Reopen</button>' : '<button class="rec-btn" id="recCloseOpening">Close opening</button>') +
              '<button class="rec-btn primary" id="recAddCand">+ Add candidate</button>' +
            '</div></div>' +
          '<div class="rec-help">Drag a candidate to the next column \u2014 you\u2019ll be asked how that round went, so it\u2019s on record. Click a candidate for full details. <strong>Close opening</strong> when filled or cancelled (kept, not deleted).</div>' +
          '<div class="rec-board">' + cols + '</div>' + endedHtml;
        wireBoard(openingId, op);
      } catch (e) { console.error('[rec board]', e); $('recRoot').innerHTML = '<div class="rec-empty">Could not load.</div>'; }
    }

    function candCard(c) {
      const m = c.meta || {};
      const sub = [m.current_company, m.experience_years ? m.experience_years+'yr' : null].filter(Boolean).join(' \u00b7 ');
      const age = ageLabel(c.moved_at);
      const standbyNote = (m.stage==='standby' && m.standby_note) ? '<div class="rec-cand-sub" style="font-style:italic">' + esc(m.standby_note) + '</div>' : '';
      return '<div class="rec-cand' + (m.stage==='standby'?' rec-standby':'') + '" draggable="true" data-cand="' + c.id + '">' +
        '<div class="rec-cand-name">' + esc(c.title) + '</div>' +
        (sub ? '<div class="rec-cand-sub">' + esc(sub) + '</div>' : '') + standbyNote +
        (age ? '<div class="rec-cand-age">' + age + ' in ' + (STAGE_LABEL[m.stage]||m.stage||'stage').toLowerCase() + '</div>' : '') +
      '</div>';
    }

    function wireBoard(openingId, op) {
      $('recBack').onclick = loadList;
      $('recAddCand').onclick = () => openAddCandidate(openingId);
      const eb=$('recEditOpening'); if(eb) eb.onclick=()=>openEditOpening(op);
      const cb=$('recCloseOpening'); if(cb) cb.onclick=()=>setOpeningStatus(openingId,'cancelled','Close this opening? Candidates are kept; it moves out of the active list.');
      const rb=$('recReopenOpening'); if(rb) rb.onclick=()=>setOpeningStatus(openingId,'open',null);
      const et=$('recEndToggle'); if(et) et.onclick=()=>{const l=$('recEndList'); l.style.display=l.style.display==='none'?'block':'none';};
      el.querySelectorAll('[data-reopen]').forEach(x=>x.onclick=async()=>{ await fetch('/api/recruitment/candidates/'+x.getAttribute('data-reopen')+'/reopen',{method:'POST',credentials:'include'}); await loadBoard(openingId); });
      let dragId = null;
      el.querySelectorAll('.rec-cand').forEach(card => {
        card.addEventListener('dragstart', () => { dragId = card.getAttribute('data-cand'); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('click', () => openCandidate(card.getAttribute('data-cand'), openingId));
      });
      el.querySelectorAll('.rec-col').forEach(col => {
        col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('drop-target'); });
        col.addEventListener('dragleave', ()=>col.classList.remove('drop-target'));
        col.addEventListener('drop', async e=>{
          e.preventDefault(); col.classList.remove('drop-target');
          const stage = col.getAttribute('data-stage'); if(!dragId) return;
          if (stage==='standby') { openStandby(dragId, openingId); return; }
          if (stage==='accepted') { openAccepted(dragId, openingId); return; }
          if (stage==='joined') { openJoined(dragId, openingId); return; }
          openOutcome(dragId, stage, openingId);   // ask how the round went
        });
      });
    }

    async function setOpeningStatus(openingId, status, confirmMsg) {
      if (confirmMsg && !confirm(confirmMsg)) return;
      await fetch('/api/recruitment/openings/'+openingId, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ status }) });
      await loadBoard(openingId);
    }
    async function moveCandidate(id, stage, openingId, extra) {
      const r = await fetch('/api/recruitment/candidates/'+id, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(Object.assign({ stage }, extra||{})) });
      if (!r.ok) { alert('Could not move candidate'); return false; }
      await loadBoard(openingId);
      return true;
    }

    // ---------- modals ----------
    function modal(html){ $('recModalMount').innerHTML='<div class="rec-modal-bg" id="recModalBg"><div class="rec-modal">'+html+'</div></div>'; $('recModalBg').addEventListener('click',e=>{ if(e.target.id==='recModalBg') closeModal(); }); }
    function modalBare(html){ $('recModalMount').innerHTML='<div class="rec-modal-bg" id="recModalBg"><div class="rec-modal-bare">'+html+'</div></div>'; $('recModalBg').addEventListener('click',e=>{ if(e.target.id==='recModalBg') closeModal(); }); }
    function closeModal(){ $('recModalMount').innerHTML=''; }

    function openAddOpening() {
      modal('<h3 style="margin:0 0 14px">New opening</h3>' +
        '<div class="rec-field"><label>Role title</label><input id="recOpTitle" placeholder="e.g. Amazon PPC Agent" /></div>' +
        '<div class="rec-field"><label>Platform (optional)</label><input id="recOpPlatform" placeholder="Naukri / LinkedIn / Indeed" /></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recOpCancel">Cancel</button><button class="rec-btn primary" id="recOpSave">Create opening</button></div>');
      $('recOpCancel').onclick=closeModal;
      $('recOpSave').onclick=async()=>{ const title=$('recOpTitle').value.trim(); if(!title){$('recOpTitle').focus();return;}
        const r=await fetch('/api/recruitment/openings',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({title,platform:$('recOpPlatform').value.trim()||null})});
        if(!r.ok){alert('Could not create');return;} closeModal(); await loadList(); };
    }
    function openEditOpening(op) {
      modal('<h3 style="margin:0 0 14px">Edit opening</h3>' +
        '<div class="rec-field"><label>Role title</label><input id="recEoTitle" value="' + esc(op.title) + '" /></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recEoCancel">Cancel</button><button class="rec-btn primary" id="recEoSave">Save</button></div>');
      $('recEoCancel').onclick=closeModal;
      $('recEoSave').onclick=async()=>{ const title=$('recEoTitle').value.trim(); if(!title){$('recEoTitle').focus();return;}
        await fetch('/api/recruitment/openings/'+op.id,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({title})});
        closeModal(); await loadBoard(op.id); };
    }
    function openAddCandidate(openingId) {
      modal('<h3 style="margin:0 0 14px">Add candidate</h3>' +
        '<div class="rec-field"><label>Name</label><input id="recCName" placeholder="Candidate name" /></div>' +
        '<div class="rec-field"><label>Source</label><input id="recCSource" placeholder="Naukri / LinkedIn / referral" /></div>' +
        '<div class="rec-field"><label>Why shortlist? (experience, skills, fit)</label><textarea id="recCWhy" rows="2" placeholder="e.g. 3yr HR exp, payroll + onboarding, immediate joiner"></textarea></div>' +
        '<div style="font-size:11px;color:var(--soft);margin-bottom:12px">Salary, notice, CV &amp; photo come later \u2014 add them on the card as you learn them.</div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recCCancel">Cancel</button><button class="rec-btn primary" id="recCSave">Add candidate</button></div>');
      $('recCCancel').onclick=closeModal;
      $('recCSave').onclick=async()=>{ const name=$('recCName').value.trim(); if(!name){$('recCName').focus();return;}
        const r=await fetch('/api/recruitment/openings/'+openingId+'/candidates',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
          body:JSON.stringify({name,source:$('recCSource').value.trim()||null,why_shortlist:$('recCWhy').value.trim()||null})});
        if(!r.ok){alert('Could not add');return;} closeModal(); await loadBoard(openingId); };
    }
    function openStandby(id, openingId) {
      modal('<h3 style="margin:0 0 14px">Move to Standby</h3>' +
        '<div class="rec-field"><label>Why standby? (e.g. backup to Priya)</label><input id="recSbNote" placeholder="Short note so you remember" /></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recSbCancel">Cancel</button><button class="rec-btn primary" id="recSbSave">Move to standby</button></div>');
      $('recSbCancel').onclick=closeModal;
      $('recSbSave').onclick=async()=>{ const note=$('recSbNote').value.trim(); closeModal(); await moveCandidate(id,'standby',openingId,{standby_note:note}); };
    }
    function openAccepted(id, openingId) {
      modal('<h3 style="margin:0 0 6px">Offer accepted</h3>' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">They\u2019ve said yes. Set the agreed joining date \u2014 nothing is created in the employee system yet; that happens when they actually join.</div>' +
        '<div class="rec-field"><label>Agreed joining date</label><input type="date" id="recAccDate" /></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recAccCancel">Cancel</button><button class="rec-btn primary" id="recAccSave">Move to accepted</button></div>');
      $('recAccCancel').onclick=closeModal;
      $('recAccSave').onclick=async()=>{ const jd=$('recAccDate').value||null; closeModal(); await moveCandidate(id,'accepted',openingId,{ joining_date: jd }); };
    }
    async function openJoined(id, openingId) {
      // Load the candidate so we can show copyable details for the employee record.
      const r = await fetch('/api/recruitment/openings/'+openingId,{credentials:'include'});
      const d = await r.json(); let cand=null;
      for (const st of Object.keys(d.byStage||{})) { const f=(d.byStage[st]||[]).find(x=>String(x.id)===String(id)); if(f) cand=f; }
      if (!cand) { alert('Candidate not found'); return; }
      const m = cand.meta||{};
      const rows = [['Name',cand.title],['Email',m.email],['Phone',m.phone],['Agreed salary',m.expected_salary],['Joining date',m.joining_date],['Notice',m.notice_period]]
        .filter(x=>x[1]).map(x=>'<div class="rec-kv"><div class="k">'+x[0]+'</div>'+esc(x[1])+'</div>').join('');
      modal('<h3 style="margin:0 0 6px">They\u2019ve joined \u2014 create their employee record</h3>' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">This is the moment they become an employee. Open the People page and add them \u2014 their onboarding starts automatically once you set their hire date. Copy the details below into the form (edit anything that\u2019s changed).</div>' +
        (rows ? '<div class="rec-grid" style="margin-bottom:12px">'+rows+'</div>' : '') +
        '<div class="rec-field" style="font-size:11px;color:var(--soft)">Their CV is on the candidate card \u2014 re-upload it to their employee profile once created.</div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recJoinCancel">Not yet</button>' +
          '<button class="rec-btn primary" id="recJoinGo">Mark joined &amp; open People \u2192</button></div>');
      $('recJoinCancel').onclick=closeModal;
      $('recJoinGo').onclick=async()=>{ const ok=await moveCandidate(id,'joined',openingId,{}); closeModal(); if(ok) location.hash='#hr/users'; };
    }
    async function openOutcome(id, stage, openingId) {
      // Carry forward: show the most recent prior round outcome for context.
      let priorHtml = '';
      try {
        const r = await fetch('/api/recruitment/openings/' + openingId, { credentials:'include' });
        if (r.ok) {
          const d = await r.json(); let cand = null;
          for (const st of Object.keys(d.byStage||{})) { const f=(d.byStage[st]||[]).find(x=>String(x.id)===String(id)); if(f) cand=f; }
          const outs = (cand && cand.meta && Array.isArray(cand.meta.outcomes)) ? cand.meta.outcomes : [];
          if (outs.length) {
            const last = outs[outs.length-1];
            priorHtml = '<div class="rec-why" style="margin-bottom:12px"><div style="font-size:12px;color:var(--muted);margin-bottom:3px">Last round (' + (STAGE_LABEL[last.stage]||last.stage) + ')</div>' + esc(last.text) + '</div>';
          }
        }
      } catch (e) {}
      modal('<h3 style="margin:0 0 6px">Move to ' + (STAGE_LABEL[stage]||stage) + '</h3>' +
        priorHtml +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">How did this round go? (kept on the candidate\u2019s card)</div>' +
        '<div class="rec-field"><textarea id="recOutText" rows="3" placeholder="e.g. Strong on payroll, confident communicator \u2014 worth advancing"></textarea></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recOutSkip">Skip</button><button class="rec-btn primary" id="recOutSave">Move to ' + (STAGE_LABEL[stage]||stage) + '</button></div>');
      $('recOutSkip').onclick=async()=>{ closeModal(); await moveCandidate(id,stage,openingId,{}); };
      $('recOutSave').onclick=async()=>{ const outcome=$('recOutText').value.trim(); closeModal(); await moveCandidate(id,stage,openingId,{outcome}); };
    }

    async function openCandidate(id, openingId) {
      const r = await fetch('/api/recruitment/openings/' + openingId, { credentials:'include' });
      const d = await r.json(); let cand=null;
      for (const st of Object.keys(d.byStage||{})) { const f=(d.byStage[st]||[]).find(x=>String(x.id)===String(id)); if(f) cand=f; }
      if (!cand) (d.ended||[]).forEach(x=>{ if(String(x.id)===String(id)) cand=x; });
      if (!cand) { alert('Candidate not found'); return; }
      const m = cand.meta || {};
      const allFields = [['Current company',m.current_company],['Experience',m.experience_years?m.experience_years+' years':null],
        ['Current salary',m.current_salary],['Expected salary',m.expected_salary],['Notice period',m.notice_period],
        ['Phone',m.phone],['Email',m.email]];
      const hasAny = allFields.some(x=>x[1]);
      const kv = allFields.filter(x=>x[1]).map(x=>'<div class="rec-kv"><div class="k">'+x[0]+'</div>'+esc(x[1])+'</div>').join('');
      const detailsBody = hasAny
        ? '<div class="rec-grid">' + kv + '</div>'
        : '<div class="rec-empty-line">No company, salary, notice or contact yet \u2014 add them as you learn them.</div>';
      const kick = [d.opening && d.opening.title].filter(Boolean).join(' \u00b7 ') || 'Candidate';
      const stagePill = (STAGE_LABEL[m.stage]||m.stage||'') + (cand.moved_at?' \u00b7 '+ageLabel(cand.moved_at):'');
      const hist = Array.isArray(m.history)&&m.history.length ? m.history.map(h=>(STAGE_LABEL[h.stage]||h.stage)+' '+new Date(h.at).toLocaleDateString('en-GB')).join(' \u2192 ') : 'Sourced \u00b7 '+(cand.created_at?new Date(cand.created_at).toLocaleDateString('en-GB'):'');
      const outcomes = Array.isArray(m.outcomes)&&m.outcomes.length ? m.outcomes.map(o=>'<div class="rec-note"><span style="color:var(--muted)">'+(STAGE_LABEL[o.stage]||o.stage)+':</span> '+esc(o.text)+'<div class="rec-note-meta">'+esc(o.by_name||'')+' \u00b7 '+new Date(o.at).toLocaleDateString('en-GB')+'</div></div>').join('') : '';
      const notes = Array.isArray(m.notes)&&m.notes.length ? m.notes.map(n=>'<div class="rec-note">'+esc(n.text)+'<div class="rec-note-meta">'+esc(n.by_name||'')+' \u00b7 '+new Date(n.at).toLocaleDateString('en-GB')+'</div></div>').join('') : '<div class="rec-cand-sub">No notes yet.</div>';
      modalBare(
        '<div class="rec-chead">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
            '<div><div class="kick"><i class="ti ti-user-search"></i> '+esc(kick)+'</div>' +
              '<div class="nm">'+esc(cand.title)+'</div></div>' +
            '<span class="cpill">'+esc(stagePill)+'</span>' +
          '</div>' +
          (m.source ? '<div class="src">From '+esc(m.source)+'</div>' : '') +
        '</div>' +
        '<div class="rec-cbody">' +
          (m.why_shortlist ? '<div class="rec-why" style="margin-bottom:18px"><span style="color:var(--muted)">Why shortlisted:</span> ' + esc(m.why_shortlist) + '</div>' : '') +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
            '<div class="rec-sec-h2"><i class="ti ti-id" style="color:#185FA5"></i> Details</div>' +
            '<button class="rec-btn" id="recAddDetails" style="font-size:13px;padding:6px 13px"><i class="ti ti-plus"></i> Add details</button></div>' +
          detailsBody +
          '<div class="rec-panel" style="margin-top:18px"><div class="rec-sec-h2"><i class="ti ti-paperclip"></i> Files \u2014 CV, photo</div>' +
            '<div id="recFiles"><div class="rec-cand-sub">Loading\u2026</div></div>' +
            '<label class="rec-btn" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;cursor:pointer;width:100%;box-sizing:border-box"><i class="ti ti-upload"></i> Upload CV or photo<input type="file" id="recFileInput" accept="application/pdf,image/png,image/jpeg" style="display:none"></label></div>' +
          '<div class="rec-sec-h2" style="margin-top:18px"><i class="ti ti-history"></i> Stage history</div>' +
            '<div style="font-size:13px;color:var(--muted)">'+hist+'</div>'+outcomes +
          '<div class="rec-sec-h2" style="margin-top:18px"><i class="ti ti-note"></i> Notes</div>' + notes +
            '<div class="rec-field" style="margin-top:10px"><textarea id="recNoteText" rows="2" placeholder="Add a note"></textarea></div>' +
            '<button class="rec-btn" id="recNoteSave" style="width:100%">Add note</button>' +
          '<div class="rec-actions" style="border-top:0.5px solid var(--line);padding-top:16px;margin-top:18px">' +
            '<button class="rec-btn" id="recEditCand">Edit details</button>' +
            '<button class="rec-btn" id="recCloseModal">Close</button>' +
            (m.ended ? '<button class="rec-btn" id="recReopenCand">Bring back</button>' : '<button class="rec-btn danger" id="recEndCand">End candidate\u2026</button>') +
          '</div>' +
        '</div>');
      $('recCloseModal').onclick=closeModal;
      $('recEditCand').onclick=()=>openEditCandidate(cand, openingId);
      $('recAddDetails').onclick=()=>openEditCandidate(cand, openingId);
      const ec=$('recEndCand'); if(ec) ec.onclick=()=>openEndCandidate(id, openingId);
      const rc=$('recReopenCand'); if(rc) rc.onclick=async()=>{ await fetch('/api/recruitment/candidates/'+id+'/reopen',{method:'POST',credentials:'include'}); closeModal(); await loadBoard(openingId); };
      $('recNoteSave').onclick=async()=>{ const text=$('recNoteText').value.trim(); if(!text) return;
        const rr=await fetch('/api/recruitment/candidates/'+id+'/note',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({text})});
        if(!rr.ok){alert('Could not save note');return;} openCandidate(id,openingId); };
      // files
      loadFiles(id);
      $('recFileInput').onchange = async (e) => {
        const f = e.target.files[0]; if(!f) return;
        const fd = new FormData(); fd.append('file', f);
        const rr = await fetch('/api/recruitment/candidates/'+id+'/files',{method:'POST',credentials:'include',body:fd});
        if(!rr.ok){ const j=await rr.json().catch(()=>({})); alert(j.error||'Upload failed'); return; }
        loadFiles(id);
      };
    }

    async function loadFiles(id) {
      try {
        const r = await fetch('/api/recruitment/candidates/'+id+'/files',{credentials:'include'});
        const d = await r.json(); const files = d.files||[];
        const box = $('recFiles'); if(!box) return;
        box.innerHTML = files.length ? files.map(f=>{
          const isImg = (f.mime_type||'').startsWith('image/');
          return '<div class="rec-file"><i class="ti '+(isImg?'ti-photo':'ti-file-text')+'" style="font-size:17px;color:#185FA5"></i>' +
            '<a href="/api/recruitment/files/'+f.id+'" target="_blank" style="color:inherit;text-decoration:none">'+esc(f.filename)+'</a>' +
            '<span class="del" data-delfile="'+f.id+'">Remove</span></div>';
        }).join('') : '<div class="rec-cand-sub">No files yet.</div>';
        box.querySelectorAll('[data-delfile]').forEach(x=>x.onclick=async()=>{ if(!confirm('Remove this file?'))return; await fetch('/api/recruitment/files/'+x.getAttribute('data-delfile'),{method:'DELETE',credentials:'include'}); loadFiles(id); });
      } catch(e){ const box=$('recFiles'); if(box) box.innerHTML='<div class="rec-cand-sub">Could not load files.</div>'; }
    }

    function openEditCandidate(cand, openingId) {
      const m = cand.meta || {};
      const F = (id,label,val,ph)=>'<div class="rec-field"><label>'+label+'</label><input id="'+id+'" value="'+esc(val||'')+'" placeholder="'+(ph||'')+'"></div>';
      modal('<h3 style="margin:0 0 14px">Edit candidate</h3>' +
        F('ecName','Name',cand.title) +
        '<div class="rec-grid">' +
          F('ecCompany','Current company',m.current_company) +
          F('ecExp','Experience (years)',m.experience_years) +
          F('ecCur','Current salary',m.current_salary) +
          F('ecExp2','Expected salary',m.expected_salary) +
          F('ecNotice','Notice period',m.notice_period) +
          F('ecJoin','Joining date',m.joining_date) +
          F('ecPhone','Phone',m.phone) +
        '</div>' +
        F('ecEmail','Email',m.email) +
        '<div class="rec-field"><label>Why shortlisted</label><textarea id="ecWhy" rows="2">'+esc(m.why_shortlist||'')+'</textarea></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="ecCancel">Cancel</button><button class="rec-btn primary" id="ecSave">Save</button></div>');
      $('ecCancel').onclick=()=>openCandidate(cand.id, openingId);
      $('ecSave').onclick=async()=>{
        const body={ name:$('ecName').value.trim(), current_company:$('ecCompany').value.trim()||null,
          experience_years:$('ecExp').value.trim()||null, current_salary:$('ecCur').value.trim()||null,
          expected_salary:$('ecExp2').value.trim()||null, notice_period:$('ecNotice').value.trim()||null,
          joining_date:$('ecJoin').value.trim()||null,
          phone:$('ecPhone').value.trim()||null, email:$('ecEmail').value.trim()||null, why_shortlist:$('ecWhy').value.trim()||null };
        const r=await fetch('/api/recruitment/candidates/'+cand.id,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
        if(!r.ok){alert('Could not save');return;} openCandidate(cand.id, openingId);
      };
    }

    function openEndCandidate(id, openingId) {
      modal('<h3 style="margin:0 0 6px">End candidate</h3>' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">They\u2019re archived with the reason and can be brought back. Their files are kept 90 days then cleared.</div>' +
        '<div class="rec-field"><label>What happened?</label><select id="recEndHow"><option value="passed">We passed on them</option><option value="withdrew">They withdrew / declined</option></select></div>' +
        '<div class="rec-field"><label>Reason (kept on record)</label><input id="recEndReason" placeholder="e.g. not enough PPC experience / took another offer"></div>' +
        '<div class="rec-actions"><button class="rec-btn" id="recEndCancel">Cancel</button><button class="rec-btn primary" id="recEndSave">End candidate</button></div>');
      $('recEndCancel').onclick=()=>openCandidate(id, openingId);
      $('recEndSave').onclick=async()=>{ const how=$('recEndHow').value, reason=$('recEndReason').value.trim();
        const r=await fetch('/api/recruitment/candidates/'+id+'/end',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({how,reason})});
        if(!r.ok){alert('Could not end');return;} closeModal(); await loadBoard(openingId); };
    }

    $('recRoot').addEventListener('click', (e) => {
      const opCard = e.target.closest('[data-opening]');
      if (opCard) { loadBoard(parseInt(opCard.getAttribute('data-opening'),10)); return; }
      if (e.target.id === 'recNewOpening') openAddOpening();
    });
    await loadList();
  }
};
