// FK Home — Backups module (r0.17, Ship A) — owner-only
// ----------------------------------------------------------------------------
// Migrates admin.html#backups into the shell. Endpoints unchanged:
//   GET  /api/admin/backups                 list + diag
//   GET  /api/admin/backups/health          health pill
//   POST /api/admin/backups/run             run now
//   GET  /api/admin/backups/download-latest stream download
//
// runBackupNow polls for ~45s. We guard polling with an `alive` flag so that
// if the user navigates away mid-run, unmount stops the loop (no setState on a
// detached DOM, no leaked timer).
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['system/backups'] = {
  title: 'Backups',
  _alive: false,

  render() {
    return '' +
      '<div id="bak-mod" class="fk-mod">' +
        '<div class="card">' +
          '<div class="card-head">' +
            '<h2 style="margin:0">Backups</h2>' +
            '<div style="display:flex;gap:8px;align-items:center">' +
              '<span class="meta" id="bakHealth">—</span>' +
              '<button class="btn" id="bakDownloadBtn"><i class="ti ti-download"></i> Download latest</button>' +
              '<button class="btn btn-primary" id="bakRunBtn"><i class="ti ti-cloud-upload"></i> Run backup now</button>' +
            '</div>' +
          '</div>' +
          '<div style="padding:12px 18px;background:#FBFAF7;border-bottom:0.5px solid var(--line);font-size:13px;color:var(--muted)">' +
            '<i class="ti ti-info-circle" style="font-size:14px;vertical-align:-2px;margin-right:4px"></i>' +
            'Nightly backup runs at 02:00 London. Off-site copy lives in Backblaze B2. Manual run takes ~30s.' +
          '</div>' +
          '<div id="bakDiag" style="padding:10px 18px;display:none;background:#FFF5E5;border-bottom:0.5px solid var(--line);font-size:13px;color:#9A5B1F">' +
            '<i class="ti ti-alert-triangle" style="font-size:14px;vertical-align:-2px;margin-right:4px"></i>' +
            '<span id="bakDiagText"></span>' +
          '</div>' +
          '<table>' +
            '<thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Size</th><th>Duration</th><th>Object key</th></tr></thead>' +
            '<tbody id="bakBody"><tr class="loading-row"><td colspan="6">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);
    const self = this;
    self._alive = true;

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function backupRow(b) {
      const startedFmt = b.started_at
        ? new Date(b.started_at).toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';
      let statusHtml;
      if (b.status === 'success') statusHtml = '<span style="color:#1D9E75;font-weight:500">● success</span>';
      else if (b.status === 'failed') statusHtml = '<span style="color:#C0392B;font-weight:500" title="' + escapeHtml(b.error_message || '') + '">● failed</span>';
      else statusHtml = '<span style="color:#888">● running</span>';
      const sizeMb = b.size_bytes ? (b.size_bytes / 1024 / 1024).toFixed(2) + ' MB' : '—';
      const dur = b.duration_ms ? (b.duration_ms / 1000).toFixed(1) + 's' : '—';
      const trig = b.trigger === 'manual' ? '<span class="chip">manual</span>' : '<span class="chip" style="background:#EDEDE6">cron</span>';
      const key = b.object_key ? '<span style="font-family:ui-monospace,monospace;font-size:12px">' + escapeHtml(b.object_key) + '</span>' : '—';
      return '<tr><td>' + startedFmt + '</td><td>' + trig + '</td><td>' + statusHtml + '</td><td>' + sizeMb + '</td><td>' + dur + '</td><td>' + key + '</td></tr>';
    }

    async function load() {
      const body = $('bakBody');
      if (!body) return; // module unmounted
      body.innerHTML = '<tr class="loading-row"><td colspan="6">Loading…</td></tr>';
      try {
        const r = await fetch('/api/admin/backups', { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const data = await r.json();
        if (!self._alive) return;

        try {
          const h = await fetch('/api/admin/backups/health', { credentials: 'include' }).then(x => x.ok ? x.json() : null);
          const elH = $('bakHealth');
          if (elH) {
            if (!h) elH.textContent = '—';
            else if (h.status === 'healthy') elH.innerHTML = '<span style="color:#1D9E75">● Healthy</span> · last ' + (h.hours_since != null ? h.hours_since + 'h ago' : '—');
            else if (h.status === 'stale') elH.innerHTML = '<span style="color:#C58A1F">● Stale</span> · last ' + (h.hours_since != null ? h.hours_since + 'h ago' : '—');
            else elH.innerHTML = '<span style="color:#C0392B">● Missing</span> · ' + (h.last_success_at ? (h.hours_since + 'h ago') : 'no backup yet');
          }
        } catch (_) {}

        const diag = data.diag || {};
        const missing = Object.entries(diag).filter(([k, v]) => v === 'MISSING').map(([k]) => k);
        if (missing.length > 0 && $('bakDiag')) {
          $('bakDiag').style.display = '';
          $('bakDiagText').textContent = 'Backup environment variables not set on Railway: ' + missing.join(', ') + '. Backups will fail until these are filled in.';
        }

        const rows = data.backups || [];
        if (!$('bakBody')) return;
        if (rows.length === 0) {
          $('bakBody').innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--muted)">No backups yet. Click "Run backup now" to create the first one.</td></tr>';
          return;
        }
        $('bakBody').innerHTML = rows.map(backupRow).join('');
      } catch (err) {
        if ($('bakBody')) $('bakBody').innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--red)">Failed to load backups.</td></tr>';
      }
    }

    $('bakDownloadBtn').addEventListener('click', () => {
      window.location.href = '/api/admin/backups/download-latest';
    });

    $('bakRunBtn').addEventListener('click', async () => {
      const btn = $('bakRunBtn');
      btn.disabled = true;
      btn.innerHTML = '<i class="ti ti-loader"></i> Starting…';
      try {
        const r = await fetch('/api/admin/backups/run', { method: 'POST', credentials: 'include' });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          alert(data.error || 'Failed to start backup');
        } else {
          btn.innerHTML = '<i class="ti ti-loader"></i> Running…';
          for (let i = 0; i < 15; i++) {
            await new Promise(res => setTimeout(res, 3000));
            if (!self._alive) return; // navigated away — stop polling
            await load();
          }
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        const b = $('bakRunBtn');
        if (b && self._alive) { b.disabled = false; b.innerHTML = '<i class="ti ti-cloud-upload"></i> Run backup now'; }
      }
    });

    await load();
  },

  unmount() {
    this._alive = false;
  }
};
