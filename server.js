// CampaignPulse — deploy marker 2026-05-07 r25c (TACOS in product modal, badge logic fix for zero-sale wasters + chronic underperformers, manual refresh-sales-now button, orders cron uses LastUpdatedAfter for incremental sync)
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── r7b: timeline + ACOS configuration ────────────────────────────────────
// Account-wide ACOS target. Used to colour-code Discuss/Decide callouts.
// 20% = green, 20-40% = amber, > 40% = red, 0 revenue = red "no conversions".
const TARGET_ACOS_PCT = 20;

// Working-day helpers. "Working day" = any day except Sunday.
// Saturday counts as a normal working day per Bobby's spec.
// All comparisons happen in Europe/London local time so an agent in the UK
// sees the same Day-N count as the cron that runs at 00:01 London.
function toLondonDate(d) {
  // Normalise to a YYYY-MM-DD string in London tz then back to a Date
  // so we can do day-arithmetic without DST surprises.
  const s = new Date(d).toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  // s is dd/mm/yyyy — flip to yyyy-mm-dd
  const parts = s.split('/');
  return new Date(parts[2] + '-' + parts[1] + '-' + parts[0] + 'T00:00:00');
}
function isSunday(d) { return toLondonDate(d).getDay() === 0; }
function workingDaysBetween(fromDate, toDate) {
  // Inclusive count of working days from `fromDate` up to (and NOT including) `toDate`.
  // workingDaysBetween(creationDay, today) gives 0 on the creation day, 1 the next working day, etc.
  let from = toLondonDate(fromDate);
  const to = toLondonDate(toDate);
  if (from >= to) return 0;
  let count = 0;
  const cur = new Date(from);
  while (cur < to) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0) count++; // skip Sundays
  }
  return count;
}
// Map working-days-open → task stage. 0-3 working days = open, 4-6 = discuss, 7 = decide, 8+ = overdue.
function stageForWorkingDay(n) {
  if (n >= 8) return 'overdue';
  if (n >= 7) return 'decide';
  if (n >= 4) return 'discuss';
  return 'open';
}
// What's the next milestone and how many working days until it?
function milestoneInfo(workingDaysOpen) {
  if (workingDaysOpen >= 8) return { next: null, daysUntil: 0, label: 'Overdue' };
  if (workingDaysOpen === 7) return { next: 'overdue', daysUntil: 0, label: 'Decide today' };
  if (workingDaysOpen >= 4) return { next: 'decide', daysUntil: 7 - workingDaysOpen, label: (7 - workingDaysOpen) + ' working day' + ((7 - workingDaysOpen) === 1 ? '' : 's') + ' until Decide' };
  if (workingDaysOpen === 3) return { next: 'discuss', daysUntil: 1, label: '1 working day until Discuss' };
  return { next: 'discuss', daysUntil: 4 - workingDaysOpen, label: (4 - workingDaysOpen) + ' working days until Discuss' };
}


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
    // Manager AND Owner (role='manager'/'owner' OR department='manager') bypass all checks.
    const userDept = (req.user.department || '').toLowerCase();
    const userRole = (req.user.role || '').toLowerCase();
    const isManager = userRole === 'manager' || userRole === 'owner' || userDept === 'manager';
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

// ════════════════════════════════════════════════════════════════════════════
// SP-API (Selling Partner API) — r8
// ════════════════════════════════════════════════════════════════════════════
// This is a SEPARATE Amazon API from the Advertising API above. SP-API gives
// us access to the seller's catalogue, listings, inventory, orders, and pricing.
// Auth uses LWA (Login With Amazon) — same OAuth flow as the Ads API but with
// its own refresh token (different scopes granted at consent time).
//
// Env vars (must be configured in Railway):
//   SP_API_CLIENT_ID        — LWA app Client ID
//   SP_API_CLIENT_SECRET    — LWA app Client Secret
//   SP_API_REFRESH_TOKEN    — long-lived refresh token from OAuth consent
//   SP_API_SELLER_ID        — optional; if missing we fetch via /sellers/v1/marketplaceParticipations
//
// Endpoints — UK marketplace (A1F83G8C2ARO7P) on EU host.

const SP_API_HOST = 'https://sellingpartnerapi-eu.amazon.com';
const SP_API_MARKETPLACE_ID = 'A1F83G8C2ARO7P'; // UK
const spApiState = {
  accessToken: null,
  tokenExpiry: 0,
  sellerId: process.env.SP_API_SELLER_ID || null
};

function spApiConfigured() {
  return !!(process.env.SP_API_CLIENT_ID && process.env.SP_API_CLIENT_SECRET && process.env.SP_API_REFRESH_TOKEN);
}

