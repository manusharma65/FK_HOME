// FK Home — Profile module (r0.16)
// ----------------------------------------------------------------------------
// Replaces profile.html in the shell context. Same backend endpoints, same
// drawer structure. NEW in r0.16:
//   - File row in every drawer: View / Replace / Download (locked for non-HR)
//   - Reviews drawer: Monday-style cards (stage chip + outcome chip + ⋯)
//   - Attendance drawer (NEW) — month calendar + 4-tile payslip roll-up
//
// Routes: #profile/me  (current user)
//         #profile/<userId> (specific user)
//
// profile.html stays on disk (production team still uses it). Both work.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['profile'] = {
  title: 'Profile',

  render() {
    return '' +
      '<style>' +
        '#prof-mod .header-card{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:20px 22px;display:flex;gap:18px;align-items:center;margin-bottom:18px}' +
        '#prof-mod .avatar-lg{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:var(--ink);flex-shrink:0}' +
        '#prof-mod .header-info{flex:1;min-width:0}' +
        '#prof-mod .header-info h1{font-size:22px;font-weight:500;margin:0 0 4px;letter-spacing:-0.3px}' +
        '#prof-mod .header-meta{font-size:14px;color:var(--muted);display:flex;gap:12px;flex-wrap:wrap}' +
        '#prof-mod .header-meta span{display:flex;align-items:center;gap:5px}' +
        '#prof-mod .pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:500;background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .pill.off{background:var(--red-soft);color:var(--red)}' +
        '#prof-mod .pill.idle{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .pill.probation{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .pill.on-track{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .header-actions{display:flex;gap:8px;align-items:center}' +
        '#prof-mod .header-action-btn{padding:6px 12px;border:0.5px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-size:13px;color:var(--muted);display:inline-flex;align-items:center;gap:5px}' +
        '#prof-mod .header-action-btn:hover{color:var(--ink);background:var(--bg)}' +
        '#prof-mod .profile-grid{display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:start}' +
        '@media (max-width:760px){#prof-mod .profile-grid{grid-template-columns:1fr}}' +
        '#prof-mod .drawer-nav{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:10px 8px;position:sticky;top:16px}' +
        '#prof-mod .drawer-tab{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;color:var(--muted);font-size:14px;transition:background 0.1s}' +
        '#prof-mod .drawer-tab:hover{background:rgba(20,22,27,0.04);color:var(--ink)}' +
        '#prof-mod .drawer-tab.on{background:var(--amber-soft);color:var(--amber-deep);font-weight:500}' +
        '#prof-mod .drawer-tab i{font-size:16px}' +
        '#prof-mod .drawer-tab .count{margin-left:auto;background:var(--line);color:var(--muted);font-size:11px;padding:1px 6px;border-radius:99px;min-width:20px;text-align:center}' +
        '#prof-mod .drawer-tab.on .count{background:var(--amber);color:white}' +
        '#prof-mod .panel{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:22px 24px}' +
        '#prof-mod .panel h2{font-size:18px;font-weight:500;margin:0 0 4px}' +
        '#prof-mod .panel .sub{font-size:13px;color:var(--muted);margin:0 0 18px}' +
        '#prof-mod .info-block{background:var(--bg);border:0.5px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}' +
        '#prof-mod .info-block-title{font-size:13px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}' +
        '#prof-mod .info-row{font-size:14px;margin-bottom:8px;color:var(--ink)}' +
        '#prof-mod .info-row:last-child{margin-bottom:0}' +
        '#prof-mod .info-label{color:var(--muted);display:inline-block;min-width:120px}' +
        '#prof-mod .file-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--line)}' +
        '#prof-mod .file-row:last-child{border-bottom:none}' +
        '#prof-mod .file-row .ti-file{font-size:22px;color:var(--ink-soft,#888780)}' +
        '#prof-mod .file-row .file-meta{flex:1;min-width:0}' +
        '#prof-mod .file-row .file-name{font-size:14px;font-weight:500;word-break:break-word}' +
        '#prof-mod .file-row .file-sub{font-size:12px;color:var(--muted);margin-top:2px}' +
        '#prof-mod .file-row button{font-size:12px;padding:5px 9px;border:0.5px solid var(--line);background:var(--surface);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;color:var(--ink)}' +
        '#prof-mod .file-row button:hover{background:var(--bg)}' +
        '#prof-mod .file-row button:disabled{opacity:0.4;cursor:not-allowed}' +
        '#prof-mod .file-row .btn-danger{color:var(--red);border-color:var(--red-soft)}' +
        '#prof-mod .upload-area{margin-top:14px;padding:14px;border:1.5px dashed var(--line);border-radius:10px;text-align:center}' +
        '#prof-mod .upload-area input[type=file]{display:none}' +
        '#prof-mod .upload-area label{cursor:pointer;color:var(--amber-deep);font-weight:500}' +
        '#prof-mod .review-card{background:var(--surface);border:0.5px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:10px;transition:opacity 0.15s}' +
        '#prof-mod .review-card.scheduled{border-style:dashed}' +
        '#prof-mod .review-card.cancelled{opacity:0.55}' +
        '#prof-mod .review-card.cancelled .stage-chip,#prof-mod .review-card.cancelled .review-date,#prof-mod .review-card.cancelled .review-notes{text-decoration:line-through}' +
        '#prof-mod .review-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap}' +
        '#prof-mod .stage-chip{font-size:12px;padding:3px 10px;border-radius:99px;background:var(--amber-soft);color:var(--amber-deep);font-weight:500}' +
        '#prof-mod .outcome-chip{font-size:12px;padding:3px 10px;border-radius:99px;font-weight:500;display:inline-flex;align-items:center;gap:4px}' +
        '#prof-mod .outcome-chip.outcome-passed{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .outcome-chip.outcome-excellent{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .outcome-chip.outcome-needs_improvement{background:var(--red-soft);color:var(--red)}' +
        '#prof-mod .outcome-chip.outcome-salary_reviewed{background:rgba(40,90,180,0.10);color:#2D5BAF}' +
        '#prof-mod .outcome-chip.outcome-in_process{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .outcome-chip.outcome-scheduled,#prof-mod .outcome-chip.outcome-cancelled{background:var(--line);color:var(--muted)}' +
        '#prof-mod .review-date{font-size:13px;color:var(--muted)}' +
        '#prof-mod .review-notes{font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:8px;white-space:pre-wrap}' +
        '#prof-mod .doc-chip{font-size:12px;padding:3px 8px;background:var(--bg);border-radius:6px;display:inline-flex;align-items:center;gap:4px;color:var(--ink)}' +
        '#prof-mod .more-btn{font-size:13px;padding:4px 8px;border:0.5px solid var(--line);background:transparent;border-radius:6px;cursor:pointer}' +
        '#prof-mod .more-menu{position:absolute;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.08);z-index:50;min-width:140px}' +
        '#prof-mod .more-menu button{display:block;width:100%;text-align:left;padding:7px 10px;background:transparent;border:none;cursor:pointer;border-radius:5px;font-size:13px}' +
        '#prof-mod .more-menu button:hover{background:var(--bg)}' +
        '#prof-mod .more-menu button.danger{color:var(--red)}' +
        // Attendance calendar
        '#prof-mod .att-cal{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:14px 16px}' +
        '#prof-mod .att-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}' +
        '#prof-mod .att-cal-nav{display:flex;align-items:center;gap:10px}' +
        '#prof-mod .att-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}' +
        '#prof-mod .att-cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-size:11px;color:var(--muted);margin-bottom:6px;text-align:center}' +
        '#prof-mod .att-day{aspect-ratio:1;border-radius:6px;padding:4px;font-size:11px;position:relative;display:flex;align-items:flex-start;justify-content:flex-end}' +
        '#prof-mod .att-day .att-flag{position:absolute;bottom:4px;left:4px;font-size:9px;font-weight:500}' +
        '#prof-mod .att-day.att-empty{background:var(--bg);color:var(--muted)}' +
        '#prof-mod .att-day.att-worked{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .att-day.att-late{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .att-day.att-wfh{background:rgba(13,148,136,0.12);color:#0F766E}' +
        '#prof-mod .att-day.att-sick{background:var(--red-soft);color:var(--red)}' +
        '#prof-mod .att-day.att-leave{background:rgba(40,90,180,0.10);color:#2D5BAF}' +
        '#prof-mod .att-day.att-holiday{background:var(--bg);color:var(--muted)}' +
        '#prof-mod .att-day.att-future{background:transparent;border:0.5px dashed var(--line);color:var(--muted)}' +
        '#prof-mod .att-day.att-today{outline:2px solid var(--amber);background:var(--amber);color:#412402}' +
        '#prof-mod .att-legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;font-size:11px}' +
        '#prof-mod .att-legend span{display:flex;align-items:center;gap:4px}' +
        '#prof-mod .att-legend .swatch{display:inline-block;width:10px;height:10px;border-radius:2px}' +
        '#prof-mod .att-rollup{margin-top:14px;padding-top:14px;border-top:0.5px solid var(--line);display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}' +
        '#prof-mod .att-tile{background:var(--bg);border-radius:8px;padding:10px 12px}' +
        '#prof-mod .att-tile .num{font-size:18px;font-weight:500}' +
        '#prof-mod .att-tile .lbl{font-size:11px;color:var(--muted);margin-top:2px}' +
      '</style>' +
      '<div id="prof-mod">' +
        '<div class="header-card" id="profHeader">' +
          '<div class="avatar-lg" id="profAvatar">—</div>' +
          '<div class="header-info">' +
            '<h1 id="profName">Loading…</h1>' +
            '<div class="header-meta" id="profMeta"></div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;align-items:flex-end">' +
            '<div id="profStatusPill"></div>' +
            '<div class="header-actions" id="profActions"></div>' +
          '</div>' +
        '</div>' +
        '<div class="profile-grid">' +
          '<nav class="drawer-nav" id="profDrawerNav"></nav>' +
          '<div class="panel" id="profPanel">' +
            '<h2 id="profPanelTitle">—</h2>' +
            '<p class="sub" id="profPanelSub">—</p>' +
            '<div id="profPanelBody">Loading…</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(rootEl, ctx) {
    // ctx.params is something like { userId: 'me' } or { userId: '42' }
    // From the route #profile/me or #profile/42
    // r0.16 — also supports { userId, drawer } to pre-select a drawer.
    const meId = (window.fkUser && window.fkUser.id) || (window.cpUser && window.cpUser.id);
    const raw = ctx && ctx.params && ctx.params.userId;
    const initialDrawer = (ctx && ctx.params && ctx.params.drawer) || null;
    const profileUserId = (!raw || raw === 'me') ? meId : parseInt(raw, 10);
    if (!Number.isFinite(profileUserId)) {
      document.getElementById('profPanelBody').innerHTML =
        '<div style="color:var(--red)">Bad profile id</div>';
      return;
    }

    // --- Helpers --------------------------------------------------------
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const escAttr = esc;
    const fmtDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const fmtSize = (b) => {
      if (b == null) return '';
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
      return (b / 1024 / 1024).toFixed(1) + ' MB';
    };

    let overview = null;
    let viewer = null;
    let currentDrawer = null;

    // --- Overview fetch ------------------------------------------------
    async function loadOverview() {
      const r = await fetch('/api/profile/' + profileUserId + '/overview', { credentials: 'include' });
      if (!r.ok) {
        document.getElementById('profPanelBody').innerHTML =
          '<div style="color:var(--red)">' + (r.status === 403 ? 'Permission denied' : 'Failed to load') + '</div>';
        return false;
      }
      overview = await r.json();
      viewer = overview.viewer;
      renderHeader();
      renderDrawerNav();
      return true;
    }

    function renderHeader() {
      const u = overview.user;
      const colour = u.avatar_colour || '#888780';
      const avatar = document.getElementById('profAvatar');
      avatar.style.background = colour;
      avatar.style.color = '#FFFFFF';
      avatar.textContent = u.initials || (u.full_name || '?')[0];
      document.getElementById('profName').textContent = u.display_name || u.full_name || '—';
      const metaParts = [];
      if (u.departments && u.departments.length) {
        metaParts.push('<i class="ti ti-building"></i> ' + u.departments.map(d => esc(d.name)).join(', '));
      }
      if (u.employment_status === 'active' && u.hire_date) {
        metaParts.push('<i class="ti ti-calendar"></i> Joined ' + fmtDate(u.hire_date));
      } else if (u.employment_status !== 'active') {
        metaParts.push('<span style="color:var(--red)">No longer at FK Sports</span>');
      }
      document.getElementById('profMeta').innerHTML = metaParts.map(p => '<span>' + p + '</span>').join('');
      // Header status pill
      const sp = document.getElementById('profStatusPill');
      if (u.status === 'active') sp.innerHTML = '<span class="pill">Active</span>';
      else if (u.status === 'idle') sp.innerHTML = '<span class="pill idle">Idle</span>';
      else if (u.status === 'offline') sp.innerHTML = '<span class="pill off">Offline</span>';
      else sp.innerHTML = '';
    }

    function renderDrawerNav() {
      const nav = document.getElementById('profDrawerNav');
      const counts = overview.counts || {};
      const ICONS = {
        personal: 'ti-user',
        employment: 'ti-briefcase',
        salary: 'ti-coin',
        reviews: 'ti-clipboard-check',
        payroll: 'ti-file-text',
        insurance: 'ti-shield',
        onboarding: 'ti-checklist',
        attendance: 'ti-calendar', // r0.16 NEW
      };
      const LABELS = {
        personal: 'Personal',
        employment: 'Employment',
        salary: 'Salary',
        reviews: 'Reviews',
        payroll: 'Payroll',
        insurance: 'Insurance',
        onboarding: 'Onboarding',
        attendance: 'Attendance',
      };
      // r0.16 — Attendance is added to the local drawer list for all visible profiles
      // even if backend doesn't return it (it's not a "file drawer" but a virtual one).
      const drawers = [...(overview.drawers || [])];
      if (!drawers.includes('attendance')) drawers.push('attendance');

      nav.innerHTML = drawers.map(d => {
        const count = counts[d];
        let countHtml = '';
        if (d === 'onboarding' && counts.__onboarding_total != null) {
          countHtml = '<span class="count">' + (counts.__onboarding_completed || 0) + '/' + counts.__onboarding_total + '</span>';
        } else if (count != null && count > 0) {
          countHtml = '<span class="count">' + count + '</span>';
        }
        return '<div class="drawer-tab" data-drawer="' + d + '">' +
          '<i class="ti ' + (ICONS[d] || 'ti-file') + '"></i>' +
          '<span>' + (LABELS[d] || d) + '</span>' +
          countHtml +
          '</div>';
      }).join('');
      nav.querySelectorAll('.drawer-tab').forEach(el => {
        el.addEventListener('click', () => {
          loadDrawer(el.dataset.drawer);
        });
      });
      // Default to first drawer (or initialDrawer if specified via route param)
      if (initialDrawer && drawers.includes(initialDrawer)) {
        loadDrawer(initialDrawer);
      } else if (drawers.length) {
        loadDrawer(drawers[0]);
      }
    }

    // --- Drawer load + render -----------------------------------------
    async function loadDrawer(drawer) {
      currentDrawer = drawer;
      // Mark active tab
      document.querySelectorAll('#profDrawerNav .drawer-tab').forEach(el => {
        el.classList.toggle('on', el.dataset.drawer === drawer);
      });
      const titleEl = document.getElementById('profPanelTitle');
      const subEl = document.getElementById('profPanelSub');
      const body = document.getElementById('profPanelBody');
      body.innerHTML = '<div style="color:var(--muted);padding:20px 0">Loading…</div>';

      const TITLES = {
        personal: ['Personal', 'Contact and emergency info.'],
        employment: ['Employment', 'Contract and role documents.'],
        salary: ['Salary', 'Current salary and history.'],
        reviews: ['Reviews', 'Performance reviews and outcomes.'],
        payroll: ['Payroll', 'Payslips and tax docs.'],
        insurance: ['Insurance', 'Health and other policies.'],
        onboarding: ['Onboarding', 'Joining checklist and signed docs.'],
        attendance: ['Attendance', 'Monthly attendance calendar.'],
      };
      titleEl.textContent = (TITLES[drawer] || [drawer])[0];
      subEl.textContent = (TITLES[drawer] || ['', ''])[1];

      try {
        if (drawer === 'attendance') {
          await renderAttendanceDrawer();
          return;
        }
        if (drawer === 'reviews') {
          // Reviews drawer fetches via the standard drawer endpoint
          const r = await fetch('/api/profile/' + profileUserId + '/drawer/' + drawer, { credentials: 'include' });
          if (!r.ok) {
            body.innerHTML = '<div style="color:var(--red)">Failed to load</div>';
            return;
          }
          const data = await r.json();
          renderReviewsDrawer(data);
          return;
        }
        // Generic drawer = files + (kind-specific extras)
        const r = await fetch('/api/profile/' + profileUserId + '/drawer/' + drawer, { credentials: 'include' });
        if (!r.ok) {
          body.innerHTML = '<div style="color:var(--red)">Failed to load</div>';
          return;
        }
        const data = await r.json();
        renderGenericDrawer(data, drawer);
      } catch (e) {
        console.error('[profile loadDrawer]', e);
        body.innerHTML = '<div style="color:var(--red)">Failed to load</div>';
      }
    }

    // --- File row component (r0.16 NEW) -------------------------------
    // r0.16.3 — fileRowHtml takes drawer explicitly. Backend doesn't return
    // file.user_id or file.drawer (those are implicit at the query level).
    // All files in `data.files` belong to profileUserId and to `drawer`.
    function fileRowHtml(file, drawer) {
      const isOwnFile = profileUserId === viewer.user_id;
      const canDownload = viewer.can_view_salary || isOwnFile;
      const canDelete = viewer.can_delete_any || (isOwnFile && drawer === 'personal');
      const canReplace = viewer.can_upload_any || (isOwnFile && drawer === 'personal');
      const downloadBtn = canDownload
        ? '<button class="file-download" data-id="' + file.id + '"><i class="ti ti-download"></i>Download</button>'
        : '<button disabled title="Download restricted to Owner + HR"><i class="ti ti-lock"></i>Download</button>';
      const replaceBtn = canReplace
        ? '<button class="file-replace" data-id="' + file.id + '"><i class="ti ti-refresh"></i>Replace</button>'
        : '';
      const deleteBtn = canDelete
        ? '<button class="file-delete btn-danger" data-id="' + file.id + '" aria-label="Delete"><i class="ti ti-trash"></i></button>'
        : '';
      const icon = file.mime_type === 'application/pdf' ? 'ti-file-type-pdf' :
                   (file.mime_type || '').startsWith('image/') ? 'ti-photo' : 'ti-file';
      return '<div class="file-row">' +
        '<i class="ti ' + icon + '"></i>' +
        '<div class="file-meta">' +
          '<div class="file-name">' + esc(file.filename) + '</div>' +
          '<div class="file-sub">Uploaded ' + fmtDate(file.uploaded_at) + ' · ' + fmtSize(file.size_bytes) + '</div>' +
        '</div>' +
        '<button class="file-view" data-id="' + file.id + '"><i class="ti ti-eye"></i>View</button>' +
        replaceBtn +
        downloadBtn +
        deleteBtn +
      '</div>';
    }

    function wireFileRowHandlers() {
      const body = document.getElementById('profPanelBody');
      body.querySelectorAll('.file-view').forEach(b => {
        b.addEventListener('click', () => {
          window.open('/api/files/' + b.dataset.id, '_blank', 'noopener');
        });
      });
      body.querySelectorAll('.file-download').forEach(b => {
        b.addEventListener('click', () => {
          // ?download=1 triggers attachment + permission check
          window.location.href = '/api/files/' + b.dataset.id + '?download=1';
        });
      });
      body.querySelectorAll('.file-delete').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('Delete this file? This cannot be undone.')) return;
          const r = await fetch('/api/files/' + b.dataset.id, { method: 'DELETE', credentials: 'include' });
          if (!r.ok) { alert('Delete failed'); return; }
          loadDrawer(currentDrawer);
        });
      });
      body.querySelectorAll('.file-replace').forEach(b => {
        b.addEventListener('click', () => {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = '.pdf,.png,application/pdf,image/png';
          inp.style.display = 'none';
          inp.addEventListener('change', async () => {
            if (!inp.files.length) return;
            const fd = new FormData();
            fd.append('file', inp.files[0]);
            const r = await fetch('/api/files/' + b.dataset.id + '/replace', {
              method: 'POST', credentials: 'include', body: fd
            });
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              alert('Replace failed: ' + (err.error || r.status));
              return;
            }
            loadDrawer(currentDrawer);
          });
          document.body.appendChild(inp);
          inp.click();
          setTimeout(() => inp.remove(), 1000);
        });
      });
    }

    // --- Upload area ---------------------------------------------------
    function uploadAreaHtml(drawer) {
      const canUpload = viewer.can_upload_any || (viewer.is_self && drawer === 'personal' && viewer.can_upload_own);
      if (!canUpload) return '';
      // Salary drawer extra-gate
      if (drawer === 'salary' && !viewer.can_edit_salary) return '';
      return '<div class="upload-area">' +
        '<input type="file" id="profUpload" accept=".pdf,.png,application/pdf,image/png" />' +
        '<label for="profUpload"><i class="ti ti-upload"></i> Upload a file (PDF or PNG)</label>' +
      '</div>';
    }
    function wireUploadHandler(drawer) {
      const inp = document.getElementById('profUpload');
      if (!inp) return;
      inp.addEventListener('change', async () => {
        if (!inp.files.length) return;
        const fd = new FormData();
        fd.append('file', inp.files[0]);
        fd.append('user_id', String(profileUserId));
        fd.append('drawer', drawer);
        const r = await fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert('Upload failed: ' + (err.error || r.status));
          return;
        }
        loadDrawer(currentDrawer);
      });
    }

    // --- Generic drawer (files + onboarding items + salary structure) ----
    function renderGenericDrawer(data, drawer) {
      const body = document.getElementById('profPanelBody');
      const files = data.files || [];
      let html = '';

      // Onboarding: render checklist items first
      if (drawer === 'onboarding' && Array.isArray(data.notes) && data.notes.length > 0) {
        html += '<div style="margin-bottom:14px">';
        for (const it of data.notes) {
          const done = !!it.is_completed;
          html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--line)">' +
            '<i class="ti ' + (done ? 'ti-circle-check' : 'ti-circle') + '" style="font-size:18px;color:' + (done ? 'var(--green)' : 'var(--muted)') + '"></i>' +
            '<div style="flex:1"><div style="font-size:14px;' + (done ? 'text-decoration:line-through;color:var(--muted)' : '') + '">' + esc(it.title) + '</div>' +
              (it.body ? '<div style="font-size:12px;color:var(--muted);margin-top:2px;white-space:pre-wrap">' + esc(it.body) + '</div>' : '') +
            '</div>' +
          '</div>';
        }
        html += '</div>';
      }

      // Salary: render the salary card if present
      if (drawer === 'salary' && data.salary) {
        const s = data.salary;
        const curr = s.currency || '£';
        html += '<div class="info-block">' +
          '<div class="info-block-title">Current salary</div>' +
          '<div class="info-row"><span class="info-label">Monthly CTC</span> ' + esc(curr) + ' ' + (s.monthly_ctc != null ? Number(s.monthly_ctc).toLocaleString('en-GB') : '—') + '</div>' +
          (s.effective_from ? '<div class="info-row"><span class="info-label">Effective from</span> ' + fmtDate(s.effective_from) + '</div>' : '') +
          (s.notes ? '<div class="info-row" style="white-space:pre-wrap"><span class="info-label">Notes</span> ' + esc(s.notes) + '</div>' : '') +
        '</div>';
      }

      // Personal: contact + emergency + DOB + address read-only
      if (drawer === 'personal' && overview && overview.user) {
        const u = overview.user;
        const dobStr = u.date_of_birth ? String(u.date_of_birth).slice(0, 10) : '';
        if (u.phone || u.email) {
          html += '<div class="info-block">' +
            '<div class="info-block-title">Contact</div>' +
            (u.phone ? '<div class="info-row"><span class="info-label">Phone</span> ' + esc(u.phone) + '</div>' : '') +
            (u.email ? '<div class="info-row"><span class="info-label">Email</span> ' + esc(u.email) + '</div>' : '') +
          '</div>';
        }
        if (dobStr || u.personal_address) {
          html += '<div class="info-block">' +
            '<div class="info-block-title">Personal</div>' +
            (dobStr ? '<div class="info-row"><span class="info-label">Date of birth</span> ' + fmtDate(dobStr) + '</div>' : '') +
            (u.personal_address ? '<div class="info-row" style="white-space:pre-wrap"><span class="info-label">Home address</span> ' + esc(u.personal_address) + '</div>' : '') +
          '</div>';
        }
        if (u.emergency_contact) {
          html += '<div class="info-block">' +
            '<div class="info-block-title">Emergency contact</div>' +
            '<div class="info-row" style="white-space:pre-wrap">' + esc(u.emergency_contact) + '</div>' +
          '</div>';
        }
        // Note: editing personal info stays on profile.html for r0.16. The module
        // is read-only for personal info; we'll add edit forms in a later ship.
        if (viewer && viewer.is_self) {
          html += '<div style="font-size:12px;color:var(--muted);margin:8px 0 14px">To edit personal details, use the legacy profile page for now.</div>';
        }
      }

      // Employment drawer: read-only employment info
      if (drawer === 'employment' && overview && overview.user) {
        const u = overview.user;
        const parts = [];
        if (u.employment_type) parts.push(['Employment type', u.employment_type.replace(/_/g, ' ')]);
        if (u.work_pattern) parts.push(['Work pattern', u.work_pattern.replace(/_/g, ' ')]);
        if (u.hire_date) parts.push(['Hire date', fmtDate(u.hire_date)]);
        if (u.probation_end_date) parts.push(['Probation ends', fmtDate(u.probation_end_date)]);
        if (u.probation_status) parts.push(['Probation status', u.probation_status.replace(/_/g, ' ')]);
        if (u.notice_period_days) parts.push(['Notice period', u.notice_period_days + ' days']);
        if (parts.length) {
          html += '<div class="info-block">' +
            '<div class="info-block-title">Employment</div>' +
            parts.map(p => '<div class="info-row"><span class="info-label">' + p[0] + '</span> ' + esc(p[1]) + '</div>').join('') +
          '</div>';
        }
      }

      // Files
      html += '<div style="margin-top:4px"><div class="info-block-title" style="margin-bottom:8px">Files</div>';
      if (files.length === 0) {
        html += '<div style="color:var(--muted);padding:10px 0">No files in this drawer yet.</div>';
      } else {
        html += files.map(f => fileRowHtml(f, drawer)).join('');
      }
      html += '</div>';

      html += uploadAreaHtml(drawer);
      body.innerHTML = html;
      wireFileRowHandlers();
      wireUploadHandler(drawer);
    }

    // --- Reviews drawer (Monday-style cards, r0.16 NEW) ---------------
    function reviewStageLabel(rt) {
      const map = {
        '1_month': '1 month review',
        '3_month': '3 month review',
        '4_month': '4 month review',
        '6_month': '6 month review',
        '8_month': '8 month review',
        'annual': 'Annual review',
        'ad_hoc': 'Ad-hoc review',
      };
      return map[rt] || (rt + ' review');
    }
    function outcomeLabel(s) {
      const map = {
        scheduled: 'Scheduled',
        cancelled: 'Cancelled',
        needs_improvement: 'Needs improvement',
        passed: 'Passed',
        excellent: 'Excellent',
        salary_reviewed: 'Salary reviewed',
        in_process: 'In process',
        // legacy
        pass: 'Passed', extend: 'Needs improvement', fail: 'Failed',
        satisfactory: 'Satisfactory', good: 'Good',
      };
      return map[s] || s;
    }
    function outcomeClass(s) {
      if (['pass'].includes(s)) return 'outcome-passed';
      if (['extend'].includes(s)) return 'outcome-needs_improvement';
      return 'outcome-' + (s || 'scheduled');
    }
    function reviewCardHtml(rv) {
      const isCancelled = !!rv.cancelled_at;
      const isFuture = (rv.status === 'scheduled' || (!rv.status && !rv.is_completed)) && !isCancelled;
      const docs = rv.attached_files || [];
      const status = isCancelled ? 'cancelled' : (rv.status || 'scheduled');
      return '<div class="review-card ' + (isCancelled ? 'cancelled' : (isFuture ? 'scheduled' : '')) + '" data-rid="' + rv.id + '">' +
        '<div class="review-card-head">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span class="stage-chip">' + esc(reviewStageLabel(rv.review_type)) + '</span>' +
            (rv.review_date ? '<span class="review-date"><i class="ti ti-calendar" style="font-size:13px;vertical-align:-2px"></i> ' + fmtDate(rv.review_date) + '</span>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span class="outcome-chip ' + outcomeClass(status) + '">' + esc(outcomeLabel(status)) + '</span>' +
            (!isCancelled ? '<button class="more-btn rv-more" data-rid="' + rv.id + '" aria-label="More">⋯</button>' : '') +
          '</div>' +
        '</div>' +
        (rv.body ? '<div class="review-notes">' + esc(rv.body) + '</div>' : '') +
        (docs.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px">' + docs.map(f => '<span class="doc-chip rv-doc" data-fid="' + f.id + '"><i class="ti ti-paperclip" style="font-size:13px"></i>' + esc(f.filename) + '</span>').join('') + '</div>' : '') +
      '</div>';
    }
    function renderReviewsDrawer(data) {
      const body = document.getElementById('profPanelBody');
      // Backend already filters by kind='review' in SQL — no need to re-filter client-side.
      // (The kind column isn't even selected in the response.)
      const reviews = data.notes || [];
      const files = data.files || [];
      const canEdit = viewer.can_edit_any || viewer.can_edit_dept;

      // Sort: scheduled future first, then by date desc; cancelled goes last
      reviews.sort((a, b) => {
        if (!!a.cancelled_at !== !!b.cancelled_at) return a.cancelled_at ? 1 : -1;
        return (b.review_date || '').localeCompare(a.review_date || '');
      });

      let html = '';
      if (reviews.length === 0) {
        html = '<div style="color:var(--muted);padding:20px 0;text-align:center">No reviews yet.</div>';
      } else {
        html = reviews.map(reviewCardHtml).join('');
      }
      if (canEdit) {
        html += '<button class="header-action-btn" id="rvAddBtn" style="margin-top:14px"><i class="ti ti-plus"></i>Add review</button>';
      }
      body.innerHTML = html;

      // Wire doc-chip clicks (open file inline)
      body.querySelectorAll('.rv-doc').forEach(el => {
        el.addEventListener('click', () => window.open('/api/files/' + el.dataset.fid, '_blank', 'noopener'));
      });
      // Wire ⋯ menus
      body.querySelectorAll('.rv-more').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          showReviewMoreMenu(btn);
        });
      });
      // Wire Add button
      const addBtn = document.getElementById('rvAddBtn');
      if (addBtn) addBtn.addEventListener('click', () => openAddReviewForm());
    }

    // r0.16.4 — Menus are appended to document.body (so they're not scoped to
    // #prof-mod). Clean them + the outside-click listener via one helper so
    // unmount can fully tear down. window.__fkProfMenuCloser holds the live
    // listener ref so it can be removed if the user navigates with a menu open.
    function closeProfMenus() {
      document.querySelectorAll('.more-menu').forEach(m => m.remove());
      if (window.__fkProfMenuCloser) {
        document.removeEventListener('click', window.__fkProfMenuCloser);
        window.__fkProfMenuCloser = null;
      }
    }

    function showReviewMoreMenu(btn) {
      // close any existing
      closeProfMenus();
      const rid = btn.dataset.rid;
      const menu = document.createElement('div');
      menu.className = 'more-menu';
      menu.innerHTML =
        '<button data-act="reschedule">Reschedule</button>' +
        '<button data-act="cancel" class="danger">Cancel review</button>';
      document.body.appendChild(menu);
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
      menu.style.left = (rect.right + window.scrollX - menu.offsetWidth) + 'px';
      menu.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', async () => {
          closeProfMenus();
          if (b.dataset.act === 'cancel') {
            const reason = prompt('Reason for cancelling this review? (optional)');
            if (reason === null) return;
            const r = await fetch('/api/profile/' + profileUserId + '/notes/' + rid + '/cancel',
              { method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason }) });
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              alert('Cancel failed: ' + (err.error || r.status));
              return;
            }
            loadDrawer('reviews');
          } else if (b.dataset.act === 'reschedule') {
            const newDate = prompt('New review date (YYYY-MM-DD):');
            if (!newDate) return;
            const r = await fetch('/api/profile/' + profileUserId + '/notes/' + rid,
              { method: 'PATCH', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ review_date: newDate }) });
            if (!r.ok) { alert('Reschedule failed'); return; }
            loadDrawer('reviews');
          }
        });
      });
      // Close on outside click — stash the ref so unmount can remove it if the
      // user navigates away with the menu still open.
      setTimeout(() => {
        const closer = function () { closeProfMenus(); };
        window.__fkProfMenuCloser = closer;
        document.addEventListener('click', closer, { once: true });
      }, 0);
    }

    function openAddReviewForm() {
      const body = document.getElementById('profPanelBody');
      body.insertAdjacentHTML('beforeend',
        '<div class="info-block" id="rvAddBox" style="margin-top:14px">' +
          '<div class="info-block-title">Add review</div>' +
          '<div style="display:grid;gap:10px;grid-template-columns:1fr 1fr">' +
            '<div><label style="font-size:12px;color:var(--muted)">Type</label>' +
              '<select id="rvType" style="width:100%;padding:7px;border:0.5px solid var(--line);border-radius:6px">' +
                '<option value="1_month">1 month</option>' +
                '<option value="3_month">3 month</option>' +
                '<option value="4_month">4 month</option>' +
                '<option value="6_month">6 month</option>' +
                '<option value="8_month">8 month</option>' +
                '<option value="annual">Annual</option>' +
                '<option value="ad_hoc">Ad-hoc</option>' +
              '</select></div>' +
            '<div><label style="font-size:12px;color:var(--muted)">Date</label>' +
              '<input id="rvDate" type="date" style="width:100%;padding:7px;border:0.5px solid var(--line);border-radius:6px" /></div>' +
            '<div style="grid-column:span 2"><label style="font-size:12px;color:var(--muted)">Notes (optional)</label>' +
              '<textarea id="rvNotes" style="width:100%;padding:7px;border:0.5px solid var(--line);border-radius:6px;min-height:60px"></textarea></div>' +
          '</div>' +
          '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end">' +
            '<button class="header-action-btn" id="rvCancel">Cancel</button>' +
            '<button class="header-action-btn" id="rvSave" style="color:var(--amber-deep)">Save</button>' +
          '</div>' +
        '</div>'
      );
      document.getElementById('rvCancel').addEventListener('click', () => {
        document.getElementById('rvAddBox').remove();
      });
      document.getElementById('rvSave').addEventListener('click', async () => {
        const review_type = document.getElementById('rvType').value;
        const review_date = document.getElementById('rvDate').value;
        const body_txt = document.getElementById('rvNotes').value;
        if (!review_date) { alert('Date required'); return; }
        const r = await fetch('/api/profile/' + profileUserId + '/notes',
          { method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'review', review_type, review_date, body: body_txt, title: reviewStageLabel(review_type) }) });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert('Save failed: ' + (err.error || r.status));
          return;
        }
        loadDrawer('reviews');
      });
    }

    // --- Attendance drawer (r0.16 NEW) --------------------------------
    let attYear = new Date().getFullYear();
    let attMonth = new Date().getMonth() + 1;

    async function renderAttendanceDrawer() {
      const body = document.getElementById('profPanelBody');
      // r0.16.4 — Gate the scaffold build on the LIVE panel body, not a
      // document-wide lookup. A stale #attMonthLabel left elsewhere in the DOM
      // used to make this skip the build, so #attGrid was never created and
      // loadAttendanceMonth crashed on a null grid. loadDrawer always clears
      // `body` first, so this rebuilds the scaffold on every open.
      if (!body.querySelector('#attMonthLabel')) {
        body.innerHTML =
        '<div class="att-cal">' +
          '<div class="att-cal-head">' +
            '<div class="att-cal-nav">' +
              '<button class="header-action-btn" id="attPrev"><i class="ti ti-chevron-left"></i></button>' +
              '<div id="attMonthLabel" style="font-weight:500;min-width:140px;text-align:center">—</div>' +
              '<button class="header-action-btn" id="attNext"><i class="ti ti-chevron-right"></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="att-cal-dow"><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div></div>' +
          '<div class="att-cal-grid" id="attGrid"></div>' +
          '<div class="att-legend">' +
            '<span><span class="swatch" style="background:var(--green-soft)"></span>Worked (W)</span>' +
            '<span><span class="swatch" style="background:var(--amber-soft)"></span>Late (L)</span>' +
            '<span><span class="swatch" style="background:rgba(13,148,136,0.12)"></span>WFH</span>' +
            '<span><span class="swatch" style="background:var(--red-soft)"></span>Sick (S)</span>' +
            '<span><span class="swatch" style="background:rgba(40,90,180,0.10)"></span>Leave (A.L.)</span>' +
            '<span><span class="swatch" style="background:var(--bg)"></span>Off (H)</span>' +
          '</div>' +
          '<div class="att-rollup" id="attRollup"></div>' +
        '</div>';
        body.querySelector('#attPrev').addEventListener('click', () => {
          attMonth--; if (attMonth < 1) { attMonth = 12; attYear--; } loadAttendanceMonth();
        });
        body.querySelector('#attNext').addEventListener('click', () => {
          attMonth++; if (attMonth > 12) { attMonth = 1; attYear++; } loadAttendanceMonth();
        });
      }
      await loadAttendanceMonth();
    }

    async function loadAttendanceMonth() {
      const label = new Date(Date.UTC(attYear, attMonth - 1, 1))
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      // r0.16.5 — Scope ALL lookups to the live panel body. index.html's home
      // dashboard has its own #attMonthLabel (line ~874), so a document-wide
      // getElementById grabbed THAT one and wrote the month into the hidden home
      // card, leaving the profile label stuck on "—". Querying within the panel
      // makes a duplicate id elsewhere in the shell impossible to bind.
      const panel = document.getElementById('profPanelBody');
      const labelEl = panel && panel.querySelector('#attMonthLabel');
      const grid = panel && panel.querySelector('#attGrid');
      const rollup = panel && panel.querySelector('#attRollup');
      // Grab all three together and guard before any write — a null element
      // must degrade locally, never escape and wipe the panel.
      if (!labelEl || !grid || !rollup) return; // scaffold not in DOM — skip silently
      labelEl.textContent = label;
      grid.innerHTML = '<div style="grid-column:span 7;color:var(--muted);text-align:center;padding:14px">Loading…</div>';
      rollup.innerHTML = '';

      try {
        // r0.16 — Use /api/profile/:id/attendance-days which is gated on profile
        // view (own + dept + any), so agents see their own calendar. Payroll
        // endpoint is salary-gated and not used here.
        let days = [];
        const r = await fetch('/api/profile/' + profileUserId + '/attendance-days?year=' + attYear + '&month=' + attMonth, { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          days = d.days || [];
        }
        const canSeeRollup = viewer.can_view_salary || viewer.is_self;
        // Build calendar grid: prepend blanks for days before the 1st (Mon-start)
        const first = new Date(Date.UTC(attYear, attMonth - 1, 1));
        const firstDow = first.getUTCDay(); // 0=Sun
        const leading = firstDow === 0 ? 6 : (firstDow - 1);
        const daysInMonth = new Date(Date.UTC(attYear, attMonth, 0)).getUTCDate();
        const today = new Date();
        const todayIso = today.getFullYear() + '-' +
          String(today.getMonth() + 1).padStart(2, '0') + '-' +
          String(today.getDate()).padStart(2, '0');

        // Index days by date for quick lookup
        const byDate = {};
        for (const d of days) {
          const k = String(d.for_date).slice(0, 10);
          byDate[k] = d;
        }

        let html = '';
        for (let i = 0; i < leading; i++) html += '<div class="att-day att-empty"></div>';
        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = attYear + '-' + String(attMonth).padStart(2, '0') + '-' + String(day).padStart(2, '0');
          const rec = byDate[dateStr];
          const status = rec ? rec.status : null;
          let cls = 'att-day';
          let flag = '';
          // r0.16 — Compare ISO date strings: 'YYYY-MM-DD' lexicographic compare
          // is equivalent to date compare. No fragile triple-tier math.
          if (dateStr > todayIso) {
            cls += ' att-future';
          } else if (dateStr === todayIso) {
            cls += ' att-today'; flag = 'Today';
          } else if (status === 'on_time' || status === 'worked_voluntary') { cls += ' att-worked'; flag = 'W'; }
          else if (status === 'late' || status === 'very_late') { cls += ' att-late'; flag = 'L'; }
          else if (status === 'on_leave') { cls += ' att-leave'; flag = 'A.L.'; }
          else if (status === 'off_sick') { cls += ' att-sick'; flag = 'S'; }
          else if (status === 'off_holiday') { cls += ' att-holiday'; flag = 'H'; }
          else if (status && status.startsWith('off_')) { cls += ' att-empty'; }
          else { cls += ' att-empty'; }
          // WFH special-case if there's a wfh marker — could refine later
          html += '<div class="' + cls + '">' + day +
            (flag ? '<div class="att-flag">' + flag + '</div>' : '') +
            '</div>';
        }
        grid.innerHTML = html;

        // Roll-up tiles
        let worked = 0, late = 0, al = 0, sick = 0;
        for (const d of days) {
          if (d.status === 'on_time' || d.status === 'worked_voluntary') worked++;
          if (d.status === 'late' || d.status === 'very_late') { worked++; late++; }
          if (d.status === 'on_leave') al++;
          if (d.status === 'off_sick') sick++;
        }
        rollup.innerHTML =
          '<div class="att-tile"><div class="num" style="color:var(--green)">' + worked + '</div><div class="lbl">Days worked</div></div>' +
          '<div class="att-tile"><div class="num" style="color:var(--amber-deep)">' + late + '</div><div class="lbl">Late</div></div>' +
          '<div class="att-tile"><div class="num" style="color:#2D5BAF">' + al + '</div><div class="lbl">Annual leave</div></div>' +
          '<div class="att-tile"><div class="num" style="color:var(--red)">' + sick + '</div><div class="lbl">Sick</div></div>';

        if (!canSeeRollup) {
          rollup.innerHTML = '<div style="color:var(--muted);font-size:12px;grid-column:1/-1">Payroll roll-up only visible to HR/Owner.</div>';
        }
      } catch (e) {
        console.error('[attendance]', e);
        grid.innerHTML = '<div style="grid-column:span 7;color:var(--red);text-align:center;padding:14px">Failed to load</div>';
      }
    }

    // --- Kick off ------------------------------------------------------
    await loadOverview();
  },

  unmount() {
    // r0.16.4 — Menus live on document.body, and the outside-click listener is
    // on document, so neither dies when the loader clears #moduleView. Remove
    // both explicitly. (.more-menu is body-level, not under #prof-mod.)
    document.querySelectorAll('.more-menu').forEach(m => m.remove());
    if (window.__fkProfMenuCloser) {
      document.removeEventListener('click', window.__fkProfMenuCloser);
      window.__fkProfMenuCloser = null;
    }
  }
};
