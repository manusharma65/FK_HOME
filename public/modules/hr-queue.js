// FK Home — HR Queue module (r0.25)
// ----------------------------------------------------------------------------
// The shared HR queue. Both Tanu & Deepanshi see every auto-routed HR task,
// tagged with whose it is. You action your own; you can COVER a colleague's
// when they're off. Tasks are routed by hr_area (daily_ops / recruitment_judgement).
//   GET  /api/tasks/hr-queue   -> { tasks, me }
//   POST /api/tasks/:id/cover  -> take over a colleague's task
//   POST /api/tasks/:id/action -> start | complete
// Buttons are full-size and labelled in plain English (no tiny icon controls).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr-queue'] = {
  title: 'HR Queue',
  noHero: true,

  render() {
    return '' +
      '<div id="hrq-mod" class="fk-mod">' +
        '<style>' +
          '#hrq-mod{font-family:"Hanken Grotesk",-apple-system,sans-serif}' +
          '#hrq-mod .hrq-hero{position:relative;overflow:hidden;border-radius:22px;padding:24px 28px;color:#fff;margin:6px 0 18px;background:linear-gradient(115deg,#2A2421 0%,#3a2e25 48%,#7a3d18 100%)}' +
          '#hrq-mod .hrq-hero:after{content:"";position:absolute;right:-60px;top:-90px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle at 30% 30%,rgba(243,153,46,.5),rgba(243,153,46,0) 70%)}' +
          '#hrq-mod .hrq-hero h1{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:30px;margin:0;position:relative}' +
          '#hrq-mod .hrq-hero .hrq-sub{margin:7px 0 0;color:#E8DDD2;font-size:14px;position:relative}' +
          '#hrq-mod .hrq-help{font-size:13.5px;line-height:1.5;color:#5b524a;background:#FBF0DC;border:1px solid #F0E2CE;border-radius:14px;padding:14px 16px;margin:0 0 20px}' +
          '#hrq-mod .hrq-glabel{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin:22px 0 12px}' +
          '#hrq-mod .hrq-card{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:18px 20px;margin-bottom:14px;box-shadow:0 2px 10px rgba(36,31,27,.04);transition:transform .14s,box-shadow .14s}' +
          '#hrq-mod .hrq-card:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(36,31,27,.08)}' +
          '#hrq-mod .hrq-card.overdue{border-color:#F09595}' +
          '#hrq-mod .hrq-top{display:flex;align-items:flex-start;gap:13px}' +
          '#hrq-mod .hrq-ico{font-size:22px;flex:none;margin-top:2px}' +
          '#hrq-mod .hrq-mid{flex:1;min-width:0}' +
          '#hrq-mod .hrq-title{font-family:"Fraunces",Georgia,serif;font-size:18px;font-weight:600}' +
          '#hrq-mod .hrq-body{font-size:13.5px;color:var(--muted);margin-top:3px}' +
          '#hrq-mod .hrq-owner{font-size:11.5px;font-weight:600;padding:5px 12px;border-radius:99px;flex:none;white-space:nowrap}' +
          '#hrq-mod .hrq-actions{display:flex;gap:10px;margin-top:16px;justify-content:flex-end;flex-wrap:wrap}' +
          '#hrq-mod .hrq-btn{padding:10px 22px;font-size:14px;font-weight:600;border-radius:11px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;text-align:center;font-family:inherit;transition:transform .12s,box-shadow .12s,background .12s}' +
          '#hrq-mod .hrq-btn:hover{transform:translateY(-1px)}' +
          '#hrq-mod .hrq-btn.primary{background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;border:0;box-shadow:0 4px 12px rgba(232,114,43,.25)}' +
          '#hrq-mod .hrq-btn.cover{background:var(--surface);border-color:var(--line);color:#5b524a}' +
          '#hrq-mod .pill.overdue{background:#FCEBEB;color:#A32D2D}' +
          '#hrq-mod .pill.due{background:#FAEEDA;color:#854F0B}' +
          '#hrq-mod .pill.mine{background:#E1F5EE;color:#0F6E56}' +
          '#hrq-mod .pill.theirs{background:#F2ECE2;color:#5b524a}' +
          '#hrq-mod .hrq-empty{text-align:center;color:var(--muted);padding:40px;font-size:15px;background:var(--surface);border:1px solid var(--line);border-radius:18px}' +
        '</style>' +

        '<div class="hrq-hero"><h1>HR Queue</h1><div class="hrq-sub" id="hrqSub">\u2014</div></div>' +
        '<div class="hrq-help">Work that\u2019s landed for the HR team. Each item shows whose it is. ' +
          'Do your own with the buttons; if a colleague is off, use <strong>Cover</strong> to take theirs \u2014 ' +
          'whoever completes it is recorded as having done it.</div>' +

        '<div id="hrqBody"><div class="hrq-empty">Loading\u2026</div></div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    const ICON = { leave:'ti-calendar-plus', regularisation:'ti-clock-edit', sick:'ti-bed',
                   probation:'ti-gavel', recruitment:'ti-user-search', review:'ti-star', payroll:'ti-cash' };
    const ICON_COLOUR = { leave:'#0F6E56', regularisation:'#993C1D', sick:'#854F0B',
                          probation:'#A32D2D', recruitment:'#185FA5', review:'#534AB7', payroll:'#0F6E56' };

    let myId = null;

    function cardHtml(t) {
      const cat = t.category || 'other';
      const icon = ICON[cat] || 'ti-clipboard-text';
      const colour = ICON_COLOUR[cat] || 'var(--muted)';
      const mine = t.assignee_user_id === myId;
      const meta = t.meta || {};
      const isJudgement = meta.judgement;
      const ctxUrl = meta.context_url;
      const overdue = t.status === 'overdue';

      // owner pill
      const ownerPill = mine
        ? '<span class="hrq-owner pill mine">Yours</span>'
        : '<span class="hrq-owner pill theirs">' + esc(t.assignee_name || t.assignee_full_name || 'HR') + '</span>';

      // status pill (overdue/due) shown in addition when relevant
      let statusPill = '';
      if (overdue) statusPill = '<span class="hrq-owner pill overdue" style="margin-right:6px">Overdue</span>';
      else if (t.status === 'due') statusPill = '<span class="hrq-owner pill due" style="margin-right:6px">Due</span>';

      // actions — full-size, plain-English
      let actions = '';
      // the context / open button (judgement tasks emphasise opening the evidence)
      if (ctxUrl) {
        const label = isJudgement ? 'Open & decide' : 'Open';
        actions += '<button class="hrq-btn primary" data-open="' + esc(ctxUrl) + '">' + label + '</button>';
      }
      if (mine) {
        if (t.status === 'in_progress') {
          actions += '<button class="hrq-btn" data-act="complete" data-id="' + t.id + '">Mark done</button>';
        } else {
          actions += '<button class="hrq-btn" data-act="start" data-id="' + t.id + '">Start</button>';
        }
      } else {
        actions += '<button class="hrq-btn cover" data-cover="' + t.id + '" title="Take this over while your colleague is away">Cover for ' + esc((t.assignee_name||'them').split(' ')[0]) + '</button>';
      }

      const subject = t.related_name || t.related_full_name;
      return '<div class="hrq-card' + (overdue ? ' overdue' : '') + '">' +
        '<div class="hrq-top">' +
          '<i class="ti ' + icon + ' hrq-ico" style="color:' + colour + '"></i>' +
          '<div class="hrq-mid">' +
            '<div class="hrq-title">' + esc(t.title) + '</div>' +
            (t.body ? '<div class="hrq-body">' + esc(t.body) + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center">' + statusPill + ownerPill + '</div>' +
        '</div>' +
        '<div class="hrq-actions">' + actions + '</div>' +
      '</div>';
    }

    async function load() {
      try {
        const r = await fetch('/api/tasks/hr-queue', { credentials:'include' });
        if (r.status === 403) { $('hrqBody').innerHTML = '<div class="hrq-empty">This queue is for the HR team.</div>'; $('hrqSub').textContent=''; return; }
        if (!r.ok) { $('hrqBody').innerHTML = '<div class="hrq-empty">Could not load the HR queue.</div>'; return; }
        const data = await r.json();
        myId = data.me;
        const tasks = data.tasks || [];
        const mineCount = tasks.filter(t => t.assignee_user_id === myId).length;
        const overdueCount = tasks.filter(t => t.status === 'overdue').length;
        $('hrqSub').textContent = tasks.length + ' open \u00b7 ' + mineCount + ' yours' + (overdueCount ? ' \u00b7 ' + overdueCount + ' overdue' : '');

        if (tasks.length === 0) {
          $('hrqBody').innerHTML = '<div class="hrq-empty">All clear \u2014 nothing waiting for the HR team right now.</div>';
          return;
        }
        // group: yours first, then the rest
        const mine = tasks.filter(t => t.assignee_user_id === myId);
        const others = tasks.filter(t => t.assignee_user_id !== myId);
        let html = '';
        if (mine.length) html += '<div class="hrq-glabel">Yours to do</div>' + mine.map(cardHtml).join('');
        if (others.length) html += '<div class="hrq-glabel">Your colleague\u2019s (cover if they\u2019re off)</div>' + others.map(cardHtml).join('');
        $('hrqBody').innerHTML = html;
      } catch (e) {
        console.error('[hr-queue load]', e);
        $('hrqBody').innerHTML = '<div class="hrq-empty">Network error.</div>';
      }
    }

    $('hrqBody').addEventListener('click', async (e) => {
      const openBtn = e.target.closest('[data-open]');
      const actBtn = e.target.closest('[data-act]');
      const coverBtn = e.target.closest('[data-cover]');
      if (openBtn) {
        location.hash = openBtn.getAttribute('data-open');
        return;
      }
      if (actBtn) {
        const id = actBtn.getAttribute('data-id'); const act = actBtn.getAttribute('data-act');
        actBtn.disabled = true;
        try {
          const r = await fetch('/api/tasks/' + id + '/action', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ action: act }) });
          if (!r.ok) { alert('Action failed'); actBtn.disabled = false; return; }
          await load();
        } catch (e2) { alert('Network error'); actBtn.disabled = false; }
        return;
      }
      if (coverBtn) {
        const id = coverBtn.getAttribute('data-cover');
        if (!confirm('Take this task over? It becomes yours and is recorded as done by you.')) return;
        coverBtn.disabled = true;
        try {
          const r = await fetch('/api/tasks/' + id + '/cover', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include' });
          if (!r.ok) { alert('Could not cover'); coverBtn.disabled = false; return; }
          await load();
        } catch (e2) { alert('Network error'); coverBtn.disabled = false; }
      }
    });

    await load();
  }
};
