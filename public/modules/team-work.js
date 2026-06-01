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
          '#tw-mod .tw-av{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex:none}' +
          '#tw-mod .tw-pname{font-size:14px;font-weight:500}' +
          '#tw-mod .tw-pmeta{font-size:12px;color:var(--muted)}' +
          '#tw-mod .tw-row{display:flex;align-items:center;gap:12px;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:6px}' +
          '#tw-mod .tw-row .mid{flex:1;min-width:0}' +
          '#tw-mod .tw-row .t1{font-size:14px}' +
          '#tw-mod .pill{font-size:11px;padding:3px 9px;border-radius:99px;flex:none}' +
          '#tw-mod .pill.overdue{background:#FCEBEB;color:#A32D2D}' +
          '#tw-mod .pill.due{background:#FAEEDA;color:#854F0B}' +
          '#tw-mod .pill.inprog{background:#E1F5EE;color:#0F6E56}' +
          '#tw-mod .pill.open{background:#ECECEA;color:#6B6B66}' +
          '#tw-mod .tw-empty{text-align:center;color:var(--muted);padding:30px;font-size:14px}' +
        '</style>' +
        '<div class="card">' +
          '<h2 style="margin:0 0 2px">Team Work</h2>' +
          '<div style="font-size:13px;color:var(--muted)" id="twSub">\u2014</div>' +
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
          html += '<div class="tw-row"><div class="mid"><div class="t1">'+esc(t.title)+'</div></div>'+statusPill(t.status)+'</div>';
        }
      }
      $('twBody').innerHTML=html;
    } catch(e){ console.error('[team-work]',e); $('twBody').innerHTML='<div class="tw-empty">Network error.</div>'; }
  }
};
