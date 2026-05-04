// CampaignPulse — deploy marker 2026-05-04 r5 (production base + Switch to Google + dept routing)
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Auth middleware ───────────────────────────────────────────────────────
// Truly public endpoints — these CANNOT require auth because they're either
// pre-login (login itself), or hit by external services that use a shared secret
// (Google Ads script for ingest, OAuth callback handlers).
const PUBLIC_PATHS = [
  '/auth/login', '/auth/logout', '/admin/create-manager',
  '/google/ingest',                  // Google Ads script ingest (uses x-google-secret)
  '/google/oauth',                   // GA4 OAuth callback
  '/google/ga4-status',              // Pre-OAuth status check
  '/google/ga4-refresh',             // GA4 token refresh
  '/google/debug/'                   // Diagnostics
];

// Endpoints that require authentication AND check that the user's department matches.
// Maps URL prefix → required department(s). Manager passes everything.
const DEPARTMENT_GUARD = [
  // Google-only endpoints — block Amazon agents from hitting them
  { prefix: '/api/google/', allowed: ['google', 'manager'] },
  // Amazon-only endpoints — block Google agents
  { prefix: '/api/amazon/', allowed: ['amazon', 'manager', 'agent'] }   // 'agent' = legacy Amazon agents
];

// ─── Time helpers — Shopify Analytics groups by SHOP timezone (Europe/London).
// Railway containers run UTC, so we compute London-midnight + London-date-keys
// explicitly to avoid orders near midnight being bucketed into the wrong day.

function londonDateKey(date) {
  // Returns 'YYYY-MM-DD' in London time. Uses Intl.DateTimeFormat parts
  // because toLocaleDateString format strings vary across Node versions.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const obj = {};
  parts.forEach(function(p){ obj[p.type] = p.value; });
  return obj.year + '-' + obj.month + '-' + obj.day;
}

function londonMidnightToday() {
  // Returns the unix-ms timestamp of midnight TODAY in London time.
  // We construct this by formatting "now" in London, extracting Y/M/D, and parsing
  // back with the right BST/GMT offset.
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(now);
  const o = {};
  parts.forEach(function(p){ o[p.type] = p.value; });
  // Build "YYYY-MM-DDT00:00:00" as if local-London. We need to find the UTC equivalent.
  // Trick: take "now" and subtract the seconds-into-day in London. London-now-seconds-in-day:
  let h = parseInt(o.hour, 10); if (h === 24) h = 0;  // some nodes return '24' at midnight
  const secondsIntoDay = h * 3600 + parseInt(o.minute, 10) * 60 + parseInt(o.second, 10);
  return now.getTime() - secondsIntoDay * 1000 - now.getMilliseconds();
}

async function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.some(function(p){ return req.path.startsWith(p); })) return next();
  if (req.path.match(/\.(css|js|png|jpg|ico|svg|woff|woff2)$/)) return next();

  const token = req.headers['x-auth-token'] || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) {
    if (req.path === '/' || req.path === '/index.html') return res.redirect('/login.html');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    if (!db) return next();
    const result = await db.query(
      'SELECT * FROM user_sessions WHERE token=$1 AND expires_at > NOW()',
      [token]
    );
    if (!result.rows.length) {
      if (req.path === '/' || req.path === '/index.html') return res.redirect('/login.html');
      return res.status(401).json({ error: 'Session expired' });
    }
    await db.query(
      "UPDATE user_sessions SET expires_at=NOW() + INTERVAL '24 hours', last_active=NOW() WHERE token=$1",
      [token]
    );
    req.user = result.rows[0];

    // Department guard: agents can only hit endpoints that match their department.
    // Manager (role='manager' OR department='manager') bypasses all checks.
    const userDept = (req.user.department || '').toLowerCase();
    const userRole = (req.user.role || '').toLowerCase();
    const isManager = userRole === 'manager' || userDept === 'manager';
    if (!isManager) {
      for (const guard of DEPARTMENT_GUARD) {
        if (req.path.startsWith(guard.prefix)) {
          if (!guard.allowed.includes(userDept) && !guard.allowed.includes(userRole)) {
            return res.status(403).json({ error: 'You do not have access to this department' });
          }
          break;
        }
      }
    }

    next();
  } catch(e) {
    console.error('Auth middleware error: ' + e.message);
    next();
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', requireAuth);

let state = {
  accessToken: null,
  tokenExpiry: null,
  profileId: null,
  campaigns: [],
  portfolios: {},
  alerts: [],
  exhaustionLog: [],
  lastSync: null,
  syncing: false,
  error: null
};

// ── Google Ads State ──────────────────────────────────────────────────────
let googleState = {
  campaigns: [],
  products: [],
  alerts: [],
  lastSync: null,           // human-readable string like "08:23"
  lastReceivedAt: null,     // ISO timestamp from server clock when last ingest succeeded
  error: null
};

async function getAccessToken() {
  if (!process.env.AMAZON_REFRESH_TOKEN || !process.env.AMAZON_CLIENT_ID || !process.env.AMAZON_CLIENT_SECRET) {
    throw new Error('Amazon credentials not configured');
  }
  if (state.accessToken && state.tokenExpiry && Date.now() < state.tokenExpiry - 60000) {
    return state.accessToken;
  }
  console.log('Refreshing access token...');
  const res = await axios.post('https://api.amazon.co.uk/auth/o2/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.AMAZON_REFRESH_TOKEN.trim(),
      client_id: process.env.AMAZON_CLIENT_ID.trim(),
      client_secret: process.env.AMAZON_CLIENT_SECRET.trim()
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  state.accessToken = res.data.access_token;
  state.tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  console.log('Token refreshed OK');
  return state.accessToken;
}

async function getProfileId() {
  if (state.profileId) return state.profileId;
  const token = await getAccessToken();
  const res = await axios.get('https://advertising-api-eu.amazon.com/v2/profiles', {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Amazon-Advertising-API-ClientId': process.env.AMAZON_CLIENT_ID.trim()
    }
  });
  const uk = res.data.find(function(p) { return p.countryCode === 'GB' || p.countryCode === 'UK'; }) || res.data[0];
  state.profileId = uk.profileId;
  console.log('Profile ID: ' + state.profileId);
  return state.profileId;
}

function getHeaders(profileId, token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Amazon-Advertising-API-ClientId': process.env.AMAZON_CLIENT_ID.trim(),
    'Amazon-Advertising-API-Scope': String(profileId)
  };
}

async function fetchCampaigns() {
  const token = await getAccessToken();
  const profileId = await getProfileId();
  const headers = Object.assign({}, getHeaders(profileId, token), {
    'Content-Type': 'application/vnd.spCampaign.v3+json',
    'Accept': 'application/vnd.spCampaign.v3+json'
  });
  const res = await axios.post(
    'https://advertising-api-eu.amazon.com/sp/campaigns/list',
    { stateFilter: { include: ['ENABLED'] } },
    { headers: headers }
  );
  const campaigns = res.data.campaigns || res.data || [];
  console.log('Campaigns fetched: ' + campaigns.length);
  return campaigns;
}

let reportState = { pendingReportId: null, data: null, lastFetched: 0, requested: 0 };

async function fetchCampaignStats() {
  const now = Date.now();
  const token = await getAccessToken();
  const profileId = await getProfileId();
  const headers = getHeaders(profileId, token);
  const today = new Date().toISOString().split('T')[0];

  if (reportState.pendingReportId) {
    try {
      const statusRes = await axios.get(
        'https://advertising-api-eu.amazon.com/reporting/reports/' + reportState.pendingReportId,
        { headers: Object.assign({}, headers, { 'Accept': 'application/json' }) }
      );
      const status = statusRes.data.status;
      console.log('Pending report status: ' + status);
      if (status === 'COMPLETED') {
        const downloadRes = await axios.get(statusRes.data.url, { responseType: 'arraybuffer' });
        const zlib = require('zlib');
        const decompressed = zlib.gunzipSync(Buffer.from(downloadRes.data));
        const reportData = JSON.parse(decompressed.toString());
        console.log('Report downloaded: ' + reportData.length + ' records');
        reportState.data = reportData;
        reportState.lastFetched = now;
        reportState.pendingReportId = null;
      } else if (status === 'FAILED') {
        console.log('Report failed, will retry next cycle');
        reportState.pendingReportId = null;
      }
    } catch(e) {
      console.error('Report check error: ' + e.message);
      reportState.pendingReportId = null;
    }
  }

  if (!reportState.pendingReportId && (now - reportState.requested) > 2 * 60 * 60 * 1000) {
    try {
      const reportRes = await axios.post(
        'https://advertising-api-eu.amazon.com/reporting/reports',
        {
          name: 'CampaignPulse ' + today,
          startDate: today,
          endDate: today,
          configuration: {
            adProduct: 'SPONSORED_PRODUCTS',
            groupBy: ['campaign'],
            columns: ['campaignId', 'campaignName', 'cost', 'sales14d', 'clicks', 'impressions', 'purchases14d', 'clickThroughRate'],
            reportTypeId: 'spCampaigns',
            timeUnit: 'SUMMARY',
            format: 'GZIP_JSON'
          }
        },
        { headers: Object.assign({}, headers, { 'Content-Type': 'application/json', 'Accept': 'application/json' }) }
      );
      reportState.pendingReportId = reportRes.data.reportId;
      reportState.requested = now;
      console.log('Report requested: ' + reportState.pendingReportId + ' (will check next sync)');
    } catch(e) {
      console.error('Report request error: ' + e.message);
    }
  }

  return reportState.data || null;
}

async function updateBudget(campaignId, newBudget) {
  const token = await getAccessToken();
  const profileId = await getProfileId();
  const headers = Object.assign({}, getHeaders(profileId, token), {
    'Content-Type': 'application/vnd.spCampaign.v3+json',
    'Accept': 'application/vnd.spCampaign.v3+json'
  });
  try {
    const res = await axios.put(
      'https://advertising-api-eu.amazon.com/sp/campaigns',
      { campaigns: [{ campaignId: String(campaignId), budget: { budget: newBudget, budgetType: 'DAILY' } }] },
      { headers: headers }
    );
    console.log('Budget updated v3: ' + JSON.stringify(res.data).substring(0, 200));
    return res.data;
  } catch(e) {
    console.error('Budget update error: ' + e.response?.status + ' ' + JSON.stringify(e.response?.data));
    throw e;
  }
}

async function sendGoogleChat(message) {
  if (!process.env.GOOGLE_CHAT_WEBHOOK) return;
  await new Promise(function(resolve) { setTimeout(resolve, 1000); });
  try {
    await axios.post(process.env.GOOGLE_CHAT_WEBHOOK, { text: message });
    console.log('Google Chat sent');
  } catch(e) {
    console.error('Google Chat error: ' + e.message);
  }
}

async function analyseCampaigns(campaigns) {
  const acosCritical = parseFloat(process.env.ACOS_CRITICAL_THRESHOLD || 35);
  const budgetLowPct = parseFloat(process.env.BUDGET_LOW_PERCENT || 20);
  const now = new Date();
  state.alerts = state.alerts.filter(function(a) { return a.date === now.toDateString(); });
  const timeStr = now.toLocaleTimeString('en-GB', {timeZone:'Europe/London', hour:'2-digit', minute:'2-digit'});
  const dateStr = now.toDateString();

  for (let i = 0; i < campaigns.length; i++) {
    const c = campaigns[i];
    const budget = c.dailyBudget || 0;
    const spend = c.spend || 0;
    const sales = c.sales || 0;
    const acos = sales > 0 ? (spend / sales) * 100 : 0;
    const remaining = Math.max(0, budget - spend);
    const remainingPct = budget > 0 ? (remaining / budget) * 100 : 100;
    const outOfBudget = remaining <= 0.01 && budget > 0;
    const budgetLow = remainingPct <= budgetLowPct && !outOfBudget;
    const acosHigh = acos > acosCritical && spend > 5;
    const ukHour = parseInt(new Date().toLocaleString('en-GB', {timeZone:'Europe/London', hour:'numeric', hour12:false}));
    if (ukHour >= 22 || ukHour < 8) continue;
    const alertType = outOfBudget ? 'out_of_budget' : acosHigh ? 'acos_high' : budgetLow ? 'budget_low' : null;
    if (!alertType) continue;

    let alreadyAlerted = state.alerts.find(function(a) {
      return a.campaignId === c.campaignId && a.date === dateStr && a.type === alertType;
    });
    if (!alreadyAlerted && db) {
      try {
        const dbAlert = await db.query(
          "SELECT id FROM campaign_tasks WHERE campaign_id=$1 AND task_source='alert' AND problem_type=$2 AND created_date=CURRENT_DATE",
          [String(c.campaignId), alertType]
        );
        if (dbAlert.rows.length > 0) alreadyAlerted = true;
      } catch(e) {}
    }
    if (alreadyAlerted) continue;
    if (db) {
      try {
        const suppressed = await db.query(
          'SELECT id FROM campaign_tasks WHERE campaign_id=$1 AND status=$2 AND DATE(suppressed_until)=CURRENT_DATE',
          [String(c.campaignId), 'dismissed']
        );
        if (suppressed.rows.length > 0) continue;
      } catch(e) {}
    }

    const name = c.name || 'Unknown';
    const agent = extractAgentFromCampaign(name) || '';
    const portfolioName = c.portfolio || '';

    state.alerts.push({ campaignId: c.campaignId, name: name, portfolio: portfolioName, agent: agent, type: alertType, time: timeStr, date: dateStr, budget: budget, acos: Math.round(acos * 10) / 10 });

    const dashUrl = process.env.DASHBOARD_URL || 'https://campaignpulse-setup-production.up.railway.app';

    if (outOfBudget) {
      const hoursLeft = (23 * 60 + 59 - now.getHours() * 60 - now.getMinutes()) / 60;
      const roas = spend > 0 ? sales / spend : 0;
      const hourly = spend / Math.max(now.getHours(), 1);
      const missed = Math.round(hourly * hoursLeft * roas);
      state.exhaustionLog.unshift({ date: now.toLocaleDateString('en-GB'), time: timeStr, campaign: name, portfolio: portfolioName, agent: agent, budget: '£' + budget.toFixed(2), acos: acos.toFixed(1) + '%', missed: '£' + missed, added: 'Pending', action: 'Pending' });
      const m1 = ['⚠ OUT OF BUDGET', name, 'Time: ' + timeStr, 'Budget: £' + budget.toFixed(2), 'ACOS: ' + acos.toFixed(1) + '%', 'Est. missed: ~£' + missed, dashUrl].join('\n');
      if (agent) { await sendToAgent(agent, m1); } else { await sendGoogleChat(m1); }
      createAlertTask(c.campaignId, name, agent, portfolioName, 'out_of_budget', 'Ran out at ' + timeStr + '. Budget £' + budget.toFixed(2) + ', ACOS ' + acos.toFixed(1) + '%');
    } else if (acosHigh) {
      const m2 = ['📈 HIGH ACOS', name, 'ACOS: ' + acos.toFixed(1) + '%', 'Spend: £' + spend.toFixed(2), dashUrl].join('\n');
      if (agent) { await sendToAgent(agent, m2); } else { await sendGoogleChat(m2); }
      createAlertTask(c.campaignId, name, agent, portfolioName, 'high_acos', 'ACOS ' + acos.toFixed(1) + '% with £' + spend.toFixed(2) + ' spend');
    } else if (budgetLow) {
      const m3 = ['⚡ BUDGET LOW', name, 'Remaining: £' + remaining.toFixed(2) + ' (' + remainingPct.toFixed(0) + '%)', dashUrl].join('\n');
      if (agent) { await sendToAgent(agent, m3); } else { await sendGoogleChat(m3); }
      createAlertTask(c.campaignId, name, agent, portfolioName, 'budget_low', 'Budget ' + remainingPct.toFixed(0) + '% used, £' + remaining.toFixed(2) + ' left');
    }
  }
  console.log('Alert analysis complete');
}

async function syncCampaigns() {
  if (state.syncing) return;
  state.syncing = true;
  console.log('Syncing at ' + new Date().toTimeString().slice(0, 8));
  try {
    const raw = await fetchCampaigns();
    const stats = await fetchCampaignStats();
    const statsMap = {};
    if (stats && stats.length) {
      stats.forEach(function(s) {
        statsMap[s.campaignId] = {
          spend: parseFloat(s.cost || 0),
          sales: parseFloat(s.sales14d || 0),
          clicks: parseInt(s.clicks || 0),
          impressions: parseInt(s.impressions || 0),
          conversions: parseInt(s.purchases14d || 0),
          ctr: parseFloat(s.clickThroughRate || 0),
          portfolio: s.portfolioName || '',
          portfolioId: s.portfolioId || ''
        };
      });
      console.log('Stats loaded for ' + Object.keys(statsMap).length + ' campaigns');
    }

    const campaigns = raw.map(function(c) {
      const budget = parseFloat((c.budget && c.budget.budget) || c.dailyBudget || 0);
      const s = statsMap[c.campaignId] || {};
      const spend = s.spend !== undefined ? parseFloat(s.spend) : null;
      const sales = s.sales !== undefined ? parseFloat(s.sales) : null;
      const acos = sales > 0 ? Math.round((spend / sales) * 1000) / 10 : 0;
      const remaining = Math.max(0, budget - spend);
      const pct = budget > 0 ? Math.round((spend / budget) * 100) : 0;
      const portfolioName = c.portfolioId ? (state.portfolios[c.portfolioId] || '') : '';
      const agent = portfolioName ? portfolioName.replace('@', '').split(' ')[0] : '';
      return {
        campaignId: c.campaignId,
        name: c.name || '',
        state: (c.state || '').toLowerCase(),
        targetingType: (c.targetingType || '').toLowerCase(),
        portfolio: portfolioName,
        agent: agent,
        dailyBudget: budget,
        spend: spend !== null ? Math.round(spend * 100) / 100 : null,
        sales: sales !== null ? Math.round(sales * 100) / 100 : null,
        acos: acos,
        clicks: s.clicks || 0,
        impressions: s.impressions || 0,
        conversions: s.conversions || 0,
        ctr: s.ctr ? (s.ctr * 100).toFixed(2) : '0.00',
        budgetRemaining: Math.round(remaining * 100) / 100,
        budgetPct: pct
      };
    });

    state.campaigns = campaigns;
    await analyseCampaigns(campaigns);
    state.lastSync = new Date().toLocaleTimeString('en-GB', {timeZone:'Europe/London', hour:'2-digit', minute:'2-digit', second:'2-digit'});
    state.error = null;
    console.log('Sync done. ' + campaigns.length + ' campaigns.');
    saveDailySnapshot().catch(function(e){ console.error('Snapshot error: ' + e.message); });
  } catch(e) {
    state.error = e.message;
    console.error('Sync error:', e.message);
  } finally {
    state.syncing = false;
  }
}

// ── Database ──────────────────────────────────────────────────────────────
let db = null;

async function initDB() {
  if (!process.env.DATABASE_URL) { console.log('No DATABASE_URL - skipping DB'); return; }
  try {
    const { Client } = require('pg');
    db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query(`
      CREATE TABLE IF NOT EXISTS daily_snapshots (
        id SERIAL PRIMARY KEY,
        snapshot_date DATE NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        metrics JSONB,
        campaigns JSONB,
        exhaustion_log JSONB,
        alerts JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_snapshot_date ON daily_snapshots(snapshot_date);
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        settings JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO app_settings (id, settings) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING;
    `);
    console.log('Database connected and tables ready');
    await initTasksTable();
  } catch(e) {
    console.error('DB init error: ' + e.message);
    db = null;
  }
}

async function saveDailySnapshot() {
  if (!db) return;
  try {
    const today = new Date().toISOString().split('T')[0];
    const campaigns = state.campaigns;
    const totalRevenue = campaigns.reduce(function(s,c){ return s+(c.sales||0); }, 0);
    const totalSpend = campaigns.reduce(function(s,c){ return s+(c.spend||0); }, 0);
    const blendedAcos = totalRevenue > 0 ? Math.round((totalSpend/totalRevenue)*1000)/10 : 0;
    const metrics = {
      totalRevenue: totalRevenue.toFixed(2),
      totalSpend: totalSpend.toFixed(2),
      blendedAcos,
      activeCampaigns: campaigns.filter(function(c){ return c.state==='enabled'; }).length,
      totalCampaigns: campaigns.length,
      outOfBudget: campaigns.filter(function(c){ return c.budgetRemaining<=0.01&&c.dailyBudget>0; }).length,
      spendNoRevenue: campaigns.filter(function(c){ return c.spend>0&&(c.sales===0||c.sales===null); }).length,
      totalWastedSpend: campaigns.filter(function(c){ return c.spend>0&&(c.sales===0||c.sales===null); }).reduce(function(s,c){ return s+(c.spend||0); }, 0).toFixed(2)
    };
    await db.query(
      'INSERT INTO daily_snapshots (snapshot_date, metrics, campaigns, exhaustion_log, alerts) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (snapshot_date) DO UPDATE SET metrics=$2, campaigns=$3, exhaustion_log=$4, alerts=$5, created_at=NOW()',
      [today, JSON.stringify(metrics), JSON.stringify(campaigns), JSON.stringify(state.exhaustionLog), JSON.stringify(state.alerts)]
    );
    console.log('Daily snapshot saved for ' + today);
  } catch(e) {
    console.error('Snapshot save error: ' + e.message);
  }
}

async function getDailySnapshot(date) {
  if (!db) return null;
  try {
    const dateStr = String(date).split('T')[0];
    const res = await db.query("SELECT *, TO_CHAR(snapshot_date, 'YYYY-MM-DD') as snapshot_date FROM daily_snapshots WHERE snapshot_date = $1", [dateStr]);
    return res.rows[0] || null;
  } catch(e) {
    console.error('Snapshot fetch error: ' + e.message);
    return null;
  }
}

async function getSnapshotDates() {
  if (!db) return [];
  try {
    const res = await db.query("SELECT TO_CHAR(snapshot_date, 'YYYY-MM-DD') as snapshot_date, metrics FROM daily_snapshots ORDER BY snapshot_date DESC LIMIT 30");
    return res.rows;
  } catch(e) { return []; }
}

// ── Agent webhook routing ─────────────────────────────────────────────────
function getAgentWebhook(agentName) {
  if (!agentName) return null;
  try {
    const mapping = JSON.parse(process.env.AGENT_WEBHOOKS || '{}');
    const varName = mapping[agentName];
    if (varName && process.env[varName]) return process.env[varName];
  } catch(e) {}
  return null;
}

function extractAgentFromCampaign(campaignName) {
  if (!campaignName) return null;
  const parts = campaignName.split(/[|@]/);
  const name = parts[0].trim();
  return name.length > 0 && name.length < 30 ? name : null;
}

async function sendToAgent(agentName, message) {
  const webhook = getAgentWebhook(agentName);
  if (webhook) {
    try {
      await axios.post(webhook, { text: message });
      console.log('Sent to agent space: ' + agentName);
      return true;
    } catch(e) {
      console.error('Agent webhook error (' + agentName + '): ' + e.message);
    }
  }
  return false;
}

// ── Tasks table init ───────────────────────────────────────────────────────
async function initTasksTable() {
  if (!db) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS campaign_tasks (
        id SERIAL PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        campaign_name TEXT NOT NULL,
        agent_name TEXT,
        portfolio TEXT,
        problem_type TEXT NOT NULL,
        problem_detail TEXT,
        days_persisted INTEGER DEFAULT 1,
        total_wasted NUMERIC DEFAULT 0,
        score INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open',
        agent_notes TEXT,
        task_source TEXT DEFAULT 'daily',
        created_date DATE DEFAULT CURRENT_DATE,
        updated_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_agent ON campaign_tasks(agent_name);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON campaign_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_date ON campaign_tasks(created_date);
    `);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS task_source TEXT DEFAULT 'daily'`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS dismissed_reason TEXT`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS suppressed_until TIMESTAMP`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS paused_reason TEXT`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS first_action_at TIMESTAMP`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS days_persisted INTEGER DEFAULT 1`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS total_wasted NUMERIC DEFAULT 0`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS escalation_reason TEXT`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS scaling_deadline TIMESTAMP`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 1`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS last_resolved_date TIMESTAMP`);
    await db.query(`ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS is_repeat_offender BOOLEAN DEFAULT FALSE`);
    console.log('Tasks table ready');

    await db.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        campaign_id TEXT,
        campaign_name TEXT,
        agent_name TEXT,
        action TEXT NOT NULL,
        notes TEXT,
        status_before TEXT,
        status_after TEXT,
        task_id INTEGER,
        logged_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_log(agent_name);
      CREATE INDEX IF NOT EXISTS idx_activity_campaign ON activity_log(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logged ON activity_log(logged_at DESC);
    `);
    console.log('Activity log table ready');

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT 'amazon',
        role TEXT NOT NULL DEFAULT 'agent',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        token TEXT UNIQUE NOT NULL,
        department TEXT NOT NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        last_active TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at)');

    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'amazon'");
    await db.query("ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'amazon'");
    // actor_name = the LOGGED-IN USER who took the action (vs agent_name which is the task owner).
    // Critical for audit: when Bobby reassigns Rahul's task to Anuj, log shows Bobby did it.
    await db.query("ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS actor_name TEXT");
    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS reassigned_at TIMESTAMP");
    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS reassigned_from TEXT");
    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS notes_ignored BOOLEAN DEFAULT FALSE");

    try {
      const userCount = await db.query('SELECT COUNT(*) as cnt FROM users');
      if (parseInt(userCount.rows[0].cnt) === 0) {
        const hash = await bcrypt.hash('FKSports2024!', 10);
        await db.query(
          'INSERT INTO users (name, email, password_hash, department, role) VALUES ($1,$2,$3,$4,$5)',
          ['Bobby', 'bobby@fksports.co.uk', hash, 'manager', 'manager']
        );
        console.log('Default manager account created: bobby@fksports.co.uk / FKSports2024!');
      }
      // Idempotent seed for Google agents — only adds if missing.
      // Initial password is FKSports2024! (they should change on first login).
      const googleAgents = [
        { name: 'Rahul', email: 'rahul@fksports.co.uk' },
        { name: 'Anuj',  email: 'anuj@fksports.co.uk' }
      ];
      for (const ag of googleAgents) {
        const exists = await db.query('SELECT id FROM users WHERE email=$1', [ag.email]);
        if (!exists.rows.length) {
          const hash = await bcrypt.hash('FKSports2024!', 10);
          await db.query(
            'INSERT INTO users (name, email, password_hash, department, role) VALUES ($1,$2,$3,$4,$5)',
            [ag.name, ag.email, hash, 'google', 'agent']
          );
          console.log('Google agent seeded: ' + ag.email + ' / FKSports2024! (please change on first login)');
        }
      }
    } catch(e) { console.error('User init error: ' + e.message); }
    console.log('Auth tables ready');

    // ── FIX: Reload today alerts using created_date (not created_at) ──────
    try {
      const todayAlerts = await db.query(
        "SELECT campaign_id, campaign_name, problem_type, problem_detail, created_date FROM campaign_tasks WHERE task_source='alert' AND created_date=CURRENT_DATE"
      );
      todayAlerts.rows.forEach(function(row) {
        const existing = state.alerts.find(function(a){ return String(a.campaignId) === String(row.campaign_id) && a.type === row.problem_type; });
        if (!existing) {
          state.alerts.push({
            campaignId: row.campaign_id,
            name: row.campaign_name || 'Unknown',
            type: row.problem_type,
            time: new Date().toLocaleTimeString('en-GB', {timeZone:'Europe/London', hour:'2-digit', minute:'2-digit'}),
            date: new Date().toDateString(),
            acos: 0,
            budget: 0
          });
        }
      });
      console.log('Reloaded ' + todayAlerts.rows.length + ' alerts from DB');
    } catch(e) { console.error('Alert reload error: ' + e.message); }

    await db.query(`
      CREATE TABLE IF NOT EXISTS keyword_dismissals (
        id SERIAL PRIMARY KEY,
        search_term TEXT NOT NULL,
        campaign TEXT NOT NULL,
        reason TEXT NOT NULL,
        dismissed_by TEXT,
        dismissed_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_kw_dismiss_term ON keyword_dismissals(search_term, campaign);
    `);

    // Google OAuth tokens (for GA4 Data API access via user OAuth flow)
    await db.query(`
      CREATE TABLE IF NOT EXISTS google_oauth_tokens (
        id SERIAL PRIMARY KEY,
        purpose TEXT UNIQUE NOT NULL,
        refresh_token TEXT NOT NULL,
        access_token TEXT,
        access_token_expires_at TIMESTAMP,
        connected_email TEXT,
        connected_at TIMESTAMP DEFAULT NOW(),
        last_used TIMESTAMP
      );
    `);

    // Per-product GA4 funnel metrics, refreshed daily, joined to shopifyState
    await db.query(`
      CREATE TABLE IF NOT EXISTS ga4_product_metrics (
        page_path TEXT PRIMARY KEY,
        sessions INT DEFAULT 0,
        visitors INT DEFAULT 0,
        cart_additions INT DEFAULT 0,
        checkouts INT DEFAULT 0,
        purchases INT DEFAULT 0,
        engagement_rate REAL DEFAULT 0,
        avg_engagement_time REAL DEFAULT 0,
        bounce_rate REAL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Archived/dismissed Google campaigns. Two states:
    //   'dismissed' — agent flagged with reason, still appears on Active tab with pill
    //   'archived'  — manager has moved out of view, appears only in Archived tab
    await db.query(`
      CREATE TABLE IF NOT EXISTS google_campaign_archive (
        campaign_id TEXT PRIMARY KEY,
        campaign_name TEXT,
        campaign_type TEXT,
        archived_by TEXT,
        archived_at TIMESTAMP DEFAULT NOW(),
        reason TEXT,
        department TEXT DEFAULT 'google',
        state TEXT DEFAULT 'archived'
      );
      CREATE INDEX IF NOT EXISTS idx_archive_archived_at ON google_campaign_archive(archived_at DESC);
      CREATE INDEX IF NOT EXISTS idx_archive_state ON google_campaign_archive(state);
    `);
    // Migrate existing rows that don't have state column
    await db.query("ALTER TABLE google_campaign_archive ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'archived'");

    // ─── New AI/cache tables — isolated init so earlier failures can't block them ───
    // These were added later. Run them in their own try block so if migrations or
    // other init queries fail, these still get created.
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS landing_page_critiques (
          product_id TEXT PRIMARY KEY,
          product_title TEXT,
          product_url TEXT,
          generated_at TIMESTAMP DEFAULT NOW(),
          diagnosis TEXT,
          friction_json JSONB,
          actions_json JSONB,
          funnel_summary JSONB,
          ad_summary JSONB,
          page_summary JSONB,
          raw_ai_text TEXT,
          score NUMERIC DEFAULT 0
        );
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_lpc_generated_at ON landing_page_critiques(generated_at DESC)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_lpc_score ON landing_page_critiques(score DESC)");
      console.log('[INIT] landing_page_critiques table ready');
    } catch (e) {
      console.error('[INIT] landing_page_critiques error: ' + e.message);
    }

    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS campaign_ai_cache (
          campaign_id TEXT PRIMARY KEY,
          campaign_name TEXT,
          generated_at TIMESTAMP DEFAULT NOW(),
          analysis TEXT,
          model_used TEXT
        );
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_cac_generated_at ON campaign_ai_cache(generated_at DESC)");
      console.log('[INIT] campaign_ai_cache table ready');
    } catch (e) {
      console.error('[INIT] campaign_ai_cache error: ' + e.message);
    }

    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_page_cache (
          product_id TEXT PRIMARY KEY,
          product_url TEXT,
          fetched_at TIMESTAMP DEFAULT NOW(),
          page_summary JSONB,
          rule_friction JSONB,
          funnel_friction JSONB,
          ad_friction JSONB
        );
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_ppc_fetched_at ON product_page_cache(fetched_at DESC)");
      console.log('[INIT] product_page_cache table ready');
    } catch (e) {
      console.error('[INIT] product_page_cache error: ' + e.message);
    }

    // google_state_snapshots — persists the result of each Google Ads script ingest.
    // Why: googleState lives in process memory only, so any redeploy/restart wipes data
    // until the next 8am cron runs. With this table, the server boots and immediately
    // hydrates googleState from the most recent snapshot. Also keeps 30 days of history
    // for trend analysis later.
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS google_state_snapshots (
          id SERIAL PRIMARY KEY,
          received_at TIMESTAMP NOT NULL DEFAULT NOW(),
          campaigns JSONB,
          products JSONB,
          campaigns_count INTEGER DEFAULT 0,
          products_count INTEGER DEFAULT 0,
          last_sync_label TEXT
        );
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_gss_received_at ON google_state_snapshots(received_at DESC)");
      console.log('[INIT] google_state_snapshots table ready');
    } catch (e) {
      console.error('[INIT] google_state_snapshots error: ' + e.message);
    }

    try {
      const tasks = await db.query('SELECT id, campaign_name FROM campaign_tasks WHERE campaign_name IS NOT NULL');
      let fixed = 0;
      for (const row of tasks.rows) {
        const parts = (row.campaign_name||'').split(/[|@]/);
        const name = parts[0].trim();
        const agentName = (name.length > 0 && name.length < 30) ? name : null;
        if (agentName) {
          await db.query('UPDATE campaign_tasks SET agent_name=$1 WHERE id=$2', [agentName, row.id]);
          fixed++;
        }
      }
      if (fixed > 0) console.log('Fixed ' + fixed + ' task agent names');
    } catch(e) { console.error('Agent name fix error: ' + e.message); }
  } catch(e) {
    console.error('Tasks table error: ' + e.message);
  }
}

function scoreCampaignDays(days) {
  let baseScore = 0;
  let consecutiveDays = days.length;
  const totalSpend = days.reduce(function(s,d){ return s+(d.spend||0); }, 0);
  const totalSales = days.reduce(function(s,d){ return s+(d.sales||0); }, 0);
  const avgAcos = days.filter(function(d){ return d.spend>0; }).reduce(function(s,d,_,a){ return s+d.acos/a.length; }, 0);
  const noActivityDays = days.filter(function(d){ return (d.impressions||0)===0; }).length;
  const spendDays = days.filter(function(d){ return (d.spend||0)>0; });
  const noRevDays = spendDays.filter(function(d){ return (d.sales||0)===0; }).length;

  if (noRevDays >= 1) {
    if (totalSpend > 15) baseScore += 10;
    else if (totalSpend > 10) baseScore += 7;
    else if (totalSpend > 5) baseScore += 5;
  }
  if (avgAcos > 50 && totalSpend > 10) baseScore += 8;
  else if (avgAcos > 35 && totalSpend > 5) baseScore += 5;
  if (noActivityDays >= 3) baseScore += 8;
  else if (noActivityDays >= 2) baseScore += 5;
  else if (noActivityDays >= 1) baseScore += 2;

  const multiplier = Math.min(consecutiveDays, 3);
  const finalScore = baseScore * multiplier;
  return { score: finalScore, noActivityDays, noRevDays, totalSpend: totalSpend.toFixed(2), totalSales: totalSales.toFixed(2), avgAcos: avgAcos.toFixed(1) };
}

