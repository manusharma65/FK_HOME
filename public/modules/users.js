// FK Home — People module (r0.49) — redesigned, energised.
// ----------------------------------------------------------------------------
// One hub for a person: identity, access, employment record, manager and leave.
// Reuses the SAME working endpoints (nothing new server-side except optional
// last_working_day on bulk-employment):
//   GET  /api/admin/users | departments | groups
//   POST /api/admin/users                       create (returns user + temp pwd)
//   PATCH /api/admin/users/:id                  names + employment_status
//   PUT  /api/admin/users/:id/departments       memberships (role)
//   PUT  /api/admin/users/:id/groups            group_slugs
//   POST /api/admin/users/:id/reset-password
//   PUT  /api/profile/:id/manager               { manager_user_id }
//   POST /api/admin/users/bulk-employment       { updates:[{id,hire_date,employment_type,work_pattern,probation_end_date,notice_period_days,last_working_day}] }
//   PUT  /api/profile/:id/salary                { monthly_ctc, currency, effective_from }
//   POST /api/admin/leaves/recompute|adjust     { user_id [, delta, note] }
//   GET  /api/profile/:id/overview              manager_name + leave_balance + last_working_day
// The old Employment page stays in the nav as a fallback until this is proven.
// ----------------------------------------------------------------------------
window.fkModules = window.fkModules || {};

