// FK Home — My Work module (r0.22, Ship 2a)
// ----------------------------------------------------------------------------
// The single full task view. Shows the current user's active tasks grouped into
// Needs action / Recurring today / In progress, with a "+ Add" ad-hoc creator
// and per-task actions (start / complete / log movement).
//   GET  /api/tasks/mine          -> { groups:{needs_action,recurring,in_progress}, total }
//   POST /api/tasks               -> create ad-hoc
//   POST /api/tasks/:id/action    -> start | complete | move | reopen
// Recruitment openings are deliberately excluded server-side (they live in the
// Recruitment view); only their movement surfaces here.
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
          '#mw-mod .mw-group-label{font-size:12px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px}' +
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
          '#mw-mod .mw-act{font-size:12px;color:var(--muted);border:0.5px solid var(--line);background:var(--surface);border-radius:6px;padding:5px 10px;cursor:pointer;flex:none}' +
          '#mw-mod .mw-act:hover{background:var(--hover,#F1EFE8);color:var(--ink)}' +
          '#mw-mod .mw-empty{text-align:center;color:var(--muted);padding:30px;font-size:14px}' +
          '#mw-mod .mw-note{font-size:12px;color:var(--soft);margin-top:14px;padding-top:12px;border-top:0.5px solid var(--line)}' +
          '#mw-mod .mw-form{background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:14px;margin-bottom:14px;display:none}' +
          '#mw-mod .mw-form.on{display:block}' +
          '#mw-mod .mw-form input,#mw-mod .mw-form select{width:100%;padding:8px 11px;border:0.5px solid var(--line);border-radius:8px;font-size:14px;background:var(--bg,#fff);margin-bottom:8px}' +
          '#mw-mod .mw-form .frow{display:flex;gap:8px}' +
          '#mw-mod .mw-form button{padding:8px 14px;border-radius:8px;border:0.5px solid var(--line);background:var(--surface);cursor:pointer;font-size:14px}' +
          '#mw-mod .mw-form .save{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}' +
        '</style>' +

        '<div class="card">' +
          '<div class="mw-head">' +
            '<div><h2 style="margin:0">My Work</h2><span class="mw-sub" id="mwSub">\u2014</span></div>' +
            '<button class="mw-add" id="mwAddBtn"><i class="ti ti-plus" style="font-size:16px"></i> Add task</button>' +
          '</div>' +

          '<div class="mw-form" id="mwForm">' +
            '<input type="text" id="mwTitle" placeholder="What did you do / need to do? (e.g. Screened 3 PPC candidates)" />' +
            '<div class="frow">' +
              '<select id="mwCategory">' +
                '<option value="">General</option>' +
                '<option value="recruitment">Recruitment</option>' +
                '<option value="grievance">Grievance / ER</option>' +
                '<option value="documentation">Documentation</option>' +
                '<option value="meeting">Meeting</option>' +
                '<option value="other">Other</option>' +
              '</select>' +
              '<button class="save" id="mwSave">Add</button>' +
              '<button id="mwCancel">Cancel</button>' +
            '</div>' +
          '</div>' +

          '<div id="mwBody"><div class="mw-empty">Loading\u2026</div></div>' +

          '<div class="mw-note">Recruitment openings live in the Recruitment view \u2014 only movement on them shows here.</div>' +
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

    function rowHtml(t) {
      const kind = t.kind || 'ad_hoc';
      const pill = PILL[kind] || ['adhoc', kind];
      const isOverdue = t.status === 'overdue';
      const icon = ICON[kind] || 'ti-clipboard-text';
      const colour = ICON_COLOUR[kind] || 'var(--muted)';
      const who = t.related_display_name || t.related_full_name;
      let sub = t.body ? esc(t.body) : '';
      if (t.movement_note) sub = esc(t.movement_note);
      if (!sub && who) sub = esc(who);
      // Action button depends on state
      let act;
      if (t.status === 'in_progress') {
        act = '<button class="mw-act" data-act="complete" data-id="' + t.id + '">Done</button>';
      } else {
        act = '<button class="mw-act" data-act="start" data-id="' + t.id + '">Start</button>';
      }
      const pillHtml = isOverdue
        ? '<span class="pill overdue">overdue</span>'
        : '<span class="pill ' + pill[0] + '">' + pill[1] + '</span>';
      return '<div class="mw-row">' +
        '<i class="ti ' + icon + ' ico" style="color:' + colour + '"></i>' +
        '<div class="mid"><div class="t1">' + esc(t.title) + '</div>' +
          (sub ? '<div class="t2">' + sub + '</div>' : '') + '</div>' +
        pillHtml + act +
      '</div>';
    }

    const GROUP_LABELS = [
      ['needs_action', 'Needs action'],
      ['recurring', 'Recurring today'],
      ['in_progress', 'In progress'],
    ];

    async function load() {
      try {
        const r = await fetch('/api/tasks/mine', { credentials: 'include' });
        if (!r.ok) { $('mwBody').innerHTML = '<div class="mw-empty">Could not load your tasks.</div>'; return; }
        const data = await r.json();
        const groups = data.groups || { needs_action: [], recurring: [], in_progress: [] };
        const total = data.total || 0;
        const toAction = (groups.needs_action || []).length;
        const inProg = (groups.in_progress || []).length;
        $('mwSub').textContent = toAction + ' to action \u00b7 ' + inProg + ' in progress';

        if (total === 0) {
          $('mwBody').innerHTML = '<div class="mw-empty">Nothing on your plate right now. Use \u201cAdd task\u201d to log work you\u2019ve done.</div>';
          return;
        }
        let html = '';
        for (const [key, label] of GROUP_LABELS) {
          const rows = groups[key] || [];
          if (rows.length === 0) continue;
          html += '<div class="mw-group-label">' + label + '</div>';
          html += rows.map(rowHtml).join('');
        }
        $('mwBody').innerHTML = html;
      } catch (e) {
        console.error('[my-work load]', e);
        $('mwBody').innerHTML = '<div class="mw-empty">Network error.</div>';
      }
    }

    // Add-task form toggle
    $('mwAddBtn').addEventListener('click', () => { $('mwForm').classList.add('on'); $('mwTitle').focus(); });
    $('mwCancel').addEventListener('click', () => { $('mwForm').classList.remove('on'); $('mwTitle').value = ''; });

    $('mwSave').addEventListener('click', async () => {
      const title = $('mwTitle').value.trim();
      if (!title) { $('mwTitle').focus(); return; }
      const category = $('mwCategory').value || null;
      $('mwSave').disabled = true; $('mwSave').textContent = 'Adding\u2026';
      try {
        const r = await fetch('/api/tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ title, category })
        });
        if (!r.ok) { alert('Could not add task'); }
        else { $('mwTitle').value = ''; $('mwForm').classList.remove('on'); await load(); }
      } catch (e) { alert('Network error'); }
      $('mwSave').disabled = false; $('mwSave').textContent = 'Add';
    });

    // Task actions (event delegation)
    $('mwBody').addEventListener('click', async (e) => {
      const btn = e.target.closest('.mw-act');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');
      btn.disabled = true;
      try {
        const r = await fetch('/api/tasks/' + id + '/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ action: act })
        });
        if (!r.ok) { alert('Action failed'); btn.disabled = false; return; }
        await load();
      } catch (e2) { alert('Network error'); btn.disabled = false; }
    });

    await load();
  }
};