async function createAlertTask(campaignId, campaignName, agentName, portfolio, problemType, problemDetail) {
  if (!db) return;
  try {
    const today = new Date().toISOString().split('T')[0];
    const existing = await db.query(
      'SELECT id FROM campaign_tasks WHERE campaign_id=$1 AND created_date=$2 AND problem_type=$3 AND task_source=$4',
      [String(campaignId), today, problemType, 'alert']
    );
    if (existing.rows.length > 0) return;
    const scoreMap = { out_of_budget: 15, budget_low: 8, high_acos: 10 };
    await db.query(
      'INSERT INTO campaign_tasks (campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, score, task_source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [String(campaignId), campaignName, agentName||'Unassigned', portfolio||'', problemType, problemDetail, scoreMap[problemType]||8, 'alert']
    );
    console.log('Alert task created: ' + campaignName + ' (' + problemType + ')');
  } catch(e) {
    console.error('Alert task error: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Google task auto-creation (mirrors Amazon's daily scheduler, with Google
// data sources and a 25%-ACOS threshold). Called by the cron at 03:30 London.
// Stores tasks in the same campaign_tasks table with department='google' so
// the Amazon UI never sees them and the Google UI never sees Amazon ones.
//
// Two task scopes:
//   • Campaign-level: when the WHOLE campaign is unhealthy
//     (no activity OR overall high ACOS OR overall no-revenue-on-spend)
//   • Product-level: when a single product within a campaign is the issue
//
// Target: ~10 tasks created per day. Sorted by wasted-spend score; if more
// than 10 candidates, top 10 by score wins.
// ─────────────────────────────────────────────────────────────────────────

const GOOGLE_TASK_AGENTS = ['Rahul', 'Anuj'];        // self-allocate — task starts as 'Unassigned'
// FK Sports: 25% margin → 21% after Shopify fees → ads must stay under that to be profitable.
// 20% ACOS = break-even-ish; flag anything above as a problem.
// 12% ACOS or below = scale opportunity (campaigns deserving more budget).
const GOOGLE_TASK_ACOS_THRESHOLD = 20;               // % — above this is a problem
const GOOGLE_TASK_SCALE_ACOS_THRESHOLD = 12;         // % — below this and meaningful spend = scale opportunity
const GOOGLE_TASK_NO_REV_SPEND_MIN = 15;             // £ — spent more than this with £0 sales
const GOOGLE_TASK_HIGH_ACOS_SPEND_MIN = 10;          // £ — high ACOS needs at least this much spend
const GOOGLE_TASK_COST_PER_CONV_THRESHOLD = 12;      // £ — at £60 AOV, cost/conv > £12 = losing money
const GOOGLE_TASK_LOW_CTR_THRESHOLD = 0.5;           // % — below this with spend = audience/creative issue
const GOOGLE_TASK_CLICKS_NO_SALES_MIN = 50;          // clicks — got many clicks but 0 sales = page issue
const GOOGLE_TASK_SCALE_SPEND_MIN = 10;              // £ — must have spent at least this for scale candidate
const GOOGLE_TASK_DAILY_TARGET = 10;

function looksLikeGoogleAgent(agentName) {
  return GOOGLE_TASK_AGENTS.includes(agentName) || agentName === 'Unassigned';
}

async function googleTaskAlreadyExistsToday(campaignId, problemType, productKey) {
  if (!db) return true;  // fail-safe: assume exists, skip create
  try {
    // productKey is null for campaign-level tasks; otherwise a stable identifier per product
    const r = await db.query(
      "SELECT id FROM campaign_tasks " +
      "WHERE department='google' AND campaign_id=$1 AND problem_type=$2 " +
      "AND COALESCE(product_key, '')=$3 " +
      "AND created_date=CURRENT_DATE",
      [String(campaignId), problemType, productKey || '']
    );
    return r.rows.length > 0;
  } catch (e) {
    console.error('[GTASK] dup-check error: ' + e.message);
    return true;  // skip on error
  }
}

async function ensureGoogleTaskColumns() {
  if (!db) return;
  const alters = [
    ["product_key", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS product_key TEXT"],
    ["product_title", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS product_title TEXT"],
    ["baseline_spend", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS baseline_spend NUMERIC DEFAULT 0"],
    ["baseline_sales", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS baseline_sales NUMERIC DEFAULT 0"],
    ["baseline_acos", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS baseline_acos NUMERIC DEFAULT 0"],
    ["baseline_impressions", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS baseline_impressions INTEGER DEFAULT 0"],
    ["day7_decision", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS day7_decision TEXT"],
    ["day7_decision_at", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS day7_decision_at TIMESTAMP"],
    ["day7_note", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS day7_note TEXT"],
    ["task_type", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'problem'"],
    ["product_image_url", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS product_image_url TEXT"],
    ["priority", "ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 2"]
  ];
  let okCount = 0;
  for (const [name, sql] of alters) {
    try {
      await db.query(sql);
      okCount++;
    } catch (e) {
      console.error('[GTASK] could not add column ' + name + ': ' + e.message);
    }
  }
  console.log('[GTASK] columns ensured: ' + okCount + '/' + alters.length);
}

function scoreGoogleTask(spend, sales, problemType) {
  // Wasted spend = spend that didn't generate sales. Higher = more urgent.
  if (sales <= 0) return Math.round(spend * 100) / 100;
  const acos = (spend / sales) * 100;
  const target = 25;
  if (acos <= target) return 0;
  // Excess spend over target ACOS = wasted
  return Math.round((spend - sales * target / 100) * 100) / 100;
}

async function createGoogleTask(taskRow) {
  if (!db) return false;
  const exists = await googleTaskAlreadyExistsToday(taskRow.campaignId, taskRow.problemType, taskRow.productKey);
  if (exists) return false;

  // Try to enrich with Shopify product image URL (for product-level tasks)
  let productImageUrl = null;
  if (taskRow.productKey) {
    // productKey may be 'shopifyItemId' (e.g. xxx_xxx_<shopifyId>_xxx) or a custom id
    const parts = String(taskRow.productKey).split('_');
    const possibleShopifyId = parts.length >= 3 ? parts[2] : null;
    if (possibleShopifyId) {
      const sp = (shopifyState.products || []).find(function(p){ return String(p.id) === possibleShopifyId; });
      if (sp && sp.imageUrl) productImageUrl = sp.imageUrl;
    }
  }

  try {
    await db.query(
      "INSERT INTO campaign_tasks " +
      "(campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, score, task_source, " +
      " department, product_key, product_title, baseline_spend, baseline_sales, baseline_acos, baseline_impressions, " +
      " task_type, priority, product_image_url) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'google',$9,$10,$11,$12,$13,$14,$15,$16,$17)",
      [
        String(taskRow.campaignId),
        taskRow.campaignName,
        'Unassigned',
        taskRow.campaignType || '',
        taskRow.problemType,
        taskRow.problemDetail,
        Math.max(1, Math.round(taskRow.score)),
        'auto',
        taskRow.productKey || null,
        taskRow.productTitle || null,
        taskRow.baselineSpend || 0,
        taskRow.baselineSales || 0,
        taskRow.baselineAcos || 0,
        taskRow.baselineImpressions || 0,
        taskRow.taskType || 'problem',
        taskRow.priority || 2,
        productImageUrl
      ]
    );
    return true;
  } catch (e) {
    console.error('[GTASK] insert error: ' + e.message);
    return false;
  }
}

async function runGoogleTaskScheduler() {
  if (!db) {
    console.warn('[GTASK] no db — skipping run');
    return { created: 0 };
  }
  await ensureGoogleTaskColumns();

  const candidates = [];

  // Build a lookup from shopifyItemId → Shopify product (for inventory check on out-of-stock rule)
  const shopifyById = {};
  (shopifyState.products || []).forEach(function(sp) {
    shopifyById[String(sp.id)] = sp;
  });

  // ─── Campaign-level scan ────────────────────────────────────────────────
  // Aggregate per-campaign 7d totals from googleState
  const campaignTotals = {};
  (googleState.products || []).forEach(function(p) {
    const cid = String(p.campaignId || '');
    if (!cid) return;
    if (!campaignTotals[cid]) {
      campaignTotals[cid] = {
        campaignId: cid,
        campaignName: p.campaignName || '(unnamed)',
        campaignType: p.campaignType || '',
        spend: 0, sales: 0, conversions: 0, impressions: 0, clicks: 0
      };
    }
    const t = campaignTotals[cid];
    t.spend += p.spend || 0;
    t.sales += p.sales || 0;
    t.conversions += p.conversions || 0;
    t.impressions += p.impressions || 0;
    t.clicks += p.clicks || 0;
  });

  Object.values(campaignTotals).forEach(function(c) {
    const acos = c.sales > 0 ? (c.spend / c.sales) * 100 : Infinity;
    const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
    const costPerConv = c.conversions > 0 ? c.spend / c.conversions : null;

    // Rule 1 (P3): No activity — campaign exists but 0 impressions in last 7d
    if (c.impressions === 0 && c.spend === 0) {
      candidates.push({
        campaignId: c.campaignId, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'no_activity', taskType: 'problem', priority: 3,
        problemDetail: 'Campaign has 0 impressions in the last 7 days. Likely paused, out of budget, or has no eligible products.',
        score: 5,
        baselineSpend: c.spend, baselineSales: c.sales, baselineAcos: 0, baselineImpressions: c.impressions
      });
      return;
    }

    // Rule 2 (P1): No revenue despite spend >= £15
    if (c.sales === 0 && c.spend >= GOOGLE_TASK_NO_REV_SPEND_MIN) {
      candidates.push({
        campaignId: c.campaignId, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'no_revenue', taskType: 'problem', priority: 1,
        problemDetail: 'Spent £' + c.spend.toFixed(2) + ' over 7 days with £0 attributed sales (' + c.clicks + ' clicks, ' + c.conversions + ' conv).',
        score: scoreGoogleTask(c.spend, 0, 'no_revenue'),
        baselineSpend: c.spend, baselineSales: 0, baselineAcos: 0, baselineImpressions: c.impressions
      });
      return;
    }

    // Rule 3 (P1): Many clicks, no sales — landing page or product issue
    if (c.sales === 0 && c.clicks >= GOOGLE_TASK_CLICKS_NO_SALES_MIN) {
      // Already covered by Rule 2 if spend is high too — but if spend is low and clicks high, this catches it
      candidates.push({
        campaignId: c.campaignId, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'clicks_no_sales', taskType: 'problem', priority: 1,
        problemDetail: c.clicks + ' clicks but 0 sales in 7 days. Page or product is not closing — check landing page critique and price.',
        score: scoreGoogleTask(c.spend, 0, 'clicks_no_sales'),
        baselineSpend: c.spend, baselineSales: 0, baselineAcos: 0, baselineImpressions: c.impressions
      });
      return;
    }

    // Rule 4 (P2): High ACOS — campaign selling but losing money
    if (acos !== Infinity && acos > GOOGLE_TASK_ACOS_THRESHOLD && c.spend >= GOOGLE_TASK_HIGH_ACOS_SPEND_MIN) {
      candidates.push({
        campaignId: c.campaignId, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'high_acos', taskType: 'problem', priority: 2,
        problemDetail: 'ACOS ' + acos.toFixed(0) + '% (target ' + GOOGLE_TASK_ACOS_THRESHOLD + '%). Spend £' + c.spend.toFixed(2) + ', sales £' + c.sales.toFixed(2) + ' over 7 days.',
        score: scoreGoogleTask(c.spend, c.sales, 'high_acos'),
        baselineSpend: c.spend, baselineSales: c.sales, baselineAcos: acos, baselineImpressions: c.impressions
      });
      return;
    }

    // Rule 5 (P2): High cost per conversion — even when ACOS reads OK, cost/conv > £12 is unprofitable
    if (costPerConv !== null && costPerConv > GOOGLE_TASK_COST_PER_CONV_THRESHOLD && c.spend >= GOOGLE_TASK_HIGH_ACOS_SPEND_MIN) {
      candidates.push({
        campaignId: c.campaignId, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'high_cost_per_conv', taskType: 'problem', priority: 2,
        problemDetail: 'Cost per conversion £' + costPerConv.toFixed(2) + ' (target under £' + GOOGLE_TASK_COST_PER_CONV_THRESHOLD + '). Spend £' + c.spend.toFixed(2) + ' / ' + c.conversions + ' conv.',
        score: scoreGoogleTask(c.spend, c.sales, 'high_cost_per_conv'),
        baselineSpend: c.spend, baselineSales: c.sales, baselineAcos: acos === Infinity ? 0 : acos, baselineImpressions: c.impressions
      });
      return;
    }

    // Rule 6 (P3): Low CTR — ad showing but nobody clicking → wrong audience or weak creative
    if (ctr < GOOGLE_TASK_LOW_CTR_THRESHOLD && c.spend >= GOOGLE_TASK_HIGH_ACOS_SPEND_MIN && c.impressions >= 1000) {
      candidates.push({
        campaignId: c.campaignId, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'low_ctr', taskType: 'problem', priority: 3,
        problemDetail: 'CTR ' + ctr.toFixed(2) + '% (' + c.clicks + ' clicks of ' + c.impressions + ' impressions). Wrong audience or weak ad creative.',
        score: Math.round(c.spend),
        baselineSpend: c.spend, baselineSales: c.sales, baselineAcos: acos === Infinity ? 0 : acos, baselineImpressions: c.impressions
      });
      return;
    }

    // ─── Scale opportunity (separate task type) ───────────────────────────
    // Campaign performing well — ACOS under 12% with meaningful spend → could absorb more budget
    if (acos !== Infinity && acos < GOOGLE_TASK_SCALE_ACOS_THRESHOLD && c.spend >= GOOGLE_TASK_SCALE_SPEND_MIN && c.sales >= 30) {
      candidates.push({
        campaignId: c.campaignId, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'scale_opportunity', taskType: 'scale', priority: 4,
        problemDetail: 'Healthy ACOS ' + acos.toFixed(0) + '% — well under 12% target. Spend £' + c.spend.toFixed(2) + ' generated £' + c.sales.toFixed(2) + '. Consider increasing budget 20-30%.',
        score: Math.round(c.sales - c.spend),  // profit = headroom for scaling
        baselineSpend: c.spend, baselineSales: c.sales, baselineAcos: acos, baselineImpressions: c.impressions
      });
    }
  });

  // ─── Product-level scan ────────────────────────────────────────────────
  (googleState.products || []).forEach(function(p) {
    const cid = String(p.campaignId || '');
    const c = campaignTotals[cid];
    if (!c) return;

    const overallAcos = c.sales > 0 ? (c.spend / c.sales) * 100 : Infinity;
    const productAcos = p.sales > 0 ? (p.spend / p.sales) * 100 : Infinity;
    const productSpend = p.spend || 0;
    const productSales = p.sales || 0;
    const productClicks = p.clicks || 0;
    const productKey = p.shopifyItemId || p.productId || (p.adGroupId ? cid + '_' + p.adGroupId : null);
    const productTitle = p.name || p.productName || p.title || '(unknown product)';

    if (!productKey) return;

    // Skip if the WHOLE campaign already flagged — campaign-level task covers it
    const campaignAlreadyFlagged = candidates.some(function(t){
      return !t.productKey && t.campaignId === cid && t.taskType === 'problem';
    });
    if (campaignAlreadyFlagged) return;

    // Product-level Rule 1 (P1): Out of stock with ad spend — sale is literally impossible
    if (productSpend > 0) {
      const shopifyId = p.shopifyItemId ? String(p.shopifyItemId).split('_')[2] : null;
      const sp = shopifyId ? shopifyById[shopifyId] : null;
      if (sp && sp.totalInventory != null && Number(sp.totalInventory) <= 0) {
        candidates.push({
          campaignId: cid, campaignName: c.campaignName, campaignType: c.campaignType,
          problemType: 'product_out_of_stock', taskType: 'problem', priority: 1,
          problemDetail: '"' + productTitle + '" has 0 inventory in Shopify but ads are still spending £' + productSpend.toFixed(2) + ' on it. Sale is impossible — pause this product or restock.',
          score: scoreGoogleTask(productSpend, 0, 'product_out_of_stock') + 50,  // boost score — this is critical
          productKey: String(productKey),
          productTitle: productTitle,
          baselineSpend: productSpend, baselineSales: productSales, baselineAcos: 0, baselineImpressions: p.impressions || 0
        });
        return;
      }
    }

    // Product-level Rule 2 (P1): spent > £15 with £0 sales while campaign overall is fine
    if (productSales === 0 && productSpend >= GOOGLE_TASK_NO_REV_SPEND_MIN) {
      candidates.push({
        campaignId: cid, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'product_no_revenue', taskType: 'problem', priority: 1,
        problemDetail: '"' + productTitle + '" has spent £' + productSpend.toFixed(2) + ' with £0 sales in 7 days, while the rest of the campaign performs normally.',
        score: scoreGoogleTask(productSpend, 0, 'product_no_revenue'),
        productKey: String(productKey),
        productTitle: productTitle,
        baselineSpend: productSpend, baselineSales: 0, baselineAcos: 0, baselineImpressions: p.impressions || 0
      });
      return;
    }

    // Product-level Rule 3 (P1): Many clicks no sales (lower threshold for product than campaign — clicks aren't shared)
    if (productSales === 0 && productClicks >= 25) {
      candidates.push({
        campaignId: cid, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'product_clicks_no_sales', taskType: 'problem', priority: 1,
        problemDetail: '"' + productTitle + '" got ' + productClicks + ' clicks but 0 sales in 7 days. Likely landing page or pricing issue.',
        score: scoreGoogleTask(productSpend, 0, 'product_clicks_no_sales'),
        productKey: String(productKey),
        productTitle: productTitle,
        baselineSpend: productSpend, baselineSales: 0, baselineAcos: 0, baselineImpressions: p.impressions || 0
      });
      return;
    }

    // Product-level Rule 4 (P2): product ACOS > 20% AND noticeably worse than campaign average
    if (productAcos !== Infinity && productAcos > GOOGLE_TASK_ACOS_THRESHOLD
        && productSpend >= GOOGLE_TASK_HIGH_ACOS_SPEND_MIN
        && (overallAcos === Infinity || productAcos > overallAcos * 1.5)) {
      candidates.push({
        campaignId: cid, campaignName: c.campaignName, campaignType: c.campaignType,
        problemType: 'product_high_acos', taskType: 'problem', priority: 2,
        problemDetail: '"' + productTitle + '" ACOS ' + productAcos.toFixed(0) + '% (campaign avg ' + (overallAcos === Infinity ? 'N/A' : overallAcos.toFixed(0) + '%') + '). Spent £' + productSpend.toFixed(2) + ', sales £' + productSales.toFixed(2) + '.',
        score: scoreGoogleTask(productSpend, productSales, 'product_high_acos'),
        productKey: String(productKey),
        productTitle: productTitle,
        baselineSpend: productSpend, baselineSales: productSales, baselineAcos: productAcos, baselineImpressions: p.impressions || 0
      });
    }
  });

  // Sort by priority (P1 > P2 > P3 > P4-scale) then by score descending
  candidates.sort(function(a, b){
    const pa = a.priority || 9;
    const pb = b.priority || 9;
    if (pa !== pb) return pa - pb;
    return (b.score || 0) - (a.score || 0);
  });
  const top = candidates.slice(0, GOOGLE_TASK_DAILY_TARGET);

  let createdCount = 0;
  for (const taskRow of top) {
    const ok = await createGoogleTask(taskRow);
    if (ok) createdCount++;
  }

  console.log('[GTASK] daily run: ' + candidates.length + ' candidates, ' + top.length + ' targeted, ' + createdCount + ' new tasks created');
  return { created: createdCount, candidates: candidates.length };
}

async function runDailyTaskScheduler() {
  if (!db) { console.log('No DB - skipping task scheduler'); return; }
  console.log('Running daily task scheduler...');
  const dashUrl = process.env.DASHBOARD_URL || 'https://campaignpulse-setup-production.up.railway.app';

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const result = await db.query(
      'SELECT snapshot_date, campaigns FROM daily_snapshots WHERE snapshot_date <= $1 ORDER BY snapshot_date DESC LIMIT 3',
      [yesterdayStr]
    );

    if (!result.rows.length) { console.log('No historical snapshots yet for task scheduler'); return; }
    console.log('Task scheduler using ' + result.rows.length + ' days of history');

    const agentCampaigns = {};
    const campHistory = {};

    result.rows.forEach(function(snap) {
      const camps = snap.campaigns || [];
      camps.forEach(function(c) {
        if (!c.campaignId) return;
        const agent = extractAgentFromCampaign(c.name) || 'Unassigned';
        if (!['Aryan','Satyam','Kunal'].includes(agent)) return;
        if (!campHistory[c.campaignId]) {
          campHistory[c.campaignId] = { campaignId: c.campaignId, name: c.name || '', agent: agent, portfolio: c.portfolio || '', targetingType: c.targetingType || '', days: [] };
        }
        campHistory[c.campaignId].days.push({ date: snap.snapshot_date, impressions: c.impressions || 0, spend: c.spend || 0, sales: c.sales || 0, acos: c.acos || 0, dailyBudget: c.dailyBudget || 0 });
        if (!agentCampaigns[agent]) agentCampaigns[agent] = [];
        if (!agentCampaigns[agent].find(function(x){ return x.campaignId === c.campaignId; })) {
          agentCampaigns[agent].push(campHistory[c.campaignId]);
        }
      });
    });

    const today = new Date().toISOString().split('T')[0];

    for (const agentName of Object.keys(agentCampaigns)) {
      const agentCamps = agentCampaigns[agentName];
      const openTasksRes = await db.query(
        'SELECT COUNT(*) as cnt FROM campaign_tasks WHERE agent_name=$1 AND status IN ($2,$3) AND task_source=$4',
        [agentName, 'open', 'in_progress', 'daily']
      );
      const openCount = parseInt(openTasksRes.rows[0].cnt || 0);
      if (openCount >= 10) { console.log(agentName + ' already has ' + openCount + ' open tasks - skipping'); continue; }

      const slotsAvailable = Math.min(5, 10 - openCount);
      if (slotsAvailable <= 0) continue;

      const scored = [];
      agentCamps.forEach(function(camp) {
        if (!camp.days.length) return;
        const scoring = scoreCampaignDays(camp.days);
        if (scoring.score === 0) return;
        let problemType = 'investigation';
        let problemDetail = '';
        if (scoring.noActivityDays >= 1) { problemType = 'no_activity'; problemDetail = scoring.noActivityDays + ' day(s) zero impressions'; }
        else if (scoring.noRevDays >= 1) { problemType = 'no_revenue'; problemDetail = '£' + scoring.totalSpend + ' spent over ' + camp.days.length + ' day(s) with zero revenue'; }
        else if (parseFloat(scoring.avgAcos) > 35) { problemType = 'high_acos'; problemDetail = scoring.avgAcos + '% avg ACOS over ' + camp.days.length + ' day(s), spend £' + scoring.totalSpend; }
        scored.push({ camp: camp, score: scoring.score, problemType: problemType, problemDetail: problemDetail, scoring: scoring });
      });

      scored.sort(function(a,b){ return b.score - a.score; });
      let newTasksCreated = 0;

      for (const item of scored) {
        if (newTasksCreated >= slotsAvailable) break;
        const c = item.camp;
        const existingToday = await db.query(
          'SELECT id FROM campaign_tasks WHERE campaign_id=$1 AND created_date=$2 AND task_source=$3',
          [String(c.campaignId), today, 'daily']
        );
        if (existingToday.rows.length > 0) continue;

        const prevTask = await db.query(
          'SELECT id, days_persisted FROM campaign_tasks WHERE campaign_id=$1 AND status IN ($2,$3) AND task_source=$4 ORDER BY created_date DESC LIMIT 1',
          [String(c.campaignId), 'open', 'in_progress', 'daily']
        );

        let daysPersisted = 1;
        let isSuperUrgent = false;

        if (prevTask.rows.length > 0) {
          daysPersisted = (prevTask.rows[0].days_persisted || 1) + 1;
          isSuperUrgent = daysPersisted >= 3;
          await db.query('UPDATE campaign_tasks SET days_persisted=$1, score=$2, updated_at=NOW() WHERE id=$3', [daysPersisted, item.score, prevTask.rows[0].id]);
          if (isSuperUrgent) {
            await sendGoogleChat(['🚨 SUPER URGENT - Day ' + daysPersisted + ' UNRESOLVED', 'Campaign: ' + c.name, 'Agent: ' + agentName, 'Problem: ' + item.problemDetail, 'Score: ' + item.score, 'This has been unresolved for ' + daysPersisted + ' days - manager action needed'].join('\n'));
          }
        }

        let isRepeatOffender = false;
        let failureCount = 1;
        try {
          const repeatCheck = await db.query(
            "SELECT id, failure_count FROM campaign_tasks WHERE campaign_id=$1 AND status='complete' AND last_resolved_date > NOW() - INTERVAL '14 days' ORDER BY last_resolved_date DESC LIMIT 1",
            [String(c.campaignId)]
          );
          if (repeatCheck.rows.length > 0) { isRepeatOffender = true; failureCount = (repeatCheck.rows[0].failure_count || 1) + 1; console.log('REPEAT OFFENDER detected: ' + c.name + ' (failure #' + failureCount + ')'); }
        } catch(e) { console.error('Repeat check error: ' + e.message); }

        await db.query(
          'INSERT INTO campaign_tasks (campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, days_persisted, total_wasted, score, task_source, is_repeat_offender, failure_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [String(c.campaignId), c.name, agentName, c.portfolio||'', item.problemType, item.problemDetail, daysPersisted, parseFloat(item.scoring.totalSpend), item.score, 'daily', isRepeatOffender, failureCount]
        );

        try {
          await db.query(
            'INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, status_before, status_after) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [String(c.campaignId), c.name, agentName, 'task_created', item.problemDetail + (isRepeatOffender ? ' [REPEAT OFFENDER #' + failureCount + ']' : ''), 'none', 'open']
          );
        } catch(e) { console.error('Activity log create error: ' + e.message); }

        const urgencyLabel = isSuperUrgent ? '🚨 SUPER URGENT - Day ' + daysPersisted : (daysPersisted > 1 ? '⚠ Day ' + daysPersisted + ' - Unresolved' : '📋 New Task');
        const msg = [urgencyLabel, 'Campaign: ' + c.name, 'Problem: ' + item.problemDetail, 'Score: ' + item.score + ' (higher = more urgent)', '', dashUrl + '/tasks'].join('\n');
        const sent = await sendToAgent(agentName, msg);
        if (!sent) console.log('No webhook for ' + agentName + ' - task created silently');

        newTasksCreated++;
        console.log('Daily task created for ' + agentName + ': ' + c.name + ' (Day ' + daysPersisted + ', score ' + item.score + ')');
      }
      console.log(agentName + ': ' + newTasksCreated + ' new tasks created, ' + openCount + ' already open');
    }
    console.log('Daily task scheduler complete');
  } catch(e) { console.error('Task scheduler error: ' + e.message); }
}

// ── API Routes ────────────────────────────────────────────────────────────
app.get('/api/dashboard', async function(req, res) {
  const campaigns = state.campaigns;
  const totalRevenue = campaigns.reduce(function(s, c) { return s + (c.sales || 0); }, 0);
  const totalSpend = campaigns.reduce(function(s, c) { return s + (c.spend || 0); }, 0);
  const blendedAcos = totalRevenue > 0 ? Math.round((totalSpend / totalRevenue) * 1000) / 10 : 0;
  const active = campaigns.filter(function(c) { return c.state === 'enabled'; }).length;
  const needsAction = campaigns.filter(function(c) { return c.budgetRemaining <= 0.01 || c.acos > parseFloat(process.env.ACOS_CRITICAL_THRESHOLD || 35) || c.budgetPct >= 80; }).length;

  let filteredAlerts = state.alerts.slice(-20);
  if (db) {
    try {
      const dismissed = await db.query("SELECT campaign_id FROM campaign_tasks WHERE task_source='alert' AND status='dismissed' AND DATE(updated_at)=CURRENT_DATE");
      const dismissedIds = new Set(dismissed.rows.map(function(r){ return String(r.campaign_id); }));
      if (dismissedIds.size > 0) filteredAlerts = filteredAlerts.filter(function(a){ return !dismissedIds.has(String(a.campaignId)); });
    } catch(e) {}
  }

  res.json({
    metrics: { totalRevenue: totalRevenue.toFixed(2), totalSpend: totalSpend.toFixed(2), blendedAcos: blendedAcos, activeCampaigns: active, needsAction: needsAction },
    campaigns: campaigns, alerts: filteredAlerts, exhaustionLog: state.exhaustionLog, lastSync: state.lastSync, error: state.error
  });
});

app.post('/api/ai/analyse', async function(req, res) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ error: 'No API key', result: null });
    const acosTarget = parseFloat(process.env.ACOS_WARNING_THRESHOLD || 12);
    const acosCritical = parseFloat(process.env.ACOS_CRITICAL_THRESHOLD || 35);

    let historicalSummary = '';
    let campHistory = {};
    if (db) {
      try {
        const result = await db.query('SELECT snapshot_date, metrics, campaigns FROM daily_snapshots ORDER BY snapshot_date DESC LIMIT 7');
        if (result.rows.length > 0) {
          result.rows.forEach(function(snap) {
            const camps = snap.campaigns || [];
            camps.forEach(function(c) {
              if (!campHistory[c.campaignId]) campHistory[c.campaignId] = { name: c.name, portfolio: c.portfolio||'', days: [] };
              campHistory[c.campaignId].days.push({ date: snap.snapshot_date, spend: c.spend||0, sales: c.sales||0, acos: c.acos||0, impressions: c.impressions||0, budget: c.dailyBudget||0 });
            });
          });
          const metrics = result.rows[0].metrics || {};
          historicalSummary = 'Historical data available: ' + result.rows.length + ' days. Latest day: Revenue £' + metrics.totalRevenue + ', Spend £' + metrics.totalSpend + ', ACOS ' + metrics.blendedAcos + '%, Wasted spend £' + metrics.totalWastedSpend;
        }
      } catch(e) { console.error('AI history fetch: ' + e.message); }
    }

    const scaleList = [], pauseList = [], reduceList = [];
    Object.values(campHistory).forEach(function(camp) {
      const days = camp.days;
      if (!days.length) return;
      const spendDays = days.filter(function(d){ return d.spend > 0; });
      if (!spendDays.length) return;
      const avgAcos = spendDays.reduce(function(s,d){ return s+d.acos; }, 0) / spendDays.length;
      const totalSpend = days.reduce(function(s,d){ return s+d.spend; }, 0);
      const totalSales = days.reduce(function(s,d){ return s+d.sales; }, 0);
      const noRevDays = spendDays.filter(function(d){ return d.sales === 0; }).length;
      const noActDays = days.filter(function(d){ return d.impressions === 0; }).length;
      const avgBudget = spendDays.reduce(function(s,d){ return s+d.budget; }, 0) / spendDays.length;
      if (noActDays >= 3) { pauseList.push({ name: camp.name, portfolio: camp.portfolio, reason: 'Zero impressions for ' + noActDays + ' days', action: 'Pause and review targeting', spend: totalSpend.toFixed(2), acos: '—' }); }
      else if (noRevDays >= 5 && totalSpend > 10) { pauseList.push({ name: camp.name, portfolio: camp.portfolio, reason: noRevDays + ' days spend with zero revenue, £' + totalSpend.toFixed(2) + ' wasted', action: 'Pause campaign', spend: totalSpend.toFixed(2), acos: avgAcos.toFixed(1) + '%' }); }
      else if (avgAcos > acosCritical && spendDays.length >= 3) { reduceList.push({ name: camp.name, portfolio: camp.portfolio, reason: avgAcos.toFixed(1) + '% avg ACOS over ' + spendDays.length + ' days (target: ' + acosTarget + '%)', action: 'Reduce bids by 20% or add negative keywords', spend: totalSpend.toFixed(2), acos: avgAcos.toFixed(1) + '%' }); }
      else if (avgAcos > 0 && avgAcos < acosTarget && totalSales > 20 && spendDays.length >= 3) { scaleList.push({ name: camp.name, portfolio: camp.portfolio, reason: avgAcos.toFixed(1) + '% avg ACOS over ' + spendDays.length + ' days, £' + totalSales.toFixed(2) + ' revenue', action: 'Increase daily budget from £' + avgBudget.toFixed(2) + ' to £' + (avgBudget * 1.5).toFixed(2), spend: totalSpend.toFixed(2), acos: avgAcos.toFixed(1) + '%' }); }
    });

    if (!Object.keys(campHistory).length) {
      const allCamps = state.campaigns;
      allCamps.forEach(function(c) {
        if (c.acos > 0 && c.acos < acosTarget && c.sales > 5) scaleList.push({ name: c.name, portfolio: c.portfolio||'', reason: c.acos + '% ACOS today', action: 'Increase daily budget from £' + c.dailyBudget + ' to £' + (c.dailyBudget * 1.5).toFixed(2), spend: (c.spend||0).toString(), acos: c.acos + '%' });
        else if (c.acos > acosCritical && c.spend > 5) reduceList.push({ name: c.name, portfolio: c.portfolio||'', reason: c.acos + '% ACOS today', action: 'Reduce bids or add negative keywords', spend: (c.spend||0).toString(), acos: c.acos + '%' });
      });
    }

    let strategicInsight = '';
    if (apiKey && (scaleList.length || pauseList.length || reduceList.length)) {
      const prompt = ['You are an Amazon Advertising expert for FK Sports UK (sports equipment). ACOS target is ' + acosTarget + '%.', historicalSummary, 'Scale candidates (' + scaleList.length + '): ' + scaleList.slice(0,5).map(function(c){ return c.name + ' (' + c.acos + ')'; }).join(', '), 'Pause candidates (' + pauseList.length + '): ' + pauseList.slice(0,5).map(function(c){ return c.name; }).join(', '), 'Reduce budget candidates (' + reduceList.length + '): ' + reduceList.slice(0,5).map(function(c){ return c.name + ' (' + c.acos + ')'; }).join(', '), 'In 3-4 sentences give ONE strategic insight about FK Sports campaign performance that would not be obvious from looking at individual campaigns. Focus on patterns, seasonality, or structural issues. Be specific and actionable.'].join(' ');
      try {
        const aiRes = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-opus-4-5-20251101', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }, { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
        strategicInsight = aiRes.data.content[0].text;
      } catch(e) { console.error('AI insight error: ' + e.message); }
    }

    res.json({ result: { scaleList, pauseList, reduceList, strategicInsight, acosTarget, daysOfData: Object.values(campHistory)[0]?.days?.length || 0 } });
  } catch(e) { console.error('AI error: ' + e.message); res.json({ error: e.message, result: null }); }
});

// ── Keyword Intelligence ─────────────────────────────────────────────────
let keywordState = { reportId: null, requested: 0, data: null, analysis: null, lastAnalysed: 0 };

async function requestSearchTermReport() {
  const now = Date.now();
  if (keywordState.reportId || (now - keywordState.requested) < 7 * 24 * 60 * 60 * 1000) return;
  const token = await getAccessToken();
  const profileId = await getProfileId();
  const headers = getHeaders(profileId, token);
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  try {
    const res = await axios.post('https://advertising-api-eu.amazon.com/reporting/reports', { name: 'CampaignPulse Search Terms ' + today, startDate: weekAgo, endDate: today, configuration: { adProduct: 'SPONSORED_PRODUCTS', groupBy: ['searchTerm'], columns: ['campaignId', 'campaignName', 'adGroupId', 'adGroupName', 'keywordId', 'keyword', 'matchType', 'searchTerm', 'cost', 'clicks', 'impressions', 'purchases14d', 'sales14d'], reportTypeId: 'spSearchTerm', timeUnit: 'SUMMARY', format: 'GZIP_JSON' } }, { headers: Object.assign({}, headers, { 'Content-Type': 'application/json', 'Accept': 'application/json' }) });
    keywordState.reportId = res.data.reportId;
    keywordState.requested = now;
    console.log('Search term report requested: ' + keywordState.reportId);
  } catch(e) { console.error('Search term report error: ' + e.message); }
}

async function checkSearchTermReport() {
  if (!keywordState.reportId) return;
  const token = await getAccessToken();
  const profileId = await getProfileId();
  const headers = getHeaders(profileId, token);
  try {
    const statusRes = await axios.get('https://advertising-api-eu.amazon.com/reporting/reports/' + keywordState.reportId, { headers: Object.assign({}, headers, { 'Accept': 'application/json' }) });
    const status = statusRes.data.status;
    console.log('Search term report status: ' + status);
    if (status === 'COMPLETED') {
      const downloadRes = await axios.get(statusRes.data.url, { responseType: 'arraybuffer' });
      const zlib = require('zlib');
      const decompressed = zlib.gunzipSync(Buffer.from(downloadRes.data));
      keywordState.data = JSON.parse(decompressed.toString());
      keywordState.reportId = null;
      console.log('Search term report downloaded: ' + keywordState.data.length + ' records');
      await analyseKeywords();
    } else if (status === 'FAILED') { console.log('Search term report failed'); keywordState.reportId = null; }
  } catch(e) { console.error('Search term check error: ' + e.message); keywordState.reportId = null; }
}

async function analyseKeywords() {
  if (!keywordState.data || !keywordState.data.length) return;
  if (!process.env.ANTHROPIC_API_KEY) { keywordState.analysis = ruleBasedKeywordAnalysis(keywordState.data); return; }
  try {
    const data = keywordState.data;
    const wasters = data.filter(function(r){ return parseFloat(r.cost||0) > 5 && parseInt(r.purchases14d||0) === 0 && parseInt(r.clicks||0) > 3; }).sort(function(a,b){ return parseFloat(b.cost||0) - parseFloat(a.cost||0); }).slice(0, 20);
    const converters = data.filter(function(r){ return parseInt(r.purchases14d||0) > 0 && r.matchType !== 'EXACT'; }).sort(function(a,b){ return parseInt(b.purchases14d||0) - parseInt(a.purchases14d||0); }).slice(0, 20);
    const autoWasters = wasters.filter(function(r){ return (r.campaignName||'').toLowerCase().includes('auto'); });
    const manualWasters = wasters.filter(function(r){ return !(r.campaignName||'').toLowerCase().includes('auto'); });
    const autoConverters = converters.filter(function(r){ return (r.campaignName||'').toLowerCase().includes('auto'); });
    const manualConverters = converters.filter(function(r){ return !(r.campaignName||'').toLowerCase().includes('auto'); });
    const totalWastedSpend = wasters.reduce(function(s,r){ return s+parseFloat(r.cost||0); }, 0);
    const totalConvValue = converters.reduce(function(s,r){ return s+parseFloat(r.sales14d||0); }, 0);

    let dismissedLines = '';
    try {
      const dismissed = await db.query('SELECT search_term, campaign, reason FROM keyword_dismissals ORDER BY dismissed_at DESC LIMIT 100');
      if (dismissed.rows.length > 0) dismissedLines = 'PREVIOUSLY DISMISSED KEYWORDS (do NOT recommend these again):\n' + dismissed.rows.map(function(d){ return d.search_term + ' | Campaign: ' + d.campaign + ' | Reason: ' + d.reason; }).join('\n') + '\n';
    } catch(e) {}

    const NL = '\n';
    const wasteAutoLines = autoWasters.slice(0,25).map(function(r){ return r.searchTerm + ' | £' + parseFloat(r.cost||0).toFixed(2) + ' | ' + (r.clicks||0) + ' clicks | ' + r.campaignName; }).join(NL);
    const wasteManualLines = manualWasters.slice(0,25).map(function(r){ return r.searchTerm + ' | £' + parseFloat(r.cost||0).toFixed(2) + ' | ' + (r.clicks||0) + ' clicks | ' + r.campaignName; }).join(NL);
    const convAutoLines = autoConverters.slice(0,25).map(function(r){ return r.searchTerm + ' | ' + r.purchases14d + ' purchases | £' + parseFloat(r.sales14d||0).toFixed(2) + ' | ' + (r.matchType||'') + ' | ' + r.campaignName; }).join(NL);
    const convManualLines = manualConverters.slice(0,25).map(function(r){ return r.searchTerm + ' | ' + r.purchases14d + ' purchases | £' + parseFloat(r.sales14d||0).toFixed(2) + ' | ' + (r.matchType||'') + ' | ' + r.campaignName; }).join(NL);
    const jsonFmt = '{"wasteReduction":{"totalWasted":"£X","estimatedSaving":"£X/week","topWasters":[{"searchTerm":"","campaign":"","campaignType":"auto or manual","spend":"£X","clicks":0,"recommendation":"","reason":""}]},"newKeywords":{"totalOpportunities":0,"estimatedRevenue":"£X/week","topOpportunities":[{"searchTerm":"","campaign":"","campaignType":"auto or manual","purchases":0,"sales":"£X","matchType":"","recommendation":"","estimatedImpact":""}]},"patterns":{"wastePatterns":"","keyInsight":""},"structuralChange":{"recommendation":"","expectedImpact":"","priority":"high"},"summary":"","estimatedWeeklyImpact":"£X"}';
    const prompt = ['You are an Amazon Advertising expert for FK Sports UK (fitness equipment).', 'Analyse 7-day search term data. Total: ' + data.length + ' terms. Wasted: £' + totalWastedSpend.toFixed(2) + '. Converting value: £' + totalConvValue.toFixed(2), '', 'WASTING TERMS AUTO (' + autoWasters.length + '):', wasteAutoLines, 'WASTING TERMS MANUAL (' + manualWasters.length + '):', wasteManualLines, '', 'CONVERTING NOT EXACT - AUTO (' + autoConverters.length + '):', convAutoLines, 'CONVERTING NOT EXACT - MANUAL (' + manualConverters.length + '):', convManualLines, '', dismissedLines, 'Q1: Which terms need NEGATIVE KEYWORDS?', 'Q2: Which converting terms become EXACT MATCH?', 'Q3: Patterns in wasting terms?', 'Q4: Single most impactful structural change?', '', 'Return ONLY valid JSON, no other text:', jsonFmt].join(NL);

    const aiRes = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-opus-4-5-20251101', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }, { headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } });
    const text = aiRes.data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const jsonStart = clean.indexOf('{');
    const jsonEnd = clean.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found in response');
    const parsed = JSON.parse(clean.substring(jsonStart, jsonEnd + 1));
    keywordState.analysis = { wasteReduction: parsed.wasteReduction || {}, newKeywords: parsed.newKeywords || {}, bidChanges: parsed.bidChanges || [], portfolioInsights: { patterns: (parsed.patterns && parsed.patterns.keyInsight) || (parsed.portfolioInsights && parsed.portfolioInsights.patterns) || '', topPerforming: (parsed.portfolioInsights && parsed.portfolioInsights.topPerforming) || '', needsAttention: (parsed.portfolioInsights && parsed.portfolioInsights.needsAttention) || '' }, structuralChange: parsed.structuralChange || null, summary: parsed.summary || '', estimatedWeeklyImpact: parsed.estimatedWeeklyImpact || '' };
    keywordState.lastAnalysed = Date.now();
    console.log('Keyword AI analysis complete');
  } catch(e) { console.error('Keyword analysis error: ' + e.message); keywordState.analysis = ruleBasedKeywordAnalysis(keywordState.data); }
}

function ruleBasedKeywordAnalysis(data) {
  const wasters = data.filter(function(r){ return parseFloat(r.cost||0) > 5 && parseInt(r.purchases14d||0) === 0 && parseInt(r.clicks||0) > 3; }).sort(function(a,b){ return parseFloat(b.cost||0) - parseFloat(a.cost||0); }).slice(0, 10);
  const converters = data.filter(function(r){ return parseInt(r.purchases14d||0) > 0 && r.matchType !== 'EXACT'; }).sort(function(a,b){ return parseInt(b.purchases14d||0) - parseInt(a.purchases14d||0); }).slice(0, 10);
  const totalWasted = wasters.reduce(function(s,r){ return s + parseFloat(r.cost||0); }, 0);
  return { wasteReduction: { totalWasted: '£' + totalWasted.toFixed(2), topWasters: wasters.map(function(r){ return { searchTerm: r.searchTerm, campaign: r.campaignName, spend: '£' + parseFloat(r.cost||0).toFixed(2), recommendation: 'Add as negative keyword', reason: 'Zero conversions after £' + parseFloat(r.cost||0).toFixed(2) + ' spend' }; }), estimatedSaving: '£' + totalWasted.toFixed(2) + '/week' }, newKeywords: { totalOpportunities: converters.length, topOpportunities: converters.map(function(r){ return { searchTerm: r.searchTerm, campaign: r.campaignName, purchases: r.purchases14d, sales: '£' + parseFloat(r.sales14d||0).toFixed(2), recommendation: 'Add as exact match keyword', estimatedImpact: 'Lower ACOS, more targeted traffic' }; }) }, bidChanges: [], portfolioInsights: { patterns: 'Analysis based on last 7 days of search term data', topPerforming: converters[0] ? converters[0].campaignName : 'N/A', needsAttention: wasters[0] ? wasters[0].campaignName : 'N/A' }, summary: 'Found ' + wasters.length + ' wasting search terms and ' + converters.length + ' new keyword opportunities.', estimatedWeeklyImpact: '£' + totalWasted.toFixed(2) + ' saved' };
}

app.get('/api/keywords/status', function(req, res) { res.json({ reportId: keywordState.reportId, hasData: !!keywordState.data, dataSize: keywordState.data ? keywordState.data.length : 0, hasAnalysis: !!keywordState.analysis, lastAnalysed: keywordState.lastAnalysed, requested: keywordState.requested }); });
app.get('/api/keywords/analysis', function(req, res) { res.json({ analysis: keywordState.analysis, dataSize: keywordState.data ? keywordState.data.length : 0 }); });
app.post('/api/keywords/refresh', async function(req, res) { keywordState.requested = 0; keywordState.reportId = null; await requestSearchTermReport(); res.json({ success: true, reportId: keywordState.reportId }); });

app.post('/api/keywords/dismiss', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { searchTerm, campaign, reason, dismissedBy } = req.body;
  if (!searchTerm || !campaign || !reason) return res.status(400).json({ error: 'searchTerm, campaign and reason required' });
  try {
    await db.query('INSERT INTO keyword_dismissals (search_term, campaign, reason, dismissed_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [searchTerm, campaign, reason, dismissedBy || 'unknown']);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/keywords/dismissals', async function(req, res) {
  if (!db) return res.json({ dismissals: [] });
  try {
    const result = await db.query('SELECT search_term, campaign, reason, dismissed_by, dismissed_at FROM keyword_dismissals ORDER BY dismissed_at DESC');
    res.json({ dismissals: result.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/activity', async function(req, res) {
  if (!db) return res.json({ logs: [] });
  try {
    const agent = req.query.agent || '';
    const department = req.query.department || '';
    const limit = parseInt(req.query.limit) || 100;
    const conditions = [];
    const params = [];
    if (agent) { params.push(agent); conditions.push('agent_name=$' + params.length); }
    if (department) { params.push(department); conditions.push('department=$' + params.length); }
    let query = 'SELECT * FROM activity_log';
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY logged_at DESC LIMIT ' + limit;
    const result = await db.query(query, params);
    res.json({ logs: result.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

let agentPerfCache = { data: null, generated: 0 };
app.get('/api/agent-performance', async function(req, res) {
  if (!db) return res.json({ analysis: 'No database available.' });
  if (agentPerfCache.data && Date.now() - agentPerfCache.generated < 60 * 60 * 1000) return res.json({ analysis: agentPerfCache.data, cached: true });
  try {
    const logs = await db.query("SELECT agent_name, action, notes, status_before, status_after, campaign_name, logged_at FROM activity_log WHERE logged_at > NOW() - INTERVAL '30 days' ORDER BY logged_at DESC LIMIT 500");
    const repeats = await db.query("SELECT campaign_name, agent_name, failure_count FROM campaign_tasks WHERE is_repeat_offender=TRUE ORDER BY failure_count DESC LIMIT 20");
    const summary = await db.query("SELECT agent_name, status, COUNT(*) as count FROM campaign_tasks WHERE created_date > NOW() - INTERVAL '30 days' GROUP BY agent_name, status ORDER BY agent_name, status");
    const alertResponses = await db.query("SELECT agent_name, action, COUNT(*) as count FROM activity_log WHERE action IN ('budget_added','alert_dismissed','alert_ignored') AND logged_at > NOW() - INTERVAL '30 days' GROUP BY agent_name, action ORDER BY agent_name");
    const kwActions = await db.query("SELECT dismissed_by as agent_name, reason, COUNT(*) as count FROM keyword_dismissals WHERE dismissed_at > NOW() - INTERVAL '30 days' GROUP BY dismissed_by, reason ORDER BY dismissed_by");
    const prompt = 'You are analyzing Amazon PPC campaign management performance for FK Sports.\n\nAGENT ACTIVITY LOG (last 30 days):\n' + JSON.stringify(logs.rows, null, 2) + '\n\nREPEAT OFFENDERS:\n' + JSON.stringify(repeats.rows, null, 2) + '\n\nTASK SUMMARY PER AGENT:\n' + JSON.stringify(summary.rows, null, 2) + '\n\nALERT RESPONSE TRACKING:\n' + JSON.stringify(alertResponses.rows, null, 2) + '\n\nKEYWORD ACTIONS PER AGENT:\n' + JSON.stringify(kwActions.rows, null, 2) + '\n\nAnalyze each agent (Aryan, Satyam, Kunal) performance. For each agent provide:\n1. Overall performance rating (Strong/Average/Needs Improvement)\n2. Tasks completed vs abandoned vs dismissed\n3. Alert response rate\n4. Patterns in their notes\n5. Repeat offender campaigns they own\n6. Keyword intelligence actions\n7. One specific actionable recommendation\n\nBe direct and honest. 4-5 sentences per agent.';
    const response = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-opus-4-5-20251101', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } });
    const analysis = response.data.content[0].text;
    agentPerfCache = { data: analysis, generated: Date.now() };
    res.json({ analysis });
  } catch(e) { console.error('Agent perf error: ' + e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async function(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await db.query('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email.toLowerCase().trim()]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const token = uuidv4() + uuidv4();
    await db.query("INSERT INTO user_sessions (user_id, token, department, role, name, email, expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '24 hours')", [user.id, token, user.department, user.role, user.name, user.email]);
    await db.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    res.json({ success: true, token, name: user.name, department: user.department, role: user.role, email: user.email });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', async function(req, res) {
  const token = req.headers['x-auth-token'] || '';
  if (token && db) { try { await db.query('DELETE FROM user_sessions WHERE token=$1', [token]); } catch(e) {} }
  res.json({ success: true });
});

app.get('/api/auth/me', async function(req, res) {
  const token = req.headers['x-auth-token'] || '';
  if (!token || !db) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const result = await db.query('SELECT * FROM user_sessions WHERE token=$1 AND expires_at > NOW()', [token]);
    if (!result.rows.length) return res.status(401).json({ error: 'Session expired' });
    const s = result.rows[0];
    res.json({ name: s.name, department: s.department, role: s.role, email: s.email });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/users', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { name, email, password, department, role } = req.body;
  if (!name || !email || !password || !department) return res.status(400).json({ error: 'All fields required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (name, email, password_hash, department, role) VALUES ($1,$2,$3,$4,$5)', [name, email.toLowerCase().trim(), hash, department, role||'agent']);
    res.json({ success: true });
  } catch(e) { if (e.code === '23505') return res.status(400).json({ error: 'Email already exists' }); res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/users', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const result = await db.query('SELECT id, name, email, department, role, is_active, created_at, last_login FROM users ORDER BY department, name');
    res.json({ users: result.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/change-password', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const token = req.headers['x-auth-token'] || '';
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const sessionRes = await db.query('SELECT * FROM user_sessions WHERE token=$1 AND expires_at > NOW()', [token]);
    if (!sessionRes.rows.length) return res.status(401).json({ error: 'Not authenticated' });
    const userId = sessionRes.rows[0].user_id;
    const userRes = await db.query('SELECT * FROM users WHERE id=$1', [userId]);
    if (!userRes.rows.length) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, userId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/auth/users/:id', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { name, department, role, is_active, password } = req.body;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET name=$1, department=$2, role=$3, is_active=$4, password_hash=$5 WHERE id=$6', [name, department, role, is_active, hash, req.params.id]);
    } else {
      await db.query('UPDATE users SET name=$1, department=$2, role=$3, is_active=$4 WHERE id=$5', [name, department, role, is_active, req.params.id]);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

cron.schedule('0 3 * * *', async function() {
  if (db) { try { await db.query('DELETE FROM user_sessions WHERE expires_at < NOW()'); } catch(e) { console.error('Session cleanup error: ' + e.message); } }
}, { timezone: 'Europe/London' });

app.get('/api/admin/create-manager', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const hash = await bcrypt.hash('FKSports2024!', 10);
    await db.query('INSERT INTO users (name, email, password_hash, department, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO UPDATE SET password_hash=$3, is_active=TRUE', ['Bobby', 'bobby@fksports.co.uk', hash, 'manager', 'manager']);
    res.json({ success: true, message: 'Manager account created/reset. Email: bobby@fksports.co.uk / Password: FKSports2024!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/fix-agent-names', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const knownAgents = ['Aryan', 'Satyam', 'Kunal'];
  try {
    const tasks = await db.query("SELECT id, campaign_name FROM campaign_tasks WHERE (agent_name IS NULL OR agent_name NOT IN ('Aryan','Satyam','Kunal'))");
    let fixed = 0, deleted = 0;
    for (const row of tasks.rows) {
      const parts = (row.campaign_name || '').split(/[|@]/);
      const extracted = parts[0].trim().substring(0, 30);
      if (knownAgents.includes(extracted)) { await db.query('UPDATE campaign_tasks SET agent_name=$1 WHERE id=$2', [extracted, row.id]); fixed++; }
      else { await db.query('DELETE FROM campaign_tasks WHERE id=$1', [row.id]); deleted++; }
    }
    res.json({ success: true, fixed, deleted });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks/:id/escalation-analysis', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const taskRes = await db.query('SELECT * FROM campaign_tasks WHERE id=$1', [req.params.id]);
    const task = taskRes.rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const history = await db.query('SELECT action, notes, logged_at FROM activity_log WHERE task_id=$1 ORDER BY logged_at ASC', [task.id]);
    const snapshots = await db.query("SELECT snapshot_date, campaigns FROM daily_snapshots WHERE snapshot_date > NOW() - INTERVAL '7 days' ORDER BY snapshot_date DESC LIMIT 7");
    let campHistory = [];
    snapshots.rows.forEach(function(snap) {
      const c = (snap.campaigns||[]).find(function(x){ return String(x.campaignId) === String(task.campaign_id); });
      if (c) campHistory.push({ date: snap.snapshot_date, spend: c.spend, sales: c.sales, acos: c.acos, impressions: c.impressions });
    });
    const prompt = 'You are analyzing an Amazon PPC campaign task escalated after ' + task.days_persisted + ' days.\n\nCAMPAIGN: ' + task.campaign_name + '\nAGENT: ' + task.agent_name + '\nPROBLEM: ' + task.problem_detail + '\nDAYS OPEN: ' + task.days_persisted + '\nSCORE: ' + task.score + '\nREPEAT OFFENDER: ' + (task.is_repeat_offender ? 'YES - has failed ' + task.failure_count + ' times' : 'No') + '\n\nAGENT NOTES HISTORY:\n' + JSON.stringify(history.rows, null, 2) + '\n\nCAMPAIGN PERFORMANCE (last 7 days):\n' + JSON.stringify(campHistory, null, 2) + '\n\nProvide:\n1. Root cause analysis\n2. Is the agent\'s approach working?\n3. Specific recommended fix\n4. If agent requests 7-day scaling window - justified? Yes/No with reason.\n\nBe direct, specific, actionable. 3-4 sentences max per point.';
    const response = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-opus-4-5-20251101', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } });
    res.json({ analysis: response.data.content[0].text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/snapshots', async function(req, res) {
  const dates = await getSnapshotDates();
  res.json({ dates: dates.map(function(r) { const d = typeof r.snapshot_date === 'string' ? r.snapshot_date : new Date(r.snapshot_date).toISOString().split('T')[0]; return { date: d, metrics: r.metrics }; })});
});

app.post('/api/tasks/:id/reopen', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const taskRes = await db.query('SELECT * FROM campaign_tasks WHERE id=$1', [req.params.id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = taskRes.rows[0];
    await db.query('UPDATE campaign_tasks SET status=$1, resolved_at=NULL, updated_at=NOW() WHERE id=$2', ['open', req.params.id]);
    const agentName = (task.agent_name && ['Aryan','Satyam','Kunal'].includes(task.agent_name)) ? task.agent_name : extractAgentFromCampaign(task.campaign_name||'') || 'Unknown';
    await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, status_before, status_after, task_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [task.campaign_id||'', task.campaign_name||'', agentName, 'reopened', 'Task reopened — moved back to Due', task.status, 'open', parseInt(req.params.id)]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks/:id/toggle-note', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const taskRes = await db.query('SELECT notes_ignored FROM campaign_tasks WHERE id=$1', [req.params.id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: 'Task not found' });
    const currentIgnored = taskRes.rows[0].notes_ignored || false;
    await db.query('UPDATE campaign_tasks SET notes_ignored=$1, updated_at=NOW() WHERE id=$2', [!currentIgnored, req.params.id]);
    res.json({ success: true, notes_ignored: !currentIgnored });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stuck-campaigns/action', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { campaignId, campaignName, action, notes } = req.body;
  if (!campaignId || !action || !notes) return res.status(400).json({ error: 'Missing fields' });
  try {
    const agentName = extractAgentFromCampaign(campaignName||'') || 'Unknown';
    if (action === 'review') {
      const flagDeadline = new Date(); flagDeadline.setDate(flagDeadline.getDate() + 7);
      await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1,$2,$3,$4,$5)', [String(campaignId), campaignName, agentName, 'stuck_flagged_1week', 'Agent will work on this for 1 week. Plan: ' + notes + '. Deadline: ' + flagDeadline.toLocaleDateString('en-GB')]);
    } else if (action === 'pause') {
      await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1,$2,$3,$4,$5)', [String(campaignId), campaignName, agentName, 'stuck_paused', 'Campaign paused from underperforming page. Reason: ' + notes]);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/activity/log', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { campaignId, campaignName, action, notes, agentName } = req.body;
  try {
    const agent = agentName || extractAgentFromCampaign(campaignName||'') || 'Unknown';
    await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1,$2,$3,$4,$5)', [String(campaignId||''), campaignName||'', agent, action||'', notes||'']);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/campaigns/:id/spend-breakdown', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const campaignId = req.params.id;
    const snapshots = await db.query("SELECT TO_CHAR(snapshot_date, 'YYYY-MM-DD') as snapshot_date, campaigns FROM daily_snapshots WHERE snapshot_date >= CURRENT_DATE - INTERVAL '14 days' ORDER BY snapshot_date DESC LIMIT 14");
    const breakdown = [];
    snapshots.rows.forEach(function(snap) {
      const c = (snap.campaigns||[]).find(function(x){ return String(x.campaignId) === String(campaignId); });
      if (c && (parseFloat(c.spend||0) > 0 || parseFloat(c.sales||0) > 0)) {
        const d = typeof snap.snapshot_date === 'string' ? snap.snapshot_date : new Date(snap.snapshot_date).toLocaleDateString('en-GB', {timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'}).split('/').reverse().join('-');
        breakdown.push({ date: d, spend: parseFloat(c.spend||0).toFixed(2), sales: parseFloat(c.sales||0).toFixed(2), acos: c.acos||0, impressions: c.impressions||0, clicks: c.clicks||0 });
      }
    });
    res.json({ breakdown });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/campaign-analysis/:campaignId', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'No API key' });
  try {
    const campaignId = req.params.campaignId;
    const snapshots = await db.query("SELECT TO_CHAR(snapshot_date, 'YYYY-MM-DD') as snapshot_date, campaigns FROM daily_snapshots WHERE snapshot_date >= CURRENT_DATE - INTERVAL '14 days' ORDER BY snapshot_date DESC LIMIT 14");
    let history = [];
    snapshots.rows.forEach(function(snap) {
      const c = (snap.campaigns||[]).find(function(x){ return String(x.campaignId) === String(campaignId); });
      if (c) history.push({ date: snap.snapshot_date, spend: c.spend||0, sales: c.sales||0, acos: c.acos||0, impressions: c.impressions||0, clicks: c.clicks||0 });
    });
    if (!history.length) return res.json({ analysis: 'No historical data found for this campaign.' });
    const totalSpend = history.reduce(function(s,d){ return s+parseFloat(d.spend||0); }, 0);
    const totalSales = history.reduce(function(s,d){ return s+parseFloat(d.sales||0); }, 0);
    const daysNoRevenue = history.filter(function(d){ return parseFloat(d.sales||0) === 0 && parseFloat(d.spend||0) > 0; }).length;
    const daysNoActivity = history.filter(function(d){ return parseInt(d.impressions||0) === 0; }).length;
    const dismissed = await db.query('SELECT search_term, reason FROM keyword_dismissals WHERE campaign ILIKE $1', ['%' + campaignId + '%']);
    const dismissedSection = dismissed.rows.length > 0 ? '\nDISMISSED KEYWORDS:\n' + dismissed.rows.map(function(d){ return d.search_term + ': ' + d.reason; }).join('\n') : '';
    const prompt = 'You are an Amazon PPC expert analyzing a campaign for FK Sports UK (fitness equipment).\n\nCAMPAIGN ID: ' + campaignId + '\nLAST 14 DAYS:\n' + JSON.stringify(history, null, 2) + '\n\nSUMMARY:\n- Total spend: £' + totalSpend.toFixed(2) + '\n- Total revenue: £' + totalSales.toFixed(2) + '\n- Days with spend but zero revenue: ' + daysNoRevenue + '\n- Days with zero impressions: ' + daysNoActivity + dismissedSection + '\n\nProvide:\n1. Likely root cause\n2. One specific recommended action\n3. Worth continuing or pause?\n\nBe direct. No generic advice.';
    const response = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-opus-4-5-20251101', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } });
    res.json({ analysis: response.data.content[0].text, totalSpend, totalSales, daysNoRevenue, daysNoActivity });
  } catch(e) { console.error('Campaign analysis error: ' + e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/stuck-campaigns', async function(req, res) {
  if (!db) return res.json({ noActivity: [], noRevenue: [] });
  try {
    const result = await db.query('SELECT snapshot_date, campaigns FROM daily_snapshots ORDER BY snapshot_date DESC LIMIT 7');
    const snapshots = result.rows;
    if (snapshots.length < 3) return res.json({ noActivity: [], noRevenue: [], days: snapshots.length });
    const campHistory = {};
    snapshots.forEach(function(snap) {
      const camps = snap.campaigns || [];
      const date = snap.snapshot_date;
      camps.forEach(function(c) {
        if (!campHistory[c.campaignId]) campHistory[c.campaignId] = { name: c.name, portfolio: c.portfolio||'', agent: c.agent||'', targetingType: c.targetingType||'', days: [] };
        campHistory[c.campaignId].days.push({ date, impressions: c.impressions||0, spend: c.spend||0, sales: c.sales||0, acos: c.acos||0, dailyBudget: c.dailyBudget||0 });
      });
    });
    const noActivity = [], noRevenue = [];
    Object.values(campHistory).forEach(function(camp) {
      const days = camp.days;
      if (days.length < 3) return;
      const last3 = days.slice(0, 3);
      if (last3.every(function(d){ return d.impressions === 0; })) { const totalSpend = last3.reduce(function(s,d){ return s+d.spend; }, 0); noActivity.push(Object.assign({}, camp, { daysNoActivity: last3.length, totalSpend: totalSpend.toFixed(2), lastBudget: last3[0].dailyBudget })); }
      const last7 = days.slice(0, Math.min(7, days.length));
      const spendDays = last7.filter(function(d){ return d.spend > 0; });
      if (spendDays.length >= 3 && last7.every(function(d){ return d.spend === 0 || d.sales === 0; })) { const totalSpend = last7.reduce(function(s,d){ return s+d.spend; }, 0); const avgAcos = spendDays.length > 0 ? spendDays.reduce(function(s,d){ return s+d.acos; }, 0) / spendDays.length : 0; noRevenue.push(Object.assign({}, camp, { daysNoRevenue: spendDays.length, totalWastedSpend: totalSpend.toFixed(2), avgAcos: avgAcos.toFixed(1) })); }
    });
    noActivity.sort(function(a,b){ return b.daysNoActivity - a.daysNoActivity; });
    noRevenue.sort(function(a,b){ return parseFloat(b.totalWastedSpend) - parseFloat(a.totalWastedSpend); });
    res.json({ noActivity, noRevenue, daysOfData: snapshots.length });
  } catch(e) { console.error('Stuck campaigns error: ' + e.message); res.json({ noActivity: [], noRevenue: [], error: e.message }); }
});

app.get('/api/snapshots/:date', async function(req, res) {
  const snap = await getDailySnapshot(req.params.date);
  if (!snap) return res.status(404).json({ error: 'No snapshot for ' + req.params.date });
  res.json({ date: snap.snapshot_date, metrics: snap.metrics, campaigns: snap.campaigns, exhaustionLog: snap.exhaustion_log, alerts: snap.alerts });
});

app.get('/api/settings', async function(req, res) {
  try { if (!db) return res.json({ settings: null }); const result = await db.query('SELECT settings FROM app_settings WHERE id = 1'); res.json({ settings: result.rows[0]?.settings || {} }); } catch(e) { res.json({ settings: null, error: e.message }); }
});

app.post('/api/settings', async function(req, res) {
  try {
    const { settings } = req.body;
    if (!settings) return res.status(400).json({ error: 'No settings provided' });
    if (db) await db.query('UPDATE app_settings SET settings = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(settings)]);
    if (settings.acosCritical) process.env.ACOS_CRITICAL_THRESHOLD = String(settings.acosCritical);
    if (settings.acosWarning) process.env.ACOS_WARNING_THRESHOLD = String(settings.acosWarning);
    if (settings.budgetLowPct) process.env.BUDGET_LOW_PERCENT = String(settings.budgetLowPct);
    console.log('Settings updated: ' + JSON.stringify(settings));
    res.json({ success: true });
  } catch(e) { console.error('Settings save error: ' + e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/tasks', async function(req, res) {
  if (!db) return res.json({ tasks: [] });
  try { const result = await db.query("SELECT * FROM campaign_tasks WHERE agent_name IN ('Aryan','Satyam','Kunal') ORDER BY score DESC, created_date DESC LIMIT 500"); res.json({ tasks: result.rows }); } catch(e) { res.json({ tasks: [], error: e.message }); }
});

app.post('/api/admin/cleanup-tasks', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try { const deleted = await db.query("DELETE FROM campaign_tasks WHERE agent_name IS NULL OR agent_name NOT IN ('Aryan','Satyam','Kunal') RETURNING id"); res.json({ success: true, deleted: deleted.rowCount }); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks/:id/status', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { status, notes, dismissedReason, pausedReason, escalationReason } = req.body;
  try {
    const taskRes = await db.query('SELECT * FROM campaign_tasks WHERE id=$1', [req.params.id]);
    const task = taskRes.rows[0] || {};
    const statusBefore = task.status || 'unknown';
    let query, params;
    if (status === 'dismissed') { const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999); query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, dismissed_reason=$3, updated_at=NOW(), resolved_at=NOW(), suppressed_until=$4 WHERE id=$5'; params = [status, notes||'', dismissedReason||notes||'', endOfDay.toISOString(), req.params.id]; }
    else if (status === 'paused') { query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, paused_reason=$3, updated_at=NOW(), resolved_at=NOW() WHERE id=$4'; params = [status, notes||pausedReason||'', pausedReason||notes||'', req.params.id]; }
    else if (status === 'in_progress') { query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, updated_at=NOW(), first_action_at=COALESCE(first_action_at, NOW()) WHERE id=$3'; params = [status, notes||'', req.params.id]; }
    else if (status === 'scaling') { const deadline = new Date(); deadline.setDate(deadline.getDate() + 7); query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, escalation_reason=$3, scaling_deadline=$4, updated_at=NOW(), first_action_at=COALESCE(first_action_at, NOW()) WHERE id=$5'; params = [status, notes||'', escalationReason||notes||'', deadline.toISOString(), req.params.id]; }
    else if (status === 'complete') { query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, updated_at=NOW(), resolved_at=NOW(), last_resolved_date=NOW() WHERE id=$3'; params = [status, notes||'', req.params.id]; }
    else { query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, updated_at=NOW() WHERE id=$3'; params = [status, notes||'', req.params.id]; }
    await db.query(query, params);
    try {
      const logAgent = (task.agent_name && ['Aryan','Satyam','Kunal'].includes(task.agent_name)) ? task.agent_name : extractAgentFromCampaign(task.campaign_name||'') || 'Unknown';
      await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, status_before, status_after, task_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [task.campaign_id||'', task.campaign_name||'', logAgent, status, notes||'', statusBefore, status, parseInt(req.params.id)]);
    } catch(logErr) { console.error('Activity log error: ' + logErr.message); }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks/:id/archive', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try { await db.query('UPDATE campaign_tasks SET status=$1, archived_at=NOW(), updated_at=NOW() WHERE id=$2', ['archived', req.params.id]); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks/run-now', async function(req, res) {
  runDailyTaskScheduler().catch(function(e){ console.error('Manual task run error: ' + e.message); });
  res.json({ success: true, message: 'Task scheduler triggered' });
});

// ─────────────────────────────────────────────────────────────────────────
// Google task endpoints
// All operate on department='google' rows in campaign_tasks. Mirror the
// Amazon endpoints but namespaced under /api/google/tasks/*.
// ─────────────────────────────────────────────────────────────────────────

app.get('/api/google/tasks', async function(req, res) {
  if (!db) return res.json({ tasks: [], summary: {} });
  try {
    // Idempotent — if columns already exist, this is a no-op. Safety net to ensure
    // the schema is present before we query it (some boots may have skipped it).
    await ensureGoogleTaskColumns();
    // Filters: ?status=open|in_progress|discussion|complete|all  ?agent=Rahul|Anuj|Unassigned|all  ?day7=true
    const statusFilter = req.query.status || 'active';   // 'active' = not complete/archived
    const agentFilter = req.query.agent || 'all';
    const typeFilter = req.query.type || 'all';          // 'problem' | 'scale' | 'all'

    let where = "department='google'";
    const params = [];
    if (statusFilter === 'active') where += " AND status NOT IN ('complete','archived')";
    else if (statusFilter && statusFilter !== 'all') {
      params.push(statusFilter);
      where += " AND status=$" + params.length;
    }
    if (agentFilter && agentFilter !== 'all') {
      params.push(agentFilter);
      where += " AND agent_name=$" + params.length;
    }
    if (typeFilter && typeFilter !== 'all') {
      params.push(typeFilter);
      where += " AND COALESCE(task_type, 'problem')=$" + params.length;
    }
    const r = await db.query(
      "SELECT id, campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, " +
      "       days_persisted, total_wasted, score, status, agent_notes, dismissed_reason, paused_reason, " +
      "       task_source, product_key, product_title, product_image_url, task_type, priority, " +
      "       baseline_spend, baseline_sales, baseline_acos, baseline_impressions, " +
      "       day7_decision, day7_decision_at, day7_note, " +
      "       created_date, updated_at, resolved_at, first_action_at " +
      "FROM campaign_tasks WHERE " + where + " ORDER BY priority ASC, score DESC, created_date DESC LIMIT 500",
      params
    );

    // Compute days-since-creation + Day-7 flag inline
    const now = Date.now();
    const tasks = r.rows.map(function(row) {
      const created = row.created_date ? new Date(row.created_date).getTime() : now;
      const daysOpen = Math.max(0, Math.floor((now - created) / 86400000));
      return Object.assign({}, row, {
        daysOpen: daysOpen,
        atDay7: daysOpen >= 7 && !row.day7_decision,
        atDay4: daysOpen >= 4 && daysOpen < 7
      });
    });

    // Workload summary
    const summary = { byAgent: {}, totals: { active: 0, day7: 0, unassigned: 0, completed: 0 } };
    GOOGLE_TASK_AGENTS.forEach(function(a){ summary.byAgent[a] = { open: 0, in_progress: 0, discussion: 0, day7: 0 }; });
    summary.byAgent['Unassigned'] = { open: 0, in_progress: 0, discussion: 0, day7: 0 };

    // Run a separate query for ALL tasks (not just filtered) to compute the workload summary
    const allRes = await db.query(
      "SELECT agent_name, status, created_date, day7_decision FROM campaign_tasks WHERE department='google'"
    );
    allRes.rows.forEach(function(row) {
      const agent = row.agent_name || 'Unassigned';
      const bucket = summary.byAgent[agent] || (summary.byAgent[agent] = { open: 0, in_progress: 0, discussion: 0, day7: 0 });
      if (row.status === 'complete' || row.status === 'archived') {
        summary.totals.completed++;
        return;
      }
      summary.totals.active++;
      if (agent === 'Unassigned') summary.totals.unassigned++;
      const created = row.created_date ? new Date(row.created_date).getTime() : now;
      const daysOpen = Math.max(0, Math.floor((now - created) / 86400000));
      if (daysOpen >= 7 && !row.day7_decision) {
        bucket.day7++;
        summary.totals.day7++;
      } else if (row.status === 'in_progress') {
        bucket.in_progress++;
      } else if (row.status === 'discussion') {
        bucket.discussion++;
      } else {
        bucket.open++;
      }
    });

    res.json({ tasks: tasks, summary: summary });
  } catch (e) {
    console.error('[GTASK] /api/google/tasks error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Take ownership of an unassigned task (or steal from another agent).
// Used for the self-allocate workflow: agent clicks "Take it" on the task board.
app.post('/api/google/tasks/:id/take', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const u = req.user || {};
    const me = req.body.agent || u.name || u.username || '';
    const actor = u.name || u.username || me;     // who clicked (logged-in user)
    if (!me) return res.status(400).json({ error: 'Could not determine agent name' });
    if (!GOOGLE_TASK_AGENTS.includes(me)) return res.status(400).json({ error: 'Only Rahul or Anuj can take tasks' });
    await db.query(
      "UPDATE campaign_tasks SET agent_name=$1, updated_at=NOW() WHERE id=$2 AND department='google'",
      [me, req.params.id]
    );
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, task_id, department) VALUES ($1,$2,$3,$4,'take',$5,$6,'google')",
        ['', '', me, actor, 'Took task', parseInt(req.params.id)]
      );
    } catch(e) { console.error('[GTASK] take log error: ' + e.message); }
    res.json({ success: true, agent: me });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reassign — manager moves a task to a different agent (or unassigns it).
// Required: target agent name, note explaining why.
// Logs as 'reassigned' with from→to in notes, and actor_name = manager who clicked.
app.post('/api/google/tasks/:id/reassign', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const u = req.user || {};
  const actor = u.name || u.username || '';
  const role = u.role || '';
  const isManager = ['manager','admin'].includes(role) || ['Bobby','Satyam','bobby','satyam'].includes(actor);
  if (!isManager) return res.status(403).json({ error: 'Only managers can reassign tasks' });

  const targetAgent = (req.body.agent || '').trim();
  const note = (req.body.note || '').trim();
  if (!targetAgent) return res.status(400).json({ error: 'Target agent required (Rahul, Anuj, or Unassigned)' });
  if (!['Rahul', 'Anuj', 'Unassigned'].includes(targetAgent)) return res.status(400).json({ error: 'agent must be Rahul, Anuj, or Unassigned' });
  if (!note) return res.status(400).json({ error: 'A note explaining the reassignment is required' });

  try {
    const taskRes = await db.query("SELECT * FROM campaign_tasks WHERE id=$1 AND department='google'", [req.params.id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = taskRes.rows[0];
    const fromAgent = task.agent_name || 'Unassigned';
    if (fromAgent === targetAgent) return res.status(400).json({ error: 'Task is already assigned to ' + targetAgent });

    await db.query(
      "UPDATE campaign_tasks SET agent_name=$1, reassigned_at=NOW(), reassigned_from=$2, updated_at=NOW() WHERE id=$3",
      [targetAgent, fromAgent, req.params.id]
    );
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, status_before, status_after, task_id, department) VALUES ($1,$2,$3,$4,'reassigned',$5,$6,$7,$8,'google')",
        [task.campaign_id || '', task.campaign_name || '', targetAgent, actor, note, fromAgent, targetAgent, parseInt(req.params.id)]
      );
    } catch (e) { console.error('[GTASK] reassign log error: ' + e.message); }

    res.json({ success: true, from: fromAgent, to: targetAgent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update Google task status. Mirrors /api/tasks/:id/status but enforces dept,
// records dismiss reason requirement, and writes activity log with department='google'.
app.post('/api/google/tasks/:id/status', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const id = req.params.id;
  const status = req.body.status;
  const notes = (req.body.notes || '').trim();
  const dismissedReason = (req.body.dismissedReason || '').trim();

  if (!status) return res.status(400).json({ error: 'status required' });

  // ALL status transitions now require a note explaining what the agent is doing.
  // The only no-note flow is "take" (separate endpoint, just claims ownership).
  const noteRequiredStatuses = ['in_progress', 'discussion', 'complete', 'dismissed', 'paused', 'reopened', 'scale_promoted'];
  if (noteRequiredStatuses.includes(status)) {
    if (status === 'dismissed') {
      if (!dismissedReason) return res.status(400).json({ error: 'A reason is required to dismiss a task.' });
    } else {
      if (!notes) return res.status(400).json({ error: 'A note is required for this action — describe what you are doing.' });
    }
  }

  try {
    const taskRes = await db.query("SELECT * FROM campaign_tasks WHERE id=$1 AND department='google'", [id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: 'Task not found (or not a Google task)' });
    const task = taskRes.rows[0];
    const before = task.status;

    let q, p, finalStatus = status;
    if (status === 'dismissed') {
      q = "UPDATE campaign_tasks SET status='dismissed', dismissed_reason=$1, updated_at=NOW(), resolved_at=NOW() WHERE id=$2";
      p = [dismissedReason, id];
    } else if (status === 'in_progress') {
      q = "UPDATE campaign_tasks SET status='in_progress', updated_at=NOW(), first_action_at=COALESCE(first_action_at, NOW()) WHERE id=$1";
      p = [id];
    } else if (status === 'discussion') {
      q = "UPDATE campaign_tasks SET status='discussion', updated_at=NOW() WHERE id=$1";
      p = [id];
    } else if (status === 'complete') {
      q = "UPDATE campaign_tasks SET status='complete', updated_at=NOW(), resolved_at=NOW() WHERE id=$1";
      p = [id];
    } else if (status === 'paused') {
      q = "UPDATE campaign_tasks SET status='paused', paused_reason=$1, updated_at=NOW() WHERE id=$2";
      p = [notes, id];
    } else if (status === 'reopened') {
      // Reopened means: go back to in_progress, but log it as a distinct action so history shows it
      q = "UPDATE campaign_tasks SET status='in_progress', updated_at=NOW(), resolved_at=NULL WHERE id=$1";
      p = [id];
      finalStatus = 'in_progress';
    } else if (status === 'scale_promoted') {
      // Promote a problem task to a scale task. Keep it open with task_type='scale' so it shows under Scale filter.
      q = "UPDATE campaign_tasks SET task_type='scale', status='in_progress', updated_at=NOW() WHERE id=$1";
      p = [id];
      finalStatus = 'in_progress';
    } else {
      q = "UPDATE campaign_tasks SET status=$1, updated_at=NOW() WHERE id=$2";
      p = [status, id];
    }
    await db.query(q, p);

    // Always write activity log with: agent_name (task owner), actor_name (who clicked), action, notes.
    // This is critical for audit — when a manager acts on an agent's task, we record both.
    const u = req.user || {};
    const actor = u.name || u.username || task.agent_name || 'system';
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, status_before, status_after, task_id, department) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'google')",
        [task.campaign_id || '', task.campaign_name || '', task.agent_name || '', actor, status, notes || dismissedReason, before, finalStatus, parseInt(id)]
      );
    } catch (e) { console.error('[GTASK] activity_log error: ' + e.message); }

    res.json({ success: true, status: finalStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get full action history for a task — chronological list of every state change with notes.
// Used by the task popup modal to show what's been done.
app.get('/api/google/tasks/:id/history', async function(req, res) {
  if (!db) return res.json({ history: [] });
  try {
    const r = await db.query(
      "SELECT id, action, notes, status_before, status_after, agent_name, actor_name, created_at " +
      "FROM activity_log WHERE department='google' AND task_id=$1 ORDER BY created_at ASC",
      [parseInt(req.params.id)]
    );
    res.json({ history: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual task creation — used by the "Assign" buttons on campaign rows / product cards / product modal.
// The manager picks an agent and writes a brief, server creates a task with task_source='manual'.
app.post('/api/google/tasks/manual-create', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  await ensureGoogleTaskColumns();

  const { campaignId, campaignName, campaignType, productKey, productTitle, agentName, brief, taskType } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  if (!agentName) return res.status(400).json({ error: 'agentName required (Rahul, Anuj, or Unassigned)' });
  if (!brief || !brief.trim()) return res.status(400).json({ error: 'A brief is required — describe what the agent should do.' });
  if (!['Rahul', 'Anuj', 'Unassigned'].includes(agentName)) return res.status(400).json({ error: 'agentName must be Rahul, Anuj, or Unassigned' });

  // Pull baseline metrics from current googleState if available
  let baselineSpend = 0, baselineSales = 0, baselineAcos = 0, baselineImpressions = 0;
  let resolvedCampaignName = campaignName || '';
  let resolvedCampaignType = campaignType || '';
  let resolvedProductTitle = productTitle || null;
  let productImageUrl = null;

  if (productKey) {
    // Product-level task — find the product row
    const productRow = (googleState.products || []).find(function(p){
      const pk = p.shopifyItemId || p.productId || (p.adGroupId ? String(p.campaignId) + '_' + p.adGroupId : null);
      return String(pk) === String(productKey);
    });
    if (productRow) {
      baselineSpend = productRow.spend || 0;
      baselineSales = productRow.sales || 0;
      baselineAcos = baselineSales > 0 ? (baselineSpend / baselineSales) * 100 : 0;
      baselineImpressions = productRow.impressions || 0;
      resolvedCampaignName = resolvedCampaignName || productRow.campaignName;
      resolvedCampaignType = resolvedCampaignType || productRow.campaignType;
      resolvedProductTitle = resolvedProductTitle || productRow.name || productRow.productName;
    }
    // Try to get image from shopify
    const parts = String(productKey).split('_');
    const shopifyId = parts.length >= 3 ? parts[2] : null;
    if (shopifyId) {
      const sp = (shopifyState.products || []).find(function(p){ return String(p.id) === shopifyId; });
      if (sp && sp.imageUrl) productImageUrl = sp.imageUrl;
    }
  } else {
    // Campaign-level — aggregate
    const cProducts = (googleState.products || []).filter(function(p){ return String(p.campaignId) === String(campaignId); });
    cProducts.forEach(function(p){
      baselineSpend += p.spend || 0;
      baselineSales += p.sales || 0;
      baselineImpressions += p.impressions || 0;
    });
    baselineAcos = baselineSales > 0 ? (baselineSpend / baselineSales) * 100 : 0;
    if (cProducts.length && !resolvedCampaignName) resolvedCampaignName = cProducts[0].campaignName;
    if (cProducts.length && !resolvedCampaignType) resolvedCampaignType = cProducts[0].campaignType;
  }

  const finalTaskType = taskType === 'scale' ? 'scale' : 'problem';
  const problemType = productKey ? 'product_manual_assign' : 'manual_assign';

  try {
    const r = await db.query(
      "INSERT INTO campaign_tasks " +
      "(campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, score, task_source, " +
      " department, product_key, product_title, baseline_spend, baseline_sales, baseline_acos, baseline_impressions, " +
      " task_type, priority, product_image_url, status) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,'manual','google',$8,$9,$10,$11,$12,$13,$14,$15,$16,'open') RETURNING id",
      [
        String(campaignId),
        resolvedCampaignName || '(unnamed campaign)',
        agentName,
        resolvedCampaignType || '',
        problemType,
        brief.trim(),
        Math.max(1, Math.round(baselineSpend)),
        productKey || null,
        resolvedProductTitle,
        baselineSpend,
        baselineSales,
        baselineAcos,
        baselineImpressions,
        finalTaskType,
        2,
        productImageUrl
      ]
    );
    const newId = r.rows[0] && r.rows[0].id;
    // Log it
    const u = req.user || {};
    const actor = u.name || u.username || 'manager';
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, status_before, status_after, task_id, department) VALUES ($1,$2,$3,$4,'manual_create',$5,'',$6,$7,'google')",
        [String(campaignId), resolvedCampaignName || '', agentName, actor, brief.trim(), 'open', newId]
      );
    } catch(e) { console.error('[GTASK] manual-create log error: ' + e.message); }
    res.json({ success: true, id: newId });
  } catch (e) {
    console.error('[GTASK] manual-create error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Day 7 decision endpoint — mandatory carry_on / archive / stop with note
app.post('/api/google/tasks/:id/day7-decision', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const id = req.params.id;
  const decision = req.body.decision;
  const note = req.body.note || '';

  const allowed = ['carry_on', 'archive', 'stop'];
  if (!allowed.includes(decision)) return res.status(400).json({ error: 'decision must be carry_on, archive, or stop' });
  if (!note.trim()) return res.status(400).json({ error: 'A note explaining the decision is required.' });

  try {
    const taskRes = await db.query("SELECT * FROM campaign_tasks WHERE id=$1 AND department='google'", [id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = taskRes.rows[0];

    // Apply the decision
    let newStatus = task.status;
    if (decision === 'archive') newStatus = 'archived';
    if (decision === 'stop') newStatus = 'complete';   // marked done; manager pauses in Google Ads manually
    // 'carry_on' keeps current status, just records decision

    await db.query(
      "UPDATE campaign_tasks SET day7_decision=$1, day7_decision_at=NOW(), day7_note=$2, " +
      "status=$3, updated_at=NOW(), " +
      "resolved_at=CASE WHEN $1 IN ('archive','stop') THEN NOW() ELSE resolved_at END " +
      "WHERE id=$4",
      [decision, note, newStatus, id]
    );

    const u2 = req.user || {};
    const actor2 = u2.name || u2.username || task.agent_name || 'system';
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, task_id, department) VALUES ($1,$2,$3,$4,$5,$6,$7,'google')",
        [task.campaign_id || '', task.campaign_name || '', task.agent_name || '', actor2, 'day7_' + decision, note, parseInt(id)]
      );
    } catch(e) { console.error('[GTASK] day7 log error: ' + e.message); }

    res.json({ success: true, decision: decision, newStatus: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual trigger — POST to force the daily Google task scheduler to run NOW
app.post('/api/google/tasks/run-now', async function(req, res) {
  try {
    await ensureGoogleTaskColumns();   // safety net before scheduler tries to insert
    const result = await runGoogleTaskScheduler();
    res.json({ success: true, result: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lookup: which Google tasks are open for a given campaign? Used by the campaign
// view to show the "📋 Active task — Day 3 of 7" badge inline.
app.get('/api/google/tasks/by-campaign/:campaignId', async function(req, res) {
  if (!db) return res.json({ tasks: [] });
  try {
    await ensureGoogleTaskColumns();
    const r = await db.query(
      "SELECT id, agent_name, status, problem_type, product_title, created_date, day7_decision " +
      "FROM campaign_tasks WHERE department='google' AND campaign_id=$1 AND status NOT IN ('complete','archived','dismissed') " +
      "ORDER BY created_date DESC",
      [String(req.params.campaignId)]
    );
    const now = Date.now();
    res.json({
      tasks: r.rows.map(function(row) {
        const created = row.created_date ? new Date(row.created_date).getTime() : now;
        const daysOpen = Math.max(0, Math.floor((now - created) / 86400000));
        return Object.assign({}, row, { daysOpen: daysOpen, atDay7: daysOpen >= 7 && !row.day7_decision });
      })
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/snapshot', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const { date, metrics, campaigns } = req.body;
    if (!date || !campaigns) return res.status(400).json({ error: 'date and campaigns required' });
    await db.query('INSERT INTO daily_snapshots (snapshot_date, metrics, campaigns, exhaustion_log, alerts) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (snapshot_date) DO UPDATE SET metrics=$2, campaigns=$3, exhaustion_log=$4, alerts=$5, created_at=NOW()', [date, JSON.stringify(metrics||{}), JSON.stringify(campaigns), JSON.stringify([]), JSON.stringify([])]);
    console.log('Manual snapshot inserted for ' + date + ' (' + campaigns.length + ' campaigns)');
    res.json({ success: true, date: date, campaigns: campaigns.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', function(req, res) { res.json({ status: 'ok', lastSync: state.lastSync, campaigns: state.campaigns.length, error: state.error }); });
app.get('/api/portfolios', function(req, res) { res.json({ portfolios: state.portfolios, count: Object.keys(state.portfolios).length }); });
app.post('/api/sync', function(req, res) { syncCampaigns(); res.json({ success: true }); });

app.post('/api/campaigns/:id/budget', async function(req, res) {
  const id = req.params.id;
  const amount = parseFloat(req.body.amount || 0);
  const campaign = state.campaigns.find(function(c) { return String(c.campaignId) === String(id) || c.campaignId == id; });
  console.log('Budget request for id: ' + id + ', found: ' + (campaign ? campaign.name : 'NOT FOUND') + ', total campaigns: ' + state.campaigns.length);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found: ' + id });
  try {
    const newBudget = campaign.dailyBudget + amount;
    await updateBudget(id, newBudget);
    const log = state.exhaustionLog.find(function(e) { return e.campaign === campaign.name && e.action === 'Pending'; });
    if (log) { log.added = '+£' + amount; log.action = 'Budget added'; log.resolvedAt = new Date().toLocaleTimeString('en-GB', {timeZone:'Europe/London', hour:'2-digit', minute:'2-digit'}); if (log.time) { const outParts = log.time.split(':'); const resParts = log.resolvedAt.split(':'); const gapMins = (parseInt(resParts[0]) * 60 + parseInt(resParts[1])) - (parseInt(outParts[0]) * 60 + parseInt(outParts[1])); log.gap = gapMins > 0 ? gapMins + ' min' : '< 1 min'; } }
    if (db) { try { await db.query('UPDATE campaign_tasks SET status=$1, agent_notes=$2, updated_at=NOW(), resolved_at=NOW() WHERE campaign_id=$3 AND status IN ($4,$5) AND task_source=$6', ['complete', 'Budget +£' + amount + ' added', String(id), 'open', 'in_progress', 'alert']); } catch(e) { console.error('Auto-close task error: ' + e.message); } }
    const approvalAgent = extractAgentFromCampaign(campaign.name) || '';
    const approvalMsg = ['✅ Budget added', campaign.name, '+£' + amount + ' added. New budget: £' + newBudget.toFixed(2)].join('\n');
    if (approvalAgent) await sendToAgent(approvalAgent, approvalMsg);
    if (db) { try { await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1,$2,$3,$4,$5)', [String(id), campaign.name, approvalAgent || 'Unknown', 'budget_added', '+£' + amount.toFixed(2) + ' added. Was £' + campaign.dailyBudget.toFixed(2) + ' → Now £' + newBudget.toFixed(2)]); } catch(logErr) { console.error('Budget activity log error: ' + logErr.message); } }
    syncCampaigns();
    res.json({ success: true, newBudget: newBudget });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/alerts/:campaignId/dismiss', async function(req, res) {
  const id = req.params.campaignId;
  const reason = req.body.reason || 'No reason given';
  const alert = state.alerts.find(function(a) { return String(a.campaignId) === String(id); });
  state.alerts = state.alerts.filter(function(a) { return String(a.campaignId) !== String(id); });
  if (db && alert) {
    try {
      const agentName = extractAgentFromCampaign(alert.name||'') || 'Unknown';
      await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1,$2,$3,$4,$5)', [String(id), alert.name || 'Unknown campaign', agentName, 'alert_dismissed', 'Alert dismissed. Reason: ' + reason + '. ACOS at time: ' + (alert.acos||'—') + '%. Alert type: ' + (alert.type||'—')]);
    } catch(logErr) { console.error('Alert dismiss log error: ' + logErr.message); }
  }
  res.json({ success: true });
});

// ── Google Ads Ingest Endpoint ────────────────────────────────────────────
app.post('/api/google/ingest', async function(req, res) {
  const secret = req.headers['x-google-secret'] || req.body.secret;
  const expectedSecret = process.env.GOOGLE_INGEST_SECRET || 'fksports-google-2024';
  if (secret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const campaigns = req.body.campaigns || [];
    const now = new Date();
    const ukHour = parseInt(now.toLocaleString('en-GB', {timeZone:'Europe/London', hour:'2-digit', hour12:false}));
    const alertsSuppressed = ukHour >= 22 || ukHour < 8;
    const dateStr = now.toDateString();
    const timeStr = now.toLocaleTimeString('en-GB', {timeZone:'Europe/London', hour:'2-digit', minute:'2-digit'});
    const ACOS_CRIT = parseFloat(process.env.ACOS_CRITICAL_THRESHOLD || 20);
    const BUDGET_LOW = parseFloat(process.env.BUDGET_LOW_PERCENT || 20);

    const products = req.body.products || [];

    // Google agents (Rahul/Anuj) not yet active — default to null instead of
    // mis-extracting campaign name as agent. Re-enable when webhooks configured.
    googleState.campaigns = campaigns.map(function(c) {
      return Object.assign({}, c, { agentName: null, department: 'google' });
    });
    googleState.products = products.map(function(p) {
      return Object.assign({}, p, { agentName: null, department: 'google' });
    });
    googleState.lastSync = timeStr;
    googleState.lastReceivedAt = now.toISOString();
    googleState.error = null;
    googleState.lastSnapshot = { campaigns, products, lastSync: timeStr };
    console.log("Google ingest received: " + campaigns.length + " campaigns, " + products.length + " products");

    // Persist this ingest to DB so a redeploy doesn't lose data.
    // Also prune snapshots older than 30 days to keep the table small.
    if (db) {
      try {
        await db.query(
          "INSERT INTO google_state_snapshots (received_at, campaigns, products, campaigns_count, products_count, last_sync_label) " +
          "VALUES ($1, $2, $3, $4, $5, $6)",
          [now.toISOString(), JSON.stringify(googleState.campaigns), JSON.stringify(googleState.products), campaigns.length, products.length, timeStr]
        );
        await db.query("DELETE FROM google_state_snapshots WHERE received_at < NOW() - INTERVAL '30 days'");
      } catch(e) {
        console.error('[INGEST] snapshot save error (non-fatal): ' + e.message);
      }
    }

    if (!alertsSuppressed) {
      for (const c of googleState.campaigns) {
        if (c.state !== 'ENABLED' && c.state !== 'enabled') continue;
        const spend = parseFloat(c.spend || 0);
        const sales = parseFloat(c.sales || 0);
        const budget = parseFloat(c.dailyBudget || 0);
        const remaining = parseFloat(c.budgetRemaining || 0);
        const acos = sales > 0 ? Math.round((spend/sales)*100*10)/10 : 0;
        const outOfBudget = remaining <= 0.01 && budget > 0;
        const budgetLow = !outOfBudget && budget > 0 && ((remaining/budget)*100) <= BUDGET_LOW;
        const acosHigh = acos > ACOS_CRIT && spend > 1;
        let alertType = null;
        if (outOfBudget) alertType = 'out_of_budget';
        else if (acosHigh) alertType = 'acos_high';
        else if (budgetLow) alertType = 'budget_low';
        if (!alertType) continue;
        const already = googleState.alerts.find(function(a) { return String(a.campaignId) === String(c.campaignId) && a.date === dateStr && a.type === alertType; });
        if (already) continue;
        googleState.alerts.push({ campaignId: c.campaignId, name: c.name, type: alertType, time: timeStr, date: dateStr, acos: acos, budget: budget, department: 'google' });
        const dashUrl = process.env.DASHBOARD_URL || 'https://app.fksports.co.uk';
        let msg = '';
        if (alertType === 'out_of_budget') msg = '🚨 Out of Budget (Google)\n' + c.name + '\nSpent £' + spend.toFixed(2) + ' of £' + budget.toFixed(2) + '\n' + dashUrl;
        else if (alertType === 'budget_low') msg = '⚡ Budget Low (Google)\n' + c.name + '\n£' + remaining.toFixed(2) + ' remaining\n' + dashUrl;
        else if (alertType === 'acos_high') msg = '📈 High ACoS (Google)\n' + c.name + '\nACoS: ' + acos + '%\n' + dashUrl;
        const agent = c.agentName;
        if (agent) { try { await sendToAgent(agent, msg); } catch(e) { console.error('Google alert send error: ' + e.message); } }
        if (db) { try { await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1,$2,$3,$4,$5)', [String(c.campaignId), c.name, agent||'Unknown', alertType, msg]); } catch(e) {} }
      }
    }
    res.json({ success: true, campaignsReceived: campaigns.length, productsReceived: products.length });
  } catch(e) {
    console.error('Google ingest error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Returns freshness/staleness info for the Google Ads ingest. Used by the dashboard
// to show a red banner if the script hasn't pushed data in > 30 hours.
app.get('/api/google/data-freshness', function(req, res) {
  const lastReceivedAt = googleState.lastReceivedAt;
  if (!lastReceivedAt) {
    return res.json({ stale: true, neverReceived: true, ageHours: null, lastReceivedAt: null });
  }
  const ageMs = Date.now() - new Date(lastReceivedAt).getTime();
  const ageHours = ageMs / 36e5;
  const STALE_THRESHOLD_HOURS = 30;
  res.json({
    stale: ageHours > STALE_THRESHOLD_HOURS,
    neverReceived: false,
    ageHours: Math.round(ageHours * 10) / 10,
    lastReceivedAt: lastReceivedAt,
    lastSync: googleState.lastSync,
    thresholdHours: STALE_THRESHOLD_HOURS
  });
});

// ── Google Ads Dashboard Endpoint ─────────────────────────────────────────
app.get('/api/google/dashboard', async function(req, res) {
  const camps = googleState.campaigns || [];
  const alerts = googleState.alerts || [];
  const totalSpend = camps.reduce(function(s,c){ return s+(parseFloat(c.spend)||0); }, 0);
  const totalRevenue = camps.reduce(function(s,c){ return s+(parseFloat(c.sales)||0); }, 0);
  const blendedAcos = totalRevenue > 0 ? Math.round((totalSpend/totalRevenue)*100*10)/10 : 0;
  const outOfBudget = camps.filter(function(c){ return c.budgetRemaining <= 0.01 && c.dailyBudget > 0; }).length;
  const spendNoRevenue = camps.filter(function(c){ return c.spend > 0 && (c.sales === 0 || c.sales === null); }).length;
  res.json({ metrics: { totalSpend: totalSpend.toFixed(2), totalRevenue: totalRevenue.toFixed(2), blendedAcos, outOfBudget, spendNoRevenue, totalCampaigns: camps.length, activeCampaigns: camps.filter(function(c){ return c.state === "ENABLED" || c.state === "enabled"; }).length }, campaigns: camps, products: googleState.products || [], alerts: alerts, lastSync: googleState.lastSync, error: googleState.error });
});

// ── Shopify Integration ───────────────────────────────────────────────────
let shopifyState = {
  products: [],
  lastSync: null,
  error: null
};

async function syncShopifyProducts() {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const store = process.env.SHOPIFY_STORE;
  if (!token || !store) { console.log('Shopify credentials not configured'); return; }

  try {
    console.log('Syncing Shopify products...');

    // Fetch all products including draft/archived (needed to flag inactive products in ads)
    const prodRes = await axios.get('https://' + store + '/admin/api/2021-07/products.json?limit=250', {
      headers: { 'X-Shopify-Access-Token': token }
    });
    const rawProducts = prodRes.data.products || [];

    // Fetch last 30 days of orders WITH PAGINATION (FK Sports does 150+ orders/day,
    // so a single page of 250 captures less than 2 days). Walk Link headers until done.
    const now = Date.now();
    const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    // Window: [startOfToday - 7 days, startOfToday) where "today" means London time.
    // Container runs UTC so we have to compute London-midnight explicitly otherwise
    // orders placed between 00:00 and 01:00 London time get misbucketed.
    const startOfToday = londonMidnightToday();
    const cutoff7Start = startOfToday - 7 * 24 * 60 * 60 * 1000;  // 7 days ago at London 00:00
    const cutoff7End   = startOfToday;                              // today at London 00:00
    const todayStart   = startOfToday;
    const todayEnd     = todayStart + 24 * 60 * 60 * 1000;

    // Per-product totals over 7 and 30 day windows (7d EXCLUDES today)
    const sales30 = {};        // net (gross - discount - refund) over last 30 days incl. today
    const units30 = {};
    const sales7 = {};         // last 7 COMPLETE days (excludes today)
    const units7 = {};
    const salesToday = {};     // today only (incomplete)
    const unitsToday = {};

    // Per-product daily breakdown: pid -> { 'YYYY-MM-DD': { gross, discount, refund, net } }
    const dailyByPid = {};

    // Store-wide daily breakdown for the dashboard "Daily breakdown" card
    // (pid is keyed too so the modal can show top products per day)
    const dailyAll = {};       // 'YYYY-MM-DD' -> { gross, discount, refund, net, byPid: { pid: net } }

    function getDay(map, key) {
      if (!map[key]) map[key] = { gross: 0, discount: 0, refund: 0, shipping: 0, net: 0 };
      return map[key];
    }
    function getDayAll(key) {
      if (!dailyAll[key]) dailyAll[key] = { gross: 0, discount: 0, refund: 0, shipping: 0, net: 0, byPid: {} };
      return dailyAll[key];
    }

    let totalOrders = 0;
    try {
      // Paginated fetch. We use updated_at_min (NOT created_at_min) so orders that
      // were created earlier but had a refund issued in the last 30 days come back too.
      // Without this we silently miss refunds on orders older than 30 days.
      let url = 'https://' + store + '/admin/api/2021-07/orders.json?limit=250&status=any&updated_at_min=' + since30;
      let pageCount = 0;
      const maxPages = 20; // safety cap (5,000 orders should be enough for 30 days even at peak)
      while (url && pageCount < maxPages) {
        pageCount++;
        const orderRes = await axios.get(url, {
          headers: { 'X-Shopify-Access-Token': token }
        });
        const orders = orderRes.data.orders || [];
        totalOrders += orders.length;

        orders.forEach(function(order) {
          // IMPORTANT: do NOT early-return on cancelled orders. Shopify sets
          // cancelled_at when a fully-refunded order is automatically cancelled,
          // so virtually every refunded order has cancelled_at != null.
          // We do skip GROSS/DISCOUNT/SHIPPING for cancelled orders below
          // (matches Shopify Analytics) but the REFUND must still be processed
          // because real money was returned to the customer.
          const orderIsCancelled = !!order.cancelled_at;

          const orderTime = new Date(order.created_at).getTime();
          const dayKey = londonDateKey(new Date(orderTime));
          const isWithin7 = orderTime >= cutoff7Start && orderTime < cutoff7End;
          const isToday = orderTime >= todayStart && orderTime < todayEnd;
          // The order may have been CREATED outside our 30-day window but is in our
          // result set because of a recent refund. We track this so we know to
          // process refunds (which are dated by their issue) but skip gross/discount
          // for orders whose creation falls outside any window of interest.
          const orderInLast30 = orderTime >= new Date(since30).getTime();

          // Gross/discount/shipping for this order are only tallied if:
          //   1. The order is NOT cancelled (Shopify Analytics excludes cancelled orders)
          //   2. The order was CREATED in our 30-day window
          // Refunds further down are processed regardless of either condition.
          if (orderInLast30 && !orderIsCancelled) {
            // Shipping at the order level (not per line). Apply to the store-wide
            // day total only, because shipping isn't attributable to any one product.
            const shippingTotal = (order.shipping_lines || []).reduce(function(s, sl){
              return s + parseFloat(sl.price || 0);
            }, 0);
            if (shippingTotal > 0) {
              const ad = getDayAll(dayKey);
              ad.shipping += shippingTotal;
              ad.net += shippingTotal;
            }

            // ── Store-wide totals: use Shopify's PRE-COMPUTED order fields ─────────
            // Path 1 — instead of summing line_items + discount_allocations ourselves
            // (which had drift vs Shopify Analytics), use Shopify's own per-order
            // numbers. These already match Analytics' "Total sales breakdown".
            //   subtotal_price        = gross sales − discounts (i.e. what Shopify shows)
            //   total_discounts       = discounts as Shopify reports them
            //   gross sales (derived) = subtotal_price + total_discounts
            const orderSubtotal  = parseFloat(order.subtotal_price || 0);     // already discount-applied
            const orderDiscounts = parseFloat(order.total_discounts || 0);
            const orderGross     = orderSubtotal + orderDiscounts;            // back-out gross
            const orderNetForDay = orderSubtotal;                              // line-net at order level

            const ad = getDayAll(dayKey);
            ad.gross    += orderGross;
            ad.discount += orderDiscounts;
            ad.net      += orderNetForDay;
            // shipping was already added above

            // ── Per-product totals: keep our line-item math (drives product cards & AI) ──
            (order.line_items || []).forEach(function(item) {
              const pid = String(item.product_id);
              const gross = parseFloat(item.price || 0) * (item.quantity || 0);
              const discountAllocated = (item.discount_allocations || []).reduce(function(s, da){
                return s + parseFloat(da.amount || 0);
              }, 0);
              const lineNet = Math.max(0, gross - discountAllocated);

              sales30[pid] = (sales30[pid] || 0) + lineNet;
              units30[pid] = (units30[pid] || 0) + (item.quantity || 0);
              if (isWithin7) {
                sales7[pid] = (sales7[pid] || 0) + lineNet;
                units7[pid] = (units7[pid] || 0) + (item.quantity || 0);
              }
              if (isToday) {
                salesToday[pid] = (salesToday[pid] || 0) + lineNet;
                unitsToday[pid] = (unitsToday[pid] || 0) + (item.quantity || 0);
              }

              // Per-product daily breakdown (sparkline & per-product modal)
              if (!dailyByPid[pid]) dailyByPid[pid] = {};
              const d = getDay(dailyByPid[pid], dayKey);
              d.gross += gross;
              d.discount += discountAllocated;
              d.net += lineNet;

              // Store-wide byPid attribution (top products per day) — keep line-item
              // share since order-level numbers can't be split per product.
              ad.byPid[pid] = (ad.byPid[pid] || 0) + lineNet;
            });
          } // end gross/discount/shipping section (only runs for non-cancelled orders in window)

          // REFUNDS — process for ALL orders regardless of order age, because we
          // switched to updated_at_min and want to catch refunds on old orders.
          // Option B: assign to the day the refund was issued (ref.created_at).
          (order.refunds || []).forEach(function(ref) {
            const refundTime = new Date(ref.created_at || order.created_at).getTime();
            const refundDayKey = londonDateKey(new Date(refundTime));
            const refundIsWithin7 = refundTime >= cutoff7Start && refundTime < cutoff7End;
            const refundIsToday = refundTime >= todayStart && refundTime < todayEnd;
            (ref.refund_line_items || []).forEach(function(rli) {
              const pid = String(rli.line_item ? rli.line_item.product_id : '');
              if (!pid) return;
              const refundAmount = parseFloat(rli.subtotal || 0); // subtotal of refunded line (already discount-adjusted)
              if (!refundAmount) return;

              // Subtract from net totals
              sales30[pid] = (sales30[pid] || 0) - refundAmount;
              if (refundIsWithin7) sales7[pid] = (sales7[pid] || 0) - refundAmount;
              if (refundIsToday) salesToday[pid] = (salesToday[pid] || 0) - refundAmount;

              // Per-product daily — apply on refund date
              if (!dailyByPid[pid]) dailyByPid[pid] = {};
              const d = getDay(dailyByPid[pid], refundDayKey);
              d.refund += refundAmount;
              d.net -= refundAmount;

              // Store-wide daily — apply on refund date
              const ad = getDayAll(refundDayKey);
              ad.refund += refundAmount;
              ad.net -= refundAmount;
              ad.byPid[pid] = (ad.byPid[pid] || 0) - refundAmount;
            });
          });
        });

        // Look at Link header for next page cursor
        const linkHeader = orderRes.headers && orderRes.headers.link;
        let nextUrl = null;
        if (linkHeader) {
          const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          if (m) nextUrl = m[1];
        }
        url = nextUrl;
      }
      if (pageCount >= maxPages) {
        console.log('Shopify pagination stopped at safety cap of ' + maxPages + ' pages — some old orders may not be included');
      }
      console.log('Shopify orders fetched: ' + totalOrders + ' across ' + pageCount + ' page(s); using updated_at_min (catches refunds on older orders); cancelled orders excluded');
      // Stash store-wide daily for the dashboard
      shopifyState.dailyBreakdown = dailyAll;
    } catch(e) { console.log('Shopify orders skipped: ' + e.message); }

    shopifyState.products = rawProducts.map(function(p) {
      const pid = String(p.id);
      const price = parseFloat((p.variants && p.variants[0] && p.variants[0].price) || 0);
      const inventory = (p.variants || []).reduce(function(s, v) { return s + (v.inventory_quantity || 0); }, 0);
      const imageUrl = p.images && p.images[0] ? p.images[0].src : null;
      const tags = (p.tags || '').split(',').map(function(t){ return t.trim(); });

      // Build 7-day sparkline of NET sales — 7 COMPLETE days ENDING YESTERDAY (London time).
      // Order: oldest (7 days ago) → newest (yesterday)
      const daily = dailyByPid[pid] || {};
      const sparkline = [];
      for (let i = 7; i >= 1; i--) {
        const d = new Date(todayStart - i * 24 * 60 * 60 * 1000);
        const k = londonDateKey(d);
        const dayData = daily[k];
        sparkline.push(dayData ? Math.round(dayData.net * 100) / 100 : 0);
      }

      return {
        id: pid,
        title: p.title,
        handle: p.handle,
        url: 'https://' + store.replace('.myshopify.com', '') + '.com/products/' + p.handle,
        shopifyUrl: 'https://' + store + '/admin/products/' + pid,
        price: price,
        inventory: inventory,
        imageUrl: imageUrl,
        tags: tags,
        vendor: p.vendor || '',
        productType: p.product_type || '',
        status: p.status,
        revenue7d: Math.round((sales7[pid] || 0) * 100) / 100,
        unitsSold7d: units7[pid] || 0,
        revenue30d: Math.round((sales30[pid] || 0) * 100) / 100,
        unitsSold30d: units30[pid] || 0,
        revenueToday: Math.round((salesToday[pid] || 0) * 100) / 100,
        unitsSoldToday: unitsToday[pid] || 0,
        dailySales7d: sparkline,
        variantCount: (p.variants || []).length,
        createdAt: p.created_at
      };
    });

    shopifyState.lastSync = new Date().toLocaleTimeString('en-GB', {timeZone:'Europe/London', hour:'2-digit', minute:'2-digit'});
    shopifyState.error = null;
    console.log('Shopify sync complete: ' + shopifyState.products.length + ' products');
  } catch(e) {
    console.error('Shopify sync error: ' + e.message);
    shopifyState.error = e.message;
  }
}

// Match a Google Ads row to a Shopify product.
// Priority order:
//   1. Exact match by Shopify item ID (deterministic — preferred for Shopping)
//   2. Match by Shopify product_type (single product in that type only)
//   3. Fuzzy name match (legacy fallback — last resort)
function matchShopifyProduct(googleRow) {
  if (!shopifyState.products.length) return null;
  if (typeof googleRow === 'string') googleRow = { name: googleRow };
  if (!googleRow) return null;

  // 1. Match by Shopify item ID — format: "shopify_gb_<productId>_<variantId>"
  if (googleRow.shopifyItemId) {
    const parts = String(googleRow.shopifyItemId).split('_');
    if (parts.length >= 4) {
      const productId = parts[2];
      const found = shopifyState.products.find(function(p) { return String(p.id) === productId; });
      if (found) return found;
    }
  }

  // 2. Match by product_type when exactly one Shopify product has that type
  if (googleRow.productType) {
    const pt = String(googleRow.productType).toLowerCase();
    const candidates = shopifyState.products.filter(function(p) {
      return String(p.productType || '').toLowerCase() === pt;
    });
    if (candidates.length === 1) return candidates[0];
  }

  // 3. Fuzzy name match (legacy) — only if nothing else worked
  const rawName = googleRow.name || googleRow.productName;
  if (!rawName) return null;
  const name = String(rawName).toLowerCase();
  if (name.indexOf('shopify_gb_') === 0) return null;
  if (name === 'othercase') return null;

  let match = shopifyState.products.find(function(p) { return p.title.toLowerCase() === name; });
  if (match) return match;
  match = shopifyState.products.find(function(p) {
    const title = p.title.toLowerCase();
    return title.includes(name) || name.includes(title);
  });
  if (match) return match;
  const words = name.split(/\s+/).filter(function(w){ return w.length > 3; });
  match = shopifyState.products.find(function(p) {
    const title = p.title.toLowerCase();
    return words.some(function(w){ return title.includes(w); });
  });
  return match || null;
}

// Find all Google Ads rows that point at a given Shopify product (by product ID)
function findGoogleRowsForShopifyProduct(shopifyProductId) {
  const id = String(shopifyProductId);
  return (googleState.products || []).filter(function(gp) {
    if (!gp.shopifyItemId) return false;
    const parts = String(gp.shopifyItemId).split('_');
    return parts.length >= 4 && parts[2] === id;
  });
}

// Aggregate Google Ads metrics across multiple rows (e.g. all variants of one Shopify product)
function aggregateGoogleMetrics(rows) {
  const totals = { impressions: 0, clicks: 0, spend: 0, sales: 0, conversions: 0 };
  const campaigns = {};
  rows.forEach(function(r) {
    totals.impressions += r.impressions || 0;
    totals.clicks += r.clicks || 0;
    totals.spend += r.spend || 0;
    totals.sales += r.sales || 0;
    totals.conversions += r.conversions || 0;
    if (r.campaignId && !campaigns[r.campaignId]) {
      campaigns[r.campaignId] = { campaignId: r.campaignId, campaignName: r.campaignName, campaignType: r.campaignType };
    }
  });
  return {
    impressions: totals.impressions,
    clicks: totals.clicks,
    spend: Math.round(totals.spend * 100) / 100,
    sales: Math.round(totals.sales * 100) / 100,
    conversions: Math.round(totals.conversions * 10) / 10,
    ctr: totals.impressions > 0 ? Math.round((totals.clicks / totals.impressions) * 100 * 100) / 100 : 0,
    acos: totals.sales > 0 ? Math.round((totals.spend / totals.sales) * 1000) / 10 : 0,
    // Cost per conversion — works even when revenue is lagged/zero. Useful when ACOS reads N/A.
    costPerConv: totals.conversions > 0 ? Math.round((totals.spend / totals.conversions) * 100) / 100 : 0,
    campaignsAdvertisedIn: Object.values(campaigns)
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GA4 OAuth + Data API + PageSpeed Insights
// ─────────────────────────────────────────────────────────────────────────
// Path 2 (user OAuth) for Layer 2 funnel data.
// Persists refresh token to Postgres so it survives Railway redeploys.

const GA4_OAUTH_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const GA4_OAUTH_PURPOSE = 'ga4';

function getOauthRedirectUri(req) {
  // Prefer DASHBOARD_URL env var (so prod always uses prod redirect, even when
  // running on staging). Fall back to the request host.
  const dash = process.env.DASHBOARD_URL || ('https://' + (req && req.get ? req.get('host') : 'app.fksports.co.uk'));
  return dash.replace(/\/$/, '') + '/api/google/oauth/callback';
}

// State holders for runtime
let ga4State = {
  connected: false,
  connectedEmail: null,
  lastFetch: null,
  error: null,
  productMetrics: {} // path -> { sessions, cartAdditions, checkouts, etc. }
};

async function loadGa4StateFromDb() {
  if (!db) return;
  try {
    const r = await db.query("SELECT refresh_token, access_token, access_token_expires_at, connected_email, last_used FROM google_oauth_tokens WHERE purpose=$1", [GA4_OAUTH_PURPOSE]);
    if (r.rows.length) {
      ga4State.connected = true;
      ga4State.connectedEmail = r.rows[0].connected_email;
      ga4State.refreshToken = r.rows[0].refresh_token;       // <-- this was missing; without it GA4 silently breaks on every Railway restart
      ga4State.accessToken = r.rows[0].access_token;
      ga4State.accessTokenExpiresAt = r.rows[0].access_token_expires_at;
      console.log('GA4 OAuth state restored from DB (connected as ' + ga4State.connectedEmail + ')');
    } else {
      console.log('No GA4 OAuth token in DB — connect via /api/google/oauth/start');
    }
    const m = await db.query("SELECT * FROM ga4_product_metrics");
    ga4State.productMetrics = {};
    m.rows.forEach(function(row) {
      ga4State.productMetrics[row.page_path] = {
        sessions: row.sessions || 0,
        visitors: row.visitors || 0,
        cartAdditions: row.cart_additions || 0,
        checkouts: row.checkouts || 0,
        purchases: row.purchases || 0,
        engagementRate: row.engagement_rate || 0,
        avgEngagementTime: row.avg_engagement_time || 0,
        bounceRate: row.bounce_rate || 0
      };
    });
    if (m.rows.length) console.log('Loaded GA4 metrics for ' + m.rows.length + ' product paths');
  } catch(e) { console.error('GA4 state load error: ' + e.message); }
}

// Step 1: send user to Google OAuth
app.get('/api/google/oauth/start', function(req, res) {
  const clientId = process.env.GA4_OAUTH_CLIENT_ID;
  if (!clientId) return res.status(500).send('GA4_OAUTH_CLIENT_ID not configured');
  const redirect = getOauthRedirectUri(req);
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(redirect) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent(GA4_OAUTH_SCOPE) +
    '&access_type=offline' +
    '&prompt=consent' +
    '&include_granted_scopes=true';
  res.redirect(url);
});

// Step 2: receive auth code, exchange for tokens, persist refresh token
app.get('/api/google/oauth/callback', async function(req, res) {
  const code = req.query.code;
  const error = req.query.error;
  if (error) return res.send('<h2>GA4 connect failed</h2><p>' + error + '</p><a href="/google.html">Back to dashboard</a>');
  if (!code) return res.status(400).send('Missing code');
  const clientId = process.env.GA4_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(500).send('OAuth credentials not configured');

  try {
    const redirect = getOauthRedirectUri(req);
    const tokRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code'
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { refresh_token, access_token, expires_in } = tokRes.data;
    if (!refresh_token) {
      return res.send('<h2>GA4 connect — no refresh token</h2><p>Google did not return a refresh token. This usually means the consent was previously given. Revoke access at <a href="https://myaccount.google.com/permissions">Google Account permissions</a>, then try again.</p><a href="/google.html">Back</a>');
    }

    // Look up the user's email to display on dashboard
    let email = null;
    try {
      const ui = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: 'Bearer ' + access_token }
      });
      email = ui.data && ui.data.email;
    } catch(e) { /* non-fatal */ }

    if (db) {
      const expAt = new Date(Date.now() + (expires_in - 60) * 1000);
      await db.query(`
        INSERT INTO google_oauth_tokens (purpose, refresh_token, access_token, access_token_expires_at, connected_email, connected_at, last_used)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (purpose) DO UPDATE SET
          refresh_token = EXCLUDED.refresh_token,
          access_token = EXCLUDED.access_token,
          access_token_expires_at = EXCLUDED.access_token_expires_at,
          connected_email = EXCLUDED.connected_email,
          connected_at = NOW(),
          last_used = NOW()
      `, [GA4_OAUTH_PURPOSE, refresh_token, access_token, expAt, email]);
    }

    ga4State.connected = true;
    ga4State.connectedEmail = email;

    // Trigger first GA4 fetch in background
    fetchGa4ProductMetrics().catch(function(e){ console.error('First GA4 fetch error: ' + e.message); });

    res.send('<h2>✅ GA4 connected</h2><p>Account: ' + (email || '(unknown)') + '</p><p>Pulling 7 days of funnel data now. Return to the dashboard in a minute.</p><a href="/google.html">Back to dashboard</a>');
  } catch(e) {
    console.error('OAuth callback error: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    res.status(500).send('<h2>GA4 connect failed</h2><pre>' + (e.response ? JSON.stringify(e.response.data, null, 2) : e.message) + '</pre>');
  }
});

// Get a fresh GA4 access token using the stored refresh token
async function getGa4AccessToken() {
  if (!db) throw new Error('No DB — cannot read OAuth tokens');
  const r = await db.query("SELECT * FROM google_oauth_tokens WHERE purpose=$1", [GA4_OAUTH_PURPOSE]);
  if (!r.rows.length) throw new Error('GA4 not connected — visit /api/google/oauth/start');
  const row = r.rows[0];

  // If we have a non-expired access token, reuse it
  if (row.access_token && row.access_token_expires_at && new Date(row.access_token_expires_at) > new Date()) {
    return row.access_token;
  }

  // Refresh
  const clientId = process.env.GA4_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET;
  const tokRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: row.refresh_token,
    grant_type: 'refresh_token'
  }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  const { access_token, expires_in } = tokRes.data;
  const expAt = new Date(Date.now() + (expires_in - 60) * 1000);
  await db.query("UPDATE google_oauth_tokens SET access_token=$1, access_token_expires_at=$2, last_used=NOW() WHERE purpose=$3",
    [access_token, expAt, GA4_OAUTH_PURPOSE]);
  return access_token;
}

// Fetch per-product funnel metrics from GA4 Data API
async function fetchGa4ProductMetrics() {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) { console.log('GA4_PROPERTY_ID not set — skipping GA4 fetch'); return; }
  if (!db) { console.log('No DB — skipping GA4 fetch'); return; }

  // GA4 needs Shopify titles to match itemNames. If Shopify products haven't
  // synced yet (cold start), wait up to 60 seconds for the parallel Shopify
  // sync to populate. Otherwise itemName matching returns 0 every time.
  const shopifyWaitStart = Date.now();
  while ((!shopifyState.products || shopifyState.products.length === 0) && (Date.now() - shopifyWaitStart) < 60000) {
    console.log('GA4 fetch waiting for Shopify products to load...');
    await new Promise(function(resolve){ setTimeout(resolve, 5000); });
  }
  if (!shopifyState.products || shopifyState.products.length === 0) {
    console.log('GA4 fetch giving up — no Shopify products after 60s. Skipping; will retry next cron run.');
    return;
  }

  let token;
  try {
    token = await getGa4AccessToken();
  } catch(e) {
    console.log('GA4 not connected: ' + e.message);
    ga4State.connected = false;
    return;
  }

  try {
    console.log('Fetching GA4 product metrics (last 7 days)...');
    const url = 'https://analyticsdata.googleapis.com/v1beta/properties/' + propertyId + ':runReport';

    // Pull two reports: (a) sessions+engagement by pagePath; (b) ecommerce events by pagePath
    const reportA = await axios.post(url, {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' }
      ],
      dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/products/' } } },
      limit: 250
    }, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });

    // Ecommerce metrics. We use ITEM-SCOPED metrics keyed by itemName for all three
    // (cart adds, checkouts, purchases). GA4 rejects pairing eventCount with itemName
    // because they're different scopes — itemsAddedToCart/itemsCheckedOut/itemsPurchased
    // are the correct item-scoped equivalents.
    //
    // We also still query add_to_cart by pagePath as a fallback, because the cart event
    // fires on the product page so pagePath works reliably even when itemName matching
    // has gaps (e.g. variant titles, branded prefixes).
    let reportItemScoped, reportPathFallback;

    // Primary: item-scoped query for all 3 metrics in one call, keyed by itemName
    try {
      reportItemScoped = await axios.post(url, {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
        dimensions: [{ name: 'itemName' }],
        metrics: [
          { name: 'itemsAddedToCart' },
          { name: 'itemsCheckedOut' },
          { name: 'itemsPurchased' }
        ],
        limit: 1000
      }, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    } catch(e) {
      console.log('GA4 item-scoped fetch failed: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    }

    // Fallback: add_to_cart by pagePath. Used only when itemName matching fails.
    try {
      reportPathFallback = await axios.post(url, {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
        dimensions: [{ name: 'pagePath' }, { name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/products/' } } },
              { filter: { fieldName: 'eventName', inListFilter: { values: ['add_to_cart'] } } }
            ]
          }
        },
        limit: 1000
      }, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    } catch(e) {
      console.log('GA4 pagePath fallback fetch failed: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    }

    const metrics = {};
    (reportA.data.rows || []).forEach(function(row) {
      const path = row.dimensionValues[0].value;
      const v = row.metricValues || [];
      metrics[path] = {
        sessions: parseInt(v[0] && v[0].value) || 0,
        visitors: parseInt(v[1] && v[1].value) || 0,
        engagementRate: parseFloat(v[2] && v[2].value) || 0,
        avgEngagementTime: parseFloat(v[3] && v[3].value) || 0,
        bounceRate: parseFloat(v[4] && v[4].value) || 0,
        cartAdditions: 0, checkouts: 0, purchases: 0
      };
    });

    // Build a Shopify title -> pagePath lookup table for matching item-scoped data.
    // GA4 truncates itemName at ~100 chars (confirmed from Bobby's data: titles cut
    // mid-word with no trailing context). So we need TWO match strategies:
    //   1. Exact match (lowercase + trim)
    //   2. Prefix match — GA4 itemName is the START of the Shopify title
    //      (require 30+ char agreement to avoid false positives)
    const titleToPath = {};
    const lowerTitleList = []; // [{lowerTitle, path}] for prefix matching
    (shopifyState.products || []).forEach(function(p){
      if (p.title && p.handle) {
        const lt = p.title.toLowerCase().trim();
        titleToPath[lt] = '/products/' + p.handle;
        lowerTitleList.push({ lowerTitle: lt, path: '/products/' + p.handle });
      }
    });

    function findShopifyPath(itemName) {
      if (!itemName) return null;
      const lower = itemName.toLowerCase().trim();
      // Strategy 1: exact match
      if (titleToPath[lower]) return titleToPath[lower];
      // Strategy 2: prefix match — only meaningful if itemName is long enough.
      // Require 30+ chars to avoid e.g. "Yoga Mat" matching the wrong product.
      if (lower.length < 30) return null;
      // Find the first Shopify product whose title starts with the GA4 itemName.
      // GA4 truncates at ~100 chars so itemName <= shopifyTitle (in length).
      const match = lowerTitleList.find(function(x){
        return x.lowerTitle.indexOf(lower) === 0;
      });
      return match ? match.path : null;
    }

    // Merge item-scoped data (primary).
    // Track which paths we successfully populated cart counts for, so the fallback
    // only fills gaps without overwriting good data.
    const cartFromItemScoped = new Set();
    let matchedExactCount = 0, matchedPrefixCount = 0, unmatchedCount = 0;
    let totalUnmatchedCart = 0, totalUnmatchedCheckout = 0, totalUnmatchedPurchase = 0;
    const unmatchedExamples = []; // Cap at 10 for log cleanliness

    if (reportItemScoped && reportItemScoped.data && reportItemScoped.data.rows) {
      reportItemScoped.data.rows.forEach(function(row) {
        const itemName = (row.dimensionValues[0].value || '').trim();
        if (!itemName) return;
        const v = row.metricValues || [];
        const cart = parseInt(v[0] && v[0].value) || 0;
        const chk  = parseInt(v[1] && v[1].value) || 0;
        const pur  = parseInt(v[2] && v[2].value) || 0;

        const lower = itemName.toLowerCase().trim();
        const isExact = !!titleToPath[lower];
        const path = findShopifyPath(itemName);

        if (!path) {
          unmatchedCount++;
          totalUnmatchedCart += cart;
          totalUnmatchedCheckout += chk;
          totalUnmatchedPurchase += pur;
          if (unmatchedExamples.length < 10 && (cart > 0 || chk > 0 || pur > 0)) {
            unmatchedExamples.push(itemName + ' (cart:' + cart + ' chk:' + chk + ' pur:' + pur + ')');
          }
          return;
        }

        if (isExact) matchedExactCount++; else matchedPrefixCount++;
        if (!metrics[path]) {
          metrics[path] = { sessions: 0, visitors: 0, cartAdditions: 0, checkouts: 0, purchases: 0, engagementRate: 0, avgEngagementTime: 0, bounceRate: 0 };
        }
        metrics[path].cartAdditions = (metrics[path].cartAdditions || 0) + cart;
        metrics[path].checkouts     = (metrics[path].checkouts     || 0) + chk;
        metrics[path].purchases     = (metrics[path].purchases     || 0) + pur;
        if (cart > 0) cartFromItemScoped.add(path);
      });
    }

    // Fallback: pagePath-based add_to_cart for products where item-scoped didn't match.
    // We only fill cartAdditions where we don't already have item-scoped data, so we
    // don't double-count.
    let cartFromFallback = 0;
    if (reportPathFallback && reportPathFallback.data && reportPathFallback.data.rows) {
      reportPathFallback.data.rows.forEach(function(row) {
        const path = row.dimensionValues[0].value;
        const event = row.dimensionValues[1].value;
        const count = parseInt(row.metricValues[0].value) || 0;
        if (event !== 'add_to_cart') return;
        if (cartFromItemScoped.has(path)) return; // already populated from item-scoped
        if (!metrics[path]) {
          metrics[path] = { sessions: 0, visitors: 0, cartAdditions: 0, checkouts: 0, purchases: 0, engagementRate: 0, avgEngagementTime: 0, bounceRate: 0 };
        }
        metrics[path].cartAdditions = count;
        if (count > 0) cartFromFallback++;
      });
    }

    // Diagnostic logging — option B: log up to 10 unmatched examples
    // so we can see at a glance how matching is performing without flooding logs.
    console.log('GA4 itemName matching: ' + matchedExactCount + ' exact + ' + matchedPrefixCount + ' prefix-matched + ' + unmatchedCount + ' unmatched');
    if (unmatchedCount > 0) {
      console.log('  unattributed totals: ' + totalUnmatchedCart + ' cart adds, ' + totalUnmatchedCheckout + ' checkouts, ' + totalUnmatchedPurchase + ' purchases');
      console.log('  examples (up to 10): ' + unmatchedExamples.join(' | '));
    }
    if (cartFromFallback > 0) {
      console.log('GA4 cart fallback by pagePath filled ' + cartFromFallback + ' products');
    }

    // Persist
    await db.query("DELETE FROM ga4_product_metrics");
    for (const path of Object.keys(metrics)) {
      const m = metrics[path];
      await db.query(`
        INSERT INTO ga4_product_metrics (page_path, sessions, visitors, cart_additions, checkouts, purchases, engagement_rate, avg_engagement_time, bounce_rate, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      `, [path, m.sessions, m.visitors, m.cartAdditions, m.checkouts, m.purchases, m.engagementRate, m.avgEngagementTime, m.bounceRate]);
    }

    ga4State.productMetrics = metrics;
    ga4State.lastFetch = new Date().toLocaleTimeString('en-GB', {timeZone:'Europe/London', hour:'2-digit', minute:'2-digit'});
    ga4State.error = null;
    console.log('GA4 fetch complete: ' + Object.keys(metrics).length + ' product paths');
  } catch(e) {
    const errBody = e.response ? JSON.stringify(e.response.data) : e.message;
    console.error('GA4 fetch error: ' + errBody);
    ga4State.error = errBody;
  }
}

// Look up GA4 metrics for a Shopify product (by handle → /products/<handle>)
function getGa4ForShopifyProduct(shopifyProduct) {
  if (!shopifyProduct || !shopifyProduct.handle) return null;
  const path = '/products/' + shopifyProduct.handle;
  return ga4State.productMetrics[path] || null;
}

// PageSpeed Insights — called on AI deep-dive only (rate-limited)
async function getPageSpeedScore(url) {
  if (!url) return null;
  try {
    const apiKey = process.env.PAGESPEED_API_KEY || '';
    const endpoint = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' +
      encodeURIComponent(url) +
      '&strategy=mobile&category=performance' +
      (apiKey ? '&key=' + encodeURIComponent(apiKey) : '');
    const r = await axios.get(endpoint, { timeout: 25000 });
    const lh = r.data.lighthouseResult || {};
    const audits = lh.audits || {};
    const score = lh.categories && lh.categories.performance ? Math.round((lh.categories.performance.score || 0) * 100) : null;
    return {
      mobileScore: score,
      lcpMs: audits['largest-contentful-paint'] && audits['largest-contentful-paint'].numericValue,
      fcpMs: audits['first-contentful-paint'] && audits['first-contentful-paint'].numericValue,
      tbtMs: audits['total-blocking-time'] && audits['total-blocking-time'].numericValue,
      clsRaw: audits['cumulative-layout-shift'] && audits['cumulative-layout-shift'].numericValue,
      loadTimeMs: audits['speed-index'] && audits['speed-index'].numericValue
    };
  } catch(e) {
    return { error: e.message };
  }
}

// Status endpoint for the frontend "Connect GA4" button
app.get('/api/google/ga4-status', async function(req, res) {
  res.json({
    connected: ga4State.connected,
    connectedEmail: ga4State.connectedEmail,
    lastFetch: ga4State.lastFetch,
    productPathsTracked: Object.keys(ga4State.productMetrics).length,
    error: ga4State.error
  });
});

// Manual trigger for fetching GA4 (e.g. after first connect)
app.post('/api/google/ga4-refresh', async function(req, res) {
  fetchGa4ProductMetrics().catch(function(e){ console.error('Manual GA4 refresh error: ' + e.message); });
  res.json({ success: true, message: 'GA4 refresh triggered' });
});

// PageSpeed endpoint — called from AI analyser (and dashboard if needed)
app.post('/api/google/pagespeed', async function(req, res) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No url' });
  const result = await getPageSpeedScore(url);
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────
// Campaign Archive — hide old/irrelevant campaigns from main view
// ─────────────────────────────────────────────────────────────────────────

// Get current dismiss/archive set (used by frontend to filter and show pills)
app.get('/api/google/archive', async function(req, res) {
  if (!db) return res.json({ dismissed: [], archived: [] });
  try {
    const r = await db.query(
      "SELECT campaign_id, campaign_name, campaign_type, archived_by, archived_at, reason, state FROM google_campaign_archive ORDER BY archived_at DESC"
    );
    const dismissed = r.rows.filter(function(x){ return (x.state || 'archived') === 'dismissed'; });
    const archived = r.rows.filter(function(x){ return (x.state || 'archived') === 'archived'; });
    res.json({ dismissed: dismissed, archived: archived });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Dismiss a campaign — agent action. Stays on Active with a pill.
app.post('/api/google/dismiss', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { campaignId, campaignName, campaignType, reason } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'No campaignId' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required when dismissing' });
  const dismissedBy = (req.user && req.user.name) || 'unknown';
  try {
    await db.query(`
      INSERT INTO google_campaign_archive (campaign_id, campaign_name, campaign_type, archived_by, archived_at, reason, department, state)
      VALUES ($1, $2, $3, $4, NOW(), $5, 'google', 'dismissed')
      ON CONFLICT (campaign_id) DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        campaign_type = EXCLUDED.campaign_type,
        archived_by = EXCLUDED.archived_by,
        archived_at = NOW(),
        reason = EXCLUDED.reason,
        state = 'dismissed'
    `, [String(campaignId), campaignName || '', campaignType || '', dismissedBy, reason.trim()]);
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, department) VALUES ($1,$2,$3,$4,$5,'google')",
        [String(campaignId), campaignName || '', dismissedBy, 'campaign_dismissed', reason.trim()]
      );
    } catch(e) { console.error('Dismiss log error: ' + e.message); }
    archivedCampaignsCache = { ids: new Set(), at: 0 };
    res.json({ success: true });
  } catch(e) {
    console.error('Dismiss error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Archive a dismissed campaign — manager only. Removes it from Active.
app.post('/api/google/archive', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { campaignId, campaignName, campaignType, reason } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'No campaignId' });
  const archivedBy = (req.user && req.user.name) || 'unknown';
  const role = req.user && req.user.role;
  const isManager = ['manager', 'admin'].includes(role) || ['Bobby', 'Satyam', 'bobby', 'satyam'].includes(archivedBy);
  if (!isManager) return res.status(403).json({ error: 'Manager only' });

  try {
    await db.query(`
      INSERT INTO google_campaign_archive (campaign_id, campaign_name, campaign_type, archived_by, archived_at, reason, department, state)
      VALUES ($1, $2, $3, $4, NOW(), $5, 'google', 'archived')
      ON CONFLICT (campaign_id) DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        campaign_type = EXCLUDED.campaign_type,
        archived_by = EXCLUDED.archived_by,
        archived_at = NOW(),
        reason = COALESCE(EXCLUDED.reason, google_campaign_archive.reason),
        state = 'archived'
    `, [String(campaignId), campaignName || '', campaignType || '', archivedBy, reason || null]);
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, department) VALUES ($1,$2,$3,$4,$5,'google')",
        [String(campaignId), campaignName || '', archivedBy, 'campaign_archived', reason || 'archived from dismissed']
      );
    } catch(e) { console.error('Archive log error: ' + e.message); }
    archivedCampaignsCache = { ids: new Set(), at: 0 };
    res.json({ success: true });
  } catch(e) {
    console.error('Archive error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Restore a campaign from dismiss or archive — anyone for dismissed, manager-only for archived
app.post('/api/google/archive/restore', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { campaignId } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'No campaignId' });
  const restoredBy = (req.user && req.user.name) || 'unknown';
  const role = req.user && req.user.role;
  const isManager = ['manager', 'admin'].includes(role) || ['Bobby', 'Satyam', 'bobby', 'satyam'].includes(restoredBy);
  try {
    const before = await db.query("SELECT campaign_name, state FROM google_campaign_archive WHERE campaign_id=$1", [String(campaignId)]);
    if (!before.rows.length) return res.status(404).json({ error: 'Not found' });
    const wasArchived = (before.rows[0].state || 'archived') === 'archived';
    if (wasArchived && !isManager) return res.status(403).json({ error: 'Only manager can restore archived campaigns' });
    await db.query("DELETE FROM google_campaign_archive WHERE campaign_id=$1", [String(campaignId)]);
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, department) VALUES ($1,$2,$3,$4,$5,'google')",
        [String(campaignId), before.rows[0].campaign_name, restoredBy, wasArchived ? 'campaign_restored_from_archive' : 'campaign_restored_from_dismiss', 'restored to active']
      );
    } catch(e) { console.error('Restore log error: ' + e.message); }
    archivedCampaignsCache = { ids: new Set(), at: 0 };
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Permanently remove from archive (manager only)
app.post('/api/google/archive/remove', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { campaignId } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'No campaignId' });
  const removedBy = (req.user && req.user.name) || 'unknown';
  const role = req.user && req.user.role;
  const isManager = ['manager', 'admin'].includes(role) || ['Bobby', 'Satyam', 'bobby', 'satyam'].includes(removedBy);
  if (!isManager) return res.status(403).json({ error: 'Manager only' });
  try {
    const before = await db.query("SELECT campaign_name FROM google_campaign_archive WHERE campaign_id=$1", [String(campaignId)]);
    await db.query("DELETE FROM google_campaign_archive WHERE campaign_id=$1", [String(campaignId)]);
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, department) VALUES ($1,$2,$3,$4,$5,'google')",
        [String(campaignId), before.rows[0] ? before.rows[0].campaign_name : '', removedBy, 'campaign_removed', 'permanently removed by manager']
      );
    } catch(e) { console.error('Remove log error: ' + e.message); }
    archivedCampaignsCache = { ids: new Set(), at: 0 };
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Daily Sales — store-wide last 7 days (Mon-Sun aligned to today)
// ─────────────────────────────────────────────────────────────────────────
app.get('/api/google/daily-sales', async function(req, res) {
  const products = shopifyState.products || [];
  const dailyAll = shopifyState.dailyBreakdown || {}; // 'YYYY-MM-DD' -> { gross, discount, refund, shipping, net, byPid }

  // 7-day labels = today−7 to today−1 (excludes today, oldest first), London time
  const labels = [];
  const startOfTodayMs = londonMidnightToday();
  for (let i = 7; i >= 1; i--) {
    const d = new Date(startOfTodayMs - i * 24 * 60 * 60 * 1000);
    labels.push({
      iso: londonDateKey(d),
      day: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' }),
      shortDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Europe/London' })
    });
  }
  const todayIso = londonDateKey(new Date(startOfTodayMs));

  const productById = {};
  products.forEach(function(p){ productById[String(p.id)] = p; });

  function buildDay(l){
    const dayData = dailyAll[l.iso] || { gross: 0, discount: 0, refund: 0, shipping: 0, net: 0, byPid: {} };
    // Top 5 contributors by NET sales for the day
    const top = Object.keys(dayData.byPid)
      .map(function(pid){
        const p = productById[pid];
        return {
          shopifyId: pid,
          title: p ? p.title : '(unknown product)',
          imageUrl: p ? p.imageUrl : null,
          revenue: Math.round(dayData.byPid[pid] * 100) / 100
        };
      })
      .filter(function(x){ return x.revenue !== 0; })
      .sort(function(a,b){ return b.revenue - a.revenue; })
      .slice(0, 5);
    return {
      ...l,
      gross: Math.round((dayData.gross || 0) * 100) / 100,
      discount: Math.round((dayData.discount || 0) * 100) / 100,
      refund: Math.round((dayData.refund || 0) * 100) / 100,
      shipping: Math.round((dayData.shipping || 0) * 100) / 100,
      net: Math.round((dayData.net || 0) * 100) / 100,
      total: Math.round((dayData.net || 0) * 100) / 100, // backward compat
      top: top
    };
  }

  const result = labels.map(buildDay);

  // Today as a separate object
  const todayData = dailyAll[todayIso];
  const today = todayData
    ? buildDay({
        iso: todayIso,
        day: 'Today',
        shortDate: new Date(startOfTodayMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Europe/London' })
      })
    : null;

  // 7-day totals (excluding today)
  const totalGross = result.reduce(function(s, d){ return s + d.gross; }, 0);
  const totalDiscount = result.reduce(function(s, d){ return s + d.discount; }, 0);
  const totalRefund = result.reduce(function(s, d){ return s + d.refund; }, 0);
  const totalShipping = result.reduce(function(s, d){ return s + d.shipping; }, 0);
  const totalNet = result.reduce(function(s, d){ return s + d.net; }, 0);

  res.json({
    days: result,
    today: today,                 // separate "today so far" snapshot (incomplete day)
    windowLabel: 'Last 7 complete days (excludes today)',
    totalGross7d: Math.round(totalGross * 100) / 100,
    totalDiscount7d: Math.round(totalDiscount * 100) / 100,
    totalRefund7d: Math.round(totalRefund * 100) / 100,
    totalShipping7d: Math.round(totalShipping * 100) / 100,
    totalNet7d: Math.round(totalNet * 100) / 100,
    totalRevenue7d: Math.round(totalNet * 100) / 100, // backward compat
    lastShopifySync: shopifyState.lastSync
  });
});

// The unified diagnosis decision tree.
// priority: 1 = urgent (red), 2 = needs attention (amber), 3 = scale (green), 4 = healthy/info (grey)
function diagnoseProduct(ctx) {
  const s = ctx.shopify;
  const g = ctx.google;
  const f = ctx.funnel; // GA4 funnel data — { sessions, cartAdditions, checkouts, purchases, bounceRate, ... } or null

  // Catch-all rows (Google's "everything else" bucket)
  if (ctx.itemType === 'catchall') {
    return { diagnosisType: 'catchall_bucket', diagnosis: 'Catch-all bucket — products in this ad group not individually targeted', action: 'Review whether these products should be individually bid', priority: 4 };
  }

  // 1. Shopify product is draft/archived — diagnose this BEFORE any ad-related rules
  if (s && s.status && s.status !== 'active') {
    if (g.impressions > 0) {
      return { diagnosisType: 'shopify_inactive', diagnosis: 'Customers cannot buy this — product is ' + s.status.toUpperCase() + ' in Shopify', action: 'Activate the product in Shopify or remove from Google feed', priority: 1 };
    }
    return { diagnosisType: 'shopify_' + s.status, diagnosis: 'Product is ' + s.status.toUpperCase() + ' in Shopify — not sellable', action: s.status === 'draft' ? 'Publish the product or remove from inventory' : 'Restore from archive or de-list', priority: 4 };
  }

  // 2. Out of stock + ads running
  if (s && s.inventory === 0 && g.impressions > 0) {
    return { diagnosisType: 'out_of_stock', diagnosis: 'Out of stock — ads running but nothing to sell', action: 'Pause ads immediately and restock', priority: 1 };
  }

  // 3. Active product with NO ads at all
  if (s && s.status === 'active' && !ctx.hasGoogleData) {
    if (s.revenue7d > 100 || s.revenue30d > 500) {
      return { diagnosisType: 'organic_winner', diagnosis: 'Strong organic seller (£' + (s.revenue30d || 0).toFixed(0) + ' in 30d) but no Google ads', action: 'Add to a Shopping campaign — likely big revenue uplift', priority: 3 };
    }
    if ((s.revenue30d || 0) === 0) {
      return { diagnosisType: 'no_ads_no_sales', diagnosis: 'No ads and no organic sales in 30d', action: 'Investigate listing quality, then either fix listing or de-prioritise', priority: 4 };
    }
    return { diagnosisType: 'no_ads', diagnosis: 'No Google ads running for this product', action: 'Consider adding to a Shopping campaign', priority: 4 };
  }

  // 4. Active product with sales but zero advertising spend (organic only)
  if (s && (s.revenue7d || 0) > 0 && g.spend === 0) {
    return { diagnosisType: 'organic_only', diagnosis: 'Selling organically (£' + (s.revenue7d || 0).toFixed(0) + ' in 7d), no ad spend', action: 'Could scale faster with Google ads', priority: 3 };
  }

  // 5. Google: no impressions despite enabled
  if (g.impressions === 0 && g.spend === 0) {
    return { diagnosisType: 'no_impressions', diagnosis: 'Ads not showing — bidding/budget issue', action: 'Check bid strategy and daily budget', priority: 2 };
  }

  // 6. Impressions but no clicks — weak ad
  if (g.clicks === 0 && g.impressions > 50) {
    return { diagnosisType: 'low_ctr', diagnosis: 'Ad showing but nobody clicking — weak listing image/title', action: 'Improve main image and product title', priority: 2 };
  }

  // 7. Clicks but no conversions — use GA4 funnel data when present to pinpoint where
  if (g.clicks > 20 && g.conversions === 0) {
    if (f && f.sessions > 20) {
      const cartRate = f.sessions > 0 ? (f.cartAdditions / f.sessions) * 100 : 0;
      const checkoutRate = f.cartAdditions > 0 ? (f.checkouts / f.cartAdditions) * 100 : 0;
      if (cartRate < 2) {
        return { diagnosisType: 'page_problem', diagnosis: 'Visitors not adding to cart (cart rate ' + cartRate.toFixed(1) + '%) — listing or page is the bottleneck', action: 'Improve main image, title, price visibility, trust signals', priority: 1 };
      }
      if (cartRate >= 2 && checkoutRate < 30) {
        return { diagnosisType: 'checkout_friction', diagnosis: 'Cart rate is ok (' + cartRate.toFixed(1) + '%) but checkout drop-off (' + checkoutRate.toFixed(0) + '%) — checkout friction', action: 'Review checkout: shipping cost, trust signals, mobile usability', priority: 1 };
      }
    }
    return { diagnosisType: 'landing_page', diagnosis: 'People clicking but not buying — landing page, price, or reviews issue', action: 'Review product page, pricing, images, and reviews', priority: 1 };
  }

  // 7b. High bounce rate signal (GA4) on a product getting decent ad clicks
  if (f && f.sessions > 50 && f.bounceRate > 0.7 && g.clicks > 30) {
    return { diagnosisType: 'high_bounce', diagnosis: 'Bounce rate ' + (f.bounceRate * 100).toFixed(0) + '% — visitors leave immediately. Likely page speed, weak hero image, or wrong intent match', action: 'Check mobile page speed and hero image; verify ad targeting matches product', priority: 2 };
  }

  // 8. Conversions recorded but Google attributes no value — tracking issue
  if (g.conversions > 0 && g.sales === 0) {
    return { diagnosisType: 'conv_tracking', diagnosis: 'Google records ' + g.conversions + ' conversions but no value — tracking is broken', action: 'Check conversion tracking pixel sends purchase value', priority: 2 };
  }

  // 9. Spending with no revenue
  if (g.spend > 5 && g.sales === 0) {
    return { diagnosisType: 'spend_no_revenue', diagnosis: 'Spending money with zero revenue', action: 'Pause and investigate listing quality', priority: 1 };
  }

  // 10. High ACOS
  if (g.acos > 50 && g.spend > 1) {
    return { diagnosisType: 'high_acos', diagnosis: 'Very high ACOS (' + g.acos + '%) — burning money to make sales', action: 'Reduce bids or tighten targeting', priority: 2 };
  }

  // 11. Healthy — scale
  if (g.conversions > 0 && g.acos > 0 && g.acos < 15) {
    return { diagnosisType: 'scale', diagnosis: 'Strong performance — ACOS ' + g.acos + '%, scale this', action: 'Increase daily budget by 50%', priority: 3 };
  }

  // 12. OK but unremarkable
  if (g.conversions > 0) {
    return { diagnosisType: 'healthy', diagnosis: 'Performing OK — ACOS ' + g.acos + '%', action: 'Monitor', priority: 4 };
  }

  return { diagnosisType: 'unknown', diagnosis: 'Insufficient data to diagnose', action: 'Wait for more data', priority: 4 };
}

// ── Shopify API endpoints ─────────────────────────────────────────────────
app.get('/api/shopify/products', async function(req, res) {
  res.json({ products: shopifyState.products, lastSync: shopifyState.lastSync, error: shopifyState.error });
});

app.post('/api/shopify/sync', async function(req, res) {
  syncShopifyProducts().catch(function(e){ console.error('Manual Shopify sync error: ' + e.message); });
  res.json({ success: true, message: 'Shopify sync triggered' });
});

// ── Google Advertised View — grouped by campaign ──────────────────────────
// Helper — load currently ARCHIVED campaign IDs (dismissed stay visible on Active with pill).
// Cached briefly to avoid DB hits per request.
let archivedCampaignsCache = { ids: new Set(), dismissed: new Map(), at: 0 };
async function getArchivedCampaignIds() {
  if (Date.now() - archivedCampaignsCache.at < 30000) return archivedCampaignsCache.ids;
  if (!db) return new Set();
  try {
    const r = await db.query("SELECT campaign_id, state, archived_by, archived_at, reason FROM google_campaign_archive");
    const archived = new Set();
    const dismissed = new Map();
    r.rows.forEach(function(x){
      const state = x.state || 'archived';
      if (state === 'archived') archived.add(String(x.campaign_id));
      else if (state === 'dismissed') dismissed.set(String(x.campaign_id), x);
    });
    archivedCampaignsCache = { ids: archived, dismissed: dismissed, at: Date.now() };
    return archived;
  } catch(e) { return new Set(); }
}

// Helper — get dismiss info for a campaign (returns row with archived_by, reason, archived_at — or null)
async function getDismissedInfoMap() {
  await getArchivedCampaignIds(); // populates cache
  return archivedCampaignsCache.dismissed || new Map();
}

app.get('/api/google/products-diagnostic', async function(req, res) {
  const archivedIds = await getArchivedCampaignIds();
  const dismissedMap = await getDismissedInfoMap();
  const googleProducts = (googleState.products || []).filter(function(gp){
    return !archivedIds.has(String(gp.campaignId));
  });

  const rows = googleProducts.map(function(gp) {
    const shopifyProduct = matchShopifyProduct(gp);
    const rawName = gp.name || gp.productName;
    const displayName = (shopifyProduct && shopifyProduct.title)
      || rawName
      || gp.productType
      || gp.adGroupName
      || gp.campaignName
      || '(unknown)';

    const funnel = shopifyProduct ? getGa4ForShopifyProduct(shopifyProduct) : null;
    const dx = diagnoseProduct({
      shopify: shopifyProduct ? {
        status: shopifyProduct.status,
        inventory: shopifyProduct.inventory,
        revenue7d: shopifyProduct.revenue7d || 0,
        revenue30d: shopifyProduct.revenue30d || 0
      } : null,
      google: {
        impressions: gp.impressions || 0,
        clicks: gp.clicks || 0,
        spend: gp.spend || 0,
        sales: gp.sales || 0,
        conversions: gp.conversions || 0,
        ctr: gp.ctr || 0,
        acos: gp.acos || 0
      },
      funnel: funnel,
      hasGoogleData: true,
      itemType: gp.itemType
    });

    return {
      productId: gp.productId || gp.shopifyItemId || (gp.campaignId + ':' + (rawName || gp.adGroupName || '')),
      productName: displayName,
      displayName: displayName,
      campaignId: gp.campaignId,
      campaignName: gp.campaignName,
      campaignType: gp.campaignType || null,
      itemType: gp.itemType || null,
      adGroupName: gp.adGroupName || null,
      shopifyItemId: gp.shopifyItemId || null,
      productType: gp.productType || null,
      productGroupPath: gp.productGroupPath || null,
      partitionType: gp.partitionType || null,
      spend: gp.spend, sales: gp.sales, impressions: gp.impressions,
      clicks: gp.clicks, conversions: gp.conversions, ctr: gp.ctr, acos: gp.acos,
      costPerConv: (gp.conversions > 0) ? Math.round((gp.spend / gp.conversions) * 100) / 100 : 0,
      agentName: gp.agentName,
      shopifyMatched: !!shopifyProduct,
      shopifyTitle: shopifyProduct ? shopifyProduct.title : null,
      shopifyId: shopifyProduct ? shopifyProduct.id : null,
      shopifyStatus: shopifyProduct ? shopifyProduct.status : null,
      shopifyPrice: shopifyProduct ? shopifyProduct.price : null,
      shopifyInventory: shopifyProduct ? shopifyProduct.inventory : null,
      shopifyRevenue7d: shopifyProduct ? (shopifyProduct.revenue7d || 0) : null,
      shopifyUnitsSold7d: shopifyProduct ? (shopifyProduct.unitsSold7d || 0) : null,
      shopifyRevenue30d: shopifyProduct ? shopifyProduct.revenue30d : null,
      shopifyUnitsSold30d: shopifyProduct ? shopifyProduct.unitsSold30d : null,
      shopifyUrl: shopifyProduct ? shopifyProduct.shopifyUrl : null,
      shopifyImageUrl: shopifyProduct ? shopifyProduct.imageUrl : null,
      ga4Sessions: funnel ? funnel.sessions : null,
      ga4CartAdditions: funnel ? funnel.cartAdditions : null,
      ga4Checkouts: funnel ? funnel.checkouts : null,
      ga4Purchases: funnel ? funnel.purchases : null,
      ga4BounceRate: funnel ? funnel.bounceRate : null,
      ga4EngagementRate: funnel ? funnel.engagementRate : null,
      ga4AvgEngagementTime: funnel ? funnel.avgEngagementTime : null,
      ga4CartRate: funnel && funnel.sessions > 0 ? Math.round((funnel.cartAdditions / funnel.sessions) * 1000) / 10 : null,
      ga4CheckoutRate: funnel && funnel.cartAdditions > 0 ? Math.round((funnel.checkouts / funnel.cartAdditions) * 1000) / 10 : null,
      diagnosisType: dx.diagnosisType,
      diagnosis: dx.diagnosis,
      action: dx.action,
      priority: dx.priority
    };
  });

  // Group by campaign
  const byCampaign = {};
  rows.forEach(function(r) {
    const key = r.campaignId || 'unknown';
    if (!byCampaign[key]) {
      byCampaign[key] = {
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        campaignType: r.campaignType,
        totalSpend: 0, totalSales: 0, totalImpressions: 0, totalClicks: 0, totalConversions: 0,
        wastedSpend: 0,           // spend on rows that produced £0 sales (clear money loss)
        urgentCount: 0, productCount: 0,
        products: []
      };
    }
    const c = byCampaign[key];
    c.totalSpend += r.spend || 0;
    c.totalSales += r.sales || 0;
    c.totalImpressions += r.impressions || 0;
    c.totalClicks += r.clicks || 0;
    c.totalConversions += r.conversions || 0;
    // Wasted spend = money spent on a product/keyword that returned £0 sales
    // (with a real spend > 0 — ignore noise at < 50p)
    if ((r.spend || 0) > 0.5 && (!r.sales || r.sales === 0)) {
      c.wastedSpend += r.spend || 0;
    }
    c.productCount += 1;
    if (r.priority === 1) c.urgentCount += 1;
    c.products.push(r);
  });

  Object.values(byCampaign).forEach(function(c) {
    c.totalSpend = Math.round(c.totalSpend * 100) / 100;
    c.totalSales = Math.round(c.totalSales * 100) / 100;
    c.wastedSpend = Math.round(c.wastedSpend * 100) / 100;
    c.acos = c.totalSales > 0 ? Math.round((c.totalSpend / c.totalSales) * 1000) / 10 : 0;
    c.costPerConv = c.totalConversions > 0 ? Math.round((c.totalSpend / c.totalConversions) * 100) / 100 : 0;
    c.products.sort(function(a, b) {
      if ((a.priority || 9) !== (b.priority || 9)) return (a.priority || 9) - (b.priority || 9);
      return (b.spend || 0) - (a.spend || 0);
    });
    // Attach dismiss info if present
    const dismInfo = dismissedMap.get(String(c.campaignId));
    if (dismInfo) {
      c.dismissed = true;
      c.dismissedBy = dismInfo.archived_by;
      c.dismissedAt = dismInfo.archived_at;
      c.dismissReason = dismInfo.reason;
    }
  });

  const campaignList = Object.values(byCampaign).sort(function(a, b) {
    if (a.urgentCount !== b.urgentCount) return b.urgentCount - a.urgentCount;
    return b.totalSpend - a.totalSpend;
  });

  res.json({
    campaigns: campaignList,
    totalCampaigns: campaignList.length,
    totalProducts: rows.length,
    shopifyMatched: rows.filter(function(r){ return r.shopifyMatched; }).length,
    lastGoogleSync: googleState.lastSync,
    lastShopifySync: shopifyState.lastSync
  });
});

// ── All Products View — Shopify-led ───────────────────────────────────────
app.get('/api/google/all-products', async function(req, res) {
  const shopifyProducts = shopifyState.products || [];
  const archivedIds = await getArchivedCampaignIds();

  const rows = shopifyProducts.map(function(sp) {
    // Filter google rows for this product, excluding archived campaigns
    const googleRowsAll = findGoogleRowsForShopifyProduct(sp.id);
    const googleRows = googleRowsAll.filter(function(r){ return !archivedIds.has(String(r.campaignId)); });
    const agg = aggregateGoogleMetrics(googleRows);
    const hasGoogleData = googleRows.length > 0;
    const hasGoogleActivity = hasGoogleData && (agg.spend > 0 || agg.impressions > 0);
    const funnel = getGa4ForShopifyProduct(sp);

    // Three-bucket categorisation:
    //   driving_traffic — has ≥100 impressions OR ≥1 click in 7 days
    //   listed_quiet   — in feed (has rows) but below threshold
    //   not_promoted   — no Google rows at all
    let adStatus;
    if (!hasGoogleData) {
      adStatus = 'not_promoted';
    } else if (agg.impressions >= 100 || agg.clicks >= 1) {
      adStatus = 'driving_traffic';
    } else {
      adStatus = 'listed_quiet';
    }

    const dx = diagnoseProduct({
      shopify: {
        status: sp.status,
        inventory: sp.inventory,
        revenue7d: sp.revenue7d || 0,
        revenue30d: sp.revenue30d || 0
      },
      google: agg,
      funnel: funnel,
      hasGoogleData: hasGoogleData,
      itemType: 'product_group'
    });

    return {
      shopifyId: sp.id,
      title: sp.title,
      handle: sp.handle,
      imageUrl: sp.imageUrl,
      shopifyUrl: sp.shopifyUrl,
      url: sp.url,
      status: sp.status,
      productType: sp.productType,
      price: sp.price,
      inventory: sp.inventory,
      revenue7d: sp.revenue7d || 0,
      unitsSold7d: sp.unitsSold7d || 0,
      revenue30d: sp.revenue30d || 0,
      unitsSold30d: sp.unitsSold30d || 0,
      dailySales7d: sp.dailySales7d || [],
      googleImpressions: agg.impressions,
      googleClicks: agg.clicks,
      googleSpend: agg.spend,
      googleSales: agg.sales,
      googleConversions: agg.conversions,
      googleCtr: agg.ctr,
      googleAcos: agg.acos,
      googleCostPerConv: agg.costPerConv,
      campaignsAdvertisedIn: agg.campaignsAdvertisedIn,
      hasGoogleData: hasGoogleData,
      hasGoogleActivity: hasGoogleActivity,
      adStatus: adStatus,
      ga4Sessions: funnel ? funnel.sessions : null,
      ga4CartAdditions: funnel ? funnel.cartAdditions : null,
      ga4Checkouts: funnel ? funnel.checkouts : null,
      ga4Purchases: funnel ? funnel.purchases : null,
      ga4BounceRate: funnel ? funnel.bounceRate : null,
      ga4EngagementRate: funnel ? funnel.engagementRate : null,
      ga4AvgEngagementTime: funnel ? funnel.avgEngagementTime : null,
      ga4CartRate: funnel && funnel.sessions > 0 ? Math.round((funnel.cartAdditions / funnel.sessions) * 1000) / 10 : null,
      ga4CheckoutRate: funnel && funnel.cartAdditions > 0 ? Math.round((funnel.checkouts / funnel.cartAdditions) * 1000) / 10 : null,
      diagnosisType: dx.diagnosisType,
      diagnosis: dx.diagnosis,
      action: dx.action,
      priority: dx.priority
    };
  });

  rows.sort(function(a, b) {
    if ((a.priority || 9) !== (b.priority || 9)) return (a.priority || 9) - (b.priority || 9);
    return (b.revenue30d || 0) - (a.revenue30d || 0);
  });

  const summary = {
    totalProducts: rows.length,
    activeProducts: rows.filter(function(r){ return r.status === 'active'; }).length,
    draftProducts: rows.filter(function(r){ return r.status === 'draft'; }).length,
    archivedProducts: rows.filter(function(r){ return r.status === 'archived'; }).length,
    advertisedProducts: rows.filter(function(r){ return r.hasGoogleData; }).length,
    drivingTrafficCount: rows.filter(function(r){ return r.adStatus === 'driving_traffic'; }).length,
    listedQuietCount: rows.filter(function(r){ return r.adStatus === 'listed_quiet'; }).length,
    notPromotedCount: rows.filter(function(r){ return r.adStatus === 'not_promoted'; }).length,
    urgentCount: rows.filter(function(r){ return r.priority === 1; }).length,
    scaleCount: rows.filter(function(r){ return r.priority === 3; }).length,
    totalGoogleSpend: Math.round(rows.reduce(function(s, r){ return s + (r.googleSpend || 0); }, 0) * 100) / 100,
    totalGoogleSales: Math.round(rows.reduce(function(s, r){ return s + (r.googleSales || 0); }, 0) * 100) / 100,
    totalShopifyRevenue7d: Math.round(rows.reduce(function(s, r){ return s + (r.revenue7d || 0); }, 0) * 100) / 100,
    totalShopifyRevenue30d: Math.round(rows.reduce(function(s, r){ return s + (r.revenue30d || 0); }, 0) * 100) / 100
  };

  res.json({
    products: rows,
    summary: summary,
    lastGoogleSync: googleState.lastSync,
    lastShopifySync: shopifyState.lastSync
  });
});

// ── Cron Jobs ─────────────────────────────────────────────────────────────
cron.schedule('0 8,13,18 * * *', function() {
  console.log('Scheduled keyword report fetch...');
  requestSearchTermReport().catch(function(e){ console.error('Scheduled KW request error: ' + e.message); });
  checkSearchTermReport().catch(function(e){ console.error('Scheduled KW check error: ' + e.message); });
}, { timezone: 'Europe/London' });

cron.schedule('0 8 * * *', function() {
  console.log('Running scheduled daily tasks at 8am UK time');
  runDailyTaskScheduler().catch(function(e){ console.error('Scheduled task error: ' + e.message); });
  // Google task auto-creation runs alongside Amazon's at 8am — independent code path,
  // separate department, won't interfere with each other
  runGoogleTaskScheduler().catch(function(e){ console.error('[GTASK] scheduled run error: ' + e.message); });
}, { timezone: 'Europe/London' });

cron.schedule('0 0 * * *', function() {
  autoArchiveTasks().catch(function(e){ console.error('Auto-archive error: ' + e.message); });
}, { timezone: 'Europe/London' });

async function autoArchiveTasks() {
  if (!db) return;
  try {
    const expiredScaling = await db.query("SELECT id, campaign_name, agent_name FROM campaign_tasks WHERE status='scaling' AND scaling_deadline IS NOT NULL AND scaling_deadline < NOW()");
    for (const row of expiredScaling.rows) {
      await db.query("UPDATE campaign_tasks SET status='open', updated_at=NOW() WHERE id=$1", [row.id]);
      await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, status_before, status_after, task_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['', row.campaign_name, row.agent_name, 'scaling_expired', '7-day scaling window expired. Task returned to open for immediate action.', 'scaling', 'open', row.id]);
      console.log('Scaling expired for: ' + row.campaign_name);
      if (row.agent_name) {
        const dashUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : 'https://campaignpulse-setup-production.up.railway.app';
        await sendToAgent(row.agent_name, '🚨 SCALING WINDOW EXPIRED\nCampaign: ' + row.campaign_name + '\n7-day scaling period has ended. Immediate decision required: resolve or pause.\n' + dashUrl + '/tasks');
      }
    }
    const result = await db.query("SELECT id, resolved_at FROM campaign_tasks WHERE status IN ('complete','dismissed','paused') AND archived_at IS NULL AND resolved_at IS NOT NULL");
    let archived = 0;
    const now = new Date();
    for (const row of result.rows) {
      const resolved = new Date(row.resolved_at);
      let workingDays = 0;
      const check = new Date(resolved);
      check.setDate(check.getDate() + 1);
      while (check <= now) { const day = check.getDay(); if (day !== 0 && day !== 6) workingDays++; if (workingDays >= 3) break; check.setDate(check.getDate() + 1); }
      if (workingDays >= 3) { await db.query('UPDATE campaign_tasks SET status=$1, archived_at=NOW() WHERE id=$2', ['archived', row.id]); archived++; }
    }
    if (archived > 0) console.log('Auto-archived ' + archived + ' tasks');
  } catch(e) { console.error('Auto-archive error: ' + e.message); }
}

const interval = process.env.POLL_INTERVAL_MINUTES || 15;
cron.schedule('*/' + interval + ' * * * *', function() { syncCampaigns(); });
cron.schedule('0 */2 * * *', function() { syncShopifyProducts().catch(function(e){ console.error('Shopify cron error: ' + e.message); }); }, { timezone: 'Europe/London' });
// GA4 funnel data — refresh once a day at 7am UK time (after midnight UTC data settles)
cron.schedule('0 7 * * *', function() { fetchGa4ProductMetrics().catch(function(e){ console.error('GA4 cron error: ' + e.message); }); }, { timezone: 'Europe/London' });

const PORT = process.env.PORT || 3000;
// ─────────────────────────────────────────────────────────────────────────
// Rule-based friction (free, instant, always-on)
// ─────────────────────────────────────────────────────────────────────────
//
// Runs immediately when a product card is opened. No AI call. No cost.
// Identifies obvious problems by simple thresholds against page content +
// funnel data + ad data. Caches page summary 12h to avoid re-fetching.
//
// Output shape mirrors the AI critique's friction format so the front-end
// can render both in the same component.

const RULE_PAGE_CACHE_HOURS = 12;
const FUNNEL_BENCHMARKS = {
  cartRateGood: 3,        // %; under this is flagged
  cartRateBad: 1,         // %; under this is P1
  checkoutFromCartGood: 45,   // %; under this is flagged
  checkoutFromCartBad: 25,    // %; under this is P1
  bounceBad: 70           // %; over this is flagged
};

function extractRuleFriction(pageSummary, dossier) {
  const friction = [];
  const sig = (pageSummary && pageSummary.signals) || {};
  const text = (pageSummary && pageSummary.text) || '';
  const lower = text.toLowerCase();

  // ─── Trust signals ────────────────────────────────────────────────────
  // Review count — pull a number near "review"
  const reviewMatch = lower.match(/(\d{1,5})\s*reviews?/);
  const reviewCount = reviewMatch ? parseInt(reviewMatch[1], 10) : 0;
  if (reviewCount === 0 && !sig.hasReviewWidget) {
    friction.push({ priority: 'P1', issue: 'No customer reviews shown', evidence: 'Page has no visible review count or rating widget. With a paid product, social proof is critical.', category: 'trust' });
  } else if (reviewCount > 0 && reviewCount < 3) {
    friction.push({ priority: 'P2', issue: 'Very few reviews (' + reviewCount + ')', evidence: 'Page shows only ' + reviewCount + ' review' + (reviewCount === 1 ? '' : 's') + '. Aim for 5+ to build confidence.', category: 'trust' });
  }

  if (!sig.hasShippingMention) {
    friction.push({ priority: 'P2', issue: 'Shipping info not visible', evidence: 'No mention of "free delivery" / "next day shipping" detected on page. Shipping clarity is a top conversion lever.', category: 'trust' });
  }
  if (!sig.hasReturnsMention) {
    friction.push({ priority: 'P3', issue: 'Returns / refund policy not visible', evidence: 'No mention of returns or money-back guarantee found. UK shoppers expect this.', category: 'trust' });
  }

  // ─── Stock / availability ─────────────────────────────────────────────
  if (lower.indexOf('backordered') >= 0 || lower.indexOf('back order') >= 0) {
    friction.push({ priority: 'P1', issue: 'Backordered notice on page', evidence: 'Page mentions "backordered" — likely a default variant is out of stock, killing trust at point of sale.', category: 'stock' });
  }
  if (lower.indexOf('sold out') >= 0 && !lower.match(/sold\s*out\s*:\s*0/)) {
    friction.push({ priority: 'P1', issue: 'Sold-out indicator visible', evidence: 'Page contains "sold out" copy — verify default variant is in stock.', category: 'stock' });
  }
  if (dossier && dossier.product && dossier.product.inventory === 0) {
    friction.push({ priority: 'P1', issue: 'Product inventory is zero', evidence: 'Shopify reports 0 in stock. Ads driving traffic to an unpurchasable page.', category: 'stock' });
  }

  // ─── Page basics ──────────────────────────────────────────────────────
  if (!sig.hasPrice) {
    friction.push({ priority: 'P1', issue: 'No price detected on page', evidence: 'Could not find a £ symbol or price marker in page content. Price visibility is the #1 conversion driver.', category: 'price' });
  }
  if (!sig.hasViewportMeta) {
    friction.push({ priority: 'P2', issue: 'No mobile viewport meta tag', evidence: 'Page is missing the viewport meta tag — likely renders poorly on mobile.', category: 'mobile' });
  }
  if (sig.h1Count === 0) {
    friction.push({ priority: 'P3', issue: 'No H1 heading on page', evidence: 'Hurts SEO and screen-reader users. Add a clear product-name H1.', category: 'copy' });
  } else if (sig.h1Count > 2) {
    friction.push({ priority: 'P3', issue: 'Multiple H1 headings (' + sig.h1Count + ')', evidence: 'Multiple H1s confuse search engines and users on screen-readers.', category: 'copy' });
  }

  // ─── Performance / weight ─────────────────────────────────────────────
  if (sig.imageCount > 30) {
    friction.push({ priority: 'P2', issue: 'Page has ' + sig.imageCount + ' images', evidence: 'Excessive image count slows mobile load and overwhelms users. Aim for 6–12 hero/gallery images.', category: 'mobile' });
  }
  if (sig.pageBytes > 1500000) {
    friction.push({ priority: 'P3', issue: 'Page is heavy (' + Math.round(sig.pageBytes / 1024) + 'KB)', evidence: 'Large page weight delays interactivity, especially on mobile.', category: 'mobile' });
  }

  // ─── CTA ──────────────────────────────────────────────────────────────
  if (sig.addToCartCount === 0) {
    friction.push({ priority: 'P1', issue: 'No "Add to cart" button text detected', evidence: 'Could not find Add to cart / Add to bag wording. Purchase CTA may be missing or hidden.', category: 'cta' });
  }

  return friction;
}

function extractFunnelFriction(funnel) {
  const friction = [];
  if (!funnel) return friction;

  const cartRate = funnel.sessions > 0 ? (funnel.cartAdditions / funnel.sessions) * 100 : null;
  const checkoutFromCart = funnel.cartAdditions > 0 ? (funnel.checkouts / funnel.cartAdditions) * 100 : null;
  const purchaseFromCheckout = funnel.checkouts > 0 ? (funnel.purchases / funnel.checkouts) * 100 : null;
  const bounce = funnel.bounceRate != null ? funnel.bounceRate * 100 : null;

  if (cartRate != null && funnel.sessions >= 30) {
    if (cartRate < FUNNEL_BENCHMARKS.cartRateBad) {
      friction.push({ priority: 'P1', issue: 'Very low cart-add rate (' + cartRate.toFixed(1) + '%)', evidence: 'Of ' + funnel.sessions + ' sessions, only ' + funnel.cartAdditions + ' added to cart. Benchmark is 3%+. Problem is upstream of cart — landing page, price, or ad relevance.', category: 'funnel' });
    } else if (cartRate < FUNNEL_BENCHMARKS.cartRateGood) {
      friction.push({ priority: 'P2', issue: 'Below-benchmark cart-add rate (' + cartRate.toFixed(1) + '%)', evidence: 'Of ' + funnel.sessions + ' sessions, ' + funnel.cartAdditions + ' added to cart. Aim for 3%+.', category: 'funnel' });
    }
  }

  if (checkoutFromCart != null && funnel.cartAdditions >= 5) {
    if (checkoutFromCart < FUNNEL_BENCHMARKS.checkoutFromCartBad) {
      friction.push({ priority: 'P1', issue: 'Big drop cart→checkout (only ' + checkoutFromCart.toFixed(0) + '%)', evidence: 'Of ' + funnel.cartAdditions + ' carts, only ' + funnel.checkouts + ' reached checkout. Benchmark is 45–60%. Issue is at the cart page (shipping cost, currency, login wall).', category: 'funnel' });
    } else if (checkoutFromCart < FUNNEL_BENCHMARKS.checkoutFromCartGood) {
      friction.push({ priority: 'P2', issue: 'Below-benchmark cart→checkout (' + checkoutFromCart.toFixed(0) + '%)', evidence: 'Of ' + funnel.cartAdditions + ' carts, ' + funnel.checkouts + ' reached checkout. Benchmark is 45–60%.', category: 'funnel' });
    }
  }

  if (purchaseFromCheckout != null && funnel.checkouts >= 3 && purchaseFromCheckout < 50) {
    friction.push({ priority: 'P1', issue: 'Checkout abandonment (' + purchaseFromCheckout.toFixed(0) + '% completed)', evidence: 'Of ' + funnel.checkouts + ' checkouts, only ' + funnel.purchases + ' completed. Likely shipping cost, payment, or trust friction at final step.', category: 'funnel' });
  }

  if (bounce != null && bounce > FUNNEL_BENCHMARKS.bounceBad && funnel.sessions >= 30) {
    friction.push({ priority: 'P2', issue: 'High bounce rate (' + bounce.toFixed(0) + '%)', evidence: 'Most landings leave without engaging. Page may load slowly, look untrustworthy, or mismatch the ad.', category: 'mobile' });
  }

  return friction;
}

function extractAdFriction(dossier) {
  const friction = [];
  if (!dossier || !dossier.ads || !dossier.searchKeywords) return friction;

  // If there are search keywords with spend but the ad spend overall is highly inefficient,
  // surface the top wasted-spend keyword as friction.
  const totalSpend = dossier.ads.spend || 0;
  const totalSales = dossier.ads.sales || 0;
  if (totalSpend < 5) return friction;

  const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : Infinity;
  if (acos === Infinity || acos > 100) {
    friction.push({ priority: 'P1', issue: 'Ad spend not generating sales', evidence: 'Spent £' + totalSpend.toFixed(2) + ' for £' + totalSales.toFixed(2) + ' sales (ACOS ' + (acos === Infinity ? '∞' : acos.toFixed(0) + '%') + '). Either targeting is wrong or landing page isn\'t closing.', category: 'ad-coherence' });
  } else if (acos > 50) {
    friction.push({ priority: 'P2', issue: 'High ACOS (' + acos.toFixed(0) + '%)', evidence: 'Spent £' + totalSpend.toFixed(2) + ' for £' + totalSales.toFixed(2) + ' sales. Healthy ACOS is under 30%.', category: 'ad-coherence' });
  }

  // If using product title keywords and they appear in dossier, check for category mismatch.
  // Simple heuristic: title's primary noun should appear in at least one converting keyword.
  if (dossier.product && dossier.product.title && dossier.searchKeywords.length > 0) {
    const titleWords = dossier.product.title.toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(function(w){ return w.length > 3; });
    const wastedKeywords = dossier.searchKeywords.filter(function(k){
      if (!k.spend || k.spend < 1) return false;
      if (k.sales > 0) return false;
      const kwLower = (k.keyword || '').toLowerCase();
      // Mismatch if NO title word appears in keyword
      return !titleWords.some(function(w){ return kwLower.indexOf(w) >= 0; });
    });
    if (wastedKeywords.length > 0) {
      const wastedSpend = wastedKeywords.reduce(function(s, k){ return s + (k.spend || 0); }, 0);
      if (wastedSpend > 2) {
        friction.push({
          priority: 'P2',
          issue: '£' + wastedSpend.toFixed(2) + ' on keywords unrelated to this product',
          evidence: 'Keywords like "' + wastedKeywords.slice(0, 3).map(function(k){return k.keyword;}).join('", "') + '" cost £' + wastedSpend.toFixed(2) + ' with zero conversions. Add as negatives or move to better-matching ad groups.',
          category: 'ad-coherence'
        });
      }
    }
  }

  return friction;
}

// Main rule-based endpoint. Returns ALL rule-based findings for one product. No AI.
// Cached at the page-summary level for 12h (the rule evaluation itself runs every call,
// since dossier data — funnel, ads — refreshes more frequently).
async function getRuleFrictionForProduct(shopifyProduct) {
  const productId = String(shopifyProduct.id);
  const dossier = buildLandingPageDossier(shopifyProduct);
  if (!dossier) return { friction: [], dossier: null, pageError: 'Could not build dossier' };

  // Check page-summary cache (12h)
  let pageSummary = null;
  let pageFetchedAt = null;
  let cacheUsed = false;
  if (db) {
    try {
      const r = await db.query("SELECT page_summary, fetched_at FROM product_page_cache WHERE product_id=$1", [productId]);
      if (r.rows.length) {
        const ageHours = (Date.now() - new Date(r.rows[0].fetched_at).getTime()) / 36e5;
        if (ageHours < RULE_PAGE_CACHE_HOURS) {
          pageSummary = r.rows[0].page_summary;
          pageFetchedAt = r.rows[0].fetched_at;
          cacheUsed = true;
        }
      }
    } catch(e) { /* fall through to fresh fetch */ }
  }

  // Fresh fetch if not cached
  let pageError = null;
  if (!pageSummary) {
    if (!dossier.product.url) {
      pageError = 'Product has no handle / URL';
    } else {
      const fetchResult = await fetchProductPageHtml(dossier.product.url);
      if (!fetchResult.html) {
        pageError = fetchResult.error || 'Could not fetch page';
      } else {
        pageSummary = summariseProductPage(fetchResult.html);
        pageFetchedAt = new Date();
        // Persist
        if (db) {
          try {
            await db.query(
              "INSERT INTO product_page_cache (product_id, product_url, fetched_at, page_summary) VALUES ($1, $2, NOW(), $3) " +
              "ON CONFLICT (product_id) DO UPDATE SET product_url=EXCLUDED.product_url, fetched_at=NOW(), page_summary=EXCLUDED.page_summary",
              [productId, dossier.product.url, JSON.stringify(pageSummary)]
            );
          } catch(e) { console.error('Page cache persist error: ' + e.message); }
        }
      }
    }
  }

  // Run rule extractors (always live, even with cached page — funnel & ad data is fresher)
  const ruleFriction = pageSummary ? extractRuleFriction(pageSummary, dossier) : [];
  const funnelFriction = extractFunnelFriction(dossier.funnel);
  const adFriction = extractAdFriction(dossier);
  const allFriction = [].concat(ruleFriction, funnelFriction, adFriction);

  // Sort by priority (P1 > P2 > P3)
  allFriction.sort(function(a, b) {
    const order = { P1: 1, P2: 2, P3: 3 };
    return (order[a.priority] || 9) - (order[b.priority] || 9);
  });

  return {
    friction: allFriction,
    dossier: dossier,
    pageSummary: pageSummary,
    pageError: pageError,
    pageCacheUsed: cacheUsed,
    pageFetchedAt: pageFetchedAt,
    counts: {
      total: allFriction.length,
      p1: allFriction.filter(function(f){ return f.priority === 'P1'; }).length,
      p2: allFriction.filter(function(f){ return f.priority === 'P2'; }).length,
      p3: allFriction.filter(function(f){ return f.priority === 'P3'; }).length
    }
  };
}

app.post('/api/google/rule-friction', async function(req, res) {
  try {
    const productId = String(req.body.productId || '');
    if (!productId) return res.status(400).json({ error: 'productId required' });
    const sp = (shopifyState.products || []).find(function(p){ return String(p.id) === productId; });
    if (!sp) return res.status(404).json({ error: 'Product not found in Shopify state' });
    const result = await getRuleFrictionForProduct(sp);
    res.json(result);
  } catch(e) {
    console.error('Rule friction error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Batch endpoint: rule-friction for ALL Shopify-matched products at once.
// Used by the All Products grid to show per-card friction summary.
// No AI, just rule scans, but still costs ~50 page fetches first time.
// Subsequent calls hit the 12h page cache.
app.get('/api/google/rule-friction/list', async function(req, res) {
  if (!db) return res.json({ items: [] });
  try {
    // Read every product whose page_summary is cached. If the table doesn't exist yet
    // (first deploy of the new feature), return empty list rather than 500.
    let r;
    try {
      r = await db.query("SELECT product_id, product_url, fetched_at, page_summary FROM product_page_cache");
    } catch (tableErr) {
      console.log('product_page_cache not ready yet: ' + tableErr.message);
      return res.json({ items: [] });
    }

    const items = [];
    const byId = {};
    r.rows.forEach(function(row) { byId[row.product_id] = row; });

    (shopifyState.products || []).forEach(function(sp) {
      try {
        const id = String(sp.id);
        const cached = byId[id];
        if (!cached || !cached.page_summary) return;

        const dossier = buildLandingPageDossier(sp);
        if (!dossier) return;

        const ruleFriction = extractRuleFriction(cached.page_summary, dossier);
        const funnelFriction = extractFunnelFriction(dossier.funnel);
        const adFriction = extractAdFriction(dossier);
        const all = [].concat(ruleFriction, funnelFriction, adFriction);
        all.sort(function(a, b) {
          const order = { P1: 1, P2: 2, P3: 3 };
          return (order[a.priority] || 9) - (order[b.priority] || 9);
        });
        const counts = { p1: all.filter(function(f){return f.priority==='P1';}).length, p2: all.filter(function(f){return f.priority==='P2';}).length, p3: all.filter(function(f){return f.priority==='P3';}).length };
        if (all.length === 0) return;
        items.push({ productId: id, productTitle: sp.title, counts: counts, top: all.slice(0, 3) });
      } catch (perProductErr) {
        // Skip a single bad product rather than 500 the whole list
        console.error('rule-friction list per-product error: ' + perProductErr.message);
      }
    });

    res.json({ items: items });
  } catch(e) {
    console.error('rule-friction list error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Layer 4: Landing page critique
// ─────────────────────────────────────────────────────────────────────────
//
// Stitches Shopify + Google Ads + GA4 data per product, fetches the live
// product page, summarises both, and asks Claude to produce a structured
// critique: where in the funnel are people dropping, what's wrong with the
// landing page, and what specific actions to take.
//
// Endpoints:
//   POST /api/google/landing-page-critique          { productId, forceRefresh }
//   GET  /api/google/landing-page-critique/list     → cached top-10
//   POST /api/google/landing-page-critique-batch    (manager-only) → run top-10 now
//
// Cache: 24h, in landing_page_critiques. forceRefresh=true bypasses cache.
// Daily cron: 03:30 London time, runs the batch automatically.

const LPC_CACHE_HOURS = 24;
const LPC_MODEL = 'claude-opus-4-7';

// Strip <script>, <style>, comments and tags, collapse whitespace.
// Returns the visible-text content of the page plus a few structural signals.
function summariseProductPage(html) {
  if (!html || typeof html !== 'string') return { text: '', signals: {} };
  const signals = {
    hasViewportMeta: /<meta[^>]+name=["']viewport["']/i.test(html),
    pageBytes: html.length,
    imageCount: (html.match(/<img\b/gi) || []).length,
    h1Count: (html.match(/<h1\b/gi) || []).length,
    hasReviewWidget: /reviews?|rating|stars?/i.test(html) && /<svg|class="[^"]*star/i.test(html),
    hasShippingMention: /free (uk )?(delivery|shipping)|next.day|24.hour/i.test(html),
    hasReturnsMention: /returns?|refund|money.back|guarantee/i.test(html),
    hasUrgencyBadges: /(only \d+ left|selling fast|in stock|low stock|hurry|limited)/i.test(html),
    hasPrice: /£\d|currency/i.test(html),
    addToCartCount: (html.match(/add to cart|add to bag|add to basket/gi) || []).length
  };

  // Try to extract the page title and meta description first
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const productJsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  let jsonLd = null;
  if (productJsonLdMatch) {
    try { jsonLd = JSON.parse(productJsonLdMatch[1].trim()); } catch(e) {}
  }

  // Strip noise to get the visible text
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  // Trim to ~6000 chars (~1500 tokens) — enough for AI to assess content quality
  if (body.length > 6000) body = body.substring(0, 6000) + '... [truncated]';

  return {
    pageTitle: titleMatch ? titleMatch[1].trim() : null,
    metaDescription: (metaDescMatch || ogDescMatch) ? (metaDescMatch || ogDescMatch)[1].trim() : null,
    jsonLdPresent: !!jsonLd,
    jsonLdType: jsonLd && (jsonLd['@type'] || (Array.isArray(jsonLd) && jsonLd[0] && jsonLd[0]['@type'])) || null,
    text: body,
    signals: signals
  };
}

async function fetchProductPageHtml(url) {
  if (!url) return { html: null, error: 'No URL provided' };
  try {
    const resp = await axios.get(url, {
      timeout: 20000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        // Force UK locale so Shopify/Cloudflare serve the GBP-priced page (matches what UK shoppers see).
        // Without these, Shopify auto-detects server IP location and shows USD/etc, causing false-positive
        // 'currency mismatch' findings in the AI critique.
        'Accept-Language': 'en-GB,en;q=0.9',
        'CF-IPCountry': 'GB',
        'X-Forwarded-For': '81.2.69.142',  // a UK-based residential IP range (BT)
        'Accept-Encoding': 'gzip, deflate, br'
      },
      validateStatus: function(s){ return s >= 200 && s < 400; }
    });
    if (!resp.data || typeof resp.data !== 'string') {
      return { html: null, error: 'Response not HTML (got ' + typeof resp.data + ')', url: url, status: resp.status };
    }
    return { html: resp.data, error: null, url: url, status: resp.status, bytes: resp.data.length };
  } catch (e) {
    const detail = {
      message: e.message,
      code: e.code || null,
      status: e.response ? e.response.status : null,
      url: url
    };
    console.error('Landing page fetch failed: ' + JSON.stringify(detail));
    return { html: null, error: e.message, code: e.code, status: detail.status, url: url };
  }
}

// Build the dossier we feed to Claude. Pure data — no AI prompt yet.
function buildLandingPageDossier(shopifyProduct) {
  if (!shopifyProduct) return null;
  const productId = String(shopifyProduct.id);

  // The PUBLIC storefront URL — what customers actually see when they click an ad.
  // shopifyProduct.shopifyUrl points at the admin page (myshopify.com/admin/...) which
  // requires auth, so we always build the storefront URL from the handle.
  // Append ?country=GB&currency=GBP so Shopify renders the UK market view regardless
  // of server IP — without this, the page comes back in USD because Shopify auto-detects
  // the request origin location.
  const storefrontDomain = process.env.SHOPIFY_STOREFRONT_DOMAIN || 'www.fksports.co.uk';
  const storefrontUrl = shopifyProduct.handle
    ? ('https://' + storefrontDomain + '/products/' + shopifyProduct.handle + '?country=GB&currency=GBP')
    : null;

  // Google Ads rows for this product (across all campaigns)
  const adRows = (googleState.products || []).filter(function(gp) {
    if (!gp.shopifyItemId) return false;
    const parts = String(gp.shopifyItemId).split('_');
    return parts.length >= 4 && parts[2] === productId;
  });
  const adAgg = aggregateGoogleMetrics(adRows);

  // Search keywords driving traffic to ad groups whose product groups include this product
  const adGroupNames = {};
  adRows.forEach(function(r){ if (r.adGroupName) adGroupNames[r.adGroupName] = true; });
  const searchKeywords = (googleState.products || [])
    .filter(function(gp){ return gp.itemType === 'keyword' && (gp.spend > 0 || gp.impressions > 0); })
    .slice(0, 20)
    .map(function(gp){ return { keyword: gp.name, spend: gp.spend, sales: gp.sales, clicks: gp.clicks, conversions: gp.conversions }; });

  // GA4 funnel for this product's URL path
  let funnel = null;
  if (shopifyProduct.handle) {
    const path = '/products/' + shopifyProduct.handle;
    funnel = (ga4State.productMetrics || {})[path] || null;
  }

  return {
    product: {
      id: productId,
      title: shopifyProduct.title,
      handle: shopifyProduct.handle,
      url: storefrontUrl,
      adminUrl: shopifyProduct.shopifyUrl || null,
      price: shopifyProduct.price,
      status: shopifyProduct.status,
      inventory: shopifyProduct.inventory,
      revenue7d: shopifyProduct.revenue7d || 0,
      revenue30d: shopifyProduct.revenue30d || 0,
      unitsSold7d: shopifyProduct.unitsSold7d || 0,
      unitsSold30d: shopifyProduct.unitsSold30d || 0
    },
    ads: {
      spend: adAgg.spend,
      sales: adAgg.sales,
      impressions: adAgg.impressions,
      clicks: adAgg.clicks,
      conversions: adAgg.conversions,
      ctr: adAgg.ctr,
      acos: adAgg.acos,
      costPerConv: adAgg.costPerConv,
      campaignsCount: adAgg.campaignsAdvertisedIn.length,
      campaignNames: adAgg.campaignsAdvertisedIn.map(function(c){ return c.campaignName; })
    },
    searchKeywords: searchKeywords,
    funnel: funnel ? {
      sessions: funnel.sessions,
      cartAdditions: funnel.cartAdditions,
      checkouts: funnel.checkouts,
      purchases: funnel.purchases,
      cartRate: funnel.sessions > 0 ? Math.round((funnel.cartAdditions / funnel.sessions) * 1000) / 10 : 0,
      checkoutFromCart: funnel.cartAdditions > 0 ? Math.round((funnel.checkouts / funnel.cartAdditions) * 1000) / 10 : 0,
      purchaseFromCheckout: funnel.checkouts > 0 ? Math.round((funnel.purchases / funnel.checkouts) * 1000) / 10 : 0,
      bounceRate: funnel.bounceRate,
      engagementRate: funnel.engagementRate,
      avgEngagementTime: funnel.avgEngagementTime
    } : null
  };
}

function buildCritiquePrompt(dossier, pageSummary) {
  return [
    "You are helping a marketing agent at FK Sports UK understand why a product on their Shopify store isn't selling well.",
    "The agent is NOT a technical expert. They speak plain English and need clear, actionable advice — not industry jargon.",
    "",
    "WRITING RULES — these are mandatory:",
    "• Write like you're talking to a small-business owner, not a marketing director.",
    "• NO jargon. Avoid: CRO, CTA, funnel, conversion rate optimisation, friction, value proposition, USP, social proof, A/B test, heatmap, bounce rate, attribution.",
    "• If you must use a term, explain it in brackets the first time. Example: 'CTA (the buy button)'.",
    "• Every problem you flag must say WHY it's a problem in real-world terms. Don't say 'weak CTA' — say 'the Add to Cart button is small and hard to find on mobile, so people give up before buying'.",
    "• Every action must be something a person could do this week without specialist help.",
    "• Use simple sentences. Short is better than long.",
    "• Use £ for money. Talk about 'shoppers' or 'people' — not 'users' or 'sessions'.",
    "",
    "IMPORTANT CONTEXT — DO NOT misinterpret currency:",
    "• This is a UK-based store (fksports.co.uk). All prices in the dossier are in GBP (£).",
    "• The live page is fetched with ?country=GB&currency=GBP query parameters and UK headers, so it should render in GBP.",
    "• If the page text still contains '$' or 'USD' references, this is likely Shopify's currency selector dropdown listing other markets — NOT the price the UK customer sees.",
    "• DO NOT flag a 'currency mismatch' or 'USD shown to UK shoppers' unless you have direct evidence in the page TEXT that the actual product price next to Add to Cart is shown in USD.",
    "• The dossier price is the source of truth for the GBP price.",
    "",
    "Your job: explain in plain English why this product is or isn't selling, and what to fix this week.",
    "",
    "PRODUCT DOSSIER:",
    "```json",
    JSON.stringify(dossier, null, 2),
    "```",
    "",
    "LANDING PAGE — STRUCTURAL SIGNALS:",
    JSON.stringify(pageSummary.signals, null, 2),
    "",
    "LANDING PAGE — META:",
    "Page title: " + (pageSummary.pageTitle || '(none)'),
    "Meta description: " + (pageSummary.metaDescription || '(none)'),
    "JSON-LD product schema present: " + pageSummary.jsonLdPresent,
    "",
    "LANDING PAGE — VISIBLE TEXT (truncated to 6000 chars):",
    pageSummary.text,
    "",
    "Return STRICT JSON in this exact shape (no markdown fences, no commentary):",
    "{",
    '  "diagnosis": "ONE plain-English sentence saying what the main problem is. No jargon.",',
    '  "funnelDiagnosis": "Where shoppers are dropping off, in plain language. E.g. \\"500 people visited but only 3 added to cart — most leave before clicking Buy.\\" Use real numbers.",',
    '  "frictionPoints": [',
    '    { "priority": "P1|P2|P3", "issue": "Short plain-English title", "evidence": "Why this is a problem in everyday language. Cite numbers or page text. No jargon.", "category": "trust|price|cta|copy|imagery|mobile|stock|ad-coherence|other" }',
    '  ],',
    '  "actions": [',
    '    { "rank": 1, "action": "What to do this week, written as a clear instruction. E.g. \\"Add a bigger Buy Now button on the product page.\\"", "expectedImpact": "What might happen if this is fixed, in plain words. E.g. \\"More people likely to click Buy on phones.\\"", "effort": "low|medium|high" }',
    '  ],',
    '  "adVsPageCoherence": "Plain English: does what the ad promised match what the visitor sees? Be specific.",',
    '  "trustSignals": "What customer trust signs are on the page (reviews, free returns, badges) and what is missing — in everyday words.",',
    '  "summary": "2-3 sentences any agent can read and immediately understand. The single most important thing they should know."',
    "}",
    "",
    "Rules:",
    "- Be specific. Quote numbers. Reference exact text from the page where useful.",
    "- Rank friction points P1 (highest impact, fix first) to P3 (low priority).",
    "- Provide 3 to 6 actions, ranked by expected revenue impact.",
    "- Don't invent data. If the page text is missing something, say so explicitly.",
    "- If the funnel data is null, say funnel data unavailable in funnelDiagnosis.",
    "- Keep your response under 1500 words total."
  ].join('\n');
}

// Pick the top 10 products to analyse, by combined "wasted spend" score.
// Includes both burning-money (high spend, no sales) and inefficient (high ACOS) cases.
function pickTopUnderperformers(limit) {
  limit = limit || 10;
  const candidates = [];
  (shopifyState.products || []).forEach(function(sp) {
    const id = String(sp.id);
    const adRows = (googleState.products || []).filter(function(gp) {
      if (!gp.shopifyItemId) return false;
      const parts = String(gp.shopifyItemId).split('_');
      return parts.length >= 4 && parts[2] === id;
    });
    if (!adRows.length) return;
    const agg = aggregateGoogleMetrics(adRows);
    if (agg.spend < 20) return;     // ignore tiny spend
    const sales = agg.sales || 0;
    const acos = sales > 0 ? (agg.spend / sales) * 100 : Infinity;
    // Score: weighted combination
    //  - if sales=0: full spend counts as wasted (high score)
    //  - if acos > 30: count the over-spend as wasted, weighted by spend
    let score = 0;
    if (sales === 0) {
      score = agg.spend * 2;        // burning money — double weight
    } else if (acos > 30) {
      const targetSpend = sales * 0.30;
      score = agg.spend - targetSpend;
    } else {
      return;                        // healthy product, skip
    }
    candidates.push({ shopifyProduct: sp, agg: agg, score: score });
  });
  candidates.sort(function(a,b){ return b.score - a.score; });
  return candidates.slice(0, limit);
}

async function getCachedCritique(productId) {
  if (!db) return null;
  try {
    const r = await db.query("SELECT * FROM landing_page_critiques WHERE product_id=$1", [String(productId)]);
    console.log('[LPC] cache lookup productId=' + productId + ' → ' + (r.rows.length ? 'HIT, generated_at=' + r.rows[0].generated_at : 'MISS'));
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const ageHours = (Date.now() - new Date(row.generated_at).getTime()) / 36e5;
    if (ageHours > LPC_CACHE_HOURS) {
      console.log('[LPC] cache STALE productId=' + productId + ' (' + ageHours.toFixed(1) + 'h old, max=' + LPC_CACHE_HOURS + 'h)');
      return null;
    }
    // Detect partial saves (truncated AI response): friction empty + diagnosis hints partial,
    // OR diagnosis says "(AI returned non-JSON" / "(Partial".
    const diagText = row.diagnosis || '';
    const partialFlag = (diagText.indexOf('(Partial') >= 0)
      || (diagText.indexOf('non-JSON') >= 0)
      || (!row.friction_json || (Array.isArray(row.friction_json) && row.friction_json.length === 0));
    return {
      productId: row.product_id,
      productTitle: row.product_title,
      productUrl: row.product_url,
      generatedAt: row.generated_at,
      diagnosis: row.diagnosis,
      friction: row.friction_json,
      actions: row.actions_json,
      funnelSummary: row.funnel_summary,
      adSummary: row.ad_summary,
      pageSummary: row.page_summary,
      rawText: row.raw_ai_text || '',
      partial: !!partialFlag,
      score: parseFloat(row.score) || 0,
      cached: true,
      ageHours: Math.round(ageHours * 10) / 10
    };
  } catch (e) {
    console.error('[LPC] cache read error productId=' + productId + ': ' + e.message);
    return null;
  }
}

// When max_tokens truncates Claude's response mid-JSON, JSON.parse fails. This helper
// attempts to extract individual fields with regex so we can salvage what's there
// rather than showing the agent nothing useful. Marks the result as partial so the
// front-end can prompt for re-run with more tokens.
function recoverPartialCritiqueJson(rawText) {
  const result = {
    diagnosis: '',
    funnelDiagnosis: '',
    frictionPoints: [],
    actions: [],
    adVsPageCoherence: '',
    trustSignals: '',
    summary: ''
  };

  // diagnosis — single-line string field
  const diagMatch = rawText.match(/"diagnosis"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (diagMatch) result.diagnosis = diagMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim();

  const funnelMatch = rawText.match(/"funnelDiagnosis"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (funnelMatch) result.funnelDiagnosis = funnelMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim();

  const adCoMatch = rawText.match(/"adVsPageCoherence"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (adCoMatch) result.adVsPageCoherence = adCoMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim();

  const trustMatch = rawText.match(/"trustSignals"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (trustMatch) result.trustSignals = trustMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim();

  const sumMatch = rawText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (sumMatch) result.summary = sumMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim();

  // frictionPoints — array of {priority, issue, evidence, category} objects.
  // Try to find each complete object even if the whole array isn't complete.
  const friMatches = rawText.match(/\{\s*"priority"\s*:\s*"P[1-3]"[^{}]*?\}/g);
  if (friMatches) {
    friMatches.forEach(function(s){
      try {
        const obj = JSON.parse(s);
        if (obj.priority && obj.issue) result.frictionPoints.push(obj);
      } catch(_) { /* skip malformed */ }
    });
  }

  // actions — array of {rank, action, expectedImpact, effort}
  const actMatches = rawText.match(/\{\s*"rank"\s*:\s*\d+[^{}]*?\}/g);
  if (actMatches) {
    actMatches.forEach(function(s){
      try {
        const obj = JSON.parse(s);
        if (obj.rank && obj.action) result.actions.push(obj);
      } catch(_) { /* skip malformed */ }
    });
  }

  return result;
}

async function runCritiqueForProduct(shopifyProduct, score) {
  const dossier = buildLandingPageDossier(shopifyProduct);
  if (!dossier) throw new Error('Could not build dossier');
  const fetchResult = await fetchProductPageHtml(dossier.product.url);
  if (!fetchResult.html) {
    throw new Error('Could not fetch product page (' + dossier.product.url + '): ' + (fetchResult.error || 'unknown') + (fetchResult.code ? ' [' + fetchResult.code + ']' : '') + (fetchResult.status ? ' status=' + fetchResult.status : ''));
  }
  const pageSummary = summariseProductPage(fetchResult.html);
  const prompt = buildCritiquePrompt(dossier, pageSummary);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const aiResp = await axios.post('https://api.anthropic.com/v1/messages', {
    model: LPC_MODEL,
    max_tokens: 4500,
    messages: [{ role: 'user', content: prompt }]
  }, {
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    timeout: 90000
  });

  const rawText = aiResp.data.content[0].text;
  // Strip any accidental markdown fences
  const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();

  let parsed;
  let partial = false;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // JSON parse failed — likely truncated mid-response. Try to recover what we can
    // by manually extracting individual top-level fields with regex. Mark `partial:true`
    // so the front-end can show a "complete this" hint.
    console.warn('[LPC] JSON parse failed, attempting partial recovery: ' + e.message);
    partial = true;
    parsed = recoverPartialCritiqueJson(cleaned);
  }

  const result = {
    productId: String(shopifyProduct.id),
    productTitle: shopifyProduct.title,
    productUrl: dossier.product.url,
    generatedAt: new Date(),
    diagnosis: parsed.diagnosis || (partial ? '(Partial — see full text below)' : ''),
    friction: parsed.frictionPoints || [],
    actions: parsed.actions || [],
    funnelSummary: { funnel: dossier.funnel, funnelDiagnosis: parsed.funnelDiagnosis || '' },
    adSummary: { ads: dossier.ads, searchKeywords: dossier.searchKeywords, adVsPageCoherence: parsed.adVsPageCoherence || '' },
    pageSummary: { signals: pageSummary.signals, pageTitle: pageSummary.pageTitle, metaDescription: pageSummary.metaDescription, trustSignals: parsed.trustSignals || '', summary: parsed.summary || '' },
    rawText: rawText,
    partial: partial,
    score: score || 0,
    cached: false
  };

  // Persist
  if (db) {
    try {
      await db.query(
        "INSERT INTO landing_page_critiques (product_id, product_title, product_url, generated_at, diagnosis, friction_json, actions_json, funnel_summary, ad_summary, page_summary, raw_ai_text, score) " +
        "VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11) " +
        "ON CONFLICT (product_id) DO UPDATE SET " +
        "  product_title=EXCLUDED.product_title, product_url=EXCLUDED.product_url, generated_at=NOW(), " +
        "  diagnosis=EXCLUDED.diagnosis, friction_json=EXCLUDED.friction_json, actions_json=EXCLUDED.actions_json, " +
        "  funnel_summary=EXCLUDED.funnel_summary, ad_summary=EXCLUDED.ad_summary, page_summary=EXCLUDED.page_summary, " +
        "  raw_ai_text=EXCLUDED.raw_ai_text, score=EXCLUDED.score",
        [result.productId, result.productTitle, result.productUrl, result.diagnosis,
          JSON.stringify(result.friction), JSON.stringify(result.actions),
          JSON.stringify(result.funnelSummary), JSON.stringify(result.adSummary), JSON.stringify(result.pageSummary),
          rawText, result.score]
      );
      console.log('[LPC] persisted productId=' + result.productId + ' title="' + (result.productTitle || '').slice(0, 40) + '"');
    } catch (e) {
      console.error('[LPC] persist error productId=' + result.productId + ': ' + e.message);
    }
  } else {
    console.warn('[LPC] no db — analysis not persisted, will be lost when you close the modal');
  }
  return result;
}

// ── Endpoints ────────────────────────────────────────────────────────────

// Debug: probe the page-fetch in isolation. Helps diagnose DNS/firewall/Cloudflare issues
// without burning AI tokens. Usage: POST /api/google/landing-page-critique-debug { productId } or { url }
app.post('/api/google/landing-page-critique-debug', async function(req, res) {
  try {
    let url = req.body.url;
    let productInfo = null;
    if (!url && req.body.productId) {
      const sp = (shopifyState.products || []).find(function(p){ return String(p.id) === String(req.body.productId); });
      if (!sp) return res.status(404).json({ error: 'Product not found in shopifyState' });
      productInfo = { id: sp.id, title: sp.title, handle: sp.handle, shopifyAdminUrl: sp.shopifyUrl };
      const storefrontDomain = process.env.SHOPIFY_STOREFRONT_DOMAIN || 'www.fksports.co.uk';
      url = sp.handle ? ('https://' + storefrontDomain + '/products/' + sp.handle + '?country=GB&currency=GBP') : null;
      if (!url) return res.status(400).json({ error: 'Product has no handle, cannot build URL' });
    }
    if (!url) return res.status(400).json({ error: 'productId or url required' });
    const fetchResult = await fetchProductPageHtml(url);
    res.json({
      productInfo: productInfo,
      attemptedUrl: url,
      success: !!fetchResult.html,
      error: fetchResult.error,
      errorCode: fetchResult.code,
      httpStatus: fetchResult.status,
      bytes: fetchResult.bytes || 0,
      htmlSnippet: fetchResult.html ? fetchResult.html.substring(0, 500) : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/google/landing-page-critique', async function(req, res) {
  try {
    const productId = String(req.body.productId || '');
    const requestedRefresh = !!req.body.forceRefresh;
    const cachedOnly = !!req.body.cachedOnly;   // if true, never auto-run AI, return 404 when no cache
    if (!productId) return res.status(400).json({ error: 'productId required' });

    const sp = (shopifyState.products || []).find(function(p){ return String(p.id) === productId; });
    if (!sp) return res.status(404).json({ error: 'Product not found in Shopify state' });

    // 24h lock: if a critique was generated in the last 24h, return it. Only managers
    // can override (forceRefresh=true requires manager role).
    const u = req.user || {};
    const isManager = ['manager','admin'].includes(u.role) || ['Bobby','Satyam','bobby','satyam'].includes(u.name || u.username || '');
    let forceRefresh = false;
    if (requestedRefresh && !cachedOnly) {
      if (isManager) {
        forceRefresh = true;
      } else {
        // Agent requested refresh — only allowed if no cache exists yet (first run)
        const existing = await getCachedCritique(productId);
        if (existing) {
          // Cache exists; agent cannot force-refresh, return cached with a notice
          existing.lockedForAgent = true;
          existing.lockMessage = 'Already analysed in the last 24h. Manager can re-analyse.';
          return res.json(existing);
        }
        // No cache — agent's first request triggers a fresh run
        forceRefresh = true;
      }
    }

    if (!forceRefresh) {
      const cached = await getCachedCritique(productId);
      if (cached) {
        cached.lockedForAgent = !isManager;
        return res.json(cached);
      }
      // No cache. If caller asked for cachedOnly, do NOT auto-run AI — return 404.
      if (cachedOnly) {
        return res.status(404).json({ error: 'No cached analysis', cached: false });
      }
    }
    const result = await runCritiqueForProduct(sp, 0);
    result.lockedForAgent = !isManager;
    res.json(result);
  } catch (e) {
    console.error('LPC single error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/google/landing-page-critique/list', async function(req, res) {
  if (!db) return res.json({ items: [] });
  try {
    const r = await db.query("SELECT product_id, product_title, product_url, generated_at, diagnosis, friction_json, actions_json, score FROM landing_page_critiques ORDER BY score DESC, generated_at DESC LIMIT 20");
    const items = r.rows.map(function(row) {
      const ageHours = (Date.now() - new Date(row.generated_at).getTime()) / 36e5;
      return {
        productId: row.product_id,
        productTitle: row.product_title,
        productUrl: row.product_url,
        generatedAt: row.generated_at,
        diagnosis: row.diagnosis,
        topFriction: (row.friction_json || []).slice(0, 3),
        topActions: (row.actions_json || []).slice(0, 3),
        score: parseFloat(row.score) || 0,
        ageHours: Math.round(ageHours * 10) / 10,
        stale: ageHours > LPC_CACHE_HOURS
      };
    });
    res.json({ items: items });
  } catch (e) {
    console.error('LPC list error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// MANUAL INIT: force-creates the new AI/cache tables. Use this if the boot-time
// init didn't run (e.g. earlier migration failed). Safe to call multiple times —
// CREATE TABLE IF NOT EXISTS is idempotent.
app.post('/api/google/init-tables', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'no db connection' });
  const results = {};
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS landing_page_critiques (
        product_id TEXT PRIMARY KEY,
        product_title TEXT,
        product_url TEXT,
        generated_at TIMESTAMP DEFAULT NOW(),
        diagnosis TEXT,
        friction_json JSONB,
        actions_json JSONB,
        funnel_summary JSONB,
        ad_summary JSONB,
        page_summary JSONB,
        raw_ai_text TEXT,
        score NUMERIC DEFAULT 0
      )
    `);
    await db.query("CREATE INDEX IF NOT EXISTS idx_lpc_generated_at ON landing_page_critiques(generated_at DESC)");
    results.landing_page_critiques = 'ready';
  } catch(e) { results.landing_page_critiques = 'error: ' + e.message; }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS campaign_ai_cache (
        campaign_id TEXT PRIMARY KEY,
        campaign_name TEXT,
        generated_at TIMESTAMP DEFAULT NOW(),
        analysis TEXT,
        model_used TEXT
      )
    `);
    results.campaign_ai_cache = 'ready';
  } catch(e) { results.campaign_ai_cache = 'error: ' + e.message; }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS product_page_cache (
        product_id TEXT PRIMARY KEY,
        product_url TEXT,
        fetched_at TIMESTAMP DEFAULT NOW(),
        page_summary JSONB,
        rule_friction JSONB,
        funnel_friction JSONB,
        ad_friction JSONB
      )
    `);
    results.product_page_cache = 'ready';
  } catch(e) { results.product_page_cache = 'error: ' + e.message; }

  // Verify tables exist now
  try {
    const r = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('landing_page_critiques','campaign_ai_cache','product_page_cache')");
    results.verifiedTables = r.rows.map(function(row){ return row.table_name; });
  } catch(e) { results.verifyError = e.message; }

  res.json({ ok: true, results: results });
});

// DEBUG: lists every row in the critique table — used to verify saves actually happen.
// Hit this in browser to see what's in the DB. Returns minimal info so it's safe to call.
app.get('/api/google/landing-page-critique-debug-list', async function(req, res) {
  if (!db) return res.json({ rows: [], note: 'no db connection' });
  try {
    const r = await db.query(
      "SELECT product_id, product_title, generated_at, " +
      "LENGTH(diagnosis) AS diag_len, " +
      "(friction_json IS NOT NULL) AS has_friction, " +
      "(actions_json IS NOT NULL) AS has_actions " +
      "FROM landing_page_critiques ORDER BY generated_at DESC LIMIT 100"
    );
    res.json({
      count: r.rows.length,
      cacheHours: LPC_CACHE_HOURS,
      rows: r.rows.map(function(row) {
        const ageHours = (Date.now() - new Date(row.generated_at).getTime()) / 36e5;
        return {
          productId: row.product_id,
          productTitle: (row.product_title || '').slice(0, 60),
          generatedAt: row.generated_at,
          ageHours: Math.round(ageHours * 10) / 10,
          stale: ageHours > LPC_CACHE_HOURS,
          diagLen: row.diag_len || 0,
          hasFriction: row.has_friction,
          hasActions: row.has_actions
        };
      })
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/google/landing-page-critique-batch', async function(req, res) {
  // Manager-only
  const u = req.user || {};
  const isManager = ['manager','admin'].includes(u.role) || ['Bobby','Satyam','bobby','satyam'].includes(u.name);
  if (!isManager) return res.status(403).json({ error: 'Manager access required' });

  try {
    const top = pickTopUnderperformers(10);
    const results = [];
    const errors = [];
    // Sequential to avoid hammering Anthropic. ~5-10s per product → up to ~2 min for 10 products.
    for (const c of top) {
      try {
        const r = await runCritiqueForProduct(c.shopifyProduct, c.score);
        results.push({ productId: r.productId, productTitle: r.productTitle, score: c.score });
      } catch (e) {
        errors.push({ productId: String(c.shopifyProduct.id), title: c.shopifyProduct.title, error: e.message });
      }
    }
    res.json({ analysed: results.length, errors: errors.length, results: results, errorDetail: errors });
  } catch (e) {
    console.error('LPC batch error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Daily cron: 03:30 London time
cron.schedule('30 3 * * *', async function() {
  console.log('LPC nightly batch starting');
  try {
    const top = pickTopUnderperformers(10);
    let ok = 0, err = 0;
    for (const c of top) {
      try { await runCritiqueForProduct(c.shopifyProduct, c.score); ok++; }
      catch (e) { err++; console.error('LPC cron item error: ' + e.message); }
    }
    console.log('LPC nightly batch done — ' + ok + ' analysed, ' + err + ' errors');
  } catch(e) {
    console.error('LPC nightly batch top-level error: ' + e.message);
  }
}, { timezone: 'Europe/London' });


app.listen(PORT, '0.0.0.0', async function() {
  console.log('App running on port ' + PORT);
  await initDB();
  if (db) {
    try {
      const result = await db.query('SELECT settings FROM app_settings WHERE id = 1');
      const settings = result.rows[0]?.settings || {};
      if (settings.acosCritical) process.env.ACOS_CRITICAL_THRESHOLD = String(settings.acosCritical);
      if (settings.acosWarning) process.env.ACOS_WARNING_THRESHOLD = String(settings.acosWarning);
      if (settings.budgetLowPct) process.env.BUDGET_LOW_PERCENT = String(settings.budgetLowPct);
      if (Object.keys(settings).length) console.log('Settings loaded from DB: ' + JSON.stringify(settings));
    } catch(e) { console.error('Settings load error: ' + e.message); }

    // Hydrate googleState from the most recent snapshot in DB.
    // Prevents the "dashboard goes blank after every deploy" problem — agents see
    // last-known data immediately on boot, regardless of whether the script has
    // run since the redeploy.
    try {
      const snap = await db.query("SELECT received_at, campaigns, products, last_sync_label, campaigns_count, products_count FROM google_state_snapshots ORDER BY received_at DESC LIMIT 1");
      if (snap.rows.length) {
        const r = snap.rows[0];
        googleState.campaigns = r.campaigns || [];
        googleState.products = r.products || [];
        googleState.lastSync = r.last_sync_label;
        googleState.lastReceivedAt = r.received_at ? new Date(r.received_at).toISOString() : null;
        const ageHours = ((Date.now() - new Date(r.received_at).getTime()) / 36e5).toFixed(1);
        console.log('[GOOGLE-STATE] hydrated from DB: ' + (r.campaigns_count || 0) + ' campaigns, ' + (r.products_count || 0) + ' products, ' + ageHours + 'h old');
      } else {
        console.log('[GOOGLE-STATE] no snapshots in DB yet — waiting for first ingest');
      }
    } catch(e) {
      console.error('[GOOGLE-STATE] hydrate error: ' + e.message);
    }
  }
  setTimeout(function() {
    syncCampaigns().catch(function(err) { console.error('Initial sync failed:', err.message); });
    syncShopifyProducts().catch(function(err) { console.error('Initial Shopify sync failed:', err.message); });
    loadGa4StateFromDb().then(function() {
      // Only refresh GA4 if we have a connection and last fetch was > 12h ago (avoid hammering on every restart)
      fetchGa4ProductMetrics().catch(function(err) { console.error('Initial GA4 fetch failed:', err.message); });
    });
  }, 30000);
});

// ── Google Product AI Analysis ────────────────────────────────────────────
// Accepts a product (Shopify-led row OR campaign-grouped row) and returns a
// concise actionable analysis. Optionally fetches the product page to give
// listing-quality feedback (image, title length, description, price).
app.post('/api/google/ai-analyse', async function(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'No API key' });
  const { product, includePageContent } = req.body;
  if (!product) return res.status(400).json({ error: 'No product data' });
  try {
    // Normalise: works for both shapes (Shopify-led `all-products` rows
    // and Google-led `products-diagnostic` rows)
    const name = product.title || product.displayName || product.productName || product.shopifyTitle || '(unknown)';
    const price = product.price != null ? product.price : product.shopifyPrice;
    const inventory = product.inventory != null ? product.inventory : product.shopifyInventory;
    const status = product.status || product.shopifyStatus;
    const rev7d = product.revenue7d != null ? product.revenue7d : product.shopifyRevenue7d;
    const units7d = product.unitsSold7d != null ? product.unitsSold7d : product.shopifyUnitsSold7d;
    const rev30d = product.revenue30d != null ? product.revenue30d : product.shopifyRevenue30d;
    const units30d = product.unitsSold30d != null ? product.unitsSold30d : product.shopifyUnitsSold30d;
    const productUrl = product.url || null;

    // Google metrics may live on either `googleX` (all-products view) or top-level (advertised view)
    const gImp = product.googleImpressions != null ? product.googleImpressions : (product.impressions || 0);
    const gClk = product.googleClicks != null ? product.googleClicks : (product.clicks || 0);
    const gCtr = product.googleCtr != null ? product.googleCtr : (product.ctr || 0);
    const gConv = product.googleConversions != null ? product.googleConversions : (product.conversions || 0);
    const gSpend = product.googleSpend != null ? product.googleSpend : (product.spend || 0);
    const gSales = product.googleSales != null ? product.googleSales : (product.sales || 0);
    const gAcos = product.googleAcos != null ? product.googleAcos : (product.acos || 0);

    // Optionally fetch the product page so the AI can give listing-quality feedback
    let pageSnippet = '';
    if (includePageContent && productUrl) {
      try {
        const pageRes = await axios.get(productUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 CampaignPulse' } });
        const html = String(pageRes.data || '');
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
        const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
        pageSnippet = '\nLIVE PAGE CONTENT:\n'
          + '- Page title: ' + (titleMatch ? titleMatch[1].trim().slice(0, 200) : '(missing)') + ' (' + (titleMatch ? titleMatch[1].length : 0) + ' chars)\n'
          + '- Meta description: ' + (descMatch ? descMatch[1].slice(0, 200) : '(missing)') + '\n'
          + '- H1: ' + (h1Match ? h1Match[1].trim().slice(0, 200) : '(missing)') + '\n'
          + '- OG image: ' + (ogImageMatch ? 'present' : 'MISSING (hurts social/SEO sharing)');
      } catch(e) {
        pageSnippet = '\nLIVE PAGE CONTENT: could not fetch (' + e.message + ')';
      }
    }

    // GA4 funnel snippet
    const f = product.ga4Sessions != null ? {
      sessions: product.ga4Sessions, cartAdditions: product.ga4CartAdditions, checkouts: product.ga4Checkouts,
      purchases: product.ga4Purchases, bounceRate: product.ga4BounceRate, engagementRate: product.ga4EngagementRate,
      avgEngagementTime: product.ga4AvgEngagementTime, cartRate: product.ga4CartRate, checkoutRate: product.ga4CheckoutRate
    } : null;
    let funnelSnippet = '';
    if (f) {
      funnelSnippet = '\nWEBSITE FUNNEL (GA4, last 7 days):\n'
        + '- Sessions: ' + f.sessions + '\n'
        + '- Add-to-carts: ' + f.cartAdditions + (f.cartRate != null ? ' (' + f.cartRate + '% of sessions)' : '') + '\n'
        + '- Checkouts started: ' + f.checkouts + (f.checkoutRate != null ? ' (' + f.checkoutRate + '% of cart-adds)' : '') + '\n'
        + '- Purchases: ' + f.purchases + '\n'
        + '- Bounce rate: ' + (f.bounceRate != null ? (f.bounceRate * 100).toFixed(0) + '%' : '—') + '\n'
        + '- Engagement rate: ' + (f.engagementRate != null ? (f.engagementRate * 100).toFixed(0) + '%' : '—') + '\n'
        + '- Avg session duration: ' + (f.avgEngagementTime != null ? f.avgEngagementTime.toFixed(0) + 's' : '—');
    }

    // PageSpeed snippet — fetched on demand only when asked for deep analysis
    let speedSnippet = '';
    if (includePageContent && productUrl) {
      const ps = await getPageSpeedScore(productUrl);
      if (ps && !ps.error) {
        speedSnippet = '\nPAGE SPEED (PageSpeed Insights, mobile):\n'
          + '- Lighthouse score: ' + (ps.mobileScore != null ? ps.mobileScore + '/100' : '—') + (ps.mobileScore != null && ps.mobileScore < 50 ? ' (POOR)' : ps.mobileScore < 80 ? ' (NEEDS WORK)' : ' (good)') + '\n'
          + '- Largest Contentful Paint: ' + (ps.lcpMs != null ? (ps.lcpMs / 1000).toFixed(1) + 's' : '—') + (ps.lcpMs > 4000 ? ' (POOR — should be < 2.5s)' : '') + '\n'
          + '- Speed Index: ' + (ps.loadTimeMs != null ? (ps.loadTimeMs / 1000).toFixed(1) + 's' : '—') + '\n'
          + '- Total Blocking Time: ' + (ps.tbtMs != null ? ps.tbtMs.toFixed(0) + 'ms' : '—');
      }
    }

    // Build daily Shopify sales line for this product so AI can see the trend rather than just totals
    const dailySales7d = product.dailySales7d || [];
    const dailyLine = dailySales7d.length
      ? dailySales7d.map(function(v, i){
          const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
          const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
          return day + ' £' + Math.round(v || 0);
        }).join(', ')
      : '(no daily breakdown available)';

    // Derived signals — let AI see the relationship rather than infer it
    const adSpendVsShopifySales = (gSpend > 0 && rev7d != null) ? (rev7d / gSpend).toFixed(1) : null;
    const sellingWithoutAds = (rev7d != null && rev7d > 50 && gSpend < 5);
    const spendingWithoutSales = (gSpend > 5 && rev7d != null && rev7d < 20);

    const signalsLine = [
      sellingWithoutAds ? 'SIGNAL: This product is selling on Shopify (' + fmt(rev7d) + ') with little/no Google ad spend (' + fmt(gSpend) + '). It either does not need ads, or there is an opportunity to scale through ads.' : '',
      spendingWithoutSales ? 'SIGNAL: Google ad spend (' + fmt(gSpend) + ') is high vs Shopify sales (' + fmt(rev7d) + ') in the same window. Either ads are not converting (creative/landing/competitive issue) or attribution is delayed.' : '',
      adSpendVsShopifySales ? 'Shopify-sales-to-ad-spend ratio: ' + adSpendVsShopifySales + 'x' : ''
    ].filter(function(x){ return x; }).join('\n');

    function fmt(n){ return n == null ? '—' : '£' + Math.round(n * 100) / 100; }

    const prompt = `You are advising FK Sports UK on a single product.

CONTEXT YOU NEED TO KNOW:
- FK Sports UK is a Shopify store (fksports.co.uk) selling home fitness equipment AND baby products. ~150+ orders/day.
- One Google Ads account covers everything today (fitness + baby will split into separate accounts later).
- Shopify is the source of truth for actual sales. Google "Revenue" lags 24-48 hours and may show £0 even when Google has driven real sales.
- Known data caveat: GA4 begin_checkout/purchase events are not always attributing back to product names cleanly. If the funnel section below shows "0 checkouts" for a product that clearly has Shopify orders, treat the funnel as untrustworthy on those two metrics — but cart_additions on the funnel is reliable.

PRODUCT: ${name}${product.campaignName ? '\nCAMPAIGN: ' + product.campaignName : ''}${product.campaignType ? ' (' + product.campaignType + ')' : ''}

SHOPIFY (TRUTH):
${(price != null) ? `- Price: ${fmt(price)}` : ''}
${(inventory != null) ? `- Inventory: ${inventory === 0 ? 'OUT OF STOCK' : inventory + ' units'}` : ''}
${status ? '- Status: ' + status.toUpperCase() : ''}
${rev7d != null ? `- Net sales last 7 COMPLETE days (excludes today): ${fmt(rev7d)} / ${units7d || 0} units` : ''}
${(product.revenueToday != null || product.shopifyRevenueToday != null) ? `- Net sales TODAY so far (incomplete): ${fmt(product.revenueToday != null ? product.revenueToday : product.shopifyRevenueToday)}` : ''}
${rev30d != null ? `- Net sales last 30 days: ${fmt(rev30d)} / ${units30d || 0} units` : ''}
- Daily net sales (last 7 complete days, oldest → newest): ${dailyLine}

GOOGLE ADS (LAST 7 DAYS):
- Impressions: ${gImp}
- Clicks: ${gClk} (CTR ${gCtr}%)
- Conversions recorded: ${gConv}
- Ad spend: ${fmt(gSpend)}
- Google-attributed revenue (lagged 24-48h): ${fmt(gSales)}
- ACOS: ${gAcos}% (only meaningful when Google revenue > 0; reads N/A or 0 otherwise)
- Cost/conv (cost per conversion): ${gConv > 0 ? '£' + (gSpend / gConv).toFixed(2) : 'N/A (no conversions)'} — useful when ACOS is N/A; tells you what one conversion costs regardless of revenue lag

${signalsLine ? 'DERIVED SIGNALS:\n' + signalsLine + '\n' : ''}
${funnelSnippet ? funnelSnippet + '\n' : ''}${speedSnippet}${pageSnippet}

THE QUESTION:
Why isn't this product selling better, and what should the team do?

WRITE IN PLAIN ENGLISH. The agent reading this is NOT a marketing expert.
- No jargon. Avoid: CRO, CTA, funnel, conversion rate optimisation, value proposition, USP, social proof, attribution.
- If you must use a technical term, explain it in brackets the first time. Example: "CTR (the % of people who click the ad)".
- Talk about "shoppers" or "people", not "users" or "sessions".
- Use £ for money.
- Every recommendation should be something a normal person could do this week.

Specifically address:
1. What's actually going wrong, in plain words. Look at Shopify trends vs Google Ads numbers — don't blame Google for a Shopify problem or vice versa.
2. The single biggest thing the team should do this week.
3. What might happen if they do it (be realistic, not promotional).
${includePageContent && productUrl ? '4. What you can see about the product page (image quality, title clarity, description, etc.) in everyday language.' : ''}

Be direct. Be specific. Quote the real numbers above. If the data is unclear, say so. No generic advice.`;

    // Sonnet for routine analysis (faster, cheaper); Opus for deep dives where
    // we've also fetched the page + PageSpeed (the harder reasoning task)
    const model = includePageContent ? 'claude-opus-4-5-20251101' : 'claude-sonnet-4-5-20250929';

    // For deep dive: also fetch the hero image and let Claude actually see it.
    const imageUrl = product.imageUrl || product.shopifyImageUrl;
    let messageContent = [{ type: 'text', text: prompt }];
    let visionUsed = false;
    if (includePageContent && imageUrl) {
      try {
        // Resize hint: ask Shopify CDN for a reasonable size to keep payload small.
        // Shopify image URLs accept _<size> in the filename (e.g. image_512x.jpg)
        const sizedUrl = imageUrl.replace(/(\.[a-z]+)(\?.*)?$/i, '_512x$1$2');
        const imgRes = await axios.get(sizedUrl, {
          responseType: 'arraybuffer',
          timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0 CampaignPulse' }
        });
        const contentType = imgRes.headers['content-type'] || 'image/jpeg';
        // Only proceed if it's a real image
        if (contentType.startsWith('image/')) {
          const base64 = Buffer.from(imgRes.data).toString('base64');
          // Cap at ~1MB to be safe
          if (base64.length < 1500000) {
            messageContent = [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: contentType.split(';')[0],
                  data: base64
                }
              },
              { type: 'text', text: prompt + '\n\nThe attached image is the product\'s main photo as it appears on the Shopify page and in Google ads. In plain English, comment on the image quality: is it bright and clear, is the product easy to see, does it look professional, are there any obvious issues that might put off shoppers? Avoid jargon.' }
            ];
            visionUsed = true;
          }
        }
      } catch(e) {
        console.log('Image fetch for vision skipped: ' + e.message);
      }
    }

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: model,
      max_tokens: 700,
      messages: [{ role: 'user', content: messageContent }]
    }, {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    });

    res.json({
      analysis: response.data.content[0].text,
      modelUsed: model,
      visionUsed: visionUsed,
      pageFetched: !!pageSnippet && !pageSnippet.includes('could not fetch')
    });
  } catch(e) {
    console.error('Google AI analyse error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Campaign-level AI analysis — looks at the whole campaign (all products + campaign metrics)
// and gives campaign-focused advice (which products are dragging it down, are bids right,
// is the campaign type appropriate, etc.)
app.post('/api/google/ai-analyse-campaign', async function(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'No API key' });
  const { campaignId } = req.body;
  const requestedRefresh = !!req.body.forceRefresh;
  if (!campaignId) return res.status(400).json({ error: 'No campaignId' });

  // 24h lock — manager-only override
  const u = req.user || {};
  const isManager = ['manager','admin'].includes(u.role) || ['Bobby','Satyam','bobby','satyam'].includes(u.name || u.username || '');

  // Cache lookup (24h)
  if (db) {
    try {
      const cacheRes = await db.query("SELECT * FROM campaign_ai_cache WHERE campaign_id=$1", [String(campaignId)]);
      if (cacheRes.rows.length) {
        const ageHours = (Date.now() - new Date(cacheRes.rows[0].generated_at).getTime()) / 36e5;
        if (ageHours < 24) {
          // Inside lock window
          if (!requestedRefresh || !isManager) {
            return res.json({
              analysis: cacheRes.rows[0].analysis,
              campaignName: cacheRes.rows[0].campaign_name,
              modelUsed: cacheRes.rows[0].model_used,
              cached: true,
              ageHours: Math.round(ageHours * 10) / 10,
              lockedForAgent: !isManager,
              lockMessage: !isManager ? 'Already analysed in the last 24h. Manager can re-analyse.' : null
            });
          }
          // Manager forced refresh — fall through to fresh run
        }
      }
    } catch(e) { /* fall through to fresh */ }
  }

  try {
    // Find all products in this campaign from current Google state
    const allProducts = (googleState.products || []).filter(function(gp){
      return String(gp.campaignId) === String(campaignId);
    });
    if (!allProducts.length) return res.status(404).json({ error: 'No data for this campaign' });

    const campaignName = allProducts[0].campaignName || 'Unknown campaign';
    const campaignType = allProducts[0].campaignType || 'Unknown type';
    const totalSpend = allProducts.reduce(function(s, p){ return s + (p.spend || 0); }, 0);
    const totalSales = allProducts.reduce(function(s, p){ return s + (p.sales || 0); }, 0);
    const totalImpressions = allProducts.reduce(function(s, p){ return s + (p.impressions || 0); }, 0);
    const totalClicks = allProducts.reduce(function(s, p){ return s + (p.clicks || 0); }, 0);
    const totalConv = allProducts.reduce(function(s, p){ return s + (p.conversions || 0); }, 0);
    const overallCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(2) : '0';
    const overallAcos = totalSales > 0 ? (totalSpend / totalSales * 100).toFixed(1) : 'N/A';
    const overallCostPerConv = totalConv > 0 ? (totalSpend / totalConv).toFixed(2) : 'N/A';

    // Sort products by spend descending so AI sees biggest spenders first
    const sorted = allProducts.slice().sort(function(a, b){ return (b.spend || 0) - (a.spend || 0); });
    const top = sorted.slice(0, 15); // limit to 15 to keep prompt manageable

    // Per-product Shopify net sales (7d) lookup so AI can compare each product's ad performance vs its Shopify performance
    const shopifyByPid = {};
    (shopifyState.products || []).forEach(function(sp){ shopifyByPid[String(sp.id)] = sp; });
    function getShopifyNet7d(googleRow) {
      if (!googleRow.shopifyItemId) return null;
      const parts = String(googleRow.shopifyItemId).split('_');
      if (parts.length < 4) return null;
      const sp = shopifyByPid[parts[2]];
      return sp ? (sp.revenue7d || 0) : null;
    }

    const productLines = top.map(function(p, i){
      const name = p.name || p.productName || p.adGroupName || '(unknown)';
      const spend = (p.spend || 0).toFixed(2);
      const sales = (p.sales || 0).toFixed(2);
      const acos = (p.acos != null && p.acos > 0) ? p.acos.toFixed(1) + '%' : 'N/A';
      const costPerConv = (p.conversions > 0) ? '£' + (p.spend / p.conversions).toFixed(2) : 'N/A';
      const shopifyNet = getShopifyNet7d(p);
      const shopifyPart = shopifyNet != null ? ', Shopify net 7d £' + shopifyNet.toFixed(0) : '';
      return (i+1) + '. ' + name.slice(0, 60)
        + ' — Spend £' + spend + ', Google rev (lagged) £' + sales
        + shopifyPart
        + ', ' + (p.conversions || 0) + ' conv'
        + ', Cost/conv ' + costPerConv
        + ', ACOS ' + acos
        + ' (' + (p.impressions || 0) + ' impr, ' + (p.clicks || 0) + ' clk)';
    }).join('\n');

    const remaining = sorted.length - top.length;
    const remainingNote = remaining > 0
      ? '\n... and ' + remaining + ' more product rows in this campaign.'
      : '';

    const prompt = 'You are advising FK Sports UK on one Google Ads campaign.\n\n'
      + 'CONTEXT YOU NEED TO KNOW:\n'
      + '- FK Sports UK is a Shopify store (fksports.co.uk) selling home fitness equipment AND baby products. ~150+ orders/day.\n'
      + '- One Google Ads account covers everything today (fitness + baby split into separate accounts is planned).\n'
      + '- Shopify is the source of truth for actual sales. Google "Revenue" lags 24-48 hours — when Google shows conversions but £0 revenue, that is normally attribution lag, not broken tracking.\n'
      + '- ACOS = ad spend / Google-attributed revenue. Reads N/A when Google revenue is £0.\n'
      + '- For each product below we show both the Google revenue (lagged) AND its Shopify net sales for the same 7-day window. Use Shopify net as the truth for whether the product is selling.\n\n'
      + 'CAMPAIGN: ' + campaignName + '\n'
      + 'TYPE: ' + campaignType + '\n'
      + 'PERIOD: Last 7 days\n\n'
      + 'CAMPAIGN TOTALS:\n'
      + '- Spend: £' + totalSpend.toFixed(2) + '\n'
      + '- Google-attributed sales (lagged): £' + totalSales.toFixed(2) + '\n'
      + '- Impressions: ' + totalImpressions + '\n'
      + '- Clicks: ' + totalClicks + ' (CTR ' + overallCtr + '%)\n'
      + '- Conversions: ' + totalConv + '\n'
      + '- ACOS: ' + overallAcos + '\n'
      + '- Cost per conversion: £' + overallCostPerConv + ' (use this when ACOS is N/A — tells you what one sale costs regardless of revenue lag)\n'
      + '- Product rows in campaign: ' + allProducts.length + '\n\n'
      + 'TOP PRODUCTS BY SPEND (with Shopify-side truth):\n' + productLines + remainingNote + '\n\n'
      + 'THE QUESTION:\n'
      + 'What is going right and wrong in this campaign, and what is the one structural change to make this week?\n\n'
      + 'Specifically:\n'
      + '1. Health verdict in one line.\n'
      + '2. Which products are dragging this down — name 1-3 with their numbers (compare ad spend to Shopify net sales — if a product has high ad spend but low Shopify net sales it is genuinely failing; if it has low Shopify net AND low ad spend, it is just inactive).\n'
      + '3. Which products are working and could absorb more budget — name 1-3.\n'
      + '4. ONE specific structural change for this week (e.g. exclude product type X, split product Y into its own campaign, lower bid on Z by 30%, etc.).\n'
      + '5. If the campaign mixes fitness and baby products, flag it — they convert differently and benefit from separate campaigns.\n'
      + '6. If this is Performance Max or Shopping, comment on whether the right products are in scope.\n\n'
      + 'Be direct, specific, named. Reference actual numbers. No generic advice.';

    // Use Opus for campaign-level reasoning — it's the harder task
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-opus-4-5-20251101',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    });

    const analysisText = response.data.content[0].text;

    // Persist to 24h cache
    if (db) {
      try {
        await db.query(
          "INSERT INTO campaign_ai_cache (campaign_id, campaign_name, generated_at, analysis, model_used) " +
          "VALUES ($1, $2, NOW(), $3, $4) " +
          "ON CONFLICT (campaign_id) DO UPDATE SET campaign_name=EXCLUDED.campaign_name, generated_at=NOW(), analysis=EXCLUDED.analysis, model_used=EXCLUDED.model_used",
          [String(campaignId), campaignName, analysisText, 'claude-opus-4-5-20251101']
        );
      } catch(e) { console.error('Campaign AI cache persist error: ' + e.message); }
    }

    res.json({
      analysis: analysisText,
      campaignName: campaignName,
      campaignType: campaignType,
      productCount: allProducts.length,
      modelUsed: 'claude-opus-4-5-20251101',
      cached: false,
      lockedForAgent: !isManager
    });
  } catch(e) {
    console.error('Campaign AI analyse error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Diagnostic endpoints (temporary — for Round N+5 fixes) ────────────────
// These help us see real data structures without guessing. Remove after use.

// Sample one refunded order — return its full structure so we can see the actual
// fields Shopify returns for refunds (we may be reading the wrong field).
app.get('/api/google/debug/refund-sample', async function(req, res) {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const store = process.env.SHOPIFY_STORE;
  if (!token || !store) return res.status(500).json({ error: 'No Shopify credentials' });
  try {
    // Search recent orders for one with refunds
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const orderRes = await axios.get('https://' + store + '/admin/api/2021-07/orders.json?limit=250&status=any&financial_status=refunded,partially_refunded&created_at_min=' + since, {
      headers: { 'X-Shopify-Access-Token': token }
    });
    const orders = orderRes.data.orders || [];
    const refundedOrder = orders.find(function(o){ return (o.refunds || []).length > 0; });
    if (!refundedOrder) return res.json({ message: 'No refunded orders found in last 30 days' });

    // Return just the relevant fields plus the raw refunds array so we can see structure
    res.json({
      orderName: refundedOrder.name,
      orderId: refundedOrder.id,
      createdAt: refundedOrder.created_at,
      financialStatus: refundedOrder.financial_status,
      currentTotalPrice: refundedOrder.current_total_price,
      currentSubtotalPrice: refundedOrder.current_subtotal_price,
      totalPrice: refundedOrder.total_price,
      subtotalPrice: refundedOrder.subtotal_price,
      totalDiscounts: refundedOrder.total_discounts,
      totalRefunded: refundedOrder.total_refunded || refundedOrder.refund_amount || null,
      totalShippingPriceSet: refundedOrder.total_shipping_price_set,
      lineItems: (refundedOrder.line_items || []).map(function(li){
        return {
          productId: li.product_id,
          title: li.title,
          quantity: li.quantity,
          price: li.price,
          discountAllocations: li.discount_allocations
        };
      }),
      refundsRaw: refundedOrder.refunds, // FULL refund objects so we can see all fields
      refundsSummary: (refundedOrder.refunds || []).map(function(ref){
        return {
          createdAt: ref.created_at,
          processedAt: ref.processed_at,
          note: ref.note,
          orderAdjustments: ref.order_adjustments,
          transactions: (ref.transactions || []).map(function(t){
            return { kind: t.kind, status: t.status, amount: t.amount };
          }),
          refundLineItems: (ref.refund_line_items || []).map(function(rli){
            return {
              quantity: rli.quantity,
              subtotal: rli.subtotal,
              subtotalSet: rli.subtotal_set,
              totalTax: rli.total_tax,
              productId: rli.line_item ? rli.line_item.product_id : null,
              lineItemPrice: rli.line_item ? rli.line_item.price : null
            };
          })
        };
      })
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Comprehensive refund audit — fetches all refunds issued in the last N days and
// dumps every field we might possibly need to read. This is the source-of-truth
// view: if Shopify Analytics shows £6.46 in Returns for Sunday and we don't,
// the answer is in here somewhere. Defaults to last 14 days.
app.get('/api/google/debug/refund-audit', async function(req, res) {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const store = process.env.SHOPIFY_STORE;
  if (!token || !store) return res.status(500).json({ error: 'No Shopify credentials' });

  const days = parseInt(req.query.days || '14', 10);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Use updated_at_min to catch refunds on old orders
    const orderRes = await axios.get('https://' + store + '/admin/api/2021-07/orders.json?limit=250&status=any&updated_at_min=' + since, {
      headers: { 'X-Shopify-Access-Token': token }
    });
    const orders = orderRes.data.orders || [];

    // Walk every refund and capture EVERY possible source of refund value
    const refundsFlat = [];
    let totalLineItemSubtotals = 0;
    let totalAdjustmentRefundDiscrepancies = 0;
    let totalAdjustmentShippingRefunds = 0;
    let totalAdjustmentOther = 0;
    let totalTransactionRefunds = 0;
    const adjustmentKindsSeen = {};

    orders.forEach(function(order) {
      if (!(order.refunds || []).length) return;

      (order.refunds || []).forEach(function(ref) {
        // Sum all four possible refund-value sources for cross-check
        const lineSubtotalSum = (ref.refund_line_items || []).reduce(function(s, rli){
          return s + parseFloat(rli.subtotal || 0);
        }, 0);

        // order_adjustments by kind — refund_discrepancy, shipping_refund, other
        const adjBuckets = { refund_discrepancy: 0, shipping_refund: 0, other: 0 };
        (ref.order_adjustments || []).forEach(function(adj){
          const kind = adj.kind || 'unknown';
          adjustmentKindsSeen[kind] = (adjustmentKindsSeen[kind] || 0) + 1;
          const amt = parseFloat(adj.amount || 0);
          if (kind === 'refund_discrepancy') adjBuckets.refund_discrepancy += amt;
          else if (kind === 'shipping_refund') adjBuckets.shipping_refund += amt;
          else adjBuckets.other += amt;
        });

        // transactions of kind=refund (the actual money that left)
        const txnRefundSum = (ref.transactions || []).filter(function(t){
          return t.kind === 'refund' && t.status === 'success';
        }).reduce(function(s, t){
          return s + parseFloat(t.amount || 0);
        }, 0);

        totalLineItemSubtotals += lineSubtotalSum;
        totalAdjustmentRefundDiscrepancies += adjBuckets.refund_discrepancy;
        totalAdjustmentShippingRefunds += adjBuckets.shipping_refund;
        totalAdjustmentOther += adjBuckets.other;
        totalTransactionRefunds += txnRefundSum;

        refundsFlat.push({
          orderName: order.name,
          orderId: order.id,
          orderCreatedAt: order.created_at,
          orderCancelledAt: order.cancelled_at,
          orderFinancialStatus: order.financial_status,
          refundCreatedAt: ref.created_at,
          refundDateLondon: londonDateKey(new Date(ref.created_at)),
          refundNote: ref.note,
          // What we currently read (refund_line_items[].subtotal)
          mySubtotalSum: Math.round(lineSubtotalSum * 100) / 100,
          // Shipping refunds we currently miss
          adjShippingRefundSum: Math.round(adjBuckets.shipping_refund * 100) / 100,
          // Other adjustments
          adjOtherSum: Math.round(adjBuckets.other * 100) / 100,
          // Refund discrepancy (these cancel out so usually zero)
          adjRefundDiscrepancySum: Math.round(adjBuckets.refund_discrepancy * 100) / 100,
          // The actual money refunded via payment processor — true source of truth
          txnRefundSum: Math.round(txnRefundSum * 100) / 100,
          // Item count
          refundedLineCount: (ref.refund_line_items || []).length,
          adjustmentCount: (ref.order_adjustments || []).length
        });
      });
    });

    // Sort by refund date descending so most recent is first
    refundsFlat.sort(function(a, b){ return new Date(b.refundCreatedAt) - new Date(a.refundCreatedAt); });

    // Group by London date to compare against Shopify Analytics' "Returns" line
    const byDate = {};
    refundsFlat.forEach(function(r){
      if (!byDate[r.refundDateLondon]) {
        byDate[r.refundDateLondon] = { mySubtotalSum: 0, txnRefundSum: 0, adjShippingRefundSum: 0, adjOtherSum: 0, count: 0 };
      }
      byDate[r.refundDateLondon].mySubtotalSum += r.mySubtotalSum;
      byDate[r.refundDateLondon].txnRefundSum += r.txnRefundSum;
      byDate[r.refundDateLondon].adjShippingRefundSum += r.adjShippingRefundSum;
      byDate[r.refundDateLondon].adjOtherSum += r.adjOtherSum;
      byDate[r.refundDateLondon].count += 1;
    });
    Object.keys(byDate).forEach(function(k){
      byDate[k].mySubtotalSum = Math.round(byDate[k].mySubtotalSum * 100) / 100;
      byDate[k].txnRefundSum = Math.round(byDate[k].txnRefundSum * 100) / 100;
      byDate[k].adjShippingRefundSum = Math.round(byDate[k].adjShippingRefundSum * 100) / 100;
      byDate[k].adjOtherSum = Math.round(byDate[k].adjOtherSum * 100) / 100;
    });

    res.json({
      windowDays: days,
      ordersScanned: orders.length,
      refundsFound: refundsFlat.length,
      // Totals across the whole window
      totals: {
        myCurrentCalcSum: Math.round(totalLineItemSubtotals * 100) / 100,
        // The truth: sum of refund transactions
        actualRefundedToCustomerSum: Math.round(totalTransactionRefunds * 100) / 100,
        // Things I currently miss
        missedShippingRefunds: Math.round(totalAdjustmentShippingRefunds * 100) / 100,
        missedOtherAdjustments: Math.round(totalAdjustmentOther * 100) / 100,
        // Things to ignore (these net to zero typically)
        refundDiscrepancyAdjustments: Math.round(totalAdjustmentRefundDiscrepancies * 100) / 100,
      },
      gapAnalysis: {
        myCalcVsTransactionTruth: Math.round((totalLineItemSubtotals - totalTransactionRefunds) * 100) / 100,
        explanation: 'If this is a positive number, my calc is OVER-counting (e.g. counting refunds before they were actually processed). If negative, I am UNDER-counting (e.g. missing shipping refunds). The closer to zero the better.'
      },
      adjustmentKindsSeen: adjustmentKindsSeen,
      byDate: byDate,
      // Show top 20 individual refunds
      sampleRefunds: refundsFlat.slice(0, 20)
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Sample of GA4 itemNames vs Shopify titles so we can see why matching fails
app.get('/api/google/debug/ga4-sample', async function(req, res) {
  if (!ga4State.refreshToken) return res.status(500).json({ error: 'GA4 not connected' });
  if (!process.env.GA4_OAUTH_CLIENT_ID || !process.env.GA4_OAUTH_CLIENT_SECRET) return res.status(500).json({ error: 'No OAuth creds' });
  try {
    // Refresh the token to make a live call
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: process.env.GA4_OAUTH_CLIENT_ID,
      client_secret: process.env.GA4_OAUTH_CLIENT_SECRET,
      refresh_token: ga4State.refreshToken,
      grant_type: 'refresh_token'
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const accessToken = tokenRes.data.access_token;
    const url = 'https://analyticsdata.googleapis.com/v1beta/properties/' + process.env.GA4_PROPERTY_ID + ':runReport';

    // Fetch raw itemName + eventName + count for begin_checkout, purchase, add_to_cart
    const r = await axios.post(url, {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
      dimensions: [{ name: 'itemName' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: ['begin_checkout', 'purchase', 'add_to_cart'] } }
      },
      limit: 200
    }, { headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });

    const itemRows = (r.data.rows || []).map(function(row){
      return {
        itemName: row.dimensionValues[0].value,
        event: row.dimensionValues[1].value,
        count: parseInt(row.metricValues[0].value) || 0
      };
    });

    // Build the same titleToPath map we use during sync
    const titleToPath = {};
    (shopifyState.products || []).forEach(function(p){
      if (p.title && p.handle) titleToPath[p.title.toLowerCase().trim()] = '/products/' + p.handle;
    });

    // Compare
    const matched = [];
    const unmatched = [];
    const seenItems = {};
    itemRows.forEach(function(r){
      const key = r.itemName.toLowerCase().trim();
      if (seenItems[key]) return;
      seenItems[key] = true;
      if (titleToPath[key]) matched.push({ itemName: r.itemName, path: titleToPath[key] });
      else unmatched.push({ itemName: r.itemName });
    });

    // For the unmatched, find the closest Shopify title (substring match) to help diagnose
    const closestMatches = unmatched.slice(0, 30).map(function(u){
      const lo = u.itemName.toLowerCase();
      const closest = (shopifyState.products || []).find(function(p){
        const t = (p.title || '').toLowerCase();
        return lo.indexOf(t.slice(0, 20)) >= 0 || t.indexOf(lo.slice(0, 20)) >= 0;
      });
      return {
        ga4ItemName: u.itemName,
        closestShopifyTitle: closest ? closest.title : '(no obvious match)'
      };
    });

    res.json({
      totalGa4Rows: itemRows.length,
      uniqueItemNamesInGa4: Object.keys(seenItems).length,
      shopifyProductCount: (shopifyState.products || []).length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      sampleMatched: matched.slice(0, 10),
      sampleUnmatched: closestMatches,
      eventCounts: itemRows.reduce(function(acc, r){
        acc[r.event] = (acc[r.event] || 0) + r.count;
        return acc;
      }, {}),
      shopifySampleTitles: (shopifyState.products || []).slice(0, 10).map(function(p){ return p.title; })
    });
  } catch(e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});
