// FK Home — My Growth module (r0.30, Ship 3 / Option B)
// ----------------------------------------------------------------------------
// The development / performance page. NOT where you file leave or read raw
// records — that's "Leaves & time". My Growth is the judgement layer:
//   - Conduct this period (counts read from attendance: late / unauthorised /
//     idle flags / leaves taken) — display only, feeds the future scorecard.
//   - My reviews (from the profile reviews drawer).
//   - Performance & scoring placeholder (arrives when scoring migrates).
// Person switcher kept: managers/HR review someone else's conduct here.
//   /api/auth/me, /api/team/search, /api/attendance/me/week,
//   /api/leaves/mine, /api/profile/<id>/drawer/reviews
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['my-growth'] = {
  title: 'My Growth',

  render() {
    return '' +
      '<div id="mg-mod" class="fk-mod">' +
        '<style>' +
          '#mg-mod .switcher{display:none;margin-bottom:14px}' +
          '#mg-mod .switcher.on{display:block}' +
          '#mg-mod .switcher select{padding:8px 11px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;background:var(--surface)}' +
          '#mg-mod .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:22px}' +
          '#mg-mod .stat{background:var(--surface);border:0.5px solid var(--line);border-radius:10px;padding:13px 15px}' +
          '#mg-mod .stat .v{font-size:24px;font-weight:600;line-height:1.1}' +
          '#mg-mod .stat .l{font-size:13.5px;color:var(--muted);margin-top:4px}' +
          '#mg-mod .sec-lbl{font-size:13.5px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:0 0 8px}' +
          '#mg-mod .conduct{background:var(--surface);border:0.5px solid var(--line);border-radius:10px;padding:15px;margin-bottom:6px}' +
          '#mg-mod .conduct-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:14px}' +
          '#mg-mod .conduct-grid .c .v{font-size:26px;font-weight:600;line-height:1}' +
          '#mg-mod .conduct-grid .c .l{font-size:14.5px;color:var(--muted);margin-top:3px}' +
          '#mg-mod .conduct-note{font-size:13.5px;color:var(--soft);margin-bottom:24px}' +
          '#mg-mod .conduct-note a{color:var(--blue,#185FA5);text-decoration:none;cursor:pointer}' +
          '#mg-mod .panel{background:var(--surface);border:0.5px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:24px}' +
          '#mg-mod .row{display:flex;justify-content:space-between;align-items:center;padding:12px 15px;border-bottom:0.5px solid var(--line)}' +
          '#mg-mod .row:last-child{border-bottom:none}' +
          '#mg-mod .row .t1{font-size:14px}' +
          '#mg-mod .row .t2{font-size:13.5px;color:var(--muted);margin-top:2px}' +
          '#mg-mod .pill{display:inline-flex;font-size:13.5px;font-weight:500;padding:4px 11px;border-radius:99px;background:#F1EFE8;color:var(--muted)}' +
          '#mg-mod .pill.green{background:#EAF3DE;color:#3B6D11}' +
          '#mg-mod .pill.amber{background:#FAEEDA;color:#9A5B1F}' +
          '#mg-mod .pill.blue{background:#E5EEF8;color:#185FA5}' +
          '#mg-mod .scoring{background:var(--bg2,#F4F2EC);border:1px dashed var(--line);border-radius:10px;padding:20px;text-align:center}' +
          '#mg-mod .scoring .t{font-size:14px;font-weight:500;margin-top:6px}' +
          '#mg-mod .scoring .s{font-size:14.5px;color:var(--muted);margin-top:3px;max-width:460px;margin-left:auto;margin-right:auto}' +
          '#mg-mod .empty{text-align:center;color:var(--muted);padding:18px;font-size:14px}' +
        '</style>' +

        '<div class="card-head" style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">' +
          '<div><h2 style="margin:0 0 2px" id="mgTitle">My Growth</h2><span class="lt-sub" style="font-size:14.5px;color:var(--muted)" id="mgSub">How you\u2019re doing, and how you\u2019re developing.</span></div>' +
          '<div class="switcher" id="mgSwitcher"><select id="mgUserSelect"></select></div>' +
        '</div>' +

        // Top stats
        '<div class="stat-grid">' +
          '<div class="stat"><div class="v" id="mgScore">\u2014</div><div class="l">This month\u2019s score</div></div>' +
          '<div class="stat"><div class="v" id="mgReviewsDone">\u2014</div><div class="l">Reviews done</div></div>' +
          '<div class="stat"><div class="v" id="mgNextReview">\u2014</div><div class="l">Next review</div></div>' +
        '</div>' +

        // ---- Performance score (filled from /api/daily/score) ----
        '<style>' +
          '#mg-mod .ladder{display:flex;gap:6px;margin-bottom:14px}' +
          '#mg-mod .lstep{flex:1;text-align:center;padding:12px 4px;border-radius:10px;background:var(--canvas,#F4EFE7);border:1px solid var(--line)}' +
          '#mg-mod .lstep .ln{font-size:13px;font-weight:700;color:var(--soft)}' +
          '#mg-mod .lstep .lp{font-size:12px;color:var(--soft);margin-top:3px}' +
          '#mg-mod .lstep.on{background:var(--amber,#B5701E);border-color:var(--amber,#B5701E)}' +
          '#mg-mod .lstep.on .ln{color:#fff} #mg-mod .lstep.on .lp{color:#fff;opacity:.9}' +
          '#mg-mod .lstep.dim{opacity:.5}' +
          '#mg-mod .levmsg{font-size:15px;color:#3f372f;line-height:1.5}' +
          '#mg-mod .corr{font-size:30px;font-weight:700;line-height:1}' +
          '#mg-mod .br{margin-bottom:12px} #mg-mod .br .top{display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px}' +
          '#mg-mod .bar{height:10px;border-radius:99px;background:#EFE8DB;overflow:hidden}' +
          '#mg-mod .bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#4E8A5E,#3E7D4F)}' +
          '#mg-mod .spark{display:flex;align-items:flex-end;gap:10px;height:120px}' +
          '#mg-mod .scol{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;justify-content:flex-end;height:100%}' +
          '#mg-mod .scol .bx{width:100%;max-width:36px;border-radius:7px 7px 4px 4px;background:linear-gradient(180deg,#E8722B,#F3992E)}' +
          '#mg-mod .scol .wl{font-size:12px;color:var(--soft)} #mg-mod .scol .sv{font-size:12px;font-weight:700;color:#6a6056}' +
        '</style>' +
        '<p class="sec-lbl">Your level</p>' +
        '<div class="conduct" id="mgLevel"><span class="l">Loading\u2026</span></div>' +
        '<div style="height:6px"></div>' +
        '<p class="sec-lbl">This week</p>' +
        '<div class="conduct" id="mgWeek"><span class="l">Loading\u2026</span></div>' +
        '<div style="height:6px"></div>' +
        '<p class="sec-lbl">Last 8 weeks</p>' +
        '<div class="conduct" id="mgTrend"><span class="l">Loading\u2026</span></div>' +
        '<div style="height:18px"></div>' +

        // Conduct this period
        '<p class="sec-lbl">Conduct \u00b7 this period</p>' +
        '<div class="conduct"><div class="conduct-grid" id="mgConduct"><span class="l">Loading\u2026</span></div></div>' +
        '<div class="conduct-note">Counts what the system already recorded. Think a late mark or absence is wrong? ' +
          '<a id="mgFixLink">Request a correction in Leaves &amp; time \u2192</a></div>' +

        // My reviews
        '<p class="sec-lbl">My reviews</p>' +
        '<div class="panel" id="mgReviews"><div class="empty">Loading\u2026</div></div>' +

        // Attendance record (conduct ledger standing)
        '<p class="sec-lbl">Attendance record</p>' +
        '<div class="conduct" id="mgStanding"><span class="l">Loading\u2026</span></div>' +

      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function dOnly(v){ if(!v) return '\u2014'; var s=String(v); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[3]+'/'+m[2]+'/'+m[1]; var d=new Date(s); return isNaN(d.getTime())?s:d.toLocaleDateString('en-GB'); }

    let me_ = null, viewingUserId = null, viewingName = null;

    $('mgFixLink').addEventListener('click', () => { location.hash = '#leaves-time'; });

    async function init() {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        if (!r.ok) return;
        me_ = await r.json();
      } catch (e) { return; }
      viewingUserId = me_.id;
      viewingName = me_.display_name || me_.full_name;
      updateTitle();
      const perms = me_.permissions || [];
      if (perms.includes('attendance.view.any') || perms.includes('attendance.view.dept')) await loadSwitcher();
      reloadAll();
    }

    function updateTitle() {
      const isSelf = viewingUserId === me_.id;
      $('mgTitle').textContent = isSelf ? 'My Growth' : viewingName + "\u2019s growth";
      $('mgSub').textContent = isSelf ? 'How you\u2019re doing, and how you\u2019re developing.' : 'Viewing as ' + (me_.display_name || me_.full_name) + '.';
      // The "request a correction" note only makes sense for your own page.
      $('mgFixLink').parentElement.style.display = isSelf ? '' : 'none';
    }

    async function loadSwitcher() {
      try {
        const r = await fetch('/api/team/search', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        let users = data.people || [];
        const perms = me_.permissions || [];
        if (!perms.includes('attendance.view.any') && perms.includes('attendance.view.dept')) {
          const myDeptSlugs = new Set((me_.departments || []).map(d => d.slug));
          users = users.filter(u => (u.departments || []).some(d => myDeptSlugs.has(d.slug)));
        }
        const sel = $('mgUserSelect');
        const meOpt = '<option value="' + me_.id + '" selected>' + esc(me_.display_name || me_.full_name) + ' (you)</option>';
        const otherOpts = users.map(u => '<option value="' + u.id + '">' + esc(u.name) + '</option>').join('');
        sel.innerHTML = meOpt + otherOpts;
        if (users.length > 0 || perms.includes('attendance.view.any')) $('mgSwitcher').classList.add('on');
      } catch (e) {}
    }

    el.addEventListener('change', (e) => {
      if (e.target.id !== 'mgUserSelect') return;
      const sel = e.target;
      viewingUserId = parseInt(sel.value, 10);
      viewingName = sel.options[sel.selectedIndex].textContent.replace(' (you)', '');
      updateTitle();
      reloadAll();
    });

    function reloadAll() { loadConduct(); loadReviews(); loadScore(); }

    const MG_BANDS = ['Poor','Average','Good','Excellent','Above Expectations'];
    async function loadScore() {
      const lvl=$('mgLevel'), wk=$('mgWeek'), tr=$('mgTrend'), st=$('mgStanding');
      let data;
      try { const r = await fetch('/api/daily/score?user_id=' + viewingUserId, { credentials:'include' }); if(!r.ok) throw 0; data = await r.json(); }
      catch(e){ if(lvl) lvl.innerHTML = '<span class="l">Could not load score.</span>'; return; }
      const cur = data.current, raise = data.raiseBands || {}, W = data.weights || {};
      $('mgScore').textContent = cur ? cur.band : '\u2014';
      if (cur) $('mgScore').style.fontSize = '20px';
      if (!cur) {
        lvl.innerHTML = '<span class="l">No weekly score yet \u2014 your first one appears next Monday.</span>';
      } else {
        const steps = MG_BANDS.map(b => {
          const on = (b === cur.band);
          return '<div class="lstep ' + (on?'on':'dim') + '"><div class="ln">' + b.replace('Above Expectations','Above') + '</div><div class="lp">' + (raise[b]||'') + '</div></div>';
        }).join('');
        lvl.innerHTML = '<div class="ladder">' + steps + '</div><div class="levmsg">You\u2019re at <b>' + esc(cur.band) + '</b>. At review this maps to a raise of <b>' + esc(raise[cur.band]||'') + '</b>.</div>';
      }
      if (!cur) { wk.innerHTML = '<span class="l">\u2014</span>'; }
      else {
        const bar = (label, pts, max) => { const p = max ? Math.max(0, Math.min(100, (Number(pts)/max)*100)) : 0; return '<div class="br"><div class="top"><span>' + label + '</span><span>' + (pts==null?'\u2014':Number(pts).toFixed(1)) + ' / ' + max + '</span></div><div class="bar"><i style="width:' + p + '%"></i></div></div>'; };
        wk.innerHTML =
          '<div style="margin-bottom:12px"><span class="corr">' + (cur.correctness_pct==null?'\u2014':Number(cur.correctness_pct).toFixed(1)+'%') + '</span> <span class="l">correct this week</span></div>' +
          bar('SLA / timeliness', cur.sla_pts, W.sla) +
          bar('Hiring / pipeline', cur.hiring_pts, W.hiring) +
          bar('Accuracy / compliance', cur.accuracy_pts, W.accuracy) +
          bar('Conduct / attendance', cur.conduct_pts, W.conduct) +
          bar('Quality', cur.quality_pts, W.quality) +
          (cur.band_capped ? '<div class="l" style="color:#B5701E;margin-top:8px">Capped at Good \u2014 an item was left undone this week.</div>' : '');
      }
      const t = data.trend || [];
      if (!t.length) { tr.innerHTML = '<span class="l">No history yet.</span>'; }
      else {
        tr.innerHTML = '<div class="spark">' + t.map((w,i) => { const h = Math.max(8, Math.min(100, Number(w.total)||0)); const lab = (w.band||'').split(' ')[0]; return '<div class="scol"><div class="sv">' + lab + '</div><div class="bx" style="height:' + h + '%"></div><div class="wl">' + (i+1) + '</div></div>'; }).join('') + '</div>';
      }
      const s = data.standing || { points:0 };
      let msg;
      if (s.reached) msg = '<b>' + Number(s.points).toFixed(1) + '</b> points \u2014 reached: ' + esc(s.reached.step) + '.';
      else if (s.nextStep) msg = '<b>' + Number(s.points).toFixed(1) + '</b> / ' + s.nextStep.at + ' points \u2014 next step is ' + esc(s.nextStep.step) + ' at ' + s.nextStep.at + '.';
      else msg = '<b>' + Number(s.points).toFixed(1) + '</b> points.';
      st.innerHTML = '<div class="levmsg">' + msg + '</div><div class="l" style="margin-top:6px">Late marks, absences and over-breaks accumulate here and roll off after 12 months.</div>';
    }

    async function loadConduct() {
      const grid = $('mgConduct');
      try {
        const params = new URLSearchParams({ days: '30' });
        if (viewingUserId !== me_.id) params.set('user_id', viewingUserId);
        const [attRes, lvRes] = await Promise.all([
          fetch('/api/attendance/me/week?' + params.toString(), { credentials: 'include' }),
          fetch((viewingUserId !== me_.id) ? ('/api/leaves/mine?user_id=' + viewingUserId) : '/api/leaves/mine', { credentials: 'include' })
        ]);
        let late = 0, noShow = 0, onTime = 0;
        if (attRes.ok) {
          const data = await attRes.json();
          for (const d of (data.days || [])) {
            if (d.status === 'late' || d.status === 'very_late' || (d.late_minutes > 0)) late++;
            else if (d.status === 'not_yet_in') noShow++;
            else if (d.status === 'on_time' || d.status === 'worked_voluntary') onTime++;
          }
        }
        let leavesTaken = 0;
        if (lvRes.ok) { const ld = await lvRes.json(); const b = ld.balance || {}; leavesTaken = Number(b.used || 0); }
        grid.innerHTML =
          '<div class="c"><div class="v" style="color:#3B6D11">' + onTime + '</div><div class="l">on time</div></div>' +
          '<div class="c"><div class="v" style="color:#9A5B1F">' + late + '</div><div class="l">days late</div></div>' +
          '<div class="c"><div class="v" style="color:#A32D2D">' + noShow + '</div><div class="l">unauthorised</div></div>' +
          '<div class="c"><div class="v" style="color:#185FA5">' + (Number.isInteger(leavesTaken) ? leavesTaken : leavesTaken.toFixed(1)) + '</div><div class="l">leaves taken</div></div>';
      } catch (e) { grid.innerHTML = '<span class="l">Could not load conduct.</span>'; }
    }

    async function loadReviews() {
      const panel = $('mgReviews');
      try {
        const r = await fetch('/api/profile/' + viewingUserId + '/drawer/reviews', { credentials: 'include' });
        if (!r.ok) { panel.innerHTML = '<div class="empty">Cannot load reviews.</div>'; $('mgReviewsDone').textContent = '0'; return; }
        const data = await r.json();
        const reviews = data.reviews || data.items || data.rows || [];
        const done = reviews.filter(rv => rv.status === 'done' || rv.completed_at || rv.outcome).length;
        $('mgReviewsDone').textContent = String(done);
        // next review: first with a future due / not done
        const next = reviews.find(rv => !(rv.status === 'done' || rv.completed_at));
        $('mgNextReview').textContent = next ? (next.review_type || next.type || 'Scheduled') : 'None due';
        $('mgNextReview').style.fontSize = '16px';
        if (reviews.length === 0) { panel.innerHTML = '<div class="empty">No reviews yet.</div>'; return; }
        function rvPill(rv){
          if (rv.outcome === 'pass' || rv.status === 'passed') return '<span class="pill green">Passed</span>';
          if (rv.status === 'done' || rv.completed_at) return '<span class="pill green">Done</span>';
          return '<span class="pill blue">Scheduled</span>';
        }
        panel.innerHTML = reviews.map(rv =>
          '<div class="row"><div><div class="t1">' + esc(rv.review_type || rv.type || rv.title || 'Review') + '</div>' +
          '<div class="t2">' + dOnly(rv.review_date || rv.due_at || rv.created_at) + (rv.reviewer_name ? ' \u00b7 by ' + esc(rv.reviewer_name) : '') + '</div></div>' +
          rvPill(rv) + '</div>'
        ).join('');
      } catch (e) { panel.innerHTML = '<div class="empty">Network error.</div>'; }
    }

    await init();
  }
};
