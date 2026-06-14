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
    .lms{--terra:#C2562E;--terrad:#A8431F;--orange:#E8722B;--ai:#6F57A0;--ok:#3F7A52;--okbg:#E6EFE2;--okline:#CFE0C7;--err:#B23A2E;--errbg:#F7E5E0;--errline:#E8C9C1;--surf:#FFFBF4;--surf2:#FBF5EA;--line:#E6DCC8;--muted:#8B8173;--ink:#2C2620;--lock:#A89E8C;--ink2:#1F2A37;--grid:#2B3543;max-width:840px;margin:0 auto;padding:6px 4px 60px;color:var(--ink);font-family:'Hanken Grotesk',system-ui,sans-serif}
    .lms h1,.lms h2,.lms h3{font-family:'Fraunces',Georgia,serif;font-weight:600}
    .lms .seg{display:inline-flex;background:#EDE4D3;border-radius:10px;padding:3px;gap:3px;margin-bottom:14px}
    .lms .seg button{border:0;background:transparent;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--muted);padding:6px 12px;border-radius:7px;cursor:pointer}
    .lms .seg button.on{background:var(--surf);color:var(--ink);box-shadow:0 1px 2px rgba(44,38,32,.08)}
    .lms .hero{border-radius:18px;padding:22px 26px;color:#FFF6EC;background:linear-gradient(135deg,#C2562E,#D8703A 60%,#E59A57)}
    .lms .hero.m{background:linear-gradient(135deg,#8C5A3A,#B07142 60%,#C2562E)}
    .lms .hero .ey{text-transform:uppercase;letter-spacing:.13em;font-size:11px;font-weight:700;opacity:.85}
    .lms .hero h1{margin:6px 0 4px;font-size:24px;color:#FFF7EE}.lms .hero p{margin:0;opacity:.93;font-size:13.5px}
    .lms .sech{display:flex;align-items:baseline;gap:12px;margin:26px 2px 12px}.lms .sech h2{font-size:18px;margin:0}.lms .sech .n{color:var(--muted);font-size:13px}
    .lms .card{background:var(--surf);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;gap:14px;align-items:center;margin-bottom:10px}
    .lms .cbadge{flex:0 0 auto;padding:5px 11px;border-radius:8px;font-size:11px;font-weight:800;color:#fff}
    .lms .ttl{font-family:'Fraunces',serif;font-weight:600;font-size:15.5px}.lms .sub{color:var(--muted);font-size:12.5px;margin-top:2px}
    .lms .pbar{margin-top:9px;background:#EDE4D3;height:8px;border-radius:999px;overflow:hidden;max-width:320px}.lms .pbar i{display:block;height:100%;background:var(--terra);border-radius:999px}
    .lms .right{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
    .lms .chip{font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px}.lms .chip.cur{background:#F6E0D4;color:var(--terrad)}.lms .chip.lock{background:#EDE4D3;color:var(--lock)}.lms .chip.ok{background:var(--okbg);color:var(--ok)}
    .lms .btn{font-family:inherit;font-weight:600;font-size:13.5px;border-radius:10px;padding:10px 18px;border:1px solid transparent;cursor:pointer;background:var(--orange);color:#fff}
    .lms .btn:hover{filter:brightness(.95)}.lms .btn.g{background:var(--surf);color:var(--ink);border-color:var(--line)}.lms .btn:disabled{background:#EDE4D3;color:var(--lock);cursor:not-allowed}
    .lms .gate{margin-top:6px;background:var(--surf2);border:1px dashed var(--line);border-radius:12px;padding:13px 16px;font-size:13px;color:var(--muted)}.lms .gate b{color:var(--ink)}
    .lms .scard{background:var(--surf);border:1px solid var(--line);border-radius:13px;padding:15px 17px;display:flex;gap:14px;align-items:center;margin-bottom:10px}
    .lms .num{flex:0 0 auto;width:34px;height:34px;border-radius:10px;background:var(--surf2);border:1px solid var(--line);display:grid;place-items:center;font-family:'Fraunces',serif;font-weight:600;color:var(--muted)}
    .lms .scard.done .num{background:var(--okbg);border-color:var(--okline);color:var(--ok)}.lms .scard.cur .num{background:var(--terra);border-color:var(--terra);color:#fff}.lms .scard.lock{opacity:.6}
    .lms .back{background:none;border:0;color:var(--terrad);font-family:inherit;font-weight:600;font-size:13.5px;cursor:pointer;padding:0;margin-bottom:14px}
    .lms .lesson{background:var(--surf);border:1px solid var(--line);border-radius:18px;padding:26px 30px}
    .lms .ey2{text-transform:uppercase;letter-spacing:.13em;font-size:11px;font-weight:700;color:var(--terra)}
    .lms .lesson h1{font-size:23px;margin:6px 0 3px}.lms .lead{color:var(--muted);font-size:14px;margin:0}
    .lms .obj{background:var(--surf2);border:1px solid var(--line);border-left:3px solid var(--terra);border-radius:10px;padding:13px 16px;margin:16px 0;font-size:14px}
    .lms .lesson p{margin:0 0 11px}.lms .lesson ul{margin:0 0 11px;padding-left:20px}.lms .lesson li{margin-bottom:5px}.lms code{background:#fff;border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:12.5px}
    .lms .lms-order{background:var(--ink2);color:#E7ECF2;border-radius:11px;margin:12px 0;overflow:hidden;font-size:13px;border:1px solid var(--grid)}
    .lms .lms-order .ob{background:#0F1620;padding:8px 14px;font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#9FB0C3;border-bottom:1px solid var(--grid)}.lms .lms-order .ob .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#E8722B;margin-right:7px}.lms .lms-order .ob b{color:#E7ECF2}
    .lms .lms-order table{width:100%;border-collapse:collapse}.lms .lms-order td{padding:7px 14px;border-bottom:1px solid var(--grid);vertical-align:top}.lms .lms-order td.k{color:#8FA1B5;width:104px;font-size:11.5px;text-transform:uppercase}.lms .lms-order td.v{font-family:'IBM Plex Mono',monospace}.lms .lms-order tr:last-child td{border-bottom:0}.lms .lms-order .sel{background:#3a2a1a;border:1px solid #6b4a22;border-radius:6px;padding:2px 8px;color:#F0C998}
    .lms .gate2{margin-top:24px;border-top:2px solid var(--line);padding-top:14px}.lms .meter{font-size:12px;font-weight:700;color:var(--muted);background:var(--surf2);border:1px solid var(--line);padding:5px 11px;border-radius:999px;float:right}
    .lms .q{background:var(--surf2);border:1px solid var(--line);border-radius:13px;padding:17px 19px;margin-top:14px}.lms .q .tag{font-size:11px;font-weight:700;text-transform:uppercase;color:var(--terra)}.lms .q .tag.ft{color:var(--ai)}
    .lms .q .pr{font-weight:700;margin:11px 0;font-size:14.5px}
    .lms .opt{display:block;width:100%;text-align:left;background:var(--surf);border:1px solid var(--line);border-radius:10px;padding:12px 15px;margin-bottom:8px;cursor:pointer;font-size:14px;font-family:inherit;color:var(--ink)}
    .lms .opt:hover{border-color:var(--orange)}.lms .opt:disabled{cursor:default}.lms .opt.r{background:var(--okbg);border-color:var(--okline)}.lms .opt.w{background:var(--errbg);border-color:var(--errline)}
    .lms textarea{width:100%;border:1px solid var(--line);border-radius:9px;padding:11px 13px;font-family:inherit;font-size:14px;min-height:74px;background:var(--surf)}
    .lms .fb{margin-top:8px;font-size:13px;border-radius:9px;padding:11px 14px;display:none;line-height:1.5}.lms .fb.s{display:block}.lms .fb.good{background:var(--okbg);border:1px solid var(--okline);color:var(--ok)}.lms .fb.bad{background:var(--errbg);border:1px solid var(--errline);color:var(--err)}.lms .fb.ai{background:#EFEAF6;border:1px solid #D9CEE9;color:var(--ai)}.lms .fb .c{margin-top:5px;font-weight:700}
    .lms .ff{display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:14px;flex-wrap:wrap}.lms .ff .h{color:var(--muted);font-size:12.5px}
    .lms table.mt{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--surf);border:1px solid var(--line);border-radius:14px;overflow:hidden}
    .lms table.mt th{text-align:left;padding:12px 16px;background:var(--surf2);font-size:10.5px;text-transform:uppercase;color:var(--muted);font-weight:700;border-bottom:1px solid var(--line)}
    .lms table.mt td{padding:13px 16px;border-bottom:1px solid #EFE7D7}.lms .prog{display:flex;align-items:center;gap:9px;min-width:120px}.lms .pb2{flex:1;height:7px;background:#EDE4D3;border-radius:999px;overflow:hidden}.lms .pb2 i{display:block;height:100%;background:var(--terra);border-radius:999px}
    .lms .search{display:flex;align-items:center;gap:10px;background:var(--surf);border:1px solid var(--line);border-radius:13px;padding:12px 16px;margin-top:14px}.lms .search input{border:0;background:none;outline:none;font-family:inherit;font-size:15px;width:100%}
    .lms .tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.lms .tile{background:var(--surf);border:1px solid var(--line);border-radius:13px;padding:16px 18px;cursor:pointer}.lms .tile:hover{border-color:var(--orange)}.lms .tile h3{margin:0 0 3px;font-size:15px}.lms .tile p{margin:0;font-size:12px;color:var(--muted)}
    .lms .ratetab{width:100%;border-collapse:collapse;font-size:13.5px}.lms .ratetab td{padding:8px;border-bottom:1px solid var(--line)}.lms .ratetab .dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px;vertical-align:middle}
    .lms .fc{height:120px;perspective:1000px;cursor:pointer;margin-bottom:10px}.lms .fc .in{position:relative;width:100%;height:100%;transition:transform .5s;transform-style:preserve-3d}.lms .fc.f .in{transform:rotateY(180deg)}.lms .fc .fa{position:absolute;inset:0;backface-visibility:hidden;border-radius:11px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-family:'Fraunces',serif;background:var(--surf)}.lms .fc .bk{background:var(--surf2);transform:rotateY(180deg);font-size:14px}
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
        '<div style="flex:1"><div class="ttl">' + s.title + '</div></div><div>' + right + '</div></div>';
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
        checks += '<div class="q" data-c="' + c.id + '"><span class="tag">Process / decide</span><div class="pr">' + c.prompt + '</div>' + opts + '<div class="fb" id="fb' + c.id + '"></div></div>';
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
      trs += '<tr><td><b>' + r.full_name + '</b></td>' +
        '<td><div class="prog"><div class="pb2"><i style="width:' + pct + '%"></i></div><span>' + pct + '%</span></div></td>' +
        '<td><span class="chip ' + (r.competency_status === 'active' || canSign ? 'ok' : 'cur') + '">' + st + '</span></td>' +
        '<td><button class="btn ' + (canSign ? '' : 'g') + ' lmsSign" data-u="' + r.user_id + '" ' + (canSign ? '' : 'disabled') + '>' + (r.competency_status === 'active' ? 'Signed off \u2713' : 'Sign off') + '</button></td></tr>';
    });
    lms().innerHTML = seg() +
      '<div class="hero m"><div class="ey">Manager</div><h1>Logistics training \u2014 team</h1><p>Watch progress and sign people off when they\u2019re ready.</p></div>' +
      '<div class="sech"><h2>Progress</h2></div>' +
      '<table class="mt"><tr><th>Team member</th><th>Progress</th><th>Status</th><th></th></tr>' + trs + '</table>' +
      '<div class="gate" style="margin-top:18px">Signing off confirms they\u2019ve shown it on real orders \u2014 it flips <b>logistics-ready</b> on their profile with an annual recert date.</div>';
    wireSeg();
    Array.from(document.querySelectorAll('.lmsSign')).forEach(b => b.onclick = async () => {
      const out = await api('/signoff', { method: 'POST', body: JSON.stringify({ courseId: courseId, userId: parseInt(b.getAttribute('data-u'), 10) }) });
      if (out.ok) renderManager(); else alert('That person needs all sessions complete first.');
    });
  }

  // ---------- knowledge base ----------
  async function renderKB() {
    const items = await api('/kb?department=logistics');
    let tiles = '';
    items.forEach(it => { tiles += '<div class="tile lmsKb" data-i="' + it.id + '"><h3>' + it.title + '</h3><p>' + ({ rate_card: 'All couriers, sizes and prices.', flashcard: 'Drill the numbers.', error_table: 'The fix for each error.', sop: 'The full document.', article: 'Reference.', calculator_link: 'Tool.' }[it.type] || 'Reference.') + '</p></div>'; });
    lms().innerHTML =
      '<div class="hero m"><div class="ey">Learn · Knowledge Base</div><h1>Knowledge Base</h1><p>Always here, never locked. Forget a rate or a step \u2014 look it up in seconds.</p></div>' +
      '<div class="search"><input id="kbq" placeholder="Search\u2026 e.g. \u201cYodel max length\u201d"></div>' +
      '<div class="sech"><h2>Logistics</h2></div><div class="tiles" id="kbt">' + tiles + '</div>';
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
    lms().innerHTML = '<button class="back" id="bk">\u2039 Back to Knowledge Base</button><div class="lesson"><h3 style="margin-top:0">' + it.title + '</h3>' + body + '</div>';
    el('bk').onclick = renderKB;
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
      r.innerHTML = seg() + '<div class="hero"><div class="ey">Learn · My Learning</div><h1>Your training</h1><p>No course assigned yet.</p></div>' +
        '<div class="sech"><h2>Available</h2></div><div class="card"><span class="cbadge" style="background:#C2562E">LOGISTICS</span><div><div class="ttl">Courier Selection &amp; Dispatch</div><div class="sub">Start the course</div></div><div class="right"><button class="btn" id="lmsStart">Start</button></div></div>';
      wireSeg();
      if (el('lmsStart')) el('lmsStart').onclick = async () => { await api('/assign', { method: 'POST', body: JSON.stringify({}) }); boot('learn'); };
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
