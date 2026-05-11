// server/logistics.js — Logistics module (r30a)
//
// Self-contained Express router for the container-shipping workflow.
// Mounted from server.js with one line:
//
//     app.use(require('./server/logistics')(db));
//
// All routes live under /api/logistics/* and are gated by the same
// requireAuth middleware that's applied globally to /api in server.js.
// We additionally check department/role on each handler — owner/manager
// see everything; agent_logistics sees everything in this module; other
// agents are blocked.
//
// Schema is managed inside this file in ensureLogisticsSchema() following
// the r29j pattern (each ALTER/CREATE in its own try/catch, idempotent,
// runs at boot, logs successes/failures).
//
// No external deps beyond what server.js already has (express, pg pool,
// multer for upload, fs/path). All file storage is on Railway disk under
// LOGISTICS_FILES_DIR (defaults to /data/logistics) — swap to R2 later.

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');

const FILES_DIR = process.env.LOGISTICS_FILES_DIR || '/data/logistics';
const DEFAULT_CAMPBELLS_WEEKLY = parseFloat(process.env.CAMPBELLS_WEEKLY_GBP || '45');

// Make sure storage dir exists at boot (best-effort)
try { fs.mkdirSync(FILES_DIR, { recursive: true }); } catch(e) { /* will retry on upload */ }

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA — ensureLogisticsSchema() runs idempotent CREATE/ALTERs.
// Pattern matches r29j: each statement in its own try/catch so one bad
// ALTER doesn't block the rest. Logs aggregate result.
// ─────────────────────────────────────────────────────────────────────────────

