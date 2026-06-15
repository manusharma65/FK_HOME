// FK Home — Today module (r0.72)
// ----------------------------------------------------------------------------
// The person's daily record, in the "My Day" group. Auto-captured tasks + the
// off-system items they add, their queue, a full attendance block, and Submit.
// Reads GET /api/daily/me; writes POST /api/daily/manual-item, /api/daily/submit.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['today'] = {
  title: 'Today',

  render() {
    return '' +
      '<div id="today-mod" class="fk-mod">' +
        '<style>' +
          '#today-mod .lab{font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0 0 12px;display:flex;justify-content:space-between;align-items:center}' +
          '#today-mod .lab .r{font-weight:500;letter-spacing:0;text-transform:none;font-size:13px;color:var(--soft)}' +
          '#today-mod .trow{display:flex;align-items:center;gap:11px;padding:11px 0;border-top:1px solid var(--line)}' +
          '#today-mod .trow:first-of-type{border-top:none}' +
          '#today-mod .tt{flex:1;font-size:15px;line-height:1.4}' +
          '#today-mod .tmin{font-size:12.5px;color:var(--muted);background:var(--chip,#F2ECE2);padding:3px 9px;border-radius:99px;flex:none}' +
          '#today-mod .src{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:2px 8px;border-radius:6px;flex:none}' +
          '#today-mod .src.auto{background:#EAF1EA;color:#3E7D4F}' +
          '#today-mod .src.you{background:#E3EDF4;color:#185FA5}' +
          '#today-mod .catchip{font-size:12px;font-weight:600;color:#6a6056;background:var(--chip,#F2ECE2);padding:2px 10px;border-radius:99px;flex:none}' +
          '#today-mod .mst{font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;flex:none;margin-left:8px}' +
          '#today-mod .mst.pend{background:#FAEEDA;color:#8a5a14}' +
          '#today-mod .mst.count{background:#E6F2E6;color:#3f7320}' +
          '#today-mod .addbox{display:flex;gap:9px;margin-top:12px}' +
          '#today-mod .addbox select,#today-mod .addbox input{font-family:inherit;font-size:14.5px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}' +
          '#today-mod .addbox input{flex:1}' +
          '#today-mod .addbox button{font-family:inherit;font-size:14.5px;font-weight:700;padding:11px 18px;border:none;border-radius:10px;background:var(--orange,#E8722B);color:#fff;cursor:pointer}' +
          '#today-mod .capnote{font-size:12.5px;color:var(--soft);margin-top:10px}' +
          '#today-mod .qrow{display:flex;align-items:center;gap:11px;padding:11px 0;border-top:1px solid var(--line)}' +
          '#today-mod .qrow:first-of-type{border-top:none}' +
          '#today-mod .qdot{width:9px;height:9px;border-radius:50%;flex:none;background:#cfc6b9}' +
          '#today-mod .qdot.due{background:var(--amber,#B5701E)}' +
          '#today-mod .qt{flex:1;font-size:15px}' +
          '#today-mod .due-chip{font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:99px;flex:none;background:var(--chip,#F2ECE2);color:#6a6056}' +
          '#today-mod .due-chip.today{background:#F7EEDD;color:var(--amber,#B5701E)}' +
          '#today-mod .att-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}' +
          '#today-mod .att-tile{background:var(--canvas,#F4EFE7);border:1px solid var(--line);border-radius:13px;padding:15px 13px}' +
          '#today-mod .att-tile .v{font-size:23px;font-weight:700;line-height:1}' +
          '#today-mod .att-tile .v small{font-size:13px;font-weight:600;color:var(--muted)}' +
          '#today-mod .att-tile .l{font-size:13px;color:var(--muted);margin-top:7px}' +
          '#today-mod .att-note{font-size:14px;color:#3E7D4F;margin-top:13px}' +
          '#today-mod .submitbar{display:flex;align-items:center;gap:15px;flex-wrap:wrap}' +
          '#today-mod .submitbar .txt{flex:1;min-width:200px;font-size:14px;color:#5b5249;line-height:1.45}' +
          '#today-mod .pendpill{font-size:13px;font-weight:700;padding:5px 13px;border-radius:99px;background:#F7EEDD;color:var(--amber,#B5701E)}' +
          '#today-mod .pendpill.done{background:#EAF1EA;color:#3E7D4F}' +
          '#today-mod .btn-submit{font-family:inherit;font-weight:700;font-size:15px;padding:13px 26px;border-radius:11px;border:none;background:var(--orange,#E8722B);color:#fff;cursor:pointer}' +
          '#today-mod .btn-submit:disabled{opacity:.5;cursor:default}' +
          '#today-mod .td-notes{width:100%;box-sizing:border-box;min-height:62px;border:1px solid var(--line);border-radius:11px;padding:11px 13px;font:inherit;font-size:14.5px;line-height:1.5;resize:vertical;outline:none;margin-bottom:13px}' +
          '#today-mod .td-notes:disabled{background:#F7F2E9;color:#7a6f60}' +
          '#today-mod .td-err{font-size:13.5px;color:var(--red,#A32D2D);font-weight:600}' +
          '#today-mod .empty{color:var(--muted);font-size:14.5px;padding:6px 0}' +
          '@media(max-width:620px){#today-mod .att-grid{grid-template-columns:repeat(2,1fr)}}' +
        '</style>' +

        '<div class="card" style="margin-bottom:16px">' +
          '<p class="lab">What I did today <span class="r" id="tdManualCap"></span></p>' +
          '<div id="tdDid"><div class="empty">Loading\u2026</div></div>' +
          '<div class="addbox">' +
            '<select id="tdCat">' +
              '<option value="grievance">Grievance</option>' +
              '<option value="hiring">Candidate / hiring call</option>' +
              '<option value="payroll">Payroll query</option>' +
              '<option value="document">Document chase</option>' +
              '<option value="admin" selected>Admin / other</option>' +
            '</select>' +
            '<input id="tdNote" type="text" maxlength="500" placeholder="Add what you did off-system\u2026" />' +
            '<button id="tdAdd">Add</button>' +
          '</div>' +
          '<p class="capnote">Auto items come from your work in FK Home. You add anything done off-system \u2014 up to 5 a day count toward your score, the rest still show here.</p>' +
        '</div>' +

        '<div class="card" style="margin-bottom:16px">' +
          '<p class="lab">Still on my plate</p>' +
          '<div id="tdQueue"><div class="empty">Loading\u2026</div></div>' +
        '</div>' +

        '<div class="card" style="margin-bottom:16px">' +
          '<p class="lab">My attendance today</p>' +
          '<div class="att-grid" id="tdAtt"></div>' +
          '<div class="att-note" id="tdAttNote"></div>' +
        '</div>' +

        '<div class="card">' +
          '<textarea id="tdNotes" class="td-notes" placeholder="How did today go? A line or two about what you worked on. (Optional if you have logged items above.)" maxlength="2000"></textarea>' +
          '<div class="submitbar">' +
            '<span class="pendpill" id="tdPend">Not submitted</span>' +
            '<div class="txt">Glance over your day and submit before you sign off. It won\u2019t submit itself \u2014 if you forget, you\u2019ll get a reminder next day. On days off, nothing\u2019s expected.</div>' +
            '<span class="td-err" id="tdErr"></span>' +
            '<button class="btn-submit" id="tdSubmit">Submit my day</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function hm(ts){ if(!ts) return '\u2014'; try { return new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'}); } catch(e){ return '\u2014'; } }
    function dur(min){ min = Math.round(min||0); const h=Math.floor(min/60), m=min%60; return h>0 ? (h+'<small>h</small> '+m+'<small>m</small>') : (m+'<small>m</small>'); }

    async function load() {
      let data;
      try { const r = await fetch('/api/daily/me', { credentials:'include' }); if(!r.ok) throw 0; data = await r.json(); }
      catch(e){ $('tdDid').innerHTML = '<div class="empty">Could not load your day.</div>'; return; }
      const day = data.day || {};

      // What I did
      const did = (day.did || []).map(t =>
        '<div class="trow"><div class="tt">' + esc(t.title) + '</div><span class="src auto">auto</span>' +
        (t.completed_at ? '<span class="tmin">' + hm(t.completed_at) + '</span>' : '') + '</div>'
      );
      const manual = (day.manual || []).map(m =>
        '<div class="trow"><div class="tt">' + esc(m.note) + ' <span class="catchip">' + esc(m.category||'admin') + '</span></div><span class="src you">you</span>' +
        '<span class="mst ' + (m.counted ? 'count' : 'pend') + '">' + (m.counted ? 'counting' : 'pending') + '</span></div>'
      );
      const rows = did.concat(manual);
      $('tdDid').innerHTML = rows.length ? rows.join('') : '<div class="empty">Nothing logged yet today.</div>';
      const counted = (day.manual||[]).filter(m=>m.counted).length;
      const pendingN = (day.manual||[]).filter(m=>!m.counted).length;
      $('tdManualCap').textContent = counted + ' of 5 counting' + (pendingN ? ' \u00b7 ' + pendingN + ' pending' : '');

      // Queue
      const q = (day.queue || []).map(t => {
        const due = t.due_at ? new Date(t.due_at) : null;
        const today = new Date(); const isToday = due && due.toDateString()===today.toDateString();
        const lbl = due ? (isToday ? 'due today' : due.toLocaleDateString('en-GB',{weekday:'short'})) : '';
        return '<div class="qrow"><span class="qdot' + (isToday?' due':'') + '"></span><div class="qt">' + esc(t.title) + '</div>' +
               (lbl ? '<span class="due-chip' + (isToday?' today':'') + '">' + lbl + '</span>' : '') + '</div>';
      });
      $('tdQueue').innerHTML = q.length ? q.join('') : '<div class="empty">Nothing outstanding \u2014 all clear.</div>';

      // Attendance
      const a = day.attendance || {};
      $('tdAtt').innerHTML =
        '<div class="att-tile"><div class="v">' + hm(a.first_login) + '</div><div class="l">Clocked in</div></div>' +
        '<div class="att-tile"><div class="v">' + hm(a.last_logout) + '</div><div class="l">Clocked out</div></div>' +
        '<div class="att-tile"><div class="v">' + dur(a.active_minutes) + '</div><div class="l">Active</div></div>' +
        '<div class="att-tile"><div class="v">' + dur(a.idle_minutes) + '</div><div class="l">Idle</div></div>' +
        '<div class="att-tile"><div class="v">' + dur(a.break_taken_minutes) + '</div><div class="l">Breaks</div></div>';
      let note = '';
      if (day.off) note = 'Day off \u2014 nothing expected today.';
      else if (a.status === 'on_time') note = 'On time.';
      else if (a.status === 'late' || a.status === 'very_late') note = 'Logged in late.';
      else if (a.first_login) note = 'Logged in.';
      $('tdAttNote').textContent = note;

      // Submit state
      const pend = $('tdPend'), btn = $('tdSubmit'); const notesEl = $('tdNotes');
      if (notesEl && day.notes != null && !notesEl.value) notesEl.value = day.notes;
      if (day.submitted) { pend.textContent = 'Submitted'; pend.classList.add('done'); btn.disabled = true; btn.textContent = 'Submitted'; if (notesEl) notesEl.disabled = true; }
      else if (day.off) { pend.textContent = 'Day off'; pend.classList.add('done'); btn.disabled = true; if (notesEl) notesEl.disabled = true; }
      else { pend.textContent = 'Not submitted'; pend.classList.remove('done'); btn.disabled = false; btn.textContent = 'Submit my day'; if (notesEl) notesEl.disabled = false; }
    }

    $('tdAdd').addEventListener('click', async () => {
      const note = $('tdNote').value.trim(); if (!note) return;
      $('tdAdd').disabled = true;
      try { await fetch('/api/daily/manual-item', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ category: $('tdCat').value, note }) }); $('tdNote').value=''; await load(); }
      catch(e){} finally { $('tdAdd').disabled = false; }
    });
    $('tdSubmit').addEventListener('click', async () => {
      const errEl = $('tdErr'); if (errEl) errEl.textContent = '';
      $('tdSubmit').disabled = true;
      try {
        const notes = $('tdNotes') ? $('tdNotes').value.trim() : '';
        const r = await fetch('/api/daily/submit', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ notes }) });
        if (!r.ok) { const d = await r.json().catch(()=>({})); if (errEl) errEl.textContent = d.error || 'Could not submit.'; $('tdSubmit').disabled = false; return; }
        await load();
      }
      catch(e){ $('tdSubmit').disabled = false; }
    });

    await load();
  },
};
