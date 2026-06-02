// FK Home — My Work module (r0.23, Ship 2a + lifecycle)
// ----------------------------------------------------------------------------
// The single full task view + the universal creator with EXPLICIT mode choice.
// When you pick a person you choose: Assign (direct) or Request (accept/decline).
// "Assign" is disabled if you lack authority over them (managers-and-up only).
//
//   GET  /api/tasks/mine        -> { groups, incoming_requests, my_requests, total }
//   GET  /api/tasks/assignable  -> { direct, request, self_only }
//   GET  /api/tasks/done        -> { tasks }   (last 14 days)
//   POST /api/tasks             -> { title, category, assignee_user_id, mode }
//   PATCH /api/tasks/:id        -> edit title/category/due
//   POST /api/tasks/:id/cancel  -> cancel (kept in history)
//   POST /api/tasks/:id/action  -> start | complete
//   POST /api/tasks/:id/accept | /decline | /decline-assignment
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
          '#mw-mod .mw-glabel{font-size:12px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px;display:flex;align-items:center;justify-content:space-between}' +
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
          '#mw-mod .pill.done{background:#ECECEA;color:#6B6B66}' +
          '#mw-mod .mw-act{font-size:12px;color:var(--muted);border:0.5px solid var(--line);background:var(--surface);border-radius:6px;padding:5px 10px;cursor:pointer;flex:none}' +
          '#mw-mod .mw-act:hover{background:var(--hover,#F1EFE8);color:var(--ink)}' +
          '#mw-mod .mw-act.go{background:#0F6E56;color:#fff;border-color:#0F6E56}' +
          '#mw-mod .mw-act.no{color:#A32D2D}' +
          '#mw-mod .mw-ico-btn{font-size:15px;color:var(--soft);border:none;background:none;cursor:pointer;padding:4px;flex:none}' +
          '#mw-mod .mw-ico-btn:hover{color:var(--ink)}' +
          '#mw-mod .mw-empty{text-align:center;color:var(--muted);padding:30px;font-size:14px}' +
          '#mw-mod .mw-note{font-size:12px;color:var(--soft);margin-top:14px;padding-top:12px;border-top:0.5px solid var(--line)}' +
          '#mw-mod .mw-form{background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:14px;margin-bottom:14px;display:none}' +
          '#mw-mod .mw-form.on{display:block}' +
          '#mw-mod .mw-form input,#mw-mod .mw-form select{width:100%;padding:8px 11px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;background:var(--bg,#fff);margin-bottom:8px}' +
          '#mw-mod .mw-frow{display:flex;gap:8px}' +
          '#mw-mod .mw-mode{display:none;gap:8px;margin-bottom:8px}' +
          '#mw-mod .mw-mode.on{display:flex}' +
          '#mw-mod .mw-mode label{flex:1;border:0.5px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;cursor:pointer;display:flex;gap:7px;align-items:flex-start}' +
          '#mw-mod .mw-mode label.sel{border-color:var(--ink);background:var(--hover,#F1EFE8)}' +
          '#mw-mod .mw-mode label.disabled{opacity:.45;cursor:not-allowed}' +
          '#mw-mod .mw-mode .mt{font-weight:500;display:block}' +
          '#mw-mod .mw-mode .md{color:var(--muted);font-size:11px}' +
          '#mw-mod .mw-form button{padding:8px 14px;border-radius:8px;border:0.5px solid var(--line);background:var(--surface);cursor:pointer;font-size:14px}' +
          '#mw-mod .mw-form .save{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}' +
          '#mw-mod .reqbox{background:#FFFDF7;border:0.5px solid #FAC775;border-radius:8px;padding:12px 14px;margin-bottom:8px}' +
          '#mw-mod .reqbox .rt{font-size:14px;font-weight:500}' +
          '#mw-mod .reqbox .rm{font-size:12px;color:var(--muted);margin:2px 0 10px}' +
          '#mw-mod .reqbox .ra{display:flex;gap:8px}' +
          '#mw-mod .mw-done-toggle{cursor:pointer;color:var(--soft);font-weight:400;text-transform:none;letter-spacing:0}' +
          '#mw-mod #mwDoneList{display:none}' +
          '#mw-mod #mwDoneList.on{display:block}' +
        '</style>' +

        '<div class="card">' +
          '<div class="mw-head">' +
            '<div><h2 style="margin:0">My Work</h2><span class="mw-sub" id="mwSub">\u2014</span></div>' +
            '<button class="mw-add" id="mwAddBtn"><i class="ti ti-plus" style="font-size:16px"></i> Add task</button>' +
          '</div>' +

          '<div class="mw-form" id="mwForm">' +
            '<input type="text" id="mwTitle" placeholder="What needs doing?" />' +
            '<div class="mw-frow">' +
              '<select id="mwCategory">' +
                '<option value="">Category\u2026</option>' +
                '<option value="meeting">Meeting</option>' +
                '<option value="admin">Admin / paperwork</option>' +
                '<option value="cover">Helping someone / cover</option>' +
                '<option value="project">Project / piece of work</option>' +
                '<option value="other">Other</option>' +
                '<option value="request">Request</option>' +
              '</select>' +
              '<select id="mwAssignee"><option value="">Myself</option></select>' +
            '</div>' +
            '<div class="mw-frow" style="justify-content:flex-end">' +
              '<button id="mwCancel">Cancel</button>' +
              '<button class="save" id="mwSave">Add task</button>' +
            '</div>' +
          '</div>' +

          '<div id="mwRecPointer"></div>' +
          '<div id="mwReqIncoming"></div>' +
          '<div id="mwBody"><div class="mw-empty">Loading\u2026</div></div>' +
          '<div id="mwReqSent"></div>' +

          '<div class="mw-glabel"><span>Done</span><span class="mw-done-toggle" id="mwDoneToggle">show recent \u25be</span></div>' +
          '<div id="mwDoneList"></div>' +

          '<div class="mw-note">Pick a person, then choose Assign or Request. Assign is only available for people you manage. Recruitment openings live in the Recruitment view.</div>' +
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

    let editingId = null;

    function actionsFor(t) {
      // edit + cancel icons always; start/done by state; decline if assigned to me by someone else
      let html = '';
      if (t.status === 'in_progress') {
        html += '<button class="mw-act" data-act="complete" data-id="'+t.id+'">Done</button>';
      } else {
        html += '<button class="mw-act" data-act="start" data-id="'+t.id+'">Start</button>';
      }
      // decline a direct assignment (someone else assigned it to me, not a request)
      if (t.assigned_by_user_id && t.assigned_by_user_id !== t.assignee_user_id && !t.request_status) {
        html += '<button class="mw-ico-btn" title="Not mine \u2014 send back" data-declineassign="'+t.id+'"><i class="ti ti-arrow-back-up"></i></button>';
      }
      html += '<button class="mw-ico-btn" title="Edit" data-edit="'+t.id+'"><i class="ti ti-pencil"></i></button>';
      html += '<button class="mw-ico-btn" title="Cancel task" data-cancel="'+t.id+'"><i class="ti ti-x"></i></button>';
      return html;
    }

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
      const pillHtml = isOverdue ? '<span class="pill overdue">overdue</span>'
                                 : '<span class="pill '+pill[0]+'">'+pill[1]+'</span>';
      return '<div class="mw-row" data-row="'+t.id+'" data-title="'+esc(t.title)+'" data-cat="'+esc(t.category||'')+'">' +
        '<i class="ti '+icon+' ico" style="color:'+colour+'"></i>' +
        '<div class="mid"><div class="t1">'+esc(t.title)+'</div>'+(sub?'<div class="t2">'+sub+'</div>':'')+'</div>' +
        pillHtml + actionsFor(t) + '</div>';
    }

    function incomingHtml(t) {
      const from = t.assigned_by_name || t.requester_name || 'someone';
      return '<div class="reqbox">' +
        '<div class="rt">'+esc(t.title)+'</div>' +
        '<div class="rm">Request from '+esc(from)+(t.category?' \u00b7 '+esc(t.category):'')+'</div>' +
        '<div class="ra">' +
          '<button class="mw-act go" data-req="accept" data-id="'+t.id+'">Accept</button>' +
          '<button class="mw-act no" data-req="decline" data-id="'+t.id+'">Decline</button>' +
        '</div></div>';
    }

    function sentHtml(t) {
      const to = t.related_display_name || t.related_full_name || 'them';
      const state = t.request_status === 'declined'
        ? '<span class="pill overdue">declined'+(t.decline_reason?' \u00b7 '+esc(t.decline_reason):'')+'</span>'
        : '<span class="pill req">awaiting '+esc(to)+'</span>';
      return '<div class="mw-row">' +
        '<i class="ti ti-send ico" style="color:#854F0B"></i>' +
        '<div class="mid"><div class="t1">'+esc(t.title)+'</div>' +
          '<div class="t2">You requested this'+(t.request_status==='declined'?' \u2014 back on your plate':'')+'</div></div>' +
        state + '</div>';
    }

    function doneHtml(t) {
      return '<div class="mw-row">' +
        '<i class="ti ti-circle-check ico" style="color:#6B6B66"></i>' +
        '<div class="mid"><div class="t1" style="color:var(--muted)">'+esc(t.title)+'</div></div>' +
        '<span class="pill done">done</span>' +
        '<button class="mw-act" data-act="reopen" data-id="'+t.id+'">Reopen</button></div>';
    }

    const GROUPS = [['needs_action','Needs action'],['recurring','Recurring today'],['in_progress','In progress']];

    async function loadAssignable() {
      try {
        const r = await fetch('/api/tasks/assignable', { credentials:'include' });
        if (!r.ok) return;
        const d = await r.json();
        const sel = $('mwAssignee');
        let html = '<option value="">Myself</option>';
        for (const p of (d.people||[])) {
          html += '<option value="'+p.id+'">'+esc(p.display_name||p.full_name)+(p.dept_name?' ('+esc(p.dept_name)+')':'')+'</option>';
        }
        sel.innerHTML = html;
      } catch(e){ console.error('[assignable]',e); }
    }

    // Button label reflects what will happen: own task, a request, or assign.
    function updateSaveLabel() {
      const save = $('mwSave');
      const person = $('mwAssignee').value;
      const cat = $('mwCategory').value;
      if (!person) { save.textContent = 'Add task'; return; }      // myself
      save.textContent = (cat === 'request') ? 'Send request' : 'Assign task';
    }

    async function loadDone() {
      try {
        const r = await fetch('/api/tasks/done', { credentials:'include' });
        if (!r.ok) return;
        const d = await r.json();
        const list = d.tasks||[];
        $('mwDoneList').innerHTML = list.length ? list.map(doneHtml).join('')
          : '<div class="mw-empty" style="padding:14px">No completed tasks in the last 14 days.</div>';
      } catch(e){ console.error('[done]',e); }
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

        $('mwReqIncoming').innerHTML = incoming.length
          ? '<div class="mw-glabel"><span>Requests for you</span></div>' + incoming.map(incomingHtml).join('') : '';

        const totalMain = (groups.needs_action||[]).length+(groups.recurring||[]).length+(groups.in_progress||[]).length;
        if (totalMain === 0 && incoming.length === 0) {
          $('mwBody').innerHTML='<div class="mw-empty">Nothing on your plate right now. Use \u201cAdd task\u201d to log work.</div>';
        } else {
          let html='';
          for (const [k,label] of GROUPS) {
            const rows=groups[k]||[];
            if(!rows.length) continue;
            html+='<div class="mw-glabel"><span>'+label+'</span></div>'+rows.map(rowHtml).join('');
          }
          $('mwBody').innerHTML=html;
        }

        $('mwReqSent').innerHTML = sent.length
          ? '<div class="mw-glabel"><span>Your requests</span></div>' + sent.map(sentHtml).join('') : '';

        loadRecruitmentPointer();
      } catch(e){ console.error('[my-work load]',e); $('mwBody').innerHTML='<div class="mw-empty">Network error.</div>'; }
    }

    // HR home-base: a single pointer to recruitment so HR isn't checking a separate
    // tab. Returns 403 for non-HR (we just show nothing). Keeps "one place" intact.
    async function loadRecruitmentPointer() {
      const mount = $('mwRecPointer'); if (!mount) return;
      try {
        const r = await fetch('/api/recruitment/pointer', { credentials:'include' });
        if (!r.ok) { mount.innerHTML=''; return; }   // not HR, or error — show nothing
        const d = await r.json();
        const n = d.count || 0;
        if (n === 0) { mount.innerHTML=''; return; }
        mount.innerHTML =
          '<div onclick="location.hash=\'#recruitment\'" style="cursor:pointer;display:flex;align-items:center;gap:10px;background:var(--surface);border:0.5px solid var(--line);border-radius:9px;padding:12px 15px;margin-bottom:14px">' +
            '<i class="ti ti-user-search" style="font-size:18px;color:#185FA5"></i>' +
            '<span style="flex:1;font-size:14px">Recruitment \u2014 <strong>' + n + '</strong> candidate' + (n>1?'s':'') + ' need action</span>' +
            '<i class="ti ti-chevron-right" style="font-size:17px;color:var(--muted)"></i>' +
          '</div>';
      } catch(e){ mount.innerHTML=''; }
    }

    // ---- creator ----
    function resetForm() {
      editingId = null;
      $('mwTitle').value=''; $('mwCategory').value=''; $('mwAssignee').value='';
      $('mwSave').textContent='Add task';
      $('mwForm').querySelector('h4')?.remove();
    }
    $('mwAddBtn').addEventListener('click', ()=>{ resetForm(); $('mwForm').classList.add('on'); $('mwTitle').focus(); });
    $('mwCancel').addEventListener('click', ()=>{ $('mwForm').classList.remove('on'); resetForm(); });
    $('mwAssignee').addEventListener('change', updateSaveLabel);
    $('mwCategory').addEventListener('change', updateSaveLabel);

    $('mwSave').addEventListener('click', async ()=>{
      const title=$('mwTitle').value.trim();
      if(!title){ $('mwTitle').focus(); return; }
      const category=$('mwCategory').value||null;
      $('mwSave').disabled=true;
      try {
        if (editingId) {
          const r=await fetch('/api/tasks/'+editingId,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',
            body:JSON.stringify({ title, category })});
          if(!r.ok){ alert('Could not save'); } else { $('mwForm').classList.remove('on'); resetForm(); await load(); }
        } else {
          const assignee=$('mwAssignee').value||null;
          // Server decides: no person = my own task; category 'request' = request; else assign.
          const r=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
            body:JSON.stringify({ title, category, assignee_user_id:assignee })});
          if(!r.ok){ const e=await r.json().catch(()=>({})); alert(e.error||'Could not add task'); }
          else { $('mwForm').classList.remove('on'); resetForm(); await load(); }
        }
      } catch(e){ alert('Network error'); }
      $('mwSave').disabled=false;
    });

    // ---- row actions (start/done/reopen/edit/cancel/decline-assignment) ----
    async function rowAction(e) {
      const startBtn=e.target.closest('[data-act]');
      const editBtn=e.target.closest('[data-edit]');
      const cancelBtn=e.target.closest('[data-cancel]');
      const declineBtn=e.target.closest('[data-declineassign]');
      if (startBtn) {
        const id=startBtn.getAttribute('data-id'); const act=startBtn.getAttribute('data-act');
        startBtn.disabled=true;
        try { const r=await fetch('/api/tasks/'+id+'/action',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({action:act})});
          if(!r.ok){ alert('Action failed'); startBtn.disabled=false; return; } await load(); await loadDone();
        } catch(e2){ alert('Network error'); startBtn.disabled=false; }
      } else if (editBtn) {
        const row=editBtn.closest('.mw-row');
        editingId=editBtn.getAttribute('data-edit');
        $('mwTitle').value=row.getAttribute('data-title')||'';
        $('mwCategory').value=row.getAttribute('data-cat')||'';
        $('mwAssignee').value='';
        $('mwSave').textContent='Save changes';
        $('mwForm').classList.add('on'); $('mwTitle').focus();
      } else if (cancelBtn) {
        const id=cancelBtn.getAttribute('data-cancel');
        if(!confirm('Cancel this task? It will be removed from your list.')) return;
        const reason=prompt('Reason (optional):')||'';
        try { const r=await fetch('/api/tasks/'+id+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({reason})});
          if(!r.ok){ alert('Could not cancel'); return; } await load();
        } catch(e2){ alert('Network error'); }
      } else if (declineBtn) {
        const id=declineBtn.getAttribute('data-declineassign');
        const reason=prompt('Send back to whoever assigned it. Reason (optional):')||'';
        try { const r=await fetch('/api/tasks/'+id+'/decline-assignment',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({reason})});
          if(!r.ok){ const e=await r.json().catch(()=>({})); alert(e.error||'Could not send back'); return; } await load();
        } catch(e2){ alert('Network error'); }
      }
    }
    $('mwBody').addEventListener('click', rowAction);
    $('mwDoneList').addEventListener('click', rowAction);

    // ---- accept / decline incoming requests ----
    $('mwReqIncoming').addEventListener('click', async (e)=>{
      const btn=e.target.closest('.mw-act'); if(!btn) return;
      const id=btn.getAttribute('data-id'); const req=btn.getAttribute('data-req');
      let body={};
      if(req==='decline'){ body={reason:prompt('Reason (optional):')||''}; }
      btn.disabled=true;
      try { const r=await fetch('/api/tasks/'+id+'/'+req,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
        if(!r.ok){ alert(req+' failed'); btn.disabled=false; return; } await load();
      } catch(e2){ alert('Network error'); btn.disabled=false; }
    });

    // ---- done toggle ----
    $('mwDoneToggle').addEventListener('click', async ()=>{
      const list=$('mwDoneList');
      const open=list.classList.toggle('on');
      $('mwDoneToggle').textContent = open ? 'hide \u25b4' : 'show recent \u25be';
      if (open) await loadDone();
    });

    await loadAssignable();
    updateSaveLabel();
    await load();
  }
};
