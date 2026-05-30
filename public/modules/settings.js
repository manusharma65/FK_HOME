// FK Home — Settings module (r0.17, Ship A)
// ----------------------------------------------------------------------------
// Migrates admin.html#settings into the shell. Endpoints unchanged:
//   GET  /api/admin/break                       team break
//   PUT  ... (break saved via /api/admin/break)
//   GET  /api/admin/settings                    review-cycle settings (HR/owner)
//   PUT  /api/admin/settings/:key               save a setting
//   POST /api/admin/backfill/review-schedules   one-off backfill
//
// The review + backfill cards reveal only when /api/admin/settings returns OK
// (same permission gate as admin.html today).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['system/settings'] = {
  title: 'Settings',

  render() {
    return '' +
      '<div id="set-mod" class="fk-mod">' +
        '<div class="card">' +
          '<div class="card-head"><h2 style="margin:0">Team break</h2></div>' +
          '<div style="padding:18px">' +
            '<form id="breakForm" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:480px">' +
              '<div>' +
                '<label style="font-size:15px;color:var(--muted)">Start time</label>' +
                '<input type="time" id="breakStart" style="width:100%;padding:10px 12px;border:0.5px solid var(--line);border-radius:9px" />' +
              '</div>' +
              '<div>' +
                '<label style="font-size:15px;color:var(--muted)">Duration (minutes)</label>' +
                '<input type="number" id="breakDuration" min="1" max="240" style="width:100%;padding:10px 12px;border:0.5px solid var(--line);border-radius:9px" />' +
              '</div>' +
              '<button type="submit" class="btn btn-primary" style="grid-column:1 / -1">Save break time</button>' +
            '</form>' +
          '</div>' +
        '</div>' +

        '<div class="card" id="setReviewCard" style="display:none">' +
          '<div class="card-head"><h2 style="margin:0">Review cycle settings</h2></div>' +
          '<div style="padding:18px;max-width:480px">' +
            '<p style="font-size:14px;color:var(--muted);margin:0 0 14px">These control how the system schedules and chases reviews. Changes apply on the next daily 06:00 task tick.</p>' +
            '<form id="reviewSettingsForm" style="display:grid;gap:12px">' +
              '<div><label style="font-size:14px;color:var(--muted)">Days before due date the task opens</label>' +
                '<input type="number" id="setReviewOpen" min="1" max="30" style="width:120px;padding:8px 11px;border:0.5px solid var(--line);border-radius:8px" /></div>' +
              '<div><label style="font-size:14px;color:var(--muted)">Days after due before going overdue (red)</label>' +
                '<input type="number" id="setReviewGrace" min="0" max="30" style="width:120px;padding:8px 11px;border:0.5px solid var(--line);border-radius:8px" /></div>' +
              '<div><label style="font-size:14px;color:var(--muted)">Days between overdue re-nudges</label>' +
                '<input type="number" id="setReviewNudge" min="1" max="30" style="width:120px;padding:8px 11px;border:0.5px solid var(--line);border-radius:8px" /></div>' +
              '<button type="submit" class="btn btn-primary" style="width:200px">Save review settings</button>' +
            '</form>' +
          '</div>' +
        '</div>' +

        '<div class="card" id="setBackfillCard" style="display:none">' +
          '<div class="card-head"><h2 style="margin:0">Backfill review schedules</h2></div>' +
          '<div style="padding:18px;max-width:600px">' +
            '<p style="font-size:14px;color:var(--muted);margin:0 0 14px">Run this <strong>once</strong> after filling in hire dates for existing employees in the Employment tab. For every active user with a hire date, the system generates their 1-month, 4-month, 8-month, and annual review schedule. Reviewers get a notification. This is idempotent — re-running it won\'t duplicate existing review records.</p>' +
            '<button class="btn btn-primary" id="setBackfillBtn">Generate review schedules now</button>' +
            '<div id="setBackfillResult" style="margin-top:14px;font-size:14px;color:var(--ink)"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);

    async function load() {
      try {
        const r = await fetch('/api/admin/break', { credentials: 'include' });
        if (r.ok) {
          const data = await r.json();
          if (data.break) {
            $('breakStart').value = data.break.start_time.slice(0, 5);
            $('breakDuration').value = data.break.duration_minutes;
          }
        }
        const settingsR = await fetch('/api/admin/settings', { credentials: 'include' });
        if (settingsR.ok) {
          $('setReviewCard').style.display = '';
          $('setBackfillCard').style.display = '';
          const sd = await settingsR.json();
          const map = {};
          for (const row of (sd.settings || [])) {
            map[row.key] = typeof row.value === 'number' ? row.value : Number(row.value);
          }
          if ($('setReviewOpen')) $('setReviewOpen').value = map.review_open_window_days || 7;
          if ($('setReviewGrace')) $('setReviewGrace').value = map.review_grace_days || 3;
          if ($('setReviewNudge')) $('setReviewNudge').value = map.review_nudge_interval_days || 7;
        }
      } catch (err) {}
    }

    $('breakForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        start_time: $('breakStart').value,
        duration_minutes: parseInt($('breakDuration').value, 10)
      };
      try {
        const r = await fetch('/api/admin/break', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(body)
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed to save break time'); return; }
        alert('Break time saved.');
      } catch (e2) { alert('Network error'); }
    });

    $('reviewSettingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const updates = {
        review_open_window_days: parseInt($('setReviewOpen').value, 10),
        review_grace_days: parseInt($('setReviewGrace').value, 10),
        review_nudge_interval_days: parseInt($('setReviewNudge').value, 10)
      };
      try {
        for (const [k, v] of Object.entries(updates)) {
          if (!Number.isFinite(v)) continue;
          const r = await fetch('/api/admin/settings/' + encodeURIComponent(k), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ value: v })
          });
          if (!r.ok) { const d = await r.json().catch(() => ({})); return alert('Failed to save ' + k + ': ' + (d.error || 'unknown')); }
        }
        alert('Review settings saved.');
      } catch (e2) { alert('Failed'); }
    });

    $('setBackfillBtn').addEventListener('click', async () => {
      if (!confirm('Generate review schedules for all active employees with hire dates set?\n\nThis is safe to run multiple times — it skips users who already have schedules.')) return;
      const btn = $('setBackfillBtn');
      const result = $('setBackfillResult');
      btn.disabled = true; btn.textContent = 'Running…'; result.textContent = '';
      try {
        const r = await fetch('/api/admin/backfill/review-schedules', { method: 'POST', credentials: 'include' });
        const d = await r.json();
        if (!r.ok) {
          result.innerHTML = '<span style="color:var(--red)">' + (d.error || 'Failed') + '</span>';
        } else {
          result.innerHTML = '<span style="color:var(--green)">Done. Processed ' + d.users_processed +
            ' users, created ' + d.reviews_created + ' review records (' + d.users_with_new_reviews + ' users had new reviews scheduled).</span>';
        }
      } catch (e2) {
        result.innerHTML = '<span style="color:var(--red)">Network error.</span>';
      }
      btn.disabled = false; btn.textContent = 'Generate review schedules now';
    });

    await load();
  }
};
