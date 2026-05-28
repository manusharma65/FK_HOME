// FK Home — HR Insights module (r0.14, Ship 2)
// ----------------------------------------------------------------------------
// Migrated verbatim (behaviour-wise) from admin.html's Insights tab.
// Read-only. Three sections: people on probation, overdue tasks, onboarding
// in progress. Hits the existing GET /api/admin/insights — no backend change.
// Route: #hr/insights
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/insights'] = {
  title: 'Insights',

  render() {
    return '' +
      '<div class="card">' +
        '<div class="card-header">' +
          '<div class="card-title"><i class="ti ti-shield-check"></i> People on probation</div>' +
          '<span class="card-meta" id="insProbCount">—</span>' +
        '</div>' +
        '<div style="overflow-x:auto">' +
          '<table class="data-table" id="insProbTable" style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Person</th>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Status</th>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Hire date</th>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Probation ends</th>' +
              '<th></th>' +
            '</tr></thead>' +
            '<tbody id="insProbBody"><tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<div class="card" style="margin-top:14px">' +
        '<div class="card-header">' +
          '<div class="card-title"><i class="ti ti-alert-triangle"></i> Overdue tasks</div>' +
          '<span class="card-meta" id="insOverdueCount">—</span>' +
        '</div>' +
        '<div style="overflow-x:auto">' +
          '<table class="data-table" style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Task</th>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Assignee</th>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">About</th>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Days overdue</th>' +
              '<th></th>' +
            '</tr></thead>' +
            '<tbody id="insOverdueBody"><tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<div class="card" style="margin-top:14px">' +
        '<div class="card-header">' +
          '<div class="card-title"><i class="ti ti-progress"></i> Onboarding in progress</div>' +
          '<span class="card-meta" id="insOnbCount">—</span>' +
        '</div>' +
        '<div style="overflow-x:auto">' +
          '<table class="data-table" style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Person</th>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Hire date</th>' +
              '<th style="text-align:left;padding:8px 10px;font-size:13px;color:var(--muted)">Progress</th>' +
              '<th></th>' +
            '</tr></thead>' +
            '<tbody id="insOnbBody"><tr><td colspan="4" style="text-align:center;color:var(--muted);padding:18px">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  },

  async mount() {
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

    const probBody = document.getElementById('insProbBody');
    const overdueBody = document.getElementById('insOverdueBody');
    const onbBody = document.getElementById('insOnbBody');

    try {
      const r = await fetch('/api/admin/insights', { credentials: 'include' });
      if (!r.ok) {
        probBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--red);padding:18px">Permission denied or failed.</td></tr>';
        overdueBody.innerHTML = '';
        onbBody.innerHTML = '';
        return;
      }
      const d = await r.json();

      // Probation
      document.getElementById('insProbCount').textContent =
        d.probation.length + (d.probation.length === 1 ? ' person' : ' people');
      if (d.probation.length === 0) {
        probBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">No one on probation. 👍</td></tr>';
      } else {
        probBody.innerHTML = d.probation.map(p => {
          const colour = p.avatar_colour || '#888780';
          const statusMap = {
            'in_probation': { label: 'Probation', cls: 'amber' },
            'probation_pass_expected': { label: 'On track', cls: 'green' },
            'extended': { label: 'Extended', cls: 'amber' },
            'failed': { label: 'Failed', cls: 'red' },
          };
          const s = statusMap[p.probation_status] || { label: p.probation_status, cls: '' };
          let endLbl = '—';
          if (p.probation_end_date) {
            const end = fmtDate(p.probation_end_date);
            const days = p.days_past_end_date;
            if (days != null && days > 0) {
              endLbl = end + ' <span style="color:var(--red);font-size:12px">(' + days + ' day' + (days === 1 ? '' : 's') + ' ago)</span>';
            } else if (days != null && days >= -7) {
              endLbl = end + ' <span style="color:var(--amber-deep);font-size:12px">(in ' + (-days) + ' day' + (days === -1 ? '' : 's') + ')</span>';
            } else {
              endLbl = end;
            }
          }
          return '<tr style="cursor:pointer;border-top:0.5px solid var(--line)" onclick="location.href=\'/profile.html?id=' + p.id + '\'">' +
            '<td style="padding:8px 10px"><div style="display:flex;gap:10px;align-items:center">' +
              '<span style="width:28px;height:28px;border-radius:50%;background:' + colour + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500">' + esc(p.initials || '') + '</span>' +
              '<span>' + esc(p.display_name || p.full_name) + '</span>' +
            '</div></td>' +
            '<td style="padding:8px 10px"><span class="chip ' + s.cls + '">' + esc(s.label) + '</span></td>' +
            '<td style="padding:8px 10px;color:var(--muted)">' + fmtDate(p.hire_date) + '</td>' +
            '<td style="padding:8px 10px">' + endLbl + '</td>' +
            '<td style="padding:8px 10px;text-align:right"><button class="btn" onclick="event.stopPropagation();location.href=\'/profile.html?id=' + p.id + '\'">View</button></td>' +
          '</tr>';
        }).join('');
      }

      // Overdue tasks
      document.getElementById('insOverdueCount').textContent =
        d.overdue_tasks.length + (d.overdue_tasks.length === 1 ? ' task' : ' tasks');
      if (d.overdue_tasks.length === 0) {
        overdueBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">No overdue tasks. 🎉</td></tr>';
      } else {
        overdueBody.innerHTML = d.overdue_tasks.map(t => {
          const assigneeName = t.assignee_display_name || t.assignee_full_name || '—';
          const relatedName = t.related_display_name || t.related_full_name || '—';
          const colour = t.assignee_avatar_colour || '#888780';
          const days = t.days_overdue || 0;
          return '<tr style="border-top:0.5px solid var(--line)">' +
            '<td style="padding:8px 10px;font-weight:500">' + esc(t.title) +
              (t.reason === 'orchestrator' ? ' <span style="font-size:11px;color:var(--muted)">(orchestrator)</span>' : '') + '</td>' +
            '<td style="padding:8px 10px"><div style="display:flex;gap:8px;align-items:center">' +
              '<span style="width:22px;height:22px;border-radius:50%;background:' + colour + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500">' + esc(t.assignee_initials || '') + '</span>' +
              '<span>' + esc(assigneeName) + '</span>' +
            '</div></td>' +
            '<td style="padding:8px 10px"><span style="color:var(--muted);font-size:13px">' + esc(relatedName) + '</span></td>' +
            '<td style="padding:8px 10px"><span style="color:var(--red);font-weight:500">' + days + ' day' + (days === 1 ? '' : 's') + '</span></td>' +
            '<td style="padding:8px 10px;text-align:right"><button class="btn" onclick="location.href=\'/profile.html?id=' + t.related_user_id + '#reviews\'">Open</button></td>' +
          '</tr>';
        }).join('');
      }

      // Onboarding in progress
      document.getElementById('insOnbCount').textContent =
        d.onboarding.length + (d.onboarding.length === 1 ? ' person' : ' people');
      if (d.onboarding.length === 0) {
        onbBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:18px">All caught up — no incomplete onboarding.</td></tr>';
      } else {
        onbBody.innerHTML = d.onboarding.map(o => {
          const colour = o.avatar_colour || '#888780';
          const pct = o.total_items > 0 ? Math.round(o.done_items * 100 / o.total_items) : 0;
          return '<tr style="cursor:pointer;border-top:0.5px solid var(--line)" onclick="location.href=\'/profile.html?id=' + o.id + '#onboarding\'">' +
            '<td style="padding:8px 10px"><div style="display:flex;gap:10px;align-items:center">' +
              '<span style="width:28px;height:28px;border-radius:50%;background:' + colour + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500">' + esc(o.initials || '') + '</span>' +
              '<span>' + esc(o.display_name || o.full_name) + '</span>' +
            '</div></td>' +
            '<td style="padding:8px 10px;color:var(--muted)">' + fmtDate(o.hire_date) + '</td>' +
            '<td style="padding:8px 10px"><div style="display:flex;align-items:center;gap:10px">' +
              '<div style="width:120px;height:8px;background:var(--line);border-radius:99px;overflow:hidden">' +
                '<div style="height:100%;width:' + pct + '%;background:#3B6D11"></div>' +
              '</div>' +
              '<span style="font-size:12px;color:var(--muted)">' + o.done_items + '/' + o.total_items + '</span>' +
            '</div></td>' +
            '<td style="padding:8px 10px;text-align:right"><button class="btn" onclick="event.stopPropagation();location.href=\'/profile.html?id=' + o.id + '#onboarding\'">Open</button></td>' +
          '</tr>';
        }).join('');
      }
    } catch (e) {
      console.error('[fkModules hr/insights]', e);
      probBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--red);padding:18px">Failed to load.</td></tr>';
    }
  },

  unmount() { /* read-only, nothing to clean up */ }
};
