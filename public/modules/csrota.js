// FK Home — CS Rota module (r0.17, Ship A)
// ----------------------------------------------------------------------------
// Migrates admin.html#csrota into the shell. Endpoints unchanged:
//   GET  /api/attendance/cs-rota/template   download CSV template
//   POST /api/attendance/cs-rota            upload { csv }
//   GET  /api/attendance/cs-rota/current    current rota for grid
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['system/csrota'] = {
  title: 'CS rota',

  render() {
    return '' +
      '<div id="rota-mod" class="fk-mod">' +
        '<div class="card" style="margin-bottom:16px">' +
          '<div class="card-head">' +
            '<div>' +
              '<h2 style="margin:0">Customer Service rota</h2>' +
              '<span class="meta">Upload the next 4-week rota. CSV format below.</span>' +
            '</div>' +
          '</div>' +
          '<div style="padding:18px">' +
            '<div style="margin-bottom:16px">' +
              '<button class="btn" id="rotaTemplateBtn"><i class="ti ti-download"></i> Download template</button>' +
              '<span class="meta" style="margin-left:10px;font-size:14px;color:var(--muted)">CSV with rows per agent, columns per date, cells = Working / Off / Leave</span>' +
            '</div>' +
            '<form id="rotaUploadForm" style="border:1px dashed var(--line-strong);border-radius:10px;padding:18px;text-align:center;background:#FBFAF7">' +
              '<label style="display:block;font-size:15px;color:var(--muted);margin-bottom:8px">Upload CSV</label>' +
              '<input type="file" id="rotaFile" accept=".csv" style="margin:0 auto 12px;display:block" />' +
              '<button type="submit" class="btn btn-primary">Upload rota</button>' +
            '</form>' +
            '<div id="rotaResult" style="margin-top:14px;font-size:15px;color:var(--muted)"></div>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-head">' +
            '<h2 style="margin:0">Current rota</h2>' +
            '<span class="meta" id="rotaCurrentMeta">—</span>' +
          '</div>' +
          '<div style="padding:18px;overflow-x:auto" id="rotaCurrentBody">' +
            '<p class="loading-row" style="text-align:center;color:var(--muted);font-size:15px;padding:18px">Loading…</p>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  async mount(el) {
    const $ = (id) => el.querySelector('#' + id);

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function dateOnly(v) {
      if (!v) return '';
      var s = String(v);
      var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[3] + '/' + m[2] + '/' + m[1];
      var d = new Date(s);
      return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB');
    }

    async function downloadTemplate() {
      try {
        const r = await fetch('/api/attendance/cs-rota/template', { credentials: 'include' });
        if (!r.ok) { alert('Template download failed'); return; }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'cs-rota-template.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) { alert('Network error'); }
    }

    async function loadCurrent() {
      const box = $('rotaCurrentBody');
      box.innerHTML = '<p style="text-align:center;color:var(--muted);font-size:15px;padding:18px">Loading…</p>';
      try {
        const r = await fetch('/api/attendance/cs-rota/current', { credentials: 'include' });
        if (!r.ok) {
          box.innerHTML = '<p style="text-align:center;color:var(--muted);font-size:15px;padding:18px">No rota uploaded yet.</p>';
          return;
        }
        const d = await r.json();
        if (!d.rota || !d.entries || d.entries.length === 0) {
          box.innerHTML = '<p style="text-align:center;color:var(--muted);font-size:15px;padding:18px">No current rota.</p>';
          $('rotaCurrentMeta').textContent = '—';
          return;
        }
        $('rotaCurrentMeta').textContent =
          dateOnly(d.rota.start_date) + ' → ' + dateOnly(d.rota.end_date) + ' · uploaded ' +
          new Date(d.rota.uploaded_at).toLocaleDateString('en-GB');
        const userMap = {}, dateSet = new Set();
        for (const e of d.entries) {
          const dt = dateOnly(e.entry_date);
          if (!userMap[e.full_name]) userMap[e.full_name] = {};
          userMap[e.full_name][dt] = e.status;
          dateSet.add(dt);
        }
        const dates = Array.from(dateSet).sort();
        let html = '<table style="font-size:14px"><thead><tr><th>Agent</th>';
        for (const dt of dates) {
          const day = new Date(dt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
          html += '<th style="text-align:center;text-transform:none;letter-spacing:0">' + day + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (const name of Object.keys(userMap).sort()) {
          html += '<tr><td><span class="nm">' + escapeHtml(name) + '</span></td>';
          for (const dt of dates) {
            const v = userMap[name][dt] || '—';
            let cls = 'muted';
            if (v === 'working') cls = 'green';
            else if (v === 'leave') cls = 'amber';
            const label = v === 'working' ? 'W' : v === 'off' ? '—' : v === 'leave' ? 'L' : v[0].toUpperCase();
            html += '<td style="text-align:center"><span class="chip ' + cls + '" style="margin:0">' + label + '</span></td>';
          }
          html += '</tr>';
        }
        html += '</tbody></table>';
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<p style="text-align:center;color:var(--red);font-size:15px;padding:18px">Failed to load.</p>';
      }
    }

    $('rotaTemplateBtn').addEventListener('click', downloadTemplate);
    $('rotaUploadForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = $('rotaFile').files[0];
      const res = $('rotaResult');
      if (!file) { res.textContent = 'Pick a CSV file first.'; res.style.color = 'var(--red)'; return; }
      res.textContent = 'Uploading…'; res.style.color = 'var(--muted)';
      try {
        const text = await file.text();
        const r = await fetch('/api/attendance/cs-rota', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ csv: text })
        });
        const d = await r.json();
        if (!r.ok) { res.textContent = d.error || 'Upload failed'; res.style.color = 'var(--red)'; return; }
        res.textContent = 'Uploaded. ' + (d.entries || 0) + ' rota entries saved · ' + (d.start || '?') + ' → ' + (d.end || '?') + '.';
        res.style.color = 'var(--green)';
        $('rotaFile').value = '';
        loadCurrent();
      } catch (err) { res.textContent = 'Network error'; res.style.color = 'var(--red)'; }
    });

    await loadCurrent();
  }
};
