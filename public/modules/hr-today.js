// FK Home — HR today module (r0.72)
// ----------------------------------------------------------------------------
// Owner/manager daily scan of HR direct reports. Flag-first: a clean day is one
// green line; a problem shows what to act on. Reads GET /api/daily/team.
// Nav is gated on attendance.view.any (owner/manager).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/today'] = {
  title: 'HR today',

  render() {
    return '' +
      '<div id="hrt-mod" class="fk-mod">' +
        '<style>' +
          '#hrt-mod .lead{font-size:14.5px;color:#5b5249;line-height:1.5;margin:0 0 16px}' +
          '#hrt-mod .pcard{margin-bottom:14px}' +
          '#hrt-mod .prow{display:flex;align-items:center;gap:12px;margin-bottom:12px}' +
          '#hrt-mod .av{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:15px;flex:none}' +
          '#hrt-mod .nm{font-size:18px;font-weight:600}' +
          '#hrt-mod .sub{font-size:13px;color:var(--muted);margin-top:2px}' +
          '#hrt-mod .chip{margin-left:auto;font-size:13px;font-weight:700;padding:4px 13px;border-radius:99px}' +
          '#hrt-mod .chip.clear{background:#EAF1EA;color:#3E7D4F}' +
          '#hrt-mod .chip.flagged{background:#F7EEDD;color:var(--amber,#B5701E)}' +
          '#hrt-mod .chip.off{background:var(--chip,#F2ECE2);color:#6a6056}' +
          '#hrt-mod .didline{font-size:14.5px;color:#3f372f;background:#EAF1EA;border:1px solid #dceadd;border-radius:11px;padding:11px 14px}' +
          '#hrt-mod .didline.flat{background:var(--chip,#F2ECE2);border-color:#e7dfd2;color:#6a6056}' +
          '#hrt-mod .flag{display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:11px;background:#F7EEDD;border-left:4px solid var(--amber,#B5701E);margin-top:9px}' +
          '#hrt-mod .flag.red{background:#F6E9E6;border-left-color:#B0453A}' +
          '#hrt-mod .flag .ft{flex:1;font-size:14.5px;color:#4a4138;line-height:1.4}' +
          '#hrt-mod .flag .ask{flex:none;font-family:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}' +
          '#hrt-mod .empty{color:var(--muted);font-size:15px;padding:20px;text-align:center}' +
          '#hrt-mod .msec{margin-top:13px;border-top:1px solid #efe7da;padding-top:12px}' +
          '#hrt-mod .mhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}' +
          '#hrt-mod .mlabel{font-size:14.5px;font-weight:600}' +
          '#hrt-mod .mcap{font-size:13px;color:var(--muted)}' +
          '#hrt-mod .mrow{display:flex;align-items:center;gap:11px;padding:12px 0;border-bottom:1px solid #efe7da}' +
          '#hrt-mod .mrow:last-child{border-bottom:none}' +
          '#hrt-mod .mnote{flex:1;font-size:14.5px;line-height:1.4;color:#3f372f}' +
          '#hrt-mod .catchip{font-size:11px;background:var(--chip,#F2ECE2);color:#6a6056;padding:2px 8px;border-radius:6px;margin-left:7px}' +
          '#hrt-mod .btn-confirm{font-family:inherit;font-size:13.5px;font-weight:600;padding:10px 17px;border-radius:10px;border:none;background:#E8722B;color:#fff;cursor:pointer}' +
          '#hrt-mod .btn-confirm:hover{background:#cf5f1e}' +
          '#hrt-mod .btn-confirm:disabled{opacity:.5;cursor:default}' +
          '#hrt-mod .btn-reject{font-family:inherit;font-size:13.5px;font-weight:600;padding:10px 17px;border-radius:10px;border:1px solid #e0d4c4;background:var(--surface,#fff);color:#8a6a56;cursor:pointer}' +
          '#hrt-mod .btn-reject:hover{background:#f6efe6}' +
          '#hrt-mod .cchip{font-size:12px;font-weight:600;padding:4px 11px;border-radius:999px;background:#E6F2E6;color:#3f7320;white-space:nowrap}' +
          '#hrt-mod .mnone{font-size:13.5px;color:var(--muted);padding:6px 0}' +
        '</style>' +
        '<p class="lead">Flags surface first. A clean day is one green line; a problem shows what to act on \u2014 tap <b>Open day</b> to read it.</p>' +
        '<div id="hrtList"><div class="empty">Loading\u2026</div></div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function initials(n){ return (n||'').split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase(); }

    try {
      const r = await fetch('/api/daily/team', { credentials:'include' });
      if (!r.ok) { $('hrtList').innerHTML = '<div class="empty">Could not load.</div>'; return; }
      const data = await r.json();
      const people = data.people || [];
      const date = data.date;
      if (!people.length) { $('hrtList').innerHTML = '<div class="empty">No HR team members to show.</div>'; return; }

      $('hrtList').innerHTML = people.map(p => {
        const u = p.user || {};
        const name = u.display_name || u.full_name || 'Unknown';
        const flags = p.flags || [];
        const off = p.off;
        let chip;
        if (off) chip = '<span class="chip off">Day off</span>';
        else if (flags.length) chip = '<span class="chip flagged">' + flags.length + ' to look at</span>';
        else chip = '<span class="chip clear">\u2713 All clear</span>';

        const didTxt = off ? 'On an approved day off.' :
          (p.did > 0 ? 'Cleared <b>' + p.did + '</b> task' + (p.did===1?'':'s') + ' today.' : 'Quiet so far today.');
        const didCls = (p.did > 0 && !off) ? 'didline' : 'didline flat';

        const flagHtml = flags.map(f => {
          const red = (f.kind === 'absence');
          return '<div class="flag' + (red?' red':'') + '"><div class="ft">' + esc(f.text) + '</div>' +
                 '<button class="ask" data-uid="' + u.id + '">Open day</button></div>';
        }).join('');

        // Manual items awaiting the owner's confirm. Pending items score nothing
        // until confirmed here; confirmed ones count (capped 5/day).
        const mp = p.manualPending || [];
        let manualHtml = '';
        if (mp.length || p.manualConfirmed) {
          const rows = mp.map(m =>
            '<div class="mrow" data-id="' + esc(m.id) + '" data-uid="' + u.id + '">' +
              '<div class="mnote">' + esc(m.note) + '<span class="catchip">' + esc(m.category || 'admin') + '</span></div>' +
              '<button class="btn-confirm" data-act="confirm">Confirm</button>' +
              '<button class="btn-reject" data-act="reject">Reject</button>' +
            '</div>').join('');
          manualHtml =
            '<div class="msec">' +
              '<div class="mhead"><span class="mlabel">Manual items to confirm</span>' +
              '<span class="mcap"><b class="capn">' + (p.manualConfirmed || 0) + '</b> of 5 confirmed today</span></div>' +
              (mp.length ? rows : '<div class="mnone">All reviewed.</div>') +
            '</div>';
        }

        return '<div class="card pcard">' +
          '<div class="prow"><span class="av" style="background:' + (u.avatar_colour || '#5E9C8C') + '">' + esc(initials(name)) + '</span>' +
          '<div><div class="nm">' + esc(name) + '</div><div class="sub">HR Executive</div></div>' + chip + '</div>' +
          '<div class="' + didCls + '">' + didTxt + '</div>' + flagHtml + manualHtml +
        '</div>';
      }).join('');

      // "Open day" → that person's growth/day (owner view via switcher)
      el.querySelectorAll('.ask').forEach(b => b.addEventListener('click', () => {
        location.hash = '#my-growth';   // My Growth has the person switcher + day drill-down
      }));

      // Confirm / reject a person's pending manual item. Confirmed items count
      // toward their week (capped 5/day); rejected items are removed.
      el.querySelectorAll('.mrow [data-act]').forEach(b => b.addEventListener('click', async () => {
        const row = b.closest('.mrow');
        const id = row.getAttribute('data-id');
        const uid = row.getAttribute('data-uid');
        const act = b.getAttribute('data-act');
        const sec = row.closest('.msec');
        row.querySelectorAll('button').forEach(x => x.disabled = true);
        try {
          const res = await fetch('/api/daily/manual-item/confirm', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: uid, date: date, id: id, action: act }),
          });
          if (!res.ok) { row.querySelectorAll('button').forEach(x => x.disabled = false); return; }
          if (act === 'confirm') {
            const note = row.querySelector('.mnote');
            row.innerHTML = '';
            row.appendChild(note);
            const c = document.createElement('span');
            c.className = 'cchip';
            c.innerHTML = '\u2713 Confirmed';
            row.appendChild(c);
            const capn = sec && sec.querySelector('.capn');
            if (capn) capn.textContent = String(Number(capn.textContent || '0') + 1);
          } else {
            row.parentNode.removeChild(row);
            if (sec && !sec.querySelector('.mrow')) {
              const list = document.createElement('div');
              list.className = 'mnone';
              list.textContent = 'All reviewed.';
              sec.appendChild(list);
            }
          }
        } catch (e) {
          row.querySelectorAll('button').forEach(x => x.disabled = false);
        }
      }));
    } catch (e) {
      $('hrtList').innerHTML = '<div class="empty">Network error.</div>';
    }
  },
};