async function ensureLogisticsSchema(db) {
  const stmts = [
    // ── suppliers ────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS lg_suppliers (
       id SERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       contact_email TEXT,
       contact_phone TEXT,
       payment_terms TEXT NOT NULL DEFAULT '2_weeks_before_eta',
       default_loading_port TEXT,
       wechat_handle TEXT,
       is_active BOOLEAN DEFAULT TRUE,
       notes TEXT,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_suppliers_active ON lg_suppliers(is_active)`,

    // ── plans (one row per container order) ──────────────────────────────────
    `CREATE TABLE IF NOT EXISTS lg_plans (
       id SERIAL PRIMARY KEY,
       plan_number TEXT UNIQUE NOT NULL,
       supplier_id INTEGER REFERENCES lg_suppliers(id),

       -- order
       order_date DATE,
       total_amount_usd NUMERIC(12,2),
       deposit_usd NUMERIC(12,2),
       deposit_pct NUMERIC(5,2),
       deposit_received_date DATE,

       -- loading
       approx_loading_date DATE,
       actual_loading_date DATE,
       loading_port TEXT,

       -- shipping
       container_number TEXT,
       tracking_number TEXT,
       shipper_name TEXT,
       container_price_usd NUMERIC(12,2),
       bl_number TEXT,
       bl_date DATE,
       free_days INTEGER,

       -- final payment
       final_amount_usd NUMERIC(12,2),
       final_payment_due_date DATE,
       final_payment_received_date DATE,

       -- arrival
       original_eta DATE,
       new_eta DATE,
       telex_release_date DATE,

       -- disposition (gate 10)
       disposition TEXT,                  -- 'clean' | 'issues' | 'campbells' | NULL
       delivery_date DATE,                -- date arrived at FK warehouse OR Campbell's
       campbells_in_date DATE,
       campbells_out_date DATE,
       campbells_reference TEXT,
       campbells_weekly_gbp NUMERIC(8,2), -- per-plan override; falls back to DEFAULT_CAMPBELLS_WEEKLY
       campbells_routing_reason TEXT,
       campbells_estimated_retrieval DATE,

       -- audit
       created_at TIMESTAMP DEFAULT NOW(),
       created_by TEXT,
       updated_at TIMESTAMP DEFAULT NOW(),
       closed_at TIMESTAMP,
       closed_by TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_supplier ON lg_plans(supplier_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_disposition ON lg_plans(disposition)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_closed ON lg_plans(closed_at)`,

    // ── files attached to plans ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS lg_plan_files (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       slot TEXT NOT NULL,               -- 'quote' | 'pi' | 'deposit_proof' | 'final_pi' | 'final_payment_proof' | 'bl' | 'loading_photo' | 'delivery_sheet' | 'campbells_receipt' | 'other'
       filename TEXT NOT NULL,           -- original
       stored_path TEXT NOT NULL,        -- disk path
       mime_type TEXT,
       size_bytes INTEGER,
       uploaded_by TEXT,
       uploaded_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_files_plan ON lg_plan_files(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_files_slot ON lg_plan_files(plan_id, slot)`,

    // ── issues (gate 10b — issues catalogue per plan) ────────────────────────
    `CREATE TABLE IF NOT EXISTS lg_plan_issues (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       issue_type TEXT,                 -- 'stock_short' | 'damage' | 'wrong_product' | 'other'
       description TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'claim_filed' | 'resolved'
       created_at TIMESTAMP DEFAULT NOW(),
       created_by TEXT,
       resolved_at TIMESTAMP,
       resolved_by TEXT,
       resolution_note TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_issues_plan ON lg_plan_issues(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_issues_status ON lg_plan_issues(status)`,

    // ── activity log (per-plan audit) ────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS lg_activity (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER REFERENCES lg_plans(id) ON DELETE CASCADE,
       action TEXT NOT NULL,
       detail TEXT,
       actor_name TEXT,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_activity_plan ON lg_activity(plan_id, created_at DESC)`
  ];

  let ok = 0, fail = 0;
  for (const sql of stmts) {
    try { await db.query(sql); ok++; }
    catch(e) { fail++; console.error('[logistics schema] ' + e.message + ' — ' + sql.split('\n')[0]); }
  }
  console.log('[logistics schema] ' + ok + '/' + (ok+fail) + ' statements applied');
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED — default suppliers + logistics agents on first boot
// ─────────────────────────────────────────────────────────────────────────────

async function ensureLogisticsSeed(db) {
  // suppliers
  const defaultSuppliers = [
    { name: 'JMK',                                       payment_terms: '2_weeks_before_eta', default_loading_port: 'Nantong' },
    { name: 'Shanxi Shuohui Industry and Trade',         payment_terms: '2_weeks_before_eta', default_loading_port: 'Tianjin' },
    { name: 'Jinhua Jingyi Gymnastic Equipment Co.,Ltd', payment_terms: '2_weeks_before_eta', default_loading_port: 'Ningbo' },
    { name: 'Topko Product Group Ltd',                   payment_terms: '2_weeks_before_eta', default_loading_port: 'Shanghai' },
    { name: 'Shandong Xinrun Ltd',                       payment_terms: '2_days_after_bl',    default_loading_port: 'Qingdao' },
    { name: 'Others',                                    payment_terms: '2_weeks_before_eta', default_loading_port: null }
  ];
  for (const s of defaultSuppliers) {
    try {
      const exists = await db.query('SELECT id FROM lg_suppliers WHERE LOWER(name)=LOWER($1)', [s.name]);
      if (!exists.rows.length) {
        await db.query(
          'INSERT INTO lg_suppliers (name, payment_terms, default_loading_port) VALUES ($1,$2,$3)',
          [s.name, s.payment_terms, s.default_loading_port]
        );
        console.log('[logistics seed] supplier created: ' + s.name);
      }
    } catch(e) { console.error('[logistics seed] supplier ' + s.name + ': ' + e.message); }
  }

  // agents — Shauraya, Neha — department='logistics', role='agent'
  // Owner/manager existing users keep their existing access naturally.
  const defaultAgents = [
    { name: 'Shauraya', email: 'shauraya@fksports.co.uk' },
    { name: 'Neha',     email: 'neha@fksports.co.uk' }
  ];
  for (const ag of defaultAgents) {
    try {
      const exists = await db.query('SELECT id FROM users WHERE email=$1', [ag.email]);
      if (!exists.rows.length) {
        const hash = await bcrypt.hash('FKSports2024!', 10);
        await db.query(
          'INSERT INTO users (name, email, password_hash, department, role) VALUES ($1,$2,$3,$4,$5)',
          [ag.name, ag.email, hash, 'logistics', 'agent']
        );
        console.log('[logistics seed] AGENT CREATED: ' + ag.email + ' / FKSports2024!  (tell them to change on first login)');
      }
    } catch(e) { console.error('[logistics seed] agent ' + ag.email + ': ' + e.message); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isManager(u) {
  if (!u) return false;
  const r = (u.role || '').toLowerCase();
  const d = (u.department || '').toLowerCase();
  return r === 'owner' || r === 'manager' || d === 'manager';
}

function isLogisticsAllowed(u) {
  if (isManager(u)) return true;
  const d = (u.department || '').toLowerCase();
  return d === 'logistics';
}

function actor(req) { return (req.user && req.user.name) || 'unknown'; }

function todayDate() {
  // London-date string YYYY-MM-DD — consistent with rest of app
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date());
  const o = {}; parts.forEach(p => o[p.type] = p.value);
  return o.year + '-' + o.month + '-' + o.day;
}

function daysBetween(aIso, bIso) {
  // Whole days, B minus A. Both 'YYYY-MM-DD' or Date. Returns integer.
  const a = (aIso instanceof Date) ? aIso : new Date(aIso + 'T00:00:00Z');
  const b = (bIso instanceof Date) ? bIso : new Date(bIso + 'T00:00:00Z');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Compute final-payment due date from supplier terms + BL date / new ETA.
// Returns 'YYYY-MM-DD' or null.
function computeFinalPaymentDue(plan, supplier) {
  const terms = (supplier && supplier.payment_terms) || '2_weeks_before_eta';
  if (terms === '2_days_after_bl' && plan.bl_date) {
    const d = new Date(plan.bl_date); d.setUTCDate(d.getUTCDate() + 2);
    return d.toISOString().slice(0,10);
  }
  if (terms === '2_weeks_before_eta' && plan.new_eta) {
    const d = new Date(plan.new_eta); d.setUTCDate(d.getUTCDate() - 14);
    return d.toISOString().slice(0,10);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE ENGINE — given a plan row + supplier row, return:
//   { current_gate, current_gate_name, current_gate_owner, days_stuck,
//     is_overdue, overdue_days, next_action }
//
// Gates (ordered):
//   1 deposit_payment      — owner
//   2 deposit_confirmation — agent  (deposit received but no proof file yet)
//   3 loading_date         — supplier
//   4 container_booking    — agent
//   5 loading_complete     — supplier
//   6 bl_issued            — supplier
//   7 final_pi             — supplier
//   8 final_payment        — owner
//   9 uk_delivery          — agent
//  10 disposition          — agent  (clean | issues | campbells)
//
// "is_overdue" thresholds (days) — keep simple, rules per gate.
// ─────────────────────────────────────────────────────────────────────────────

function computeGate(plan, supplier) {
  // helper accessor — handle string/Date
  const has = v => v !== null && v !== undefined && v !== '';

  // already closed
  if (plan.closed_at) {
    return { current_gate: 0, current_gate_name: 'Closed', current_gate_owner: '—',
             is_overdue: false, days_stuck: 0, overdue_days: 0, next_action: null };
  }

  const today = todayDate();

  // 1 — deposit_payment
  if (!has(plan.deposit_received_date)) {
    const stuck = plan.order_date ? Math.max(0, daysBetween(plan.order_date, today)) : 0;
    return mkGate(1, 'Deposit payment', 'owner', stuck, 3, 'Pay deposit to supplier');
  }
  // 2 — deposit_confirmation: deposit received but no proof file (we don't track files here;
  // we just advance past it. Files are uploaded separately and audited.)
  // (skip — we treat 1 done means 1 done; reminder for missing file is handled at file-list level)

  // 3 — loading_date
  if (!has(plan.approx_loading_date)) {
    const stuck = Math.max(0, daysBetween(plan.deposit_received_date, today));
    return mkGate(3, 'Loading date confirmation', 'supplier', stuck, 7, 'Supplier to confirm approx loading date');
  }

  // 4 — container_booking: shipper_name AND (container_number OR actual_loading_date)
  if (!has(plan.shipper_name) && !has(plan.container_number)) {
    const daysToLoading = daysBetween(today, plan.approx_loading_date);
    // becomes "overdue" when within 21 days of loading
    const stuck = Math.max(0, daysBetween(plan.deposit_received_date, today));
    const isOverdueNow = daysToLoading <= 21;
    return mkGate(4, 'Container booking', 'agent', stuck, isOverdueNow ? 0 : 999, 'Book container with shipper');
  }

  // 5 — loading_complete: actual_loading_date filled
  if (!has(plan.actual_loading_date)) {
    const stuck = Math.max(0, daysBetween(plan.approx_loading_date, today));
    return mkGate(5, 'Loading complete', 'supplier', stuck, 0, 'Supplier to load container & upload photos');
  }

  // 6 — bl_issued
  if (!has(plan.bl_number) && !has(plan.bl_date)) {
    const stuck = Math.max(0, daysBetween(plan.actual_loading_date, today));
    return mkGate(6, 'BL issued', 'supplier', stuck, 5, 'Supplier to issue BL');
  }

  // 7 — final_pi (final_amount_usd present implies final PI received)
  if (!has(plan.final_amount_usd)) {
    const blRef = plan.bl_date || plan.actual_loading_date;
    const stuck = blRef ? Math.max(0, daysBetween(blRef, today)) : 0;
    return mkGate(7, 'Final PI', 'supplier', stuck, 3, 'Supplier to send final PI with final amount');
  }

  // 8 — final_payment
  if (!has(plan.final_payment_received_date)) {
    const due = computeFinalPaymentDue(plan, supplier);
    let overdueDays = 0; let stuck = 0;
    if (due) {
      const delta = daysBetween(due, today);
      if (delta > 0) overdueDays = delta;     // past due
      stuck = Math.max(0, delta);
    }
    return mkGate(8, 'Final payment', 'owner', stuck, 0, 'Pay supplier final amount (' + (supplier && supplier.payment_terms || '?') + ')', overdueDays > 0);
  }

  // 9 — uk_delivery (arrival at UK — telex release or ETA reached)
  // We treat new_eta passing as arrival; otherwise we wait.
  if (!has(plan.delivery_date) && !has(plan.disposition)) {
    const ref = plan.new_eta || plan.original_eta;
    const stuck = ref ? Math.max(0, daysBetween(ref, today)) : 0;
    return mkGate(9, 'UK delivery', 'agent', stuck, 0, 'Arrange UK delivery / route to FK warehouse or Campbell\'s');
  }

  // 10 — disposition — issues open?
  if (plan.disposition === 'issues') {
    return mkGate(10, 'Resolve delivery issues', 'agent', 0, 0, 'Resolve open issues to close plan');
  }
  if (!plan.disposition) {
    return mkGate(10, 'Set disposition', 'agent', 0, 0, 'Mark where the container went');
  }

  // disposition set to clean or campbells — plan is essentially done, but stays
  // open until closed_at is set (for clean) or campbells_out_date (for campbells)
  if (plan.disposition === 'clean') {
    return mkGate(10, 'Close plan', 'agent', 0, 0, 'Confirm stock and close plan');
  }
  if (plan.disposition === 'campbells') {
    return mkGate(10, 'At Campbell\'s', 'agent', 0, 0, 'Plan stays open until container retrieved');
  }

  // fallback
  return mkGate(0, 'Unknown', '—', 0, 0, null);

  function mkGate(num, name, owner, daysStuck, overdueAt, action, forceOverdue) {
    const overdue = forceOverdue || (overdueAt > 0 && daysStuck >= overdueAt) || (overdueAt === 0 && daysStuck > 0 && num !== 0);
    return {
      current_gate: num, current_gate_name: name, current_gate_owner: owner,
      days_stuck: daysStuck, is_overdue: overdue, overdue_days: overdue ? daysStuck : 0,
      next_action: action
    };
  }
}

// Compute Campbell's storage cost for a plan (if disposition='campbells')
function campbellsCost(plan) {
  if (plan.disposition !== 'campbells' || !plan.campbells_in_date) return { weeks: 0, incurred: 0, weekly: 0 };
  const weekly = parseFloat(plan.campbells_weekly_gbp) || DEFAULT_CAMPBELLS_WEEKLY;
  const endIso = plan.campbells_out_date || todayDate();
  const days = Math.max(0, daysBetween(plan.campbells_in_date, endIso));
  const weeks = days / 7;
  return { weeks: weeks, incurred: weeks * weekly, weekly };
}

// Enrich a plan row with computed fields used by the dashboard
function enrichPlan(plan, supplier) {
  const gate = computeGate(plan, supplier);
  const cost = campbellsCost(plan);
  const finalDue = computeFinalPaymentDue(plan, supplier);
  return Object.assign({}, plan, {
    supplier_name: supplier && supplier.name || null,
    supplier_payment_terms: supplier && supplier.payment_terms || null,
    ...gate,
    campbells_weeks: cost.weeks,
    campbells_incurred_gbp: cost.incurred,
    campbells_weekly_effective_gbp: cost.weekly,
    final_payment_due_date_computed: finalDue
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE UPLOAD (multer → disk)
// ─────────────────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) {
      try { fs.mkdirSync(FILES_DIR, { recursive: true }); } catch(e) {}
      cb(null, FILES_DIR);
    },
    filename: function(req, file, cb) {
      const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const id = crypto.randomBytes(8).toString('hex');
      cb(null, Date.now() + '_' + id + '_' + safe);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }    // 25 MB
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER + ROUTES
// ─────────────────────────────────────────────────────────────────────────────

module.exports = function(getDb) {
  // getDb is a function returning the current db client (may be null at mount time).
  // We rebind `db` inside each request handler. Schema/seed boot is deferred until
  // the first request OR an explicit `_bootLogistics()` call from server.js once
  // initDB() has resolved.
  const router = express.Router();
  let booted = false;

  async function bootIfReady() {
    if (booted) return;
    const db = getDb && getDb();
    if (!db) return;
    booted = true;
    try {
      await ensureLogisticsSchema(db);
      await ensureLogisticsSeed(db);
    } catch(e) { console.error('[logistics boot] ' + e.message); }
  }
  // Expose for server.js to call once initDB() completes.
  router._boot = bootIfReady;

  // Gate middleware — runs before every request. Also lazy-boots schema on first hit.
  router.use(async function(req, res, next) {
    await bootIfReady();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Logistics access denied' });
    // attach db to req for handlers below
    req._db = getDb();
    if (!req._db) return res.status(503).json({ error: 'Database not ready' });
    next();
  });

  // ── meta: whoami + defaults ────────────────────────────────────────────────
  router.get('/me', function(req, res) {
    res.json({
      name: req.user.name, email: req.user.email,
      role: req.user.role, department: req.user.department,
      is_manager: isManager(req.user),
      defaults: { campbells_weekly_gbp: DEFAULT_CAMPBELLS_WEEKLY }
    });
  });

  // ── suppliers ──────────────────────────────────────────────────────────────
  router.get('/suppliers', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_suppliers WHERE is_active=TRUE ORDER BY name');
      res.json({ suppliers: r.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/suppliers', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    const { name, contact_email, contact_phone, payment_terms, default_loading_port, wechat_handle } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name required' });
    try {
      const r = await db.query(
        `INSERT INTO lg_suppliers (name, contact_email, contact_phone, payment_terms, default_loading_port, wechat_handle)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [name, contact_email || null, contact_phone || null, payment_terms || '2_weeks_before_eta',
         default_loading_port || null, wechat_handle || null]
      );
      res.json({ supplier: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/suppliers/:id', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    const id = parseInt(req.params.id);
    const fields = ['name','contact_email','contact_phone','payment_terms','default_loading_port','wechat_handle','is_active','notes'];
    const sets = []; const vals = []; let i = 1;
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
        sets.push(f + '=$' + (i++));
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(id);
    try {
      const r = await db.query('UPDATE lg_suppliers SET ' + sets.join(',') + ' WHERE id=$' + i + ' RETURNING *', vals);
      res.json({ supplier: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── plans: list (with computed fields) ─────────────────────────────────────
  router.get('/plans', async function(req, res) {
    const db = req._db;
    try {
      const sql = `
        SELECT p.*, s.name AS supplier_name, s.payment_terms AS supplier_payment_terms
        FROM lg_plans p
        LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
        ORDER BY p.created_at DESC
      `;
      const r = await db.query(sql);
      const supplierMap = {};
      const sup = await db.query('SELECT * FROM lg_suppliers');
      sup.rows.forEach(function(s){ supplierMap[s.id] = s; });

      const enriched = r.rows.map(function(p){ return enrichPlan(p, supplierMap[p.supplier_id]); });

      // counts useful for navbar dot
      const counts = {
        total: enriched.length,
        open: enriched.filter(p => !p.closed_at).length,
        overdue: enriched.filter(p => p.is_overdue).length,
        at_campbells: enriched.filter(p => p.disposition === 'campbells' && !p.campbells_out_date).length,
        with_issues: enriched.filter(p => p.disposition === 'issues').length
      };
      res.json({ plans: enriched, counts });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── plans: counts only (lightweight — used for nav badge) ──────────────────
  router.get('/counts', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query(`
        SELECT p.*, s.payment_terms AS supplier_payment_terms
        FROM lg_plans p LEFT JOIN lg_suppliers s ON s.id=p.supplier_id
        WHERE p.closed_at IS NULL
      `);
      const supMap = {};
      (await db.query('SELECT * FROM lg_suppliers')).rows.forEach(s => supMap[s.id] = s);
      let overdue = 0, campbells = 0, issues = 0;
      r.rows.forEach(function(p){
        const g = computeGate(p, supMap[p.supplier_id]);
        if (g.is_overdue) overdue++;
        if (p.disposition === 'campbells' && !p.campbells_out_date) campbells++;
        if (p.disposition === 'issues') issues++;
      });
      res.json({ open: r.rows.length, overdue, at_campbells: campbells, with_issues: issues });
    } catch(e) { res.json({ open:0, overdue:0, at_campbells:0, with_issues:0 }); }
  });

  // ── plans: get one ─────────────────────────────────────────────────────────
  router.get('/plans/:id', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_plans WHERE id=$1', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      const plan = r.rows[0];
      const sup = plan.supplier_id ? (await db.query('SELECT * FROM lg_suppliers WHERE id=$1', [plan.supplier_id])).rows[0] : null;
      const files = (await db.query('SELECT id, slot, filename, mime_type, size_bytes, uploaded_by, uploaded_at FROM lg_plan_files WHERE plan_id=$1 ORDER BY uploaded_at DESC', [plan.id])).rows;
      const issues = (await db.query('SELECT * FROM lg_plan_issues WHERE plan_id=$1 ORDER BY created_at DESC', [plan.id])).rows;
      const activity = (await db.query('SELECT * FROM lg_activity WHERE plan_id=$1 ORDER BY created_at DESC LIMIT 50', [plan.id])).rows;
      res.json({ plan: enrichPlan(plan, sup), supplier: sup, files, issues, activity });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── plans: create ──────────────────────────────────────────────────────────
  router.post('/plans', async function(req, res) {
    const db = req._db;
    const {
      plan_number, supplier_id, order_date, total_amount_usd, deposit_usd, deposit_pct,
      approx_loading_date, loading_port, original_eta, new_eta
    } = req.body || {};
    if (!plan_number) return res.status(400).json({ error: 'plan_number required' });
    if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
    try {
      const r = await db.query(`
        INSERT INTO lg_plans
          (plan_number, supplier_id, order_date, total_amount_usd, deposit_usd, deposit_pct,
           approx_loading_date, loading_port, original_eta, new_eta, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *
      `, [plan_number, supplier_id, order_date || null, total_amount_usd || null,
          deposit_usd || null, deposit_pct || null, approx_loading_date || null,
          loading_port || null, original_eta || null, new_eta || null, actor(req)]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [r.rows[0].id, 'created', 'Plan ' + plan_number + ' created', actor(req)]);
      res.json({ plan: r.rows[0] });
    } catch(e) {
      if (String(e.message).includes('duplicate')) return res.status(409).json({ error: 'plan_number already exists' });
      res.status(500).json({ error: e.message });
    }
  });

  // ── plans: patch — generic field update with activity log ──────────────────
  router.patch('/plans/:id', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const updatable = [
      'supplier_id','order_date','total_amount_usd','deposit_usd','deposit_pct','deposit_received_date',
      'approx_loading_date','actual_loading_date','loading_port',
      'container_number','tracking_number','shipper_name','container_price_usd','bl_number','bl_date','free_days',
      'final_amount_usd','final_payment_due_date','final_payment_received_date',
      'original_eta','new_eta','telex_release_date',
      'disposition','delivery_date',
      'campbells_in_date','campbells_out_date','campbells_reference','campbells_weekly_gbp',
      'campbells_routing_reason','campbells_estimated_retrieval'
    ];
    const sets = []; const vals = []; let i = 1;
    const changes = [];
    for (const f of updatable) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
        sets.push(f + '=$' + (i++));
        vals.push(req.body[f] === '' ? null : req.body[f]);
        changes.push(f);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at=NOW()');
    vals.push(id);
    try {
      const r = await db.query('UPDATE lg_plans SET ' + sets.join(',') + ' WHERE id=$' + i + ' RETURNING *', vals);
      if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'updated', 'Fields: ' + changes.join(', '), actor(req)]);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── plans: close ───────────────────────────────────────────────────────────
  router.post('/plans/:id/close', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user) && (req.user.department || '').toLowerCase() !== 'logistics') {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const id = parseInt(req.params.id);
    try {
      const r = await db.query('UPDATE lg_plans SET closed_at=NOW(), closed_by=$1 WHERE id=$2 RETURNING *', [actor(req), id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'closed', 'Plan closed', actor(req)]);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── plans: reopen ─────────────────────────────────────────────────────────
  router.post('/plans/:id/reopen', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    const id = parseInt(req.params.id);
    try {
      const r = await db.query('UPDATE lg_plans SET closed_at=NULL, closed_by=NULL WHERE id=$1 RETURNING *', [id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'reopened', 'Plan reopened', actor(req)]);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── plans: delete (owner only) ─────────────────────────────────────────────
  router.delete('/plans/:id', async function(req, res) {
    const db = req._db;
    if ((req.user.role || '').toLowerCase() !== 'owner') return res.status(403).json({ error: 'Owner only' });
    try {
      await db.query('DELETE FROM lg_plans WHERE id=$1', [parseInt(req.params.id)]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── files ──────────────────────────────────────────────────────────────────
  router.post('/plans/:id/files', upload.single('file'), async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const slot = (req.body.slot || 'other').toLowerCase();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const r = await db.query(`
        INSERT INTO lg_plan_files (plan_id, slot, filename, stored_path, mime_type, size_bytes, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [id, slot, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, actor(req)]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'file_uploaded', slot + ': ' + req.file.originalname, actor(req)]);
      res.json({ file: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/files/:id/download', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_plan_files WHERE id=$1', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).send('Not found');
      const f = r.rows[0];
      if (!fs.existsSync(f.stored_path)) return res.status(410).send('File missing on disk (likely lost on redeploy)');
      res.download(f.stored_path, f.filename);
    } catch(e) { res.status(500).send(e.message); }
  });

  router.delete('/files/:id', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_plan_files WHERE id=$1', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      const f = r.rows[0];
      try { fs.unlinkSync(f.stored_path); } catch(e) {}
      await db.query('DELETE FROM lg_plan_files WHERE id=$1', [f.id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [f.plan_id, 'file_deleted', f.slot + ': ' + f.filename, actor(req)]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── issues ─────────────────────────────────────────────────────────────────
  router.post('/plans/:id/issues', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const { issue_type, description } = req.body || {};
    if (!description) return res.status(400).json({ error: 'description required' });
    try {
      const r = await db.query(`
        INSERT INTO lg_plan_issues (plan_id, issue_type, description, created_by)
        VALUES ($1,$2,$3,$4) RETURNING *
      `, [id, issue_type || 'other', description, actor(req)]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'issue_added', description.slice(0, 100), actor(req)]);
      res.json({ issue: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/issues/:id', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const { status, resolution_note } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status required' });
    try {
      let sql, vals;
      if (status === 'resolved') {
        sql = 'UPDATE lg_plan_issues SET status=$1, resolved_at=NOW(), resolved_by=$2, resolution_note=$3 WHERE id=$4 RETURNING *';
        vals = [status, actor(req), resolution_note || null, id];
      } else {
        sql = 'UPDATE lg_plan_issues SET status=$1 WHERE id=$2 RETURNING *';
        vals = [status, id];
      }
      const r = await db.query(sql, vals);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [r.rows[0].plan_id, 'issue_' + status, r.rows[0].description.slice(0, 100), actor(req)]);
      res.json({ issue: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── dashboard summary — feeds the operational "this week / next week" view ─
  router.get('/dashboard', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query(`
        SELECT p.*, s.name AS supplier_name, s.payment_terms AS supplier_payment_terms
        FROM lg_plans p LEFT JOIN lg_suppliers s ON s.id=p.supplier_id
        ORDER BY p.created_at DESC
      `);
      const supMap = {};
      (await db.query('SELECT * FROM lg_suppliers')).rows.forEach(s => supMap[s.id] = s);
      const enriched = r.rows.map(p => enrichPlan(p, supMap[p.supplier_id]));

      const today = todayDate();
      const weekFromNow = new Date(); weekFromNow.setUTCDate(weekFromNow.getUTCDate() + 7);
      const twoWeeksFromNow = new Date(); twoWeeksFromNow.setUTCDate(twoWeeksFromNow.getUTCDate() + 14);
      const weekIso = weekFromNow.toISOString().slice(0,10);
      const twoWeekIso = twoWeeksFromNow.toISOString().slice(0,10);

      // bucket plans
      const inFlight       = enriched.filter(p => !p.closed_at);
      const overdue        = enriched.filter(p => !p.closed_at && p.is_overdue);
      const atCampbells    = enriched.filter(p => p.disposition === 'campbells' && !p.campbells_out_date);
      const withIssues     = enriched.filter(p => p.disposition === 'issues');

      // operational lists
      const loadingThisWeek    = inFlight.filter(p => p.approx_loading_date && p.approx_loading_date <= weekIso && !p.actual_loading_date);
      const loadingNextWeek    = inFlight.filter(p => p.approx_loading_date && p.approx_loading_date > weekIso && p.approx_loading_date <= twoWeekIso && !p.actual_loading_date);
      const arrivingThisWeek   = inFlight.filter(p => p.new_eta && p.new_eta <= weekIso && !p.delivery_date && !p.disposition);
      const arrivingNextWeek   = inFlight.filter(p => p.new_eta && p.new_eta > weekIso && p.new_eta <= twoWeekIso && !p.delivery_date && !p.disposition);
      const paymentsDueSoon    = inFlight.filter(p => {
        if (p.final_payment_received_date) return false;
        const due = p.final_payment_due_date_computed;
        return due && due <= twoWeekIso;
      });

      // money in transit (between BL issued and arrival)
      let valueInTransit = 0;
      enriched.forEach(p => {
        if (!p.closed_at && p.bl_date && !p.delivery_date) {
          valueInTransit += parseFloat(p.total_amount_usd || 0);
        }
      });

      let owedNext14 = 0;
      paymentsDueSoon.forEach(p => {
        const owe = parseFloat(p.final_amount_usd || (p.total_amount_usd || 0) - (p.deposit_usd || 0));
        owedNext14 += isNaN(owe) ? 0 : owe;
      });

      let campbellsWeeklyTotal = 0;
      let campbellsIncurredTotal = 0;
      atCampbells.forEach(p => {
        campbellsWeeklyTotal   += parseFloat(p.campbells_weekly_effective_gbp || 0);
        campbellsIncurredTotal += parseFloat(p.campbells_incurred_gbp || 0);
      });

      res.json({
        kpis: {
          in_flight: inFlight.length,
          overdue:   overdue.length,
          value_in_transit_usd: Math.round(valueInTransit),
          at_campbells:  atCampbells.length,
          campbells_weekly_gbp: Math.round(campbellsWeeklyTotal * 100) / 100,
          campbells_incurred_gbp: Math.round(campbellsIncurredTotal * 100) / 100,
          owed_next_14_usd: Math.round(owedNext14),
          with_issues: withIssues.length
        },
        operational: {
          loading_this_week: loadingThisWeek,
          loading_next_week: loadingNextWeek,
          arriving_this_week: arrivingThisWeek,
          arriving_next_week: arrivingNextWeek,
          payments_due_soon: paymentsDueSoon
        },
        lanes: {
          at_campbells: atCampbells,
          with_issues: withIssues
        },
        all_in_flight: inFlight,
        overdue
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
