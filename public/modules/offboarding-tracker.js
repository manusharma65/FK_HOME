// FK Home — Offboarding exit tracker (shared component, r0.40)
// ----------------------------------------------------------------------------
// One source of truth for the HR/manager exit tracker. Exposes:
//   window.fkExitTracker.render(container, userId, onChange)
// It fetches its own data (overview + offboarding drawer), renders the slate
// tracker (or the self-heal "generate" state), and wires every action to the
// existing /api/profile/:userId/offboarding/* endpoints. After any change it
// re-loads and calls onChange() so a parent list can refresh.
//
// Lives here (not on the employee profile) because offboarding is an HR-run,
// multi-owner clearance process — HR Insights is its home.
// ----------------------------------------------------------------------------

window.fkExitTracker = (function () {
  const STYLE_ID = 'fk-exit-styles';
  const CSS = '.fk-exit .drawer-tab .count{margin-left:auto;background:var(--line);color:var(--muted);font-size:11px;padding:1px 6px;border-radius:99px;min-width:20px;text-align:center}.fk-exit .drawer-tab.on .count{background:var(--amber);color:white}.fk-exit .det-btn{padding:10px 16px;border-radius:8px;border:0.5px solid var(--line);background:var(--surface);font-size:14px;cursor:pointer;color:var(--ink);font-weight:500}.fk-exit .det-btn.primary{background:var(--amber);color:#fff;border-color:var(--amber)}.fk-exit .det-btn:hover{filter:brightness(0.97)}.fk-exit .sectab .count{margin-left:2px;background:var(--amber-soft);color:var(--amber-deep);font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px}.fk-exit .edit-link{margin-left:auto;padding:9px 18px;border-radius:9px;border:0.5px solid var(--line);background:var(--surface);color:var(--ink);font-size:15px;font-weight:500;cursor:pointer}.fk-exit .det-btn{padding:12px 22px;border-radius:9px;border:0.5px solid var(--line);background:var(--surface);font-size:16px;font-weight:500;cursor:pointer;color:var(--ink)}.fk-exit .ob-pbar{height:10px;border-radius:99px;background:rgba(20,22,27,0.10);overflow:hidden}.fk-exit .ob-pbar>i{display:block;height:100%;background:var(--amber);border-radius:99px}.fk-exit .ob-grp-head{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:600;padding:16px 0 6px}.fk-exit .ob-grp-head .n{width:26px;height:26px;border-radius:7px;background:var(--amber-soft);color:var(--amber-deep);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}.fk-exit .ob-item{display:flex;align-items:flex-start;gap:14px;padding:16px 0;border-top:0.5px solid var(--line)}.fk-exit .ob-item:first-of-type{border-top:none}.fk-exit .ob-ico{width:30px;height:30px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:16px;margin-top:1px}.fk-exit .ob-ico.todo{border:2px solid var(--line);color:var(--muted)}.fk-exit .ob-ico.sub{background:var(--amber-soft);color:var(--amber-deep)}.fk-exit .ob-ico.ver{background:var(--green);color:#fff}.fk-exit .ob-ico.redo{background:var(--red-soft);color:var(--red)}.fk-exit .ob-ico.na{background:rgba(20,22,27,0.06);color:var(--muted)}.fk-exit .ob-mid{flex:1;min-width:0}.fk-exit .ob-title{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.fk-exit .ob-why{font-size:14px;color:var(--muted);margin-top:3px;line-height:1.45}.fk-exit .ob-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none}.fk-exit .ob-chip{font-size:12px;font-weight:600;padding:4px 11px;border-radius:99px;white-space:nowrap}.fk-exit .ob-chip.todo{background:rgba(20,22,27,0.06);color:var(--muted)}.fk-exit .ob-chip.sub{background:var(--amber-soft);color:var(--amber-deep)}.fk-exit .ob-chip.ver{background:var(--green-soft);color:var(--green)}.fk-exit .ob-chip.redo{background:var(--red-soft);color:var(--red)}.fk-exit .ob-chip.na{background:rgba(20,22,27,0.06);color:var(--muted)}.fk-exit .ob-btn{padding:9px 16px;border-radius:9px;font-size:14px;font-weight:500;cursor:pointer;border:0.5px solid var(--line);background:var(--surface);color:var(--ink);white-space:nowrap}.fk-exit .ob-btn.primary{background:var(--amber);color:#fff;border-color:var(--amber)}.fk-exit .ob-btn.ghost{border:none;background:none;color:var(--muted);padding:6px 4px;font-size:13px}.fk-exit .ob-filechip{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink);background:var(--bg);border:0.5px solid var(--line);border-radius:7px;padding:5px 9px;margin-top:8px;text-decoration:none}.fk-exit .ob-filechip i{font-size:15px;color:var(--muted)}.fk-exit .welcome-banner .deco{position:absolute;right:-30px;top:-30px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.12)}.fk-exit .welcome-banner .deco2{position:absolute;right:60px;bottom:-50px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.10)}.fk-exit .setup{background:var(--surface);border:0.5px solid var(--line);border-radius:14px;padding:20px 24px;margin-bottom:14px}.fk-exit .setup-top{display:flex;align-items:center;gap:12px;margin-bottom:14px}.fk-exit .setup-top .ic{width:40px;height:40px;border-radius:11px;background:var(--amber-soft);color:var(--amber-deep);display:flex;align-items:center;justify-content:center;font-size:22px;flex:none}.fk-exit .setup-top h3{margin:0;font-size:18px;font-weight:600}.fk-exit .setup-top .sub{font-size:14px;color:var(--muted);margin-top:2px}.fk-exit .setup-top .count{margin-left:auto;font-size:14px;color:var(--muted);font-weight:500;white-space:nowrap}.fk-exit .setup-toggle{margin-left:14px;width:34px;height:34px;border-radius:9px;border:0.5px solid var(--line);background:var(--surface);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}.fk-exit .setup-toggle:hover{color:var(--ink);background:var(--bg)}.fk-exit .setup-toggle i{font-size:18px}.fk-exit .setup .ob-pbar{margin-bottom:6px}.fk-exit .setup .ob-grp-head{border-top:0.5px solid var(--line);margin-top:8px;padding-top:14px}.fk-exit .setup .ob-grp-head.first{border-top:none;margin-top:4px;padding-top:8px}.fk-exit .setup-done{display:flex;align-items:center;gap:12px;background:var(--green-soft);border:0.5px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:14px}.fk-exit .setup-done i{font-size:22px;color:var(--green)}.fk-exit .setup-done .txt{font-weight:600;color:var(--green)}.fk-exit .setup-done .vd{margin-left:auto;font-size:14px;color:var(--green);font-weight:600;cursor:pointer}.fk-exit .exit-head{position:relative;border-radius:16px;padding:22px 24px;margin-bottom:14px;color:#fff;overflow:hidden;background:linear-gradient(120deg,#3A4250,#5A6473)}.fk-exit .exit-head .deco{position:absolute;right:-30px;top:-40px;width:170px;height:170px;border-radius:50%;background:rgba(255,255,255,0.07)}.fk-exit .exit-head h2{margin:0;font-size:21px;font-weight:700;position:relative;display:flex;align-items:center;gap:9px}.fk-exit .exit-head .emeta{position:relative;display:flex;gap:18px;flex-wrap:wrap;font-size:14px;opacity:.95;margin-top:8px}.fk-exit .exit-head .emeta b{font-weight:600}.fk-exit .fnf-badge{position:relative;display:inline-flex;align-items:center;gap:7px;margin-top:14px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:99px;padding:6px 13px;font-size:13px;font-weight:500}.fk-exit .setup-top .ic.slate{background:var(--slate-soft,#EEF1F5);color:var(--slate,#475569)}.fk-exit .own{font-size:11px;font-weight:700;letter-spacing:.3px;padding:2px 7px;border-radius:5px}.fk-exit .own.it{background:rgba(40,90,180,0.10);color:#2D5BAF}.fk-exit .own.finance{background:var(--amber-soft);color:var(--amber-deep)}.fk-exit .own.manager{background:#EEF1F5;color:#475569}.fk-exit .own.hr{background:var(--green-soft);color:var(--green)}.fk-exit .own.leaver{background:rgba(20,22,27,0.06);color:var(--muted)}.fk-exit .fnf-card{background:var(--bg);border:0.5px solid var(--line);border-radius:10px;padding:12px 16px;margin:4px 0 12px}.fk-exit .fnf-line{display:flex;justify-content:space-between;font-size:14px;padding:7px 0;border-bottom:0.5px solid var(--line)}.fk-exit .fnf-line:last-child{border-bottom:none}.fk-exit .fnf-line .v{font-weight:600}.fk-exit .flag{font-size:12px;padding:2px 8px;border-radius:5px;font-weight:600;background:var(--amber-soft);color:var(--amber-deep)}.fk-exit .flag.ok{background:var(--green-soft);color:var(--green)}.fk-exit .lv-head .deco{position:absolute;right:-30px;top:-30px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.10)}';

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function fmtDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB');
  }
  function tenureText(hireIso) {
    if (!hireIso) return '\u2014';
    const h = new Date(hireIso);
    if (isNaN(h.getTime())) return '\u2014';
    const now = new Date();
    let months = (now.getFullYear() - h.getFullYear()) * 12 + (now.getMonth() - h.getMonth());
    if (now.getDate() < h.getDate()) months--;
    if (months < 0) months = 0;
    const y = Math.floor(months / 12), mo = months % 12;
    if (y <= 0) return mo + ' mo';
    return y + 'y' + (mo ? ' ' + mo + 'mo' : '');
  }
  function exitGratuity(hireIso, lastIso) {
    if (!hireIso) return { eligible: false, text: 'Tenure unknown' };
    const h = new Date(hireIso); const l = lastIso ? new Date(lastIso) : new Date();
    if (isNaN(h.getTime())) return { eligible: false, text: 'Tenure unknown' };
    const years = (l.getTime() - h.getTime()) / (365.25 * 86400000);
    return years >= 5
      ? { eligible: true, text: 'Eligible (5+ years)' }
      : { eligible: false, text: 'Not yet \u2014 needs 5 years' };
  }
  function ownerChipHtml(owner) {
    const map = { it: 'IT', finance: 'FINANCE', manager: 'MANAGER', hr: 'HR', leaver: 'YOU' };
    if (!owner) return '';
    return '<span class="own ' + owner + '">' + (map[owner] || owner.toUpperCase()) + '</span>';
  }

  async function api(path, opts) {
    return fetch('/api/profile/' + path, Object.assign({ credentials: 'include' }, opts || {}));
  }

  function render(container, userId, onChange) {
    injectCss();
    if (!container) return;
    onChange = onChange || function () {};

    async function load() {
      container.innerHTML = '<div class="fk-exit"><div style="padding:24px;text-align:center;color:var(--muted)">Loading exit\u2026</div></div>';
      try {
        const [ovR, drR] = await Promise.all([
          api(userId + '/overview'),
          api(userId + '/drawer/offboarding'),
        ]);
        if (!ovR.ok) { container.innerHTML = '<div class="fk-exit"><div style="padding:24px;color:var(--red)">Could not load this person.</div></div>'; return; }
        const overview = await ovR.json();
        const data = drR.ok ? await drR.json() : { notes: [] };
        draw(overview.user, data);
      } catch (e) {
        container.innerHTML = '<div class="fk-exit"><div style="padding:24px;color:var(--red)">Could not load the exit tracker.</div></div>';
      }
    }

    async function doAction(id, action) {
      try {
        const r = await api(userId + '/offboarding/' + id + '/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        await load(); onChange();
      } catch (e) { alert('Failed'); }
    }
    async function regenerate() {
      try {
        const r = await api(userId + '/offboarding/regenerate', { method: 'POST' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        await load(); onChange();
      } catch (e) { alert('Failed'); }
    }
    async function cancel(isLeft, name) {
      const msg = isLeft
        ? 'Reinstate ' + name + ' to active and remove the exit record?'
        : 'Cancel this offboarding and keep ' + name + '? The exit checklist will be removed.';
      if (!confirm(msg)) return;
      try {
        const r = await api(userId + '/offboarding/cancel', { method: 'POST' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        onChange(true); // signal the exit is gone — parent should return to the list
      } catch (e) { alert('Failed'); }
    }
    async function addNote(id, txt) {
      try {
        const r = await api(userId + '/notes/' + id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: txt }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        await load();
      } catch (e) { alert('Failed'); }
    }
    async function uploadFile(id, autoDone) {
      const inp = document.getElementById('exFile_' + id);
      if (!inp || !inp.files || !inp.files.length) return;
      const f = inp.files[0];
      if (f.size > 15 * 1024 * 1024) { alert('File too large (max 15 MB).'); inp.value = ''; return; }
      const fd = new FormData();
      fd.append('file', f); fd.append('user_id', String(userId));
      fd.append('drawer', 'offboarding'); fd.append('profile_note_id', String(id));
      try {
        const r = await fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Upload failed'); return; }
        if (autoDone) await doAction(id, 'done'); else await load();
      } catch (e) { alert('Upload failed'); }
    }

    function draw(u, data) {
      const notes = (data.notes || []).slice().sort((a, b) => ((a.ob_sort || 9999) - (b.ob_sort || 9999)) || (a.id - b.id));
      const isDone = (n) => n.ob_status === 'verified' || n.is_completed;
      const filesOf = (n) => (n.attached_files && n.attached_files.length) ? n.attached_files : [];
      const exitBodies = {};
      const total = notes.length;
      const done = notes.filter(isDone).length;
      const pct = total ? Math.round(done * 100 / total) : 0;
      const dept = (u.departments && u.departments.length) ? u.departments.map(d => d.name).join(', ') : '';
      const left = u.employment_status === 'left';
      const name = u.display_name || u.full_name || 'this person';

      let html = '<div class="fk-exit">';
      html += '<div class="exit-head"><div class="deco"></div>' +
        '<h2><i class="ti ti-door-exit"></i> Offboarding \u2014 ' + esc(name) + '</h2>' +
        '<div class="emeta">' +
          (u.emp_id ? '<span>' + esc(u.emp_id) + (dept ? ' \u00b7 ' + esc(dept) : '') + '</span>' : (dept ? '<span>' + esc(dept) + '</span>' : '')) +
          (u.notice_date ? '<span>Notice given <b>' + esc(fmtDate(u.notice_date)) + '</b></span>' : '') +
          '<span>Last working day <b>' + esc(fmtDate(u.last_working_day)) + '</b></span>' +
          '<span>Tenure <b>' + tenureText(u.hire_date) + '</b></span>' +
        '</div>' +
        (left ? '<div class="fnf-badge"><i class="ti ti-check"></i> Employee has left</div>'
              : '<div class="fnf-badge"><i class="ti ti-alert-triangle"></i> Full &amp; Final due within <b>2 working days</b> of the last day</div>') +
        '</div>';

      if (total === 0) {
        html += '<div class="setup"><div style="text-align:center;padding:22px 16px">' +
          '<div style="font-size:16px;font-weight:600;margin-bottom:6px">No exit checklist yet</div>' +
          '<div style="font-size:14px;color:var(--muted);max-width:420px;margin:0 auto 16px">This offboarding has no items. Generate the standard exit checklist to continue.</div>' +
          '<button class="det-btn primary" id="exGen"><i class="ti ti-rotate-clockwise"></i> Generate exit checklist</button>' +
          '<div style="margin-top:14px"><button class="edit-link" id="exCancel0" style="color:var(--red)">Cancel offboarding instead</button></div>' +
          '</div></div></div>';
        container.innerHTML = html;
        const g = document.getElementById('exGen'); if (g) g.addEventListener('click', regenerate);
        const c0 = document.getElementById('exCancel0'); if (c0) c0.addEventListener('click', () => cancel(left, name));
        return;
      }

      html += '<div class="setup"><div class="setup-top"><div class="ic slate"><i class="ti ti-clipboard-list"></i></div>' +
        '<div><h3>Exit clearances</h3><div class="sub">Run these in parallel so Full &amp; Final lands inside the 2-day window.</div></div>' +
        '<div class="count">' + done + ' of ' + total + ' done \u00b7 ' + pct + '%</div></div>' +
        '<div class="ob-pbar"><i style="width:' + pct + '%"></i></div>';

      const groups = []; const byGroup = {};
      for (const n of notes) { const g = n.ob_group || 'Other'; if (!byGroup[g]) { byGroup[g] = []; groups.push(g); } byGroup[g].push(n); }

      groups.forEach((g, gi) => {
        html += '<div class="ob-grp-head' + (gi === 0 ? ' first' : '') + '"><span class="n">' + (gi + 1) + '</span> ' + esc(g) + '</div>';
        if (g === 'Full & Final settlement') {
          const grat = exitGratuity(u.hire_date, u.last_working_day);
          const lb = data.leave_balance;
          const encash = (lb && lb.remaining != null)
            ? (Number(lb.remaining) % 1 ? Number(lb.remaining).toFixed(1) : Number(lb.remaining)) + ' days'
            : 'see Leaves';
          html += '<div class="fnf-card">' +
            '<div class="fnf-line"><span>Tenure</span><span class="v">' + tenureText(u.hire_date) + '</span></div>' +
            '<div class="fnf-line"><span>Gratuity eligibility</span><span class="v"><span class="flag' + (grat.eligible ? ' ok' : '') + '">' + grat.text + '</span></span></div>' +
            '<div class="fnf-line"><span>Leave balance to encash</span><span class="v">' + encash + '</span></div>' +
          '</div>';
        }
        for (const n of byGroup[g]) {
          const done2 = isDone(n);
          const isDoc = g === 'Documents to issue';
          const isFnf = g === 'Full & Final settlement';
          const isLeftBtn = n.ob_sort === 120 || /mark as left/i.test(n.title);
          const ico = done2 ? '<div class="ob-ico ver"><i class="ti ti-check"></i></div>' : '<div class="ob-ico todo"></div>';
          const chip = done2 ? '<span class="ob-chip ver">Done</span>' : '<span class="ob-chip todo">To do</span>';
          let actions = '';
          if (done2) {
            actions = '<button class="ob-btn" data-ex-act="reopen" data-id="' + n.id + '">Reopen</button>';
          } else if (isLeftBtn) {
            actions = '<button class="ob-btn primary" data-ex-act="mark_left" data-id="' + n.id + '">Mark left</button>';
          } else if (isDoc) {
            actions = '<button class="ob-btn primary" data-ex-upload="' + n.id + '" data-auto="1">Upload</button>';
          } else if (isFnf) {
            actions = '<button class="ob-btn" data-ex-upload="' + n.id + '" data-auto="0">Upload doc</button>' +
                      '<button class="ob-btn primary" data-ex-act="done" data-id="' + n.id + '">Mark done</button>';
          } else {
            actions = '<button class="ob-btn primary" data-ex-act="done" data-id="' + n.id + '">Mark done</button>';
          }
          const fs = filesOf(n);
          if (/exit interview/i.test(n.title)) {
            exitBodies[n.id] = n.body || '';
            const hasNotes = n.body && !/internal to hr/i.test(n.body);
            actions += '<button class="ob-btn" data-ex-note="' + n.id + '">' + (hasNotes ? 'Edit notes' : 'Add notes') + '</button>';
          }
          const fileChips = fs.length ? '<div>' + fs.map(f => '<a class="ob-filechip" href="/api/files/' + f.id + '" target="_blank"><i class="ti ti-file-text"></i> ' + esc(f.filename) + '</a>').join(' ') + '</div>' : '';
          html += '<div class="ob-item">' + ico +
            '<div class="ob-mid"><div class="ob-title">' + esc(n.title) + ' ' + ownerChipHtml(n.ob_owner) +
              (n.ob_leaver ? ' <span class="own leaver" title="Visible to the leaver">SHARED</span>' : '') + '</div>' +
              (n.body ? '<div class="ob-why">' + esc(n.body) + '</div>' : '') + fileChips +
              '<input type="file" id="exFile_' + n.id + '" data-ex-file="' + n.id + '" style="display:none" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx">' +
            '</div>' +
            '<div class="ob-right">' + chip + actions + '</div></div>';
        }
      });

      html += '</div>'; // .setup
      html += '<div style="margin-top:14px;display:flex;justify-content:center">' +
        '<button class="det-btn" id="exCancel" style="color:var(--red);border-color:var(--red-soft)">' +
        '<i class="ti ti-arrow-back-up"></i> ' + (left ? 'Reinstate employee (cancel exit)' : 'Cancel offboarding \u2014 they\u2019re staying') +
        '</button></div>';
      html += '</div>'; // .fk-exit
      container.innerHTML = html;

      const exC = document.getElementById('exCancel');
      if (exC) exC.addEventListener('click', () => cancel(left, name));
      container.querySelectorAll('[data-ex-act]').forEach(el => el.addEventListener('click', () => {
        const act = el.dataset.exAct, id = el.dataset.id;
        if (act === 'mark_left' && !confirm('Mark this employee as left? This revokes their place on the team and cancels open tasks.')) return;
        doAction(id, act);
      }));
      container.querySelectorAll('[data-ex-upload]').forEach(el => el.addEventListener('click', () => {
        const inp = document.getElementById('exFile_' + el.dataset.exUpload); if (inp) { inp.dataset.auto = el.dataset.auto; inp.click(); }
      }));
      container.querySelectorAll('[data-ex-file]').forEach(el => el.addEventListener('change', () => uploadFile(el.dataset.exFile, el.dataset.auto === '1')));
      container.querySelectorAll('[data-ex-note]').forEach(el => el.addEventListener('click', () => {
        const id = el.dataset.exNote;
        const cur = /internal to hr/i.test(exitBodies[id] || '') ? '' : (exitBodies[id] || '');
        const txt = prompt('Exit interview notes (internal — not shown to the leaver):', cur);
        if (txt === null) return;
        addNote(id, txt);
      }));
    }

    load();
  }

  return { render };
})();