async function getSpApiAccessToken() {
  if (!spApiConfigured()) throw new Error('SP-API credentials not configured (need SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, SP_API_REFRESH_TOKEN)');
  // Cache token for 55 mins (LWA tokens last 60 mins, refresh 5 mins early)
  if (spApiState.accessToken && Date.now() < spApiState.tokenExpiry - 60000) {
    return spApiState.accessToken;
  }
  console.log('[SP-API] Refreshing access token...');
  try {
    const res = await axios.post('https://api.amazon.com/auth/o2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: process.env.SP_API_REFRESH_TOKEN.trim(),
        client_id: process.env.SP_API_CLIENT_ID.trim(),
        client_secret: process.env.SP_API_CLIENT_SECRET.trim()
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    spApiState.accessToken = res.data.access_token;
    spApiState.tokenExpiry = Date.now() + (res.data.expires_in * 1000);
    console.log('[SP-API] Token refreshed OK (expires in ' + res.data.expires_in + 's)');
    return spApiState.accessToken;
  } catch(e) {
    const msg = (e.response && e.response.data) ? JSON.stringify(e.response.data) : e.message;
    console.error('[SP-API] Token refresh FAILED: ' + msg);
    throw new Error('SP-API token refresh failed: ' + msg);
  }
}

// Generic SP-API GET wrapper — handles auth + base URL + retry on 429
async function spApiGet(pathAndQuery, retryCount) {
  retryCount = retryCount || 0;
  const token = await getSpApiAccessToken();
  try {
    const res = await axios.get(SP_API_HOST + pathAndQuery, {
      headers: {
        'x-amz-access-token': token,
        'Accept': 'application/json',
        'User-Agent': 'CampaignPulse/1.0 (Language=Node.js)'
      },
      timeout: 30000
    });
    return res.data;
  } catch(e) {
    // SP-API rate limits — back off and retry up to 3 times
    if (e.response && e.response.status === 429 && retryCount < 3) {
      const wait = Math.pow(2, retryCount) * 1000;
      console.log('[SP-API] Rate limited on ' + pathAndQuery + ', waiting ' + wait + 'ms');
      await new Promise(function(r){ setTimeout(r, wait); });
      return spApiGet(pathAndQuery, retryCount + 1);
    }
    const status = e.response ? e.response.status : 'no-response';
    const body = e.response && e.response.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
    console.error('[SP-API] GET ' + pathAndQuery + ' failed (' + status + '): ' + body);
    throw e;
  }
}

// Get the seller ID — needed for some endpoints. Fetches once and caches.
// Tries multiple known shapes of the response, since the field names have
// changed across SP-API versions.
async function getSellerId() {
  if (spApiState.sellerId) return spApiState.sellerId;
  try {
    const data = await spApiGet('/sellers/v1/marketplaceParticipations');
    // Newer responses: data.payload is an array of participation objects
    // Older responses: same shape, but field names differ slightly
    const participations = (data && data.payload) || [];
    if (!participations.length) {
      throw new Error('No marketplace participations returned (raw shape: ' + JSON.stringify(data || {}).slice(0, 200) + ')');
    }
    // Try to find UK first, fall back to first entry
    let chosen = participations.find(function(p) {
      const mp = p.marketplace || {};
      return mp.id === SP_API_MARKETPLACE_ID || mp.countryCode === 'GB' || mp.countryCode === 'UK';
    }) || participations[0];
    // The seller ID can live in different places depending on response version
    const candidates = [
      chosen && chosen.participation && chosen.participation.sellerId,
      chosen && chosen.sellerId,
      chosen && chosen.merchantId,
      data && data.sellerId
    ].filter(Boolean);
    if (!candidates.length) {
      throw new Error('Seller ID not found in any expected field. First participation keys: ' + Object.keys(chosen || {}).join(','));
    }
    spApiState.sellerId = candidates[0];
    console.log('[SP-API] Seller ID fetched: ' + spApiState.sellerId);
    return spApiState.sellerId;
  } catch(e) {
    console.error('[SP-API] getSellerId failed: ' + e.message);
    throw e;
  }
}

// r20: SP-API POST helper. Used for Reports API (createReport, etc.) and other
// write-style endpoints. Same auth + rate-limit-retry pattern as spApiGet.
async function spApiPost(pathAndQuery, body, retryCount) {
  retryCount = retryCount || 0;
  const token = await getSpApiAccessToken();
  try {
    const res = await axios.post(SP_API_HOST + pathAndQuery, body || {}, {
      headers: {
        'x-amz-access-token': token,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'CampaignPulse/1.0 (Language=Node.js)'
      },
      timeout: 30000
    });
    return res.data;
  } catch(e) {
    if (e.response && e.response.status === 429 && retryCount < 3) {
      const wait = Math.pow(2, retryCount) * 1000;
      console.log('[SP-API] POST rate limited on ' + pathAndQuery + ', waiting ' + wait + 'ms');
      await new Promise(function(r){ setTimeout(r, wait); });
      return spApiPost(pathAndQuery, body, retryCount + 1);
    }
    const status = e.response ? e.response.status : 'no-response';
    const errBody = e.response && e.response.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
    console.error('[SP-API] POST ' + pathAndQuery + ' failed (' + status + '): ' + errBody);
    throw e;
  }
}

// ── Sync the seller's product catalogue from SP-API into amazon_products ─────
// Uses /listings/2021-08-01/items/{sellerId} to enumerate every SKU.
// Now (r9) also fetches `relationships` so we can populate parent_sku/variation_theme
// for child variants. Probe established that summaries+relationships is supported.
async function syncAmazonCatalogue() {
  if (!db) { console.log('[SP-API catalogue sync] No DB — skipping'); return { ok: false, error: 'no-db' }; }
  if (!spApiConfigured()) { console.log('[SP-API catalogue sync] Not configured — skipping'); return { ok: false, error: 'not-configured' }; }
  const startedAt = Date.now();
  let total = 0, upserted = 0, errors = 0, withParent = 0;
  try {
    const sellerId = await getSellerId();
    let pageToken = null;
    let pageNum = 0;
    do {
      pageNum++;
      const params = new URLSearchParams({
        marketplaceIds: SP_API_MARKETPLACE_ID,
        includedData: 'summaries,relationships',
        pageSize: '20'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await spApiGet('/listings/2021-08-01/items/' + encodeURIComponent(sellerId) + '?' + params.toString());
      const items = (data && data.items) || [];
      total += items.length;
      for (const item of items) {
        try {
          const sku = item.sku;
          const summary = (item.summaries && item.summaries[0]) || {};
          const asin = summary.asin || null;
          const title = summary.itemName || null;
          let status = null;
          if (summary.status) {
            status = Array.isArray(summary.status) ? summary.status.join(',') : String(summary.status);
          }
          const imageUrl = (summary.mainImage && summary.mainImage.link) || null;
          // Extract parent SKU + variation theme from relationships array.
          // Shape (from probe): item.relationships[0].relationships[0].parentSkus[0]
          // and ...variationTheme.theme.
          // If empty array → standalone product (no parent).
          let parentSku = null;
          let variationTheme = null;
          try {
            const relGroup = (item.relationships && item.relationships[0]) || null;
            const relInner = (relGroup && relGroup.relationships && relGroup.relationships[0]) || null;
            if (relInner) {
              if (relInner.parentSkus && relInner.parentSkus.length) parentSku = relInner.parentSkus[0];
              if (relInner.variationTheme && relInner.variationTheme.theme) variationTheme = relInner.variationTheme.theme;
            }
          } catch(e) { /* malformed relationships — leave null */ }
          if (parentSku) withParent++;
          await db.query(
            'INSERT INTO amazon_products (sku, asin, title, status, image_url, parent_sku, variation_theme, last_synced_at, raw_summary) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8) ' +
            'ON CONFLICT (sku) DO UPDATE SET asin=$2, title=$3, status=$4, image_url=$5, parent_sku=$6, variation_theme=$7, last_synced_at=NOW(), raw_summary=$8',
            [sku, asin, title, status, imageUrl, parentSku, variationTheme, JSON.stringify(summary)]
          );
          upserted++;
        } catch(e) { errors++; console.error('[SP-API catalogue sync] Row error sku=' + (item.sku || '?') + ': ' + e.message); }
      }
      pageToken = (data && data.pagination && data.pagination.nextToken) || null;
      if (pageNum >= 100) { console.log('[SP-API catalogue sync] Hit page cap (100), stopping pagination'); break; }
    } while (pageToken);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log('[SP-API catalogue sync] Done in ' + seconds + 's: ' + total + ' items pulled, ' + upserted + ' upserted, ' + withParent + ' had parent_sku, ' + errors + ' errors');
    try {
      await db.query("UPDATE amazon_products SET status='REMOVED' WHERE last_synced_at < NOW() - INTERVAL '2 hours'");
    } catch(e) { console.error('[SP-API catalogue sync] Marking removed failed: ' + e.message); }
    // r11: re-derive owner_agent for newly synced products (manual overrides preserved)
    try {
      const dr = await deriveProductOwners();
      if (dr.ok) console.log('[SP-API catalogue sync] Owner derive: ' + dr.rows_updated + ' rows across ' + dr.parents_scanned + ' parents');
    } catch(e) { console.error('[SP-API catalogue sync] Owner derive failed: ' + e.message); }
    return { ok: true, total: total, upserted: upserted, withParent: withParent, errors: errors, seconds: parseFloat(seconds) };
  } catch(e) {
    console.error('[SP-API catalogue sync] FAILED: ' + e.message);
    return { ok: false, error: e.message, total: total, upserted: upserted, errors: errors };
  }
}

// ── Sync recent orders from SP-API into amazon_orders ───────────────────────
// Uses /orders/v0/orders. Pulls orders updated in the last N days (default 7).
// We pull both orders and their line items so we can attribute revenue per SKU.
async function syncAmazonOrders(daysBack, opts) {
  if (!db) return { ok: false, error: 'no-db' };
  if (!spApiConfigured()) return { ok: false, error: 'not-configured' };
  // r17: default 9 days (was 7) so the boundary day at the start of the window
  // is fully captured. London-aligned sales display needs a full 24h per day.
  daysBack = daysBack || 9;
  opts = opts || {};
  // r25c: optional LastUpdatedAfter mode. When provided (ISO timestamp), uses
  // SP-API's LastUpdatedAfter param so we only refetch orders that have been
  // CREATED OR UPDATED since that point. Reduces typical cron load by ~85%.
  // Caller is responsible for tracking the high-water-mark timestamp; we update
  // app_settings.last_orders_sync_at on success so the next call can pick it up.
  const lastUpdatedAfter = opts.lastUpdatedAfter || null;
  const startedAt = Date.now();
  let total = 0, upserted = 0, errors = 0, itemsUpserted = 0, itemsSkipped = 0;
  try {
    // SP-API requires CreatedAfter / LastUpdatedAfter in ISO 8601 — and at least 2 minutes in the past
    const after = new Date(Date.now() - daysBack * 86400000).toISOString();
    let nextToken = null;
    let pageNum = 0;
    do {
      pageNum++;
      const params = new URLSearchParams({
        MarketplaceIds: SP_API_MARKETPLACE_ID,
        MaxResultsPerPage: '50'
      });
      if (lastUpdatedAfter) {
        // Incremental mode — only orders changed since the last successful run
        params.set('LastUpdatedAfter', lastUpdatedAfter);
      } else {
        // Full mode (manual button or first-ever run) — last N days
        params.set('CreatedAfter', after);
      }
      if (nextToken) params.set('NextToken', nextToken);
      const data = await spApiGet('/orders/v0/orders?' + params.toString());
      const orders = (data && data.payload && data.payload.Orders) || [];
      total += orders.length;
      for (const o of orders) {
        try {
          const orderId = o.AmazonOrderId;
          const purchaseDate = o.PurchaseDate || null;
          const orderStatus = o.OrderStatus || null;
          const orderTotal = o.OrderTotal && o.OrderTotal.Amount ? parseFloat(o.OrderTotal.Amount) : 0;
          const currency = o.OrderTotal && o.OrderTotal.CurrencyCode ? o.OrderTotal.CurrencyCode : 'GBP';
          const numItems = parseInt(o.NumberOfItemsShipped || 0) + parseInt(o.NumberOfItemsUnshipped || 0);

          // r25c: skip-line-items optimisation. If the order is already in our DB
          // AND its LastUpdateDate hasn't changed AND we already have items for it,
          // we don't need to refetch line items — they don't change after pickup.
          let needItemsFetch = true;
          if (!opts.forceItemsRefetch) {
            try {
              const existing = await db.query(
                "SELECT 1 FROM amazon_order_items WHERE order_id = $1 LIMIT 1",
                [orderId]
              );
              const oLastUpdate = o.LastUpdateDate ? new Date(o.LastUpdateDate).getTime() : 0;
              if (existing.rows.length > 0) {
                // We already have items. Only refetch if order shows recent updates
                // (status change, refund, etc.) — otherwise skip the API call.
                const lastLoadedRes = await db.query(
                  "SELECT EXTRACT(EPOCH FROM last_synced_at) * 1000 AS ts FROM amazon_orders WHERE order_id = $1",
                  [orderId]
                );
                const lastLoadedMs = lastLoadedRes.rows.length ? parseFloat(lastLoadedRes.rows[0].ts) : 0;
                if (oLastUpdate > 0 && lastLoadedMs > 0 && oLastUpdate <= lastLoadedMs) {
                  needItemsFetch = false;
                }
              }
            } catch(e) { /* fall through — fetch items anyway */ }
          }

          await db.query(
            'INSERT INTO amazon_orders (order_id, purchase_date, status, order_total, currency, num_items, last_synced_at, raw_order) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7) ' +
            'ON CONFLICT (order_id) DO UPDATE SET status=$3, order_total=$4, currency=$5, num_items=$6, last_synced_at=NOW(), raw_order=$7',
            [orderId, purchaseDate, orderStatus, orderTotal, currency, numItems, JSON.stringify(o)]
          );
          upserted++;

          if (!needItemsFetch) { itemsSkipped++; continue; }

          // Pull line items — separate API call per order
          try {
            const itemsData = await spApiGet('/orders/v0/orders/' + encodeURIComponent(orderId) + '/orderItems');
            const items = (itemsData && itemsData.payload && itemsData.payload.OrderItems) || [];
            for (const it of items) {
              try {
                const itemPrice = it.ItemPrice && it.ItemPrice.Amount ? parseFloat(it.ItemPrice.Amount) : 0;
                const qty = parseInt(it.QuantityOrdered || 0);
                await db.query(
                  'INSERT INTO amazon_order_items (order_id, asin, sku, title, quantity, item_price, currency) ' +
                  'VALUES ($1,$2,$3,$4,$5,$6,$7) ' +
                  'ON CONFLICT (order_id, sku) DO UPDATE SET quantity=$5, item_price=$6, title=$4',
                  [orderId, it.ASIN || null, it.SellerSKU || '', it.Title || null, qty, itemPrice, (it.ItemPrice && it.ItemPrice.CurrencyCode) || 'GBP']
                );
                itemsUpserted++;
              } catch(e) { errors++; console.error('[SP-API orders sync] Item error: ' + e.message); }
            }
          } catch(e) { errors++; console.error('[SP-API orders sync] Items fetch error for order ' + orderId + ': ' + e.message); }
        } catch(e) { errors++; console.error('[SP-API orders sync] Order error: ' + e.message); }
      }
      nextToken = (data && data.payload && data.payload.NextToken) || null;
      if (pageNum >= 100) { console.log('[SP-API orders sync] Hit page cap (100), stopping'); break; }
    } while (nextToken);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log('[SP-API orders sync] Done in ' + seconds + 's: ' + total + ' orders, ' + upserted + ' upserted, ' + itemsUpserted + ' items fetched, ' + itemsSkipped + ' items skipped (already current), ' + errors + ' errors' + (lastUpdatedAfter ? ' [incremental from ' + lastUpdatedAfter + ']' : ' [full ' + daysBack + 'd]'));

    // r25c: persist high-water-mark for the next incremental run.
    // Backed off 60s from now to be safe against clock skew / very recent updates.
    // Stored inside the existing app_settings.settings JSONB blob (id=1).
    try {
      const hwm = new Date(Date.now() - 60000).toISOString();
      await db.query(
        "UPDATE app_settings SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{last_orders_sync_at}', to_jsonb($1::text)), updated_at = NOW() WHERE id = 1",
        [hwm]
      );
    } catch(e) { /* non-fatal */ }

    return { ok: true, total: total, upserted: upserted, itemsUpserted: itemsUpserted, itemsSkipped: itemsSkipped, errors: errors, seconds: parseFloat(seconds), mode: lastUpdatedAfter ? 'incremental' : 'full' };
  } catch(e) {
    console.error('[SP-API orders sync] FAILED: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// r20: SP-API signal refresher — populates amazon_pricing_signals for active ASINs.
// One row per ASIN. Refreshed by cron at 03:30 London (after catalogue 02:30,
// before orders 06:00). Stale > 36h shows "—" on UI.
//
// Signals fetched per ASIN:
//   1. Reviews count + avg ........... /catalog/2022-04-01/items/{ASIN}?includedData=summaries
//   2. Inventory (fulfillable qty) .... /fba/inventory/v1/summaries
//   3. Last content update ............ /listings/2021-08-01/items/{sellerId}/{sku}?includedData=summaries
//   4. Price vs lowest competitor ..... /products/pricing/v0/items/{ASIN}/offers?ItemCondition=New
//   5. Velocity 30d (computed from amazon_orders) → stock_cover_days = fulfillable_qty / velocity
// Buy Box win % is NOT here — it comes from amazon_traffic_snapshots (path b).
// ════════════════════════════════════════════════════════════════════════════
async function refreshAmazonPricingSignals(opts) {
  opts = opts || {};
  const limit = opts.limit || 9999;  // cap for ad-hoc runs; cron passes no limit
  const onlyAsin = opts.onlyAsin || null;
  // r21: includeAll=true forces refresh of ALL BUYABLE ASINs incl. dormant.
  // Default (false) restricts to ASINs sold in the last 60 days — same window
  // as the "active products" filter on the dashboard. Cuts cron from ~247 ASINs
  // down to ~71, saving ~10 min and ~70% of SP-API quota.
  const includeAll = opts.includeAll === true;
  if (!db) return { ok: false, error: 'no-db' };
  if (!spApiConfigured()) return { ok: false, error: 'not-configured' };

  // 1. Pick the ASINs to refresh — every BUYABLE ASIN, OR the explicit one if onlyAsin is set
  let asinRows;
  try {
    if (onlyAsin) {
      asinRows = (await db.query(
        "SELECT DISTINCT asin, sku FROM amazon_products WHERE asin = $1 LIMIT 1",
        [onlyAsin]
      )).rows;
    } else if (includeAll) {
      // Cron path with explicit include-all override (rare, e.g. one-shot recovery)
      asinRows = (await db.query(
        "SELECT DISTINCT ON (asin) asin, sku FROM amazon_products " +
        "WHERE asin IS NOT NULL AND status LIKE '%BUYABLE%' " +
        "ORDER BY asin LIMIT $1",
        [limit]
      )).rows;
    } else {
      // r21 default: only BUYABLE ASINs that sold something in the last 60 days.
      // Dormant ASINs keep their last-known signals (which the UI already treats
      // as stale > 36h and shows as "—"). Big quota saving.
      asinRows = (await db.query(
        "SELECT DISTINCT ON (p.asin) p.asin, p.sku FROM amazon_products p " +
        "WHERE p.asin IS NOT NULL AND p.status LIKE '%BUYABLE%' " +
        "AND EXISTS (" +
        "  SELECT 1 FROM amazon_order_items i " +
        "  JOIN amazon_orders o ON o.order_id = i.order_id " +
        "  WHERE i.asin = p.asin " +
        "  AND o.purchase_date >= NOW() - INTERVAL '60 days' " +
        "  AND o.status NOT IN ('Cancelled','Canceled')" +
        ") " +
        "ORDER BY p.asin LIMIT $1",
        [limit]
      )).rows;
    }
  } catch(e) {
    console.error('[r20 signals] ASIN picker failed: ' + e.message);
    return { ok: false, error: e.message };
  }

  console.log('[r20 signals] refreshing ' + asinRows.length + ' ASINs' + (onlyAsin ? ' (single)' : (includeAll ? ' (include-all)' : ' (active 60d only — r21 optimization)')));
  const startedAt = Date.now();
  let okCount = 0, errCount = 0;

  // 2. Pre-compute 30-day velocity for ALL these ASINs in one query (faster than per-ASIN)
  let velocityMap = {};
  try {
    const velRes = await db.query(
      "SELECT i.asin, SUM(i.quantity)::float / 30.0 AS velocity " +
      "FROM amazon_order_items i JOIN amazon_orders o ON o.order_id = i.order_id " +
      "WHERE o.purchase_date >= NOW() - INTERVAL '30 days' " +
      "AND o.status NOT IN ('Cancelled','Canceled') " +
      "AND i.asin = ANY($1) " +
      "GROUP BY i.asin",
      [asinRows.map(function(r){ return r.asin; })]
    );
    velRes.rows.forEach(function(r){ velocityMap[r.asin] = parseFloat(r.velocity || 0); });
  } catch(e) {
    console.error('[r20 signals] velocity query failed: ' + e.message);
  }

  // 3. Walk each ASIN and fetch its signals. Each individual fetch is wrapped so
  // one failure doesn't abort the run — partial data is better than no data.
  let sellerId;
  try { sellerId = await getSellerId(); } catch(e) { console.error('[r20 signals] sellerId fetch failed: ' + e.message); return { ok: false, error: 'no-seller-id' }; }

  for (const row of asinRows) {
    const asin = row.asin;
    const sku = row.sku;
    const sig = {
      asin: asin,
      your_price: null,
      lowest_competitor_price: null,
      price_vs_lowest: null,
      reviews_count: null,
      reviews_avg: null,
      last_content_update: null,
      fulfillable_qty: null,
      velocity_30d: velocityMap[asin] != null ? velocityMap[asin] : 0,
      stock_cover_days: null,
      fulfillment_mode: null,
      last_error: null
    };
    const errors = [];

    // 3a. Catalog item — reviews + browse signals
    try {
      const cat = await spApiGet(
        '/catalog/2022-04-01/items/' + encodeURIComponent(asin) +
        '?marketplaceIds=' + SP_API_MARKETPLACE_ID +
        '&includedData=summaries'
      );
      const summary = (cat && cat.summaries && cat.summaries[0]) || {};
      // SP-API may surface reviews under different keys. Try a few.
      // Note: SP-API does NOT consistently expose review count/rating — many ASINs return nothing
      // here. We accept patchy data per spec.
      const rc = summary.totalRatings || summary.numberOfReviews || (summary.itemRatingsAndReviews && summary.itemRatingsAndReviews.totalRatings);
      const ra = summary.averageRating || (summary.itemRatingsAndReviews && summary.itemRatingsAndReviews.averageRating);
      if (rc != null) sig.reviews_count = parseInt(rc) || null;
      if (ra != null) sig.reviews_avg = parseFloat(ra) || null;
    } catch(e) {
      errors.push('catalog: ' + (e.response && e.response.status || e.message));
    }

    // 3b + 3c (r20d): Walk EVERY SKU for this ASIN and pull both
    //   - last content update (from listings summaries)
    //   - FBM warehouse stock (from listings.fulfillmentAvailability where
    //     fulfillmentChannelCode='DEFAULT' — i.e. merchant-fulfilled)
    // Then add FBA fulfillable on top via the inventory call.
    //
    // Why this matters: many of FK Sports' ASINs have BOTH an FBA SKU (often
    // CLOSED with 0 units) and an FBM SKU (Active with 500 in the warehouse).
    // Pre-r20d the code only saw the FBA side and reported "0 stock cover" for
    // products that actually had plenty of warehouse inventory.
    //
    // Convention agreed with Bobby:
    //   - Any SKU containing "FBA" (case-insensitive) is FBA-fulfilled
    //   - Anything else is MFN/FBM
    //   - fulfillment_mode is 'fba' / 'fbm' / 'mixed' / null based on what's present
    let allSkus = [];
    try {
      const skuRows = await db.query(
        "SELECT sku, status FROM amazon_products WHERE asin=$1",
        [asin]
      );
      allSkus = skuRows.rows;
    } catch(e) {
      // Fall back to just the picked SKU
      if (sku) allSkus = [{ sku: sku, status: '' }];
    }

    let fbmQty = 0;        // sum of FBM/warehouse fulfillable across all SKUs
    let hasFbaSku = false; // any SKU named like FBA
    let hasFbmSku = false; // any SKU NOT named like FBA
    for (const r of allSkus) {
      const sk = r.sku;
      if (!sk) continue;
      const isFbaSku = /fba/i.test(sk);
      if (isFbaSku) hasFbaSku = true; else hasFbmSku = true;

      try {
        // includedData=summaries,offers — `offers` carries fulfillmentAvailability
        // for SP-API listings v2021-08-01. summaries gives lastUpdatedDate.
        const list = await spApiGet(
          '/listings/2021-08-01/items/' + encodeURIComponent(sellerId) + '/' + encodeURIComponent(sk) +
          '?marketplaceIds=' + SP_API_MARKETPLACE_ID +
          '&includedData=summaries,offers'
        );
        // Last content update — keep the MOST RECENT lastUpdatedDate across SKUs
        // (using the freshest one — at least one SKU was updated then)
        const summary = (list && list.summaries && list.summaries[0]) || {};
        if (summary.lastUpdatedDate) {
          const d = String(summary.lastUpdatedDate).slice(0, 10);
          if (!sig.last_content_update || d > sig.last_content_update) {
            sig.last_content_update = d;
          }
        }
        // FBM stock — fulfillmentAvailability lives on offers OR at the top of
        // the response depending on the API version. Try both.
        const fa = (list && list.fulfillmentAvailability)
                   || (list && list.offers && list.offers[0] && list.offers[0].fulfillmentAvailability)
                   || [];
        if (Array.isArray(fa)) {
          fa.forEach(function(entry) {
            const channel = String(entry.fulfillmentChannelCode || entry.fulfillment_channel_code || '').toUpperCase();
            const qty = entry.quantity != null ? parseInt(entry.quantity) : null;
            if (qty == null || !isFinite(qty)) return;
            // DEFAULT = merchant-fulfilled (FBM/warehouse)
            // AMAZON_NA / AMAZON_EU / AMAZON_* = FBA — already counted via inventory call
            if (channel === 'DEFAULT' || channel === '' || channel === 'MERCHANT') {
              fbmQty += qty;
            }
          });
        }
      } catch(e) {
        errors.push('listings(' + sk + '): ' + (e.response && e.response.status || e.message));
      }
    }

    // 3c. Inventory (FBA fulfillable qty) — same call as before but now ADDED
    // to the FBM total rather than replacing it.
    let fbaQty = 0;
    let fbaCallSucceeded = false;
    try {
      const inv = await spApiGet(
        '/fba/inventory/v1/summaries' +
        '?details=true' +
        '&granularityType=Marketplace' +
        '&granularityId=' + SP_API_MARKETPLACE_ID +
        '&marketplaceIds=' + SP_API_MARKETPLACE_ID
      );
      const summaries = (inv && inv.payload && inv.payload.inventorySummaries) || [];
      const matches = summaries.filter(function(s){ return s.asin === asin; });
      fbaCallSucceeded = true;
      matches.forEach(function(m) {
        const detail = m.inventoryDetails || {};
        const candidates = [
          detail.fulfillableQuantity,
          detail.FulfillableQuantity,
          m.totalQuantity
        ];
        for (let i = 0; i < candidates.length; i++) {
          const v = candidates[i];
          if (v != null) {
            const n = parseInt(v);
            if (isFinite(n)) { fbaQty += n; break; }
          }
        }
      });
    } catch(e) {
      errors.push('inventory: ' + (e.response && e.response.status || e.message));
    }

    // Combine — total stock available across all channels.
    sig.fulfillable_qty = fbaQty + fbmQty;
    if (hasFbaSku && hasFbmSku) sig.fulfillment_mode = 'mixed';
    else if (hasFbmSku) sig.fulfillment_mode = 'fbm';
    else if (hasFbaSku) sig.fulfillment_mode = 'fba';
    else sig.fulfillment_mode = null;

    // 3d. Price vs lowest competitor — Product Pricing v0 offers
    // r20 fix: SP-API returns prices in MULTIPLE shapes depending on the marketplace
    // and seller history. Tolerate every shape we've seen rather than the one we
    // hoped for. Source-of-truth fields can live in:
    //   - Summary.LowestPrices[].LandedPrice.Amount   (most common)
    //   - Summary.LowestPrices[].ListingPrice.Amount  (when shipping is excluded)
    //   - Summary.BuyBoxPrices[].LandedPrice.Amount   (Buy Box winner only)
    //   - Offers[].ListingPrice.Amount                (raw offers — pick min after excluding ours)
    // Condition field is also inconsistent: 'New' / 'new' / 'NEW'. Treat case-insensitively.
    try {
      const pr = await spApiGet(
        '/products/pricing/v0/items/' + encodeURIComponent(asin) + '/offers' +
        '?MarketplaceId=' + SP_API_MARKETPLACE_ID +
        '&ItemCondition=New&CustomerType=Consumer'
      );
      const summary = (pr && pr.payload && pr.payload.Summary) || {};
      const offers = (pr && pr.payload && pr.payload.Offers) || [];

      // Helper — pull a numeric Amount from a price-object shape, trying common keys.
      function priceAmount(obj) {
        if (!obj) return null;
        // Try LandedPrice → ListingPrice → Price (sometimes flat) → top-level Amount
        const candidates = [
          obj.LandedPrice && obj.LandedPrice.Amount,
          obj.ListingPrice && obj.ListingPrice.Amount,
          obj.Price && obj.Price.Amount,
          obj.Amount
        ];
        for (let i = 0; i < candidates.length; i++) {
          const v = candidates[i];
          if (v != null && isFinite(parseFloat(v))) return parseFloat(v);
        }
        return null;
      }
      function isNew(condStr) {
        return String(condStr || '').toLowerCase() === 'new';
      }

      // Your price — try the offer matching our seller, then fall back to Buy Box if it's ours
      const myOffer = offers.find(function(o){ return o.SellerId === sellerId; });
      if (myOffer) {
        const p = priceAmount(myOffer);
        if (p != null) sig.your_price = p;
      }
      // Fallback: BuyBoxPrices in Summary contains seller-winning prices
      if (sig.your_price == null) {
        const bb = (summary.BuyBoxPrices || []).filter(function(b){ return isNew(b.condition || b.Condition); });
        for (const b of bb) {
          // Some payloads include sellerId on Buy Box entry
          if (b.sellerId === sellerId || b.SellerId === sellerId) {
            const p = priceAmount(b);
            if (p != null) { sig.your_price = p; break; }
          }
        }
      }

      // Lowest competitor — try every documented place, take the minimum.
      let candidatePrices = [];
      // 1. Summary.LowestPrices (any "new" entry)
      (summary.LowestPrices || []).forEach(function(lp) {
        if (!isNew(lp.condition || lp.Condition)) return;
        const p = priceAmount(lp);
        if (p != null) candidatePrices.push(p);
      });
      // 2. Summary.BuyBoxPrices (any "new" entry — even if not ours)
      (summary.BuyBoxPrices || []).forEach(function(bp) {
        if (!isNew(bp.condition || bp.Condition)) return;
        const p = priceAmount(bp);
        if (p != null) candidatePrices.push(p);
      });
      // 3. Raw Offers — exclude our own seller, take new condition only
      offers.forEach(function(o) {
        if (o.SellerId === sellerId) return;
        const cond = o.SubCondition || o.condition || (o.ItemCondition && o.ItemCondition);
        // SP-API offers from /items/{asin}/offers with ItemCondition=New filter often
        // omit the condition field entirely (already filtered). Don't reject on missing condition.
        if (cond && !isNew(cond)) return;
        const p = priceAmount(o);
        if (p != null) candidatePrices.push(p);
      });
      // De-dupe and pick the minimum, EXCLUDING our own price (it can leak in via Summary).
      // r20b fix: if after excluding our price the pool is empty, that means we have
      // no genuine competitor offers — return null, do NOT fall back to the pool that
      // contains our own price (which would falsely report price_vs_lowest = 0).
      if (candidatePrices.length) {
        if (sig.your_price != null) {
          const filtered = candidatePrices.filter(function(p){ return Math.abs(p - sig.your_price) > 0.01; });
          if (filtered.length) {
            sig.lowest_competitor_price = parseFloat(Math.min.apply(null, filtered).toFixed(2));
          }
          // else: leave null — no real competitors, we are the only "new" offer
        } else {
          // We don't know our own price (rare) — take the minimum of whatever's there
          sig.lowest_competitor_price = parseFloat(Math.min.apply(null, candidatePrices).toFixed(2));
        }
      }
      if (sig.your_price != null && sig.lowest_competitor_price != null) {
        sig.price_vs_lowest = parseFloat((sig.your_price - sig.lowest_competitor_price).toFixed(2));
      }
    } catch(e) {
      errors.push('pricing: ' + (e.response && e.response.status || e.message));
    }

    // 4. Compute stock cover days from fulfillable + velocity
    if (sig.fulfillable_qty != null && sig.velocity_30d > 0) {
      sig.stock_cover_days = parseFloat((sig.fulfillable_qty / sig.velocity_30d).toFixed(1));
    } else if (sig.fulfillable_qty != null && sig.fulfillable_qty > 0 && sig.velocity_30d === 0) {
      // In stock but no recent sales — show large number (effectively "infinite cover")
      sig.stock_cover_days = 999;
    }

    if (errors.length) sig.last_error = errors.join(' | ');

    // 5. Upsert into cache table
    try {
      await db.query(
        "INSERT INTO amazon_pricing_signals " +
        "(asin, your_price, lowest_competitor_price, price_vs_lowest, reviews_count, reviews_avg, " +
        " last_content_update, fulfillable_qty, velocity_30d, stock_cover_days, fulfillment_mode, last_error, fetched_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) " +
        "ON CONFLICT (asin) DO UPDATE SET " +
        "your_price=EXCLUDED.your_price, lowest_competitor_price=EXCLUDED.lowest_competitor_price, " +
        "price_vs_lowest=EXCLUDED.price_vs_lowest, reviews_count=EXCLUDED.reviews_count, " +
        "reviews_avg=EXCLUDED.reviews_avg, last_content_update=EXCLUDED.last_content_update, " +
        "fulfillable_qty=EXCLUDED.fulfillable_qty, velocity_30d=EXCLUDED.velocity_30d, " +
        "stock_cover_days=EXCLUDED.stock_cover_days, fulfillment_mode=EXCLUDED.fulfillment_mode, " +
        "last_error=EXCLUDED.last_error, fetched_at=NOW()",
        [asin, sig.your_price, sig.lowest_competitor_price, sig.price_vs_lowest, sig.reviews_count,
         sig.reviews_avg, sig.last_content_update, sig.fulfillable_qty, sig.velocity_30d,
         sig.stock_cover_days, sig.fulfillment_mode, sig.last_error]
      );
      okCount++;
    } catch(e) {
      console.error('[r20 signals] upsert failed for ' + asin + ': ' + e.message);
      errCount++;
    }

    // Tiny pause between ASINs — SP-API rate limits on the tightest endpoints (Pricing) are
    // 0.5 req/sec burst 1. With 4 endpoints per ASIN, ~600ms between ASINs is conservative.
    await new Promise(function(r){ setTimeout(r, 600); });
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('[r20 signals] done in ' + elapsed + 's — ok=' + okCount + ' err=' + errCount);
  return { ok: true, refreshed: okCount, errors: errCount, elapsedSec: elapsed };
}

// ════════════════════════════════════════════════════════════════════════════
// r20: Sales-and-Traffic Report ingest (Buy Box win % path b).
// Calls Reports API — async flow: createReport → poll → download document.
// One row per (asin, report_date) in amazon_traffic_snapshots.
// Card metric is AVG(buy_box_pct) over last 7 days where data exists.
// Backfill endpoint: POST /api/admin/backfill-traffic?days=N (cap 30).
// ════════════════════════════════════════════════════════════════════════════
async function fetchSalesAndTrafficReport(reportDate) {
  // reportDate is a YYYY-MM-DD string for a SINGLE day. Amazon report data
  // typically lags 24h, so the cron at 04:00 London asks for "yesterday".
  if (!db || !spApiConfigured()) return { ok: false, error: 'not-configured' };
  const dateStr = String(reportDate).slice(0, 10);

  try {
    // Step 1 — request the report. Use childAsin granularity so we get per-ASIN rows.
    const createRes = await spApiPost('/reports/2021-06-30/reports', {
      reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
      marketplaceIds: [SP_API_MARKETPLACE_ID],
      dataStartTime: dateStr + 'T00:00:00Z',
      dataEndTime: dateStr + 'T23:59:59Z',
      reportOptions: {
        dateGranularity: 'DAY',
        asinGranularity: 'CHILD'
      }
    });
    const reportId = createRes && createRes.reportId;
    if (!reportId) throw new Error('no reportId returned');
    console.log('[r20 traffic] requested report for ' + dateStr + ' — id=' + reportId);

    // Step 2 — poll until DONE (or fail after ~3 min)
    let docId = null;
    const pollStart = Date.now();
    const maxWait = 180000; // 3 minutes
    while (Date.now() - pollStart < maxWait) {
      await new Promise(function(r){ setTimeout(r, 8000); });
      const status = await spApiGet('/reports/2021-06-30/reports/' + encodeURIComponent(reportId));
      const procStatus = status && status.processingStatus;
      if (procStatus === 'DONE') {
        docId = status.reportDocumentId;
        break;
      } else if (procStatus === 'CANCELLED' || procStatus === 'FATAL') {
        throw new Error('report status ' + procStatus);
      }
    }
    if (!docId) throw new Error('report polling timed out');

    // Step 3 — fetch the document URL, then download + parse
    const docMeta = await spApiGet('/reports/2021-06-30/documents/' + encodeURIComponent(docId));
    const docUrl = docMeta && docMeta.url;
    if (!docUrl) throw new Error('no document url');
    const docRes = await axios.get(docUrl, { timeout: 60000, responseType: 'text' });
    let payload;
    try { payload = JSON.parse(docRes.data); }
    catch(e) { throw new Error('failed to parse report JSON: ' + e.message); }

    // Step 4 — extract per-ASIN rows. Shape:
    // payload.salesAndTrafficByAsin = [{ parentAsin, childAsin, sku, sales: {...}, traffic: {...} }]
    const rows = (payload && payload.salesAndTrafficByAsin) || [];
    let inserted = 0;
    for (const r of rows) {
      const asin = r.childAsin || r.parentAsin;
      if (!asin) continue;
      const traffic = r.traffic || {};
      const sales = r.sales || {};
      const buyBoxPct = traffic.buyBoxPercentage != null ? parseFloat(traffic.buyBoxPercentage) : null;
      const sessions = traffic.sessions != null ? parseInt(traffic.sessions) : null;
      const pageViews = traffic.pageViews != null ? parseInt(traffic.pageViews) : null;
      const unitsOrdered = sales.unitsOrdered != null ? parseInt(sales.unitsOrdered) : null;
      const orderedSales = (sales.orderedProductSales && sales.orderedProductSales.amount != null) ?
        parseFloat(sales.orderedProductSales.amount) : null;
      try {
        await db.query(
          "INSERT INTO amazon_traffic_snapshots " +
          "(asin, report_date, buy_box_pct, sessions, page_views, units_ordered, ordered_product_sales, fetched_at) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) " +
          "ON CONFLICT (asin, report_date) DO UPDATE SET " +
          "buy_box_pct=EXCLUDED.buy_box_pct, sessions=EXCLUDED.sessions, " +
          "page_views=EXCLUDED.page_views, units_ordered=EXCLUDED.units_ordered, " +
          "ordered_product_sales=EXCLUDED.ordered_product_sales, fetched_at=NOW()",
          [asin, dateStr, buyBoxPct, sessions, pageViews, unitsOrdered, orderedSales]
        );
        inserted++;
      } catch(e) {
        console.error('[r20 traffic] insert failed for ' + asin + ' ' + dateStr + ': ' + e.message);
      }
    }
    console.log('[r20 traffic] ' + dateStr + ' — ' + inserted + ' rows inserted');
    return { ok: true, date: dateStr, rows: inserted };
  } catch(e) {
    console.error('[r20 traffic] FAILED for ' + dateStr + ': ' + e.message);
    return { ok: false, date: dateStr, error: e.message };
  }
}

// END SP-API module
// ════════════════════════════════════════════════════════════════════════════

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
          "SELECT id FROM campaign_tasks WHERE campaign_id=$1 AND task_source='alert' AND problem_type=$2 AND created_date = ((NOW() AT TIME ZONE 'Europe/London')::DATE)",
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
      // r20: when no portfolio (or portfolio name doesn't yield an agent), fall back to
      // parsing the campaign name for an agent prefix ("Satyam | Vibration Plate Auto" → Satyam).
      // This routes wasted spend on un-portfolioed campaigns into the right agent's row
      // instead of all dumping into "Unassigned".
      let agent = portfolioName ? portfolioName.replace('@', '').split(' ')[0] : '';
      if (!agent) {
        const parsed = parseCampaignName(c.name || '');
        if (parsed && parsed.agent) agent = parsed.agent;
      }
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

      -- ════ SP-API tables (r8) ═══════════════════════════════════════════════
      -- amazon_products: one row per SKU. Refreshed daily by syncAmazonCatalogue().
      CREATE TABLE IF NOT EXISTS amazon_products (
        sku TEXT PRIMARY KEY,
        asin TEXT,
        title TEXT,
        status TEXT,
        image_url TEXT,
        price NUMERIC,
        currency TEXT,
        parent_sku TEXT,
        variation_theme TEXT,
        last_synced_at TIMESTAMP DEFAULT NOW(),
        raw_summary JSONB
      );
      -- Idempotent column adds for existing deployments (r9):
      DO $do$ BEGIN
        BEGIN ALTER TABLE amazon_products ADD COLUMN IF NOT EXISTS parent_sku TEXT; EXCEPTION WHEN OTHERS THEN END;
        BEGIN ALTER TABLE amazon_products ADD COLUMN IF NOT EXISTS variation_theme TEXT; EXCEPTION WHEN OTHERS THEN END;
        -- r11: owner_agent + manual override flag
        BEGIN ALTER TABLE amazon_products ADD COLUMN IF NOT EXISTS owner_agent TEXT; EXCEPTION WHEN OTHERS THEN END;
        BEGIN ALTER TABLE amazon_products ADD COLUMN IF NOT EXISTS owner_manual BOOLEAN DEFAULT FALSE; EXCEPTION WHEN OTHERS THEN END;
      END $do$;
      CREATE INDEX IF NOT EXISTS idx_amazon_products_asin ON amazon_products(asin);
      CREATE INDEX IF NOT EXISTS idx_amazon_products_status ON amazon_products(status);
      CREATE INDEX IF NOT EXISTS idx_amazon_products_parent_sku ON amazon_products(parent_sku);
      CREATE INDEX IF NOT EXISTS idx_amazon_products_owner_agent ON amazon_products(owner_agent);

      -- amazon_orders: one row per order. Refreshed every few hours by syncAmazonOrders().
      CREATE TABLE IF NOT EXISTS amazon_orders (
        order_id TEXT PRIMARY KEY,
        purchase_date TIMESTAMP,
        status TEXT,
        order_total NUMERIC,
        currency TEXT,
        num_items INTEGER,
        last_synced_at TIMESTAMP DEFAULT NOW(),
        raw_order JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_amazon_orders_date ON amazon_orders(purchase_date);

      -- amazon_order_items: per-line revenue, joined to amazon_products by SKU/ASIN.
      CREATE TABLE IF NOT EXISTS amazon_order_items (
        order_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        asin TEXT,
        title TEXT,
        quantity INTEGER,
        item_price NUMERIC,
        currency TEXT,
        PRIMARY KEY (order_id, sku)
      );
      CREATE INDEX IF NOT EXISTS idx_amazon_order_items_sku ON amazon_order_items(sku);
      CREATE INDEX IF NOT EXISTS idx_amazon_order_items_asin ON amazon_order_items(asin);

      -- r13: amazon_critiques — cached AI listing critique results.
      CREATE TABLE IF NOT EXISTS amazon_critiques (
        asin TEXT PRIMARY KEY,
        critique JSONB NOT NULL,
        cached_at TIMESTAMP DEFAULT NOW()
      );

      -- r16: hidden products and campaigns — soft-hide for visual cleanup
      CREATE TABLE IF NOT EXISTS hidden_products (
        parent_sku TEXT PRIMARY KEY,
        hidden_by TEXT,
        hidden_at TIMESTAMP DEFAULT NOW(),
        reason TEXT
      );
      CREATE TABLE IF NOT EXISTS hidden_campaigns (
        campaign_id TEXT PRIMARY KEY,
        campaign_name TEXT,
        hidden_by TEXT,
        hidden_at TIMESTAMP DEFAULT NOW(),
        reason TEXT
      );

      -- r20: amazon_pricing_signals — cached SP-API operational metrics per ASIN.
      -- Refreshed by cron at 03:30 London. Stale > 36h on UI surfaces "—".
      -- price_vs_lowest = your_price - lowest_competitor_price (negative = we are cheaper).
      CREATE TABLE IF NOT EXISTS amazon_pricing_signals (
        asin TEXT PRIMARY KEY,
        your_price NUMERIC(10,2),
        lowest_competitor_price NUMERIC(10,2),
        price_vs_lowest NUMERIC(10,2),
        reviews_count INTEGER,
        reviews_avg NUMERIC(3,2),
        last_content_update DATE,
        fulfillable_qty INTEGER,
        velocity_30d NUMERIC(8,2),
        stock_cover_days NUMERIC(8,1),
        fulfillment_mode TEXT,
        last_error TEXT,
        fetched_at TIMESTAMP DEFAULT NOW()
      );
      -- r20d: Idempotent migration — for environments that already created the
      -- table before fulfillment_mode existed. ADD COLUMN IF NOT EXISTS is
      -- supported in Postgres 9.6+; Railway is 14+.
      ALTER TABLE amazon_pricing_signals ADD COLUMN IF NOT EXISTS fulfillment_mode TEXT;
      CREATE INDEX IF NOT EXISTS idx_amazon_pricing_signals_fetched ON amazon_pricing_signals(fetched_at);

      -- r20: amazon_traffic_snapshots — daily Buy Box %, sessions, page views, units
      -- pulled from GET_SALES_AND_TRAFFIC_REPORT (Detail Page Sales and Traffic by Child Item).
      -- Buy Box win % on the product card is rolling 7-day avg from this table.
      CREATE TABLE IF NOT EXISTS amazon_traffic_snapshots (
        asin TEXT NOT NULL,
        report_date DATE NOT NULL,
        buy_box_pct NUMERIC(5,2),
        sessions INTEGER,
        page_views INTEGER,
        units_ordered INTEGER,
        ordered_product_sales NUMERIC(10,2),
        fetched_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (asin, report_date)
      );
      CREATE INDEX IF NOT EXISTS idx_amazon_traffic_snapshots_date ON amazon_traffic_snapshots(report_date);
      CREATE INDEX IF NOT EXISTS idx_amazon_traffic_snapshots_asin ON amazon_traffic_snapshots(asin);

      -- r22: amazon_asin_ad_performance — per-ASIN per-campaign per-day ad spend
      -- pulled from Sponsored Products advertisedProduct report. Replaces the
      -- gutted campaign-matcher: each product card shows TRUE per-ASIN ad spend
      -- (multiple ASINs in one campaign get their share, multiple campaigns
      -- per ASIN get summed). Daily cron at 04:30 London pulls yesterday.
      CREATE TABLE IF NOT EXISTS amazon_asin_ad_performance (
        asin TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        ad_group_id TEXT NOT NULL DEFAULT '',
        report_date DATE NOT NULL,
        spend NUMERIC(10,2) DEFAULT 0,
        sales NUMERIC(10,2) DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        units INTEGER DEFAULT 0,
        orders INTEGER DEFAULT 0,
        campaign_name TEXT,
        fetched_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (asin, campaign_id, ad_group_id, report_date)
      );
      CREATE INDEX IF NOT EXISTS idx_aap_asin_date ON amazon_asin_ad_performance(asin, report_date);
      CREATE INDEX IF NOT EXISTS idx_aap_campaign_date ON amazon_asin_ad_performance(campaign_id, report_date);
      CREATE INDEX IF NOT EXISTS idx_aap_date ON amazon_asin_ad_performance(report_date);

      -- r23: amazon_campaign_snooze — temporarily hide an underperforming
      -- campaign from the Underperforming page. Auto-expires at snoozed_until.
      -- Replaces r22 amazon_product_snooze (table dropped if empty).
      CREATE TABLE IF NOT EXISTS amazon_campaign_snooze (
        campaign_id TEXT PRIMARY KEY,
        campaign_name TEXT,
        snoozed_until TIMESTAMP NOT NULL,
        snoozed_by TEXT,
        snoozed_at TIMESTAMP DEFAULT NOW(),
        snooze_reason TEXT,
        snooze_action TEXT  -- 'snooze' or 'dismiss' (30d=dismiss-ish but explicit)
      );
      CREATE INDEX IF NOT EXISTS idx_camp_snooze_until ON amazon_campaign_snooze(snoozed_until);

      -- r25b: ai_feedback — agent corrections to AI analyses. The AI reads recent
      -- feedback for a target before generating a new analysis, so subsequent runs
      -- get progressively more accurate.
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id SERIAL PRIMARY KEY,
        scope TEXT NOT NULL,
        target_id TEXT NOT NULL,
        feedback_text TEXT NOT NULL,
        agent_name TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_scope_target ON ai_feedback(scope, target_id, created_at DESC);
    `);

    // r23: drop the old product snooze table (introduced r22, never deployed).
    // Wrapped in try/catch in case it never existed.
    try { await db.query("DROP TABLE IF EXISTS amazon_product_snooze"); } catch(e) {}
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
    // r14 timezone fix: snapshots keyed by London date, not UTC.
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' })).toISOString().split('T')[0];
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

// r21: Agent name canonicalisation. Campaign prefixes and stored agent values
// can drift (full names, lowercase, typos). All extraction goes through
// canonicalAgent() so "Aryan", "aryan", "Aryan Tomar", "ARYAN TOMAR" all map
// to "Aryan". Hardcoded for now — only two active agents. Move to a DB table
// when the team grows or aliases multiply.
const AGENT_ALIASES = {
  // Aryan
  'aryan': 'Aryan',
  'aryan tomar': 'Aryan',
  // Satyam
  'satyam': 'Satyam'
};
function canonicalAgent(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  // Direct match (whole string)
  if (AGENT_ALIASES[lower]) return AGENT_ALIASES[lower];
  // Prefix match — "Aryan-something", "aryan_xyz", "Satyam tasks" etc.
  // Iterate longest alias first so "aryan tomar" wins over "aryan".
  const aliases = Object.keys(AGENT_ALIASES).sort(function(a, b){ return b.length - a.length; });
  for (const alias of aliases) {
    if (lower === alias) return AGENT_ALIASES[alias];
    if (lower.indexOf(alias) === 0) {
      // Make sure the alias is a whole word (followed by space, punctuation, end)
      const next = lower.charAt(alias.length);
      if (!next || /[\s\-_|@.,:;\/]/.test(next)) return AGENT_ALIASES[alias];
    }
  }
  // Unknown — return original trimmed (caller decides how to bucket)
  return trimmed;
}

function extractAgentFromCampaign(campaignName) {
  if (!campaignName) return null;
  const parts = campaignName.split(/[|@]/);
  const name = parts[0].trim();
  if (name.length === 0 || name.length >= 30) return null;
  // r21: canonicalise. If it matches a known alias (incl. multi-word like
  // "Aryan Tomar"), return the canonical form. Otherwise return raw so the
  // unknown-agents UI can still surface it.
  return canonicalAgent(name);
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
        created_date DATE DEFAULT ((NOW() AT TIME ZONE 'Europe/London')::DATE),
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
    // r14: Fix created_date default to use London time (was UTC, causing tasks created late London evening to show as next day)
    try { await db.query(`ALTER TABLE campaign_tasks ALTER COLUMN created_date SET DEFAULT ((NOW() AT TIME ZONE 'Europe/London')::DATE)`); } catch(e) {}
    // r14: One-shot fix for tasks where created_date is in the past but the row was actually created today (London time).
    // Scope: all OPEN/IN-PROGRESS tasks (not resolved) where updated_at falls on a different London-date than created_date by 1 day.
    // This catches the timezone-drift bug for tasks still in due, without touching genuinely-old or already-resolved tasks.
    try {
      const fixRes = await db.query(
        "UPDATE campaign_tasks SET created_date = ((updated_at AT TIME ZONE 'Europe/London')::DATE) " +
        "WHERE status IN ('open','in_progress') " +
        "AND ((updated_at AT TIME ZONE 'Europe/London')::DATE) - created_date = 1 " +
        "AND updated_at >= NOW() - INTERVAL '36 hours' " +
        "RETURNING id"
      );
      if (fixRes.rowCount > 0) console.log('[r14 timezone-fix] Re-dated ' + fixRes.rowCount + ' open/in-progress task(s) to correct London date');
    } catch(e) { console.error('[r14 timezone-fix] ' + e.message); }
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
    // r7b: timeline stage tracking (open / discuss / decide / overdue) and start-warning timestamp.
    // task_stage is auto-advanced by the daily 00:01 cron based on working days since created_date.
    // working_days_open is computed (Sundays excluded) — replaces the old days_persisted as the
    // canonical "how long has this task been open" measure.
    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS task_stage TEXT DEFAULT 'open'");
    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS stage_advanced_at TIMESTAMP");
    await db.query("CREATE INDEX IF NOT EXISTS idx_tasks_stage ON campaign_tasks(task_stage)");
    // actor_name = the LOGGED-IN USER who took the action (vs agent_name which is the task owner).
    // Critical for audit: when Bobby reassigns Rahul's task to Anuj, log shows Bobby did it.
    await db.query("ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS actor_name TEXT");
    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS reassigned_at TIMESTAMP");
    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS reassigned_from TEXT");
    await db.query("ALTER TABLE campaign_tasks ADD COLUMN IF NOT EXISTS notes_ignored BOOLEAN DEFAULT FALSE");

    // r21: subtasks table — populated when a product card is assigned as a task.
    // Each subtask = one bullet point from the AI critique. Agent can complete or
    // dismiss-with-reason but cannot delete. Card cannot move to 'complete' until
    // every subtask is in ('complete','dismissed').
    await db.query(`
      CREATE TABLE IF NOT EXISTS task_subtasks (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES campaign_tasks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        dismiss_reason TEXT,
        completed_at TIMESTAMP,
        completed_by TEXT,
        dismissed_at TIMESTAMP,
        dismissed_by TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_subtasks_task ON task_subtasks(task_id);
      CREATE INDEX IF NOT EXISTS idx_subtasks_status ON task_subtasks(status);
    `);

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
      // Promote Bobby from 'manager' to 'owner' so only he sees the Delete-user button.
      // Idempotent — only updates if currently 'manager', leaves anything else alone.
      try {
        const r = await db.query("UPDATE users SET role='owner' WHERE email='bobby@fksports.co.uk' AND role='manager'");
        if (r.rowCount > 0) console.log("Bobby promoted to role='owner'");
      } catch(e) { console.error('Owner role promotion error: ' + e.message); }

      // r20c → r20d: Kunal cleanup — soft-delete his user account and ARCHIVE
      // his open tasks (Bobby has paused all his campaigns, so reassigning is
      // pointless — they're obsolete). Idempotent — re-runs are safe because
      // the second pass finds zero open Kunal tasks.
      try {
        const kunalRes = await db.query(
          "SELECT id, name FROM users WHERE name='Kunal'"
        );
        if (kunalRes.rows.length > 0) {
          // 1. Archive open Kunal tasks (status NOT IN complete/dismissed/archived)
          const archivedRes = await db.query(
            "UPDATE campaign_tasks SET " +
              "status='archived', " +
              "resolved_at=COALESCE(resolved_at, NOW()), " +
              "archived_at=COALESCE(archived_at, NOW()), " +
              "dismissed_reason=COALESCE(dismissed_reason, 'Kunal removed from team — campaigns paused') " +
            "WHERE agent_name='Kunal' AND status NOT IN ('complete','dismissed','archived') " +
            "RETURNING id"
          );
          // 2. Soft-delete Kunal (only if still active — keeps idempotent)
          const deactivateRes = await db.query("UPDATE users SET is_active=FALSE WHERE name='Kunal' AND COALESCE(is_active,TRUE)=TRUE");
          // 3. Activity log entry — only if we actually did anything this run
          if (archivedRes.rowCount > 0 || deactivateRes.rowCount > 0) {
            try {
              await db.query(
                "INSERT INTO activity_log (action, agent_name, campaign_id, details) " +
                "VALUES ('user_removed', 'Bobby Singh', NULL, $1)",
                ['Kunal removed (left team, campaigns paused); ' + archivedRes.rowCount + ' open tasks archived']
              );
            } catch(_e) { /* activity_log shape may differ — ignore if it does */ }
            console.log('[r20d] Kunal cleanup: archived ' + archivedRes.rowCount + ' open tasks, soft-deleted user');
          }
        }
      } catch(e) { console.error('[r20d] Kunal cleanup error: ' + e.message); }

      // r21: normalise duplicate agent names that split a single agent across
      // multiple buckets in the dashboard. "Aryan Tomar" was found mixed with
      // "Aryan" — always re-canonical to first name. Idempotent.
      // Touches: amazon_products.owner_agent, campaign_tasks.agent_name,
      // activity_log.agent_name, users.name. Bobby has already updated Settings
      // so the users table change should usually be a no-op.
      try {
        const aliasUpdates = [
          { wrong: 'Aryan Tomar',  correct: 'Aryan' },
          { wrong: 'aryan tomar',  correct: 'Aryan' },
          { wrong: 'Aryan tomar',  correct: 'Aryan' }
        ];
        const tablesAndCols = [
          { table: 'amazon_products', col: 'owner_agent' },
          { table: 'campaign_tasks',  col: 'agent_name' },
          { table: 'activity_log',    col: 'agent_name' },
          { table: 'users',           col: 'name' }
        ];
        let totals = {};
        for (const { wrong, correct } of aliasUpdates) {
          for (const { table, col } of tablesAndCols) {
            try {
              const r = await db.query('UPDATE ' + table + ' SET ' + col + '=$1 WHERE ' + col + '=$2', [correct, wrong]);
              if (r.rowCount > 0) {
                const k = table + '.' + col;
                totals[k] = (totals[k] || 0) + r.rowCount;
              }
            } catch(tErr) {
              // Some tables may not exist (e.g. users on first boot) — log + continue
              if (!/does not exist/.test(tErr.message)) console.error('[r21] alias update ' + table + '.' + col + ' (' + wrong + '→' + correct + '): ' + tErr.message);
            }
          }
        }
        const totalRows = Object.values(totals).reduce(function(s, n){ return s + n; }, 0);
        if (totalRows > 0) {
          const breakdown = Object.keys(totals).map(function(k){ return k + '=' + totals[k]; }).join(', ');
          console.log('[r21] agent alias normalisation: ' + totalRows + ' rows updated (' + breakdown + ')');
        }
      } catch(e) { console.error('[r21] agent alias normalisation error: ' + e.message); }
    } catch(e) { console.error('User init error: ' + e.message); }
    console.log('Auth tables ready');

    // ── FIX: Reload today alerts using created_date (not created_at) ──────
    try {
      const todayAlerts = await db.query(
        "SELECT campaign_id, campaign_name, problem_type, problem_detail, created_date FROM campaign_tasks WHERE task_source='alert' AND created_date = ((NOW() AT TIME ZONE 'Europe/London')::DATE)"
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
    // r14 timezone fix: use London date, not UTC. (toISOString returns UTC.)
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' })).toISOString().split('T')[0];
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
    // r25b: detect repeat offenders for Google — same pattern as Amazon. Key by
    // (campaign_id + product_key) since Google tasks can be product-level OR
    // campaign-level. If we already completed a task on this exact target in the
    // last 14 days, this is a repeat — flag it and bump failure_count.
    let isRepeatOffender = false;
    let failureCount = 1;
    try {
      const repeatCheck = await db.query(
        "SELECT id, failure_count FROM campaign_tasks " +
        "WHERE campaign_id = $1 AND department = 'google' " +
        "  AND COALESCE(product_key, '') = COALESCE($2, '') " +
        "  AND status = 'complete' " +
        "  AND last_resolved_date > NOW() - INTERVAL '14 days' " +
        "ORDER BY last_resolved_date DESC LIMIT 1",
        [String(taskRow.campaignId), taskRow.productKey || null]
      );
      if (repeatCheck.rows.length > 0) {
        isRepeatOffender = true;
        failureCount = (repeatCheck.rows[0].failure_count || 1) + 1;
        console.log('[GTASK] REPEAT OFFENDER: ' + taskRow.campaignName + (taskRow.productTitle ? ' / ' + taskRow.productTitle : '') + ' (failure #' + failureCount + ')');
      }
    } catch(e) { console.error('[GTASK] repeat check error: ' + e.message); }

    await db.query(
      "INSERT INTO campaign_tasks " +
      "(campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, score, task_source, " +
      " department, product_key, product_title, baseline_spend, baseline_sales, baseline_acos, baseline_impressions, " +
      " task_type, priority, product_image_url, is_repeat_offender, failure_count) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'google',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
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
        productImageUrl,
        isRepeatOffender,
        failureCount
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
        if (!['Aryan','Satyam'].includes(agent)) return;
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

    // r14 timezone fix: London date, not UTC.
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' })).toISOString().split('T')[0];

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

// r7c — Wasted spend per agent: today + 7-day sparkline.
// "Wasted" follows the same definition used elsewhere in this app:
//   spend > 0 AND (sales === 0 || sales === null)
// Reads from daily_snapshots (the same source as the existing dashboard waste totals).
//
// Permissions: managers/owners see all agents. Agents see only their own row,
// so they can't compare themselves to teammates. We pull the requesting user's
// name from req.user; if missing, we treat as manager-level (legacy fallback).
app.get('/api/wasted-by-agent', async function(req, res) {
  if (!db) return res.json({ today: [], sparklines: {} });
  try {
    const userRole = (req.user && (req.user.role || '').toLowerCase()) || '';
    const userName = (req.user && req.user.name) || '';
    const isManagerLevel = ['owner','manager'].indexOf(userRole) !== -1 || (req.user && (req.user.department || '').toLowerCase() === 'manager');

    // Pull last 7 days of snapshots, oldest → newest so sparklines render in the right order
    const r = await db.query(
      "SELECT TO_CHAR(snapshot_date,'YYYY-MM-DD') AS day, campaigns " +
      "FROM daily_snapshots " +
      "WHERE snapshot_date >= CURRENT_DATE - INTERVAL '6 days' " +
      "ORDER BY snapshot_date ASC"
    );

    // For each day, sum wasted-spend per agent (using the same filter as the rest of the app)
    const wasteByAgentByDay = {}; // { agentName: { '2026-04-29': 12.34, ... } }
    const allAgents = new Set();
    const allDays = [];
    r.rows.forEach(function(snap) {
      const day = snap.day;
      allDays.push(day);
      const camps = snap.campaigns || [];
      camps.forEach(function(c) {
        // Match existing waste definition exactly
        const spend = parseFloat(c.spend || 0);
        const sales = parseFloat(c.sales || 0);
        if (!(spend > 0 && (sales === 0 || c.sales === null))) return;
        // r20: post-matcher fallback. If agent was not stored on the snapshot
        // (older snapshots, or campaigns with no portfolio), parse the name.
        let agent = c.agent || c.agentName || '';
        if (!agent) {
          try {
            const parsed = parseCampaignName(c.name || '');
            if (parsed && parsed.agent) agent = parsed.agent;
          } catch(e) {}
        }
        // r21: canonicalise — old snapshots can carry "Aryan Tomar" frozen in
        // the JSON; we map it to "Aryan" at read time.
        if (agent) {
          const canon = canonicalAgent(agent);
          if (canon) agent = canon;
        }
        if (!agent) agent = 'Unassigned';
        allAgents.add(agent);
        if (!wasteByAgentByDay[agent]) wasteByAgentByDay[agent] = {};
        wasteByAgentByDay[agent][day] = (wasteByAgentByDay[agent][day] || 0) + spend;
      });
    });

    // Today's totals (the most recent day in the range — typically the snapshot for today
    // if the daily sync has run, otherwise yesterday's). Use the last day in allDays.
    const todayKey = allDays.length ? allDays[allDays.length - 1] : null;
    let agentList = Array.from(allAgents);
    // If non-manager, only return their own row
    if (!isManagerLevel && userName) {
      agentList = agentList.filter(function(a){ return a === userName; });
    }

    const today = agentList.map(function(agent) {
      const todayWaste = todayKey ? (wasteByAgentByDay[agent][todayKey] || 0) : 0;
      return { agent: agent, wasted_today: parseFloat(todayWaste.toFixed(2)) };
    });
    // Sort: highest wasted first
    today.sort(function(a, b){ return b.wasted_today - a.wasted_today; });

    // Build sparklines: array of [day, value] for each agent across all 7 days
    const sparklines = {};
    agentList.forEach(function(agent) {
      sparklines[agent] = allDays.map(function(d) {
        return { date: d, value: parseFloat((wasteByAgentByDay[agent][d] || 0).toFixed(2)) };
      });
    });

    res.json({
      today: today,
      sparklines: sparklines,
      todayKey: todayKey,
      days: allDays,
      isManagerLevel: isManagerLevel
    });
  } catch(e) {
    console.error('/api/wasted-by-agent error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/dashboard', async function(req, res) {
  // r16: filter out hidden campaigns from view + totals
  let hiddenCampaignIds = new Set();
  if (db) {
    try {
      const hr = await db.query("SELECT campaign_id FROM hidden_campaigns");
      hiddenCampaignIds = new Set(hr.rows.map(function(r){ return String(r.campaign_id); }));
    } catch(e) {}
  }
  const allCampaigns = state.campaigns;
  const campaigns = allCampaigns.filter(function(c){ return !hiddenCampaignIds.has(String(c.campaignId)); });

  // r25c: enrich each campaign with 7-day ACOS + spend so the front-end can
  // flag chronic underperformers (single-day ACOS doesn't catch sustained waste).
  if (db) {
    try {
      const snapRes = await db.query(
        "SELECT campaigns FROM daily_snapshots WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days'"
      );
      const totals = {}; // campaignId -> { spend, sales }
      snapRes.rows.forEach(function(snap) {
        (snap.campaigns || []).forEach(function(sc) {
          if (!sc.campaignId) return;
          const id = String(sc.campaignId);
          if (!totals[id]) totals[id] = { spend: 0, sales: 0 };
          totals[id].spend += parseFloat(sc.spend || 0);
          totals[id].sales += parseFloat(sc.sales || 0);
        });
      });
      campaigns.forEach(function(c) {
        const t = totals[String(c.campaignId)];
        if (t) {
          c.spend7d = +t.spend.toFixed(2);
          c.sales7d = +t.sales.toFixed(2);
          c.acos7d = t.sales > 0 ? +((100 * t.spend / t.sales).toFixed(1)) : null;
        }
      });
    } catch(e) {
      // Non-fatal — chronic-underperformer badge just won't fire
      if (!/does not exist/.test(e.message)) console.error('[r25c] 7d enrich error: ' + e.message);
    }
  }

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
  // Also filter alerts for hidden campaigns
  if (hiddenCampaignIds.size > 0) filteredAlerts = filteredAlerts.filter(function(a){ return !hiddenCampaignIds.has(String(a.campaignId)); });

  res.json({
    metrics: { totalRevenue: totalRevenue.toFixed(2), totalSpend: totalSpend.toFixed(2), blendedAcos: blendedAcos, activeCampaigns: active, needsAction: needsAction },
    campaigns: campaigns, alerts: filteredAlerts, exhaustionLog: state.exhaustionLog, lastSync: state.lastSync, error: state.error,
    hiddenCount: hiddenCampaignIds.size
  });
});

// r25b: Haiku-then-Opus AI helper. Tries Haiku first; if the response looks
// thin/error-like, escalates to Opus. The whole thing is wrapped in a single
// try/catch so callers don't need to handle it. Returns { text, modelUsed }.
//
// Why: Opus costs ~5x more than Haiku. For routine campaign/product analysis,
// Haiku is good enough most of the time, and we save real money. We escalate
// only when Haiku's output is suspiciously short or empty — meaning it likely
// gave a generic answer that won't be useful.
async function aiHaikuThenOpus(prompt, opts) {
  opts = opts || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY');
  const maxTokens = opts.max_tokens || 1000;
  // Models — keep both pinned so behaviour is deterministic between deploys.
  const HAIKU = 'claude-haiku-4-5-20251001';
  const OPUS  = 'claude-opus-4-5-20251101';
  // Min response length below which we consider Haiku's output "thin" and escalate.
  const MIN_USEFUL_CHARS = opts.min_useful_chars || 80;
  const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };

  // Try Haiku first
  let haikuText = '';
  let haikuOK = false;
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      { model: HAIKU, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      { headers: headers, timeout: 30000 }
    );
    haikuText = (r.data && r.data.content && r.data.content[0] && r.data.content[0].text) || '';
    haikuOK = haikuText.trim().length >= MIN_USEFUL_CHARS;
  } catch(e) {
    console.error('[ai] Haiku call failed: ' + e.message + ' — escalating to Opus');
  }
  if (haikuOK) return { text: haikuText, modelUsed: HAIKU };

  // Escalate to Opus
  console.log('[ai] Escalating to Opus' + (haikuText ? ' (Haiku output was ' + haikuText.length + ' chars, below threshold ' + MIN_USEFUL_CHARS + ')' : ' (Haiku failed)'));
  const r2 = await axios.post('https://api.anthropic.com/v1/messages',
    { model: OPUS, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
    { headers: headers, timeout: 60000 }
  );
  const opusText = (r2.data && r2.data.content && r2.data.content[0] && r2.data.content[0].text) || '';
  return { text: opusText, modelUsed: OPUS };
}

// r25b: AI feedback storage helpers. Used by the 4 AI analysis endpoints to
// (a) read recent agent feedback before sending to the model, and
// (b) save new feedback when the agent submits a correction.
const AI_FEEDBACK_VALID_SCOPES = ['amazon_product', 'amazon_campaign', 'google_product', 'google_campaign'];

async function getAiFeedback(scope, targetId, limit) {
  if (!db) return [];
  if (AI_FEEDBACK_VALID_SCOPES.indexOf(scope) === -1) return [];
  if (!targetId) return [];
  try {
    const r = await db.query(
      "SELECT feedback_text, agent_name, created_at FROM ai_feedback " +
      "WHERE scope = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT $3",
      [scope, String(targetId), limit || 5]
    );
    return r.rows;
  } catch(e) {
    console.error('[r25b] getAiFeedback error: ' + e.message);
    return [];
  }
}

// Build a prompt-ready feedback section. Empty string if no feedback.
async function buildFeedbackPromptSection(scope, targetId) {
  const rows = await getAiFeedback(scope, targetId, 5);
  if (!rows.length) return '';
  const lines = rows.map(function(r, i) {
    const dateStr = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
    const who = r.agent_name ? ' (by ' + r.agent_name + ')' : '';
    return (i + 1) + '. [' + dateStr + who + '] ' + r.feedback_text;
  });
  return '\n\nAGENT FEEDBACK ON PREVIOUS ANALYSES (most recent first — TAKE THESE INTO ACCOUNT):\n' +
    lines.join('\n') +
    '\n\nWhen producing your analysis, address what the agent said. If they corrected a wrong assumption, acknowledge it. ' +
    'If they said "the AI keeps recommending X but Y is the real issue", focus on Y. Do not repeat advice agents have already pushed back on.';
}

// POST /api/ai/feedback — save a new feedback entry. Body: { scope, targetId, feedback }
app.post('/api/ai/feedback', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const scope = String((req.body && req.body.scope) || '').trim();
  const targetId = String((req.body && req.body.targetId) || '').trim();
  const feedback = String((req.body && req.body.feedback) || '').trim();
  if (AI_FEEDBACK_VALID_SCOPES.indexOf(scope) === -1) return res.status(400).json({ error: 'invalid scope' });
  if (!targetId) return res.status(400).json({ error: 'targetId required' });
  if (!feedback) return res.status(400).json({ error: 'feedback text required' });
  if (feedback.length > 2000) return res.status(400).json({ error: 'feedback too long (max 2000 chars)' });

  const agent = (req.user && req.user.name) || 'unknown';
  try {
    const r = await db.query(
      "INSERT INTO ai_feedback (scope, target_id, feedback_text, agent_name) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
      [scope, targetId, feedback, agent]
    );
    res.json({ ok: true, id: r.rows[0].id, created_at: r.rows[0].created_at });
  } catch(e) {
    console.error('[r25b] /api/ai/feedback error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ai/feedback?scope=...&targetId=... — list feedback for a target
app.get('/api/ai/feedback', async function(req, res) {
  if (!db) return res.json({ feedback: [] });
  const scope = String(req.query.scope || '').trim();
  const targetId = String(req.query.targetId || '').trim();
  if (AI_FEEDBACK_VALID_SCOPES.indexOf(scope) === -1) return res.status(400).json({ error: 'invalid scope' });
  if (!targetId) return res.status(400).json({ error: 'targetId required' });
  const rows = await getAiFeedback(scope, targetId, 20);
  res.json({ feedback: rows });
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

// ─── r22: Sponsored Products advertisedProduct report ───────────────────────
// Pulls per-ASIN per-campaign per-day spend/sales/clicks/impressions/units.
// Cron at 04:30 London requests yesterday's report; ~2-3 min until ready.
// Each product card aggregates spend across its ASINs from this table — true
// per-ASIN attribution (no manual mapping, no campaign-name matching).
//
// Two-phase async: requestAdvertisedProductReport queues the report, then
// checkAdvertisedProductReport polls and downloads + persists when ready.
const advertisedProductState = { reportId: null, requested: 0, dateRequested: null };

async function requestAdvertisedProductReport(targetDate) {
  // targetDate: 'YYYY-MM-DD' — defaults to yesterday in London
  const tz = 'Europe/London';
  const reqDate = targetDate || (function(){
    const y = new Date(Date.now() - 24*60*60*1000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(y);
  })();
  if (advertisedProductState.reportId) {
    console.log('[r22 ad-perf] report already in flight (' + advertisedProductState.reportId + '), skipping');
    return { ok: false, reason: 'in-flight' };
  }
  try {
    const token = await getAccessToken();
    const profileId = await getProfileId();
    const headers = getHeaders(profileId, token);
    const res = await axios.post(
      'https://advertising-api-eu.amazon.com/reporting/reports',
      {
        name: 'CampaignPulse advertisedProduct ' + reqDate,
        startDate: reqDate,
        endDate: reqDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['advertiser'],
          columns: [
            'advertisedAsin', 'campaignId', 'campaignName', 'adGroupId', 'adGroupName',
            'cost', 'clicks', 'impressions',
            'sales1d', 'sales7d', 'sales14d',
            'purchases1d', 'purchases7d',
            'unitsSoldClicks1d', 'unitsSoldClicks7d',
            'date'
          ],
          reportTypeId: 'spAdvertisedProduct',
          timeUnit: 'DAILY',
          format: 'GZIP_JSON'
        }
      },
      { headers: Object.assign({}, headers, { 'Content-Type': 'application/json', 'Accept': 'application/json' }) }
    );
    advertisedProductState.reportId = res.data.reportId;
    advertisedProductState.requested = Date.now();
    advertisedProductState.dateRequested = reqDate;
    console.log('[r22 ad-perf] report requested for ' + reqDate + ' — id=' + res.data.reportId);
    return { ok: true, reportId: res.data.reportId };
  } catch(e) {
    const status = e.response && e.response.status;
    const body = e.response && e.response.data;
    console.error('[r22 ad-perf] request error: ' + (status ? 'HTTP ' + status + ' ' : '') + e.message + (body ? ' ' + JSON.stringify(body).slice(0, 300) : ''));
    return { ok: false, error: e.message };
  }
}

async function checkAdvertisedProductReport() {
  if (!advertisedProductState.reportId) return { ok: false, reason: 'no-report' };
  if (!db) return { ok: false, reason: 'no-db' };
  try {
    const token = await getAccessToken();
    const profileId = await getProfileId();
    const headers = getHeaders(profileId, token);
    const statusRes = await axios.get(
      'https://advertising-api-eu.amazon.com/reporting/reports/' + advertisedProductState.reportId,
      { headers: Object.assign({}, headers, { 'Accept': 'application/json' }) }
    );
    const status = statusRes.data.status;
    console.log('[r22 ad-perf] status=' + status);
    if (status === 'PENDING' || status === 'PROCESSING') return { ok: false, reason: 'pending', status: status };
    if (status === 'FAILED') {
      console.error('[r22 ad-perf] report FAILED — ' + JSON.stringify(statusRes.data).slice(0, 300));
      advertisedProductState.reportId = null;
      return { ok: false, reason: 'failed' };
    }
    if (status !== 'COMPLETED') return { ok: false, reason: 'unknown-status', status: status };
    // Download + persist
    const downloadRes = await axios.get(statusRes.data.url, { responseType: 'arraybuffer' });
    const zlib = require('zlib');
    const decompressed = zlib.gunzipSync(Buffer.from(downloadRes.data));
    const records = JSON.parse(decompressed.toString());
    console.log('[r22 ad-perf] downloaded ' + records.length + ' records for ' + advertisedProductState.dateRequested);

    let inserted = 0, errors = 0;
    for (const r of records) {
      const asin = r.advertisedAsin || r.asin;
      const cid = r.campaignId != null ? String(r.campaignId) : null;
      const aid = r.adGroupId != null ? String(r.adGroupId) : '';
      const date = r.date || advertisedProductState.dateRequested;
      if (!asin || !cid || !date) continue;
      try {
        await db.query(
          "INSERT INTO amazon_asin_ad_performance " +
          "(asin, campaign_id, ad_group_id, report_date, spend, sales, clicks, impressions, units, orders, campaign_name, fetched_at) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) " +
          "ON CONFLICT (asin, campaign_id, ad_group_id, report_date) DO UPDATE SET " +
          "spend=EXCLUDED.spend, sales=EXCLUDED.sales, clicks=EXCLUDED.clicks, " +
          "impressions=EXCLUDED.impressions, units=EXCLUDED.units, orders=EXCLUDED.orders, " +
          "campaign_name=EXCLUDED.campaign_name, fetched_at=NOW()",
          [
            asin, cid, aid, date,
            parseFloat(r.cost || 0),
            parseFloat(r.sales7d || r.sales14d || r.sales1d || 0),
            parseInt(r.clicks || 0),
            parseInt(r.impressions || 0),
            parseInt(r.unitsSoldClicks7d || r.unitsSoldClicks1d || 0),
            parseInt(r.purchases7d || r.purchases1d || 0),
            r.campaignName || null
          ]
        );
        inserted++;
      } catch(e) {
        errors++;
        if (errors < 5) console.error('[r22 ad-perf] insert error: ' + e.message);
      }
    }
    console.log('[r22 ad-perf] persisted ' + inserted + ' rows (' + errors + ' errors) for ' + advertisedProductState.dateRequested);
    advertisedProductState.reportId = null;
    return { ok: true, inserted: inserted, errors: errors, date: advertisedProductState.dateRequested };
  } catch(e) {
    console.error('[r22 ad-perf] check error: ' + e.message);
    advertisedProductState.reportId = null;
    return { ok: false, error: e.message };
  }
}

// One-shot helper: fire-and-poll for a single date. Used by the daily cron and
// also by the admin backfill endpoint.
async function fetchAdvertisedProductReport(targetDate) {
  const reqResult = await requestAdvertisedProductReport(targetDate);
  if (!reqResult.ok) return reqResult;
  // Poll up to 10 minutes (every 30s)
  for (let i = 0; i < 20; i++) {
    await new Promise(function(r){ setTimeout(r, 30000); });
    const checkResult = await checkAdvertisedProductReport();
    if (checkResult.ok) return checkResult;
    if (checkResult.reason === 'failed' || checkResult.reason === 'unknown-status') return checkResult;
  }
  return { ok: false, reason: 'timeout', message: 'Report did not complete within 10 minutes' };
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
    const prompt = 'You are analyzing Amazon PPC campaign management performance for FK Sports.\n\nAGENT ACTIVITY LOG (last 30 days):\n' + JSON.stringify(logs.rows, null, 2) + '\n\nREPEAT OFFENDERS:\n' + JSON.stringify(repeats.rows, null, 2) + '\n\nTASK SUMMARY PER AGENT:\n' + JSON.stringify(summary.rows, null, 2) + '\n\nALERT RESPONSE TRACKING:\n' + JSON.stringify(alertResponses.rows, null, 2) + '\n\nKEYWORD ACTIONS PER AGENT:\n' + JSON.stringify(kwActions.rows, null, 2) + '\n\nAnalyze each agent (Aryan, Satyam) performance. For each agent provide:\n1. Overall performance rating (Strong/Average/Needs Improvement)\n2. Tasks completed vs abandoned vs dismissed\n3. Alert response rate\n4. Patterns in their notes\n5. Repeat offender campaigns they own\n6. Keyword intelligence actions\n7. One specific actionable recommendation\n\nBe direct and honest. 4-5 sentences per agent.';
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
    // Audit log — who created what
    try {
      const actor = (req.user && req.user.name) || 'System';
      const deptLabels = { amazon: 'Amazon Advertising', google: 'FK Sports Google', supply_chain: 'Supply Chain', logistics: 'Logistics', manager: 'Manager' };
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes) VALUES ('','',$1,$1,'user_created',$2)",
        [actor, actor + ' created user ' + name + ' (' + (deptLabels[department]||department) + ' ' + (role||'agent') + ')']
      );
    } catch(e) { console.error('Audit log error: ' + e.message); }
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
    // Look up the target user before edit so audit log captures their name
    const beforeRes = await db.query('SELECT name, is_active FROM users WHERE id=$1', [req.params.id]);
    const targetName = beforeRes.rows.length ? beforeRes.rows[0].name : ('user #' + req.params.id);
    const wasActive = beforeRes.rows.length ? beforeRes.rows[0].is_active : true;

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET name=$1, department=$2, role=$3, is_active=$4, password_hash=$5 WHERE id=$6', [name, department, role, is_active, hash, req.params.id]);
    } else {
      await db.query('UPDATE users SET name=$1, department=$2, role=$3, is_active=$4 WHERE id=$5', [name, department, role, is_active, req.params.id]);
    }

    // Audit log — different message if this looks like a deactivation
    try {
      const actor = (req.user && req.user.name) || 'System';
      let action = 'user_updated';
      let note = actor + ' updated user ' + targetName;
      if (wasActive && !is_active) {
        action = 'user_deactivated';
        note = actor + ' deactivated user ' + targetName;
      } else if (!wasActive && is_active) {
        action = 'user_reactivated';
        note = actor + ' reactivated user ' + targetName;
      }
      if (password) note += ' (password reset)';
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes) VALUES ('','',$1,$1,$2,$3)",
        [actor, action, note]
      );
    } catch(e) { console.error('Audit log error: ' + e.message); }

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Soft-delete a user — sets is_active=false. Reversible.
app.post('/api/auth/users/:id/deactivate', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  // Owner-only
  if (!req.user || (req.user.role || '').toLowerCase() !== 'owner') {
    return res.status(403).json({ error: 'Owner permission required' });
  }
  try {
    const beforeRes = await db.query('SELECT name FROM users WHERE id=$1', [req.params.id]);
    const targetName = beforeRes.rows.length ? beforeRes.rows[0].name : ('user #' + req.params.id);
    await db.query('UPDATE users SET is_active=FALSE WHERE id=$1', [req.params.id]);
    // Invalidate any active sessions for that user
    try { await db.query('DELETE FROM user_sessions WHERE user_id=$1', [req.params.id]); } catch(e) {}
    try {
      const actor = (req.user && req.user.name) || 'System';
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes) VALUES ('','',$1,$1,'user_deactivated',$2)",
        [actor, actor + ' deactivated user ' + targetName]
      );
    } catch(e) {}
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Hard-delete a user — destroys the row permanently. Owner only, requires confirmation.
// Frontend must send { confirm: 'DELETE' } in body to proceed.
app.delete('/api/auth/users/:id', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  // Owner-only
  if (!req.user || (req.user.role || '').toLowerCase() !== 'owner') {
    return res.status(403).json({ error: 'Owner permission required' });
  }
  if ((req.body && req.body.confirm) !== 'DELETE') {
    return res.status(400).json({ error: 'Confirmation required: send { confirm: "DELETE" } in body' });
  }
  // Don't let owner delete themselves — would lock them out
  try {
    const target = await db.query('SELECT name, email FROM users WHERE id=$1', [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });
    if (target.rows[0].email === (req.user.email || '').toLowerCase()) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const targetName = target.rows[0].name;
    // Clean up sessions first
    try { await db.query('DELETE FROM user_sessions WHERE user_id=$1', [req.params.id]); } catch(e) {}
    await db.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    try {
      const actor = (req.user && req.user.name) || 'System';
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes) VALUES ('','',$1,$1,'user_deleted',$2)",
        [actor, actor + ' permanently deleted user ' + targetName]
      );
    } catch(e) {}
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
    // Don't downgrade an existing owner — only seed/reset password.
    await db.query("INSERT INTO users (name, email, password_hash, department, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO UPDATE SET password_hash=$3, is_active=TRUE", ['Bobby', 'bobby@fksports.co.uk', hash, 'manager', 'owner']);
    res.json({ success: true, message: 'Manager account created/reset. Email: bobby@fksports.co.uk / Password: FKSports2024!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SP-API admin/diagnostic endpoints (r8) ──────────────────────────────────
// These let us verify SP-API credentials work without waiting for cron.
// Owner-only — agents and managers can't trigger ad-hoc syncs.

function requireOwner(req, res) {
  const role = req.user && (req.user.role || '').toLowerCase();
  if (role !== 'owner') {
    res.status(403).json({ error: 'Owner permission required' });
    return false;
  }
  return true;
}

// GET /api/admin/sp-api/status — quick credentials + connectivity check.
// Does NOT pull data, just verifies a token can be obtained and seller ID fetched.
app.get('/api/admin/sp-api/status', async function(req, res) {
  if (!requireOwner(req, res)) return;
  if (!spApiConfigured()) return res.json({
    ok: false,
    configured: false,
    missing: ['SP_API_CLIENT_ID', 'SP_API_CLIENT_SECRET', 'SP_API_REFRESH_TOKEN'].filter(function(k){ return !process.env[k]; })
  });
  try {
    const token = await getSpApiAccessToken();
    const sellerId = await getSellerId();
    // Count what we already have in the DB
    const productCount = db ? (await db.query('SELECT COUNT(*) as c FROM amazon_products')).rows[0].c : 0;
    const orderCount = db ? (await db.query('SELECT COUNT(*) as c FROM amazon_orders')).rows[0].c : 0;
    res.json({
      ok: true,
      configured: true,
      tokenObtained: !!token,
      sellerId: sellerId,
      counts: { products: parseInt(productCount), orders: parseInt(orderCount) }
    });
  } catch(e) {
    res.json({ ok: false, configured: true, error: e.message });
  }
});

// POST /api/admin/sp-api/sync-catalogue — manually triggers catalogue sync.
// Returns counts of items pulled/upserted/errors. Useful for first-run testing.
app.post('/api/admin/sp-api/sync-catalogue', async function(req, res) {
  if (!requireOwner(req, res)) return;
  const result = await syncAmazonCatalogue();
  res.json(result);
});

// POST /api/admin/sp-api/sync-orders — manually triggers orders sync.
// Body: { daysBack: 7 } (optional, default 7).
app.post('/api/admin/sp-api/sync-orders', async function(req, res) {
  if (!requireOwner(req, res)) return;
  const daysBack = parseInt((req.body && req.body.daysBack) || 7);
  const result = await syncAmazonOrders(daysBack);
  res.json(result);
});

// r25c: POST /api/amazon/refresh-sales-now — manager+owner accessible.
// Pulls only TODAY's orders (1 day window) so it's fast (~30s) and quota-light.
// Used by the dashboard "Refresh sales" button so the team isn't waiting for
// the next 06:00/14:00 cron when they want fresh numbers.
app.post('/api/amazon/refresh-sales-now', async function(req, res) {
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  const dept = (req.user && (req.user.department || '').toLowerCase()) || '';
  const isPrivileged = ['owner','manager'].indexOf(role) !== -1 || dept === 'manager';
  if (!isPrivileged) return res.status(403).json({ error: 'Manager+ only' });
  if (!spApiConfigured()) return res.status(400).json({ error: 'SP-API not configured' });
  // Light rate-limit: don't allow more than once every 30s per process. Stops
  // accidental rapid-fire clicks from burning quota.
  const now = Date.now();
  if (global._lastRefreshSalesAt && (now - global._lastRefreshSalesAt) < 30000) {
    const waitSec = Math.ceil((30000 - (now - global._lastRefreshSalesAt)) / 1000);
    return res.status(429).json({ error: 'Recently refreshed — wait ' + waitSec + 's' });
  }
  global._lastRefreshSalesAt = now;
  try {
    const result = await syncAmazonOrders(1); // today only
    res.json({ ok: true, syncedDays: 1, result: result, refreshedAt: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/sp-api/raw?path=/path — diagnostic passthrough.
// Owner-only. Calls SP-API with the supplied path and returns raw response.
// Used to inspect endpoint responses when something doesn't parse as expected.
// Path must start with / and be one of an allow-listed prefix to prevent abuse.
app.get('/api/admin/sp-api/raw', async function(req, res) {
  if (!requireOwner(req, res)) return;
  const p = String(req.query.path || '');
  if (!p.startsWith('/')) return res.status(400).json({ error: 'path must start with /' });
  // Allow-list of safe prefixes — read-only diagnostic only
  const allowed = ['/sellers/', '/listings/', '/catalog/', '/orders/', '/fba/'];
  if (!allowed.some(function(prefix){ return p.startsWith(prefix); })) {
    return res.status(400).json({ error: 'path prefix not in allow-list' });
  }
  try {
    const data = await spApiGet(p);
    res.json({ ok: true, data: data });
  } catch(e) {
    const status = (e.response && e.response.status) || 'no-response';
    const body = (e.response && e.response.data) || null;
    res.json({ ok: false, status: status, error: e.message, body: body });
  }
});

// GET /api/admin/sp-api/test-listings — owner-only.
// Probes the Listings endpoint with the configured seller ID and a tiny pageSize
// so we can see exactly what Amazon's 400 error says without burning much quota.
// Tries multiple variants because Amazon documents a few different parameter
// shapes depending on listing type (FBA vs FBM vs vendor) and SP-API role grants.
app.get('/api/admin/sp-api/test-listings', async function(req, res) {
  if (!requireOwner(req, res)) return;
  try {
    const sellerId = await getSellerId();
    const variants = [
      { name: 'minimal', path: '/listings/2021-08-01/items/' + encodeURIComponent(sellerId) + '?marketplaceIds=' + SP_API_MARKETPLACE_ID + '&pageSize=5' },
      { name: 'with summaries only', path: '/listings/2021-08-01/items/' + encodeURIComponent(sellerId) + '?marketplaceIds=' + SP_API_MARKETPLACE_ID + '&includedData=summaries&pageSize=5' },
      { name: 'identifiers only', path: '/listings/2021-08-01/items/' + encodeURIComponent(sellerId) + '?marketplaceIds=' + SP_API_MARKETPLACE_ID + '&includedData=identifiers&pageSize=5' },
      // r9 probes — finding a way to get parent ASIN data
      { name: 'summaries+relationships', path: '/listings/2021-08-01/items/' + encodeURIComponent(sellerId) + '?marketplaceIds=' + SP_API_MARKETPLACE_ID + '&includedData=summaries,relationships&pageSize=5' },
      { name: 'relationships only', path: '/listings/2021-08-01/items/' + encodeURIComponent(sellerId) + '?marketplaceIds=' + SP_API_MARKETPLACE_ID + '&includedData=relationships&pageSize=5' },
      { name: 'summaries+attributes', path: '/listings/2021-08-01/items/' + encodeURIComponent(sellerId) + '?marketplaceIds=' + SP_API_MARKETPLACE_ID + '&includedData=summaries,attributes&pageSize=5' }
    ];
    const results = [];
    for (const v of variants) {
      try {
        const data = await spApiGet(v.path);
        results.push({ variant: v.name, ok: true, itemCount: (data && data.items && data.items.length) || 0, sample: (data && data.items && data.items[0]) ? Object.keys(data.items[0]) : null });
      } catch(e) {
        results.push({
          variant: v.name,
          ok: false,
          status: (e.response && e.response.status) || null,
          body: (e.response && e.response.data) || null,
          message: e.message
        });
      }
    }
    res.json({ sellerIdFromState: sellerId, results: results });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// r20 — Admin endpoints for SP-API signal refresh + Sales & Traffic backfill
// ════════════════════════════════════════════════════════════════════════════

// POST /api/admin/refresh-pricing-signals — manually trigger the 03:30 cron
// for all active ASINs. Returns counts. Owner+manager only.
app.post('/api/admin/refresh-pricing-signals', async function(req, res) {
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  if (['owner','manager'].indexOf(role) === -1) return res.status(403).json({ error: 'manager+ only' });
  if (!spApiConfigured()) return res.status(400).json({ error: 'SP-API not configured' });
  try {
    // Run async, don't make the user wait — but return a quick "started" response.
    // For one-off ASIN testing pass ?asin=B0...
    const oneAsin = String(req.query.asin || '').trim();
    if (oneAsin && /^B[0-9A-Z]{9}$/.test(oneAsin)) {
      const skuRow = db ? (await db.query('SELECT sku FROM amazon_products WHERE asin=$1 LIMIT 1', [oneAsin])).rows[0] : null;
      const result = await refreshAmazonPricingSignals({ onlyAsin: oneAsin });
      const sigRow = db ? (await db.query('SELECT * FROM amazon_pricing_signals WHERE asin=$1', [oneAsin])).rows[0] : null;
      return res.json({ ok: true, oneAsin: oneAsin, result: result, row: sigRow });
    }
    // r21: ?includeAll=1 forces refresh of ALL BUYABLE ASINs (incl. dormant).
    // Default behaviour now restricts to ASINs sold in last 60 days.
    const includeAll = req.query.includeAll === '1' || req.query.includeAll === 'true';
    refreshAmazonPricingSignals({ includeAll: includeAll }).catch(function(e){ console.error('[admin] refresh-pricing-signals: ' + e.message); });
    res.json({ ok: true, includeAll: includeAll, message: 'Refresh started in background (' + (includeAll ? 'all BUYABLE ASINs' : 'active 60d only') + '). Check logs and amazon_pricing_signals table.' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// r22: POST /api/admin/fetch-ad-performance?date=YYYY-MM-DD — pull a single
// day's advertisedProduct report. Defaults to yesterday. Owner+manager only.
// Synchronous (waits for the report to complete, ~2-3 min).
app.post('/api/admin/fetch-ad-performance', async function(req, res) {
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  if (['owner','manager'].indexOf(role) === -1) return res.status(403).json({ error: 'manager+ only' });
  const date = String(req.query.date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    // Fire and forget — return immediately so the user doesn't have to wait
    fetchAdvertisedProductReport(date || null).catch(function(e){ console.error('[admin] fetch-ad-performance: ' + e.message); });
    res.json({ ok: true, message: 'Report fetch started in background. Check logs in ~2-3 minutes for completion.', date: date || 'yesterday' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// r22: POST /api/admin/backfill-ad-performance?days=14 — backfill last N days.
// Sequential because Amazon Ads has report quota. ~3 min per day.
app.post('/api/admin/backfill-ad-performance', async function(req, res) {
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  if (['owner','manager'].indexOf(role) === -1) return res.status(403).json({ error: 'manager+ only' });
  const days = Math.min(parseInt(req.query.days || '14'), 60);
  // Run async; don't block the response
  (async function() {
    console.log('[r22 backfill] starting ' + days + ' days');
    for (let i = 1; i <= days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      try {
        const result = await fetchAdvertisedProductReport(dateStr);
        console.log('[r22 backfill] ' + dateStr + ': ' + JSON.stringify(result));
      } catch(e) {
        console.error('[r22 backfill] ' + dateStr + ' error: ' + e.message);
      }
      // Brief pause between days to be kind to the report quota
      await new Promise(function(r){ setTimeout(r, 5000); });
    }
    console.log('[r22 backfill] done');
  })().catch(function(e){ console.error('[r22 backfill] outer error: ' + e.message); });
  res.json({ ok: true, message: 'Backfill started for ' + days + ' days. Each day takes ~2-3 min, total ~' + (days * 3) + ' min. Check server logs.' });
});

// r23: POST /api/admin/traffic-diagnose?date=YYYY-MM-DD — runs ONE day and
// returns Amazon's actual response. Use this to figure out why the traffic
// snapshots table has 0 rows after a backfill attempt. Synchronous (~3 min
// for one day). Owner+manager only.
app.post('/api/admin/traffic-diagnose', async function(req, res) {
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  if (['owner','manager'].indexOf(role) === -1) return res.status(403).json({ error: 'manager+ only' });
  if (!spApiConfigured()) return res.status(400).json({ error: 'SP-API not configured', spApi: { configured: false } });
  const date = String(req.query.date || '').trim() || new Date(Date.now() - 24*60*60*1000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  // Don't await fetchSalesAndTrafficReport directly — it has 3-min poll. Return
  // immediately and let caller hit pricing-signals-status / row counts after.
  // But ALSO try to capture the createReport step result (quick, ~1 sec).
  try {
    const createRes = await spApiPost('/reports/2021-06-30/reports', {
      reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
      marketplaceIds: [SP_API_MARKETPLACE_ID],
      dataStartTime: date + 'T00:00:00Z',
      dataEndTime: date + 'T23:59:59Z',
      reportOptions: { dateGranularity: 'DAY', asinGranularity: 'CHILD' }
    });
    const reportId = createRes && createRes.reportId;
    res.json({
      ok: !!reportId,
      step: 'createReport',
      date: date,
      reportId: reportId || null,
      response: createRes,
      message: reportId
        ? 'Report queued successfully. Poll /reports/2021-06-30/reports/' + reportId + ' or wait ~3 min and check /api/admin/pricing-signals-status for row counts. If counts stay 0 after polling completes, the report itself returned empty (data not available for this date).'
        : 'Report request rejected by Amazon. Check the response above for the reason — common causes: insufficient permissions on the SP-API role, marketplace ID mismatch, date in future or > 90 days old.'
    });
  } catch(e) {
    res.status(500).json({
      ok: false,
      step: 'createReport',
      date: date,
      error: e.message,
      stack: (e.stack || '').slice(0, 800),
      hint: 'createReport failed. Check error message — if it mentions "InvalidScopeException" or "Unauthorized", the SP-API role is missing the Amazon Selling Partner Reports scope. If "InvalidDateRange", the date is too old or in the future.'
    });
  }
});

// ─── r24: ONE-SHOT ADMIN ACTIONS ───────────────────────────────────────────
// Two endpoints below are intended to be called once each, then stay dormant.
// They will be removed in r25 (audit cleanup).

// r24: POST /api/admin/r24-unmerge-trampolines — unmerge the 9 outdoor trampoline
// ASINs Bobby flagged. Splits 5 ASINs back into standalones (parent_sku=NULL),
// and groups the remaining 4 ASINs as one family (canonical parent_sku=B0FFH4WX84).
// Owner-only. Safe to call more than once (idempotent — operations are absolute,
// not relative).
app.post('/api/admin/r24-unmerge-trampolines', async function(req, res) {
  if (!requireOwner(req, res)) return;
  if (!db) return res.status(500).json({ error: 'No DB' });

  // ASINs to make standalone (parent_sku = NULL)
  const standaloneAsins = ['B0DSC9QSNF', 'B0DS8VWLT9', 'B0DS8WYML2', 'B0DSJJ3NQV', 'B0DS8X2VLM'];
  // ASINs to group as one family (parent_sku = canonicalParent)
  const familyAsins = ['B0FFH4WX84', 'B0FFH614FH', 'B0FFH6FRK9', 'B0FFH9JTPJ'];
  const canonicalParent = 'B0FFH4WX84'; // first of the family — used as the group key

  try {
    const summary = { standalone: [], family: [], notFound: [] };

    // 1) Split standalones — set parent_sku = NULL on every SKU mapped to these ASINs
    for (const asin of standaloneAsins) {
      const r = await db.query(
        'UPDATE amazon_products SET parent_sku = NULL WHERE asin = $1 RETURNING sku',
        [asin]
      );
      if (r.rowCount === 0) summary.notFound.push(asin);
      else summary.standalone.push({ asin: asin, skus: r.rows.map(function(x){ return x.sku; }) });
    }

    // 2) Group family — set parent_sku = canonicalParent on every SKU mapped to these ASINs
    for (const asin of familyAsins) {
      const r = await db.query(
        'UPDATE amazon_products SET parent_sku = $1 WHERE asin = $2 RETURNING sku',
        [canonicalParent, asin]
      );
      if (r.rowCount === 0) summary.notFound.push(asin);
      else summary.family.push({ asin: asin, skus: r.rows.map(function(x){ return x.sku; }) });
    }

    // 3) Audit log
    try {
      const actor = (req.user && req.user.name) || 'System';
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes) VALUES ('','',$1,$1,'r24_unmerge_trampolines',$2)",
        [actor, 'r24 trampoline unmerge: ' + standaloneAsins.length + ' standalones, ' + familyAsins.length + '-family under ' + canonicalParent]
      );
    } catch(e) {}

    // r25b: previously called deriveProductOwners() here, which wiped manual-style
    // ownership on any product with owner_manual=FALSE — silently reassigning many
    // products to the most active agent (Satyam). Removed: the unmerge action does
    // not change ownership semantics, so it should not retrigger auto-derive.
    let derive = { ok: true, skipped: true, note: 'auto-derive intentionally skipped in r25b' };

    res.json({ ok: true, summary: summary, canonicalParent: canonicalParent, derive: derive });
  } catch(e) {
    console.error('/api/admin/r24-unmerge-trampolines error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// r24: POST /api/admin/r24-wipe-google-tasks — wipe ALL Google tasks (every status).
// Cascades to task_subtasks via FK ON DELETE CASCADE. Use this once to clean up
// duplicates so tomorrow's 9am cron creates a fresh, clean task list.
// Owner-only. Will refuse if invoked outside the maintenance window flag.
app.post('/api/admin/r24-wipe-google-tasks', async function(req, res) {
  if (!requireOwner(req, res)) return;
  if (!db) return res.status(500).json({ error: 'No DB' });

  // Safety: require explicit confirm=YES_WIPE in body to avoid accidental hits.
  const confirm = (req.body && req.body.confirm) || '';
  if (confirm !== 'YES_WIPE') {
    return res.status(400).json({ error: 'Pass {"confirm":"YES_WIPE"} in body to proceed.' });
  }

  try {
    // Count first so we can report what was wiped
    const countRow = await db.query(
      "SELECT COUNT(*)::int AS c FROM campaign_tasks WHERE department = 'google'"
    );
    const before = countRow.rows[0].c;

    // Delete — task_subtasks rows cascade away automatically
    const del = await db.query("DELETE FROM campaign_tasks WHERE department = 'google'");

    // Audit log
    try {
      const actor = (req.user && req.user.name) || 'System';
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, department) VALUES ('','',$1,$1,'r24_wipe_google_tasks',$2,'google')",
        [actor, 'r24 wipe: deleted ' + (del.rowCount || 0) + ' Google tasks (was ' + before + ')']
      );
    } catch(e) {}

    res.json({
      ok: true,
      tasks_before: before,
      tasks_deleted: del.rowCount || 0,
      message: 'Google tasks wiped. The 9am cron tomorrow (London time) will create fresh tasks based on current campaign data.'
    });
  } catch(e) {
    console.error('/api/admin/r24-wipe-google-tasks error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/backfill-traffic?days=30 — pull last N days of traffic reports.
// Reports come back async, so this is fire-and-forget. Owner+manager only.
app.post('/api/admin/backfill-traffic', async function(req, res) {
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  if (['owner','manager'].indexOf(role) === -1) return res.status(403).json({ error: 'manager+ only' });
  if (!spApiConfigured()) return res.status(400).json({ error: 'SP-API not configured' });
  const days = Math.min(60, Math.max(1, parseInt(req.query.days || '30')));
  try {
    // Build date list — yesterday backwards
    const dates = [];
    const now = new Date();
    for (let i = 1; i <= days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    // r20c: Amazon's Reports API createReport quota is ~15/hour with tight burst
    // throttling. Without spacing, fire-and-forget hits 429s after the first 4-5
    // requests and the rest of the backfill is wasted. 4-minute spacing keeps us
    // safely under the quota and lets each report finish processing before the
    // next is queued. 30 days × 4 min ≈ 2 hours.
    const SPACING_MS = 4 * 60 * 1000;
    const minutes = Math.ceil((days * SPACING_MS) / 60000);
    res.json({ ok: true, message: 'Backfill started for ' + days + ' days at 4 min spacing (Amazon throttle). Total ~' + minutes + ' min.', dates: dates });
    // Run sequentially in background with throttle-respecting spacing
    (async function() {
      for (let i = 0; i < dates.length; i++) {
        try { await fetchSalesAndTrafficReport(dates[i]); }
        catch(e) { console.error('[admin] backfill ' + dates[i] + ': ' + e.message); }
        // Don't sleep after the last one
        if (i < dates.length - 1) {
          await new Promise(function(r){ setTimeout(r, SPACING_MS); });
        }
      }
      console.log('[admin] traffic backfill complete (' + days + ' days)');
    })();
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/pricing-signals-status — show coverage of the cache.
// Useful for verifying after deploy that the cron is running.
app.get('/api/admin/pricing-signals-status', async function(req, res) {
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  if (['owner','manager'].indexOf(role) === -1) return res.status(403).json({ error: 'manager+ only' });
  if (!db) return res.json({ error: 'no DB' });
  try {
    const totals = await db.query("SELECT COUNT(*) AS total, " +
      "COUNT(your_price) AS with_price, COUNT(lowest_competitor_price) AS with_comp, " +
      "COUNT(reviews_count) AS with_reviews, COUNT(last_content_update) AS with_content_date, " +
      "COUNT(fulfillable_qty) AS with_inventory, COUNT(stock_cover_days) AS with_stock_cover, " +
      "MAX(fetched_at) AS last_refresh FROM amazon_pricing_signals");
    const traffic = await db.query("SELECT COUNT(DISTINCT asin) AS asins, COUNT(*) AS rows, " +
      "MAX(report_date) AS latest_date, MIN(report_date) AS earliest_date FROM amazon_traffic_snapshots");
    res.json({ pricingSignals: totals.rows[0], trafficSnapshots: traffic.rows[0] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// r9 — Amazon products API: parent-grouped view with sales + ad coverage
// ════════════════════════════════════════════════════════════════════════════

// GET /api/amazon/products
// Returns parent products with children nested, plus 7-day sales totals and
// per-child campaign coverage flag. Used by the Sales Dashboard + Untargeted card.
//
// Coverage logic:
//   - "in_campaign" = true if child ASIN appears in any active campaign in `daily_snapshots`
//     within the last 7 days (we read from the existing campaigns array in snapshots —
//     they include `targets` arrays per campaign which list the targeted ASINs).
//   - This is approximate — auto-targeting campaigns may show ads for a product without
//     ever explicitly listing the ASIN. We flag those as "auto-targeted only" separately.
// r12: Amazon-specific product diagnosis engine.
// Returns { priority, diagnosis, action } for a product based on its sales,
// ad coverage, ACOS, listing status, and campaign performance.
//
// Priority levels:
//   1 = URGENT — losing money, suspended listing, or major coverage gap on a high-revenue product
//   2 = ATTENTION — needs action (advertising gap, high ACOS, etc.)
//   3 = SCALE — performing well, opportunity to grow
//   4 = INFO — stable / no action needed
//
// Diagnosis = factual observation. Action = what to do.
const ACOS_TARGET = 20; // company target — could come from settings later
function computeAmazonDiagnosis(p) {
  // p has: parent, totalSales, totalUnits, adCoveragePct, advertisedChildren, totalChildren,
  //        campaignSpend, campaignSales, acos, campaignCount, autoCampaignsExist
  // r20: also receives `signals` — buy_box_pct_7d, stock_cover_days, reviews_*, price_vs_lowest, content_age_days
  // r20c: returns priority + diagnosis + action + evidence (short subtitle for card pill).
  //   Note: the campaign matcher was removed in r20c, so campaignSpend/campaignCount
  //   are always 0 currently. The cases below that depend on those values are kept
  //   for when manual ASIN→campaign mapping returns. For now, most products fall
  //   through to listing/signal-based cases.
  const parent = p.parent;
  const inactiveCount = parent.inactive_count || 0;
  const buyableCount = parent.buyable_count || 0;
  const hasSales = p.totalSales > 0;
  const hasSpend = p.campaignSpend > 0;
  const hasCampaigns = p.campaignCount > 0;
  const sig = p.signals || {};

  // ── URGENT cases (priority 1) ──────────────────────────────────────────────
  // r21: Stock-cover urgency DISABLED. Amazon's SP-API returns inconsistent
  // FBM/FBA quantities — SKU naming conventions split between "FBA" / "Amazon"
  // suffixes, fulfillmentAvailability requires explicit includedData but even
  // then is patchy, and FBA inventory often shows 0 for products with active
  // warehouse stock. Result was constant false-urgent flags. Cron still
  // populates fulfillable_qty/stock_cover_days for history, just not surfaced.
  // Buy Box, ACOS, zero-attributed-sales remain active urgency triggers.
  // To re-enable when data is reliable: uncomment the block below.
  /*
  if (sig.stock_cover_days != null && sig.stock_cover_days < 30 &&
      (sig.velocity_30d || 0) > 0 && hasSales) {
    const days = sig.stock_cover_days;
    const isCritical = days < 7;
    const channelLabel = sig.fulfillment_mode === 'fbm' ? ' (warehouse stock)'
                       : sig.fulfillment_mode === 'mixed' ? ' (FBA + warehouse combined)'
                       : '';
    return {
      priority: isCritical ? 1 : 2,
      evidence: days + 'd cover' + (sig.fulfillment_mode === 'fbm' ? ' (FBM)' : ''),
      diagnosis: 'Only ' + days + ' days of stock left at current sales rate (' + (sig.fulfillable_qty || 0) + ' units' + channelLabel + ', ' + (sig.velocity_30d || 0).toFixed(1) + '/day)',
      action: sig.fulfillment_mode === 'fbm' ? 'Replenish warehouse — running low'
            : sig.fulfillment_mode === 'mixed' ? 'Replenish stock — running low across FBA + warehouse'
            : 'Send replenishment to FBA — running low'
    };
  }
  */
  // r20: Buy Box collapse — selling but losing the box more than half the time
  if (sig.buy_box_pct_7d != null && sig.buy_box_days >= 5 && sig.buy_box_pct_7d < 50 && hasSales) {
    return {
      priority: 1,
      evidence: 'Buy Box ' + sig.buy_box_pct_7d + '% (last 7d)',
      diagnosis: 'Buy Box only ' + sig.buy_box_pct_7d + '% over last 7 days — losing the offer to other sellers',
      action: 'Check pricing vs competitors and any account/health issues'
    };
  }
  // Listing suspended/inactive
  if (inactiveCount > 0 && buyableCount === 0) {
    return {
      priority: 1,
      evidence: 'all variants inactive',
      diagnosis: 'All variants INACTIVE/SUSPENDED — listing not buyable on Amazon',
      action: 'Investigate suspension reason in Seller Central; relist'
    };
  }
  if (inactiveCount >= 2 && p.totalChildren > 2) {
    return {
      priority: 1,
      evidence: inactiveCount + ' of ' + p.totalChildren + ' variants suspended',
      diagnosis: inactiveCount + ' of ' + p.totalChildren + ' variants suspended/inactive',
      action: 'Review suspended ASINs in Seller Central and reinstate'
    };
  }
  // Spending hard with zero sales — wasted budget
  if (hasSpend && p.campaignSpend > 20 && !hasSales) {
    return {
      priority: 1,
      evidence: '£' + p.campaignSpend.toFixed(0) + ' spend, zero attributed sales',
      diagnosis: 'Spending £' + p.campaignSpend.toFixed(2) + '/wk in ' + p.campaignCount + ' campaigns — zero sales',
      action: 'Pause campaigns or check listing for issues (image / price / reviews)'
    };
  }
  // ACOS extremely high (above 2x target)
  if (hasSales && hasSpend && p.acos > ACOS_TARGET * 2) {
    return {
      priority: 1,
      evidence: 'ACOS ' + p.acos + '% (target ' + ACOS_TARGET + '%)',
      diagnosis: 'ACOS ' + p.acos + '% — more than double target (' + ACOS_TARGET + '%) at £' + p.campaignSpend.toFixed(2) + ' spend',
      action: 'Reduce bids or add negative keywords; review search-term report'
    };
  }

  // ── ATTENTION cases (priority 2) ───────────────────────────────────────────
  // Selling but no campaigns at all on this product → losing potential
  if (hasSales && p.totalSales > 50 && !hasCampaigns) {
    return {
      priority: 2,
      evidence: '£' + p.totalSales.toFixed(0) + ' organic, no ads',
      diagnosis: '£' + p.totalSales.toFixed(0) + ' organic sales, but no advertising at all',
      action: 'Launch a Sponsored Products campaign — already has organic demand'
    };
  }
  // Coverage gap — many variants un-advertised
  if (p.totalChildren >= 3 && p.adCoveragePct < 40 && hasSales) {
    return {
      priority: 2,
      evidence: p.advertisedChildren + ' of ' + p.totalChildren + ' variants advertised',
      diagnosis: 'Only ' + p.advertisedChildren + ' of ' + p.totalChildren + ' variants advertised (' + p.adCoveragePct + '% coverage)',
      action: 'Add remaining variants to existing campaigns (same parent ASIN target)'
    };
  }
  // ACOS above target
  if (hasSales && hasSpend && p.acos > ACOS_TARGET) {
    return {
      priority: 2,
      evidence: 'ACOS ' + p.acos + '% above ' + ACOS_TARGET + '% target',
      diagnosis: 'ACOS ' + p.acos + '% — above ' + ACOS_TARGET + '% target on ' + p.campaignCount + ' campaigns',
      action: 'Tune bids on top-spending keywords; check search-term waste'
    };
  }
  // Owner unassigned — admin issue
  if (!parent.owner_agent && hasSales) {
    return {
      priority: 2,
      evidence: 'no agent assigned',
      diagnosis: 'No agent assigned — sales not attributed in team breakdown',
      action: 'Assign an owner agent from the dropdown above'
    };
  }
  // No sales no spend — should we be advertising this?
  if (!hasSales && !hasSpend && buyableCount > 0) {
    return {
      priority: 2,
      evidence: 'buyable, no sales in 7 days',
      diagnosis: 'BUYABLE listing with no sales and no advertising in 7 days',
      action: 'Either launch test ads or de-prioritise the listing'
    };
  }
  // r20d: stock cover < 30d cases are now handled in the URGENT block above
  // (merged with the < 7d critical check) — single place, single rule.
  // r20: Priced materially above lowest competitor — likely losing Buy Box
  if (sig.price_vs_lowest != null && sig.price_vs_lowest > 5 && hasSales) {
    return {
      priority: 2,
      evidence: '£' + sig.price_vs_lowest.toFixed(2) + ' above lowest competitor',
      diagnosis: 'Priced £' + sig.price_vs_lowest.toFixed(2) + ' above lowest competitor (£' + (sig.your_price || 0).toFixed(2) + ' vs £' + (sig.lowest_competitor_price || 0).toFixed(2) + ')',
      action: 'Review pricing — likely losing Buy Box and conversions'
    };
  }
  // r20: Buy Box 50-80% — not catastrophic but losing some sales
  if (sig.buy_box_pct_7d != null && sig.buy_box_days >= 5 && sig.buy_box_pct_7d < 80 && hasSales) {
    return {
      priority: 2,
      evidence: 'Buy Box ' + sig.buy_box_pct_7d + '% (target 90%+)',
      diagnosis: 'Buy Box ' + sig.buy_box_pct_7d + '% over last 7 days (target 90%+)',
      action: 'Check pricing; ensure stock is sufficient and account health is green'
    };
  }
  // r20: Content stale > 90 days — refresh A+ for SEO + conversion lift
  if (sig.content_age_days != null && sig.content_age_days > 90 && hasSales) {
    return {
      priority: 2,
      evidence: 'content ' + sig.content_age_days + ' days old',
      diagnosis: 'Listing content not updated for ' + sig.content_age_days + ' days — Amazon SEO benefits from refresh',
      action: 'Refresh title keywords, bullets, and A+ content'
    };
  }

  // ── SCALE cases (priority 3) ───────────────────────────────────────────────
  // Healthy: ACOS at or below target with meaningful spend
  if (hasSales && hasSpend && p.acos <= ACOS_TARGET && p.campaignSpend > 10) {
    return {
      priority: 3,
      evidence: 'ACOS ' + p.acos + '%, £' + p.totalSales.toFixed(0) + ' sales',
      diagnosis: 'ACOS ' + p.acos + '% (under ' + ACOS_TARGET + '% target) — £' + p.totalSales.toFixed(0) + ' sales, £' + p.campaignSpend.toFixed(0) + ' spend',
      action: 'Increase budget on top-performing campaigns'
    };
  }
  if (hasSales && p.totalSales > 100 && p.adCoveragePct >= 80) {
    return {
      priority: 3,
      evidence: '£' + p.totalSales.toFixed(0) + ' sales, ' + p.adCoveragePct + '% coverage',
      diagnosis: '£' + p.totalSales.toFixed(0) + ' weekly sales with ' + p.adCoveragePct + '% ad coverage',
      action: 'Strong performer — consider Sponsored Brands or Sponsored Display tests'
    };
  }

  // ── INFO (priority 4) ──────────────────────────────────────────────────────
  if (hasSales) {
    return {
      priority: 4,
      evidence: '£' + p.totalSales.toFixed(0) + ' sales',
      diagnosis: '£' + p.totalSales.toFixed(0) + ' sales, ' + p.adCoveragePct + '% ad coverage',
      action: 'No immediate action required'
    };
  }
  return {
    priority: 4,
    evidence: p.totalChildren + ' variant' + (p.totalChildren === 1 ? '' : 's') + ', no recent activity',
    diagnosis: p.totalChildren + ' variant' + (p.totalChildren === 1 ? '' : 's') + ' tracked, no recent activity',
    action: 'Monitor — no urgent action'
  };
}

// r16b: Debug endpoint — traces the matcher for one specific product
// Usage: GET /api/admin/match-debug?titleContains=vibration plate
// Returns: every campaign that should match this product + why each does or doesn't.
app.get('/api/admin/match-debug', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const titleQuery = String(req.query.titleContains || '').toLowerCase();
  if (!titleQuery) return res.status(400).json({ error: 'titleContains query required' });
  try {
    // Find all matching products
    const prodRes = await db.query(
      "SELECT sku, asin, title, parent_sku FROM amazon_products WHERE LOWER(title) LIKE $1 LIMIT 5",
      ['%' + titleQuery + '%']
    );
    if (!prodRes.rows.length) return res.json({ error: 'no products with that title', titleQuery: titleQuery });

    // Pull recent campaigns
    const snapshotsRes = await db.query(
      "SELECT campaigns FROM daily_snapshots WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days'"
    );
    const seenCamp = new Set();
    const recentCampaigns = [];
    snapshotsRes.rows.forEach(function(snap) {
      (snap.campaigns || []).forEach(function(c) {
        if (c.campaignId && !seenCamp.has(c.campaignId)) { seenCamp.add(c.campaignId); recentCampaigns.push(c); }
      });
    });

    // Trace each product
    const results = prodRes.rows.map(function(p) {
      const titleKw = extractTitleKeywords(p.title || '');
      const titleKwArr = Array.from(titleKw);
      // Find campaigns whose name mentions any keyword
      const candidateCampaigns = recentCampaigns.filter(function(c) {
        const lower = (c.name || '').toLowerCase();
        return titleKwArr.some(function(kw){ return lower.indexOf(kw) !== -1; });
      });
      const traced = candidateCampaigns.slice(0, 10).map(function(c) {
        const parsed = parseCampaignName(c.name || '');
        const hintKw = extractTitleKeywords(parsed.productHint);
        const hintKwArr = Array.from(hintKw);
        const overlap = hintKwArr.filter(function(kw){ return titleKw.has(kw); });
        const wouldMatch = isCampaignMatch(hintKw, titleKw);
        return {
          name: c.name,
          parsed_agent: parsed.agent,
          parsed_hint: parsed.productHint,
          hint_keywords: hintKwArr,
          title_keywords: titleKwArr.slice(0, 15),
          overlap: overlap,
          would_match: wouldMatch,
          reason: wouldMatch ? 'matches' :
            !parsed.agent ? 'no agent prefix in campaign name (parser rejected)' :
            hintKwArr.length === 0 ? 'no usable hint keywords (all stop-words?)' :
            overlap.length === 0 ? 'no keyword overlap' :
            overlap.length === 1 && overlap[0].length < 5 ? 'only 1 short keyword overlap (need 2+ or 1 distinctive)' :
            'unknown'
        };
      });
      return {
        sku: p.sku,
        parent_sku: p.parent_sku,
        title: p.title,
        title_keywords: titleKwArr,
        candidate_campaigns_count: candidateCampaigns.length,
        traced: traced
      };
    });
    res.json({
      totalRecentCampaigns: recentCampaigns.length,
      products: results
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/amazon/products
app.get('/api/amazon/products', async function(req, res) {
  if (!db) return res.json({ products: [] });
  try {
    // r14: View filter — 'active' (default) | 'dormant' | 'all' | 'gaps' | 'hidden'
    // Backwards compat: ?include=all still works.
    const view = (req.query.view || (req.query.include === 'all' ? 'all' : 'active')).toLowerCase();

    // r16: load hidden parent_skus once
    const hiddenRes = await db.query("SELECT parent_sku FROM hidden_products");
    const hiddenSet = new Set(hiddenRes.rows.map(function(r){ return r.parent_sku; }));

    // 1. Pull all SKUs (with status/title/asin/parent/owner)
    const productsRes = await db.query(
      "SELECT sku, asin, title, status, image_url, parent_sku, variation_theme, owner_agent, COALESCE(owner_manual,FALSE) AS owner_manual " +
      "FROM amazon_products " +
      "WHERE status IS NULL OR status NOT LIKE '%REMOVED%' " +
      "ORDER BY COALESCE(parent_sku, sku), sku"
    );

    // 2. Sales last 7 days, by ASIN and by SKU (we use both for matching)
    const salesRes = await db.query(
      "SELECT i.asin, i.sku, SUM(i.item_price * i.quantity) AS revenue, SUM(i.quantity) AS units " +
      "FROM amazon_order_items i " +
      "JOIN amazon_orders o ON o.order_id = i.order_id " +
      "WHERE o.purchase_date >= NOW() - INTERVAL '7 days' " +
      "AND o.status NOT IN ('Cancelled','Canceled') " +
      "GROUP BY i.asin, i.sku"
    );
    const salesByAsin = {};
    const salesBySku = {};
    salesRes.rows.forEach(function(row) {
      if (row.asin) salesByAsin[row.asin] = { revenue: parseFloat(row.revenue || 0), units: parseInt(row.units || 0) };
      if (row.sku) salesBySku[row.sku] = { revenue: parseFloat(row.revenue || 0), units: parseInt(row.units || 0) };
    });

    // r20: Pricing signals cache + traffic snapshots — load once for the whole request.
    // Stale > 36h → treated as missing on the UI side. Buy Box rolling 7d avg here.
    const STALE_HOURS = 36;
    const signalsRes = await db.query(
      "SELECT asin, your_price, lowest_competitor_price, price_vs_lowest, " +
      "reviews_count, reviews_avg, last_content_update, fulfillable_qty, velocity_30d, stock_cover_days, " +
      "fulfillment_mode, fetched_at, " +
      "(EXTRACT(EPOCH FROM (NOW() - fetched_at)) / 3600) AS age_hours " +
      "FROM amazon_pricing_signals"
    );
    const signalsByAsin = {};
    signalsRes.rows.forEach(function(s) {
      const stale = parseFloat(s.age_hours || 0) > STALE_HOURS;
      signalsByAsin[s.asin] = {
        your_price: stale ? null : (s.your_price != null ? parseFloat(s.your_price) : null),
        lowest_competitor_price: stale ? null : (s.lowest_competitor_price != null ? parseFloat(s.lowest_competitor_price) : null),
        price_vs_lowest: stale ? null : (s.price_vs_lowest != null ? parseFloat(s.price_vs_lowest) : null),
        reviews_count: stale ? null : (s.reviews_count != null ? parseInt(s.reviews_count) : null),
        reviews_avg: stale ? null : (s.reviews_avg != null ? parseFloat(s.reviews_avg) : null),
        last_content_update: stale ? null : s.last_content_update,
        fulfillable_qty: stale ? null : (s.fulfillable_qty != null ? parseInt(s.fulfillable_qty) : null),
        velocity_30d: stale ? null : (s.velocity_30d != null ? parseFloat(s.velocity_30d) : null),
        stock_cover_days: stale ? null : (s.stock_cover_days != null ? parseFloat(s.stock_cover_days) : null),
        fulfillment_mode: stale ? null : (s.fulfillment_mode || null),  // r20d
        signals_stale: stale
      };
    });
    // Buy Box win % rolling 7-day avg per ASIN, plus days-of-data so the UI can
    // show "Building (N/7d)" until the window is full.
    const trafficRes = await db.query(
      "SELECT asin, AVG(buy_box_pct) AS buy_box_avg, COUNT(*) AS days " +
      "FROM amazon_traffic_snapshots " +
      "WHERE report_date >= CURRENT_DATE - INTERVAL '7 days' AND buy_box_pct IS NOT NULL " +
      "GROUP BY asin"
    );
    const trafficByAsin = {};
    trafficRes.rows.forEach(function(t) {
      trafficByAsin[t.asin] = {
        buy_box_pct_7d: t.buy_box_avg != null ? parseFloat(parseFloat(t.buy_box_avg).toFixed(1)) : null,
        buy_box_days: parseInt(t.days || 0)
      };
    });

    // r13: Active-window check — has the ASIN sold in last 60 days?
    const recentAsinsRes = await db.query(
      "SELECT DISTINCT i.asin FROM amazon_order_items i " +
      "JOIN amazon_orders o ON o.order_id = i.order_id " +
      "WHERE o.purchase_date >= NOW() - INTERVAL '60 days' " +
      "AND o.status NOT IN ('Cancelled','Canceled') " +
      "AND i.asin IS NOT NULL"
    );
    const activeAsins = new Set();
    recentAsinsRes.rows.forEach(function(r){ if (r.asin) activeAsins.add(r.asin); });

    // 3. Advertised ASINs from snapshots (last 7d)
    const snapshotsRes = await db.query(
      "SELECT campaigns FROM daily_snapshots WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days'"
    );
    const advertisedAsins = new Set();
    const autoCampaignsExist = { value: false };
    snapshotsRes.rows.forEach(function(snap) {
      const camps = snap.campaigns || [];
      camps.forEach(function(c) {
        if ((c.targetingType || '').toLowerCase() === 'auto') autoCampaignsExist.value = true;
        const targets = c.targets || c.asins || c.targetedAsins || [];
        if (Array.isArray(targets)) {
          targets.forEach(function(t) {
            const asin = (typeof t === 'string') ? t : (t && (t.asin || t.value));
            if (asin && /^B[0-9A-Z]{9}$/.test(asin)) advertisedAsins.add(asin);
          });
        }
      });
    });

    // r25b: ALSO mark any ASIN with actual ad spend in last 7 days as "in a campaign".
    // This catches auto-targeted campaigns where the ASIN isn't listed as a target
    // but Amazon's ad report still shows spend on it. Without this, kettlebell-style
    // products show "0 of N ASINs in ads" even when they're getting active ad spend
    // from auto campaigns — and coverage shows 0% misleadingly.
    try {
      const adPerfRes = await db.query(
        "SELECT DISTINCT asin FROM amazon_asin_ad_performance " +
        "WHERE report_date >= CURRENT_DATE - INTERVAL '7 days' AND spend > 0"
      );
      adPerfRes.rows.forEach(function(r) {
        if (r.asin && /^B[0-9A-Z]{9}$/.test(r.asin)) advertisedAsins.add(r.asin);
      });
    } catch(e) {
      // Table may not exist on very old deployments — non-fatal
      if (!/does not exist/.test(e.message)) console.error('[r25b] ad-perf coverage augment error: ' + e.message);
    }

    // 3b. Recent campaigns (deduped) for spend/sales/ACOS aggregation
    const seenCamp = new Set();
    const recentCampaigns = [];
    snapshotsRes.rows.forEach(function(snap) {
      (snap.campaigns || []).forEach(function(c) {
        if (c.campaignId && !seenCamp.has(c.campaignId)) { seenCamp.add(c.campaignId); recentCampaigns.push(c); }
      });
    });

    // ── r13: NEW GROUPING LOGIC ──────────────────────────────────────────────
    // Build "asinGroup" — one entry per ASIN. All SKUs sharing an ASIN merge here.
    // This collapses the FBA/FBM duplicate SKU problem.
    const asinGroup = {}; // asin -> { skus:[], title, image, status_set, owner... }
    const noAsinGroup = {}; // SKUs that have no ASIN at all (rare): keyed by sku
    productsRes.rows.forEach(function(p) {
      if (p.asin) {
        if (!asinGroup[p.asin]) {
          asinGroup[p.asin] = {
            asin: p.asin,
            skus: [],
            titles: [],
            image_url: null,
            statuses: new Set(),
            parent_skus: new Set(),
            owner_agent: null,
            owner_manual: false,
            variation_theme: null
          };
        }
        const g = asinGroup[p.asin];
        g.skus.push(p.sku);
        if (p.title) g.titles.push(p.title);
        if (p.image_url && !g.image_url) g.image_url = p.image_url;
        if (p.status) g.statuses.add(String(p.status).toUpperCase());
        if (p.parent_sku) g.parent_skus.add(p.parent_sku);
        if (p.owner_agent && !g.owner_agent) g.owner_agent = p.owner_agent;
        if (p.owner_manual) g.owner_manual = true;
        if (p.variation_theme && !g.variation_theme) g.variation_theme = p.variation_theme;
      } else {
        // SKU with no ASIN — treat as own row
        noAsinGroup[p.sku] = p;
      }
    });

    // ── Now build "parent product" rollups: by parent_sku for variants, otherwise by ASIN.
    // groupKey = parent_sku if any SKU in the ASIN group has one; else the ASIN itself.
    // This way: 12kg-FBA + 12kg-Amazon (same ASIN) → one row, AND multiple ASINs that share a parent_sku → one row.
    const parents = {};
    Object.values(asinGroup).forEach(function(g) {
      // Pick a group key: use parent_sku if available, else the ASIN
      const parentSku = Array.from(g.parent_skus)[0] || null;
      const groupKey = parentSku || ('asin:' + g.asin);
      if (!parents[groupKey]) {
        parents[groupKey] = {
          parent_sku: groupKey,
          title: null,
          variation_theme: null,
          children: [],
          image_url: null,
          standalone: !parentSku,
          owner_agent: null,
          owner_manual: false,
          buyable_count: 0,
          inactive_count: 0,
          asins: new Set()
        };
      }
      const parent = parents[groupKey];
      // Pick the longest title (usually most descriptive)
      const longestTitle = g.titles.sort(function(a,b){ return b.length - a.length; })[0] || '';
      if (!parent.title || longestTitle.length > parent.title.length) parent.title = longestTitle;
      if (!parent.image_url && g.image_url) parent.image_url = g.image_url;
      if (!parent.variation_theme && g.variation_theme) parent.variation_theme = g.variation_theme;
      if (!parent.owner_agent && g.owner_agent) parent.owner_agent = g.owner_agent;
      if (g.owner_manual) parent.owner_manual = true;
      // Status: count BUYABLE / INACTIVE per ASIN group
      const isBuyable = g.statuses.has('BUYABLE') || Array.from(g.statuses).some(function(s){ return s.indexOf('BUYABLE') !== -1; });
      const isInactive = Array.from(g.statuses).some(function(s){ return s.indexOf('INACTIVE') !== -1 || s.indexOf('SUSPENDED') !== -1; });
      if (isBuyable) parent.buyable_count++;
      if (isInactive && !isBuyable) parent.inactive_count++;
      // Child = the ASIN-group itself, NOT each SKU. SKU detail moves to drilldown.
      const childSales = salesByAsin[g.asin] || { revenue: 0, units: 0 };
      // Sum sales across all SKUs that map to this ASIN (in case orders attribute by SKU)
      g.skus.forEach(function(sku) {
        if (salesBySku[sku] && (!salesByAsin[g.asin] || salesBySku[sku].revenue !== childSales.revenue)) {
          // Already covered by ASIN aggregate; skip
        }
      });
      parent.asins.add(g.asin);
      parent.children.push({
        asin: g.asin,
        skus: g.skus,           // all the SKUs that share this ASIN (e.g. FBA + FBM)
        sku_count: g.skus.length,
        status: Array.from(g.statuses).join(','),
        in_campaign: advertisedAsins.has(g.asin),
        active_60d: activeAsins.has(g.asin),
        sales_7d: childSales.revenue,
        units_7d: childSales.units,
        image_url: g.image_url
      });
    });

    // ─── r20c: Campaign matcher REMOVED ──────────────────────────────────────
    // The TF-IDF + parseCampaignName + isCampaignMatch logic that joined campaigns
    // to product groups is gone. Reasons:
    //   - Campaign names in the catalog are inconsistent ("Vibration Plate Auto"
    //     vs "Satyam | Vibration Plate" vs raw ASIN-targeted) and the matcher
    //     produced too many false positives.
    //   - Bobby is going to provide manual ASIN→campaign mapping in a future
    //     revision instead.
    // What this means for the API response:
    //   - Each parent now returns camp_spend_7d=0, camp_count=0, campaigns=[]
    //   - The diagnosis function still works — it has rule-based cases that
    //     don't depend on per-product campaign attribution.
    //   - The wasted-by-agent and ad-spend totals on the dashboard come from
    //     /api/wasted-by-agent (server-side prefix parsing), not from this join.
    // To revive: the original block lived between this comment and the next
    // section header. It used parseCampaignName (still in this file at the
    // bottom), extractTitleKeywords, isCampaignMatch, and an IDF table. Pull
    // from r20b commit if needed.
    // r21→r22: Manual mapping was tried and stripped (architecturally wrong —
    // multiple listings of same product can share campaigns). Replaced with
    // r22 advertisedProduct report which gives true ASIN-level spend from
    // Amazon Ads. Stats below come from amazon_asin_ad_performance keyed by
    // ASIN, aggregated per parent product. See r22 cron block.
    const groupCampaignStats = {};
    try {
      // Pull last-7-day per-ASIN ad metrics from r22 advertisedProduct table.
      // Each ASIN's spend gets attributed to its parent product.
      const adRes = await db.query(
        "SELECT asin, " +
        "       SUM(spend) AS spend, SUM(sales) AS sales, " +
        "       SUM(clicks) AS clicks, SUM(impressions) AS impressions, " +
        "       SUM(units) AS conversions, " +
        "       COUNT(DISTINCT campaign_id) AS campaign_count, " +
        "       array_agg(DISTINCT campaign_id) AS campaign_ids " +
        "FROM amazon_asin_ad_performance " +
        "WHERE report_date >= CURRENT_DATE - INTERVAL '7 days' " +
        "GROUP BY asin"
      );
      // Build parent-level aggregates by walking each parent's children ASINs
      Object.values(parents).forEach(function(parent) {
        const parentSku = parent.parent_sku;
        const childAsins = parent.children.map(function(c){ return c.asin; }).filter(Boolean);
        if (!childAsins.length) return;
        let g = { spend: 0, sales: 0, clicks: 0, impressions: 0, conversions: 0, count: 0, campaigns: [] };
        const seenCampaigns = new Set();
        adRes.rows.forEach(function(r){
          if (childAsins.indexOf(r.asin) === -1) return;
          g.spend += parseFloat(r.spend || 0);
          g.sales += parseFloat(r.sales || 0);
          g.clicks += parseInt(r.clicks || 0);
          g.impressions += parseInt(r.impressions || 0);
          g.conversions += parseInt(r.conversions || 0);
          (r.campaign_ids || []).forEach(function(cid){ if (cid) seenCampaigns.add(cid); });
        });
        g.count = seenCampaigns.size;
        if (g.count > 0 || g.spend > 0) groupCampaignStats[parentSku] = g;
      });
    } catch(e) {
      // If amazon_asin_ad_performance doesn't exist yet (pre-r22 boot), table
      // creation hasn't run — fall through to empty stats. Cards will show £0.
      if (!/does not exist/.test(e.message)) console.error('[r22] ASIN ad perf aggregation: ' + e.message);
    }

    // r22: pre-fetch active tasks keyed by parent_sku so cards can show
    // "🛠 Already assigned to X" badge and block double-assign.
    const activeTaskByParent = {};
    try {
      const tRes = await db.query(
        "SELECT id, campaign_id, agent_name, status FROM campaign_tasks " +
        "WHERE status NOT IN ('complete','archived','dismissed') " +
        "AND campaign_id LIKE 'product:%'"
      );
      tRes.rows.forEach(function(t){
        const parentSku = t.campaign_id.replace(/^product:/, '');
        // Last write wins if there are duplicates (shouldn't happen — we block in r22)
        activeTaskByParent[parentSku] = { id: t.id, agent_name: t.agent_name, status: t.status };
      });
    } catch(e) { console.error('[r22] active-task lookup error: ' + e.message); }

    // r23: product snooze removed — snooze is now on campaigns only.
    const snoozeByParent = {};

    // 5. Compute per-parent aggregates + diagnosis
    let allParents = Object.values(parents).map(function(parent) {
      const totalSales = parent.children.reduce(function(s, c){ return s + (c.sales_7d || 0); }, 0);
      const totalUnits = parent.children.reduce(function(s, c){ return s + (c.units_7d || 0); }, 0);
      const advertisedChildren = parent.children.filter(function(c){ return c.in_campaign; }).length;
      const adCoveragePct = parent.children.length ? Math.round(100 * advertisedChildren / parent.children.length) : 0;
      const cs = groupCampaignStats[parent.parent_sku] || { spend: 0, sales: 0, clicks: 0, impressions: 0, conversions: 0, count: 0, campaigns: [] };
      const acos = cs.sales > 0 ? Math.round((cs.spend / cs.sales) * 1000) / 10 : 0;
      const costPerConv = cs.conversions > 0 ? cs.spend / cs.conversions : null;
      // r13: Activity status — has any child sold in last 60 days?
      const activeRecent = parent.children.some(function(c){ return c.active_60d; });

      // r20: aggregate signals across ASINs in this parent group.
      // Strategy:
      //   - Buy Box %: weighted avg by sessions if available, else simple avg.
      //   - Stock cover: SUM of fulfillable_qty / SUM of velocity_30d.
      //   - Reviews: sum count, weighted-avg rating by count.
      //   - Price vs lowest: take the primary (highest-revenue) child's value.
      //   - Last content update: NEWEST across children (r20d fix — was oldest,
      //     which made every multi-ASIN parent look stale unfairly).
      //   - Fulfillment mode: 'mixed' if any child differs, else single mode.
      const childAsins = parent.children.map(function(c){ return c.asin; }).filter(Boolean);
      let bbSum = 0, bbDays = 0, bbCount = 0;
      let invQty = 0, invVel = 0, invHas = false;
      let revSum = 0, revAvgNum = 0, revHas = false;
      let lastUpd = null;
      let staleCount = 0;
      let fulfillmentModes = new Set();   // r20d: collect distinct modes seen across children
      childAsins.forEach(function(asin) {
        const sig = signalsByAsin[asin];
        const tr = trafficByAsin[asin];
        if (sig) {
          if (sig.signals_stale) staleCount++;
          if (sig.fulfillable_qty != null) { invQty += sig.fulfillable_qty; invHas = true; }
          if (sig.velocity_30d != null) invVel += sig.velocity_30d;
          if (sig.reviews_count != null) { revSum += sig.reviews_count; revHas = true; if (sig.reviews_avg != null) revAvgNum += sig.reviews_avg * sig.reviews_count; }
          if (sig.last_content_update) {
            const d = String(sig.last_content_update).slice(0, 10);
            if (!lastUpd || d > lastUpd) lastUpd = d;  // most recent wins
          }
          if (sig.fulfillment_mode) fulfillmentModes.add(sig.fulfillment_mode);
        }
        if (tr && tr.buy_box_pct_7d != null) {
          bbSum += tr.buy_box_pct_7d; bbCount++;
          if (tr.buy_box_days > bbDays) bbDays = tr.buy_box_days;
        }
      });
      // Pick the primary child for price (the ASIN with most 7d revenue)
      let primaryAsin = null, primaryRev = -1;
      parent.children.forEach(function(c) {
        if ((c.sales_7d || 0) > primaryRev) { primaryRev = c.sales_7d || 0; primaryAsin = c.asin; }
      });
      const primarySig = primaryAsin && signalsByAsin[primaryAsin] ? signalsByAsin[primaryAsin] : null;

      const buyBoxPct7d = bbCount > 0 ? parseFloat((bbSum / bbCount).toFixed(1)) : null;
      const stockCoverDays = (invHas && invVel > 0) ? parseFloat((invQty / invVel).toFixed(1)) : null;
      const reviewsCount = revHas ? revSum : null;
      const reviewsAvg = (revHas && revSum > 0) ? parseFloat((revAvgNum / revSum).toFixed(2)) : null;
      // Days since last content update
      let contentAgeDays = null;
      if (lastUpd) {
        const last = new Date(lastUpd + 'T00:00:00');
        contentAgeDays = Math.floor((Date.now() - last.getTime()) / (24*3600*1000));
      }
      // r20d: roll fulfillment modes up to a single label for the parent
      let parentFulfillmentMode = null;
      if (fulfillmentModes.size === 1) {
        parentFulfillmentMode = Array.from(fulfillmentModes)[0];   // 'fba' or 'fbm' or 'mixed'
      } else if (fulfillmentModes.size > 1) {
        parentFulfillmentMode = 'mixed';
      }

      const signals = {
        buy_box_pct_7d: buyBoxPct7d,
        buy_box_days: bbDays,                        // 0..7 — used by UI to show "Building (N/7d)"
        stock_cover_days: stockCoverDays,
        fulfillable_qty: invHas ? invQty : null,
        velocity_30d: invVel || null,
        reviews_count: reviewsCount,
        reviews_avg: reviewsAvg,
        last_content_update: lastUpd,                // YYYY-MM-DD or null
        content_age_days: contentAgeDays,            // null or integer
        your_price: primarySig ? primarySig.your_price : null,
        lowest_competitor_price: primarySig ? primarySig.lowest_competitor_price : null,
        price_vs_lowest: primarySig ? primarySig.price_vs_lowest : null,
        fulfillment_mode: parentFulfillmentMode,     // r20d
        signals_stale_count: staleCount
      };

      const dx = computeAmazonDiagnosis({
        parent: parent,
        totalSales: totalSales,
        totalUnits: totalUnits,
        adCoveragePct: adCoveragePct,
        advertisedChildren: advertisedChildren,
        totalChildren: parent.children.length,
        campaignSpend: cs.spend,
        campaignSales: cs.sales,
        acos: acos,
        campaignCount: cs.count,
        autoCampaignsExist: autoCampaignsExist.value,
        signals: signals
      });
      // r20c: derive bucket from priority for the new tab UI.
      // 1 = urgent (red), 2 = underperforming (amber), 3+ = working (green).
      // Coverage gaps are folded into underperforming (was a separate tab pre-r20c).
      let bucket;
      if (dx.priority === 1) bucket = 'urgent';
      else if (dx.priority === 2) bucket = 'underperforming';
      else bucket = 'working';
      // Coverage gap absorption — if a buyable active product has < 100% ad
      // coverage AND has sales, it's an underperformer regardless of priority.
      const isActive = parent.buyable_count > 0 && parent.children.some(function(c){ return c.active_60d; });
      if (isActive && (totalSales > 50) && adCoveragePct < 100 && bucket === 'working') {
        bucket = 'underperforming';
      }
      return Object.assign({}, parent, {
        asins: Array.from(parent.asins),
        total_sales_7d: parseFloat(totalSales.toFixed(2)),
        total_units_7d: totalUnits,
        ad_coverage_pct: adCoveragePct,
        advertised_children: advertisedChildren,
        total_children: parent.children.length,
        camp_spend_7d: parseFloat(cs.spend.toFixed(2)),
        camp_sales_7d: parseFloat(cs.sales.toFixed(2)),
        camp_clicks_7d: cs.clicks,
        camp_impressions_7d: cs.impressions,
        camp_conversions_7d: cs.conversions,
        camp_count: cs.count,
        // r25b: TACOS = total ad spend / total sales (using Shopify truth, not just
        // Amazon-attributed). Shows real cost-of-sales including organic sales
        // benefiting from the ads. ACOS uses ad-attributed sales only — TACOS uses ALL
        // sales, which is what tells you whether ads are economically worthwhile.
        tacos_pct: (totalSales > 0 && cs.spend > 0) ? parseFloat((100 * cs.spend / totalSales).toFixed(1)) : null,
        campaigns: cs.campaigns || [],
        acos: acos,
        cost_per_conv: costPerConv != null ? parseFloat(costPerConv.toFixed(2)) : null,
        active_60d: activeRecent,
        priority: dx.priority,
        bucket: bucket,
        diagnosis: dx.diagnosis,
        action: dx.action,
        evidence: dx.evidence || null,  // r20c: short evidence line for card subtitle
        signals: signals,
        // r22: active task block (so card can show "🛠 Already assigned" badge)
        active_task: activeTaskByParent[parent.parent_sku] || null,
        // r22: snooze state — if snoozed, set so frontend can hide from Underperforming
        snooze: snoozeByParent[parent.parent_sku] || null
      });
    });

    // 6. Active filter — Rule 2 from the spec.
    // Active = has at least one BUYABLE listing AND has sold in last 60 days.
    // r16: hidden products excluded from all views except 'hidden' itself.
    const visibleParents = allParents.filter(function(p){ return !hiddenSet.has(p.parent_sku); });
    const hiddenParents = allParents.filter(function(p){ return hiddenSet.has(p.parent_sku); });
    const activeProducts = visibleParents.filter(function(p){
      return p.buyable_count > 0 && p.active_60d;
    });
    const dormantProducts = visibleParents.filter(function(p){
      return !(p.buyable_count > 0 && p.active_60d);
    });

    // r14: three-way view selector + r15: 'gaps' filter + r16: 'hidden' filter
    // r20c: new bucket-based views — urgent / underperforming / working — plus
    // 'all' / 'hidden' kept. Old 'active' / 'dormant' / 'gaps' stay for any older
    // bookmarks but route to the new buckets.
    let returnList;
    if (view === 'dormant') returnList = dormantProducts;
    else if (view === 'all') returnList = visibleParents;
    else if (view === 'hidden') returnList = hiddenParents;
    else if (view === 'urgent') returnList = activeProducts.filter(function(p){ return p.bucket === 'urgent'; });
    else if (view === 'underperforming' || view === 'gaps') returnList = activeProducts.filter(function(p){ return p.bucket === 'underperforming'; });
    else if (view === 'working') returnList = activeProducts.filter(function(p){ return p.bucket === 'working'; });
    else returnList = activeProducts;  // default 'active' = legacy alias
    returnList.sort(function(a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Sort by waste-spend descending: highest spend with worst ACOS comes first.
      // For zero-sales items, total spend itself is the waste signal.
      const aWaste = (a.camp_spend_7d || 0) - (a.camp_sales_7d || 0) * 0;
      const bWaste = (b.camp_spend_7d || 0) - (b.camp_sales_7d || 0) * 0;
      if (Math.abs(aWaste - bWaste) > 0.5) return bWaste - aWaste;
      return b.total_sales_7d - a.total_sales_7d;
    });

    // r20c: per-bucket counts in summary so tabs can show badges
    const allActive = activeProducts;
    const urgentCount = allActive.filter(function(p){ return p.bucket === 'urgent'; }).length;
    const underCount = allActive.filter(function(p){ return p.bucket === 'underperforming'; }).length;
    const workingCount = allActive.filter(function(p){ return p.bucket === 'working'; }).length;

    res.json({
      products: returnList,
      summary: {
        total_parents_all: visibleParents.length,
        total_parents_active: activeProducts.length,
        total_parents_dormant: dormantProducts.length,
        total_parents_hidden: hiddenParents.length,
        total_skus: productsRes.rows.length,
        auto_campaigns_exist: autoCampaignsExist.value,
        advertised_asins_count: advertisedAsins.size,
        unassigned_count: returnList.filter(function(p){ return !p.owner_agent; }).length,
        urgent_count: urgentCount,                         // r20c: bucket counts
        underperforming_count: underCount,                  // r20c
        working_count: workingCount,                        // r20c
        attention_count: returnList.filter(function(p){ return p.priority === 2; }).length,  // legacy
        scale_count: returnList.filter(function(p){ return p.priority === 3; }).length,      // legacy
        view: view
      }
    });
  } catch(e) {
    console.error('/api/amazon/products error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── r13: Amazon listing critique (AI) ──────────────────────────────────────
// GET /api/amazon/listing-critique?asin=B...&cachedOnly=1
//   - cachedOnly=1 returns cached result or null
//   - omit cachedOnly: if cache <24h old, returns it; else returns null
// POST /api/amazon/listing-critique  body: { asin, groupKey, forceRefresh }
//   - Fetches the live Amazon page, calls Claude with Amazon-specific prompt,
//     stores result in amazon_critiques. Returns the critique JSON.
//
// The prompt is Amazon-specific: title/keyword analysis, bullet structure,
// pricing across variants, ad-attribution, search-term relevance.

app.get('/api/amazon/listing-critique', async function(req, res) {
  if (!db) return res.json({ critique: null });
  const asin = String(req.query.asin || '');
  const cachedOnly = req.query.cachedOnly === '1' || req.query.cachedOnly === 'true';
  if (!/^B[0-9A-Z]{9}$/.test(asin)) return res.status(400).json({ error: 'invalid asin' });
  try {
    const r = await db.query("SELECT critique, cached_at FROM amazon_critiques WHERE asin = $1", [asin]);
    if (!r.rows.length) {
      if (cachedOnly) return res.json({ critique: null });
      return res.json({ critique: null });
    }
    const row = r.rows[0];
    const ageMs = Date.now() - new Date(row.cached_at).getTime();
    if (cachedOnly || ageMs < 24 * 3600 * 1000) {
      return res.json({ critique: row.critique, cached_at: row.cached_at });
    }
    res.json({ critique: null, cached_at: row.cached_at, expired: true });
  } catch(e) {
    console.error('/api/amazon/listing-critique GET: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/amazon/listing-critique', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  const asin = String((req.body && req.body.asin) || '');
  const groupKey = String((req.body && req.body.groupKey) || '');
  // r14b: allow caller to choose model — 'haiku' (default, ~£0.01) or 'opus' (deep dive, ~£0.05-0.10)
  // r15: Opus is restricted to owner+manager roles for cost control.
  const requestedModel = String((req.body && req.body.model) || 'haiku').toLowerCase();
  if (requestedModel === 'opus') {
    const userRole = (req.user && (req.user.role || '').toLowerCase()) || '';
    const userDept = (req.user && (req.user.department || '').toLowerCase()) || '';
    const isPrivileged = ['owner','manager'].indexOf(userRole) !== -1 || userDept === 'manager';
    if (!isPrivileged) return res.status(403).json({ error: 'Deep Dive (Opus) is restricted to managers and owner. Use Haiku critique instead.' });
  }
  const modelId = requestedModel === 'opus' ? 'claude-opus-4-5-20251101' : 'claude-haiku-4-5-20251001';
  if (!/^B[0-9A-Z]{9}$/.test(asin)) return res.status(400).json({ error: 'invalid asin' });
  try {
    const result = await runListingCritique(asin, groupKey, modelId);
    res.json(result);
  } catch(e) {
    console.error('/api/amazon/listing-critique POST: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// r14b: extracted helper so bulk mode can call it. Returns { critique, cached_at, model }.
async function runListingCritique(asin, groupKey, modelId) {
  // Pull product context from our DB — title, status, price, ad performance for the parent group
  const prodRes = await db.query(
    "SELECT sku, asin, title, status, image_url, parent_sku, owner_agent FROM amazon_products WHERE asin = $1 OR parent_sku = $2 OR sku = $2",
    [asin, groupKey]
  );
  if (!prodRes.rows.length) throw new Error('product not found');
  const primary = prodRes.rows.find(function(r){ return r.asin === asin; }) || prodRes.rows[0];
  const allTitles = Array.from(new Set(prodRes.rows.map(function(r){ return r.title; }).filter(Boolean)));
  const childAsins = Array.from(new Set(prodRes.rows.map(function(r){ return r.asin; }).filter(Boolean)));
  const inactiveCount = prodRes.rows.filter(function(r){ return (r.status || '').indexOf('INACTIVE') !== -1 || (r.status || '').indexOf('SUSPENDED') !== -1; }).length;
  const buyableCount = prodRes.rows.filter(function(r){ return (r.status || '').indexOf('BUYABLE') !== -1; }).length;

    // Sales data
    const salesRes = await db.query(
      "SELECT SUM(i.item_price * i.quantity) AS revenue, SUM(i.quantity) AS units, COUNT(DISTINCT i.order_id) AS orders " +
      "FROM amazon_order_items i JOIN amazon_orders o ON o.order_id = i.order_id " +
      "WHERE i.asin = ANY($1) AND o.purchase_date >= NOW() - INTERVAL '30 days' AND o.status NOT IN ('Cancelled','Canceled')",
      [childAsins]
    );
    const sales30d = salesRes.rows[0] || {};

    // r20: Pull operational signals from cache + 7d Buy Box from traffic snapshots.
    // These feed into the AI prompt so the critique reasons about pricing, stock,
    // reviews, content age, and Buy Box win % alongside title/bullets/A+.
    let signalsContext = '';
    let signalsHash = '';
    try {
      const sigRows = await db.query(
        "SELECT asin, your_price, lowest_competitor_price, price_vs_lowest, " +
        "reviews_count, reviews_avg, last_content_update, fulfillable_qty, velocity_30d, stock_cover_days, fetched_at " +
        "FROM amazon_pricing_signals WHERE asin = ANY($1)", [childAsins]
      );
      const trRows = await db.query(
        "SELECT asin, AVG(buy_box_pct) AS buy_box_avg, COUNT(*) AS days " +
        "FROM amazon_traffic_snapshots " +
        "WHERE asin = ANY($1) AND report_date >= CURRENT_DATE - INTERVAL '7 days' AND buy_box_pct IS NOT NULL " +
        "GROUP BY asin", [childAsins]
      );
      const primarySig = sigRows.rows.find(function(r){ return r.asin === asin; }) || sigRows.rows[0] || null;
      const primaryTr = trRows.rows.find(function(r){ return r.asin === asin; }) || trRows.rows[0] || null;
      // Aggregate inventory + reviews across the family
      let totalFulfill = 0, totalVel = 0, totalReviewCount = 0, weightedReviewSum = 0;
      let oldestContent = null;
      sigRows.rows.forEach(function(r){
        if (r.fulfillable_qty != null) totalFulfill += parseInt(r.fulfillable_qty);
        if (r.velocity_30d != null) totalVel += parseFloat(r.velocity_30d);
        if (r.reviews_count != null) {
          totalReviewCount += parseInt(r.reviews_count);
          if (r.reviews_avg != null) weightedReviewSum += parseFloat(r.reviews_avg) * parseInt(r.reviews_count);
        }
        if (r.last_content_update) {
          const d = String(r.last_content_update).slice(0, 10);
          if (!oldestContent || d < oldestContent) oldestContent = d;
        }
      });
      const familyStockCover = totalVel > 0 ? (totalFulfill / totalVel).toFixed(1) : null;
      const familyReviewAvg = totalReviewCount > 0 ? (weightedReviewSum / totalReviewCount).toFixed(2) : null;
      const contentAge = oldestContent ? Math.floor((Date.now() - new Date(oldestContent + 'T00:00:00').getTime()) / (24*3600*1000)) : null;
      // Build hash for cache invalidation: one-line digest of all values
      const hashSrc = [
        primarySig ? primarySig.your_price : 'np',
        primarySig ? primarySig.lowest_competitor_price : 'nlc',
        familyStockCover, totalReviewCount, familyReviewAvg, contentAge,
        primaryTr ? primaryTr.buy_box_avg : 'nbb', primaryTr ? primaryTr.days : '0'
      ].join('|');
      signalsHash = require('crypto').createHash('md5').update(hashSrc).digest('hex').slice(0, 12);
      // r20c: build signals context line-by-line, OMITTING any signal that's null.
      // This stops the prompt from instructing the model to reason about Buy Box
      // (etc.) when we have no data — which previously led the model to invent
      // numbers or make generic comments. Reviews dropped entirely (SP-API
      // returns null for FK Sports' catalog and the live-page scrape gave the
      // wrong number — 8000 instead of 700 because it was the variation rollup).
      const lines = [];
      if (primaryTr && primaryTr.buy_box_avg != null) {
        lines.push('Buy Box win % (last 7 days): ' + parseFloat(primaryTr.buy_box_avg).toFixed(1) + '% (' + primaryTr.days + ' days of data)');
      }
      if (primarySig && primarySig.your_price != null) {
        lines.push('Your price: £' + parseFloat(primarySig.your_price).toFixed(2));
      }
      if (primarySig && primarySig.lowest_competitor_price != null) {
        lines.push('Lowest competitor (new): £' + parseFloat(primarySig.lowest_competitor_price).toFixed(2));
        if (primarySig.price_vs_lowest != null) {
          lines.push('Price vs lowest competitor: ' + (primarySig.price_vs_lowest >= 0 ? '+£' : '-£') + Math.abs(parseFloat(primarySig.price_vs_lowest)).toFixed(2) + ' (positive = we are more expensive)');
        }
      }
      // r21: stock cover removed from critique context — data unreliable from
      // SP-API (FBM availability patchy, FBA inventory often shows 0 for
      // products with active warehouse stock). Re-enable when fix lands.
      // if (familyStockCover != null) {
      //   lines.push('Stock cover: ' + familyStockCover + ' days (' + totalFulfill + ' units fulfillable, ' + totalVel.toFixed(1) + ' units/day velocity)');
      // }
      if (oldestContent) {
        lines.push('Last content update: ' + oldestContent + ' (' + contentAge + ' days ago)' + (contentAge > 90 ? ' STALE' : ''));
      }
      if (lines.length) {
        signalsContext = '\n--- Operational signals (SP-API) ---\n' + lines.join('\n') + '\n';
      } else {
        signalsContext = '\n--- Operational signals (SP-API) ---\n(no signals available — assume nothing about Buy Box, stock, pricing, or reviews)\n';
      }
    } catch(e) { console.error('[amz-critique] signals context error: ' + e.message); }

    // r22: Per-ASIN ad performance — pulled from amazon_asin_ad_performance.
    // This is the core "are we wasting money?" signal. Summed across child ASINs
    // for the family card, last 7 days. Does NOT explode response size — it
    // adds one summary block to the prompt, not per-ASIN-bullets.
    let adPerfContext = '';
    try {
      if (childAsins.length > 0) {
        const adRes = await db.query(
          "SELECT asin, " +
          "       SUM(spend) AS spend, SUM(sales) AS sales, " +
          "       SUM(clicks) AS clicks, SUM(impressions) AS impressions, " +
          "       SUM(orders) AS orders, " +
          "       COUNT(DISTINCT campaign_id) AS campaign_count " +
          "FROM amazon_asin_ad_performance " +
          "WHERE asin = ANY($1) AND report_date >= CURRENT_DATE - INTERVAL '7 days' " +
          "GROUP BY asin",
          [childAsins]
        );
        let famSpend = 0, famSales = 0, famClicks = 0, famImpr = 0, famOrders = 0, famCampSet = new Set();
        const perAsinSummary = [];
        adRes.rows.forEach(function(r){
          famSpend += parseFloat(r.spend || 0);
          famSales += parseFloat(r.sales || 0);
          famClicks += parseInt(r.clicks || 0);
          famImpr += parseInt(r.impressions || 0);
          famOrders += parseInt(r.orders || 0);
          famCampSet.add(r.asin); // for unique advertised-ASIN count
          // Per-ASIN one-liner only if >1 ASIN advertised (otherwise redundant with totals)
          if (childAsins.length > 1) {
            perAsinSummary.push('  ' + r.asin + ': £' + parseFloat(r.spend||0).toFixed(2) + ' spend, £' + parseFloat(r.sales||0).toFixed(2) + ' sales, ' + r.orders + ' orders');
          }
        });
        if (famSpend > 0 || famImpr > 0) {
          const ctr = famImpr > 0 ? (famClicks / famImpr * 100).toFixed(2) : '—';
          const cvr = famClicks > 0 ? (famOrders / famClicks * 100).toFixed(2) : '—';
          const acos = famSales > 0 ? (famSpend / famSales * 100).toFixed(1) : null;
          const adAcos = acos != null ? acos + '%' : 'N/A (zero attributed sales)';
          adPerfContext = '\n--- Ad performance (last 7 days, per-ASIN aggregated) ---\n' +
            'Total spend: £' + famSpend.toFixed(2) + '\n' +
            'Attributed sales: £' + famSales.toFixed(2) + '\n' +
            'ACOS: ' + adAcos + '\n' +
            'Clicks: ' + famClicks + ' (CTR ' + ctr + '%)\n' +
            'Orders attributed: ' + famOrders + ' (CVR ' + cvr + '%)\n' +
            'Active in ' + adRes.rows.length + ' of ' + childAsins.length + ' child ASIN(s)\n' +
            (perAsinSummary.length ? perAsinSummary.join('\n') + '\n' : '');
        } else {
          adPerfContext = '\n--- Ad performance (last 7 days) ---\n(no ad spend on any child ASIN — product is not being advertised)\n';
        }
      }
    } catch(e) {
      if (!/does not exist/.test(e.message)) console.error('[amz-critique] ad-perf context error: ' + e.message);
    }

    // Try to fetch the live Amazon page (UK)
    let livePageContext = '';
    try {
      const pageRes = await axios.get('https://www.amazon.co.uk/dp/' + asin, {
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-GB,en;q=0.9'
        }
      });
      // Extract a useful slice (full page is huge — clip)
      const html = String(pageRes.data || '');
      // Pull title, bullets, A+ presence, price visibility
      // r20c: live-page review count REMOVED — the regex was matching the
      // variation-family rollup (e.g. 8,432 across all colours/sizes) rather
      // than the current ASIN's count. Reviews now come ONLY from SP-API
      // operational signals if available; otherwise treated as unknown.
      const titleMatch = html.match(/<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/);
      const bulletsMatch = html.match(/<div[^>]*id="feature-bullets"[\s\S]*?<\/div>/);
      const priceMatch = html.match(/class="a-offscreen"[^>]*>([£$€]?[\d,.]+)/);
      const aplusPresent = /aplus-3p-fixed-width|aplus-module/.test(html);
      const titleClean = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '(not found)';
      const bulletsClean = bulletsMatch ? bulletsMatch[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) : '(not found)';
      livePageContext =
        '\n--- Live Amazon page ---\n' +
        'Title on page: ' + titleClean.slice(0, 300) + '\n' +
        'Bullets: ' + bulletsClean.slice(0, 1200) + '\n' +
        'Price visible: ' + (priceMatch ? priceMatch[1] : '(not found)') + '\n' +
        'A+ content present: ' + (aplusPresent ? 'YES' : 'NO') + '\n';
    } catch(e) {
      livePageContext = '\n--- Live Amazon page ---\n(could not fetch — Amazon may have blocked the request)\n';
    }

    // r14b: pull product-relevant search-term data from in-memory keywordState (Advertising API report)
    // We filter to terms whose campaignName matches this product's title keywords (same logic as deriveProductOwners).
    let searchTermContext = '';
    try {
      const titleKw = extractTitleKeywords(allTitles[0] || '');
      if (titleKw.size > 0 && Array.isArray(keywordState && keywordState.data) && keywordState.data.length > 0) {
        // Filter records whose campaignName has ≥2 keyword overlap with this product
        const relevant = keywordState.data.filter(function(r) {
          const campKw = extractTitleKeywords((r.campaignName || ''));
          let overlap = 0;
          campKw.forEach(function(k){ if (titleKw.has(k)) overlap++; });
          return overlap >= 2;
        });
        if (relevant.length > 0) {
          // Top wasted (high spend, zero sales)
          const wasters = relevant
            .filter(function(r){ return parseFloat(r.cost||0) > 1 && parseInt(r.purchases14d||0) === 0; })
            .sort(function(a,b){ return parseFloat(b.cost||0) - parseFloat(a.cost||0); })
            .slice(0, 10);
          // Top converters (most purchases relative to spend)
          const converters = relevant
            .filter(function(r){ return parseInt(r.purchases14d||0) > 0; })
            .sort(function(a,b){ return parseFloat(b.sales14d||0) - parseFloat(a.sales14d||0); })
            .slice(0, 10);
          if (wasters.length || converters.length) {
            searchTermContext = '\n--- Search-term performance (last 7 days, this products campaigns) ---\n';
            if (wasters.length) {
              searchTermContext += 'WASTED SEARCH TERMS (zero sales after spend — candidates for negative keywords):\n';
              wasters.forEach(function(r){
                searchTermContext += '  • "' + r.searchTerm + '" → £' + parseFloat(r.cost||0).toFixed(2) + ' spend, ' + (r.clicks||0) + ' clicks, 0 purchases — campaign: ' + r.campaignName + '\n';
              });
            }
            if (converters.length) {
              searchTermContext += 'CONVERTING SEARCH TERMS (worth amplifying with bid increases or as exact-match keywords):\n';
              converters.forEach(function(r){
                searchTermContext += '  • "' + r.searchTerm + '" → ' + r.purchases14d + ' purchases, £' + parseFloat(r.sales14d||0).toFixed(2) + ' sales, ' + (r.matchType||'') + ' match — campaign: ' + r.campaignName + '\n';
              });
            }
          }
        }
      }
    } catch(e) { console.error('[amz-critique] search-term context error: ' + e.message); }

    // r25b: pull agent feedback for this product (keyed by parent_sku/groupKey)
    let feedbackContext = '';
    try {
      feedbackContext = await buildFeedbackPromptSection('amazon_product', groupKey || asin);
    } catch(e) { /* non-fatal */ }

    // Build the prompt — Amazon-specific
    const prompt = [
      'You are an Amazon Marketplace listing-optimisation expert reviewing an FK Sports product on Amazon UK.',
      '',
      'PRODUCT CONTEXT (from Seller Central / SP-API):',
      'Primary ASIN: ' + asin,
      'Total ASINs in family: ' + childAsins.length,
      'Stored title(s): ' + allTitles.slice(0, 3).join(' || '),
      'Listing status: ' + buyableCount + ' BUYABLE, ' + inactiveCount + ' INACTIVE',
      'Sales last 30 days: £' + parseFloat(sales30d.revenue || 0).toFixed(2) + ', ' + (sales30d.units || 0) + ' units, ' + (sales30d.orders || 0) + ' orders',
      'Owner agent: ' + (primary.owner_agent || 'unassigned'),
      livePageContext,
      signalsContext,
      adPerfContext,
      searchTermContext,
      feedbackContext,
      '',
      'TASK: figure out why this listing might not be selling well and identify the highest-impact fixes. Focus on what is visible from the live page and the operational signals that ARE provided.',
      '',
      'PRIMARY review areas (always do these):',
      '1. Title quality — keyword density (front-loaded important terms?), brand placement, length (~150-200 chars optimal), no stuffing',
      '2. Bullet points — feature vs benefit framing, scanability, keyword inclusion, missing benefits',
      '3. A+ content — is it present? If not, that is a known conversion lift',
      '4. Image quality (qualitative observation only — note if hero image looks weak, lifestyle missing, etc. Do NOT invent image counts — Amazon page does not expose this reliably)',
      '5. Ad performance — review the "Ad performance" block above. If spend > £20 AND attributed sales = £0 over 7 days, that is a P1 wasted-spend problem — diagnose and recommend (likely conversion-rate issue: pricing, listing quality, or targeting). If CTR < 0.3% on 1000+ impressions, the listing is failing to attract clicks — diagnose. If CTR is healthy but CVR is < 5%, the page is failing to convert clicks to orders. If search-term data is also provided, identify wasted-spend terms vs converters.',
      '',
      'CONDITIONAL — only address these when the corresponding data is present in "Operational signals" above:',
      '- Buy Box: if Buy Box win % is given AND below 80%, that is a P1 conversion issue. Diagnose and recommend.',
      '- Pricing: if "Price vs lowest competitor" is given AND positive, recommend a price review.',
      '- Content freshness: if Last content update is given AND > 90 days, recommend refresh.',
      '',
      'CRITICAL RULES — read carefully:',
      '- DO NOT estimate or guess review counts, ratings, Buy Box %, competitor prices, or any other numeric value. If a value is not in the Operational signals block above, treat it as UNKNOWN. Do not say "with X reviews" or "rated Y stars" unless that exact number is in the signals.',
      '- DO NOT invent competitor names, ASINs, or prices.',
      '- Image count, video presence, and review count are NOT reliably extractable from the page — do not state numeric facts about them.',
      '- Be specific where you have data; be silent where you do not.',
      '',
      'Rank fixes by IMPACT. Higher-impact fixes first.',
      '',
      'Return ONLY valid JSON (no markdown fences, no preamble) in this shape:',
      '{',
      '  "summary": "2-3 sentence overall assessment of why this listing may be underperforming",',
      '  "issues": [',
      '    { "title": "Short heading", "severity": "high|medium|low", "problem": "What is wrong (qualitative or specific number from signals only)", "fix": "Specific action to take", "impact": "Estimated effect" }',
      '  ]',
      '}',
      '',
      'Provide 3-7 issues. Be specific (avoid generic advice). If the listing looks broadly fine, say so — fewer issues is acceptable.'
    ].join('\n');

    // Call Claude with the requested model
    const aiRes = await axios.post('https://api.anthropic.com/v1/messages', {
      model: modelId,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 60000
    });

    let critique = null;
    const text = aiRes.data && aiRes.data.content && aiRes.data.content[0] && aiRes.data.content[0].text || '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      critique = JSON.parse(cleaned);
    } catch(parseErr) {
      console.error('[amz-critique] JSON parse failed: ' + parseErr.message);
      throw new Error('AI returned malformed response');
    }

    // Cache result — store the model used + r20 signals hash so a fresh signal
    // pull invalidates the cached critique on next read.
    try {
      const cachePayload = Object.assign({}, critique, { _model: modelId, _signals_hash: signalsHash || null });
      await db.query(
        "INSERT INTO amazon_critiques (asin, critique, cached_at) VALUES ($1, $2, NOW()) " +
        "ON CONFLICT (asin) DO UPDATE SET critique = $2, cached_at = NOW()",
        [asin, JSON.stringify(cachePayload)]
      );
    } catch(e) { console.error('[amz-critique] Cache write failed: ' + e.message); }

    return { critique: critique, cached_at: new Date().toISOString(), model: modelId, signals_hash: signalsHash };
}

// r14b: Bulk critique — runs Haiku-based critique on all active products in background.
// State is held in memory; client polls /api/amazon/listing-critique-batch/status.
const bulkCritiqueState = { running: false, total: 0, done: 0, failed: 0, startedAt: null, finishedAt: null, currentAsin: null };

app.post('/api/amazon/listing-critique-batch', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  if (bulkCritiqueState.running) return res.status(409).json({ error: 'A bulk run is already in progress', state: bulkCritiqueState });

  // Build list of ASINs to critique — active products only (BUYABLE + sold in 60d).
  // We critique one ASIN per parent group (the first child).
  try {
    const productsRes = await db.query(
      "SELECT DISTINCT ON (COALESCE(p.parent_sku, p.sku)) p.asin, p.parent_sku, p.sku " +
      "FROM amazon_products p " +
      "WHERE p.asin IS NOT NULL " +
      "AND (p.status LIKE '%BUYABLE%') " +
      "AND EXISTS (" +
      "  SELECT 1 FROM amazon_order_items i JOIN amazon_orders o ON o.order_id = i.order_id " +
      "  WHERE i.asin = p.asin AND o.purchase_date >= NOW() - INTERVAL '60 days' AND o.status NOT IN ('Cancelled','Canceled')" +
      ")"
    );
    const targets = productsRes.rows.map(function(r){ return { asin: r.asin, groupKey: r.parent_sku || r.sku }; });
    if (targets.length === 0) return res.json({ ok: true, queued: 0, message: 'no active products to critique' });

    bulkCritiqueState.running = true;
    bulkCritiqueState.total = targets.length;
    bulkCritiqueState.done = 0;
    bulkCritiqueState.failed = 0;
    bulkCritiqueState.startedAt = new Date().toISOString();
    bulkCritiqueState.finishedAt = null;
    bulkCritiqueState.currentAsin = null;

    // Fire-and-forget — process serially so we don't hammer the API
    (async function() {
      for (const t of targets) {
        bulkCritiqueState.currentAsin = t.asin;
        try {
          await runListingCritique(t.asin, t.groupKey, 'claude-haiku-4-5-20251001');
          bulkCritiqueState.done++;
        } catch(e) {
          console.error('[bulk-critique] ' + t.asin + ' failed: ' + e.message);
          bulkCritiqueState.failed++;
        }
        // 500ms gap between calls to avoid rate-limit
        await new Promise(function(r){ setTimeout(r, 500); });
      }
      bulkCritiqueState.running = false;
      bulkCritiqueState.finishedAt = new Date().toISOString();
      bulkCritiqueState.currentAsin = null;
      console.log('[bulk-critique] Finished. Done=' + bulkCritiqueState.done + ', Failed=' + bulkCritiqueState.failed);
    })().catch(function(e){
      bulkCritiqueState.running = false;
      bulkCritiqueState.finishedAt = new Date().toISOString();
      console.error('[bulk-critique] Outer fail: ' + e.message);
    });

    res.json({ ok: true, queued: targets.length, state: bulkCritiqueState });
  } catch(e) {
    console.error('/api/amazon/listing-critique-batch: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/amazon/listing-critique-batch/status', function(req, res) {
  res.json(bulkCritiqueState);
});

// ── r16: Hide / unhide for products and campaigns ─────────────────────────
// Hidden items are excluded from the main view and from totals. Anyone can hide/restore.
// They live in dedicated "Hidden" tabs/filters. Independent: product-hide and campaign-hide
// don't affect each other.

// PRODUCTS
app.post('/api/amazon/products/:groupKey/hide', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const groupKey = String(req.params.groupKey || '').trim();
  if (!groupKey) return res.status(400).json({ error: 'groupKey required' });
  const reason = (req.body && req.body.reason) || '';
  const actor = (req.user && req.user.name) || 'unknown';
  try {
    await db.query(
      "INSERT INTO hidden_products (parent_sku, hidden_by, reason) VALUES ($1, $2, $3) " +
      "ON CONFLICT (parent_sku) DO UPDATE SET hidden_by = $2, hidden_at = NOW(), reason = $3",
      [groupKey, actor, reason]
    );
    res.json({ ok: true, hidden: groupKey });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/amazon/products/:groupKey/restore', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const groupKey = String(req.params.groupKey || '').trim();
  try {
    await db.query("DELETE FROM hidden_products WHERE parent_sku = $1", [groupKey]);
    res.json({ ok: true, restored: groupKey });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/amazon/hidden-products', async function(req, res) {
  if (!db) return res.json({ products: [] });
  try {
    const r = await db.query("SELECT parent_sku, hidden_by, hidden_at, reason FROM hidden_products ORDER BY hidden_at DESC");
    res.json({ hidden: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// r17: Create a campaign_task from a product action ("Assign as task" button on product modal)
// Body: { note: string, agent?: string (override owner), problemType?: string }
// r22: Block double-assignment. If this product already has an active task, reject.
//      No-ASIN products: allow task creation if owner/manager (skip critique requirement);
//      agents still need critique, since their workflow depends on the subtasks.
app.post('/api/amazon/products/:groupKey/assign-task', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const groupKey = String(req.params.groupKey || '').trim();
  if (!groupKey) return res.status(400).json({ error: 'groupKey required' });
  const note = String((req.body && req.body.note) || '').trim();
  if (!note) return res.status(400).json({ error: 'Note required' });
  const overrideAgent = req.body && req.body.agent ? String(req.body.agent).trim() : null;
  const problemType = String((req.body && req.body.problemType) || 'product_action').trim();
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  const dept = (req.user && (req.user.department || '').toLowerCase()) || '';
  const isPriv = role === 'owner' || role === 'manager' || dept === 'manager';
  try {
    // r22: gather ALL SKUs for this groupKey, not just one. Pick the best-ASIN row.
    const prodRes = await db.query(
      "SELECT sku, asin, title, owner_agent FROM amazon_products " +
      "WHERE parent_sku = $1 OR (parent_sku IS NULL AND sku = $1) " +
      "ORDER BY (asin IS NULL) ASC, sku ASC",
      [groupKey]
    );
    if (!prodRes.rows.length) return res.status(404).json({ error: 'Product not found' });
    const p = prodRes.rows[0];
    const allAsins = prodRes.rows.map(function(r){ return r.asin; }).filter(Boolean);

    // r22: block double-assignment. If an open task already references this
    // product (by parent_sku in campaign_id, or by any of its ASINs in the
    // problem_detail), don't let another one be created.
    try {
      const existing = await db.query(
        "SELECT id, agent_name, status FROM campaign_tasks " +
        "WHERE status NOT IN ('complete','archived','dismissed') " +
        "AND (campaign_id = $1 OR campaign_id LIKE $2)",
        ['product:' + groupKey, '%' + groupKey + '%']
      );
      if (existing.rows.length > 0) {
        const e = existing.rows[0];
        return res.status(409).json({
          error: 'task_exists',
          message: 'This product already has an active task assigned to ' + (e.agent_name || 'an agent') + ' (status: ' + e.status + '). Mark that task complete before creating a new one.',
          existing_task_id: e.id
        });
      }
    } catch(dupErr) { console.error('[r22] dup-task check error: ' + dupErr.message); }

    // r22: AI critique handling
    //   - If the product has at least one ASIN AND a cached critique → seed subtasks (r21 flow)
    //   - If the product has NO ASIN at all (data quality issue) AND user is owner/manager:
    //       allow task creation without subtasks. The note is the agent's instruction.
    //   - Else: block, ask for critique first.
    let issues = [];
    if (!p.asin && allAsins.length === 0) {
      // No ASIN at all on any sibling row. Owner/manager can override.
      if (!isPriv) {
        return res.status(400).json({
          error: 'no_asin_for_critique',
          message: 'This product has no ASIN, so AI critique cannot run. Ask a manager or owner to assign this task manually with clear instructions.'
        });
      }
      // Owner override: allow task creation, no subtasks. Note is the brief.
    } else {
      const asinForCritique = p.asin || allAsins[0];
      const critRes = await db.query("SELECT critique, cached_at FROM amazon_critiques WHERE asin = $1", [asinForCritique]);
      if (!critRes.rows.length) {
        return res.status(412).json({
          error: 'no_critique',
          message: 'Run AI critique on this product before assigning as a task. Each fix becomes a subtask the agent must complete or dismiss.'
        });
      }
      const critique = critRes.rows[0].critique || {};
      issues = Array.isArray(critique.issues) ? critique.issues : [];
      if (!issues.length) {
        return res.status(412).json({
          error: 'empty_critique',
          message: 'AI critique exists but found no issues to act on. Re-run the critique or pick a different product.'
        });
      }
    }

    const agentName = overrideAgent || p.owner_agent || 'Unassigned';
    const productLabel = (p.title || groupKey).slice(0, 200);
    const r = await db.query(
      "INSERT INTO campaign_tasks (campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, score, task_source) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [
        'product:' + groupKey,
        productLabel,
        agentName,
        '',
        problemType,
        note,
        8,
        'product_action'
      ]
    );
    const taskId = r.rows[0].id;

    // r21: seed subtasks from critique issues. Body = "title — fix" so the agent
    // sees both what's wrong and what to do. Severity is preserved as a prefix.
    let subtaskCount = 0;
    for (let i = 0; i < issues.length; i++) {
      const iss = issues[i] || {};
      const title = String(iss.title || '').trim();
      const fix = String(iss.fix || iss.problem || '').trim();
      const severity = String(iss.severity || '').trim().toLowerCase();
      if (!title && !fix) continue;
      const body = (severity && severity !== 'low' ? '[' + severity.toUpperCase() + '] ' : '') +
                   (title ? title + (fix ? ' — ' + fix : '') : fix);
      try {
        await db.query(
          "INSERT INTO task_subtasks (task_id, position, body, status) VALUES ($1, $2, $3, 'open')",
          [taskId, i, body.slice(0, 1000)]
        );
        subtaskCount++;
      } catch(subErr) { console.error('[r21] subtask insert error: ' + subErr.message); }
    }
    res.json({ ok: true, taskId: taskId, agent: agentName, subtaskCount: subtaskCount });
  } catch(e) {
    console.error('/api/amazon/products/:groupKey/assign-task error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── r21: SUBTASKS ──────────────────────────────────────────────────────────
// Subtasks are seeded from cached AI critique when a product card is assigned
// as a task. Agents cannot delete them — only complete or dismiss-with-reason.
// Card cannot move to status='complete' until every subtask is in
// ('complete','dismissed').

// GET /api/tasks/:id/subtasks — list all subtasks for a task
app.get('/api/tasks/:id/subtasks', async function(req, res) {
  if (!db) return res.json({ subtasks: [] });
  try {
    const r = await db.query(
      "SELECT id, task_id, position, body, status, dismiss_reason, " +
      "completed_at, completed_by, dismissed_at, dismissed_by " +
      "FROM task_subtasks WHERE task_id=$1 ORDER BY position ASC, id ASC",
      [parseInt(req.params.id)]
    );
    res.json({ subtasks: r.rows });
  } catch(e) {
    console.error('/api/tasks/:id/subtasks GET error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tasks/:id/subtasks/:sid/complete — mark a subtask done (toggleable)
app.post('/api/tasks/:id/subtasks/:sid/complete', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const actor = (req.user && req.user.name) || 'unknown';
  try {
    const cur = await db.query("SELECT status FROM task_subtasks WHERE id=$1 AND task_id=$2", [parseInt(req.params.sid), parseInt(req.params.id)]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Subtask not found' });
    const isComplete = cur.rows[0].status === 'complete';
    if (isComplete) {
      // Toggle back to open
      await db.query("UPDATE task_subtasks SET status='open', completed_at=NULL, completed_by=NULL WHERE id=$1", [parseInt(req.params.sid)]);
      return res.json({ ok: true, status: 'open' });
    }
    // Cannot complete a dismissed subtask without un-dismissing first
    if (cur.rows[0].status === 'dismissed') {
      return res.status(400).json({ error: 'Subtask is dismissed. Un-dismiss it first if you want to mark complete.' });
    }
    await db.query(
      "UPDATE task_subtasks SET status='complete', completed_at=NOW(), completed_by=$1 WHERE id=$2",
      [actor, parseInt(req.params.sid)]
    );
    res.json({ ok: true, status: 'complete' });
  } catch(e) {
    console.error('/api/tasks/:id/subtasks/:sid/complete error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tasks/:id/subtasks/:sid/dismiss — body: { reason }. Mark as dismissed
// with a required reason. Idempotent — re-posting updates the reason.
app.post('/api/tasks/:id/subtasks/:sid/dismiss', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'Dismiss reason is required' });
  const actor = (req.user && req.user.name) || 'unknown';
  try {
    const cur = await db.query("SELECT status FROM task_subtasks WHERE id=$1 AND task_id=$2", [parseInt(req.params.sid), parseInt(req.params.id)]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Subtask not found' });
    await db.query(
      "UPDATE task_subtasks SET status='dismissed', dismiss_reason=$1, dismissed_at=NOW(), dismissed_by=$2 WHERE id=$3",
      [reason.slice(0, 500), actor, parseInt(req.params.sid)]
    );
    res.json({ ok: true, status: 'dismissed' });
  } catch(e) {
    console.error('/api/tasks/:id/subtasks/:sid/dismiss error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tasks/:id/subtasks/:sid/reopen — un-dismiss or un-complete back to open
app.post('/api/tasks/:id/subtasks/:sid/reopen', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const r = await db.query(
      "UPDATE task_subtasks SET status='open', completed_at=NULL, completed_by=NULL, dismissed_at=NULL, dismissed_by=NULL, dismiss_reason=NULL " +
      "WHERE id=$1 AND task_id=$2 RETURNING id",
      [parseInt(req.params.sid), parseInt(req.params.id)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Subtask not found' });
    res.json({ ok: true, status: 'open' });
  } catch(e) {
    console.error('/api/tasks/:id/subtasks/:sid/reopen error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── r22: AMAZON DAY-7 REVIEW ───────────────────────────────────────────────
// Mirrors the Google day7 flow on the same campaign_tasks table. At day 7+,
// agent must hit Carry on / Archive / Stop with a note before the task can
// proceed. The day7_decision columns are shared (Google added them in r17,
// just enabling them for Amazon now).

// GET /api/tasks/:id/review-metrics — last 7 days vs prior 7 days for the
// underlying campaign or product. Used to populate the day-7 review modal.
app.get('/api/tasks/:id/review-metrics', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const id = parseInt(req.params.id);
  try {
    const tr = await db.query("SELECT id, campaign_id, campaign_name, created_date FROM campaign_tasks WHERE id=$1", [id]);
    if (!tr.rows.length) return res.status(404).json({ error: 'Task not found' });
    const t = tr.rows[0];
    // Two windows: last 7 days, and the 7 days before that (for trend)
    let recent = { spend: 0, sales: 0, clicks: 0, impressions: 0, conversions: 0, days: 0 };
    let prior  = { spend: 0, sales: 0, clicks: 0, impressions: 0, conversions: 0, days: 0 };
    try {
      // Walk last 14 days of snapshots, bucket into recent (0-6) vs prior (7-13)
      const sn = await db.query(
        "SELECT TO_CHAR(snapshot_date, 'YYYY-MM-DD') AS day, campaigns " +
        "FROM daily_snapshots " +
        "WHERE snapshot_date >= CURRENT_DATE - INTERVAL '14 days' " +
        "ORDER BY snapshot_date DESC"
      );
      sn.rows.forEach(function(snap, idx) {
        if (!t.campaign_id) return;
        const c = (snap.campaigns || []).find(function(x){ return String(x.campaignId) === String(t.campaign_id); });
        if (!c) return;
        const bucket = idx < 7 ? recent : prior;
        bucket.spend += parseFloat(c.spend || 0);
        bucket.sales += parseFloat(c.sales || 0);
        bucket.clicks += parseInt(c.clicks || 0);
        bucket.impressions += parseInt(c.impressions || 0);
        bucket.conversions += parseInt(c.orders || c.purchases || c.conversions || 0);
        bucket.days++;
      });
    } catch(e) { console.error('[r22 review-metrics] snapshot lookup: ' + e.message); }

    function trend(rec, pri) {
      if (!pri || pri === 0) return null;
      return ((rec - pri) / pri) * 100;
    }
    res.json({
      task: { id: t.id, campaign_id: t.campaign_id, campaign_name: t.campaign_name, created_date: t.created_date },
      recent_7d: {
        spend: parseFloat(recent.spend.toFixed(2)),
        sales: parseFloat(recent.sales.toFixed(2)),
        clicks: recent.clicks,
        impressions: recent.impressions,
        conversions: recent.conversions,
        acos: recent.sales > 0 ? Math.round((recent.spend / recent.sales) * 1000) / 10 : null,
        days_with_data: recent.days
      },
      prior_7d: {
        spend: parseFloat(prior.spend.toFixed(2)),
        sales: parseFloat(prior.sales.toFixed(2)),
        clicks: prior.clicks,
        impressions: prior.impressions,
        conversions: prior.conversions,
        acos: prior.sales > 0 ? Math.round((prior.spend / prior.sales) * 1000) / 10 : null,
        days_with_data: prior.days
      },
      trend_pct: {
        spend: trend(recent.spend, prior.spend),
        sales: trend(recent.sales, prior.sales),
        clicks: trend(recent.clicks, prior.clicks)
      }
    });
  } catch(e) {
    console.error('/api/tasks/:id/review-metrics error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tasks/:id/day7-decision — body: { decision: 'carry_on'|'archive'|'stop', note }
app.post('/api/tasks/:id/day7-decision', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const id = parseInt(req.params.id);
  const decision = String((req.body && req.body.decision) || '').trim().toLowerCase();
  const note = String((req.body && req.body.note) || '').trim();
  if (['carry_on','archive','stop'].indexOf(decision) === -1) {
    return res.status(400).json({ error: 'decision must be one of: carry_on, archive, stop' });
  }
  if (!note) return res.status(400).json({ error: 'note required for day-7 decision' });
  const actor = (req.user && req.user.name) || 'unknown';
  try {
    // Translate decision into status side-effect:
    // - carry_on: keeps status, just records the decision
    // - archive: status=archived
    // - stop: status=dismissed (with note)
    let newStatus = null;
    if (decision === 'archive') newStatus = 'archived';
    if (decision === 'stop') newStatus = 'dismissed';
    if (newStatus) {
      await db.query(
        "UPDATE campaign_tasks SET day7_decision=$1, day7_decision_at=NOW(), day7_note=$2, status=$3, archived_at=CASE WHEN $3='archived' THEN NOW() ELSE archived_at END WHERE id=$4",
        [decision, note, newStatus, id]
      );
    } else {
      await db.query(
        "UPDATE campaign_tasks SET day7_decision=$1, day7_decision_at=NOW(), day7_note=$2 WHERE id=$3",
        [decision, note, id]
      );
    }
    try {
      const t = (await db.query("SELECT campaign_id, campaign_name, agent_name FROM campaign_tasks WHERE id=$1", [id])).rows[0] || {};
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1, $2, $3, $4, $5)",
        [t.campaign_id || '', t.campaign_name || '', actor, 'day7_' + decision, note]
      );
    } catch(_) {}
    res.json({ ok: true, decision: decision, new_status: newStatus });
  } catch(e) {
    console.error('/api/tasks/:id/day7-decision error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── r21: PRODUCT OWNER REASSIGN ────────────────────────────────────────────
// Reassign a product to a different agent (owner+manager only). Mapping system
// was stripped — owner reassign remains because it's how we ensure no
// duplicate ownership.

// POST /api/amazon/products/:parentSku/owner — reassign product owner.
// body: { agent: 'Aryan' } (or 'Unassigned'). Owner+manager only.
app.post('/api/amazon/products/:parentSku/owner', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const role = (req.user && (req.user.role || '').toLowerCase()) || '';
  const dept = (req.user && (req.user.department || '').toLowerCase()) || '';
  const isPriv = role === 'owner' || role === 'manager' || dept === 'manager';
  if (!isPriv) return res.status(403).json({ error: 'Owner or manager only' });
  const parentSku = String(req.params.parentSku || '').trim();
  const newAgent = String((req.body && req.body.agent) || '').trim();
  if (!parentSku) return res.status(400).json({ error: 'parentSku required' });
  if (!newAgent) return res.status(400).json({ error: 'agent required (use "Unassigned" to clear)' });
  const actor = (req.user && req.user.name) || 'unknown';
  try {
    // Canonicalise the agent name before storing
    const canonical = newAgent.toLowerCase() === 'unassigned' ? null : (canonicalAgent(newAgent) || newAgent);
    const r = await db.query(
      "UPDATE amazon_products SET owner_agent=$1, owner_manual=TRUE WHERE parent_sku=$2 OR (parent_sku IS NULL AND sku=$2) RETURNING sku",
      [canonical, parentSku]
    );
    // Audit-log it
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1, $2, $3, $4, $5)",
        ['product:' + parentSku, parentSku, actor, 'owner_reassigned', 'Owner set to ' + (canonical || 'Unassigned')]
      );
    } catch(_) {}
    res.json({ ok: true, rows_updated: r.rowCount, owner_agent: canonical });
  } catch(e) {
    console.error('/api/amazon/products/:parentSku/owner error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── r22: PRODUCT SNOOZE ────────────────────────────────────────────────────
// ─── r23: CAMPAIGN SNOOZE / DISMISS ─────────────────────────────────────────
// Hide an underperforming campaign for N days. Used on the Underperforming
// page (/page-stuck) — replaces the old "Work on it (1 week)" fixed-duration
// flag with proper 1d/3d/7d/30d options. Snoozed campaigns auto-return to
// the Underperforming list when the timer expires.

// POST /api/amazon/campaigns/:campaignId/snooze
//   body: { days: 1|3|7|30, reason: string, action?: 'snooze'|'dismiss' }
app.post('/api/amazon/campaigns/:campaignId/snooze', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const campaignId = String(req.params.campaignId || '').trim();
  const days = parseInt((req.body && req.body.days) || 0);
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  if ([1, 3, 7, 30].indexOf(days) === -1) return res.status(400).json({ error: 'days must be 1, 3, 7, or 30' });
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'reason required' });
  const action = (String((req.body && req.body.action) || 'snooze').toLowerCase() === 'dismiss') ? 'dismiss' : 'snooze';
  const campaignName = String((req.body && req.body.campaignName) || '').trim() || null;
  const actor = (req.user && req.user.name) || 'unknown';
  try {
    await db.query(
      "INSERT INTO amazon_campaign_snooze (campaign_id, campaign_name, snoozed_until, snoozed_by, snoozed_at, snooze_reason, snooze_action) " +
      "VALUES ($1, $2, NOW() + ($3 || ' days')::interval, $4, NOW(), $5, $6) " +
      "ON CONFLICT (campaign_id) DO UPDATE SET campaign_name=EXCLUDED.campaign_name, snoozed_until=EXCLUDED.snoozed_until, " +
      "snoozed_by=EXCLUDED.snoozed_by, snoozed_at=NOW(), snooze_reason=EXCLUDED.snooze_reason, snooze_action=EXCLUDED.snooze_action",
      [campaignId, campaignName, days, actor, reason, action]
    );
    // Audit log
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes) VALUES ($1, $2, $3, $4, $5)",
        [campaignId, campaignName || '', actor, 'campaign_' + action + '_' + days + 'd', reason]
      );
    } catch(_) {}
    res.json({ ok: true, days: days, action: action });
  } catch(e) {
    console.error('/api/amazon/campaigns/:campaignId/snooze error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/amazon/campaigns/:campaignId/snooze — un-snooze
app.delete('/api/amazon/campaigns/:campaignId/snooze', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const campaignId = String(req.params.campaignId || '').trim();
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  try {
    const r = await db.query("DELETE FROM amazon_campaign_snooze WHERE campaign_id=$1 RETURNING campaign_id", [campaignId]);
    res.json({ ok: true, removed: r.rowCount > 0 });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// CAMPAIGNS
app.post('/api/campaigns/:campaignId/hide', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const campaignId = String(req.params.campaignId || '').trim();
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  const campaignName = (req.body && req.body.campaignName) || '';
  const reason = (req.body && req.body.reason) || '';
  const actor = (req.user && req.user.name) || 'unknown';
  try {
    await db.query(
      "INSERT INTO hidden_campaigns (campaign_id, campaign_name, hidden_by, reason) VALUES ($1, $2, $3, $4) " +
      "ON CONFLICT (campaign_id) DO UPDATE SET campaign_name = $2, hidden_by = $3, hidden_at = NOW(), reason = $4",
      [campaignId, campaignName, actor, reason]
    );
    res.json({ ok: true, hidden: campaignId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/campaigns/:campaignId/restore', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const campaignId = String(req.params.campaignId || '').trim();
  try {
    await db.query("DELETE FROM hidden_campaigns WHERE campaign_id = $1", [campaignId]);
    res.json({ ok: true, restored: campaignId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/campaigns/hidden', async function(req, res) {
  if (!db) return res.json({ hidden: [] });
  try {
    const r = await db.query("SELECT campaign_id, campaign_name, hidden_by, hidden_at, reason FROM hidden_campaigns ORDER BY hidden_at DESC");
    res.json({ hidden: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/amazon/top-products?date=YYYY-MM-DD&limit=5
// Returns top N ASINs by revenue for a given day. Joins amazon_orders + amazon_order_items
// (filtered by date) to amazon_products (for title + image).
// If date is omitted or empty, defaults to today (London).
app.get('/api/amazon/top-products', async function(req, res) {
  if (!db) return res.json({ products: [], totals: {} });
  try {
    const limit = Math.min(parseInt(req.query.limit || '5'), 50);
    let dateFilter;
    let dateParam;
    if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      dateFilter = "TO_CHAR(o.purchase_date AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') = $1";
      dateParam = [req.query.date];
    } else {
      // Default to today London time
      dateFilter = "TO_CHAR(o.purchase_date AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') = TO_CHAR(NOW() AT TIME ZONE 'Europe/London', 'YYYY-MM-DD')";
      dateParam = [];
    }

    // Day totals (gross, orders, units)
    const totalsRes = await db.query(
      "SELECT SUM(o.order_total) AS gross, COUNT(*) AS orders, SUM(o.num_items) AS units " +
      "FROM amazon_orders o " +
      "WHERE " + dateFilter +
      " AND o.status NOT IN ('Cancelled','Canceled')",
      dateParam
    );
    const totals = {
      gross: parseFloat((totalsRes.rows[0] && totalsRes.rows[0].gross) || 0),
      orders: parseInt((totalsRes.rows[0] && totalsRes.rows[0].orders) || 0),
      units: parseInt((totalsRes.rows[0] && totalsRes.rows[0].units) || 0)
    };

    // Top N ASINs by revenue. Group by ASIN (since SKU variants may share ASIN sometimes).
    const topRes = await db.query(
      "SELECT i.asin, MAX(i.title) AS title, MAX(p.image_url) AS image_url, " +
      "       SUM(i.item_price * i.quantity) AS revenue, " +
      "       SUM(i.quantity) AS units " +
      "FROM amazon_order_items i " +
      "JOIN amazon_orders o ON o.order_id = i.order_id " +
      "LEFT JOIN amazon_products p ON p.asin = i.asin " +
      "WHERE " + dateFilter.replace(/o\./g, 'o.') +
      " AND o.status NOT IN ('Cancelled','Canceled') " +
      "AND i.asin IS NOT NULL " +
      "GROUP BY i.asin " +
      "ORDER BY revenue DESC " +
      "LIMIT " + limit,
      dateParam
    );

    const products = topRes.rows.map(function(r) {
      return {
        asin: r.asin,
        title: r.title,
        image_url: r.image_url,
        revenue: parseFloat(r.revenue || 0),
        units: parseInt(r.units || 0)
      };
    });

    res.json({ products: products, totals: totals });
  } catch(e) {
    console.error('/api/amazon/top-products error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── r12: Auto-derive product owner agent from campaign data ─────────────────
// Strategy: campaign names follow the pattern "Agent | Product Name | ..."
// or "Agent @ Product Name". Examples:
//   "Satyam | Yoga Mat KT"
//   "Aryan @ Dumbbell rack | Exact kw"
//
// For each campaign:
//   1. Extract leading agent token (everything before first | or @)
//   2. Extract the product hint (the next segment, before the second separator)
//   3. Match the product hint against amazon_products.title via case-insensitive
//      keyword overlap. A campaign "matches" a product if its hint shares 2+
//      meaningful keywords with the product title.
//
// For each parent product group, tally which agent's campaigns match most often.
// Most-frequent agent wins, written to amazon_products.owner_agent.
// Manual overrides (owner_manual=TRUE) are never overwritten.
async function deriveProductOwners() {
  if (!db) return { ok: false, error: 'no-db' };
  try {
    // 1. Pull all products with parent grouping + titles
    const productsRes = await db.query(
      "SELECT sku, asin, parent_sku, title FROM amazon_products WHERE title IS NOT NULL"
    );
    if (!productsRes.rows.length) return { ok: true, parents_scanned: 0, message: 'no products with titles' };

    // 2. Build group → product info lookup, and a list of (group_key, title_keywords)
    const groupTitles = {}; // group_key -> { title, keywords:Set }
    productsRes.rows.forEach(function(p) {
      const groupKey = p.parent_sku || p.sku;
      if (!groupTitles[groupKey]) {
        // Use first title we see for the group
        const title = p.title || '';
        groupTitles[groupKey] = { title: title, keywords: extractTitleKeywords(title) };
      }
    });

    // 3. Pull recent campaigns from daily_snapshots (last 14 days)
    const snapshotsRes = await db.query(
      "SELECT campaigns FROM daily_snapshots WHERE snapshot_date >= CURRENT_DATE - INTERVAL '14 days' ORDER BY snapshot_date DESC"
    );
    if (!snapshotsRes.rows.length) {
      return { ok: true, parents_scanned: 0, rows_updated: 0, message: 'no snapshots in last 14 days' };
    }
    // Deduplicate campaigns across days by campaignId — we want each campaign counted once
    const seenCampaigns = new Set();
    const campaigns = [];
    snapshotsRes.rows.forEach(function(snap) {
      (snap.campaigns || []).forEach(function(c) {
        if (c.campaignId && !seenCampaigns.has(c.campaignId)) {
          seenCampaigns.add(c.campaignId);
          campaigns.push(c);
        }
      });
    });

    // 4. For each campaign, extract agent + product hint, then find matching parent products
    // groupAgentCounts[group_key][agent] = match_count
    // r17: Use TF-IDF distinctiveness — pick the BEST matching product, not every product that overlaps.
    // This stops "Satyam | Weight Plates" from being credited to both Weight Plates AND Vibration Plates.
    const groupAgentCounts = {};
    const debugStats = { campaignsWithAgent: 0, campaignsMatched: 0, totalMatches: 0 };

    // Build IDF map across all parent titles
    const titleDocCount = Object.keys(groupTitles).length || 1;
    const wordDocFreq = {};
    Object.values(groupTitles).forEach(function(g){
      g.keywords.forEach(function(kw){ wordDocFreq[kw] = (wordDocFreq[kw] || 0) + 1; });
    });
    function _idf(kw) {
      const df = wordDocFreq[kw] || 0;
      if (df === 0) return 1.5;
      return Math.log(titleDocCount / df);
    }
    function _tfidfScore(hintKw, titleKw) {
      let s = 0;
      hintKw.forEach(function(kw){ if (titleKw.has(kw)) s += _idf(kw); });
      return s;
    }
    const _MATCH_THRESHOLD = 0.5;

    campaigns.forEach(function(c) {
      const parsed = parseCampaignName(c.name || '');
      if (!parsed.agent) return;
      debugStats.campaignsWithAgent++;
      const agent = parsed.agent;
      const hintKeywords = extractTitleKeywords(parsed.productHint);
      if (hintKeywords.size === 0) return;
      // Find the SINGLE best matching product (TF-IDF weighted)
      let bestKey = null, bestScore = 0;
      Object.keys(groupTitles).forEach(function(groupKey) {
        const titleKw = groupTitles[groupKey].keywords;
        const score = _tfidfScore(hintKeywords, titleKw);
        if (score > bestScore) { bestScore = score; bestKey = groupKey; }
      });
      let matchedThisCampaign = false;
      if (bestKey && bestScore >= _MATCH_THRESHOLD) {
        if (!groupAgentCounts[bestKey]) groupAgentCounts[bestKey] = {};
        groupAgentCounts[bestKey][agent] = (groupAgentCounts[bestKey][agent] || 0) + 1;
        matchedThisCampaign = true;
        debugStats.totalMatches++;
      }
      if (matchedThisCampaign) debugStats.campaignsMatched++;
    });

    // 5. For each group, pick top agent and update DB (skip rows with owner_manual=TRUE)
    let updated = 0;
    for (const groupKey of Object.keys(groupAgentCounts)) {
      const counts = groupAgentCounts[groupKey];
      let topAgent = null;
      let topCount = 0;
      Object.keys(counts).forEach(function(a) {
        if (counts[a] > topCount) { topCount = counts[a]; topAgent = a; }
      });
      if (!topAgent) continue;
      try {
        const r = await db.query(
          "UPDATE amazon_products SET owner_agent=$1 " +
          "WHERE (parent_sku=$2 OR (parent_sku IS NULL AND sku=$2)) " +
          "AND COALESCE(owner_manual, FALSE) = FALSE",
          [topAgent, groupKey]
        );
        if (r.rowCount > 0) updated += r.rowCount;
      } catch(e) { console.error('[derive-owners] Update error for ' + groupKey + ': ' + e.message); }
    }

    console.log('[derive-owners] Stats: ' + debugStats.campaignsWithAgent + ' campaigns parsed, ' + debugStats.campaignsMatched + ' matched, ' + debugStats.totalMatches + ' total matches → ' + updated + ' rows updated across ' + Object.keys(groupAgentCounts).length + ' parent groups');
    return {
      ok: true,
      parents_scanned: Object.keys(groupAgentCounts).length,
      rows_updated: updated,
      campaigns_parsed: debugStats.campaignsWithAgent,
      campaigns_matched: debugStats.campaignsMatched
    };
  } catch(e) {
    console.error('[derive-owners] FAILED: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// Parse a campaign name like "Satyam | Yoga Mat KT" → { agent, productHint }
// Supports both "|" and "@" as the agent separator.
// r16c: when no agent prefix exists (e.g. "Vibration Pate Auto"), use the whole name
// as the product hint. Agent is null but matching still works.
function parseCampaignName(name) {
  if (!name) return { agent: null, productHint: '' };
  const str = String(name);
  // r21: try alias map first — handles multi-word prefixes ("Aryan Tomar | x")
  // and case variations ("aryan | x"). Fall back to the strict single-word
  // regex if no alias matches, so genuinely unknown prefixes still surface
  // in the unknown-agents UI.
  const beforeSep = str.split(/[|@]/)[0].trim();
  if (beforeSep) {
    const canon = canonicalAgent(beforeSep);
    if (canon && Object.values(AGENT_ALIASES).indexOf(canon) !== -1) {
      const rest = str.split(/[|@]/).slice(1).join('|') || '';
      const hint = rest.split(/[|@]/)[0].trim();
      return { agent: canon, productHint: hint };
    }
  }
  const m = str.match(/^\s*([A-Za-z]{3,15})\s*[|@]\s*(.*)$/);
  if (m) {
    const agent = m[1].trim();
    const rest = m[2] || '';
    const hint = rest.split(/[|@]/)[0].trim();
    return { agent: agent, productHint: hint };
  }
  // No agent prefix — use the whole name as hint (split on first | if present, else whole string)
  const fallback = str.split(/[|@]/)[0].trim();
  return { agent: null, productHint: fallback };
}

// Extract meaningful lowercase keywords from a title or product hint.
// r15: improved version — strips plurals/'s', handles compounds (kettlebell ↔ kettle bell),
// keeps short distinctive words, less aggressive stop-word filter.
const TITLE_STOPWORDS = new Set([
  'the','and','for','with','from','your','our','this','that','are','was','will',
  'kt','exact','kw','keyword','kws','sd','sb','sp','auto','manual','match',
  'amazon','amazo','amaz','prod','product','products','listing','set','pcs','pack','new',
  'test','testing','old','best','top','main','sub','low','high','any','test','phrase',
  'fk','sports','fksports'
]);

// Singular form: strip trailing 's' if word is >3 chars and ends in plural suffix.
// Examples: kettlebells -> kettlebell, mats -> mat, plates -> plate, dumbbells -> dumbbell
function singularize(word) {
  if (!word || word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';     // bunnies -> bunny
  if (word.endsWith('ses') && word.length > 4) return word.slice(0, -2);            // ?
  if (word.endsWith('xes') && word.length > 4) return word.slice(0, -2);            // boxes -> box
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

// Split a compound into atoms. "kettlebell" -> ["kettlebell", "kettle", "bell"].
// We only do this for known fitness compounds so we don't over-split.
const COMPOUND_PARTS = {
  'kettlebell': ['kettlebell', 'kettle', 'bell'],
  'kettlebells': ['kettlebell', 'kettle', 'bell'],
  'dumbbell': ['dumbbell', 'dumb', 'bell'],
  'dumbbells': ['dumbbell', 'dumb', 'bell'],
  'barbell': ['barbell', 'bar', 'bell'],
  'barbells': ['barbell', 'bar', 'bell'],
  'trampoline': ['trampoline'],
  'rebounder': ['rebounder', 'trampoline'],   // synonyms!
  'spinbike': ['spinbike', 'spin', 'bike'],
  'treadmill': ['treadmill', 'tread'],
  'rowing': ['rowing', 'rower'],
  'rower': ['rower', 'rowing']
};

function extractTitleKeywords(text) {
  if (!text) return new Set();
  const out = new Set();
  String(text).toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .forEach(function(t) {
      if (!t) return;
      if (TITLE_STOPWORDS.has(t)) return;
      if (/^\d+$/.test(t)) return;
      // Singularize and add
      const sing = singularize(t);
      if (sing.length >= 3) out.add(sing);
      // If it's a known compound, add its atoms too
      if (COMPOUND_PARTS[t]) COMPOUND_PARTS[t].forEach(function(p){ out.add(singularize(p)); });
      if (COMPOUND_PARTS[sing]) COMPOUND_PARTS[sing].forEach(function(p){ out.add(singularize(p)); });
    });
  return out;
}

// r15: keyword overlap score — number of shared keywords + bonus for distinctive (long) ones
function keywordOverlapScore(setA, setB) {
  let score = 0;
  setA.forEach(function(kw) {
    if (setB.has(kw)) {
      score += 1;
      if (kw.length >= 6) score += 0.5;  // distinctive word bonus (kettlebell, trampoline)
    }
  });
  return score;
}

// r15: A campaign matches a product if either:
//   - 2+ shared keywords, OR
//   - 1 shared keyword that is distinctive (>=5 chars), OR
//   - r16: 1 shared keyword of any length, when ALL the campaign's hint keywords appear in the title
//     (handles "Bell Set" matching "Kettlebell Heavy Set" — every keyword is in title, so it's a real match)
function isCampaignMatch(hintKw, titleKw) {
  if (hintKw.size === 0) return false;
  let overlap = 0;
  let hasDistinctive = false;
  hintKw.forEach(function(kw) {
    if (titleKw.has(kw)) {
      overlap++;
      if (kw.length >= 5) hasDistinctive = true;
    }
  });
  if (overlap >= 2) return true;
  if (overlap >= 1 && hasDistinctive) return true;
  // r16: every hint keyword is in title (small hint, fully matched)
  if (overlap >= 1 && overlap === hintKw.size) return true;
  return false;
}

// PUT /api/amazon/products/:groupKey/owner — manually set the owner agent.
// groupKey = parent_sku for variants, or the SKU itself for standalones.
// Body: { agent: 'Aryan' } or { agent: null } to clear.
// Sets owner_manual=TRUE so future auto-derive runs don't overwrite this.
// Manager/owner only.
app.put('/api/amazon/products/:groupKey/owner', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const userRole = (req.user && (req.user.role || '').toLowerCase()) || '';
  const isManagerLevel = ['owner','manager'].indexOf(userRole) !== -1 || (req.user && (req.user.department || '').toLowerCase() === 'manager');
  if (!isManagerLevel) return res.status(403).json({ error: 'Manager permission required' });
  try {
    const groupKey = req.params.groupKey;
    const agent = req.body && req.body.agent ? String(req.body.agent).trim() : null;
    const r = await db.query(
      "UPDATE amazon_products SET owner_agent=$1, owner_manual=TRUE " +
      "WHERE (parent_sku=$2 OR (parent_sku IS NULL AND sku=$2))",
      [agent, groupKey]
    );
    // Audit log
    try {
      const actor = (req.user && req.user.name) || 'System';
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes) VALUES ('','',$1,$1,'product_owner_set',$2)",
        [actor, actor + ' set owner of ' + groupKey + ' to ' + (agent || 'Unassigned')]
      );
    } catch(e) {}
    res.json({ success: true, rows_updated: r.rowCount, group: groupKey, owner: agent });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// r18: GET /api/amazon/merge-candidates — suggest groups of parents that should likely be merged.
// Logic: cluster parents by shared distinctive keywords (TF-IDF top words). Parents sharing 2+
// distinctive words are likely the same product family.
app.get('/api/amazon/merge-candidates', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  try {
    const productsRes = await db.query(
      "SELECT sku, parent_sku, title FROM amazon_products WHERE title IS NOT NULL"
    );
    // Build parents map (use parent_sku if present, else sku)
    const parents = {};
    productsRes.rows.forEach(function(p) {
      const key = p.parent_sku || p.sku;
      if (!parents[key]) parents[key] = { key: key, titles: [], skus: [] };
      parents[key].titles.push(p.title);
      parents[key].skus.push(p.sku);
    });
    const parentKeys = Object.keys(parents);
    // Pick representative title for each (longest)
    parentKeys.forEach(function(k){
      const titles = parents[k].titles;
      parents[k].title = titles.sort(function(a, b){ return b.length - a.length; })[0];
      parents[k].keywords = extractTitleKeywords(parents[k].title);
    });
    // IDF map
    const docCount = parentKeys.length || 1;
    const wordDocFreq = {};
    parentKeys.forEach(function(k){
      parents[k].keywords.forEach(function(kw){ wordDocFreq[kw] = (wordDocFreq[kw] || 0) + 1; });
    });
    function _idf(kw){ const df = wordDocFreq[kw] || 0; if (df === 0) return 0; return Math.log(docCount / df); }
    // For each parent, get its top-3 most distinctive (highest IDF) words
    parentKeys.forEach(function(k){
      const kws = Array.from(parents[k].keywords).sort(function(a, b){ return _idf(b) - _idf(a); });
      parents[k].topWords = kws.slice(0, 3);
    });
    // Group parents by their top-2 most distinctive words (sorted as a key)
    const clusters = {};
    parentKeys.forEach(function(k){
      const top = parents[k].topWords.slice(0, 2).sort();
      if (top.length < 2) return;
      const clusterKey = top.join('|');
      if (!clusters[clusterKey]) clusters[clusterKey] = [];
      clusters[clusterKey].push({
        key: k,
        title: parents[k].title,
        sku_count: parents[k].skus.length,
        topWords: parents[k].topWords
      });
    });
    // Only return clusters with 2+ parents (those are merge candidates)
    const candidates = Object.keys(clusters)
      .filter(function(c){ return clusters[c].length >= 2; })
      .map(function(c){ return { signature: c, parents: clusters[c] }; })
      .sort(function(a, b){ return b.parents.length - a.parents.length; });
    res.json({ clusters: candidates, totalParents: parentKeys.length });
  } catch(e) {
    console.error('/api/amazon/merge-candidates error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/derive-product-owners — manually trigger the auto-derive job (owner only).
app.post('/api/admin/derive-product-owners', async function(req, res) {
  if (!requireOwner(req, res)) return;
  const result = await deriveProductOwners();
  res.json(result);
});

// r18: POST /api/amazon/products/merge — merge multiple parent groups into one.
// Body: { canonicalKey: 'Vibration Plates Grey Ama', mergeKeys: ['asin:B0...', 'Vib Plates Amazon'] }
// Effect: every SKU whose parent_sku matches any mergeKey (or sku matches a standalone)
// gets parent_sku updated to canonicalKey. Owner can manually pick the canonical title.
// Manager + owner only.
app.post('/api/amazon/products/merge', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const userRole = (req.user && (req.user.role || '').toLowerCase()) || '';
  const isManagerLevel = ['owner','manager'].indexOf(userRole) !== -1 || (req.user && (req.user.department || '').toLowerCase() === 'manager');
  if (!isManagerLevel) return res.status(403).json({ error: 'Manager permission required' });

  const canonicalKey = String((req.body && req.body.canonicalKey) || '').trim();
  const mergeKeys = Array.isArray(req.body && req.body.mergeKeys) ? req.body.mergeKeys.map(function(k){ return String(k).trim(); }).filter(Boolean) : [];
  if (!canonicalKey) return res.status(400).json({ error: 'canonicalKey required' });
  if (!mergeKeys.length) return res.status(400).json({ error: 'mergeKeys required' });
  // Don't allow merging a key into itself (no-op safeguard)
  const sources = mergeKeys.filter(function(k){ return k !== canonicalKey; });
  if (!sources.length) return res.status(400).json({ error: 'No keys to merge after excluding canonical' });

  try {
    let totalUpdated = 0;
    for (const srcKey of sources) {
      // Update both:
      //   (a) rows whose parent_sku = srcKey  → set parent_sku = canonicalKey
      //   (b) rows whose sku = srcKey AND parent_sku IS NULL (standalone parent itself) → also reparent
      const r1 = await db.query(
        "UPDATE amazon_products SET parent_sku = $1 WHERE parent_sku = $2",
        [canonicalKey, srcKey]
      );
      const r2 = await db.query(
        "UPDATE amazon_products SET parent_sku = $1 WHERE sku = $2 AND (parent_sku IS NULL OR parent_sku = sku)",
        [canonicalKey, srcKey]
      );
      totalUpdated += (r1.rowCount || 0) + (r2.rowCount || 0);
    }
    // Audit log
    try {
      const actor = (req.user && req.user.name) || 'System';
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes) VALUES ('','',$1,$1,'product_merge',$2)",
        [actor, actor + ' merged [' + sources.join(', ') + '] into ' + canonicalKey + ' (' + totalUpdated + ' rows)']
      );
    } catch(e) {}
    // Re-derive owners so campaigns reattach correctly
    const dr = await deriveProductOwners();
    res.json({
      ok: true,
      canonical: canonicalKey,
      merged: sources,
      rows_updated: totalUpdated,
      derive: dr
    });
  } catch(e) {
    console.error('/api/amazon/products/merge error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/amazon/agents — list of agents available as product owners.
// Returns active users in the Amazon department. Used to populate the owner-assignment dropdown.
app.get('/api/amazon/agents', async function(req, res) {
  if (!db) return res.json({ agents: [] });
  try {
    const r = await db.query(
      "SELECT DISTINCT name FROM users " +
      "WHERE COALESCE(is_active,TRUE)=TRUE " +
      "AND LOWER(COALESCE(department,'')) IN ('amazon','manager') " +
      "ORDER BY name ASC"
    );
    res.json({ agents: r.rows.map(function(row){ return row.name; }) });
  } catch(e) {
    console.error('/api/amazon/agents error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// r24: GET /api/amazon/campaign-detail/:campaignId — power the All Campaigns row
// modal. Returns 7-day spend/sales/ACOS history (from daily_snapshots), top ASINs
// inside the campaign by spend (from amazon_asin_ad_performance, last 7 days),
// recent tasks (from campaign_tasks). Plain-English health summary computed
// client-side from the live campaign object — server just feeds the data.
app.get('/api/amazon/campaign-detail/:campaignId', async function(req, res) {
  if (!db) return res.json({ history: [], topAsins: [], recentTasks: [] });
  const campaignId = String(req.params.campaignId || '').trim();
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  try {
    // 1) 7-day history from daily_snapshots — extract this campaign's row from each day
    const histRows = await db.query(
      "SELECT snapshot_date, campaigns FROM daily_snapshots " +
      "WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days' " +
      "ORDER BY snapshot_date ASC"
    );
    const history = [];
    histRows.rows.forEach(function(row) {
      const camps = Array.isArray(row.campaigns) ? row.campaigns : [];
      const found = camps.find(function(c){ return String(c.campaignId) === campaignId; });
      if (found) {
        const spend = parseFloat(found.spend || 0);
        const sales = parseFloat(found.sales || 0);
        const acos = sales > 0 ? +(100 * spend / sales).toFixed(1) : null;
        history.push({
          date: row.snapshot_date,
          spend: +spend.toFixed(2),
          sales: +sales.toFixed(2),
          acos: acos,
          impressions: parseInt(found.impressions || 0),
          clicks: parseInt(found.clicks || 0)
        });
      } else {
        // Day exists but campaign not in snapshot — record gap so the chart isn't misleading
        history.push({ date: row.snapshot_date, spend: 0, sales: 0, acos: null, impressions: 0, clicks: 0, missing: true });
      }
    });

    // 2) Top ASINs in this campaign — last 7 days from amazon_asin_ad_performance
    let topAsins = [];
    try {
      const asinRows = await db.query(
        "SELECT a.asin, " +
        "       SUM(a.spend)::numeric AS spend, " +
        "       SUM(a.sales)::numeric AS sales, " +
        "       SUM(a.clicks)::int AS clicks, " +
        "       SUM(a.impressions)::int AS impressions, " +
        "       SUM(a.units)::int AS units, " +
        "       MAX(p.title) AS title, " +
        "       MAX(p.image_url) AS image_url " +
        "FROM amazon_asin_ad_performance a " +
        "LEFT JOIN amazon_products p ON p.asin = a.asin " +
        "WHERE a.campaign_id = $1 AND a.report_date >= CURRENT_DATE - INTERVAL '7 days' " +
        "GROUP BY a.asin " +
        "ORDER BY spend DESC " +
        "LIMIT 8",
        [campaignId]
      );
      topAsins = asinRows.rows.map(function(r) {
        const sp = parseFloat(r.spend || 0);
        const sa = parseFloat(r.sales || 0);
        return {
          asin: r.asin,
          title: r.title || null,
          image_url: r.image_url || null,
          spend: +sp.toFixed(2),
          sales: +sa.toFixed(2),
          acos: sa > 0 ? +(100 * sp / sa).toFixed(1) : null,
          clicks: r.clicks || 0,
          impressions: r.impressions || 0,
          units: r.units || 0
        };
      });
    } catch(e) {
      // r22 table may not exist on very old deployments — non-fatal
      if (!/does not exist/.test(e.message)) console.error('[r24] top-asins lookup: ' + e.message);
    }

    // 3) Recent tasks on this campaign — last 30 days, any status
    const taskRows = await db.query(
      "SELECT id, agent_name, status, problem_type, problem_detail, created_date, task_stage " +
      "FROM campaign_tasks " +
      "WHERE campaign_id = $1 " +
      "  AND department = 'amazon' " +
      "  AND created_date >= CURRENT_DATE - INTERVAL '30 days' " +
      "ORDER BY created_date DESC " +
      "LIMIT 10",
      [campaignId]
    );
    const recentTasks = taskRows.rows.map(function(r) {
      return {
        id: r.id,
        agent: r.agent_name,
        status: r.status,
        problem_type: r.problem_type,
        problem_detail: r.problem_detail,
        created_date: r.created_date,
        task_stage: r.task_stage
      };
    });

    res.json({
      campaignId: campaignId,
      history: history,
      topAsins: topAsins,
      recentTasks: recentTasks
    });
  } catch(e) {
    console.error('/api/amazon/campaign-detail error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// r18: GET /api/amazon/unknown-agents — surface agent prefixes appearing in campaign names
// that don't match any existing user. Lets the owner spot when a new agent shows up
// in the data and prompt them to create a user account.
// r21: paired with GET /api/tasks/orphaned below for orphaned task view.
app.get('/api/amazon/unknown-agents', async function(req, res) {
  if (!db) return res.json({ unknown: [] });
  try {
    // Existing user names (lowercased)
    const ur = await db.query(
      "SELECT name FROM users WHERE COALESCE(is_active,TRUE)=TRUE"
    );
    const knownNames = new Set(ur.rows.map(function(r){ return (r.name || '').toLowerCase(); }));
    // r21: also seed every alias and canonical from AGENT_ALIASES so "Aryan Tomar"
    // and "aryan" are never flagged as unknown even if a user record is missing.
    Object.keys(AGENT_ALIASES).forEach(function(k){ knownNames.add(k); });
    Object.values(AGENT_ALIASES).forEach(function(v){ knownNames.add(v.toLowerCase()); });
    // Recent campaign names from snapshots
    const sr = await db.query(
      "SELECT campaigns FROM daily_snapshots WHERE snapshot_date >= CURRENT_DATE - INTERVAL '14 days'"
    );
    // Extract every agent prefix found
    const prefixCounts = {};
    sr.rows.forEach(function(snap){
      (snap.campaigns || []).forEach(function(c){
        const parsed = parseCampaignName(c.name || '');
        if (parsed.agent) {
          const lower = parsed.agent.toLowerCase();
          if (!knownNames.has(lower)) {
            prefixCounts[parsed.agent] = (prefixCounts[parsed.agent] || 0) + 1;
          }
        }
      });
    });
    const unknown = Object.keys(prefixCounts).map(function(name){
      return { name: name, campaignCount: prefixCounts[name] };
    }).sort(function(a, b){ return b.campaignCount - a.campaignCount; });
    res.json({ unknown: unknown });
  } catch(e) {
    console.error('/api/amazon/unknown-agents error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// r21: GET /api/tasks/orphaned — Amazon tasks assigned to agent names NOT in
// active Amazon-department users. Owner+manager only. Used by the "Unknown
// agents" modal on the Amazon Tasks page so orphaned work can be reassigned
// or archived. Scoped to department='amazon' — Google tasks have their own
// flow (Rahul/Anuj are seeded distinct from Amazon agents).
app.get('/api/tasks/orphaned', async function(req, res) {
  if (!db) return res.json({ tasks: [] });
  const userRole = (req.user && (req.user.role || '').toLowerCase()) || '';
  const userDept = (req.user && (req.user.department || '').toLowerCase()) || '';
  const isPrivileged = ['owner','manager'].indexOf(userRole) !== -1 || userDept === 'manager';
  if (!isPrivileged) return res.status(403).json({ error: 'Owner or manager role required' });
  try {
    // Active Amazon agents only — Google agents (Rahul/Anuj) shouldn't make
    // an Amazon task look "assigned"; they live in a different department.
    const ur = await db.query(
      "SELECT name FROM users WHERE COALESCE(is_active,TRUE)=TRUE " +
      "AND LOWER(COALESCE(department,'')) IN ('amazon','manager')"
    );
    const activeNames = ur.rows.map(function(r){ return r.name; }).filter(Boolean);
    if (activeNames.length === 0) return res.json({ tasks: [] });
    // Find open/in-progress Amazon tasks where agent_name is NULL or NOT in active Amazon users.
    // department defaults to 'amazon' on the column so legacy rows pre-r17 are included via COALESCE.
    const tr = await db.query(
      "SELECT id, campaign_id, campaign_name, agent_name, status, problem_type, " +
      "problem_detail, created_date, days_persisted FROM campaign_tasks " +
      "WHERE COALESCE(department,'amazon')='amazon' " +
      "AND status IN ('open','in_progress','scaling') " +
      "AND (agent_name IS NULL OR NOT (agent_name = ANY($1))) " +
      "ORDER BY created_date DESC LIMIT 200",
      [activeNames]
    );
    res.json({ tasks: tr.rows, activeAgents: activeNames });
  } catch(e) {
    console.error('/api/tasks/orphaned error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/amazon/sales-by-agent?days=7
// Returns sales per agent per day — used for the team-transparency panel that all
// users (not just managers) can see. Each agent's numbers come from orders containing
// products where amazon_products.owner_agent matches.
//
// r21 fix: previous version inflated agent totals by joining LEFT JOIN amazon_products
// directly — every duplicate SKU sharing an ASIN multiplied the line item. Now we
// collapse line items per (order_id, asin) first, then join to ONE owner_agent
// per ASIN (using MAX(owner_agent) — assumes consistent owner across SKUs sharing
// an ASIN; flagged in /api/admin/sales-gap-diagnosis if not).
app.get('/api/amazon/sales-by-agent', async function(req, res) {
  if (!db) return res.json({ agents: [], days: [] });
  try {
    const days = Math.min(parseInt(req.query.days || '7'), 30);
    const r = await db.query(
      "WITH unique_lines AS (" +
      "  SELECT TO_CHAR(o.purchase_date AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day, " +
      "         i.order_id, i.asin, " +
      "         SUM(i.item_price * i.quantity) AS gross, " +
      "         SUM(i.quantity) AS units " +
      "  FROM amazon_orders o " +
      "  JOIN amazon_order_items i ON i.order_id = o.order_id " +
      "  WHERE o.purchase_date >= NOW() - INTERVAL '" + days + " days' " +
      "  AND o.status NOT IN ('Cancelled','Canceled') " +
      "  GROUP BY day, i.order_id, i.asin" +
      "), " +
      "agent_for_asin AS (" +
      "  SELECT asin, MAX(owner_agent) AS owner_agent " +
      "  FROM amazon_products " +
      "  WHERE asin IS NOT NULL " +
      "  GROUP BY asin" +
      ") " +
      "SELECT ul.day, " +
      "       COALESCE(a.owner_agent, 'Unassigned') AS agent, " +
      "       SUM(ul.gross) AS gross, " +
      "       SUM(ul.units) AS units " +
      "FROM unique_lines ul " +
      "LEFT JOIN agent_for_asin a ON a.asin = ul.asin " +
      "GROUP BY ul.day, COALESCE(a.owner_agent, 'Unassigned') " +
      "ORDER BY ul.day ASC, agent ASC"
    );
    const dayMap = {};
    const agentSet = new Set();
    r.rows.forEach(function(row) {
      const d = row.day;
      const a = row.agent;
      agentSet.add(a);
      if (!dayMap[d]) dayMap[d] = {};
      dayMap[d][a] = { gross: parseFloat(row.gross || 0), units: parseInt(row.units || 0) };
    });
    const dayList = Object.keys(dayMap).sort();
    const agentList = Array.from(agentSet);
    res.json({ days: dayList, agents: agentList, byDay: dayMap });
  } catch(e) {
    console.error('/api/amazon/sales-by-agent error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// Returns Amazon sales numbers for the last N days, day-by-day. Powers the
// net-sales panel on the Amazon dashboard (mirrors Google's Shopify panel).
// r11: For non-manager users, filters to orders containing only their owned products.
app.get('/api/amazon/sales-summary', async function(req, res) {
  if (!db) return res.json({ days: [], totals: {} });
  try {
    const days = Math.min(parseInt(req.query.days || '7'), 30);
    const userRole = (req.user && (req.user.role || '').toLowerCase()) || '';
    const userName = (req.user && req.user.name) || '';
    const isManagerLevel = ['owner','manager'].indexOf(userRole) !== -1 || (req.user && (req.user.department || '').toLowerCase() === 'manager');
    // Optional ?agent=Aryan filter (managers only — agents always see their own)
    const agentFilter = (req.query.agent && isManagerLevel) ? String(req.query.agent) : (isManagerLevel ? null : userName);

    let query;
    let params = [];
    if (agentFilter) {
      // r21 fix: same duplicate-SKU inflation as sales-by-agent. Dedupe lines per
      // (order_id, asin) before joining to amazon_products, then keep only ASINs
      // owned by this agent.
      query = "WITH unique_lines AS (" +
        "  SELECT TO_CHAR(o.purchase_date AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day, " +
        "         i.order_id, i.asin, " +
        "         SUM(i.item_price * i.quantity) AS gross, " +
        "         SUM(i.quantity) AS units " +
        "  FROM amazon_orders o " +
        "  JOIN amazon_order_items i ON i.order_id = o.order_id " +
        "  WHERE o.purchase_date >= NOW() - INTERVAL '" + days + " days' " +
        "  AND o.status NOT IN ('Cancelled','Canceled') " +
        "  GROUP BY day, i.order_id, i.asin" +
        "), " +
        "agent_for_asin AS (" +
        "  SELECT asin, MAX(owner_agent) AS owner_agent " +
        "  FROM amazon_products " +
        "  WHERE asin IS NOT NULL " +
        "  GROUP BY asin" +
        ") " +
        "SELECT ul.day, " +
        "       SUM(ul.gross) AS gross, " +
        "       COUNT(DISTINCT ul.order_id) AS order_count, " +
        "       SUM(ul.units) AS units " +
        "FROM unique_lines ul " +
        "JOIN agent_for_asin a ON a.asin = ul.asin " +
        "WHERE a.owner_agent = $1 " +
        "GROUP BY ul.day ORDER BY ul.day ASC";
      params = [agentFilter];
    } else {
      // Manager view — full company numbers
      query = "SELECT TO_CHAR(purchase_date AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day, " +
        "       SUM(order_total) AS gross, " +
        "       COUNT(*) AS order_count, " +
        "       SUM(num_items) AS units " +
        "FROM amazon_orders " +
        "WHERE purchase_date >= NOW() - INTERVAL '" + days + " days' " +
        "AND status NOT IN ('Cancelled','Canceled') " +
        "GROUP BY day ORDER BY day ASC";
    }
    const r = await db.query(query, params);
    const dayRows = r.rows.map(function(row) {
      return {
        date: row.day,
        gross: parseFloat(row.gross || 0),
        orders: parseInt(row.order_count || 0),
        units: parseInt(row.units || 0)
      };
    });

    // r17: pull per-day ad spend from daily_snapshots so the table can show Ad Spend + Net
    // r21: also pull campaigns array as fallback. Older snapshots sometimes have
    // metrics.totalSpend null (early r17 snapshots wrote campaigns but skipped
    // metrics roll-up). Sum campaigns[].spend in that case so historical days
    // don't show "—" gaps for spend.
    try {
      const spendRes = await db.query(
        "SELECT TO_CHAR(snapshot_date, 'YYYY-MM-DD') AS day, " +
        "       (metrics->>'totalSpend')::float AS spend, " +
        "       campaigns " +
        "FROM daily_snapshots " +
        "WHERE snapshot_date >= CURRENT_DATE - INTERVAL '" + days + " days' " +
        "ORDER BY snapshot_date ASC"
      );
      const spendByDay = {};
      spendRes.rows.forEach(function(row){
        let spend = row.spend != null ? parseFloat(row.spend) : null;
        // r21 fallback: if metrics.totalSpend missing, derive from campaigns
        if ((spend == null || isNaN(spend)) && Array.isArray(row.campaigns)) {
          spend = row.campaigns.reduce(function(s, c){ return s + parseFloat(c.spend || 0); }, 0);
        }
        if (spend != null && !isNaN(spend)) spendByDay[row.day] = spend;
      });
      dayRows.forEach(function(d){ d.spend = spendByDay[d.date] != null ? spendByDay[d.date] : null; });
    } catch(e) {
      // If snapshots/metrics not present, leave spend as null — frontend handles it
      console.error('[sales-summary] spend lookup failed: ' + e.message);
    }

    const totals = {
      gross: dayRows.reduce(function(s, d){ return s + d.gross; }, 0),
      orders: dayRows.reduce(function(s, d){ return s + d.orders; }, 0),
      units: dayRows.reduce(function(s, d){ return s + d.units; }, 0),
      spend: dayRows.reduce(function(s, d){ return s + (d.spend || 0); }, 0)
    };
    res.json({ days: dayRows, totals: totals, agentFilter: agentFilter, isManagerLevel: isManagerLevel });
  } catch(e) {
    console.error('/api/amazon/sales-summary error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
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
    const agentName = (task.agent_name && ['Aryan','Satyam'].includes(task.agent_name)) ? task.agent_name : extractAgentFromCampaign(task.campaign_name||'') || 'Unknown';
    await db.query('INSERT INTO activity_log (campaign_id, campaign_name, agent_name, action, notes, status_before, status_after, task_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [task.campaign_id||'', task.campaign_name||'', agentName, 'reopened', 'Task reopened — moved back to Due', task.status, 'open', parseInt(req.params.id)]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// r18: POST /api/tasks/:id/reassign — change the agent assigned to a task.
// Body: { agent: 'Aryan' } (or 'Unassigned')
// Manager + owner only.
app.post('/api/tasks/:id/reassign', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const userRole = (req.user && (req.user.role || '').toLowerCase()) || '';
  const isManagerLevel = ['owner','manager'].indexOf(userRole) !== -1 || (req.user && (req.user.department || '').toLowerCase() === 'manager');
  if (!isManagerLevel) return res.status(403).json({ error: 'Manager permission required' });
  const newAgent = String((req.body && req.body.agent) || '').trim();
  if (!newAgent) return res.status(400).json({ error: 'Agent required' });
  try {
    const taskRes = await db.query('SELECT * FROM campaign_tasks WHERE id=$1', [req.params.id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = taskRes.rows[0];
    const oldAgent = task.agent_name || 'Unassigned';
    await db.query('UPDATE campaign_tasks SET agent_name=$1, updated_at=NOW() WHERE id=$2', [newAgent, req.params.id]);
    const actor = (req.user && req.user.name) || 'System';
    await db.query(
      "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, task_id) VALUES ($1, $2, $3, $4, 'reassigned', $5, $6)",
      [task.campaign_id || '', task.campaign_name || '', newAgent, actor, actor + ' reassigned task from ' + oldAgent + ' to ' + newAgent, parseInt(req.params.id)]
    );
    res.json({ success: true, oldAgent: oldAgent, newAgent: newAgent });
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
    // Pull last 14 days of snapshots (newest first from DB, sorted ascending in result)
    const snapshots = await db.query("SELECT TO_CHAR(snapshot_date, 'YYYY-MM-DD') as snapshot_date, campaigns FROM daily_snapshots WHERE snapshot_date >= CURRENT_DATE - INTERVAL '14 days' ORDER BY snapshot_date ASC LIMIT 14");
    const breakdown = [];
    // r21: track snapshot days where the campaign was MISSING — distinguishes
    // "campaign didn't exist yet" (first appearance), "campaign was paused"
    // (in snapshot with zero values), and "snapshot didn't run" (day absent
    // from snapshots entirely). The frontend uses this to explain the day-2
    // bug class where only 1 row appears.
    const allSnapshotDays = snapshots.rows.map(function(s) {
      return typeof s.snapshot_date === 'string' ? s.snapshot_date : new Date(s.snapshot_date).toISOString().slice(0,10);
    });
    const daysWithCampaign = [];
    snapshots.rows.forEach(function(snap) {
      const c = (snap.campaigns||[]).find(function(x){ return String(x.campaignId) === String(campaignId); });
      // r7a fix: include EVERY day the campaign existed in the snapshot, not just days with activity.
      // Previous filter `c.spend > 0 || c.sales > 0` hid days where the campaign was paused/zero-impression,
      // making older tasks look like they had only 1 row of data when in fact 5+ days had passed.
      if (c) {
        const d = typeof snap.snapshot_date === 'string' ? snap.snapshot_date : new Date(snap.snapshot_date).toLocaleDateString('en-GB', {timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'}).split('/').reverse().join('-');
        daysWithCampaign.push(d);
        breakdown.push({
          date: d,
          spend: parseFloat(c.spend||0).toFixed(2),
          sales: parseFloat(c.sales||0).toFixed(2),
          acos: c.acos||0,
          impressions: c.impressions||0,
          clicks: c.clicks||0,
          // r7a addition: conversions / orders count for the day
          conversions: parseInt(c.orders||c.purchases||c.conversions||0)
        });
      }
    });
    // Show newest first in the UI table (matches the original look)
    breakdown.reverse();
    // r21: build a coverage note so the UI can explain "1 row" vs "campaign young"
    const missingDays = allSnapshotDays.filter(function(d){ return daysWithCampaign.indexOf(d) === -1; });
    let note = null;
    if (breakdown.length === 0) {
      note = 'No daily data found — campaign may not be in any snapshot yet.';
    } else if (allSnapshotDays.length > 0 && breakdown.length < allSnapshotDays.length) {
      // Campaign appeared in some snapshots but not others.
      // Most common case: campaign was created recently — earlier snapshots predate it.
      const earliestWith = daysWithCampaign.sort()[0];
      note = 'Campaign first appears in snapshot on ' + earliestWith +
             '. Earlier days (' + missingDays.length + ') predate the campaign or had a snapshot run that did not include it.';
    }
    res.json({
      breakdown: breakdown,
      coverage: {
        snapshot_days_total: allSnapshotDays.length,
        days_campaign_present: daysWithCampaign.length,
        days_campaign_missing: missingDays.length,
        missing_dates: missingDays
      },
      note: note
    });
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
    // r25b: include any agent feedback for this campaign so the AI takes it into account
    const feedbackSection = await buildFeedbackPromptSection('amazon_campaign', campaignId);
    const prompt = 'You are an Amazon PPC expert analyzing a campaign for FK Sports UK (fitness equipment).\n\nCAMPAIGN ID: ' + campaignId + '\nLAST 14 DAYS:\n' + JSON.stringify(history, null, 2) + '\n\nSUMMARY:\n- Total spend: £' + totalSpend.toFixed(2) + '\n- Total revenue: £' + totalSales.toFixed(2) + '\n- Days with spend but zero revenue: ' + daysNoRevenue + '\n- Days with zero impressions: ' + daysNoActivity + dismissedSection + feedbackSection + '\n\nProvide:\n1. Likely root cause\n2. One specific recommended action\n3. Worth continuing or pause?\n\nBe direct. No generic advice.';
    // r25b: Haiku-then-Opus instead of Opus-only. Saves ~80% on cost for routine
    // analyses while still escalating when output looks thin.
    const ai = await aiHaikuThenOpus(prompt, { max_tokens: 400 });
    res.json({ analysis: ai.text, modelUsed: ai.modelUsed, totalSpend, totalSales, daysNoRevenue, daysNoActivity });
  } catch(e) { console.error('Campaign analysis error: ' + e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/stuck-campaigns', async function(req, res) {
  if (!db) return res.json({ noActivity: [], noRevenue: [] });
  try {
    const result = await db.query('SELECT snapshot_date, campaigns FROM daily_snapshots ORDER BY snapshot_date DESC LIMIT 7');
    const snapshots = result.rows;
    if (snapshots.length < 3) return res.json({ noActivity: [], noRevenue: [], days: snapshots.length });
    // r23: pre-fetch active snoozes so we can hide snoozed campaigns from the list.
    // Auto-cleanup expired ones on every read.
    const snoozedSet = new Set();
    try {
      await db.query("DELETE FROM amazon_campaign_snooze WHERE snoozed_until <= NOW()");
      const sRes = await db.query("SELECT campaign_id FROM amazon_campaign_snooze WHERE snoozed_until > NOW()");
      sRes.rows.forEach(function(r){ snoozedSet.add(String(r.campaign_id)); });
    } catch(e) {
      if (!/does not exist/.test(e.message)) console.error('[r23] campaign-snooze lookup: ' + e.message);
    }
    const campHistory = {};
    snapshots.forEach(function(snap) {
      const camps = snap.campaigns || [];
      const date = snap.snapshot_date;
      camps.forEach(function(c) {
        if (snoozedSet.has(String(c.campaignId))) return;  // r23: skip snoozed
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
  try {
    const result = await db.query("SELECT * FROM campaign_tasks WHERE agent_name IN ('Aryan','Satyam') ORDER BY score DESC, created_date DESC LIMIT 500");
    // r21: bulk-fetch subtask counts for all tasks in one query — no N+1
    const taskIds = result.rows.map(function(r){ return r.id; });
    const subtaskCounts = {};
    if (taskIds.length > 0) {
      try {
        const subRes = await db.query(
          "SELECT task_id, status, COUNT(*)::int AS cnt FROM task_subtasks " +
          "WHERE task_id = ANY($1::int[]) GROUP BY task_id, status",
          [taskIds]
        );
        subRes.rows.forEach(function(row) {
          if (!subtaskCounts[row.task_id]) subtaskCounts[row.task_id] = { open: 0, complete: 0, dismissed: 0, total: 0 };
          subtaskCounts[row.task_id][row.status] = row.cnt;
          subtaskCounts[row.task_id].total += row.cnt;
        });
      } catch(subErr) { console.error('[r21] subtask count fetch error: ' + subErr.message); }
    }
    // r7b: enrich each row with computed timeline fields so the frontend doesn't
    // have to know about working days. working_days_open is the canonical age count;
    // task_stage is recomputed live (the cron persists it but live computation is
    // safer for tasks that haven't been reviewed by the cron yet).
    const today = new Date();
    const tasks = result.rows.map(function(t) {
      const wdo = workingDaysBetween(t.created_date, today);
      const liveStage = stageForWorkingDay(wdo);
      const milestone = milestoneInfo(wdo);
      // Created today AND no first_action AND it's now past 23:59 of creation day → not started warning.
      // For now we treat any task with same-day created_date and no first_action as "not started"
      // (display layer decides whether to show grace-period or warning styling).
      const createdTodayLondon = workingDaysBetween(t.created_date, today) === 0 && toLondonDate(t.created_date).getTime() === toLondonDate(today).getTime();
      const notStarted = !t.first_action_at && wdo >= 1; // no action on/before yesterday
      // r22: Day-7 review pattern (mirrors Google flow). At wdo >= 7, agent
      // must hit Carry on / Archive / Stop with note before task can move on.
      // The Google day7_decision columns are reused for Amazon since they're
      // on the same campaign_tasks table.
      const atDay7 = wdo >= 7 && !t.day7_decision && t.status !== 'complete' && t.status !== 'archived' && t.status !== 'dismissed';
      return Object.assign({}, t, {
        working_days_open: wdo,
        task_stage: liveStage,
        next_milestone: milestone.next,
        next_milestone_label: milestone.label,
        not_started_warning: notStarted,
        created_today: createdTodayLondon,
        subtask_counts: subtaskCounts[t.id] || { open: 0, complete: 0, dismissed: 0, total: 0 },
        at_day7: atDay7
      });
    });
    res.json({ tasks });
  } catch(e) { res.json({ tasks: [], error: e.message }); }
});


app.post('/api/tasks/:id/status', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  const { status, notes, dismissedReason, pausedReason, escalationReason } = req.body;
  try {
    const taskRes = await db.query('SELECT * FROM campaign_tasks WHERE id=$1', [req.params.id]);
    const task = taskRes.rows[0] || {};
    const statusBefore = task.status || 'unknown';
    // r21: gate completion behind subtasks. If any subtask is still 'open',
    // refuse the complete transition with an actionable message. Dismissed
    // counts as resolved. Tasks without subtasks (e.g. legacy / non-product
    // tasks) skip this check.
    if (status === 'complete') {
      try {
        const pendRes = await db.query(
          "SELECT COUNT(*)::int AS cnt FROM task_subtasks WHERE task_id=$1 AND status='open'",
          [req.params.id]
        );
        const pending = pendRes.rows[0] && pendRes.rows[0].cnt || 0;
        if (pending > 0) {
          return res.status(409).json({
            error: 'subtasks_pending',
            message: 'Cannot mark complete — ' + pending + ' subtask' + (pending === 1 ? '' : 's') + ' still open. Tick or dismiss each one first.',
            pending: pending
          });
        }
      } catch(gateErr) { console.error('[r21] subtask gate check error: ' + gateErr.message); }
    }
    let query, params;
    if (status === 'dismissed') { const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999); query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, dismissed_reason=$3, updated_at=NOW(), resolved_at=NOW(), suppressed_until=$4 WHERE id=$5'; params = [status, notes||'', dismissedReason||notes||'', endOfDay.toISOString(), req.params.id]; }
    else if (status === 'paused') { query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, paused_reason=$3, updated_at=NOW(), resolved_at=NOW() WHERE id=$4'; params = [status, notes||pausedReason||'', pausedReason||notes||'', req.params.id]; }
    else if (status === 'in_progress') { query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, updated_at=NOW(), first_action_at=COALESCE(first_action_at, NOW()) WHERE id=$3'; params = [status, notes||'', req.params.id]; }
    else if (status === 'scaling') { const deadline = new Date(); deadline.setDate(deadline.getDate() + 7); query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, escalation_reason=$3, scaling_deadline=$4, updated_at=NOW(), first_action_at=COALESCE(first_action_at, NOW()) WHERE id=$5'; params = [status, notes||'', escalationReason||notes||'', deadline.toISOString(), req.params.id]; }
    else if (status === 'complete') { query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, updated_at=NOW(), resolved_at=NOW(), last_resolved_date=NOW() WHERE id=$3'; params = [status, notes||'', req.params.id]; }
    else { query = 'UPDATE campaign_tasks SET status=$1, agent_notes=$2, updated_at=NOW() WHERE id=$3'; params = [status, notes||'', req.params.id]; }
    await db.query(query, params);
    try {
      const logAgent = (task.agent_name && ['Aryan','Satyam'].includes(task.agent_name)) ? task.agent_name : extractAgentFromCampaign(task.campaign_name||'') || 'Unknown';
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
    const repeatFilter = req.query.repeat === 'true' || req.query.repeat === '1'; // r25b

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
    if (repeatFilter) {
      where += " AND is_repeat_offender = TRUE";
    }
    const r = await db.query(
      "SELECT id, campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, " +
      "       days_persisted, total_wasted, score, status, agent_notes, dismissed_reason, paused_reason, " +
      "       task_source, product_key, product_title, product_image_url, task_type, priority, " +
      "       baseline_spend, baseline_sales, baseline_acos, baseline_impressions, " +
      "       day7_decision, day7_decision_at, day7_note, " +
      "       is_repeat_offender, failure_count, " +
      "       created_date, updated_at, resolved_at, first_action_at " +
      "FROM campaign_tasks WHERE " + where + " ORDER BY priority ASC, score DESC, created_date DESC LIMIT 500",
      params
    );

    // r7b: working-day-aware timeline fields. Use the same helpers as Amazon
    // so both dashboards count days the same way (Sundays excluded).
    const now = new Date();
    const tasks = r.rows.map(function(row) {
      const wdo = workingDaysBetween(row.created_date, now);
      const liveStage = stageForWorkingDay(wdo);
      const milestone = milestoneInfo(wdo);
      // Legacy daysOpen stays as a CALENDAR-day count (Google UI uses it elsewhere).
      // working_days_open and task_stage are the new authoritative timeline fields.
      const created = row.created_date ? new Date(row.created_date).getTime() : now.getTime();
      const daysOpenCalendar = Math.max(0, Math.floor((now.getTime() - created) / 86400000));
      const notStarted = !row.first_action_at && wdo >= 1;
      return Object.assign({}, row, {
        daysOpen: daysOpenCalendar,
        atDay7: wdo >= 7 && !row.day7_decision,
        atDay4: wdo >= 4 && wdo < 7,
        working_days_open: wdo,
        task_stage: liveStage,
        next_milestone: milestone.next,
        next_milestone_label: milestone.label,
        not_started_warning: notStarted
      });
    });

    // Workload summary
    const summary = { byAgent: {}, totals: { active: 0, day7: 0, unassigned: 0, completed: 0, repeat: 0 } };
    GOOGLE_TASK_AGENTS.forEach(function(a){ summary.byAgent[a] = { open: 0, in_progress: 0, discussion: 0, day7: 0 }; });
    summary.byAgent['Unassigned'] = { open: 0, in_progress: 0, discussion: 0, day7: 0 };

    // Run a separate query for ALL tasks (not just filtered) to compute the workload summary
    const allRes = await db.query(
      "SELECT agent_name, status, created_date, day7_decision, is_repeat_offender FROM campaign_tasks WHERE department='google'"
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
      // r25b: count active repeat offenders for the badge
      if (row.is_repeat_offender) summary.totals.repeat++;
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

// r25a: dismiss a product within a campaign — creates a campaign_tasks row
// with status='dismissed' so it appears in the existing Dismissed tab and
// follows the existing auto-archive rule. No new table needed.
app.post('/api/google/tasks/dismiss-product', async function(req, res) {
  if (!db) return res.status(500).json({ error: 'No DB' });
  await ensureGoogleTaskColumns();

  const { campaignId, campaignName, campaignType, productKey, productTitle, reason } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  if (!productKey) return res.status(400).json({ error: 'productKey required' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required when dismissing a product' });

  const u = req.user || {};
  const actor = u.name || u.username || 'unknown';

  // Pull baseline metrics from current googleState if available
  let baselineSpend = 0, baselineSales = 0, baselineAcos = 0, baselineImpressions = 0;
  let resolvedCampaignName = campaignName || '';
  let resolvedCampaignType = campaignType || '';
  let resolvedProductTitle = productTitle || null;
  let productImageUrl = null;

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
  // Best-effort image lookup from shopify (same as manual-create)
  const parts = String(productKey).split('_');
  const shopifyId = parts.length >= 3 ? parts[2] : null;
  if (shopifyId) {
    const sp = (shopifyState.products || []).find(function(p){ return String(p.id) === shopifyId; });
    if (sp && sp.imageUrl) productImageUrl = sp.imageUrl;
  }

  try {
    // Insert directly with status='dismissed'. resolved_at set so day7 timer doesn't trigger.
    const r = await db.query(
      "INSERT INTO campaign_tasks " +
      "(campaign_id, campaign_name, agent_name, portfolio, problem_type, problem_detail, score, task_source, " +
      " department, product_key, product_title, baseline_spend, baseline_sales, baseline_acos, baseline_impressions, " +
      " task_type, priority, product_image_url, status, resolved_at, agent_notes) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,'manual','google',$8,$9,$10,$11,$12,$13,'problem',3,$14,'dismissed',NOW(),$15) RETURNING id",
      [
        String(campaignId),
        resolvedCampaignName || '(unnamed campaign)',
        actor,
        resolvedCampaignType || '',
        'product_dismissed',
        reason.trim(),
        Math.max(1, Math.round(baselineSpend)),
        productKey,
        resolvedProductTitle,
        baselineSpend,
        baselineSales,
        baselineAcos,
        baselineImpressions,
        productImageUrl,
        'Dismissed by ' + actor + ': ' + reason.trim()
      ]
    );
    const newId = r.rows[0] && r.rows[0].id;
    try {
      await db.query(
        "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, status_before, status_after, task_id, department) VALUES ($1,$2,$3,$4,'product_dismissed',$5,'','dismissed',$6,'google')",
        [String(campaignId), resolvedCampaignName || '', actor, actor, 'Product dismissed: ' + (resolvedProductTitle || productKey) + ' — ' + reason.trim(), newId]
      );
    } catch(e) { console.error('[GTASK] dismiss-product log error: ' + e.message); }
    res.json({ success: true, id: newId });
  } catch (e) {
    console.error('[GTASK] dismiss-product error: ' + e.message);
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
    // r25a: write the updated exhaustion log to today's snapshot so the change
    // survives restarts AND an agent approving in a later session sees the
    // "Budget added" status persist on the report. Was previously only updating
    // the in-memory state.exhaustionLog, which got wiped on every redeploy.
    if (db && log) {
      try {
        const todayStr = new Date().toLocaleString('en-CA', { timeZone: 'Europe/London' }).slice(0, 10);
        await db.query(
          "UPDATE daily_snapshots SET exhaustion_log = $1 WHERE snapshot_date = $2",
          [JSON.stringify(state.exhaustionLog), todayStr]
        );
      } catch(persistErr) { console.error('[r25a] exhaustionLog persist error: ' + persistErr.message); }
    }
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

// r7b: advance task stages once a day at 00:01 London time.
// Reads created_date for every non-archived/non-complete task and recomputes
// task_stage based on working-day count. Writes audit log entries when a stage
// actually changes (so we don't spam the log with no-op rows).
cron.schedule('1 0 * * *', function() {
  advanceTaskStages().catch(function(e){ console.error('Stage-advance cron error: ' + e.message); });
}, { timezone: 'Europe/London' });

// ── SP-API sync crons (r8) ──────────────────────────────────────────────────
// Catalogue sync: once a day at 02:30 London. Quiet hours, full refresh.
cron.schedule('30 2 * * *', function() {
  if (!spApiConfigured()) return;
  syncAmazonCatalogue().catch(function(e){ console.error('SP-API catalogue cron: ' + e.message); });
}, { timezone: 'Europe/London' });

// Orders sync: twice a day — 06:00 (covers overnight) and 14:00 (covers morning).
// r25c: now uses LastUpdatedAfter to fetch only changed orders since the last run.
// First run after deploy falls back to a 7-day window (when no HWM is stored).
// Combined with the line-items skip optimisation, typical run is ~30 calls vs ~155 before.
cron.schedule('0 6,14 * * *', async function() {
  if (!spApiConfigured()) return;
  let lastUpdatedAfter = null;
  try {
    if (db) {
      const r = await db.query("SELECT settings->>'last_orders_sync_at' AS hwm FROM app_settings WHERE id = 1");
      if (r.rows.length && r.rows[0].hwm) lastUpdatedAfter = r.rows[0].hwm;
    }
  } catch(e) { /* fall back to full mode */ }
  // Safety: if HWM is older than 24h (server downtime), do a full 7d sync anyway
  if (lastUpdatedAfter) {
    const hwmAge = Date.now() - new Date(lastUpdatedAfter).getTime();
    if (hwmAge > 24 * 3600 * 1000) {
      console.log('[r25c orders cron] HWM is ' + Math.round(hwmAge/3600000) + 'h old — falling back to full 7d sync');
      lastUpdatedAfter = null;
    }
  }
  syncAmazonOrders(7, lastUpdatedAfter ? { lastUpdatedAfter: lastUpdatedAfter } : null)
    .catch(function(e){ console.error('SP-API orders cron: ' + e.message); });
}, { timezone: 'Europe/London' });

// r20: Pricing signals refresh — 03:30 London. Runs after catalogue sync (02:30)
// so we have all current ASINs to iterate, before orders sync (06:00).
cron.schedule('30 3 * * *', function() {
  if (!spApiConfigured()) return;
  refreshAmazonPricingSignals({}).catch(function(e){ console.error('[r20-cron] pricing signals: ' + e.message); });
}, { timezone: 'Europe/London' });

// r20: Sales & Traffic Report — 04:00 London. Pulls yesterday's data
// (Amazon's report has ~24h lag). Used for Buy Box win % rolling 7-day avg.
cron.schedule('0 4 * * *', function() {
  if (!spApiConfigured()) return;
  // Yesterday in London time
  const now = new Date();
  const ldn = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  ldn.setDate(ldn.getDate() - 1);
  const dateStr = ldn.toISOString().slice(0, 10);
  fetchSalesAndTrafficReport(dateStr).catch(function(e){ console.error('[r20-cron] traffic: ' + e.message); });
}, { timezone: 'Europe/London' });

// r22: Sponsored Products advertisedProduct Report — 04:30 London. Pulls
// yesterday's per-ASIN per-campaign spend. Each product card aggregates from
// amazon_asin_ad_performance keyed by ASIN — true per-ASIN attribution.
cron.schedule('30 4 * * *', function() {
  // Yesterday in London time
  const now = new Date();
  const ldn = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  ldn.setDate(ldn.getDate() - 1);
  const dateStr = ldn.toISOString().slice(0, 10);
  fetchAdvertisedProductReport(dateStr).catch(function(e){ console.error('[r22-cron] advertisedProduct: ' + e.message); });
}, { timezone: 'Europe/London' });

async function advanceTaskStages() {
  if (!db) return;
  try {
    // Pick up every task that isn't already finished
    const result = await db.query(
      "SELECT id, campaign_id, campaign_name, agent_name, department, created_date, task_stage FROM campaign_tasks WHERE status NOT IN ('complete','archived','dismissed') AND archived_at IS NULL"
    );
    const today = new Date();
    const counters = { open: 0, discuss: 0, decide: 0, overdue: 0 };
    let advanced = 0;
    for (const t of result.rows) {
      const wdo = workingDaysBetween(t.created_date, today);
      const newStage = stageForWorkingDay(wdo);
      counters[newStage] = (counters[newStage] || 0) + 1;
      const oldStage = (t.task_stage || 'open');
      if (newStage !== oldStage) {
        try {
          await db.query(
            'UPDATE campaign_tasks SET task_stage=$1, stage_advanced_at=NOW() WHERE id=$2',
            [newStage, t.id]
          );
          // Write an audit-log entry so managers can see when a task auto-flipped.
          // Only log on stage upgrades (open→discuss→decide→overdue). Backfills on the same
          // day produce a single entry per task, not per cron tick.
          await db.query(
            "INSERT INTO activity_log (campaign_id, campaign_name, agent_name, actor_name, action, notes, status_before, status_after, department) VALUES ($1,$2,$3,'system','task_stage_advanced',$4,$5,$6,$7)",
            [String(t.campaign_id || ''), t.campaign_name || '', t.agent_name || '', 'Auto-advanced after ' + wdo + ' working day(s)', oldStage, newStage, t.department || 'amazon']
          );
          advanced++;
        } catch(e) { console.error('Stage-advance error on task ' + t.id + ': ' + e.message); }
      }
    }
    console.log('[STAGE-ADVANCE] Reviewed ' + result.rows.length + ' tasks, advanced ' + advanced + '. Distribution: ' + JSON.stringify(counters));
  } catch(e) { console.error('Stage-advance overall error: ' + e.message); }
}

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
    // r17: belt-and-braces migrations — ensure tables exist before any hydrate.
    // The initDB() code above already attempts these inside try/catch, but we've seen
    // failures on production where the table didn't get created (silent init error).
    // Run explicit CREATE TABLE IF NOT EXISTS here as a safety net.
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
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_gss_received_at ON google_state_snapshots(received_at DESC)");
      console.log('[r17-migrate] google_state_snapshots ensured');
    } catch(e) {
      console.error('[r17-migrate] google_state_snapshots failed: ' + e.message);
    }
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

    // r25a: hydrate state.exhaustionLog from today's daily_snapshots row.
    // Without this, server restarts wipe in-memory Pending entries — so when an
    // agent later approves budget, the find() in /api/budget/:id can't match and
    // the row stays "Pending" forever in the report. Hydrating today's log fixes
    // that. We only load TODAY's row (older Pending entries are already lost).
    try {
      const todayStr = new Date().toLocaleString('en-CA', { timeZone: 'Europe/London' }).slice(0, 10);
      const r = await db.query("SELECT exhaustion_log FROM daily_snapshots WHERE snapshot_date = $1", [todayStr]);
      if (r.rows.length && Array.isArray(r.rows[0].exhaustion_log)) {
        state.exhaustionLog = r.rows[0].exhaustion_log;
        const pendingCount = state.exhaustionLog.filter(function(e){ return e.action === 'Pending'; }).length;
        console.log('[r25a] hydrated exhaustionLog: ' + state.exhaustionLog.length + ' entries (' + pendingCount + ' pending)');
      } else {
        console.log('[r25a] no exhaustionLog in today\u2019s snapshot — starting empty');
      }
    } catch(e) {
      console.error('[r25a] exhaustionLog hydrate error: ' + e.message);
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

    // r25b: append agent feedback for this product to the prompt
    const gpTargetId = String(product.shopifyId || product.shopifyItemId || product.productId || '');
    let promptWithFeedback = prompt;
    if (gpTargetId) {
      try {
        const fb = await buildFeedbackPromptSection('google_product', gpTargetId);
        if (fb) promptWithFeedback = prompt + fb;
      } catch(e) { /* non-fatal */ }
    }

    // r25b: For routine (non-deep-dive) analysis, use Haiku-then-Opus to save cost.
    // Deep dives (with page content + image) still go straight to Opus because they
    // need vision + harder reasoning, and we use multimodal content blocks.
    if (!includePageContent) {
      try {
        const ai = await aiHaikuThenOpus(promptWithFeedback, { max_tokens: 700 });
        return res.json({
          analysis: ai.text,
          modelUsed: ai.modelUsed,
          visionUsed: false,
          pageFetched: false
        });
      } catch(e) {
        console.error('Google AI analyse (light) error: ' + e.message);
        return res.status(500).json({ error: e.message });
      }
    }

    // Deep dive path (page content fetched) — stays on Opus, may include vision
    const model = 'claude-opus-4-5-20251101';

    // For deep dive: also fetch the hero image and let Claude actually see it.
    const imageUrl = product.imageUrl || product.shopifyImageUrl;
    let messageContent = [{ type: 'text', text: promptWithFeedback }];
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
              { type: 'text', text: promptWithFeedback + '\n\nThe attached image is the product\'s main photo as it appears on the Shopify page and in Google ads. In plain English, comment on the image quality: is it bright and clear, is the product easy to see, does it look professional, are there any obvious issues that might put off shoppers? Avoid jargon.' }
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

    // r25b: append agent feedback for this campaign
    let promptWithFeedback = prompt;
    try {
      const fb = await buildFeedbackPromptSection('google_campaign', String(campaignId));
      if (fb) promptWithFeedback = prompt + fb;
    } catch(e) { /* non-fatal */ }

    // r25b: Haiku-then-Opus instead of Opus-only. Most campaign analyses are
    // routine; Haiku handles them well. Only escalate when output is thin.
    const ai = await aiHaikuThenOpus(promptWithFeedback, { max_tokens: 1000, min_useful_chars: 200 });
    const analysisText = ai.text;
    const modelUsedActual = ai.modelUsed;

    // Persist to 24h cache
    if (db) {
      try {
        await db.query(
          "INSERT INTO campaign_ai_cache (campaign_id, campaign_name, generated_at, analysis, model_used) " +
          "VALUES ($1, $2, NOW(), $3, $4) " +
          "ON CONFLICT (campaign_id) DO UPDATE SET campaign_name=EXCLUDED.campaign_name, generated_at=NOW(), analysis=EXCLUDED.analysis, model_used=EXCLUDED.model_used",
          [String(campaignId), campaignName, analysisText, modelUsedActual]
        );
      } catch(e) { console.error('Campaign AI cache persist error: ' + e.message); }
    }

    res.json({
      analysis: analysisText,
      campaignName: campaignName,
      campaignType: campaignType,
      productCount: allProducts.length,
      modelUsed: modelUsedActual,
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
