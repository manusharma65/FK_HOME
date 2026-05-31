// FK Home — My Work module (r0.22, Ship 2a)
// ----------------------------------------------------------------------------
// The single full task view + the universal task creator with the auto-detecting
// assign/request engine.
//   GET  /api/tasks/mine        -> { groups, incoming_requests, my_requests, total }
//   GET  /api/tasks/assignable  -> { direct, request, self_only }
//   POST /api/tasks             -> create (self / assign / request)
//   POST /api/tasks/:id/action  -> start | complete
//   POST /api/tasks/:id/accept  -> accept incoming request
//   POST /api/tasks/:id/decline -> decline incoming request
// The creator reacts to who you pick in "Assign to": self → Add task; someone you
// can assign → Assign task (direct); someone cross-dept → Send request.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['my-work'] = {
  title: 'My Work',

  render() {
    return '' +
      '<div id="mw-mod" class="fk-mod">' +
        '<style>' +
          '#mw-mod .mw-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}' +
          '#mw-mod .mw-sub{font-size:13px;color:var(--muted)}' +
          '#mw-mod .mw-add{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:0.5px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-size:14px}' +
          '#mw-mod .mw-add:hover{background:var(--hover,#F1EFE8)}' +
          '#mw-mod .mw-glabel{font-size:12px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px}' +
          '#mw-mod .mw-row{display:flex;align-items:center;gap:12px;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:8px}' +
          '#mw-mod .mw-row .ico{font-size:18px;flex:none}' +
          '#mw-mod .mw-row .mid{flex:1;min-width:0}' +
          '#mw-mod .mw-row .t1{font-size:14px;font-weight:500}' +
          '#mw-mod .mw-row .t2{font-size:12px;color:var(--muted);margin-top:2px}' +
          '#mw-mod .pill{font-size:11px;padding:3px 9px;border-radius:99px;flex:none}' +
          '#mw-mod .pill.event{background:#E1F5EE;color:#0F6E56}' +
          '#mw-mod .pill.recurring{background:#FAEEDA;color:#854F0B}' +
          '#mw-mod .pill.adhoc{background:#FAECE7;color:#993C1D}' +
          '#mw-mod .pill.review{background:#EEEDFE;color:#534AB7}' +
          '#mw-mod .pill.overdue{background:#FCEBEB;color:#A32D2D}' +
          '#mw-mod .pill.req{background:#FAEEDA;color:#854F0B}' +
          '#mw-mod .mw-act{font-size:12px;color:var(--muted);border:0.5px solid var(--line);background:var(--surface);border-radius:6px;padding:5px 10px;cursor:pointer;flex:none}' +
          '#mw-mod .mw-act:hover{background:var(--hover,#F1EFE8);color:var(--ink)}' +
          '#mw-mod .mw-act.go{background:#0F6E56;color:#fff;border-color:#0F6E56}' +
          '#mw-mod .mw-act.no{color:#A32D2D}' +
          '#mw-mod .mw-empty{text-align:center;color:var(--muted);padding:30px;font-size:14px}' +
          '#mw-mod .mw-note{font-size:12px;color:var(--soft);margin-top:14px;padding-top:12px;border-top:0.5px solid var(--line)}' +
          '#mw-mod .mw-form{background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:14px;margin-bottom:14px;display:none}' +
          '#mw-mod .mw-form.on{display:block}' +
          '#mw-mod .mw-form input,#mw-mod .mw-form select{width:100%;padding:8px 11px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;background:var(--bg,#fff);margin-bottom:8px}' +
          '#mw-mod .mw-frow{display:flex;gap:8px}' +
          '#mw-mod .mw-hint{font-size:12px;padding:7px 11px;border-radius:8px;margin-bottom:8px;display:none}' +
          '#mw-mod .mw-hint.assign{display:block;background:#E6F1FB;color:#185FA5}' +
          '#mw-mod .mw-hint.request{display:block;background:#FAEEDA;color:#854F0B}' +
          '#mw-mod .mw-form button{padding:8px 14px;border-radius:8px;border:0.5px solid var(--line);background:var(--surface);cursor:pointer;font-size:14px}' +
          '#mw-mod .mw-form .save{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}' +
          '#mw-mod .reqbox{background:#FFFDF7;border:0.5px solid #FAC775;border-radius:8px;padding:12px 14px;margin-bottom:8px}' +
          '#mw-mod .reqbox .rt{font-size:14px;font-weight:500}' +
          '#mw-mod .reqbox .rm{font-size:12px;color:var(--muted);margin:2px 0 10px}' +
          '#mw-mod .reqbox .ra{display:flex;gap:8px}' +
        '</style>' +

        '<div class="card">' +
          '<div class="mw-head">' +
            '<div><h2 style="margin:0">My Work</h2><span class="mw-sub" id="mwSub">\u2014</span></div>' +
            '<button class="mw-add" id="mwAddBtn"><i class="ti ti-plus" style="font-size:16px"></i> Add task</button>' +
          '</div>' +

          '<div class="mw-form" id="mwForm">' +
            '<input type="text" id="mwTitle" placeholder="What do you need done?" />' +
            '<div class="mw-frow">' +
              '<select id="mwCategory">' +
                '<option value="">Category\u2026</option>' +
                '<option value="meeting">Meeting</option>' +
                '<option value="admin">Admin / paperwork</option>' +
                '<option value="cover">Helping someone / cover</option>' +
                '<option value="project">Project / piece of work</option>' +
                '<option value="other">Other</option>' +
              '</select>' +
              '<select id="mwAssignee"><option value="">Myself</option></select>' +
            '</div>' +
            '<div class="mw-hint" id="mwHint"></div>' +
            '<div class="mw-frow" style="justify-content:flex-end">' +
              '<button id="mwCancel">Cancel</button>' +
              '<button class="save" id="mwSave">Add task</button>' +
            '</div>' +
          '</div>' +

          '<div id="mwReqIncoming"></div>' +
          '<div id="mwBody"><div class="mw-empty">Loading\u2026</div></div>' +
          '<div id="mwReqSent"></div>' +

          '<div class="mw-note">Pick someone in another department and it becomes a request they can accept or decline. Recruitment openings live in the Recruitment view.</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    const PILL = { event:['event','from event'], recurring:['recurring','recurring'],
                   ad_hoc:['adhoc','ad-hoc'], recruitment:['adhoc','recruitment'],
                   review:['review','review'], onboarding:['review','onboarding'], probation:['review','probation'] };
    const ICON = { event:'ti-calendar-event', recurring:'ti-checkbox', ad_hoc:'ti-clipboard-text',
                   recruitment:'ti-user-search', review:'ti-star', onboarding:'ti-checklist', probation:'ti-clock' };
    const ICON_COLOUR = { event:'#0F6E56', recurring:'#854F0B', ad_hoc:'#993C1D',
                          recruitment:'#993C1D', review:'#534AB7', onboarding:'#534AB7', probation:'#534AB7' };

    // assignable lists, fetched once
    let directIds = new Set();   // picking these = direct assignment
    let selfOnly = true;

    function rowHtml(t) {
      const kind = t.kind || 'ad_hoc';
      const pill = PILL[kind] || ['adhoc', kind];
      const isOverdue = t.status === 'overdue';
      const icon = ICON[kind] || 'ti-clipboard-text';
      const colour = ICON_COLOUR[kind] || 'var(--muted)';
      let sub = t.movement_note ? esc(t.movement_note) : (t.body ? esc(t.body) : '');
      if (t.assigned_by_name && t.assigned_by_user_id !== t.assignee_user_id) {
        sub = 'Assigned by ' + esc(t.assigned_by_name) + (sub ? ' \u00b7 ' + sub : '');
      }
      const act = (t.status === 'in_progress')
        ? '<button class="mw-act" data-act="complete" data-id="' + t.id + '">Done</button>'
        : '<button class="mw-act" data-act="start" data-id="' + t.id + '">Start</button>';
      const pillHtml = isOverdue
        ? '<span class="pill overdue">overdue</span>'
        : '<span class="pill ' + pill[0] + '">' + pill[1] + '</span>';
      return '<div class="mw-row">' +
        '<i class="ti ' + icon + ' ico" style="color:' + colour + '"></i>' +
        '<div class="mid"><div class="t1">' + esc(t.title) + '</div>' +
          (sub ? '<div class="t2">' + sub + '</div>' : '') + '</div>' +
        pillHtml + act + '</div>';
    }

    function incomingHtml(t) {
      const from = t.assigned_by_name || t.requester_name || 'someone';
      return '<div class="reqbox">' +
        '<div class="rt">' + esc(t.title) + '</div>' +
        '<div class="rm">Request from ' + esc(from) + (t.category ? ' \u00b7 ' + esc(t.category) : '') + '</div>' +
        '<div class="ra">' +
          '<button class="mw-act go" data-req="accept" data-id="' + t.id + '">Accept</button>' +
          '<button class="mw-act no" data-req="decline" data-id="' + t.id + '">Decline</button>' +
        '</div></div>';
    }

    function sentHtml(t) {
      const to = t.related_display_name || t.related_full_name || 'them';
      const state = t.request_status === 'declined'
        ? '<span class="pill overdue">declined' + (t.decline_reason ? ' \u00b7 ' + esc(t.decline_reason) : '') + '</span>'
        : '<span class="pill req">awaiting ' + esc(to) + '</span>';
      return '<div class="mw-row">' +
        '<i class="ti ti-send ico" style="color:#854F0B"></i>' +
        '<div class="mid"><div class="t1">' + esc(t.title) + '</div>' +
          '<div class="t2">You requested this' + (t.request_status==='declined'?' \u2014 back on your plate':'') + '</div></div>' +
        state + '</div>';
    }

    const GROUPS = [['needs_action','Needs action'],['recurring','Recurring today'],['in_progress','In progress']];

    async function loadAssignable() {
      try {
        const r = await fetch('/api/tasks/assignable', { credentials:'include' });
        if (!r.ok) return;
        const d = await r.json();
        selfOnly = !!d.self_only;
        directIds = new Set((d.direct||[]).map(p=>p.id));
        const sel = $('mwAssignee');
        let html = '<option value="">Myself</option>';
        if (!selfOnly) {
          for (const p of (d.direct||[])) {
            html += '<option value="'+p.id+'" data-dir="1">'+esc(p.display_name||p.full_name)+(p.dept_name?' ('+esc(p.dept_name)+')':'')+'</option>';
          }
        }
        for (const p of (d.request||[])) {
          html += '<option value="'+p.id+'" data-dir="0">'+esc(p.display_name||p.full_name)+(p.dept_name?' ('+esc(p.dept_name)+')':'')+'</option>';
        }
        sel.innerHTML = html;
      } catch(e){ console.error('[assignable]',e); }
    }

    function updateHint() {
      const sel = $('mwAssignee');
      const val = sel.value;
      const hint = $('mwHint');
      const save = $('mwSave');
      if (!val) { hint.className='mw-hint'; save.textContent='Add task'; return; }
      const opt = sel.options[sel.selectedIndex];
      const isDirect = opt.getAttribute('data-dir') === '1';
      const who = opt.textContent.replace(/\s*\(.*\)$/,'');
      if (isDirect) {
        hint.className='mw-hint assign';
        hint.innerHTML='<i class="ti ti-arrow-right" style="vertical-align:-2px"></i> Goes straight to '+esc(who)+'\u2019s work';
        save.textContent='Assign task';
      } else {
        hint.className='mw-hint request';
        hint.innerHTML='<i class="ti ti-send" style="vertical-align:-2px"></i> Sent to '+esc(who)+' as a request \u2014 they can accept or decline. You\u2019ll be notified.';
        save.textContent='Send request';
      }
    }

    async function load() {
      try {
        const r = await fetch('/api/tasks/mine', { credentials:'include' });
        if (!r.ok) { $('mwBody').innerHTML='<div class="mw-empty">Could not load your tasks.</div>'; return; }
        const data = await r.json();
        const groups = data.groups || { needs_action:[], recurring:[], in_progress:[] };
        const incoming = data.incoming_requests || [];
        const sent = data.my_requests || [];
        const toAction = (groups.needs_action||[]).length;
        const inProg = (groups.in_progress||[]).length;
        $('mwSub').textContent = toAction+' to action \u00b7 '+inProg+' in progress'+(incoming.length?' \u00b7 '+incoming.length+' request'+(incoming.length>1?'s':''):'');

        // incoming requests (top)
        $('mwReqIncoming').innerHTML = incoming.length
          ? '<div class="mw-glabel">Requests for you</div>' + incoming.map(incomingHtml).join('') : '';

        // main groups
        const totalMain = (groups.needs_action||[]).length+(groups.recurring||[]).length+(groups.in_progress||[]).length;
        if (totalMain === 0 && incoming.length === 0) {
          $('mwBody').innerHTML='<div class="mw-empty">Nothing on your plate right now. Use \u201cAdd task\u201d to log work.</div>';
        } else {
          let html='';
          for (const [k,label] of GROUPS) {
            const rows=groups[k]||[];
            if(!rows.length) continue;
            html+='<div class="mw-glabel">'+label+'</div>'+rows.map(rowHtml).join('');
          }
          $('mwBody').innerHTML=html;
        }

        // sent requests (bottom)
        $('mwReqSent').innerHTML = sent.length
          ? '<div class="mw-glabel">Your requests</div>' + sent.map(sentHtml).join('') : '';
      } catch(e){ console.error('[my-work load]',e); $('mwBody').innerHTML='<div class="mw-empty">Network error.</div>'; }
    }

    // creator toggle + hint
    $('mwAddBtn').addEventListener('click', ()=>{ $('mwForm').classList.add('on'); $('mwTitle').focus(); });
    $('mwCancel').addEventListener('click', ()=>{ $('mwForm').classList.remove('on'); $('mwTitle').value=''; $('mwAssignee').value=''; updateHint(); });
    $('mwAssignee').addEventListener('change', updateHint);

    $('mwSave').addEventListener('click', async ()=>{
      const title=$('mwTitle').value.trim();
      if(!title){ $('mwTitle').focus(); return; }
      const category=$('mwCategory').value||null;
      const assignee=$('mwAssignee').value||null;
      $('mwSave').disabled=true;
      try {
        const r=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
          body:JSON.stringify({ title, category, assignee_user_id:assignee })});
        if(!r.ok){ alert('Could not add task'); }
        else { $('mwTitle').value=''; $('mwAssignee').value=''; updateHint(); $('mwForm').classList.remove('on'); await load(); }
      } catch(e){ alert('Network error'); }
      $('mwSave').disabled=false;
    });

    // task actions
    $('mwBody').addEventListener('click', async (e)=>{
      const btn=e.target.closest('.mw-act'); if(!btn) return;
      const id=btn.getAttribute('data-id'); const act=btn.getAttribute('data-act');
      btn.disabled=true;
      try {
        const r=await fetch('/api/tasks/'+id+'/action',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({action:act})});
        if(!r.ok){ alert('Action failed'); btn.disabled=false; return; }
        await load();
      } catch(e2){ alert('Network error'); btn.disabled=false; }
    });

    // accept / decline incoming requests
    $('mwReqIncoming').addEventListener('click', async (e)=>{
      const btn=e.target.closest('.mw-act'); if(!btn) return;
      const id=btn.getAttribute('data-id'); const req=btn.getAttribute('data-req');
      let body={};
      if(req==='decline'){ const reason=prompt('Reason (optional):')||''; body={reason}; }
      btn.disabled=true;
      try {
        const r=await fetch('/api/tasks/'+id+'/'+req,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
        if(!r.ok){ alert(req+' failed'); btn.disabled=false; return; }
        await load();
      } catch(e2){ alert('Network error'); btn.disabled=false; }
    });

    await loadAssignable();
    updateHint();
    await load();
  }
};
