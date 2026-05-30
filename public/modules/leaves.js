// FK Home — Leaves module (r0.19, Ship C)
// ----------------------------------------------------------------------------
// Migrates admin.html#leaves into the shell + NEW: expandable per-row balance
// panel so the approver sees the requester's balance (and what they'd have left
// if approved) right on the request — no clicking away.
//   GET  /api/leaves/pending      now returns balance per row (engine-backed)
//   POST /api/leaves/:id/decide   approve/reject (reject prompts for a note)
//
// Balance object (from leaveEngine.getBalance): annual, carryover, used,
// pending, adjustment, remaining, adjustment_note.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/leaves'] = {
  title: 'Leaves',

  render() {
    return '' +
      '<div id="lv-mod" class="fk-mod">' +
        '<style>' +
          '#lv-mod .avatar{width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#3a3a36;flex-shrink:0}' +
          '#lv-mod .name-cell{display:flex;align-items:center;gap:10px}' +
          '#lv-mod .lv-toprow td{border-bottom:none;padding-bottom:6px}' +
          '#lv-mod .bal-row td{padding:0 0 14px;border-bottom:0.5px solid var(--line)}' +
          '#lv-mod .bal-panel{background:#FBFAF7;border:0.5px solid var(--line);border-radius:10px;padding:14px 16px;margin-top:2px}' +
          '#lv-mod .bal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px 18px}' +
          '#lv-mod .bal-cell .lbl{font-size:12px;color:var(--muted);margin-bottom:2px}' +
          '#lv-mod .bal-cell .val{font-size:16px;font-weight:500;color:var(--ink)}' +
          '#lv-mod .bal-after{margin-top:12px;padding-top:12px;border-top:0.5px solid var(--line);font-size:14px;color:var(--ink)}' +
          '#lv-mod .bal-after b{font-weight:500}' +
          '#lv-mod .bal-warn{color:var(--red)}' +
          '#lv-mod .disclose{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:4px;padding:0}' +
          '#lv-mod .disclose:hover{color:var(--ink)}' +
        '</style>' +

        '<div class="card">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Pending leave requests</h2>' +
              '<span class="meta">Approve or reject. The person and HR are notified.</span>' +
            '</div>' +
            '<span class="meta" id="lvMeta">—</span>' +
          '</div>' +
          '<table>' +
            '<thead><tr><th>Who</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th></th></tr></thead>' +
            '<tbody id="lvBody"><tr class="loading-row"><td colspan="6">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  },

  async mount(el, ctx) {
    const $ = (id) => el.querySelector('#' + id);
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
      return s === e ? sd : sd + ' → ' + ed;
    }

    let requests_ = [];
    // Optional deep-link: ctx.params.userId carries a focus request id from a
    // leave notification (#hr/leaves/<requestId>). We expand that row's balance.
    const focusId = ctx && ctx.params && ctx.params.userId ? parseInt(ctx.params.userId, 10) : null;

    async function load() {
      const tbody = $('lvBody');
      tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading…</td></tr>';
      try {
        const r = await fetch('/api/leaves/pending', { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const data = await r.json();
        requests_ = data.requests || [];
        $('lvMeta').textContent = requests_.length + ' pending';
        if (requests_.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--muted)">No pending leave requests.</td></tr>';
          return;
        }
        renderRows();
        if (focusId) {
          const tr = el.querySelector('.lv-toprow[data-id="' + focusId + '"]');
          if (tr) { toggleBalance(focusId, true); tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        }
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--red)">Failed to load.</td></tr>';
      }
    }

    function renderRows() {
      $('lvBody').innerHTML = requests_.map(lr => {
        const name = escapeHtml(lr.user_display_name || lr.user_full_name);
        const hasBal = lr.balance != null;
        const disclose = hasBal
          ? '<button class="disclose" data-bal="' + lr.id + '"><i class="ti ti-chevron-down"></i> Balance</button>'
          : '<span style="font-size:12px;color:var(--muted)">no balance</span>';
        return '' +
          '<tr class="lv-toprow" data-id="' + lr.id + '">' +
            '<td>' +
              '<div class="name-cell"><span class="avatar" style="background:' + (lr.user_avatar_colour || '#F1EFE8') + '">' + escapeHtml(lr.user_initials || '—') + '</span>' +
              '<div><div class="nm" style="font-weight:500">' + name + '</div>' + disclose + '</div></div>' +
            '</td>' +
            '<td><span class="chip">' + escapeHtml(lr.request_type || 'annual') + '</span></td>' +
            '<td>' + fmtRange(lr.start_date, lr.end_date) + '</td>' +
            '<td>' + fmtDays(lr.total_days) + '</td>' +
            '<td style="color:var(--muted);max-width:280px">' + escapeHtml(lr.reason || '—') + '</td>' +
            '<td class="action-col">' +
              '<button class="btn" data-reject="' + lr.id + '">Reject</button> ' +
              '<button class="btn btn-primary" data-approve="' + lr.id + '">Approve</button>' +
            '</td>' +
          '</tr>' +
          '<tr class="bal-row" data-balrow="' + lr.id + '" style="display:none"><td colspan="6">' + balancePanel(lr) + '</td></tr>';
      }).join('');
    }

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
          'If approved → <b' + (negative ? ' class="bal-warn"' : '') + '>' + fmtDays(after) + ' days left</b>.' +
          (negative ? ' <span class="bal-warn">This would put them into negative balance.</span>' : '') +
        '</div>' +
      '</div>';
    }

    function toggleBalance(id, forceOpen) {
      const row = el.querySelector('.bal-row[data-balrow="' + id + '"]');
      const btn = el.querySelector('.disclose[data-bal="' + id + '"]');
      if (!row) return;
      const open = forceOpen ? true : row.style.display === 'none';
      row.style.display = open ? '' : 'none';
      if (btn) btn.innerHTML = (open ? '<i class="ti ti-chevron-up"></i>' : '<i class="ti ti-chevron-down"></i>') + ' Balance';
    }

    async function decide(id, decision) {
      let note = '';
      if (decision === 'rejected') note = prompt('Reason for rejection (optional, but recommended):') || '';
      try {
        const r = await fetch('/api/leaves/' + id + '/decide', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ decision, decision_note: note })
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        load();
      } catch (e) { alert('Network error'); }
    }

    $('lvBody').addEventListener('click', (e) => {
      const bal = e.target.closest('[data-bal]');
      if (bal) { toggleBalance(parseInt(bal.getAttribute('data-bal'), 10)); return; }
      const ap = e.target.closest('[data-approve]');
      if (ap) { decide(parseInt(ap.getAttribute('data-approve'), 10), 'approved'); return; }
      const rj = e.target.closest('[data-reject]');
      if (rj) { decide(parseInt(rj.getAttribute('data-reject'), 10), 'rejected'); }
    });

    await load();
  }
};
