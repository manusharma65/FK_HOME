/* FK Home — Learning module (frontend). Ship 1.
   Loaded by the shell for routes #learning and #kb. Renders into the content area
   and talks to /api/learning. Answers stay on the server — options arrive without the
   correct flag; feedback comes back when an answer is graded. */
(function () {
  const API = '/api/learning';
  let assignmentId = null, courseId = null, perspective = 'tr';
  const passedChecks = {}; // sessionId -> Set(checkId)

  // ---- styles (scoped, Insights theme) ----
  if (!document.getElementById('fk-learning-css')) {
    const css = document.createElement('style'); css.id = 'fk-learning-css';
    css.textContent = `
    .lms{--canvas:#F4EFE7;--surface:#FFF;--ink:#241F1B;--line:#E9E2D6;--orange:#E8722B;--orange2:#F3992E;--chip:#F2ECE2;--muted:#8A8178;--soft:#A89E92;--green:#3E7D4F;--green-bg:#EAF1EA;--red:#B0453A;--red-bg:#F6E9E6;--amber:#B5701E;--amber-bg:#F7EEDD;--blue:#185FA5;--ai:#6F57A0;--shad:0 2px 10px rgba(36,31,27,.04);--ink2:#1F2A37;--grid:#2B3543;max-width:1040px;margin:0 auto;padding:6px 4px 70px;color:var(--ink);font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:16px;line-height:1.6}
    .lms h1,.lms h2,.lms h3,.lms h4{font-family:'Fraunces',Georgia,serif;font-weight:600;letter-spacing:-.01em}
    .lms .seg{display:inline-flex;background:var(--chip);border-radius:11px;padding:4px;gap:4px;margin-bottom:16px}
    .lms .seg button{border:0;background:transparent;font-family:inherit;font-size:13.5px;font-weight:600;color:var(--muted);padding:8px 15px;border-radius:8px;cursor:pointer}
    .lms .seg button.on{background:var(--ink);color:#FBF7F0}
    .lms .hero,.lms .hero.m{margin-top:6px;border-radius:22px;padding:30px 34px;color:#FBF3E9;position:relative;overflow:hidden;background:linear-gradient(115deg,#2A2421 0%,#3a2e25 48%,#7a3d18 100%)}
    .lms .hero:after{content:"";position:absolute;right:-80px;top:-90px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(243,153,46,.30),transparent 70%)}
    .lms .hero .ey{position:relative;text-transform:uppercase;letter-spacing:.16em;font-size:12px;font-weight:700;color:var(--orange2)}
    .lms .hero h1{position:relative;margin:9px 0 6px;font-size:30px;color:#FFF8EF}.lms .hero p{position:relative;margin:0;opacity:.9;font-size:15.5px;max-width:600px}
    .lms .sech{display:flex;align-items:baseline;gap:12px;margin:30px 2px 14px}.lms .sech h2{font-size:21px;margin:0}.lms .sech .n{color:var(--muted);font-size:14px}
    .lms .card{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shad);padding:20px 24px;display:flex;gap:16px;align-items:center;margin-bottom:12px}
    .lms .cbadge{flex:0 0 auto;padding:6px 12px;border-radius:9px;font-size:11px;font-weight:800;color:#fff;letter-spacing:.03em}
    .lms .ttl{font-family:'Fraunces',serif;font-weight:600;font-size:18px}.lms .sub{color:var(--muted);font-size:14px;margin-top:2px}
    .lms .pbar{margin-top:9px;background:var(--chip);height:8px;border-radius:999px;overflow:hidden;max-width:340px}.lms .pbar i{display:block;height:100%;background:var(--orange);border-radius:999px}
    .lms .right{margin-left:auto;display:flex;align-items:center;gap:14px}
    .lms .chip{font-size:12.5px;font-weight:700;padding:5px 12px;border-radius:999px}.lms .chip.cur{background:#F7E7D6;color:#9A4A18}.lms .chip.lock{background:var(--chip);color:var(--soft)}.lms .chip.ok{background:var(--green-bg);color:var(--green)}.lms .chip.amber{background:var(--amber-bg);color:var(--amber)}
    .lms .btn{font-family:inherit;font-weight:600;font-size:14px;border-radius:11px;padding:11px 20px;border:1px solid transparent;cursor:pointer;background:var(--orange);color:#FFF8EF}
    .lms .btn:hover{background:#D2641F}.lms .btn.g{background:var(--surface);color:var(--ink);border-color:var(--line)}.lms .btn.g:hover{background:#FBF6EE}.lms .btn:disabled{background:var(--chip);color:var(--soft);cursor:not-allowed;border-color:var(--line)}
    .lms .btn.sm{padding:8px 15px;font-size:13px}
    .lms .gate{margin-top:18px;background:#FBF6EE;border:1px solid var(--line);border-radius:14px;padding:16px 20px;font-size:14.5px;color:#5b5249}.lms .gate b{color:var(--ink)}
    .lms .scard{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shad);padding:20px 24px;display:flex;gap:18px;align-items:center;margin-bottom:14px}
    .lms .num{flex:0 0 auto;width:44px;height:44px;border-radius:13px;background:var(--chip);border:1px solid var(--line);display:grid;place-items:center;font-family:'Fraunces',serif;font-weight:600;font-size:19px;color:var(--soft)}
    .lms .scard.done .num{background:var(--green-bg);border-color:#CBE0CB;color:var(--green)}.lms .scard.cur .num{background:var(--orange);border-color:var(--orange);color:#FFF8EF}.lms .scard.lock{opacity:.62}
    .lms .sobj{color:var(--muted);font-size:14.5px;margin-top:3px}
    .lms .back{background:none;border:0;color:var(--orange);font-family:inherit;font-weight:600;font-size:14px;cursor:pointer;padding:0;margin-bottom:14px}
    .lms .lesson{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shad);padding:34px 40px;margin-top:6px}
    .lms .ey2{text-transform:uppercase;letter-spacing:.1em;font-size:11.5px;font-weight:700;color:var(--soft)}
    .lms .lesson h1{font-size:27px;margin:8px 0 4px}.lms .lead{color:var(--muted);font-size:16px;margin:0}
    .lms .obj{background:#FBF6EE;border:1px solid var(--line);border-left:3px solid var(--orange);border-radius:12px;padding:16px 20px;margin:20px 0;font-size:16px}.lms .obj b{font-family:'Fraunces',serif}
    .lms .lesson p{margin:0 0 14px;font-size:16px;line-height:1.7}.lms .lesson ul,.lms .lesson ol{margin:0 0 14px;padding-left:24px}.lms .lesson li{margin-bottom:8px;font-size:16px;line-height:1.65}.lms code{background:var(--chip);border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:14px;font-family:ui-monospace,monospace}
    .lms .lesson h4{font-family:'Fraunces',Georgia,serif;font-size:19px;margin:30px 0 12px;color:var(--ink)}
    .lms .lesson p.ref{text-transform:uppercase;letter-spacing:.09em;font-size:11.5px;font-weight:700;color:var(--soft);margin:0 0 18px}
    .lms .lesson table.sop{width:100%;border-collapse:collapse;margin:14px 0 18px;font-size:15.5px}
    .lms .lesson table.sop th{text-align:left;padding:12px 16px;background:#FAF5ED;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;border-bottom:1px solid var(--line)}
    .lms .lesson table.sop td{padding:13px 16px;border-bottom:1px solid #F0E9DC;vertical-align:top}
    .lms .lesson table.sop tr:last-child td{border-bottom:0}
    .lms .lesson .warn{background:#FBF1E8;border:1px solid #EBD3BE;border-left:4px solid var(--orange);border-radius:12px;padding:16px 20px;margin:16px 0;font-size:16px;line-height:1.65}
    .lms .lms-order{background:var(--ink2);color:#E7ECF2;border-radius:13px;margin:16px 0;overflow:hidden;font-size:14px;border:1px solid var(--grid)}
    .lms .lms-order .ob{background:#0F1620;padding:9px 16px;font-family:ui-monospace,monospace;font-size:12px;color:#9FB0C3;border-bottom:1px solid var(--grid)}.lms .lms-order .ob .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--orange);margin-right:7px}.lms .lms-order .ob b{color:#E7ECF2}
    .lms .lms-order table{width:100%;border-collapse:collapse}.lms .lms-order td{padding:9px 16px;border-bottom:1px solid var(--grid);vertical-align:top}.lms .lms-order td.k{color:#8FA1B5;width:112px;font-size:12px;text-transform:uppercase}.lms .lms-order td.v{font-family:ui-monospace,monospace}.lms .lms-order tr:last-child td{border-bottom:0}.lms .lms-order .sel{background:#3a2a1a;border:1px solid #6b4a22;border-radius:6px;padding:2px 8px;color:#F0C998}
    .lms .gate2{margin-top:28px;border-top:1px solid var(--line);padding-top:18px}.lms .meter{font-size:12.5px;font-weight:700;color:var(--muted);background:#FBF6EE;border:1px solid var(--line);padding:6px 12px;border-radius:999px;float:right}
    .lms .q{background:#FBF6EE;border:1px solid var(--line);border-radius:16px;padding:20px 24px;margin-top:16px}.lms .q .tag{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#9A4A18}.lms .q .tag.ft{color:var(--ai)}.lms .q .tag.apt{color:#185FA5}
    .lms .kbtop{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px}.lms .back.pdf{color:#9A4A18}
    .lms .mt .acc{display:flex;flex-direction:column;line-height:1.15}.lms .mt .acc b{font-size:15px;color:var(--ink)}.lms .mt .acc span{font-size:11px;color:#8B8173}.lms .mt .acc .muted{color:#B8AE9F;font-weight:400}
    .lms .q .pr{font-weight:600;margin:12px 0;font-size:16px}
    .lms .opt{display:block;width:100%;text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:13px 17px;margin-bottom:10px;cursor:pointer;font-size:15.5px;font-family:inherit;color:var(--ink)}
    .lms .opt:hover{border-color:var(--orange2)}.lms .opt:disabled{cursor:default}.lms .opt.r{background:var(--green-bg);border-color:#CBE0CB}.lms .opt.w{background:var(--red-bg);border-color:#E8C9C1}
    .lms textarea{width:100%;border:1px solid var(--line);border-radius:11px;padding:12px 15px;font-family:inherit;font-size:15.5px;min-height:84px;background:var(--surface)}
    .lms .fb{margin-top:10px;font-size:14.5px;border-radius:11px;padding:12px 16px;display:none;line-height:1.55}.lms .fb.s{display:block}.lms .fb.good{background:var(--green-bg);border:1px solid #CBE0CB;color:var(--green)}.lms .fb.bad{background:var(--red-bg);border:1px solid #E8C9C1;color:var(--red)}.lms .fb.ai{background:#EFEAF6;border:1px solid #D9CEE9;color:var(--ai)}.lms .fb .c{margin-top:5px;font-weight:700}
    .lms .ff{display:flex;justify-content:space-between;align-items:center;margin-top:26px;gap:14px;flex-wrap:wrap}.lms .ff .h{color:var(--muted);font-size:13.5px}
    .lms table.mt{width:100%;border-collapse:collapse;font-size:15px;background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:var(--shad)}
    .lms table.mt th{text-align:left;padding:14px 18px;background:#FAF5ED;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;border-bottom:1px solid var(--line)}
    .lms table.mt td{padding:15px 18px;border-bottom:1px solid #F0E9DC}.lms table.mt .nm{font-family:'Fraunces',serif;font-weight:600;font-size:15.5px}.lms .prog{display:flex;align-items:center;gap:10px;min-width:150px}.lms .pb2{flex:1;height:8px;background:var(--chip);border-radius:999px;overflow:hidden}.lms .pb2 i{display:block;height:100%;background:var(--orange);border-radius:999px}
    .lms .search{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:13px 18px;margin-top:16px}.lms .search input{border:0;background:none;outline:none;font-family:inherit;font-size:15.5px;width:100%;color:var(--ink)}
    .lms .tiles{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.lms .tile{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px 24px;box-shadow:var(--shad);cursor:pointer}.lms .tile:hover{border-color:var(--orange2)}.lms .tile .tk{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);font-weight:700}.lms .tile h3{margin:8px 0 5px;font-size:18px}.lms .tile p{margin:0;font-size:14.5px;color:var(--muted)}
    .lms .ratetab{width:100%;border-collapse:collapse;font-size:15.5px}.lms .ratetab th{text-align:left;padding:12px 16px;background:#FAF5ED;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;border-bottom:1px solid var(--line)}.lms .ratetab td{padding:13px 16px;border-bottom:1px solid #F0E9DC}.lms .ratetab .dot{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:8px;vertical-align:middle}
    .lms .fc{height:130px;perspective:1000px;cursor:pointer;margin-bottom:12px}.lms .fc .in{position:relative;width:100%;height:100%;transition:transform .5s;transform-style:preserve-3d}.lms .fc.f .in{transform:rotateY(180deg)}.lms .fc .fa{position:absolute;inset:0;backface-visibility:hidden;border-radius:14px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;padding:18px;text-align:center;font-family:'Fraunces',serif;font-size:16px;background:var(--surface)}.lms .fc .bk{background:#FBF6EE;transform:rotateY(180deg);font-size:15px;font-family:'Hanken Grotesk',sans-serif}
    `;
    document.head.appendChild(css);
  }

  function api(path, opts) { return fetch(API + path, Object.assign({ headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }, opts)).then(r => r.json()); }
  function el(id) { return document.getElementById(id); }
  function lms() { return el('lmsRoot'); }

  // ---------- trainee: course list ----------
  function renderList(c) {
    const segbar = perspective === 'mgr' ? '' : '';
    lms().innerHTML =
      seg() +
      '<div class="hero"><div class="ey">Learn · My Learning</div><h1>Your training</h1><p>The checks get harder as you go — by the end you\u2019re clearing real orders with buried problems.</p></div>' +
      '<div class="sech"><h2>Assigned to you</h2><span class="n">' + (c.status === 'completed' ? 'Complete' : '1 in progress') + '</span></div>' +
      '<div class="card"><span class="cbadge" style="background:#C2562E">' + (c.department || '').toUpperCase() + '</span>' +
      '<div><div class="ttl">' + c.title + '</div><div class="sub">assigned by HR' + (c.due_date ? ' · due ' + c.due_date : '') + '</div></div>' +
      '<div class="right"><span class="chip ' + (c.status === 'completed' ? 'ok' : 'cur') + '">' + (c.status === 'completed' ? 'Complete' : 'In progress') + '</span>' +
      '<button class="btn" id="lmsOpen">Open</button></div></div>' +
      '<div class="gate">You\u2019ll be marked <b>logistics-ready</b> once all sessions are complete <b>and</b> your manager signs you off.</div>';
    el('lmsOpen').onclick = openCourse;
  }
  function seg() {
    return '<div class="seg"><button id="segTr" class="' + (perspective === 'tr' ? 'on' : '') + '">New starter</button><button id="segMgr" class="' + (perspective === 'mgr' ? 'on' : '') + '">Manager</button></div>';
  }
  function wireSeg() {
    if (el('segTr')) el('segTr').onclick = () => { perspective = 'tr'; boot('learn'); };
    if (el('segMgr')) el('segMgr').onclick = () => { perspective = 'mgr'; renderManager(); };
  }

  // ---------- course (sessions) ----------
  async function openCourse() {
    const data = await api('/course/' + courseId);
    assignmentId = data.assignmentId;
    let cards = '';
    data.sessions.forEach((s, i) => {
      const cls = s.status === 'passed' ? 'done' : (s.status === 'current' ? 'cur' : 'lock');
      let right = s.status === 'passed' ? '<span class="chip ok">Complete</span>'
        : (s.status === 'current' ? '<button class="btn lmsS" data-s="' + s.id + '">Open</button>'
          : '<span class="chip lock">Locked</span>');
      cards += '<div class="scard ' + cls + '"><div class="num">' + (s.status === 'passed' ? '\u2713' : (i + 1)) + '</div>' +
        '<div style="flex:1"><div class="ttl">' + s.title + '</div>' + (s.objective ? '<div class="sobj">' + s.objective + '</div>' : '') + '</div>' +
        '<div class="right">' + right + '</div></div>';
    });
    lms().innerHTML = '<button class="back" id="bk">\u2039 Back</button>' +
      '<div class="hero"><div class="ey">Logistics course</div><h1>Courier Selection &amp; Dispatch</h1><p>Pass each session\u2019s checks to unlock the next.</p></div>' +
      '<div class="sech"><h2>Sessions</h2></div>' + cards;
    el('bk').onclick = () => boot('learn');
    Array.from(document.querySelectorAll('.lmsS')).forEach(b => b.onclick = () => openSession(parseInt(b.getAttribute('data-s'), 10)));
  }

  // ---------- session ----------
  async function openSession(sid) {
    const data = await api('/session/' + sid);
    if (!passedChecks[sid]) passedChecks[sid] = new Set();
    let checks = '';
    data.checks.forEach((c, ci) => {
      if (c.type === 'free_text') {
        checks += '<div class="q" data-c="' + c.id + '"><span class="tag ft">Free-text · AI graded</span><div class="pr">' + c.prompt + '</div>' +
          '<textarea id="ft' + c.id + '" placeholder="Type your answer\u2026"></textarea>' +
          '<button class="btn g lmsFt" data-c="' + c.id + '" style="margin-top:9px">Submit answer</button><div class="fb" id="fb' + c.id + '"></div></div>';
      } else {
        let opts = '';
        c.options.forEach((o, oi) => { opts += '<button class="opt lmsOpt" data-c="' + c.id + '" data-o="' + oi + '">' + o.text + '</button>'; });
        var isApt = c.tag === 'Aptitude';
        var kick = c.tag ? (isApt ? 'Aptitude · reasoning' : c.tag) : 'Process / decide';
        checks += '<div class="q" data-c="' + c.id + '"><span class="tag' + (isApt ? ' apt' : '') + '">' + kick + '</span><div class="pr">' + c.prompt + '</div>' + opts + '<div class="fb" id="fb' + c.id + '"></div></div>';
      }
    });
    const s = data.session;
    lms().innerHTML = '<button class="back" id="bk">\u2039 Back to course</button>' +
      '<div class="lesson"><div class="ey2">' + s.title + '</div><h1>' + s.title + '</h1>' +
      (s.objective ? '<div class="obj"><b>By the end you\u2019ll be able to:</b> ' + s.objective + '</div>' : '') +
      (s.body_html || '') +
      '<div class="gate2"><span class="meter" id="mtr">0 of ' + data.checks.length + ' passed</span><h3 style="margin:0 0 4px">Now you try</h3>' +
      '<p style="color:#8B8173;font-size:13px;margin:0">Pass all of these to unlock the next session. The obvious answer is often wrong \u2014 you can retry.</p>' +
      checks +
      '<div class="ff"><span class="h">Pass every check to complete this session.</span>' +
      '<button class="btn" id="cmp" disabled>Mark session complete</button></div></div>';
    el('bk').onclick = openCourse;
    el('cmp').onclick = () => completeSession(sid);
    const totalChecks = data.checks.length;
    Array.from(document.querySelectorAll('.lmsOpt')).forEach(b => b.onclick = () => grade(b, sid, totalChecks));
    Array.from(document.querySelectorAll('.lmsFt')).forEach(b => b.onclick = () => gradeFt(b, sid, totalChecks));
    refreshMeter(sid, totalChecks);
  }
  async function grade(btn, sid, totalChecks) {
    const cid = parseInt(btn.getAttribute('data-c'), 10), oi = btn.getAttribute('data-o');
    const out = await api('/check/' + cid, { method: 'POST', body: JSON.stringify({ assignmentId, answer: oi }) });
    const q = document.querySelector('.q[data-c="' + cid + '"]'), fb = el('fb' + cid);
    q.querySelectorAll('.opt').forEach(o => o.classList.remove('w'));
    if (out.result === 'pass') {
      btn.classList.add('r'); q.querySelectorAll('.opt').forEach(o => o.disabled = true);
      fb.className = 'fb s good'; fb.innerHTML = out.feedback || 'Correct.';
      passedChecks[sid].add(cid); refreshMeter(sid, totalChecks);
    } else {
      btn.classList.add('w'); fb.className = 'fb s bad';
      fb.innerHTML = (out.feedback || 'Not quite.') + (out.cost ? '<div class="c">Cost: ' + out.cost + '</div>' : '') + '<div style="margin-top:5px;color:#8B8173;font-size:12px">Try again.</div>';
    }
  }
  async function gradeFt(btn, sid, totalChecks) {
    const cid = parseInt(btn.getAttribute('data-c'), 10), val = (el('ft' + cid).value || '').trim(), fb = el('fb' + cid);
    if (val.length < 10) { fb.className = 'fb s bad'; fb.textContent = 'Write a bit more so it can be assessed.'; return; }
    const out = await api('/check/' + cid, { method: 'POST', body: JSON.stringify({ assignmentId, answer: val }) });
    fb.className = 'fb s ai'; fb.innerHTML = out.feedback || 'Saved for review.';
    passedChecks[sid].add(cid); refreshMeter(sid, totalChecks);
  }
  function refreshMeter(sid, totalChecks) {
    const n = passedChecks[sid].size;
    if (el('mtr')) el('mtr').textContent = n + ' of ' + totalChecks + ' passed';
    if (el('cmp')) el('cmp').disabled = n < totalChecks;
  }
  async function completeSession(sid) {
    const out = await api('/session/' + sid + '/complete', { method: 'POST', body: JSON.stringify({ assignmentId }) });
    if (out.passed) openCourse();
    else alert('Pass every check first (free-text answers are confirmed by your manager in the live version).');
  }

  // ---------- manager ----------
  async function renderManager() {
    const rows = await api('/manager/progress/' + (courseId || 1));
    let trs = '';
    rows.forEach(r => {
      const pct = r.total ? Math.round(r.done / r.total * 100) : 0;
      const canSign = r.status === 'completed' && r.competency_status !== 'active';
      const st = r.competency_status === 'active' ? 'Signed off' : (r.status === 'completed' ? 'Awaiting sign-off' : (r.done > 0 ? 'In progress' : 'Not started'));
      const acc = (r.accuracy_pct == null) ? '<span class="muted">\u2014</span>' : (r.accuracy_pct + '%');
      const tries = Number(r.attempts_total) || 0;
      trs += '<tr><td><b>' + r.full_name + '</b></td>' +
        '<td><div class="prog"><div class="pb2"><i style="width:' + pct + '%"></i></div><span>' + pct + '%</span></div></td>' +
        '<td><div class="acc"><b>' + acc + '</b><span>' + tries + (tries === 1 ? ' try' : ' tries') + '</span></div></td>' +
        '<td><span class="chip ' + (r.competency_status === 'active' || canSign ? 'ok' : 'cur') + '">' + st + '</span></td>' +
        '<td><button class="btn ' + (canSign ? '' : 'g') + ' lmsSign" data-u="' + r.user_id + '" ' + (canSign ? '' : 'disabled') + '>' + (r.competency_status === 'active' ? 'Signed off \u2713' : 'Sign off') + '</button></td></tr>';
    });
    lms().innerHTML = seg() +
      '<div class="hero m"><div class="ey">Manager</div><h1>Logistics training \u2014 team</h1><p>Watch progress and sign people off when they\u2019re ready.</p></div>' +
      '<div class="sech"><h2>Progress</h2><span class="n">First-try accuracy = right on the first attempt \u2014 compare trainees on probation</span></div>' +
      '<table class="mt"><tr><th>Team member</th><th>Progress</th><th>First-try accuracy</th><th>Status</th><th></th></tr>' + trs + '</table>' +
      '<div class="gate" style="margin-top:18px">Signing off confirms they\u2019ve shown it on real orders \u2014 it flips <b>logistics-ready</b> on their profile with an annual recert date.</div>';
    wireSeg();
    Array.from(document.querySelectorAll('.lmsSign')).forEach(b => b.onclick = async () => {
      const out = await api('/signoff', { method: 'POST', body: JSON.stringify({ courseId: courseId, userId: parseInt(b.getAttribute('data-u'), 10) }) });
      if (out.ok) renderManager(); else alert('That person needs all sessions complete first.');
    });
  }

  // ---------- knowledge base ----------
  async function renderKB() {
    const items = await api('/kb');
    const deptLabel = items.length ? String(items[0].department || '').replace(/\b\w/g, c => c.toUpperCase()) : '';
    let tiles = '';
    items.forEach(it => { var blurb = (it.config_json && it.config_json.summary) || ({ rate_card: 'All couriers, sizes and prices.', flashcard: 'Drill the numbers.', error_table: 'The fix for each error.', sop: 'The full document.', article: 'Reference.', calculator_link: 'Tool.' }[it.type] || 'Reference.'); var tk = (it.type === 'sop' ? 'How-to · SOP' : 'Quick reference'); tiles += '<div class="tile lmsKb" data-i="' + it.id + '"><div class="tk">' + tk + '</div><h3>' + it.title + '</h3><p>' + blurb + '</p></div>'; });
    lms().innerHTML =
      '<div class="hero m"><div class="ey">Learn · Knowledge Base</div><h1>Knowledge Base</h1><p>Always here, never locked. Forget a rate or a step \u2014 look it up in seconds.</p></div>' +
      '<div class="search"><input id="kbq" placeholder="Search\u2026"></div>' +
      (items.length
        ? '<div class="sech"><h2>' + deptLabel + '</h2></div><div class="tiles" id="kbt">' + tiles + '</div>'
        : '<div class="card" style="opacity:.75;margin-top:8px"><div><div class="ttl">Nothing for your department yet</div><div class="sub">Reference material will appear here when it\u2019s added for your team.</div></div></div>');
    const data = {}; items.forEach(it => data[it.id] = it);
    Array.from(document.querySelectorAll('.lmsKb')).forEach(t => t.onclick = () => openKB(data[t.getAttribute('data-i')]));
    el('kbq').oninput = e => { const v = e.target.value.toLowerCase(); Array.from(document.querySelectorAll('.lmsKb')).forEach(t => { t.style.display = (data[t.getAttribute('data-i')].title.toLowerCase().includes(v)) ? '' : 'none'; }); };
  }
  function openKB(it) {
    let body = it.body_html || '';
    const cfg = it.config_json ? (typeof it.config_json === 'string' ? JSON.parse(it.config_json) : it.config_json) : null;
    if (it.type === 'rate_card' && cfg) {
      body = '<table class="ratetab"><tr><th style="text-align:left">Courier</th><th style="text-align:left">Limits</th><th style="text-align:left">Formula</th></tr>';
      cfg.couriers.forEach(c => { body += '<tr><td><span class="dot" style="background:' + c.colour + '"></span>' + c.name + '</td><td>' + c.limits + '</td><td>' + c.formula + '</td></tr>'; });
      body += '</table><p style="color:#8B8173;font-size:12px;margin-top:8px">Verified ' + (it.verified_on || '') + '.</p>';
    }
    if (it.type === 'flashcard' && cfg) {
      body = ''; cfg.cards.forEach(c => { body += '<div class="fc" onclick="this.classList.toggle(\'f\')"><div class="in"><div class="fa">' + c.q + '</div><div class="fa bk">' + c.a + '</div></div></div>'; });
    }
    lms().innerHTML = '<div class="kbtop"><button class="back" id="bk">\u2039 Back to Knowledge Base</button><button class="back pdf" id="pdf">\u2913 Save as PDF</button></div><div class="lesson" id="kbdoc"><h3 style="margin-top:0">' + it.title + '</h3>' + body + '</div>';
    el('bk').onclick = renderKB;
    el('pdf').onclick = () => printDoc(it.title, it.verified_on, body);
  }

  function printDoc(title, verified, bodyHtml) {
    var w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups for this page to save as PDF.'); return; }
    var css = 'body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#241F1B;max-width:760px;margin:32px auto;padding:0 28px;line-height:1.6}'
      + 'h1{font-size:23px;margin:0 0 4px}h4{font-size:14px;margin:18px 0 6px}p,li{font-size:13.5px}'
      + 'table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #E9E2D6;padding:7px 10px;text-align:left;font-size:12.5px;vertical-align:top}th{background:#F4EFE7}'
      + '.warn{background:#F6E9E6;border-left:3px solid #B0453A;padding:10px 13px;margin:14px 0;border-radius:6px;font-size:13px}'
      + '.fc{display:none}.foot{color:#8B8173;font-size:11.5px;margin-top:26px;border-top:1px solid #E9E2D6;padding-top:10px}';
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><style>' + css + '</style></head><body><h1>' + title + '</h1>' + bodyHtml + '<div class="foot">FK Sports \u2014 Despatch Coordinator reference' + (verified ? ' \u00b7 verified ' + verified : '') + '. Printed from FK Home Academy.</div></body></html>');
    w.document.close(); w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
  }

  // ---------- boot: fetch + render the live UI into #lmsRoot, then wire ----------
  async function boot(view) {
    const r = lms(); if (!r) return;
    try { await bootInner(view); }
    catch (e) {
      console.error('[learning]', e);
      r.innerHTML = '<div class="hero"><h1>' + (view === 'kb' ? 'Knowledge Base' : 'My Learning') + '</h1></div>' +
        '<div style="padding:28px;text-align:center;color:#8B8173">Couldn\'t load just now. <button class="btn" id="lmsRetry" style="margin-left:8px">Retry</button></div>';
      if (el('lmsRetry')) el('lmsRetry').onclick = () => { r.innerHTML = '<div style="padding:40px;text-align:center;color:#8B8173">Loading…</div>'; boot(view); };
    }
  }
  async function bootInner(view) {
    const r = lms(); if (!r) return;
    if (view === 'kb') { await renderKB(); wireSeg(); return; }
    const courses = await api('/my-courses');
    if (!courses.length) {
      // r1.28 — show only courses AVAILABLE to this person's department. Was a hardcoded
      // logistics card shown to everyone (HR/Amazon saw "Courier Selection & Dispatch").
      let avail = [];
      try { avail = await api('/available'); } catch (e) { avail = []; }
      const availHtml = avail.length
        ? avail.map(c => '<div class="card"><span class="cbadge" style="background:#C2562E">' + String(c.department || '').toUpperCase() + '</span><div><div class="ttl">' + c.title + '</div><div class="sub">Start the course</div></div><div class="right"><button class="btn lmsStart" data-slug="' + (c.slug || '') + '">Start</button></div></div>').join('')
        : '<div class="card" style="opacity:.75"><div><div class="ttl">No training for your department yet</div><div class="sub">New courses appear here when they\u2019re added for your team.</div></div></div>';
      r.innerHTML = seg() + '<div class="hero"><div class="ey">Learn \u00b7 My Learning</div><h1>Your training</h1><p>No course assigned yet.</p></div>' +
        '<div class="sech"><h2>Available</h2></div>' + availHtml;
      wireSeg();
      Array.from(document.querySelectorAll('.lmsStart')).forEach(b => b.onclick = async () => {
        try { await api('/assign', { method: 'POST', body: JSON.stringify({ slug: b.getAttribute('data-slug') || undefined }) }); boot('learn'); }
        catch (e) { alert('Could not start this course.'); }
      });
      return;
    }
    courseId = courses[0].id;
    renderList(courses[0]);
    wireSeg();
  }

  // render() returns an HTML string for the loader to inject into <main class="content">;
  // the real fetch + interactivity happens right after, once that HTML is on the page.
  function moduleDef(initialView) {
    return {
      title: initialView === 'kb' ? 'Knowledge Base' : 'My Learning',
      noHero: true,
      render() {
        perspective = 'tr';
        setTimeout(() => { try { boot(initialView); } catch (e) { console.error('[learning]', e); } }, 0);
        return '<div class="lms" id="lmsRoot"><div style="padding:40px;text-align:center;color:#8B8173">Loading…</div></div>';
      }
    };
  }

  window.fkModules = window.fkModules || {};
  window.fkModules['learning'] = moduleDef('learn');
  window.fkModules['kb'] = moduleDef('kb');
})();
