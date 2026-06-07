// FK Home — Team Work module (r0.23)
// ----------------------------------------------------------------------------
// Manager/lead view of their team's active tasks + status. Owner sees everyone.
//   GET /api/tasks/team -> { tasks:[{...assignee_name, status, due_at}], can_view }
// Read-only overview grouped by person, with status pills. Lets a manager see
// who's overloaded / what's overdue across their team.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['team-work'] = {
  title: 'Team Work',

  render() {
    return '' +
      '<div id="tw-mod" class="fk-mod">' +
        '<style>' +
          '#tw-mod .tw-person{margin:18px 0 8px;display:flex;align-items:center;gap:10px}' +
          '#tw-mod .tw-av{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13.5px;font-weight:600;flex:none}' +
          '#tw-mod .tw-pname{font-size:14px;font-weight:500}' +
          '#tw-mod .tw-pmeta{font-size:13.5px;color:var(--muted)}' +
          '#tw-mod .tw-row{display:flex;align-items:center;gap:12px;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:6px}' +
          '#tw-mod .tw-row .mid{flex:1;min-width:0}' +
          '#tw-mod .tw-row .t1{font-size:14px}' +
          '#tw-mod .pill{font-size:12.5px;padding:3px 9px;border-radius:99px;flex:none}' +
          '#tw-mod .pill.overdue{background:#FCEBEB;color:#A32D2D}' +
          '#tw-mod .pill.due{background:#FAEEDA;color:#854F0B}' +
          '#tw-mod .pill.inprog{background:#E1F5EE;color:#0F6E56}' +
          '#tw-mod .pill.open{background:#ECECEA;color:#6B6B66}' +
          '#tw-mod .tw-empty{text-align:center;color:var(--muted);padding:30px;font-size:14px}' +
          '#tw-mod .tw-open{font-size:14.5px;padding:7px 14px;border:0.5px solid var(--line);border-radius:7px;background:var(--surface);cursor:pointer;flex:none}' +
          '#tw-mod .tw-open:hover{background:var(--hover,#F1EFE8)}' +
        '</style>' +
        '<div class="card">' +
          '<h2 style="margin:0 0 2px">Team Work</h2>' +
          '<div style="font-size:14.5px;color:var(--muted)" id="twSub">\u2014</div>' +
          '<div id="twBody"><div class="tw-empty">Loading\u2026</div></div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id)=>el.querySelector('#'+id);
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function statusPill(s){
      if(s==='overdue') return '<span class="pill overdue">overdue</span>';
      if(s==='due') return '<span class="pill due">due</span>';
      if(s==='in_progress') return '<span class="pill inprog">in progress</span>';
      return '<span class="pill open">open</span>';
    }
    try {
      const r = await fetch('/api/tasks/team', { credentials:'include' });
      if (!r.ok) { $('twBody').innerHTML='<div class="tw-empty">Could not load.</div>'; return; }
      const d = await r.json();
      if (!d.can_view) { $('twBody').innerHTML='<div class="tw-empty">You don\u2019t manage a team yet.</div>'; $('twSub').textContent=''; return; }
      const tasks = d.tasks||[];
      if (tasks.length===0) { $('twBody').innerHTML='<div class="tw-empty">No active tasks across your team right now.</div>'; $('twSub').textContent='All clear'; return; }
      // group by assignee
      const byPerson = {};
      for (const t of tasks) {
        const k = t.assignee_user_id;
        if (!byPerson[k]) byPerson[k] = { name: t.assignee_name||t.assignee_full_name||'Someone', initials: t.assignee_initials||'?', colour: t.assignee_colour||'#888', rows: [] };
        byPerson[k].rows.push(t);
      }
      let overdueTotal = tasks.filter(t=>t.status==='overdue').length;
      $('twSub').textContent = tasks.length+' active task'+(tasks.length>1?'s':'')+' across '+Object.keys(byPerson).length+' people'+(overdueTotal?' \u00b7 '+overdueTotal+' overdue':'');
      let html='';
      for (const k of Object.keys(byPerson)) {
        const p=byPerson[k];
        html += '<div class="tw-person"><div class="tw-av" style="background:'+esc(p.colour)+'">'+esc(p.initials)+'</div>' +
          '<div><div class="tw-pname">'+esc(p.name)+'</div><div class="tw-pmeta">'+p.rows.length+' task'+(p.rows.length>1?'s':'')+'</div></div></div>';
        for (const t of p.rows) {
          html += '<div class="tw-row" data-twrow="'+t.id+'" style="cursor:pointer"><div class="mid"><div class="t1">'+esc(t.title)+'</div></div>'+statusPill(t.status)+'<button class="tw-open" data-twopen="'+t.id+'">Open</button></div>';
        }
      }
      $('twBody').innerHTML=html;
      $('twBody').addEventListener('click', (e)=>{
        const o=e.target.closest('[data-twopen]'); const row=e.target.closest('[data-twrow]');
        const id = o ? o.getAttribute('data-twopen') : (row ? row.getAttribute('data-twrow') : null);
        if (id) openTeamCard(id);
      });
    } catch(e){ console.error('[team-work]',e); $('twBody').innerHTML='<div class="tw-empty">Network error.</div>'; }

    const OUT = { done:['Done','#0F6E56','#E1F5EE'], partly:['Partly done','#854F0B','#FAEEDA'], blocked:['Blocked','#A32D2D','#FCEBEB'], couldnt:["Couldn't do",'#5F5E5A','#ECECEA'] };
    async function openTeamCard(id){
      const r = await fetch('/api/tasks/'+id+'/card', { credentials:'include' });
      if(!r.ok){ alert('Could not open'); return; }
      const d = await r.json(); const t=d.task; const w=d.work||{};
      const mins = w.logged_minutes!=null ? w.logged_minutes : Math.round((w.timer_seconds||0)/60);
      const editHint = (w.time_edited_by_name && w.logged_minutes!=null && w.logged_minutes!==Math.round((w.timer_seconds||0)/60))
        ? '<div style="font-size:12.5px;color:var(--muted);font-style:italic">timer saw '+Math.round((w.timer_seconds||0)/60)+' min \u00b7 edited by '+esc(w.time_edited_by_name)+'</div>' : '';
      const oc = w.outcome && OUT[w.outcome] ? '<span style="font-size:13.5px;padding:5px 11px;border-radius:99px;background:'+OUT[w.outcome][2]+';color:'+OUT[w.outcome][1]+';font-weight:500">'+OUT[w.outcome][0]+'</span>' : '<span style="font-size:14.5px;color:var(--muted)">no outcome yet</span>';
      const files=(d.files||[]).map(f=>'<a href="/api/tasks/file/'+f.id+'" target="_blank" style="display:block;font-size:14.5px;color:#185FA5;text-decoration:none;padding:3px 0">'+esc(f.filename)+'</a>').join('')||'<div style="font-size:14.5px;color:var(--muted)">No files.</div>';
      let mount=el.querySelector('#twCardMount'); if(!mount){ mount=document.createElement('div'); mount.id='twCardMount'; el.querySelector('#tw-mod').appendChild(mount); }
      mount.innerHTML='<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px" id="twBg">' +
        '<div style="background:var(--surface);border-radius:14px;max-width:520px;width:100%;max-height:88vh;overflow-y:auto">' +
          '<div style="padding:14px 18px;background:#185FA5;color:#fff"><div style="font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;opacity:.9">'+esc((t.category||t.kind||"task").replace("_"," "))+'</div><div style="font-size:17px;font-weight:500;margin-top:3px">'+esc(t.title)+'</div></div>' +
          '<div style="padding:16px 18px">' +
            '<div style="font-size:13.5px;color:var(--muted);margin-bottom:4px">What they did</div>' +
            '<div style="font-size:14px;margin-bottom:14px">'+(w.did?esc(w.did):'<span style="color:var(--muted)">Nothing recorded yet.</span>')+'</div>' +
            '<div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:14px">' +
              '<div><div style="font-size:13.5px;color:var(--muted)">Time spent</div><div style="font-size:18px;font-weight:500">'+mins+' min</div>'+editHint+'</div>' +
              '<div><div style="font-size:13.5px;color:var(--muted);margin-bottom:5px">Outcome</div>'+oc+'</div>' +
            '</div>' +
            '<div style="font-size:13.5px;color:var(--muted);margin-bottom:4px">Files</div>'+files +
            '<div style="margin-top:18px;display:flex;justify-content:flex-end"><button class="mw-act" id="twClose" style="padding:10px 18px;font-size:14px;border:0.5px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer">Close</button></div>' +
          '</div>' +
        '</div></div>';
      el.querySelector('#twClose').onclick=()=>{ mount.innerHTML=''; };
      el.querySelector('#twBg').addEventListener('click',ev=>{ if(ev.target.id==='twBg') mount.innerHTML=''; });
    }
  }
};