window.fkModules['hr/users'] = {
  title: 'People',
  noHero: true,
  render() {
    return '' +
    '<div id="usr-mod" class="fk-mod"><style>' +
      '#usr-mod{--uo:#E8722B;--uo2:#F3992E;--udisp:"Fraunces",Georgia,serif}' +
      '#usr-mod .hero{position:relative;overflow:hidden;border-radius:22px;padding:24px 26px;color:#fff;margin-bottom:18px;background:linear-gradient(115deg,#2A2421,#3a2e25 48%,#7a3d18)}' +
      '#usr-mod .hero:after{content:"";position:absolute;right:-60px;top:-80px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle at 30% 30%,var(--uo2),var(--uo));opacity:.5;filter:blur(6px)}' +
      '#usr-mod .hero h1{font-family:var(--udisp);font-weight:600;font-size:28px;margin:0;position:relative}' +
      '#usr-mod .hero p{margin:6px 0 0;color:#E8DDD2;font-size:14.5px;position:relative;max-width:520px}' +
      '#usr-mod .hstat{position:relative;display:flex;gap:24px;margin-top:16px}' +
      '#usr-mod .hstat b{font-family:var(--udisp);font-size:22px;font-weight:600;display:block;line-height:1}' +
      '#usr-mod .hstat span{font-size:12.5px;color:#D9CDBF;text-transform:uppercase;letter-spacing:.07em}' +
      '#usr-mod .addbtn{position:absolute;right:24px;top:24px;z-index:3;display:inline-flex;align-items:center;gap:8px;background:#fff;color:var(--ink);font-weight:700;font-size:14px;border:0;border-radius:999px;padding:11px 18px;cursor:pointer;box-shadow:0 8px 22px rgba(232,114,43,.35);transition:transform .15s,box-shadow .15s}' +
      '#usr-mod .addbtn:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(232,114,43,.5)}' +
      '#usr-mod .addbtn .pl{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,var(--uo2),var(--uo));color:#fff;display:grid;place-items:center;font-size:15px}' +
      '#usr-mod .toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}' +
      '#usr-mod .srch{flex:1;min-width:200px}' +
      '#usr-mod .srch input{width:100%;font-size:14px;padding:11px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}' +
      '#usr-mod .pills{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:11px;overflow:hidden}' +
      '#usr-mod .pills button{border:0;background:none;font-weight:600;font-size:14.5px;color:var(--muted);padding:10px 15px;cursor:pointer;border-left:1px solid var(--line)}' +
      '#usr-mod .pills button:first-child{border-left:0}#usr-mod .pills button.on{background:var(--ink);color:#fff}' +
      '#usr-mod .prow{display:flex;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:13px 16px;margin-bottom:10px;cursor:pointer;transition:transform .14s,box-shadow .14s,border-color .14s}' +
      '#usr-mod .prow:hover{transform:translateX(3px);box-shadow:0 8px 20px rgba(36,31,27,.07)}' +
      '#usr-mod .uav{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:14px;flex:none;box-shadow:0 4px 9px rgba(0,0,0,.12)}' +
      '#usr-mod .who{flex:1;min-width:0}#usr-mod .who .nm{font-weight:700;font-size:14.5px}#usr-mod .who .em{font-size:13.5px;color:var(--muted)}' +
      '#usr-mod .mcol{width:210px;display:flex;flex-direction:column;gap:5px}' +
      '#usr-mod .uchip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:999px;background:#F2ECE2;color:#3a342f}' +
      '#usr-mod .uchip.dept{background:#FBEFE2;color:#9A5A22}' +
      '#usr-mod .mgr{font-size:11.5px;color:var(--muted)}' +
      '#usr-mod .spill{font-size:11.5px;font-weight:700;padding:5px 12px;border-radius:999px;text-transform:capitalize}' +
      '#usr-mod .spill.active{background:var(--green-soft);color:var(--green)}#usr-mod .spill.on_leave{background:var(--amber-soft);color:var(--amber-deep)}#usr-mod .spill.left{background:var(--red-soft);color:var(--red)}' +
      '#usr-mod .elink{font-weight:600;font-size:14.5px;color:var(--uo);background:none;border:0;cursor:pointer;padding:8px 6px}' +
      '#usr-mod .umodal-bg{position:fixed;inset:0;background:rgba(36,31,27,.55);display:none;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow:auto;z-index:120}' +
      '#usr-mod .umodal-bg.on{display:flex}' +
      '#usr-mod .umodal{background:var(--surface);border-radius:20px;width:660px;max-width:100%;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden}' +
      '#usr-mod .usec{padding:18px 22px;border-bottom:1px solid var(--line)}#usr-mod .usec:last-child{border-bottom:0}' +
      '#usr-mod .ulabel{display:flex;align-items:center;gap:10px;margin-bottom:13px}' +
      '#usr-mod .ubadge{width:26px;height:26px;border-radius:9px;background:linear-gradient(135deg,var(--uo2),var(--uo));color:#fff;display:grid;place-items:center;font-weight:700;font-size:14.5px}' +
      '#usr-mod .ulabel h3{font-family:var(--udisp);font-weight:600;font-size:16px;margin:0}#usr-mod .ulabel .s{font-size:13.5px;color:var(--muted)}' +
      '#usr-mod label{font-size:12.5px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px}' +
      '#usr-mod input,#usr-mod select{width:100%;font-size:14px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:var(--surface);margin-bottom:13px;font-family:inherit}' +
      '#usr-mod .r2{display:grid;grid-template-columns:1fr 1fr;gap:11px}' +
      '#usr-mod .hint{font-size:11.5px;color:var(--muted);margin:-9px 0 13px}' +
      '#usr-mod .opt{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:11px;padding:8px 13px;margin:0 7px 7px 0;cursor:pointer;font-weight:600;font-size:14.5px}' +
      '#usr-mod .opt.on{border-color:var(--uo);background:#FCF0E5;color:#9A5A22}' +
      '#usr-mod .ubtn{font-weight:700;font-size:14px;border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:10px 17px;cursor:pointer}' +
      '#usr-mod .ubtn.pri{background:linear-gradient(135deg,var(--uo2),var(--uo));color:#fff;border:0;box-shadow:0 8px 18px rgba(232,114,43,.3)}' +
      '#usr-mod .ubtn.gh{color:var(--muted)}#usr-mod .ubtn[disabled]{opacity:.5;cursor:default}' +
      '#usr-mod .ufoot{display:flex;justify-content:space-between;gap:10px;padding:16px 22px;background:#FBF7F0}' +
      '#usr-mod .steps{display:flex;gap:8px;padding:16px 22px;border-bottom:1px solid var(--line);background:#FBF7F0}' +
      '#usr-mod .stp{flex:1;text-align:center;position:relative}' +
      '#usr-mod .stp .dot{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;margin:0 auto 5px;font-weight:700;font-size:13.5px;background:#EEE6D9;color:var(--muted);transition:all .25s}' +
      '#usr-mod .stp.on .dot{background:linear-gradient(135deg,var(--uo2),var(--uo));color:#fff;transform:scale(1.08)}#usr-mod .stp.done .dot{background:var(--green);color:#fff}' +
      '#usr-mod .stp .l{font-size:12.5px;font-weight:600;color:var(--muted)}#usr-mod .stp.on .l{color:var(--ink)}' +
      '#usr-mod .stp:not(:last-child):after{content:"";position:absolute;top:14px;left:62%;width:76%;height:2px;background:#EAE2D4}' +
      '#usr-mod .pane{display:none;padding:20px 22px}#usr-mod .pane.on{display:block}' +
      '#usr-mod .pane h2{font-family:var(--udisp);font-weight:600;font-size:20px;margin:0 0 4px}#usr-mod .pane .lead{color:var(--muted);font-size:14.5px;margin:0 0 16px}' +
      '#usr-mod .ring{position:relative;width:96px;height:96px;flex:none}#usr-mod .ring .n{position:absolute;inset:0;display:grid;place-items:center;text-align:center}' +
      '#usr-mod .ring .n b{font-family:var(--udisp);font-size:24px;font-weight:700;display:block;line-height:1}#usr-mod .ring .n span{font-size:11.5px;color:var(--muted);text-transform:uppercase}' +
      '#usr-mod .lwrap{display:flex;align-items:center;gap:18px;background:linear-gradient(135deg,#FFF8F0,#FDEFE0);border:1px solid #F2DCC4;border-radius:15px;padding:16px 18px}' +
      '#usr-mod .uerr{color:var(--red);font-size:14.5px;margin:8px 0;display:none}#usr-mod .uerr.on{display:block}' +
      '#usr-mod .uok{color:var(--green);font-size:14.5px;margin:8px 0;display:none}#usr-mod .uok.on{display:block}' +
      '#usr-mod .pwd{font-family:ui-monospace,monospace;font-size:18px;background:#F1EFE8;border-radius:8px;padding:10px 14px;letter-spacing:1px;margin:8px 0}' +
    '</style>' +
      '<div class="hero">' +
        '<button class="addbtn" id="usrAdd"><span class="pl">+</span> Add user</button>' +
        '<h1>People</h1><p>Everyone at FK Sports — role, manager, joining date and leave, all in one place.</p>' +
        '<div class="hstat" id="usrStat"></div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<div class="srch"><input id="usrSearch" placeholder="Search name or email…"/></div>' +
        '<div class="pills" id="usrFilter"><button data-f="all" class="on">All</button><button data-f="active">Active</button><button data-f="on_leave">On leave</button><button data-f="left">Left</button><button data-f="archived">Archived</button></div>' +
        '<button id="usrFixIds" style="margin-left:auto;border:1px solid var(--line);padding:9px 15px;border-radius:10px;background:var(--surface,#FFFDF9);cursor:pointer;font-weight:700;font-size:13.5px;color:var(--ink);display:inline-flex;align-items:center;gap:7px"><i class="ti ti-id-badge-2"></i> Fix Employee IDs</button>' +
      '</div>' +
      '<div id="usrBody"><div style="color:var(--muted);padding:20px">Loading…</div></div>' +
      '<div class="umodal-bg" id="usrModal"><div class="umodal" id="usrModalInner"></div></div>' +
    '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    if (!document.getElementById('fk-fonts-fraunces')) {
      const lk = document.createElement('link'); lk.id = 'fk-fonts-fraunces'; lk.rel = 'stylesheet';
      lk.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap';
      document.head.appendChild(lk);
    }
    const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const roleLabel = (r) => r === 'manager' ? 'Manager' : (r === 'lead' ? 'Team Lead' : (r === 'senior' ? 'Senior Executive' : 'Executive'));
    const dOnly = (d) => d ? String(d).slice(0,10) : '';
    let departments_=[], groups_=[], users_=[], archived_=[], archivedLoaded_=false, filter_='all', search_='';
    async function loadArchived(){ try{ const r=await fetch('/api/admin/users?archived=1',{credentials:'include'}); archived_=(await r.json()).users||[]; archivedLoaded_=true; }catch(e){ archived_=[]; } }

    async function init(){
      try{
        const [d,g] = await Promise.all([
          fetch('/api/admin/departments',{credentials:'include'}).then(r=>r.ok?r.json():{departments:[]}),
          fetch('/api/admin/groups',{credentials:'include'}).then(r=>r.ok?r.json():{groups:[]})
        ]);
        departments_=d.departments||[]; groups_=g.groups||[];
      }catch(e){}
      await loadUsers();
    }
    async function loadUsers(){
      try{
        const r = await fetch('/api/admin/users',{credentials:'include'});
        users_ = (await r.json()).users||[];
        renderStat(); renderRows();
      }catch(e){ $('usrBody').innerHTML='<div style="color:var(--red);padding:20px">Failed to load.</div>'; }
    }
    function renderStat(){
      const a=users_.filter(u=>u.employment_status==='active').length;
      const ol=users_.filter(u=>u.employment_status==='on_leave').length;
      const dep=new Set(); users_.forEach(u=>(u.departments||[]).forEach(d=>dep.add(d.slug)));
      $('usrStat').innerHTML='<div><b>'+a+'</b><span>Active</span></div><div><b>'+ol+'</b><span>On leave</span></div><div><b>'+dep.size+'</b><span>Departments</span></div>';
    }
    function renderRows(){
      let rows = (filter_==='archived') ? archived_ : users_;
      if(filter_!=='all' && filter_!=='archived') rows=rows.filter(u=>u.employment_status===filter_);
      if(search_){const q=search_.toLowerCase();rows=rows.filter(u=>(u.full_name||'').toLowerCase().includes(q)||(u.display_name||'').toLowerCase().includes(q)||(u.email||'').toLowerCase().includes(q));}
      if(!rows.length){$('usrBody').innerHTML='<div style="color:var(--muted);padding:20px">'+(filter_==='archived'?'No archived people.':'No people match.')+'</div>';return;}
      $('usrBody').innerHTML=rows.map(card).join('');
    }
    function card(u){
      const pd=(u.departments||[]).find(d=>d.is_primary)||(u.departments||[])[0];
      const dchip=pd?'<span class="uchip dept">'+esc(pd.name)+' · '+roleLabel(pd.role)+'</span>':'<span class="mgr">No department</span>';
      const st=u.employment_status||'active';
      return '<div class="prow" data-profile="'+u.id+'">'+
        '<div class="uav" style="background:'+(u.avatar_colour||'#888780')+'">'+esc(u.initials||'—')+'</div>'+
        '<div class="who"><div class="nm">'+esc(u.display_name||u.full_name)+'</div><div class="em">'+esc(u.email)+'</div></div>'+
        '<div class="mcol">'+dchip+'</div>'+
        '<span class="spill '+st+'">'+st.replace('_',' ')+'</span>'+
        '<button class="elink" data-edit="'+u.id+'">Edit ›</button>'+
      '</div>';
    }

    // ---------------- Bulk Employee-ID editor (r1.28) ----------------
    // One screen listing everyone with their FK#### editable, to correct wrong IDs in one go.
    function openEmpIdEditor(){
      const list = (users_||[]).slice().sort((a,b)=>(a.full_name||'').localeCompare(b.full_name||''));
      const rowsHtml = list.map(u=>{
        const pd=(u.departments||[]).find(d=>d.is_primary)||(u.departments||[])[0];
        const sub = pd ? esc(pd.name) : 'No department';
        return '<div class="eidrow" style="display:flex;align-items:center;gap:12px;padding:10px 2px;border-bottom:1px solid var(--line)">'
          + '<div class="uav" style="background:'+(u.avatar_colour||'#888780')+';width:34px;height:34px;flex-shrink:0">'+esc(u.initials||'—')+'</div>'
          + '<div style="flex:1;min-width:0"><div class="nm" style="font-weight:600">'+esc(u.display_name||u.full_name)+'</div><div class="em" style="font-size:12px;color:var(--muted)">'+sub+'</div></div>'
          + '<input class="eidinput" data-id="'+u.id+'" data-orig="'+esc(u.emp_id||'')+'" value="'+esc(u.emp_id||'')+'" placeholder="FK—" style="width:118px;text-transform:uppercase;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-weight:600"/>'
          + '<span class="eidmsg" data-for="'+u.id+'" style="width:96px;font-size:11.5px;font-weight:600"></span>'
          + '</div>';
      }).join('');
      $('usrModalInner').innerHTML =
        '<div style="padding:4px 2px 2px"><h2 style="margin:0 0 4px">Fix Employee IDs</h2>'
        + '<p class="lead" style="margin:0 0 14px;color:var(--muted)">Correct any wrong IDs and save. Format is FK followed by numbers, e.g. FK205. Blank rows are skipped.</p></div>'
        + '<div style="max-height:52vh;overflow:auto;padding-right:4px">'+rowsHtml+'</div>'
        + '<div class="uerr" id="eidErr" style="margin-top:10px"></div>'
        + '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px"><button class="ubtn gh" id="eidCancel">Close</button><button class="ubtn pri" id="eidSave">Save all changes</button></div>';
      $('usrModal').classList.add('on');
      $('eidCancel').onclick=()=>$('usrModal').classList.remove('on');
      $('eidSave').onclick=saveEmpIds;
    }
    async function saveEmpIds(){
      const inputs = Array.from(document.querySelectorAll('.eidinput'));
      const changed = inputs.filter(i=>i.value.trim().toUpperCase() !== (i.getAttribute('data-orig')||'').toUpperCase());
      document.querySelectorAll('.eidmsg').forEach(s=>{s.textContent='';s.style.color='';});
      const err=$('eidErr'); err.classList.remove('on'); err.textContent='';
      const bad = changed.filter(i=>{ const v=i.value.trim().toUpperCase(); return v && !/^FK[0-9]+$/.test(v); });
      if(bad.length){ bad.forEach(i=>{ const m=document.querySelector('.eidmsg[data-for="'+i.getAttribute('data-id')+'"]'); if(m){m.textContent='Bad format';m.style.color='#B0453A';} }); err.textContent='Some IDs aren\u2019t FK + numbers \u2014 fix the red rows.'; err.classList.add('on'); return; }
      if(!changed.length){ err.textContent='No changes to save.'; err.classList.add('on'); return; }
      const btn=$('eidSave'); btn.disabled=true; btn.textContent='Saving\u2026';
      let okN=0, failN=0;
      for(const i of changed){
        const id=i.getAttribute('data-id'); const v=i.value.trim().toUpperCase();
        const m=document.querySelector('.eidmsg[data-for="'+id+'"]');
        try{
          const r=await fetch('/api/admin/users/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({emp_id:v})});
          if(r.ok){ okN++; i.setAttribute('data-orig',v); if(m){m.textContent='Saved';m.style.color='#16A86B';} }
          else { failN++; const d=await r.json().catch(()=>({})); if(m){ m.textContent=(/in use/i.test(d.error||'')?'Already used':'Failed'); m.style.color='#B0453A'; } }
        }catch(e){ failN++; if(m){m.textContent='Failed';m.style.color='#B0453A';} }
      }
      btn.disabled=false; btn.textContent='Save all changes';
      err.textContent = okN+' saved'+(failN?(' \u00b7 '+failN+' need attention'):'.'); err.classList.add('on');
      if(okN) loadUsers();
    }

    // ---------------- Add-user wizard ----------------
    const W = { step:0, created:null };
    function openWizard(){
      W.step=0; W.created=null;
      const deptOpts=departments_.map(d=>'<option value="'+d.slug+'">'+esc(d.name)+'</option>').join('');
      const mgrOpts='<option value="">— none —</option>'+users_.filter(u=>u.employment_status==='active').map(u=>'<option value="'+u.id+'">'+esc(u.display_name||u.full_name)+'</option>').join('');
      $('usrModalInner').innerHTML=
        '<div class="steps">'+
          '<div class="stp on" data-n="0"><div class="dot">1</div><div class="l">Who</div></div>'+
          '<div class="stp" data-n="1"><div class="dot">2</div><div class="l">Access</div></div>'+
          '<div class="stp" data-n="2"><div class="dot">3</div><div class="l">Employment</div></div>'+
          '<div class="stp" data-n="3"><div class="dot">4</div><div class="l">Pay</div></div>'+
        '</div>'+
        '<div class="pane on" data-n="0"><h2>Welcome someone new</h2><p class="lead">Start with the basics. They get a login and a temporary password.</p>'+
          '<label>Full name</label><input id="wName" placeholder="e.g. Satyam Kumar"/>'+
          '<div class="r2"><div><label>Work email</label><input id="wEmail" placeholder="name@fksports.co.uk"/></div><div><label>Display name</label><input id="wDisp" placeholder="optional"/></div></div>'+
          '<label style="margin-top:10px">Employee ID</label><input id="wEmpId" placeholder="e.g. FK205 — leave blank to auto-assign"/></div>'+
        '<div class="pane" data-n="1"><h2>Where do they fit?</h2><p class="lead">Department, role and who they report to — from day one.</p>'+
          '<label>Primary department</label><select id="wDept">'+deptOpts+'</select>'+
          '<label>Role</label><div id="wRole"><span class="opt on" data-r="agent">Executive</span><span class="opt" data-r="senior">Senior Executive</span><span class="opt" data-r="lead">Team Lead</span><span class="opt" data-r="manager">Manager</span></div>'+
          '<label style="margin-top:6px">Reports to (manager)</label><select id="wMgr">'+mgrOpts+'</select></div>'+
        '<div class="pane" data-n="2"><h2>The employment record</h2><p class="lead">This drives leave accrual and payroll, so we set it now.</p>'+
          '<label>Joining date</label><input type="date" id="wHire"/>'+
          '<div class="hint">Leave accrues from this date; payroll prorates the first month.</div>'+
          '<div class="r2"><div><label>Employment type</label><select id="wType"><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option></select></div>'+
          '<div><label>Work pattern</label><select id="wPat"><option value="alternating">Alternating</option><option value="cs_rota">CS rota</option></select></div></div></div>'+
        '<div class="pane" data-n="3"><h2>Almost there</h2><p class="lead">Set their pay so payroll has them from month one. Salary stays visible to you and HR leads only.</p>'+
          '<label>Monthly salary (INR)</label><input id="wSal" type="number" placeholder="e.g. 50000"/>'+
          '<div class="hint">Stored in the secure salary record — used to build their payslip.</div>'+
          '<div class="uerr" id="wErr"></div><div class="uok" id="wOk"></div><div id="wPwdBox" style="display:none"><p style="font-size:12.5px;color:var(--muted);margin:0">Temporary password — share it with them:</p><div class="pwd" id="wPwd"></div></div></div>'+
        '<div class="ufoot"><button class="ubtn gh" id="wBack" style="visibility:hidden">‹ Back</button><button class="ubtn pri" id="wNext">Continue ›</button></div>';
      el.querySelectorAll('#wRole .opt').forEach(o=>o.onclick=function(){el.querySelectorAll('#wRole .opt').forEach(x=>x.classList.remove('on'));this.classList.add('on');});
      el.querySelectorAll('#usrModalInner .stp').forEach(s=>s.onclick=()=>{ if(!W.created){W.step=+s.dataset.n; drawW();} });
      $('wBack').onclick=()=>{ if(W.step>0){W.step--;drawW();} };
      $('wNext').onclick=wNext;
      $('usrModal').classList.add('on');
    }
    function drawW(){
      el.querySelectorAll('#usrModalInner .stp').forEach((s,i)=>{s.classList.toggle('on',i===W.step);s.classList.toggle('done',i<W.step);});
      el.querySelectorAll('#usrModalInner .pane').forEach((p,i)=>p.classList.toggle('on',i===W.step));
      $('wBack').style.visibility=W.step===0?'hidden':'visible';
      $('wNext').textContent=W.step===3?'Create user':'Continue ›';
    }
    async function wNext(){
      if(W.created){ $('usrModal').classList.remove('on'); loadUsers(); return; }
      if(W.step<3){ W.step++; drawW(); return; }
      // finish — orchestrate
      const err=$('wErr'),ok=$('wOk'),btn=$('wNext'); err.classList.remove('on');
      const name=$('wName').value.trim(), email=$('wEmail').value.trim();
      if(!name||!email){ err.textContent='Name and email are required (step 1).'; err.classList.add('on'); return; }
      btn.disabled=true; btn.textContent='Creating…';
      try{
        const role=(el.querySelector('#wRole .opt.on')||{}).dataset?(el.querySelector('#wRole .opt.on').dataset.r):'agent';
        const cr=await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({full_name:name,email:email,display_name:$('wDisp').value.trim()||undefined,primary_department_slug:$('wDept').value||undefined,group_slugs:[],emp_id:($('wEmpId')&&$('wEmpId').value.trim())||undefined})});
        const cd=await cr.json();
        if(!cr.ok) throw new Error(cd.error||'Create failed');
        const id=cd.user.id;
        // role on primary dept
        if($('wDept').value){ await fetch('/api/admin/users/'+id+'/departments',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({memberships:[{department_slug:$('wDept').value,role:role,is_primary:true}]})}); }
        // manager
        if($('wMgr').value){ await fetch('/api/profile/'+id+'/manager',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({manager_user_id:parseInt($('wMgr').value,10)})}); }
        // employment record
        await fetch('/api/admin/users/bulk-employment',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({updates:[{id:id,hire_date:dOnly($('wHire').value)||null,employment_type:$('wType').value,work_pattern:$('wPat').value}]})});
        // salary (best effort)
        const sal=parseFloat($('wSal').value);
        if(sal>0){ try{ await fetch('/api/profile/'+id+'/salary',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({monthly_ctc:sal,currency:'INR',effective_from:dOnly($('wHire').value)||undefined})}); }catch(e){} }
        // leave recompute
        try{ await fetch('/api/admin/leaves/recompute',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({user_id:id})}); }catch(e){}
        W.created=id;
        ok.textContent=name+' is set up. Share their temporary password below.'; ok.classList.add('on');
        $('wPwd').textContent=cd.initial_password; $('wPwdBox').style.display='';
        btn.disabled=false; btn.textContent='Done — close';
      }catch(e2){ err.textContent=e2.message; err.classList.add('on'); btn.disabled=false; btn.textContent='Create user'; }
    }

    // ---------------- Person record editor ----------------
    async function openRecord(id){
      const u=users_.find(x=>x.id===id)||archived_.find(x=>x.id===id); if(!u) return;
      $('usrModalInner').innerHTML='<div class="usec" style="color:var(--muted)">Loading '+esc(u.display_name||u.full_name)+'…</div>';
      $('usrModal').classList.add('on');
      let ov={}; try{ ov=await (await fetch('/api/profile/'+id+'/overview',{credentials:'include'})).json(); }catch(e){}
      const U=ov.user||{};
      const bal=ov.leave_balance&&ov.leave_balance.remaining!=null?Number(ov.leave_balance.remaining):null;
      const mgrId=U.manager_user_id||'';
      const mgrOpts='<option value="">— none —</option>'+users_.filter(x=>x.id!==id&&x.employment_status==='active').map(x=>'<option value="'+x.id+'"'+(x.id===mgrId?' selected':'')+'>'+esc(x.display_name||x.full_name)+'</option>').join('');
      const deptRows=departments_.map(d=>{const m=(u.departments||[]).find(x=>x.slug===d.slug);const ck=m?'checked':'';const role=m?m.role:'agent';const pr=m?m.is_primary:false;
        return '<label style="display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:9px;font-weight:500;margin-bottom:8px"><input type="checkbox" data-slug="'+d.slug+'" '+ck+' style="width:auto;margin:0"/><span>'+esc(d.name)+'</span>'+
          '<select data-role="'+d.slug+'" style="width:auto;margin:0;padding:4px 8px"><option value="agent"'+(role==='agent'?' selected':'')+'>Executive</option><option value="senior"'+(role==='senior'?' selected':'')+'>Senior Executive</option><option value="lead"'+(role==='lead'?' selected':'')+'>Team Lead</option><option value="manager"'+(role==='manager'?' selected':'')+'>Manager</option></select>'+
          '<label style="display:flex;align-items:center;gap:4px;margin:0;font-size:13.5px;color:var(--muted)"><input type="checkbox" data-prim="'+d.slug+'" '+(pr?'checked':'')+' style="width:auto;margin:0"/>primary</label></label>';}).join('');
      const grpRows=groups_.filter(g=>g.slug!=='employee-base').map(g=>{const has=(u.groups||[]).some(x=>x.slug===g.slug);const own=g.slug==='owner';
        return '<label style="display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:6px"><input type="checkbox" value="'+g.slug+'" '+(has?'checked':'')+' '+(own?'disabled':'')+' style="width:auto;margin:0"/>'+esc(g.name)+'</label>';}).join('');
      const ringPct=bal!=null?Math.max(0,Math.min(1,bal/24)):0;
      const dash=Math.round(276.5*(1-ringPct));
      const st=u.employment_status||'active';
      // window.fkUser carries group_slugs (not permissions), so gate on group:
      // owner + HR are exactly who hold admin.users.delete. Backend still enforces the perm.
      const canDelete_=!!(window.fkUser&&(window.fkUser.group_slugs||[]).some(function(g){return g==='owner'||g==='hr-team';}));
      const isArchived_=!!u.deleted_at;
      const archiveBtn_= (canDelete_&&isArchived_)
        ? '<button class="ubtn" id="rRestore" style="border-color:var(--green);color:var(--green)">↩ Restore person</button>'
        : (canDelete_&&st==='left')
          ? '<button class="ubtn" id="rArchive" style="border-color:var(--red);color:var(--red)">Archive</button>'
          : '';
      $('usrModalInner').innerHTML=
        '<div class="usec" style="display:flex;align-items:center;gap:14px"><div class="uav" style="width:50px;height:50px;border-radius:15px;font-size:17px;background:'+(u.avatar_colour||'#888780')+'">'+esc(u.initials||'—')+'</div>'+
          '<div style="flex:1"><div style="font-family:var(--udisp);font-weight:600;font-size:19px">'+esc(u.full_name)+'</div><div class="em" style="color:var(--muted);font-size:12.5px">'+esc(u.email)+'</div></div><span class="spill '+st+'">'+st.replace('_',' ')+'</span></div>'+
        '<input type="hidden" id="rId" value="'+id+'"/>'+
        '<div class="usec"><div class="ulabel"><span class="ubadge">1</span><div><h3>Access</h3><div class="s">Department, role &amp; groups</div></div></div>'+
          '<div id="rDepts">'+deptRows+'</div><div style="margin-top:8px" id="rGroups">'+grpRows+'</div></div>'+
        '<div class="usec"><div class="ulabel"><span class="ubadge">2</span><div><h3>Employment record</h3><div class="s">Drives leave &amp; payroll</div></div></div>'+
          '<label>Reports to</label><select id="rMgr">'+mgrOpts+'</select>'+
          '<div class="r2"><div><label>Joining date</label><input type="date" id="rHire" value="'+dOnly(u.hire_date)+'"/></div><div><label>Probation ends</label><input type="date" id="rProb" value="'+dOnly(u.probation_end_date)+'"/></div></div>'+
          '<div class="r2"><div><label>Employment type</label><select id="rType"><option value="full_time"'+(u.employment_type==='full_time'?' selected':'')+'>Full time</option><option value="part_time"'+(u.employment_type==='part_time'?' selected':'')+'>Part time</option><option value="contract"'+(u.employment_type==='contract'?' selected':'')+'>Contract</option></select></div>'+
          '<div><label>Work pattern</label><select id="rPat"><option value="alternating"'+(u.work_pattern==='alternating'?' selected':'')+'>Alternating</option><option value="cs_rota"'+(u.work_pattern==='cs_rota'?' selected':'')+'>CS rota</option></select></div></div>'+
          '<label>Notice period (days)</label><input id="rNotice" type="number" value="'+(u.notice_period_days!=null?u.notice_period_days:'')+'" style="max-width:150px"/></div>'+
        '<div class="usec"><div class="ulabel"><span class="ubadge">3</span><div><h3>Leave</h3><div class="s">Accrued balance &amp; adjustments</div></div></div>'+
          '<div class="lwrap"><div class="ring"><svg width="96" height="96" viewBox="0 0 104 104"><circle cx="52" cy="52" r="44" fill="none" stroke="#F0E2D0" stroke-width="11"/><circle cx="52" cy="52" r="44" fill="none" stroke="#E8722B" stroke-width="11" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="'+dash+'" transform="rotate(-90 52 52)"/></svg><div class="n"><b id="rBal">'+(bal!=null?bal:'—')+'</b><span>days</span></div></div>'+
          '<div style="flex:1"><div style="font-weight:700;margin-bottom:2px">Annual leave balance</div><div style="font-size:13.5px;color:var(--muted);margin-bottom:12px">Accrued to date</div>'+
          '<button class="ubtn" id="rRecompute" style="padding:8px 13px;margin-right:8px">↻ Recompute</button><button class="ubtn" id="rAdjust" style="padding:8px 13px">± Adjust</button></div></div></div>'+
        '<div class="usec"><div class="ulabel"><span class="ubadge">4</span><div><h3>Status</h3><div class="s">Active, on leave, or leaving</div></div></div>'+
          '<div id="rStatus"><span class="opt'+(st==='active'?' on':'')+'" data-st="active">Active</span><span class="opt'+(st==='on_leave'?' on':'')+'" data-st="on_leave">On leave</span><span class="opt'+(st==='left'?' on':'')+'" data-st="left">Leaver</span></div>'+
          '<div id="rLwdBox" style="margin-top:8px;display:'+(st==='left'?'block':'none')+'"><label>Last working day</label><input type="date" id="rLwd" value="'+dOnly(U.last_working_day)+'" style="max-width:200px"/><div class="hint">Stops leave accrual and feeds their final payslip.</div></div></div>'+
        '<div class="uerr" id="rErr" style="margin:0 22px"></div><div class="uok" id="rOk" style="margin:0 22px"></div>'+
        '<div class="ufoot"><div style="display:flex;gap:9px"><button class="ubtn gh" id="rReset">Reset password</button>'+archiveBtn_+'</div><div style="display:flex;gap:9px"><button class="ubtn gh" id="rCancel">Cancel</button><button class="ubtn pri" id="rSave">Save changes</button></div></div>';
      // wire editor
      el.querySelectorAll('#rStatus .opt').forEach(o=>o.onclick=function(){el.querySelectorAll('#rStatus .opt').forEach(x=>x.classList.remove('on'));this.classList.add('on');$('rLwdBox').style.display=this.dataset.st==='left'?'block':'none';});
      $('rCancel').onclick=()=>$('usrModal').classList.remove('on');
      $('rReset').onclick=()=>resetPassword(id,u.full_name);
      $('rRecompute').onclick=async()=>{ const r=await fetch('/api/admin/leaves/recompute',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({user_id:id})}); const d=await r.json(); const nb=(d&&d.remaining!=null)?d.remaining:(d&&d.balance&&d.balance.remaining); if(nb!=null)$('rBal').textContent=nb; };
      $('rAdjust').onclick=async()=>{ const delta=prompt('Adjust leave by how many days? (e.g. -1 or 2)'); if(delta===null||delta==='')return; const note=prompt('Reason (logged):')||''; const r=await fetch('/api/admin/leaves/adjust',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({user_id:id,delta:parseFloat(delta),note:note})}); const d=await r.json(); const nb=(d&&d.remaining!=null)?d.remaining:(d&&d.balance&&d.balance.remaining); if(nb!=null)$('rBal').textContent=nb; };
      $('rSave').onclick=()=>saveRecord(id);
      if($('rArchive')) $('rArchive').onclick=()=>archiveUser(id,u.full_name);
      if($('rRestore')) $('rRestore').onclick=()=>restoreUser(id,u.full_name);
    }
    async function callOK(label, url, opts){
      let r; try { r = await fetch(url, opts); } catch(e){ const err=new Error(label+': network error'); err.label=label; throw err; }
      if(!r.ok){ let m=''; try{ m=(await r.json()).error; }catch(e){} const err=new Error(label+(m?': '+m:' failed ('+r.status+')')); err.status=r.status; err.label=label; throw err; }
      return r;
    }
    async function saveRecord(id){
      const err=$('rErr'),ok=$('rOk'),btn=$('rSave'); err.classList.remove('on'); ok.classList.remove('on'); btn.disabled=true; btn.textContent='Saving…';
      const status=(el.querySelector('#rStatus .opt.on')||{}).dataset.st||'active';
      const J=(b)=>({method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(b)});
      // Build every payload up front, then save each section independently. A section the
      // viewer lacks permission for (e.g. HR editing groups) must not throw away the sections
      // that DID save — a committed department change should never read back as "permission denied".
      const memberships=Array.from(el.querySelectorAll('#rDepts input[data-slug]:checked')).map(inp=>{const s=inp.dataset.slug;return{department_slug:s,role:el.querySelector('#rDepts select[data-role="'+s+'"]').value,is_primary:el.querySelector('#rDepts input[data-prim="'+s+'"]').checked};});
      const gs=Array.from(el.querySelectorAll('#rGroups input:checked')).map(x=>x.value);
      const mgrVal=$('rMgr').value?parseInt($('rMgr').value,10):null;
      const emp={id:id,hire_date:dOnly($('rHire').value)||null,employment_type:$('rType').value,work_pattern:$('rPat').value,probation_end_date:dOnly($('rProb').value)||null,notice_period_days:($('rNotice').value!==''?parseInt($('rNotice').value,10):null)};
      if(status==='left') emp.last_working_day=dOnly($('rLwd').value)||null;
      const sections=[
        ['Status', ()=>callOK('Status','/api/admin/users/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({employment_status:status})})],
        ['Department', ()=>callOK('Departments','/api/admin/users/'+id+'/departments',J({memberships}))],
        ['Groups', ()=>callOK('Groups','/api/admin/users/'+id+'/groups',J({group_slugs:gs}))],
        ['Manager', ()=>callOK('Manager','/api/profile/'+id+'/manager',J({manager_user_id:mgrVal}))],
        ['Employment', ()=>callOK('Employment','/api/admin/users/bulk-employment',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({updates:[emp]})})],
      ];
      const saved=[], denied=[], failed=[];
      for(const [name,fn] of sections){
        try{ await fn(); saved.push(name); }
        catch(e){ if(e&&e.status===403) denied.push(name); else failed.push(e.message||(name+' failed')); }
      }
      // Verify the manager actually stuck (only if we were allowed to set it).
      if(saved.includes('Manager')){
        try{ const ov2=await (await fetch('/api/profile/'+id+'/overview',{credentials:'include',cache:'no-store'})).json(); const got=(ov2.user&&ov2.user.manager_user_id)||null; if(got!==mgrVal) failed.push('Manager: did not persist (expected '+mgrVal+', got '+(got||'none')+')'); }catch(ve){}
      }
      btn.disabled=false; btn.textContent='Save changes';
      if(failed.length){
        err.innerHTML=failed.map(esc).join('<br>')+(saved.length?'<div style="margin-top:6px;color:var(--muted);font-weight:400">Saved: '+saved.join(', ')+'.</div>':'');
        err.classList.add('on'); return;
      }
      if(denied.length){
        // Everything the viewer was allowed to change saved; only the restricted bits were skipped.
        ok.innerHTML='Saved '+saved.join(', ')+'. <span style="color:var(--muted)">You don\u2019t have permission to change: '+denied.join(', ')+' \u2014 ask the owner.</span>';
        ok.classList.add('on'); setTimeout(()=>{ $('usrModal').classList.remove('on'); loadUsers(); },1400); return;
      }
      ok.textContent='Saved.'; ok.classList.add('on');
      setTimeout(()=>{ $('usrModal').classList.remove('on'); loadUsers(); },700);
    }
    async function resetPassword(id,name){
      if(!confirm('Reset password for '+name+'? They will be forced to change it next login.')) return;
      const r=await fetch('/api/admin/users/'+id+'/reset-password',{method:'POST',credentials:'include'}); const d=await r.json();
      if(!r.ok) return alert(d.error||'Failed');
      alert('Temporary password: '+d.initial_password+'\n\nShare this with the user.');
    }
    async function archiveUser(id,name){
      if(!confirm('Archive '+name+'?\n\nThey move out of the active roster (into the Archived tab). Their record is kept and you can restore them anytime.')) return;
      try{ const r=await fetch('/api/admin/users/'+id,{method:'DELETE',credentials:'include'}); const d=await r.json().catch(()=>({})); if(!r.ok){ alert(d.error||'Failed to archive'); return; } }catch(e){ alert('Failed to archive'); return; }
      $('usrModal').classList.remove('on'); archivedLoaded_=false; await loadUsers(); if(filter_==='archived'){ await loadArchived(); renderRows(); }
    }
    async function restoreUser(id,name){
      if(!confirm('Restore '+name+'?\n\nThey return to the roster as a leaver — set them Active if you are rehiring.')) return;
      try{ const r=await fetch('/api/admin/users/'+id+'/restore',{method:'POST',credentials:'include'}); const d=await r.json().catch(()=>({})); if(!r.ok){ alert(d.error||'Failed to restore'); return; } }catch(e){ alert('Failed to restore'); return; }
      $('usrModal').classList.remove('on'); archivedLoaded_=false; await loadUsers(); if(filter_==='archived'){ await loadArchived(); renderRows(); }
    }

    // ---------------- wiring ----------------
    $('usrAdd').addEventListener('click', openWizard);
    $('usrFixIds').addEventListener('click', openEmpIdEditor);
    $('usrModal').addEventListener('click',(e)=>{ if(e.target===$('usrModal')) $('usrModal').classList.remove('on'); });
    $('usrBody').addEventListener('click',(e)=>{
      const ed=e.target.closest('[data-edit]'); if(ed){ e.stopPropagation(); openRecord(parseInt(ed.dataset.edit,10)); return; }
      const pr=e.target.closest('[data-profile]'); if(pr){ location.hash='#profile/'+pr.dataset.profile; }
    });
    $('usrSearch').addEventListener('input',(e)=>{ search_=e.target.value.trim(); renderRows(); });
    $('usrFilter').addEventListener('click',async (e)=>{ const b=e.target.closest('button[data-f]'); if(!b)return; filter_=b.dataset.f; el.querySelectorAll('#usrFilter button').forEach(x=>x.classList.toggle('on',x===b)); if(filter_==='archived' && !archivedLoaded_){ $('usrBody').innerHTML='<div style="color:var(--muted);padding:20px">Loading…</div>'; await loadArchived(); } renderRows(); });

    await init();
  }
};
