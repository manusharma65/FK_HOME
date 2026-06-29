window.fkModules = window.fkModules || {};

window.fkModules['cs_dashboard'] = {
  title: 'CS Operational Dashboard',
  noHero: true,

  render() {
    return `
<div id="cs-dash-mod" class="fk-mod">
  <style>
    #cs-dash-mod { flex:1; min-width:0; display:flex; font-family:var(--body,'Hanken Grotesk',-apple-system,sans-serif); color:#2B2017; background:var(--canvas,#F4EFE7); }
    #cs-dash-mod h1, #cs-dash-mod h2, #cs-dash-mod h3 { font-family:var(--disp,'Fraunces'),Georgia,serif; letter-spacing:-.01em; margin:0; }
    #cs-dash-mod * { box-sizing:border-box; }

    .dash-wrap { flex:1; display:flex; flex-direction:column; border:1px solid #E6DED0; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(36,31,27,.05); background:#fff; }

    /* Main area */
    .dash-main { display:flex; flex-direction:column; min-width:0; overflow-y:auto; background:#F4EFE7; padding:24px; gap:20px; }
    .dash-header { display:flex; align-items:flex-start; justify-content:space-between; }
    .dash-header-meta { font-size:12px; color:#9b8e7d; background:#fff; border:1px solid #E6DED0; border-radius:8px; padding:6px 12px; }

    /* Filter Bar */
    .filter-bar { background:#fff; border:1px solid #E6DED0; border-radius:12px; padding:14px 16px; display:flex; align-items:center; flex-wrap:wrap; gap:12px; }
    .filter-bar-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#9b8e7d; white-space:nowrap; }
    .filter-group { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .filter-sep { width:1px; height:28px; background:#E6DED0; margin:0 4px; }
    .duration-btn { font-size:12px; font-weight:600; padding:5px 12px; border-radius:8px; border:1px solid #E6DED0; background:#FBFAF7; color:#5b5249; cursor:pointer; transition:all .15s; white-space:nowrap; }
    .duration-btn:hover { background:#EFE7D8; border-color:#D4C9B8; }
    .duration-btn.active { background:linear-gradient(135deg,#F3992E,#E8722B); color:#fff; border-color:transparent; }
    .date-input { font-size:12px; font-weight:500; padding:5px 10px; border-radius:8px; border:1px solid #E6DED0; background:#FBFAF7; color:#2B2017; cursor:pointer; outline:none; font-family:inherit; transition:border-color .15s; }
    .date-input:focus { border-color:#E8722B; box-shadow:0 0 0 2px rgba(232,114,43,.12); }
    .filter-apply-btn { font-size:12px; font-weight:600; padding:5px 14px; border-radius:8px; border:none; background:#E8722B; color:#fff; cursor:pointer; transition:opacity .15s; margin-left:auto; }
    .filter-apply-btn:hover { opacity:.88; }
    .filter-active-tag { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; padding:3px 9px; border-radius:20px; background:rgba(232,114,43,.12); color:#B55A10; border:1px solid rgba(232,114,43,.2); }
    .filter-active-tag .close { cursor:pointer; font-size:13px; line-height:1; color:#E8722B; }

    /* KPI Cards */
    .telemetry-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; }
    .telemetry-card { background:#fff; border:1px solid #E6DED0; border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:6px; position:relative; overflow:hidden; }
    .telemetry-card::after { content:''; position:absolute; bottom:0; left:0; right:0; height:3px; background:var(--accent,#E8722B); }
    .telemetry-card .lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#9b8e7d; }
    .telemetry-card .val { font-size:28px; font-weight:700; color:#2B2017; font-family:var(--disp,'Fraunces'),Georgia,serif; line-height:1.1; }
    .telemetry-card .trend { font-size:11px; font-weight:600; display:flex; align-items:center; gap:4px; }
    .trend.pos { color:#0F6E56; } .trend.neg { color:#A32D2D; } .trend.neu { color:#9b8e7d; }

    /* Charts row */
    .charts-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
    @media(max-width:1100px){ .charts-row { grid-template-columns:1fr 1fr; } }

    /* Panel boxes */
    .panel-box { background:#fff; border:1px solid #E6DED0; border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:14px; }
    .panel-box h3 { font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; color:#2B2017; font-family:var(--disp,'Fraunces'),Georgia,serif; }
    .chart-legend { display:flex; flex-wrap:wrap; gap:10px; }
    .legend-item { display:flex; align-items:center; gap:5px; font-size:11.5px; color:#5b5249; }
    .legend-dot { width:10px; height:10px; border-radius:2px; flex-shrink:0; }

    /* Dense list rows */
    .dense-list { display:flex; flex-direction:column; gap:8px; }
    .dense-row { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid #F0E8DA; border-radius:10px; background:#FBFAF7; font-size:13px; }
    .dense-row .left { display:flex; align-items:center; gap:10px; font-weight:600; color:#2B2017; }
    .dense-row .status-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
    .dense-row .count-badge { font-size:11.5px; font-weight:700; background:rgba(43,32,23,.06); padding:2px 10px; border-radius:6px; color:#5b5249; }

    /* Bottom workspace grid */
    .workspace-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    @media(max-width:900px){ .workspace-grid { grid-template-columns:1fr; } }

    /* Performance table */
    .perf-wrap { overflow-x:auto; }
    .perf-table { width:100%; border-collapse:collapse; font-size:12.5px; }
    .perf-table th { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#9b8e7d; padding:0 10px 10px; text-align:left; border-bottom:1px solid #F0E8DA; white-space:nowrap; }
    .perf-table td { padding:10px; border-bottom:1px solid #F7F0E6; color:#5b5249; vertical-align:middle; white-space:nowrap; }
    .perf-table tr:last-child td { border-bottom:none; }
    .agent-name { font-weight:600; color:#2B2017; display:flex; align-items:center; gap:8px; }
    .avatar { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0; background:#EFE7D8; color:#7A5430; }
    .badge-pill { display:inline-flex; align-items:center; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600; }
    .badge-green  { background:rgba(15,110,86,.1);  color:#0F6E56; }
    .badge-orange { background:rgba(232,114,43,.12); color:#B55A10; }
    .badge-amber  { background:rgba(181,109,29,.12); color:#8A5010; }

    /* Summary panel */
    .sum-row { display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid #F7F0E6; font-size:13px; }
    .sum-row:last-child { border-bottom:none; }
    .sum-label { color:#9b8e7d; }
    .sum-val { font-weight:600; color:#2B2017; }

    /* Top performer */
    .top-performer { background:linear-gradient(135deg,#F3992E 0%,#E8722B 100%); border-radius:14px; padding:20px; color:#fff; }
    .tp-eyebrow { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; opacity:.75; margin-bottom:8px; }
    .tp-name  { font-size:22px; font-weight:600; font-family:var(--disp,'Fraunces'),Georgia,serif; }
    .tp-score { font-size:44px; font-weight:700; font-family:var(--disp,'Fraunces'),Georgia,serif; line-height:1; margin:6px 0 4px; }
    .tp-sub   { font-size:12px; opacity:.75; }
    .tp-stats { display:flex; gap:16px; margin-top:14px; font-size:11px; opacity:.65; }
  </style>

  <div class="dash-wrap">
    <main class="dash-main">

      <!-- Header -->
      <header class="dash-header">
        <div>
          <h2>Operational Command Center</h2>
          <p style="font-size:13px;color:#9b8e7d;margin:3px 0 0;">Real-time performance matrices and ticket lifecycle diagnostics.</p>
        </div>
        <div class="dash-header-meta"><i class="ti ti-clock"></i> Live · <span id="active-range-label">Today</span></div>
      </header>

      <!-- Filter Bar -->
      <div class="filter-bar">
        <span class="filter-bar-label"><i class="ti ti-filter" style="font-size:12px;"></i> Filter</span>

        <div class="filter-group">
          <button class="duration-btn active" data-dur="today">Today</button>
          <button class="duration-btn" data-dur="yesterday">Yesterday</button>
          <button class="duration-btn" data-dur="7d">Last 7 days</button>
          <button class="duration-btn" data-dur="30d">Last 30 days</button>
          <button class="duration-btn" data-dur="custom">Custom range</button>
        </div>

        <div class="filter-sep"></div>

        <div class="filter-group" id="custom-range-group" style="display:none;">
          <label style="font-size:11px;color:#9b8e7d;font-weight:600;">From</label>
          <input type="date" class="date-input" id="date-from">
          <label style="font-size:11px;color:#9b8e7d;font-weight:600;">To</label>
          <input type="date" class="date-input" id="date-to">
        </div>

        <div id="active-filter-tag" style="display:none;">
          <span class="filter-active-tag">
            <i class="ti ti-calendar-event" style="font-size:12px;"></i>
            <span id="active-tag-text">Today</span>
            <span class="close" id="clear-filter">×</span>
          </span>
        </div>

        <button class="filter-apply-btn" id="apply-filter-btn"><i class="ti ti-check"></i> Apply</button>
      </div>

      <!-- KPI Cards -->
      <section class="telemetry-grid">
        <div class="telemetry-card" style="--accent:#E8722B">
          <span class="lbl">Active Workload</span>
          <span class="val" id="val-active-workload">—</span>
          <span class="trend neu"><i class="ti ti-inbox"></i> Live queue total</span>
        </div>
        <div class="telemetry-card" style="--accent:#A32D2D">
          <span class="lbl">SLA Violations</span>
          <span class="val" id="val-sla-breaches" style="color:#A32D2D;">—</span>
          <span class="trend neg"><i class="ti ti-alert-triangle"></i> Needs immediate action</span>
        </div>
        <div class="telemetry-card" style="--accent:#B56D1D">
          <span class="lbl">Unassigned Backlog</span>
          <span class="val" id="val-unassigned-backlog">—</span>
          <span class="trend neg"><i class="ti ti-user-off"></i> Awaiting assignment</span>
        </div>
        <div class="telemetry-card" style="--accent:#0F6E56">
          <span class="lbl">Resolution Efficiency</span>
          <span class="val" id="val-resolution" style="color:#0F6E56;">—</span>
          <span class="trend pos"><i class="ti ti-circle-check"></i> vs baseline</span>
        </div>
        <div class="telemetry-card" style="--accent:#1A4FB5">
          <span class="lbl">Avg First Response</span>
          <span class="val" id="val-first-resp">—</span>
          <span class="trend pos"><i class="ti ti-clock"></i> On target</span>
        </div>
        <div class="telemetry-card" style="--accent:#F3992E">
          <span class="lbl">SLA Compliance</span>
          <span class="val" id="val-sla-compliance">—</span>
          <span class="trend pos"><i class="ti ti-shield-check"></i> Above threshold</span>
        </div>
      </section>

      <!-- Charts Row -->
      <div class="charts-row">
        <div class="panel-box">
          <h3><i class="ti ti-chart-donut" style="color:#E8722B;"></i> Ticket Status Mix</h3>
          <div style="position:relative;height:180px;"><canvas id="fk-status-donut"></canvas></div>
          <div class="chart-legend" id="fk-status-legend"></div>
        </div>
        <div class="panel-box">
          <h3><i class="ti ti-chart-bar" style="color:#B56D1D;"></i> Agent Workload</h3>
          <div style="position:relative;height:180px;"><canvas id="fk-agent-bar"></canvas></div>
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-dot" style="background:#E8722B;"></span>Resolved</span>
            <span class="legend-item"><span class="legend-dot" style="background:#F0E8DA;border:1px solid #E6DED0;"></span>Open</span>
          </div>
        </div>
        <div class="panel-box">
          <h3><i class="ti ti-chart-line" style="color:#1A4FB5;"></i> Weekly Resolution Trend</h3>
          <div style="position:relative;height:180px;"><canvas id="fk-trend-line"></canvas></div>
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-dot" style="background:#E8722B;"></span>Resolved</span>
            <span class="legend-item"><span class="legend-dot" style="background:#B56D1D;"></span>Opened</span>
          </div>
        </div>
      </div>

      <!-- Status + Category Distribution -->
      <div class="workspace-grid">
        <div class="panel-box">
          <h3><i class="ti ti-tag" style="color:#E8722B;"></i> Queue Status Distribution</h3>
          <div class="dense-list" id="dash-status-distribution-matrix"></div>
        </div>
        <div class="panel-box">
          <h3><i class="ti ti-category" style="color:#1A4FB5;"></i> Category Distribution</h3>
          <div class="dense-list" id="dash-category-distribution-matrix"></div>
        </div>
      </div>

      <!-- Team Performance Table -->
      <div class="panel-box">
        <h3><i class="ti ti-users" style="color:#E8722B;"></i> Team Performance</h3>
        <div class="perf-wrap">
          <table class="perf-table">
            <thead>
              <tr>
                <th>Agent</th><th>Assigned</th><th>Replied</th><th>Resolved</th>
                <th>Open</th><th>1st Response</th><th>Handle Time</th><th>Productivity</th>
              </tr>
            </thead>
            <tbody id="perf-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Summary + Top Performer -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="panel-box">
          <h3><i class="ti ti-list" style="color:#B56D1D;"></i> Period Summary</h3>
          <div id="summary-rows"></div>
        </div>
        <div class="top-performer">
          <div class="tp-eyebrow">Top Performer</div>
          <div class="tp-name" id="tp-name">—</div>
          <div class="tp-score" id="tp-score">—</div>
          <div class="tp-sub">Productivity score</div>
          <div class="tp-stats">
            <span><i class="ti ti-ticket"></i> <span id="tp-tickets">—</span> tickets handled</span>
            <span><i class="ti ti-clock"></i> <span id="tp-resp">—</span> avg response</span>
          </div>
        </div>
      </div>

    </main>
  </div>
</div>`;
  },

  async mount(el) {
    const $ = s => el.querySelector(s);

    // ── Dataset per duration ────────────────────────────────
    const DATASETS = {
      today: {
        label: 'Today',
        kpi: { workload:6, sla:2, unassigned:1, resolution:'94.2%', firstResp:'12m', compliance:'96%' },
        agents: [
          { name:'SITAR',  init:'J', assigned:45, replied:43, resolved:40, open:5,  resp:'8 min',  handle:'15 min', prod:'95%', cls:'badge-green' },
          { name:'Ashish', init:'S', assigned:38, replied:36, resolved:35, open:3,  resp:'10 min', handle:'18 min', prod:'92%', cls:'badge-orange' },
          { name:'Dhruv',  init:'A', assigned:52, replied:50, resolved:48, open:4,  resp:'7 min',  handle:'13 min', prod:'98%', cls:'badge-green' },
          { name:'Maya',   init:'E', assigned:40, replied:38, resolved:36, open:4,  resp:'11 min', handle:'17 min', prod:'90%', cls:'badge-amber' },
        ],
        summary: { total:324, assigned:210, replies:167, resolved:180, pending:99, avgTime:'4h 20m' },
        trend: { resolved:[28,35,42,38,51,30,24], opened:[32,28,45,50,40,22,18], labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        statusCounts: { new_ticket:1, awaiting_reply:1, to_do:1, replacement:1, refund:1, resolved:1 },
        catCounts:    { returns:2, item_not_received:1, claims:2, unsorted:1 },
        top: { name:'Dhruv', score:'98%', tickets:52, resp:'7 min' }
      },
      yesterday: {
        label: 'Yesterday',
        kpi: { workload:9, sla:1, unassigned:3, resolution:'91.5%', firstResp:'14m', compliance:'93%' },
        agents: [
          { name:'SITAR',  init:'J', assigned:39, replied:37, resolved:34, open:5,  resp:'9 min',  handle:'16 min', prod:'90%', cls:'badge-orange' },
          { name:'Ashish', init:'S', assigned:42, replied:40, resolved:38, open:4,  resp:'12 min', handle:'20 min', prod:'88%', cls:'badge-amber' },
          { name:'Dhruv',  init:'A', assigned:47, replied:45, resolved:44, open:3,  resp:'8 min',  handle:'14 min', prod:'96%', cls:'badge-green' },
          { name:'Maya',   init:'E', assigned:36, replied:33, resolved:30, open:6,  resp:'13 min', handle:'19 min', prod:'85%', cls:'badge-amber' },
        ],
        summary: { total:290, assigned:185, replies:155, resolved:146, pending:89, avgTime:'4h 50m' },
        trend: { resolved:[22,30,38,32,44,25,20], opened:[28,24,40,44,35,18,14], labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        statusCounts: { new_ticket:2, awaiting_reply:2, to_do:2, replacement:1, refund:1, resolved:1 },
        catCounts:    { returns:3, item_not_received:2, claims:2, unsorted:2 },
        top: { name:'Dhruv', score:'96%', tickets:47, resp:'8 min' }
      },
      '7d': {
        label: 'Last 7 days',
        kpi: { workload:41, sla:8, unassigned:7, resolution:'92.8%', firstResp:'13m', compliance:'94%' },
        agents: [
          { name:'SITAR',  init:'J', assigned:210, replied:200, resolved:190, open:20, resp:'9 min',  handle:'16 min', prod:'91%', cls:'badge-orange' },
          { name:'Ashish', init:'S', assigned:195, replied:185, resolved:180, open:15, resp:'11 min', handle:'19 min', prod:'89%', cls:'badge-amber' },
          { name:'Dhruv',  init:'A', assigned:265, replied:258, resolved:252, open:13, resp:'8 min',  handle:'14 min', prod:'96%', cls:'badge-green' },
          { name:'Maya',   init:'E', assigned:215, replied:205, resolved:195, open:20, resp:'12 min', handle:'18 min', prod:'88%', cls:'badge-amber' },
        ],
        summary: { total:1850, assigned:1200, replies:1050, resolved:1100, pending:620, avgTime:'4h 35m' },
        trend: { resolved:[28,35,42,38,51,30,24], opened:[32,28,45,50,40,22,18], labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        statusCounts: { new_ticket:8, awaiting_reply:10, to_do:7, replacement:5, refund:4, resolved:7 },
        catCounts:    { returns:12, item_not_received:9, claims:11, unsorted:9 },
        top: { name:'Dhruv', score:'96%', tickets:265, resp:'8 min' }
      },
      '30d': {
        label: 'Last 30 days',
        kpi: { workload:180, sla:22, unassigned:28, resolution:'93.4%', firstResp:'13m', compliance:'95%' },
        agents: [
          { name:'SITAR',  init:'J', assigned:820,  replied:800,  resolved:780,  open:40, resp:'9 min',  handle:'16 min', prod:'93%', cls:'badge-green' },
          { name:'Ashish', init:'S', assigned:760,  replied:730,  resolved:710,  open:50, resp:'11 min', handle:'19 min', prod:'90%', cls:'badge-orange' },
          { name:'Dhruv',  init:'A', assigned:1050, replied:1020, resolved:1000, open:50, resp:'8 min',  handle:'14 min', prod:'97%', cls:'badge-green' },
          { name:'Maya',   init:'E', assigned:880,  replied:845,  resolved:820,  open:60, resp:'12 min', handle:'18 min', prod:'89%', cls:'badge-amber' },
        ],
        summary: { total:8200, assigned:5200, replies:4600, resolved:4850, pending:2700, avgTime:'4h 28m' },
        trend: { resolved:[480,520,490,560,540,470,490], opened:[510,540,510,590,560,490,510], labels:['W1','W2','W3','W4','W5','W6','W7'] },
        statusCounts: { new_ticket:30, awaiting_reply:40, to_do:28, replacement:20, refund:18, resolved:44 },
        catCounts:    { returns:50, item_not_received:40, claims:48, unsorted:42 },
        top: { name:'Dhruv', score:'97%', tickets:1050, resp:'8 min' }
      }
    };

    const STATUS_SCHEMAS = {
      new_ticket:     { label:'New Ticket',     color:'#E8722B' },
      awaiting_reply: { label:'Awaiting Reply', color:'#B56D1D' },
      to_do:          { label:'To Do',          color:'#1A4FB5' },
      replacement:    { label:'Replacement',    color:'#9A4A2B' },
      refund:         { label:'Refund',         color:'#8A6A1E' },
      resolved:       { label:'Resolved',       color:'#0F6E56' },
    };

    const CATEGORY_SCHEMAS = {
      returns:           'Returns Pipeline',
      item_not_received: 'Item Not Received (INR)',
      claims:            'Insurance & Claims Management',
      unsorted:          'Unsorted Backlog Queue',
    };

    // ── Chart instances ─────────────────────────────────────
    let donutChart, barChart, lineChart;

    // ── Render helpers ──────────────────────────────────────
    function renderDashboard(durKey, customLabel) {
      const d = DATASETS[durKey] || DATASETS['today'];
      const label = customLabel || d.label;

      $('#active-range-label').textContent = label;
      $('#active-tag-text').textContent    = label;
      $('#active-filter-tag').style.display = '';

      $('#val-active-workload').textContent  = d.kpi.workload;
      $('#val-sla-breaches').textContent     = d.kpi.sla;
      $('#val-unassigned-backlog').textContent = d.kpi.unassigned;
      $('#val-resolution').textContent       = d.kpi.resolution;
      $('#val-first-resp').textContent       = d.kpi.firstResp;
      $('#val-sla-compliance').textContent   = d.kpi.compliance;

      const statusKeys   = Object.keys(STATUS_SCHEMAS);
      const statusCounts = statusKeys.map(k => d.statusCounts[k] || 0);
      const statusColors = statusKeys.map(k => STATUS_SCHEMAS[k].color);
      const statusLabels = statusKeys.map(k => STATUS_SCHEMAS[k].label);

      if (donutChart) { donutChart.data.datasets[0].data = statusCounts; donutChart.update(); }
      if (barChart)   {
        barChart.data.datasets[0].data = d.agents.map(a => a.resolved);
        barChart.data.datasets[1].data = d.agents.map(a => a.open);
        barChart.update();
      }
      if (lineChart)  {
        lineChart.data.labels             = d.trend.labels;
        lineChart.data.datasets[0].data   = d.trend.resolved;
        lineChart.data.datasets[1].data   = d.trend.opened;
        lineChart.update();
      }

      $('#dash-status-distribution-matrix').innerHTML = statusKeys.map((key, i) =>
        `<div class="dense-row">
          <div class="left"><span class="status-dot" style="background:${statusColors[i]}"></span><span>${statusLabels[i]}</span></div>
          <span class="count-badge">${statusCounts[i]}</span>
        </div>`
      ).join('');

      $('#dash-category-distribution-matrix').innerHTML = Object.entries(CATEGORY_SCHEMAS).map(([key, lbl]) =>
        `<div class="dense-row">
          <div class="left"><i class="ti ti-folder-open" style="color:#9b8e7d;font-size:15px;"></i><span>${lbl}</span></div>
          <span class="count-badge">${d.catCounts[key] || 0}</span>
        </div>`
      ).join('');

      $('#perf-tbody').innerHTML = d.agents.map(a =>
        `<tr>
          <td><div class="agent-name"><div class="avatar">${a.init}</div>${a.name}</div></td>
          <td>${a.assigned}</td><td>${a.replied}</td><td>${a.resolved}</td><td>${a.open}</td>
          <td>${a.resp}</td><td>${a.handle}</td>
          <td><span class="badge-pill ${a.cls}">${a.prod}</span></td>
        </tr>`
      ).join('');

      const s = d.summary;
      $('#summary-rows').innerHTML = [
        ['Total tickets', s.total], ['Assigned', s.assigned], ['Replies sent', s.replies],
        ['Resolved', s.resolved], ['Pending', s.pending], ['Avg resolution time', s.avgTime]
      ].map(([l, v]) =>
        `<div class="sum-row"><span class="sum-label">${l}</span><span class="sum-val">${v}</span></div>`
      ).join('');

      $('#tp-name').textContent    = d.top.name;
      $('#tp-score').textContent   = d.top.score;
      $('#tp-tickets').textContent = d.top.tickets;
      $('#tp-resp').textContent    = d.top.resp;
    }

    // ── Init charts ─────────────────────────────────────────
    function initCharts() {
      const d = DATASETS['today'];
      const MUTED = '#9b8e7d', GRID = '#F0E8DA', ORANGE = '#E8722B', AMBER = '#B56D1D';
      Chart.defaults.font.family = "'Hanken Grotesk', -apple-system, sans-serif";

      const statusKeys   = Object.keys(STATUS_SCHEMAS);
      const statusCounts = statusKeys.map(k => d.statusCounts[k] || 0);
      const statusColors = statusKeys.map(k => STATUS_SCHEMAS[k].color);
      const statusLabels = statusKeys.map(k => STATUS_SCHEMAS[k].label);

      donutChart = new Chart($('#fk-status-donut'), {
        type: 'doughnut',
        data: { labels: statusLabels, datasets: [{ data: statusCounts, backgroundColor: statusColors, borderWidth: 3, borderColor: '#ffffff', hoverOffset: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` }}}}
      });

      const legendEl = $('#fk-status-legend');
      statusLabels.forEach((lbl, i) => {
        const span = document.createElement('span');
        span.className = 'legend-item';
        span.innerHTML = `<span class="legend-dot" style="background:${statusColors[i]};"></span>${lbl} ${statusCounts[i]}`;
        legendEl.appendChild(span);
      });

      barChart = new Chart($('#fk-agent-bar'), {
        type: 'bar',
        data: {
          labels: d.agents.map(a => a.name),
          datasets: [
            { label:'Resolved', data: d.agents.map(a => a.resolved), backgroundColor: ORANGE, borderRadius: 4, borderSkipped: false },
            { label:'Open',     data: d.agents.map(a => a.open),     backgroundColor: '#F0E8DA', borderRadius: 4, borderSkipped: false }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false }},
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: MUTED, font: { size: 11 }}, border: { color: GRID }},
            y: { stacked: true, grid: { color: GRID },    ticks: { color: MUTED, font: { size: 11 }}, border: { display: false }}
          }
        }
      });

      lineChart = new Chart($('#fk-trend-line'), {
        type: 'line',
        data: {
          labels: d.trend.labels,
          datasets: [
            { label:'Resolved', data: d.trend.resolved, borderColor: ORANGE, backgroundColor: 'rgba(232,114,43,0.08)', borderWidth: 2, tension: 0.4, fill: true, pointBackgroundColor: ORANGE, pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 4 },
            { label:'Opened',   data: d.trend.opened,   borderColor: AMBER,  backgroundColor: 'rgba(181,109,29,0.06)', borderWidth: 2, tension: 0.4, fill: true, borderDash: [5,3], pointBackgroundColor: AMBER, pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false }},
          scales: {
            x: { grid: { display: false }, ticks: { color: MUTED, font: { size: 11 }}, border: { color: GRID }},
            y: { grid: { color: GRID },    ticks: { color: MUTED, font: { size: 11 }}, border: { display: false }}
          }
        }
      });
    }

    // ── Set default dates ───────────────────────────────────
    function setDateDefaults() {
      const today = new Date();
      const fmt = d => d.toISOString().split('T')[0];
      $('#date-to').value = fmt(today);
      const from = new Date(today); from.setDate(from.getDate() - 7);
      $('#date-from').value = fmt(from);
    }

    // ── Boot ────────────────────────────────────────────────
    async function boot() {
      setDateDefaults();

      await new Promise((resolve, reject) => {
        if (window.Chart) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });

      initCharts();
      renderDashboard('today');

      // Duration button clicks
      let currentDur = 'today';
      const customGroup = $('#custom-range-group');

      el.querySelectorAll('.duration-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          el.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentDur = btn.dataset.dur;
          customGroup.style.display = currentDur === 'custom' ? 'flex' : 'none';
        });
      });

      // Apply button
      $('#apply-filter-btn').addEventListener('click', () => {
        if (currentDur === 'custom') {
          const from = $('#date-from').value;
          const to   = $('#date-to').value;
          if (!from || !to) { alert('Please select both dates.'); return; }
          const fmtDate = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
          renderDashboard('7d', `${fmtDate(from)} – ${fmtDate(to)}`);
        } else {
          renderDashboard(currentDur);
        }
      });

      // Clear filter
      $('#clear-filter').addEventListener('click', () => {
        el.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
        el.querySelector('[data-dur="today"]').classList.add('active');
        currentDur = 'today';
        customGroup.style.display = 'none';
        renderDashboard('today');
      });
    }

    boot();
  },

  unmount() {}
};