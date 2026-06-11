// FK Home — Approvals module (r0.32, Close HR ship)
// ----------------------------------------------------------------------------
// Merges the old Leaves (hr/leaves) and Regularisations (hr/regularisations)
// queues into ONE page with two tabs: Leave + Corrections.
//
// Registered under THREE route keys so nothing else has to change:
//   hr/approvals          -> opens on the Leave tab (the new nav item)
//   hr/leaves             -> opens on the Leave tab  (leave notifications)
//   hr/leaves/<id>        -> Leave tab, expands + scrolls to that request
//   hr/regularisations    -> opens on the Corrections tab (correction notifications)
//
// Behaviour is ported verbatim from the two old modules so the queues, the
// balance panel, reject-with-note and approve/deny all work exactly as before.
//   Leave:       GET /api/leaves/pending ; POST /api/leaves/:id/decide
//   Corrections: GET /api/attendance/regularise/pending ;
//                POST /api/attendance/regularise/:id/decide
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDays(n) {
    const num = Number(n || 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }
  function fmtRange(s, e) {
    const sd = new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const ed = new Date(e).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return s === e ? sd : sd + ' \u2192 ' + ed;
  }
  function dateOnly(v) { if(!v) return ''; var s=String(v); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[3]+'/'+m[2]+'/'+m[1]; var d=new Date(s); return isNaN(d.getTime())?s:d.toLocaleDateString('en-GB'); }
  function fmtTime(t) {
    if (!t) return '\u2014';
    if (typeof t === 'string' && /^\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
    return '\u2014';
  }

  const approvals = {
    title: 'Approvals',

    render() {
      return '' +
        '<div id="ap-mod" class="fk-mod">' +
          '<style>' +
            '#ap-mod .ap-tabs{display:flex;gap:6px;border-bottom:0.5px solid var(--line);margin-bottom:20px}' +
            '#ap-mod .ap-tab{border:none;background:none;padding:12px 18px;font-size:15px;font-weight:500;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;display:flex;align-items:center;gap:9px}' +
            '#ap-mod .ap-tab.active{color:var(--ink);border-bottom-color:var(--amber)}' +
            '#ap-mod .ap-badge{font-size:14.5px;padding:2px 10px;border-radius:99px;background:#F1EFE8;color:#5F5E5A;font-weight:500}' +
            '#ap-mod .ap-tab.active .ap-badge{background:var(--amber-soft);color:var(--amber-deep)}' +
            '#ap-mod table{width:100%;border-collapse:collapse;font-size:14px}' +
            '#ap-mod th{text-align:left;font-size:14.5px;font-weight:500;color:var(--muted);padding:8px 10px 8px 0}' +
            '#ap-mod td{padding:14px 10px 14px 0;vertical-align:top}' +
            '#ap-mod .ap-btn{padding:10px 18px;font-size:14px;font-weight:500;border-radius:9px;cursor:pointer;border:0.5px solid var(--line);background:var(--bg);color:var(--ink)}' +
            '#ap-mod .ap-btn:hover{border-color:var(--line-strong)}' +
            '#ap-mod .ap-btn-primary{border:none;background:var(--amber);color:var(--amber-deep)}' +
            '#ap-mod .ap-btn-danger{border:0.5px solid var(--red);background:none;color:var(--red)}' +
            '#ap-mod .action-col{text-align:right;white-space:nowrap}' +
            '#ap-mod .action-col .ap-btn{margin-left:8px}' +
            '#ap-mod .avatar{width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:14.5px;font-weight:500;color:#3a3a36;flex-shrink:0}' +
            '#ap-mod .name-cell{display:flex;align-items:center;gap:11px}' +
            '#ap-mod .chip{font-size:14.5px;background:#E6F1FB;color:#0C447C;padding:4px 11px;border-radius:99px}' +
            '#ap-mod .disclose{background:none;border:none;color:var(--muted);cursor:pointer;font-size:14.5px;display:inline-flex;align-items:center;gap:5px;padding:2px 0}' +
            '#ap-mod .disclose:hover{color:var(--ink)}' +
            '#ap-mod .bal-panel{background:#FBFAF7;border:0.5px solid var(--line);border-radius:10px;padding:16px 18px;margin-top:4px}' +
            '#ap-mod .bal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px 18px}' +
            '#ap-mod .bal-cell .lbl{font-size:14.5px;color:var(--muted);margin-bottom:3px}' +
            '#ap-mod .bal-cell .val{font-size:17px;font-weight:500;color:var(--ink)}' +
            '#ap-mod .bal-after{margin-top:14px;padding-top:14px;border-top:0.5px solid var(--line);font-size:14px;color:var(--ink)}' +
            '#ap-mod .bal-after b{font-weight:500}' +
            '#ap-mod .bal-warn{color:var(--red)}' +
          '</style>' +

          '<div class="ap-tabs">' +
            '<button class="ap-tab active" id="apTabLeave"><i class="ti ti-beach"></i> Leave <span class="ap-badge" id="apCountLeave">0</span></button>' +
            '<button class="ap-tab" id="apTabCorr"><i class="ti ti-edit"></i> Corrections <span class="ap-badge" id="apCountCorr">0</span></button>' +
            '<button class="ap-tab" id="apTabDetail"><i class="ti ti-id"></i> Detail changes <span class="ap-badge" id="apCountDetail">0</span></button>' +
          '</div>' +

          '<div id="apPanelLeave" class="card">' +
            '<div class="card-head">' +
              '<div>' +
                '<h2 style="margin:0">Pending leave requests</h2>' +
                '<span class="meta">Approve or reject. The person and HR are notified.</span>' +
              '</div>' +
              '<span class="meta" id="lvMeta">\u2014</span>' +
            '</div>' +
            '<table class="fk-stack">' +
              '<thead><tr><th>Who</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th></th></tr></thead>' +
              '<tbody id="lvBody"><tr class="loading-row"><td colspan="6">Loading\u2026</td></tr></tbody>' +
            '</table>' +
          '</div>' +

          '<div id="apPanelCorr" class="card" style="display:none">' +
            '<div class="card-head">' +
              '<div>' +
                '<h2 style="margin:0">Pending attendance corrections</h2>' +
                '<span class="meta">Someone flagged a clock-in or clock-out as wrong. Approving fixes the record automatically.</span>' +
              '</div>' +
              '<span class="meta" id="regMeta">\u2014</span>' +
            '</div>' +
            '<table class="fk-stack">' +
              '<thead><tr><th>Who</th><th>Date</th><th>Reason</th><th>Times</th><th></th></tr></thead>' +
              '<tbody id="regBody"><tr class="loading-row"><td colspan="5">Loading\u2026</td></tr></tbody>' +
            '</table>' +
          '</div>' +

          '<div id="apPanelDetail" class="card" style="display:none">' +
            '<div class="card-head">' +
              '<div>' +
                '<h2 style="margin:0">Pending bank / tax changes</h2>' +
                '<span class="meta">Someone asked to change pay or tax details. Approving applies it; the person is notified either way.</span>' +
              '</div>' +
              '<span class="meta" id="dcMeta">\u2014</span>' +
            '</div>' +
            '<table class="fk-stack">' +
              '<thead><tr><th>Who</th><th>Change</th><th>Requested by</th><th></th></tr></thead>' +
              '<tbody id="dcBody"><tr class="loading-row"><td colspan="4">Loading\u2026</td></tr></tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
    },

    async mount(el, ctx) {
      const $ = (id) => el.querySelector('#' + id);
      const fullKey = (ctx && ctx.fullKey) || 'hr/approvals';
      const startTab = fullKey.indexOf('hr/regularisations') === 0 ? 'corr' : 'leave';
      const focusId = (ctx && ctx.params && ctx.params.userId)
        ? parseInt(ctx.params.userId, 10) : null;

      // ---- Tabs -------------------------------------------------------------
      function setTab(tab) {
        $('apPanelLeave').style.display = tab === 'leave' ? '' : 'none';
        $('apPanelCorr').style.display = tab === 'corr' ? '' : 'none';
        $('apPanelDetail').style.display = tab === 'detail' ? '' : 'none';
        $('apTabLeave').classList.toggle('active', tab === 'leave');
        $('apTabCorr').classList.toggle('active', tab === 'corr');
        $('apTabDetail').classList.toggle('active', tab === 'detail');
      }
      $('apTabLeave').addEventListener('click', () => setTab('leave'));
      $('apTabCorr').addEventListener('click', () => setTab('corr'));
      $('apTabDetail').addEventListener('click', () => setTab('detail'));

      // ---- Leave queue ------------------------------------------------------
      let requests_ = [];

      function balancePanel(lr) {
        const b = lr.balance;
        if (!b) return '';
        const req = Number(lr.total_days || 0);
        const after = Math.round((Number(b.remaining) - req) * 100) / 100;
        const negative = after < 0;
        const adjNote = b.adjustment_note ? ' <span style="color:var(--muted)">(' + escapeHtml(b.adjustment_note) + ')</span>' : '';
        return '<div class="bal-panel">' +
          '<div class="bal-grid">' +
            '<div class="bal-cell"><div class="lbl">Entitled</div><div class="val">' + fmtDays(b.annual) + '</div></div>' +
            '<div class="bal-cell"><div class="lbl">Carryover</div><div class="val">' + fmtDays(b.carryover) + '</div></div>' +
            '<div class="bal-cell"><div class="lbl">Used</div><div class="val">' + fmtDays(b.used) + '</div></div>' +
            '<div class="bal-cell"><div class="lbl">Pending</div><div class="val">' + fmtDays(b.pending) + '</div></div>' +
            '<div class="bal-cell"><div class="lbl">Adjustment</div><div class="val">' + (Number(b.adjustment) > 0 ? '+' : '') + fmtDays(b.adjustment) + adjNote + '</div></div>' +
            '<div class="bal-cell"><div class="lbl">Remaining now</div><div class="val">' + fmtDays(b.remaining) + ' days</div></div>' +
          '</div>' +
          '<div class="bal-after">This request is <b>' + fmtDays(req) + ' days</b>. ' +
            'If approved \u2192 <b' + (negative ? ' class="bal-warn"' : '') + '>' + fmtDays(after) + ' days left</b>.' +
            (negative ? ' <span class="bal-warn">This would put them into negative balance.</span>' : '') +
          '</div>' +
        '</div>';
      }

      function renderLeaveRows() {
        $('lvBody').innerHTML = requests_.map(lr => {
          const name = escapeHtml(lr.user_display_name || lr.user_full_name);
          const hasBal = lr.balance != null;
          const disclose = hasBal
            ? '<button class="disclose" data-bal="' + lr.id + '"><i class="ti ti-chevron-down"></i> Balance</button>'
            : '<span style="font-size:14.5px;color:var(--muted)">no balance</span>';
          return '' +
            '<tr class="lv-toprow" data-id="' + lr.id + '">' +
              '<td class="cell-head">' +
                '<div class="name-cell"><span class="avatar" style="background:' + (lr.user_avatar_colour || '#F1EFE8') + '">' + escapeHtml(lr.user_initials || '\u2014') + '</span>' +
                '<div><div class="nm" style="font-weight:500">' + name + '</div>' + disclose + '</div></div>' +
              '</td>' +
              '<td data-label="Type"><span class="chip">' + escapeHtml(lr.request_type || 'annual') + '</span></td>' +
              '<td data-label="Dates">' + fmtRange(lr.start_date, lr.end_date) + '</td>' +
              '<td data-label="Days">' + fmtDays(lr.total_days) + '</td>' +
              '<td class="cell-block" data-label="Reason" style="color:var(--muted);max-width:280px">' + escapeHtml(lr.reason || '\u2014') + '</td>' +
              '<td class="action-col">' +
                '<button class="ap-btn" data-reject="' + lr.id + '">Reject</button>' +
                '<button class="ap-btn ap-btn-primary" data-approve="' + lr.id + '">Approve</button>' +
              '</td>' +
            '</tr>' +
            '<tr class="bal-row" data-balrow="' + lr.id + '" style="display:none"><td colspan="6">' + balancePanel(lr) + '</td></tr>';
        }).join('');
      }

      function toggleBalance(id, forceOpen) {
        const row = el.querySelector('.bal-row[data-balrow="' + id + '"]');
        const btn = el.querySelector('.disclose[data-bal="' + id + '"]');
        if (!row) return;
        const open = forceOpen ? true : row.style.display === 'none';
        row.style.display = open ? '' : 'none';
        if (btn) btn.innerHTML = (open ? '<i class="ti ti-chevron-up"></i>' : '<i class="ti ti-chevron-down"></i>') + ' Balance';
      }

      async function loadLeave() {
        const tbody = $('lvBody');
        tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading\u2026</td></tr>';
        try {
          const r = await fetch('/api/leaves/pending', { credentials: 'include' });
          if (!r.ok) throw new Error('load failed');
          const data = await r.json();
          requests_ = data.requests || [];
          $('lvMeta').textContent = requests_.length + ' pending';
          $('apCountLeave').textContent = requests_.length;
          if (requests_.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--muted)">No pending leave requests.</td></tr>';
            return;
          }
          renderLeaveRows();
          if (focusId) {
            const tr = el.querySelector('.lv-toprow[data-id="' + focusId + '"]');
            if (tr) { toggleBalance(focusId, true); tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
          }
        } catch (err) {
          tbody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--red)">Failed to load.</td></tr>';
        }
      }

      async function decideLeave(id, decision) {
        let note = '';
        if (decision === 'rejected') {
          const entered = prompt('Reason for rejection (optional, but recommended):');
          if (entered === null) return; // cancelled — do not reject
          note = entered;
        }
        try {
          const r = await fetch('/api/leaves/' + id + '/decide', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ decision, decision_note: note })
          });
          if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
          loadLeave();
        } catch (e) { alert('Network error'); }
      }

      $('lvBody').addEventListener('click', (e) => {
        const bal = e.target.closest('[data-bal]');
        if (bal) { toggleBalance(parseInt(bal.getAttribute('data-bal'), 10)); return; }
        const ap = e.target.closest('[data-approve]');
        if (ap) { decideLeave(parseInt(ap.getAttribute('data-approve'), 10), 'approved'); return; }
        const rj = e.target.closest('[data-reject]');
        if (rj) { decideLeave(parseInt(rj.getAttribute('data-reject'), 10), 'rejected'); }
      });

      // ---- Corrections queue -----------------------------------------------
      async function loadCorr() {
        const tbody = $('regBody');
        tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Loading\u2026</td></tr>';
        try {
          const r = await fetch('/api/attendance/regularise/pending', { credentials: 'include' });
          if (!r.ok) throw new Error('load failed');
          const data = await r.json();
          const rows = data.requests || [];
          $('regMeta').textContent = rows.length + ' pending';
          $('apCountCorr').textContent = rows.length;
          if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:22px">All clear \u2014 no pending corrections.</td></tr>';
            return;
          }
          tbody.innerHTML = rows.map(row => {
            const times = (row.requested_first_login ? 'In: ' + fmtTime(row.requested_first_login) : '') +
              (row.requested_first_login && row.requested_last_logout ? ' \u00b7 ' : '') +
              (row.requested_last_logout ? 'Out: ' + fmtTime(row.requested_last_logout) : '') || '\u2014';
            return '<tr>' +
              '<td class="cell-head"><span class="nm">' + escapeHtml(row.full_name) + '</span></td>' +
              '<td data-label="Date">' + dateOnly(row.for_date) + '</td>' +
              '<td class="cell-block" data-label="Reason" style="color:var(--muted)">' + escapeHtml(row.reason) + '</td>' +
              '<td data-label="Times" style="color:var(--muted)">' + times + '</td>' +
              '<td class="action-col">' +
                '<button class="ap-btn ap-btn-danger" data-decide="' + row.id + '" data-action="deny">Deny</button>' +
                '<button class="ap-btn ap-btn-primary" data-decide="' + row.id + '" data-action="approve">Approve</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        } catch (err) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--red);padding:22px">Failed to load.</td></tr>';
        }
      }

      async function decideCorr(id, decision, note) {
        try {
          const r = await fetch('/api/attendance/regularise/' + id + '/decide', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ decision, note: note || null })
          });
          if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Action failed'); return; }
          loadCorr();
        } catch (e) { alert('Network error'); }
      }

      $('regBody').addEventListener('click', (e) => {
        const b = e.target.closest('[data-decide]');
        if (!b) return;
        const id = parseInt(b.getAttribute('data-decide'), 10);
        const action = b.getAttribute('data-action');
        if (action === 'deny') {
          const entered = prompt('Reason for denying (optional, but recommended):');
          if (entered === null) return; // cancelled — do not deny
          decideCorr(id, 'deny', entered);
        } else {
          decideCorr(id, action);
        }
      });

      // ---- Detail changes queue (bank / tax) -------------------------------
      const DC_LABELS = {
        bank_account_holder: 'Account holder', bank_name: 'Bank',
        bank_account_number: 'Account number', bank_ifsc: 'IFSC', pan: 'PAN',
      };
      async function loadDetail() {
        const tbody = $('dcBody');
        tbody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading\u2026</td></tr>';
        try {
          const r = await fetch('/api/profile/detail-changes/pending', { credentials: 'include' });
          if (!r.ok) throw new Error('load failed');
          const data = await r.json();
          const rows = data.requests || [];
          $('dcMeta').textContent = rows.length + ' pending';
          $('apCountDetail').textContent = rows.length;
          if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:22px">All clear \u2014 no pending changes.</td></tr>';
            return;
          }
          tbody.innerHTML = rows.map(row => {
            const chg = Object.keys(row.changes || {}).map(k => {
              const lbl = DC_LABELS[k] || k;
              const oldv = (row.current && row.current[k]) ? escapeHtml(String(row.current[k])) : '<span style="color:var(--muted)">empty</span>';
              const newv = escapeHtml(String(row.changes[k]));
              return '<div>' + lbl + ': ' + oldv + ' \u2192 <strong>' + newv + '</strong></div>';
            }).join('');
            return '<tr>' +
              '<td class="cell-head" style="font-weight:500">' + escapeHtml(row.user_name || '') + '</td>' +
              '<td class="cell-block" data-label="Change">' + chg + '</td>' +
              '<td data-label="Requested by" style="color:var(--muted)">' + escapeHtml(row.requested_by_name || '') + '</td>' +
              '<td class="action-col">' +
                '<button class="ap-btn ap-btn-danger" data-dc="' + row.id + '" data-action="reject">Deny</button>' +
                '<button class="ap-btn ap-btn-primary" data-dc="' + row.id + '" data-action="approve">Approve</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        } catch (err) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--red);padding:22px">Failed to load.</td></tr>';
        }
      }

      async function decideDetail(id, decision) {
        let note = null;
        if (decision === 'reject') {
          const entered = prompt('Reason for denying (optional, but recommended):');
          if (entered === null) return; // cancelled — do not deny
          note = entered;
        }
        try {
          const r = await fetch('/api/profile/detail-change/' + id + '/decide', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ decision, note })
          });
          if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Action failed'); return; }
          loadDetail();
        } catch (e) { alert('Network error'); }
      }

      $('dcBody').addEventListener('click', (e) => {
        const b = e.target.closest('[data-dc]');
        if (b) decideDetail(parseInt(b.getAttribute('data-dc'), 10), b.getAttribute('data-action'));
      });

      // ---- Boot -------------------------------------------------------------
      setTab(startTab);
      await Promise.all([loadLeave(), loadCorr(), loadDetail()]);
    }
  };

  window.fkModules['hr/approvals'] = approvals;
  window.fkModules['hr/leaves'] = approvals;
  window.fkModules['hr/regularisations'] = approvals;
})();
