// FK Home — Reports module (r0.19, Ship C)
// ----------------------------------------------------------------------------
// Migrates admin.html#reports into the shell. Daily-report review queue.
//   GET  /api/admin/reports/pending
//   POST /api/admin/reports/:id/review   { decision, comment }
// decision ∈ satisfactory | good | not_satisfactory (last needs a comment).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/reports'] = {
  title: 'Reports',

  render() {
    return '' +
      '<div id="rep-mod" class="fk-mod">' +
        '<style>' +
          '#rep-mod .report-card{border-top:0.5px solid var(--line);padding:16px 0}' +
          '#rep-mod .report-card:first-of-type{border-top:none;padding-top:4px}' +
          '#rep-mod .snap{background:#FBFAF7;border:0.5px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13.5px;color:var(--muted);margin-bottom:8px}' +
          '#rep-mod .pill{padding:3px 10px;border-radius:99px;font-size:13.5px;font-weight:500}' +
          '#rep-mod .modal-err{display:none;color:var(--red);font-size:14px;margin:6px 0}' +
          '#rep-mod .modal-err.on{display:block}' +
        '</style>' +

        '<div class="card" id="ciExCard" style="display:none">' +
          '<div class="card-head"><div><h2 style="margin:0">Clock-ins to approve</h2>' +
            '<span class="meta" id="ciExMeta">—</span></div></div>' +
          '<div id="ciExList" style="padding:2px 0 4px"></div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Daily reports</h2>' +
              '<span class="meta">Last 30 days. Flag as not satisfactory to notify agent + HR.</span>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center">' +
              '<span class="meta" id="repMeta">—</span>' +
              '<select id="repPerson"><option value="">Everyone</option></select>' +
              '<select id="repFilter">' +
                '<option value="unreviewed">Unreviewed</option>' +
                '<option value="not_satisfactory">Not satisfactory</option>' +
                '<option value="all">All reports</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div id="repList"><div style="padding:22px;text-align:center;color:var(--muted)">Loading…</div></div>' +
        '</div>' +

        '<div class="modal-bg" id="repReviewModal">' +
          '<div class="modal">' +
            '<h2 id="repReviewTitle">Flag report</h2>' +
            '<p class="modal-sub">The agent and HR will both be notified. Be specific.</p>' +
            '<div class="modal-err" id="repReviewErr"></div>' +
            '<form id="repReviewForm">' +
              '<input type="hidden" id="repReviewId" />' +
              '<label>What\'s the issue?</label>' +
              '<textarea id="repReviewComment" rows="4" placeholder="e.g. Missed two stand-ups, no detail on actual work." style="width:100%;font-family:inherit;font-size:14px;padding:8px;border:0.5px solid var(--line);border-radius:6px;resize:vertical"></textarea>' +
              '<div class="modal-actions">' +
                '<button type="button" class="btn" id="repReviewCancel">Cancel</button>' +
                '<button type="submit" class="btn btn-danger">Flag as Not satisfactory</button>' +
              '</div>' +
            '</form>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    let reports_ = [];

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtMins(m) {
      if (m == null || isNaN(m)) return '—';
      m = Math.floor(m);
      if (m < 60) return m + 'm';
      return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    }
    function fmtDate(d) {
      if (!d) return '—';
      try { return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
      catch (e) { return String(d).slice(0, 10); }
    }

    async function load() {
      const wrap = $('repList');
      wrap.innerHTML = '<div style="padding:22px;text-align:center;color:var(--muted)">Loading…</div>';
      const personId = $('repPerson').value;
      // When a specific person is picked, ask the server for their full history
      // (wider window) via ?user_id=. "Everyone" keeps the default 30-day queue.
      const url = personId
        ? '/api/admin/reports/pending?user_id=' + encodeURIComponent(personId) + '&days=365'
        : '/api/admin/reports/pending';
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) { wrap.innerHTML = '<div style="padding:22px;text-align:center;color:var(--red)">Failed to load.</div>'; return; }
        const data = await r.json();
        reports_ = data.reports || [];
        populatePeople();
        renderReports();
      } catch (e) {
        wrap.innerHTML = '<div style="padding:22px;text-align:center;color:var(--red)">Network error.</div>';
      }
    }

    // Build the person dropdown from whoever appears in the loaded reports,
    // preserving the current selection. (Everyone-view shows all people seen in
    // the last 30 days; that's the set a manager can review.)
    let peopleSeen_ = {};
    function populatePeople() {
      for (const r of reports_) {
        if (r.user_id && !peopleSeen_[r.user_id]) peopleSeen_[r.user_id] = r.display_name || r.full_name;
      }
      const sel = $('repPerson');
      const current = sel.value;
      const opts = Object.entries(peopleSeen_).sort((a, b) => a[1].localeCompare(b[1]));
      sel.innerHTML = '<option value="">Everyone</option>' +
        opts.map(([id, name]) => '<option value="' + id + '">' + escapeHtml(name) + '</option>').join('');
      sel.value = current;
    }

    function renderReports() {
      const filter = $('repFilter').value;
      const wrap = $('repList');
      let rows = reports_;
      if (filter === 'unreviewed') rows = rows.filter(r => !r.decision);
      else if (filter === 'not_satisfactory') rows = rows.filter(r => r.decision === 'not_satisfactory');
      $('repMeta').textContent = rows.length + (rows.length === 1 ? ' report' : ' reports') + (reports_.length !== rows.length ? ' of ' + reports_.length : '');
      if (rows.length === 0) {
        wrap.innerHTML = '<div style="padding:28px;text-align:center;color:var(--muted);font-size:14px">No reports match this filter.</div>';
        return;
      }
      wrap.innerHTML = rows.map(reportCard).join('');
    }

    function reportCard(r) {
      const decisionColours = {
        not_satisfactory: { bg: '#FCEBEB', fg: '#A32D2D', label: 'Not satisfactory' },
        satisfactory: { bg: '#F1EFE8', fg: '#5F5E5A', label: 'Satisfactory' },
        good: { bg: '#EAF3DE', fg: '#3B6D11', label: 'Good' }
      };
      const dec = r.decision ? decisionColours[r.decision] : null;
      const snap = 'In <b>' + (r.snapshot_first_login ? String(r.snapshot_first_login).slice(0, 5) : '—') + '</b>' +
        ' · Out <b>' + (r.snapshot_last_logout ? String(r.snapshot_last_logout).slice(0, 5) : '—') + '</b>' +
        ' · Active <b>' + fmtMins(r.snapshot_active_min) + '</b>' +
        ' · Idle <b>' + fmtMins(r.snapshot_idle_min) + '</b>' +
        ' · Break <b>' + fmtMins(r.snapshot_break_min) + '</b>';
      const notes = r.notes ? escapeHtml(r.notes)
        : ((r.auto_submitted || !r.submitted_at)
            ? '<span style="color:var(--red,#A32D2D);font-style:italic">No report submitted \u2014 auto-filled at midnight</span>'
            : '<span style="color:var(--soft);font-style:italic">(no written note)</span>');
      return '<div class="report-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:12px;flex-wrap:wrap">' +
          '<div>' +
            '<div style="font-size:15px;font-weight:500;color:var(--ink)">' + escapeHtml(r.full_name) + ' <span style="color:var(--muted);font-weight:400">· ' + escapeHtml(r.dept_name || '—') + '</span></div>' +
            '<div style="font-size:14.5px;color:var(--muted);margin-top:2px">' + fmtDate(r.for_date) + '</div>' +
          '</div>' +
          (dec
            ? '<div style="display:flex;align-items:center;gap:8px"><span class="pill" style="background:' + dec.bg + ';color:' + dec.fg + '">' + dec.label + '</span>' + (r.reviewer_name ? '<span style="font-size:13.5px;color:var(--muted)">by ' + escapeHtml(r.reviewer_name) + '</span>' : '') + '</div>'
            : '<span class="pill" style="background:#FAEEDA;color:#854F0B">Awaiting review</span>') +
        '</div>' +
        '<div class="snap">' + snap + '</div>' +
        '<div style="font-size:14px;line-height:1.5;color:var(--ink);white-space:pre-wrap;margin-bottom:10px">' + notes + '</div>' +
        (r.decision === 'not_satisfactory' && r.comment
          ? '<div style="background:#FCEBEB;border-left:3px solid #A32D2D;padding:8px 12px;font-size:14.5px;color:#7A1F1F;margin-bottom:10px;border-radius:0 6px 6px 0"><b>Reviewer note:</b> ' + escapeHtml(r.comment) + '</div>'
          : '') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-danger" style="flex:none;font-size:14px;padding:10px 18px" data-flag="' + r.id + '" data-name="' + escapeHtml(r.full_name) + '">Not satisfactory</button>' +
          '<button class="btn" style="flex:none;font-size:14px;padding:10px 18px" data-review="' + r.id + '" data-decision="satisfactory">Satisfactory</button>' +
          '<button class="btn btn-primary" style="flex:none;font-size:14px;padding:10px 18px" data-review="' + r.id + '" data-decision="good">Good</button>' +
        '</div>' +
      '</div>';
    }

    async function submitReview(reportId, decision, comment) {
      try {
        const r = await fetch('/api/admin/reports/' + reportId + '/review', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ decision, comment })
        });
        const data = await r.json();
        if (!r.ok) { alert(data.error || 'Failed'); return false; }
        const rep = reports_.find(x => x.id === reportId);
        if (rep) { rep.decision = decision; rep.comment = comment; rep.reviewer_name = 'You'; rep.reviewed_at = new Date().toISOString(); }
        renderReports();
        return true;
      } catch (e) { alert('Network error'); return false; }
    }

    function openFlag(id, name) {
      $('repReviewId').value = id;
      $('repReviewTitle').textContent = 'Flag report: ' + name;
      $('repReviewComment').value = '';
      $('repReviewErr').classList.remove('on');
      $('repReviewModal').classList.add('on');
    }

    $('repFilter').addEventListener('change', renderReports);
    $('repPerson').addEventListener('change', load);
    $('repReviewCancel').addEventListener('click', () => $('repReviewModal').classList.remove('on'));
    $('repReviewForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = parseInt($('repReviewId').value, 10);
      const comment = $('repReviewComment').value.trim();
      const err = $('repReviewErr');
      err.classList.remove('on');
      if (comment.length < 3) { err.textContent = 'Add a short comment so the agent understands.'; err.classList.add('on'); return; }
      const ok = await submitReview(id, 'not_satisfactory', comment);
      if (ok) $('repReviewModal').classList.remove('on');
    });
    $('repList').addEventListener('click', (e) => {
      const flag = e.target.closest('[data-flag]');
      if (flag) { openFlag(parseInt(flag.getAttribute('data-flag'), 10), flag.getAttribute('data-name')); return; }
      const rev = e.target.closest('[data-review]');
      if (rev) { submitReview(parseInt(rev.getAttribute('data-review'), 10), rev.getAttribute('data-decision'), null); }
    });

    const ciTime = (t) => { try { return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    function ciRowHtml(r) {
      const remote = r.arrival_place === 'remote';
      const noPhoto = !r.selfie_id;
      const thumb = r.selfie_id
        ? '<img src="/api/attendance/selfie/' + r.selfie_id + '" alt="" style="width:44px;height:44px;border-radius:9px;object-fit:cover;border:1px solid var(--line)"/>'
        : '<div style="width:44px;height:44px;border-radius:9px;background:#ece3d6;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:#b4471f"><i class="ti ti-camera-off"></i></div>';
      const chip = remote
        ? '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--amber-soft);color:var(--amber-deep)">working from home</span>'
        : '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:#eef0f2;color:#5c6570">office</span>';
      const flagNote = noPhoto ? ' · <span style="color:#b4471f">no photo</span>' : '';
      return '<div class="ci-ex-row" style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line)">' +
        thumb +
        '<div style="flex:1;min-width:0"><div style="font-family:var(--disp);font-size:15px;font-weight:600;color:var(--ink)">' + escapeHtml(r.display_name || r.full_name) + '</div>' +
        '<div style="font-size:12.5px;color:var(--muted);margin-top:2px">' + ciTime(r.first_login) + ' ' + chip + flagNote + '</div></div>' +
        '<div style="display:flex;gap:8px"><button class="btn btn-primary" data-decide="approve" data-uid="' + r.user_id + '" style="font-size:13px;padding:8px 13px">Approve</button>' +
        '<button class="btn" data-decide="flag" data-uid="' + r.user_id + '" style="font-size:13px;padding:8px 13px">Flag</button></div>' +
      '</div>';
    }
    async function loadClockinExceptions() {
      try {
        const r = await fetch('/api/attendance/exceptions/today', { credentials: 'include' });
        if (!r.ok) { $('ciExCard').style.display = 'none'; return; }
        const d = await r.json();
        const rows = d.rows || [];
        if (!rows.length) { $('ciExCard').style.display = 'none'; return; }
        $('ciExCard').style.display = '';
        $('ciExMeta').textContent = rows.length + ' to review';
        $('ciExList').innerHTML = rows.map(ciRowHtml).join('');
        $('ciExList').querySelectorAll('[data-decide]').forEach(b => b.addEventListener('click', async () => {
          const uid = b.getAttribute('data-uid'), action = b.getAttribute('data-decide');
          const row = b.closest('.ci-ex-row'); if (row) row.style.opacity = '.5';
          try {
            await fetch('/api/attendance/exceptions/' + uid + '/decide', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action }),
            });
          } catch (e) {}
          loadClockinExceptions();
        }));
      } catch (e) { $('ciExCard').style.display = 'none'; }
    }

    loadClockinExceptions();
    await load();
  }
};
