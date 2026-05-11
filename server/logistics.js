// server/logistics.js — Logistics module (r30b)
//
// r30b additions over r30a:
//   • Tasks engine — auto-trigger reminders driven by plan state
//   • Recurring ETA-check task (single live task, bumping next_eta_check_date)
//   • Restructured gates to match real workflow
//   • Customs duty chain (Mahima)
//   • Shipper payment (explicit)
//   • Slip reason tracking
//   • Plan status (active/cancelled/closed)
//   • Remarks + shipping_notes fields
//   • Supplier shareable form (no auth, token-based)
//   • Bilingual EN/中文 task titles
//   • Kemballs terminology
//
// Mounted from server.js:
//   const logisticsRouter = require('./server/logistics')(function(){ return db; });
//   app.use('/api/logistics', logisticsRouter);
//   app.use('/s', logisticsRouter._supplierShare);
//   on initDB resolved: await logisticsRouter._boot();

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');

const FILES_DIR = process.env.LOGISTICS_FILES_DIR || '/data/logistics';
const DEFAULT_KEMBALLS_WEEKLY = parseFloat(process.env.KEMBALLS_WEEKLY_GBP || process.env.CAMPBELLS_WEEKLY_GBP || '45');

try { fs.mkdirSync(FILES_DIR, { recursive: true }); } catch(e) {}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA — additive
// ─────────────────────────────────────────────────────────────────────────────

async function ensureLogisticsSchema(db) {
  const stmts = [
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
    `CREATE TABLE IF NOT EXISTS lg_plans (
       id SERIAL PRIMARY KEY,
       plan_number TEXT UNIQUE NOT NULL,
       supplier_id INTEGER REFERENCES lg_suppliers(id),
       order_date DATE,
       total_amount_usd NUMERIC(12,2),
       deposit_usd NUMERIC(12,2),
       deposit_pct NUMERIC(5,2),
       deposit_received_date DATE,
       approx_loading_date DATE,
       actual_loading_date DATE,
       loading_port TEXT,
       container_number TEXT,
       tracking_number TEXT,
       shipper_name TEXT,
       container_price_usd NUMERIC(12,2),
       bl_number TEXT,
       bl_date DATE,
       free_days INTEGER,
       final_amount_usd NUMERIC(12,2),
       final_payment_due_date DATE,
       final_payment_received_date DATE,
       original_eta DATE,
       new_eta DATE,
       telex_release_date DATE,
       disposition TEXT,
       delivery_date DATE,
       campbells_in_date DATE,
       campbells_out_date DATE,
       campbells_reference TEXT,
       campbells_weekly_gbp NUMERIC(8,2),
       campbells_routing_reason TEXT,
       campbells_estimated_retrieval DATE,
       created_at TIMESTAMP DEFAULT NOW(),
       created_by TEXT,
       updated_at TIMESTAMP DEFAULT NOW(),
       closed_at TIMESTAMP,
       closed_by TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_supplier ON lg_plans(supplier_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_disposition ON lg_plans(disposition)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_closed ON lg_plans(closed_at)`,
    `CREATE TABLE IF NOT EXISTS lg_plan_files (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       slot TEXT NOT NULL,
       filename TEXT NOT NULL,
       stored_path TEXT NOT NULL,
       mime_type TEXT,
       size_bytes INTEGER,
       uploaded_by TEXT,
       uploaded_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_files_plan ON lg_plan_files(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_files_slot ON lg_plan_files(plan_id, slot)`,
    `CREATE TABLE IF NOT EXISTS lg_plan_issues (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       issue_type TEXT,
       description TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'open',
       created_at TIMESTAMP DEFAULT NOW(),
       created_by TEXT,
       resolved_at TIMESTAMP,
       resolved_by TEXT,
       resolution_note TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_issues_plan ON lg_plan_issues(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_issues_status ON lg_plan_issues(status)`,
    `CREATE TABLE IF NOT EXISTS lg_activity (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER REFERENCES lg_plans(id) ON DELETE CASCADE,
       action TEXT NOT NULL,
       detail TEXT,
       actor_name TEXT,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_activity_plan ON lg_activity(plan_id, created_at DESC)`,
    // r30b additions
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS remarks TEXT`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS shipping_notes TEXT`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS shipper_payment_made BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS shipper_payment_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS telex_confirmed_by_agent BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS telex_supplier_declared BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS telex_supplier_declared_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS supplier_final_payment_acknowledged BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS duty_invoice_amount_gbp NUMERIC(12,2)`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS duty_invoice_received_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS duty_paid_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS docs_sent_to_import_agent_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS customs_cleared_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS local_delivery_booked_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS local_delivery_partner TEXT`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS next_eta_check_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS supplier_share_token TEXT UNIQUE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS supplier_form_locked BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS supplier_submitted_by TEXT`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS supplier_last_submitted_at TIMESTAMP`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS cancelled_by TEXT`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_status ON lg_plans(status)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_share_token ON lg_plans(supplier_share_token)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_eta_check ON lg_plans(next_eta_check_date)`,
    `CREATE TABLE IF NOT EXISTS lg_date_slips (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       field_name TEXT NOT NULL,
       previous_value DATE,
       new_value DATE,
       slip_days INTEGER,
       reason TEXT,
       reason_category TEXT,
       changed_by TEXT,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_slips_plan ON lg_date_slips(plan_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS lg_production_checks (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       check_label TEXT NOT NULL,
       outcome TEXT NOT NULL,
       note TEXT,
       checked_by TEXT,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_prodchecks_plan ON lg_production_checks(plan_id)`,
    `CREATE TABLE IF NOT EXISTS lg_tasks (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       rule_key TEXT NOT NULL,
       title TEXT NOT NULL,
       title_cn TEXT,
       intended_role TEXT,
       priority TEXT DEFAULT 'normal',
       due_date DATE,
       status TEXT NOT NULL DEFAULT 'open',
       claimed_by TEXT,
       claimed_at TIMESTAMP,
       completed_by TEXT,
       completed_at TIMESTAMP,
       completion_note TEXT,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_tasks_plan ON lg_tasks(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_tasks_status ON lg_tasks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_tasks_due ON lg_tasks(due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_tasks_rule_plan ON lg_tasks(plan_id, rule_key)`
  ];
  let ok = 0, fail = 0;
  for (const sql of stmts) {
    try { await db.query(sql); ok++; }
    catch(e) { fail++; console.error('[logistics schema] ' + e.message + ' — ' + sql.split('\n')[0].slice(0,80)); }
  }
  console.log('[logistics schema r30b] ' + ok + '/' + (ok+fail) + ' statements applied');
}

async function ensureLogisticsSeed(db) {
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
  const defaultAgents = [
    { name: 'Shauraya', email: 'shauraya@fksports.co.uk' },
    { name: 'Neha',     email: 'neha@fksports.co.uk' },
    { name: 'Mahima',   email: 'mahima@fksports.co.uk' }
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
        console.log('[logistics seed] AGENT CREATED: ' + ag.email + ' / FKSports2024!');
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
  return (u.department || '').toLowerCase() === 'logistics';
}
function actor(req) { return (req.user && req.user.name) || 'unknown'; }
function todayDate() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const o = {}; parts.forEach(p => o[p.type] = p.value);
  return o.year + '-' + o.month + '-' + o.day;
}
function asIso(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0,10);
  return d.toISOString().slice(0,10);
}
function daysBetween(a, b) {
  const da = (a instanceof Date) ? a : new Date(asIso(a) + 'T00:00:00Z');
  const db = (b instanceof Date) ? b : new Date(asIso(b) + 'T00:00:00Z');
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
function addDays(iso, n) {
  const d = new Date(asIso(iso) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}
function genToken() { return crypto.randomBytes(16).toString('hex'); }

function computeFinalPaymentDue(plan, supplier) {
  const terms = (supplier && supplier.payment_terms) || '2_weeks_before_eta';
  if (terms === '2_days_after_bl' && plan.bl_date) return addDays(plan.bl_date, 2);
  if (terms === '2_weeks_before_eta' && plan.original_eta) return addDays(plan.original_eta, -14);
  return null;
}

function computeStage(plan, supplier) {
  const has = v => v !== null && v !== undefined && v !== '';
  const today = todayDate();
  if (plan.status === 'cancelled') return mk(0, 'Cancelled', '—', 0, false, null);
  if (plan.closed_at)              return mk(0, 'Closed',    '—', 0, false, null);
  if (!has(plan.deposit_received_date)) {
    const stuck = plan.order_date ? Math.max(0, daysBetween(plan.order_date, today)) : 0;
    return mk(1, 'Pay deposit', 'accounts', stuck, stuck > 2, 'Pay deposit to supplier');
  }
  if (!has(plan.approx_loading_date)) {
    const stuck = Math.max(0, daysBetween(plan.deposit_received_date, today));
    return mk(2, 'Get approx loading date', 'agent', stuck, stuck > 3, 'Chase supplier for approx loading date');
  }
  if (!has(plan.shipper_name) && !has(plan.container_price_usd)) {
    const daysToLoad = daysBetween(today, plan.approx_loading_date);
    return mk(3, 'Book container', 'agent', Math.max(0, -daysToLoad), daysToLoad <= 14, 'Book container with shipper, agree price');
  }
  if (!has(plan.actual_loading_date) || !has(plan.bl_number)) {
    const stuck = Math.max(0, daysBetween(plan.approx_loading_date, today));
    return mk(4, 'Loading & docs', 'supplier', stuck, stuck > 7, 'Supplier to load + upload BL/PI/PL');
  }
  if (!has(plan.final_payment_received_date) || !plan.shipper_payment_made) {
    const due = computeFinalPaymentDue(plan, supplier);
    const overdue = due ? daysBetween(due, today) > 0 : false;
    return mk(5, 'Final + shipper payment', 'accounts', Math.max(0, due ? daysBetween(due, today) : 0), overdue, 'Pay supplier final + pay shipper');
  }
  if (!plan.telex_confirmed_by_agent) {
    return mk(6, 'Telex release', 'agent', 0, false, plan.telex_supplier_declared ? 'Verify telex (supplier declared)' : 'Awaiting supplier telex confirmation');
  }
  if (!has(plan.docs_sent_to_import_agent_date)) {
    return mk(7, 'Send docs to import agent', 'agent', 0, false, 'Send BL + PI + Packing List to import agent');
  }
  if (!has(plan.duty_paid_date)) {
    if (!has(plan.duty_invoice_received_date)) return mk(8, 'Awaiting duty invoice', 'accounts', 0, false, 'Waiting for duty invoice from import agent');
    return mk(8, 'Pay UK customs duty', 'accounts', 0, false, 'Mahima to pay duty');
  }
  if (!has(plan.customs_cleared_date)) return mk(9, 'Confirm customs cleared', 'agent', 0, false, 'Confirm customs clearance');
  if (!has(plan.disposition))         return mk(10, 'Decide disposition', 'agent', 0, false, 'Warehouse or Kemballs');
  if (plan.disposition === 'issues')  return mk(11, 'Resolve issues', 'agent', 0, false, 'Resolve open issues to close plan');
  if (plan.disposition === 'campbells') return mk(11, 'At Kemballs', 'agent', 0, false, 'Plan stays open until container retrieved');
  if (plan.disposition === 'clean')   return mk(11, 'Close plan', 'agent', 0, false, 'Confirm stock and close plan');
  return mk(0, 'Unknown', '—', 0, false, null);

  function mk(n, name, owner, days, overdue, action) {
    return { current_gate: n, current_gate_name: name, current_gate_owner: owner,
             days_stuck: days, is_overdue: overdue, overdue_days: overdue ? days : 0, next_action: action };
  }
}

function kemballsCost(plan) {
  if (plan.disposition !== 'campbells' || !plan.campbells_in_date) return { weeks: 0, incurred: 0, weekly: 0 };
  const weekly = parseFloat(plan.campbells_weekly_gbp) || DEFAULT_KEMBALLS_WEEKLY;
  const endIso = plan.campbells_out_date || todayDate();
  const days = Math.max(0, daysBetween(plan.campbells_in_date, endIso));
  const weeks = days / 7;
  return { weeks, incurred: weeks * weekly, weekly };
}

function enrichPlan(plan, supplier) {
  const stage = computeStage(plan, supplier);
  const cost = kemballsCost(plan);
  const finalDue = computeFinalPaymentDue(plan, supplier);
  return Object.assign({}, plan, {
    supplier_name: supplier && supplier.name || null,
    supplier_payment_terms: supplier && supplier.payment_terms || null,
    ...stage,
    campbells_weeks: cost.weeks,
    campbells_incurred_gbp: cost.incurred,
    campbells_weekly_effective_gbp: cost.weekly,
    final_payment_due_date_computed: finalDue
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const TASK_RULES = [
  { key: 'pay_deposit', role: 'accounts',
    title: p => 'Pay deposit — ' + p.plan_number,
    title_cn: p => '支付订金 — ' + p.plan_number,
    condition: p => !p.deposit_received_date && p.status === 'active',
    due: p => p.order_date ? addDays(p.order_date, 1) : todayDate() },
  { key: 'chase_approx_loading', role: 'agent',
    title: p => 'Get approx loading date from supplier — ' + p.plan_number,
    title_cn: p => '向供应商确认大致装柜日期 — ' + p.plan_number,
    condition: p => p.deposit_received_date && !p.approx_loading_date && p.status === 'active',
    due: p => addDays(p.deposit_received_date, 3) },
  { key: 'production_check_day_7', role: 'agent',
    title: p => 'Day 7 production check — ' + p.plan_number,
    title_cn: p => '生产第7天检查 — ' + p.plan_number,
    condition: p => p.deposit_received_date && !p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.deposit_received_date, 7) },
  { key: 'production_check_day_21', role: 'agent',
    title: p => 'Day 21 mid-production check — ' + p.plan_number,
    title_cn: p => '生产第21天中期检查 — ' + p.plan_number,
    condition: p => p.deposit_received_date && !p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.deposit_received_date, 21) },
  { key: 'confirm_exact_loading', role: 'agent',
    title: p => 'Confirm exact loading date — ' + p.plan_number,
    title_cn: p => '确认准确装柜日期 — ' + p.plan_number,
    condition: p => p.approx_loading_date && !p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.approx_loading_date, -14) },
  { key: 'final_loading_confirm', role: 'agent',
    title: p => 'Final pre-loading confirmation — ' + p.plan_number,
    title_cn: p => '装柜前最终确认 — ' + p.plan_number,
    condition: p => p.approx_loading_date && !p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.approx_loading_date, -2) },
  { key: 'book_container', role: 'agent',
    title: p => 'Book container with shipper — ' + p.plan_number,
    title_cn: p => '与货代订舱 — ' + p.plan_number,
    condition: p => p.approx_loading_date && !p.shipper_name && p.status === 'active',
    due: p => addDays(p.approx_loading_date, -7) },
  { key: 'pay_final', role: 'accounts',
    title: p => 'Pay final payment to supplier — ' + p.plan_number,
    title_cn: p => '向供应商支付尾款 — ' + p.plan_number,
    condition: p => p.original_eta && !p.final_payment_received_date && p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.original_eta, -14) },
  { key: 'pay_shipper', role: 'accounts',
    title: p => 'Pay shipper — ' + p.plan_number,
    title_cn: p => '支付货代费用 — ' + p.plan_number,
    condition: p => p.original_eta && !p.shipper_payment_made && p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.original_eta, -14) },
  { key: 'verify_telex', role: 'agent',
    title: p => 'Verify telex release — ' + p.plan_number,
    title_cn: p => '核实电放确认 — ' + p.plan_number,
    condition: p => p.telex_supplier_declared && !p.telex_confirmed_by_agent && p.status === 'active',
    due: p => todayDate() },
  { key: 'send_docs_to_agent', role: 'agent',
    title: p => 'Send BL + PI + Packing List to import agent — ' + p.plan_number,
    title_cn: p => '将提单+发票+装箱单发给报关行 — ' + p.plan_number,
    condition: p => p.telex_confirmed_by_agent && !p.docs_sent_to_import_agent_date && p.status === 'active',
    due: p => todayDate() },
  { key: 'await_duty_invoice', role: 'accounts',
    title: p => 'Watch for duty invoice from import agent — ' + p.plan_number,
    title_cn: p => '等待报关行发来关税发票 — ' + p.plan_number,
    condition: p => p.docs_sent_to_import_agent_date && !p.duty_invoice_received_date && p.status === 'active',
    due: p => addDays(p.docs_sent_to_import_agent_date, 5) },
  { key: 'pay_duty', role: 'accounts',
    title: p => 'Pay UK customs duty — ' + p.plan_number,
    title_cn: p => '支付英国关税 — ' + p.plan_number,
    condition: p => p.duty_invoice_received_date && !p.duty_paid_date && p.status === 'active',
    due: p => addDays(p.duty_invoice_received_date, 2) },
  { key: 'confirm_customs_clear', role: 'agent',
    title: p => 'Confirm customs cleared — ' + p.plan_number,
    title_cn: p => '确认通关完成 — ' + p.plan_number,
    condition: p => p.duty_paid_date && !p.customs_cleared_date && p.status === 'active',
    due: p => addDays(p.duty_paid_date, 2) },
  { key: 'decide_disposition', role: 'agent',
    title: p => 'Decide disposition: Warehouse or Kemballs — ' + p.plan_number,
    title_cn: p => '决定送货地点：仓库或Kemballs — ' + p.plan_number,
    condition: p => p.customs_cleared_date && !p.disposition && p.status === 'active',
    due: p => todayDate() },
  { key: 'book_local_delivery', role: 'agent',
    title: p => 'Book local delivery with origin partner — ' + p.plan_number,
    title_cn: p => '与本地承运商预约送货 — ' + p.plan_number,
    condition: p => p.disposition === 'clean' && !p.local_delivery_booked_date && !p.delivery_date && p.status === 'active',
    due: p => todayDate() },
  { key: 'log_delivery_sheet', role: 'agent',
    title: p => 'Upload delivery sheet — ' + p.plan_number,
    title_cn: p => '上传送货单 — ' + p.plan_number,
    condition: p => p.delivery_date && !p.closed_at && p.disposition === 'clean' && p.status === 'active',
    due: p => todayDate() }
];

async function evaluateTasks(db, planId) {
  if (!planId) return;
  const r = await db.query('SELECT * FROM lg_plans WHERE id=$1', [planId]);
  if (!r.rows.length) return;
  const plan = r.rows[0];
  const existing = await db.query('SELECT rule_key FROM lg_tasks WHERE plan_id=$1', [planId]);
  const existingKeys = new Set(existing.rows.map(t => t.rule_key));

  for (const rule of TASK_RULES) {
    try {
      if (!rule.condition(plan)) continue;
      if (existingKeys.has(rule.key)) continue;
      const title    = rule.title(plan);
      const titleCn  = rule.title_cn ? rule.title_cn(plan) : null;
      const due      = rule.due(plan);
      const priority = ['pay_deposit','pay_final','pay_shipper','pay_duty'].includes(rule.key) ? 'high' : 'normal';
      await db.query(
        `INSERT INTO lg_tasks (plan_id, rule_key, title, title_cn, intended_role, priority, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [planId, rule.key, title, titleCn, rule.role, priority, due]
      );
    } catch(e) { console.error('[tasks evaluate ' + rule.key + '] ' + e.message); }
  }

  // Recurring ETA-check task
  try {
    const needs = plan.actual_loading_date && !plan.docs_sent_to_import_agent_date && plan.status === 'active';
    if (needs) {
      const live = await db.query("SELECT id FROM lg_tasks WHERE plan_id=$1 AND rule_key='eta_check' AND status IN ('open','claimed')", [planId]);
      if (!live.rows.length) {
        let due = plan.next_eta_check_date;
        if (!due) {
          due = addDays(plan.actual_loading_date, 21);
          await db.query('UPDATE lg_plans SET next_eta_check_date=$1 WHERE id=$2', [due, planId]);
        }
        const dueIso = asIso(due);
        await db.query(
          `INSERT INTO lg_tasks (plan_id, rule_key, title, title_cn, intended_role, priority, due_date)
           VALUES ($1,'eta_check',$2,$3,'agent','normal',$4)`,
          [planId, 'Check ETA — ' + plan.plan_number, '检查到港日期 — ' + plan.plan_number, dueIso]
        );
      }
    }
  } catch(e) { console.error('[tasks eta_check] ' + e.message); }
}

async function bumpEtaCheck(db, planId) {
  try {
    const r = await db.query('SELECT * FROM lg_plans WHERE id=$1', [planId]);
    if (!r.rows.length) return;
    const plan = r.rows[0];
    const today = todayDate();
    const eta = plan.new_eta || plan.original_eta;
    let nextDays = 4;
    if (eta) {
      const daysToEta = daysBetween(today, eta);
      if (daysToEta <= 14) nextDays = 2;
      else if (daysToEta <= 28) nextDays = 4;
      else nextDays = 7;
    }
    const next = addDays(today, nextDays);
    await db.query('UPDATE lg_plans SET next_eta_check_date=$1 WHERE id=$2', [next, planId]);
  } catch(e) { console.error('[bumpEtaCheck] ' + e.message); }
}

async function dailyTaskEvaluation(db) {
  try {
    const r = await db.query("SELECT id FROM lg_plans WHERE status='active' AND closed_at IS NULL");
    for (const row of r.rows) await evaluateTasks(db, row.id);
    console.log('[logistics daily-eval] evaluated ' + r.rows.length + ' active plans');
  } catch(e) { console.error('[logistics daily-eval] ' + e.message); }
}

const SLIP_TRACKED_FIELDS = ['approx_loading_date','actual_loading_date','original_eta','new_eta',
  'final_payment_due_date','final_payment_received_date','delivery_date','campbells_in_date','campbells_out_date'];

async function logSlipIfChanged(db, planId, field, oldVal, newVal, reason, reasonCategory, actorName) {
  if (!SLIP_TRACKED_FIELDS.includes(field)) return;
  const oldIso = oldVal ? asIso(oldVal) : null;
  const newIso = newVal ? asIso(newVal) : null;
  if (oldIso === newIso) return;
  const slipDays = (oldIso && newIso) ? daysBetween(oldIso, newIso) : null;
  try {
    await db.query(
      `INSERT INTO lg_date_slips (plan_id, field_name, previous_value, new_value, slip_days, reason, reason_category, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [planId, field, oldIso, newIso, slipDays, reason || null, reasonCategory || null, actorName]
    );
  } catch(e) { console.error('[slip log] ' + e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) {
      try { fs.mkdirSync(FILES_DIR, { recursive: true }); } catch(e) {}
      cb(null, FILES_DIR);
    },
    filename: function(req, file, cb) {
      const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 80);
      const id = crypto.randomBytes(8).toString('hex');
      cb(null, Date.now() + '_' + id + '_' + safe);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────

module.exports = function(getDb) {
  const router = express.Router();
  let booted = false;

  async function bootIfReady() {
    if (booted) return;
    const db = getDb && getDb();
    if (!db) return;
    booted = true;
    try { await ensureLogisticsSchema(db); await ensureLogisticsSeed(db); }
    catch(e) { console.error('[logistics boot] ' + e.message); }
  }
  router._boot = bootIfReady;
  router._dailyEval = async function() { const db = getDb && getDb(); if (db) await dailyTaskEvaluation(db); };

  // ── PUBLIC SUPPLIER FORM ROUTER (no auth) ─────────────────────────────────
  const publicRouter = express.Router();
  publicRouter.use(async function(req, res, next) { await bootIfReady(); next(); });

  publicRouter.get('/:token', async function(req, res) {
    res.sendFile(path.join(__dirname, '..', 'public', 'supplier.html'));
  });
  publicRouter.get('/api/:token', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const r = await db.query(
        `SELECT p.*, s.name AS supplier_name FROM lg_plans p LEFT JOIN lg_suppliers s ON s.id=p.supplier_id WHERE p.supplier_share_token=$1`,
        [req.params.token]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Invalid link' });
      const p = r.rows[0];
      res.json({
        plan_number: p.plan_number, supplier_name: p.supplier_name,
        locked: !!p.supplier_form_locked, submitted_by: p.supplier_submitted_by,
        last_submitted_at: p.supplier_last_submitted_at,
        order_date: p.order_date, total_amount_usd: p.total_amount_usd, deposit_usd: p.deposit_usd,
        deposit_received_date: p.deposit_received_date,
        approx_loading_date: p.approx_loading_date, loading_port: p.loading_port,
        actual_loading_date: p.actual_loading_date,
        container_number: p.container_number, tracking_number: p.tracking_number,
        bl_number: p.bl_number, bl_date: p.bl_date, final_amount_usd: p.final_amount_usd,
        telex_supplier_declared: !!p.telex_supplier_declared,
        telex_supplier_declared_date: p.telex_supplier_declared_date,
        supplier_final_payment_acknowledged: !!p.supplier_final_payment_acknowledged
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  publicRouter.get('/api/:token/files', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const plan = (await db.query('SELECT id FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Invalid link' });
      const files = (await db.query(
        "SELECT id, slot, filename, uploaded_at, uploaded_by FROM lg_plan_files WHERE plan_id=$1 AND slot IN ('bl','final_pi','packing_list','loading_photo','telex') ORDER BY uploaded_at DESC",
        [plan.id])).rows;
      res.json({ files });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  publicRouter.post('/api/:token', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const planRow = (await db.query('SELECT * FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!planRow) return res.status(404).json({ error: 'Invalid link' });
      if (planRow.supplier_form_locked) return res.status(423).json({ error: 'Form is locked' });
      const allowed = ['approx_loading_date','actual_loading_date','container_number','tracking_number',
        'bl_number','bl_date','final_amount_usd','telex_supplier_declared','telex_supplier_declared_date','supplier_final_payment_acknowledged'];
      const sets = []; const vals = []; let i = 1;
      const changes = [];
      for (const f of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
          let v = req.body[f]; if (v === '') v = null;
          sets.push(f + '=$' + (i++)); vals.push(v); changes.push(f);
          if (SLIP_TRACKED_FIELDS.includes(f))
            await logSlipIfChanged(db, planRow.id, f, planRow[f], v, req.body.slip_reason, req.body.slip_reason_category, 'supplier:' + (req.body.submitted_by || 'unknown'));
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'No fields' });
      sets.push('supplier_submitted_by=$' + (i++)); vals.push(req.body.submitted_by || planRow.supplier_submitted_by || 'unknown');
      sets.push('supplier_last_submitted_at=NOW()');
      vals.push(planRow.id);
      await db.query('UPDATE lg_plans SET ' + sets.join(',') + ' WHERE id=$' + i, vals);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [planRow.id, 'supplier_submit', 'Supplier updated: ' + changes.join(', '), 'supplier:' + (req.body.submitted_by || 'unknown')]);
      await evaluateTasks(db, planRow.id);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  publicRouter.post('/api/:token/files', upload.single('file'), async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const plan = (await db.query('SELECT id, supplier_form_locked FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Invalid link' });
      if (plan.supplier_form_locked) return res.status(423).json({ error: 'Form is locked' });
      if (!req.file) return res.status(400).json({ error: 'No file' });
      const slotMap = { bl:'bl', final_pi:'final_pi', packing_list:'packing_list', loading_photo:'loading_photo', telex:'telex', other:'other' };
      const slot = slotMap[(req.body.slot || 'other').toLowerCase()] || 'other';
      const submitter = req.body.submitted_by || 'unknown';
      await db.query(
        `INSERT INTO lg_plan_files (plan_id, slot, filename, stored_path, mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [plan.id, slot, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, 'supplier:' + submitter]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [plan.id, 'supplier_file', slot + ': ' + req.file.originalname, 'supplier:' + submitter]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router._supplierShare = publicRouter;

  // ── INTERNAL ROUTES (auth required) ───────────────────────────────────────
  router.use(async function(req, res, next) {
    await bootIfReady();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Logistics access denied' });
    req._db = getDb();
    if (!req._db) return res.status(503).json({ error: 'Database not ready' });
    next();
  });

  router.get('/me', function(req, res) {
    res.json({
      name: req.user.name, email: req.user.email, role: req.user.role, department: req.user.department,
      is_manager: isManager(req.user),
      defaults: { kemballs_weekly_gbp: DEFAULT_KEMBALLS_WEEKLY, campbells_weekly_gbp: DEFAULT_KEMBALLS_WEEKLY }
    });
  });

  router.get('/suppliers', async function(req, res) {
    const db = req._db;
    try { const r = await db.query('SELECT * FROM lg_suppliers WHERE is_active=TRUE ORDER BY name'); res.json({ suppliers: r.rows }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/suppliers', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Name required' });
    try {
      const r = await db.query(
        `INSERT INTO lg_suppliers (name, contact_email, contact_phone, payment_terms, default_loading_port, wechat_handle)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [b.name, b.contact_email || null, b.contact_phone || null, b.payment_terms || '2_weeks_before_eta', b.default_loading_port || null, b.wechat_handle || null]);
      res.json({ supplier: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.patch('/suppliers/:id', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    const fields = ['name','contact_email','contact_phone','payment_terms','default_loading_port','wechat_handle','is_active','notes'];
    const sets = []; const vals = []; let i = 1;
    for (const f of fields) if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) { sets.push(f+'=$'+(i++)); vals.push(req.body[f]); }
    if (!sets.length) return res.status(400).json({ error: 'No fields' });
    vals.push(parseInt(req.params.id));
    try { const r = await db.query('UPDATE lg_suppliers SET '+sets.join(',')+' WHERE id=$'+i+' RETURNING *', vals); res.json({ supplier: r.rows[0] }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/plans', async function(req, res) {
    const db = req._db;
    try {
      const supMap = {};
      (await db.query('SELECT * FROM lg_suppliers')).rows.forEach(s => supMap[s.id] = s);
      let sql = 'SELECT * FROM lg_plans';
      const where = []; const vals = []; let i = 1;
      if (req.query.status === 'active')       where.push("status='active' AND closed_at IS NULL");
      else if (req.query.status === 'closed')  where.push('closed_at IS NOT NULL');
      else if (req.query.status === 'cancelled') where.push("status='cancelled'");
      else if (req.query.status === 'all')     { /* no filter */ }
      else                                     where.push("status='active' AND closed_at IS NULL");
      if (req.query.disposition) { where.push('disposition=$'+(i++)); vals.push(req.query.disposition); }
      if (req.query.supplier_id) { where.push('supplier_id=$'+(i++)); vals.push(parseInt(req.query.supplier_id)); }
      if (req.query.plan_number) { where.push('LOWER(plan_number) LIKE $'+(i++)); vals.push('%'+String(req.query.plan_number).toLowerCase()+'%'); }
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY created_at DESC';
      const r = await db.query(sql, vals);
      const enriched = r.rows.map(p => enrichPlan(p, supMap[p.supplier_id]));
      res.json({ plans: enriched });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/counts', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query("SELECT * FROM lg_plans WHERE status='active' AND closed_at IS NULL");
      const supMap = {};
      (await db.query('SELECT * FROM lg_suppliers')).rows.forEach(s => supMap[s.id] = s);
      let overdue = 0, kemballs = 0, issues = 0;
      r.rows.forEach(function(p){
        const g = computeStage(p, supMap[p.supplier_id]);
        if (g.is_overdue) overdue++;
        if (p.disposition === 'campbells' && !p.campbells_out_date) kemballs++;
        if (p.disposition === 'issues') issues++;
      });
      const tasks = await db.query("SELECT COUNT(*)::int AS n FROM lg_tasks WHERE status IN ('open','claimed') AND due_date < CURRENT_DATE");
      res.json({ open: r.rows.length, overdue, at_campbells: kemballs, at_kemballs: kemballs, with_issues: issues, overdue_tasks: tasks.rows[0].n });
    } catch(e) { res.json({ open:0, overdue:0, at_campbells:0, at_kemballs:0, with_issues:0, overdue_tasks: 0 }); }
  });

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
      const tasks    = (await db.query("SELECT * FROM lg_tasks WHERE plan_id=$1 ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END, due_date NULLS LAST", [plan.id])).rows;
      const slips    = (await db.query('SELECT * FROM lg_date_slips WHERE plan_id=$1 ORDER BY created_at DESC LIMIT 20', [plan.id])).rows;
      const prodChecks = (await db.query('SELECT * FROM lg_production_checks WHERE plan_id=$1 ORDER BY created_at DESC', [plan.id])).rows;
      res.json({ plan: enrichPlan(plan, sup), supplier: sup, files, issues, activity, tasks, slips, production_checks: prodChecks });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/plans', async function(req, res) {
    const db = req._db;
    const b = req.body || {};
    if (!b.plan_number) return res.status(400).json({ error: 'plan_number required' });
    if (!b.supplier_id) return res.status(400).json({ error: 'supplier_id required' });
    try {
      const shareToken = genToken();
      const r = await db.query(`
        INSERT INTO lg_plans (plan_number, supplier_id, order_date, total_amount_usd, deposit_usd, deposit_pct,
                              loading_port, remarks, supplier_share_token, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [b.plan_number, b.supplier_id, b.order_date || null, b.total_amount_usd || null,
         b.deposit_usd || null, b.deposit_pct || null, b.loading_port || null, b.remarks || null,
         shareToken, actor(req)]);
      const newId = r.rows[0].id;
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [newId, 'created', 'Plan ' + b.plan_number + ' created', actor(req)]);
      await evaluateTasks(db, newId);
      res.json({ plan: r.rows[0] });
    } catch(e) {
      if (String(e.message).includes('duplicate')) return res.status(409).json({ error: 'plan_number already exists' });
      res.status(500).json({ error: e.message });
    }
  });

  router.patch('/plans/:id', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const updatable = [
      'supplier_id','order_date','total_amount_usd','deposit_usd','deposit_pct','deposit_received_date',
      'approx_loading_date','actual_loading_date','loading_port',
      'container_number','tracking_number','shipper_name','container_price_usd','bl_number','bl_date','free_days',
      'final_amount_usd','final_payment_due_date','final_payment_received_date',
      'shipper_payment_made','shipper_payment_date',
      'original_eta','new_eta','telex_release_date','telex_confirmed_by_agent','telex_supplier_declared','telex_supplier_declared_date',
      'supplier_final_payment_acknowledged',
      'docs_sent_to_import_agent_date','duty_invoice_amount_gbp','duty_invoice_received_date','duty_paid_date','customs_cleared_date',
      'disposition','delivery_date','local_delivery_booked_date','local_delivery_partner',
      'campbells_in_date','campbells_out_date','campbells_reference','campbells_weekly_gbp','campbells_routing_reason','campbells_estimated_retrieval',
      'remarks','shipping_notes','supplier_form_locked','status'
    ];
    try {
      const before = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [id])).rows[0];
      if (!before) return res.status(404).json({ error: 'Plan not found' });
      const sets = []; const vals = []; let i = 1;
      const changes = [];
      for (const f of updatable) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
          let v = req.body[f] === '' ? null : req.body[f];
          sets.push(f + '=$' + (i++)); vals.push(v); changes.push(f);
          if (SLIP_TRACKED_FIELDS.includes(f))
            await logSlipIfChanged(db, id, f, before[f], v, req.body.slip_reason, req.body.slip_reason_category, actor(req));
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'No fields' });
      sets.push('updated_at=NOW()'); vals.push(id);
      const r = await db.query('UPDATE lg_plans SET ' + sets.join(',') + ' WHERE id=$' + i + ' RETURNING *', vals);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'updated', 'Fields: ' + changes.join(', '), actor(req)]);
      await evaluateTasks(db, id);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/plans/:id/close', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const r = await db.query("UPDATE lg_plans SET closed_at=NOW(), closed_by=$1, status='closed' WHERE id=$2 RETURNING *", [actor(req), id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
      await db.query("UPDATE lg_tasks SET status='auto_archived', completed_at=NOW(), completion_note='Plan closed' WHERE plan_id=$1 AND status IN ('open','claimed')", [id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'closed', 'Plan closed', actor(req)]);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/plans/:id/reopen', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    try {
      const id = parseInt(req.params.id);
      const r = await db.query("UPDATE lg_plans SET closed_at=NULL, closed_by=NULL, status='active' WHERE id=$1 RETURNING *", [id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'reopened', 'Plan reopened', actor(req)]);
      await evaluateTasks(db, id);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/plans/:id/cancel', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    try {
      const id = parseInt(req.params.id);
      const reason = (req.body && req.body.reason) || null;
      const r = await db.query("UPDATE lg_plans SET status='cancelled', cancelled_at=NOW(), cancelled_by=$1, cancellation_reason=$2 WHERE id=$3 RETURNING *", [actor(req), reason, id]);
      await db.query("UPDATE lg_tasks SET status='auto_archived', completed_at=NOW(), completion_note='Plan cancelled' WHERE plan_id=$1 AND status IN ('open','claimed')", [id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'cancelled', 'Plan cancelled: ' + (reason || ''), actor(req)]);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/plans/:id', async function(req, res) {
    const db = req._db;
    if ((req.user.role || '').toLowerCase() !== 'owner') return res.status(403).json({ error: 'Owner only' });
    try { await db.query('DELETE FROM lg_plans WHERE id=$1', [parseInt(req.params.id)]); res.json({ ok: true }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/plans/:id/regenerate-share', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const token = genToken();
      const r = await db.query('UPDATE lg_plans SET supplier_share_token=$1, supplier_form_locked=FALSE WHERE id=$2 RETURNING supplier_share_token', [token, id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'share_regen', 'New share link generated', actor(req)]);
      res.json({ token });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/plans/:id/lock-supplier-form', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const lock = !!(req.body && req.body.lock);
      const r = await db.query('UPDATE lg_plans SET supplier_form_locked=$1 WHERE id=$2 RETURNING supplier_form_locked', [lock, id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, lock ? 'form_locked' : 'form_unlocked', '', actor(req)]);
      res.json({ locked: r.rows[0].supplier_form_locked });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/plans/:id/files', upload.single('file'), async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const slot = (req.body.slot || 'other').toLowerCase();
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
      const r = await db.query(`INSERT INTO lg_plan_files (plan_id, slot, filename, stored_path, mime_type, size_bytes, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, slot, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, actor(req)]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'file_uploaded', slot + ': ' + req.file.originalname, actor(req)]);
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
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [f.plan_id, 'file_deleted', f.slot + ': ' + f.filename, actor(req)]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/plans/:id/issues', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.description) return res.status(400).json({ error: 'description required' });
    try {
      const r = await db.query(`INSERT INTO lg_plan_issues (plan_id, issue_type, description, created_by)
        VALUES ($1,$2,$3,$4) RETURNING *`, [id, b.issue_type || 'other', b.description, actor(req)]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'issue_added', String(b.description).slice(0, 100), actor(req)]);
      res.json({ issue: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.patch('/issues/:id', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.status) return res.status(400).json({ error: 'status required' });
    try {
      let sql, vals;
      if (b.status === 'resolved') {
        sql = 'UPDATE lg_plan_issues SET status=$1, resolved_at=NOW(), resolved_by=$2, resolution_note=$3 WHERE id=$4 RETURNING *';
        vals = [b.status, actor(req), b.resolution_note || null, id];
      } else {
        sql = 'UPDATE lg_plan_issues SET status=$1 WHERE id=$2 RETURNING *';
        vals = [b.status, id];
      }
      const r = await db.query(sql, vals);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [r.rows[0].plan_id, 'issue_' + b.status, String(r.rows[0].description).slice(0, 100), actor(req)]);
      res.json({ issue: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/tasks', async function(req, res) {
    const db = req._db;
    try {
      let where = []; let vals = []; let i = 1;
      const status = req.query.status || 'open_or_claimed';
      if (status === 'open_or_claimed') where.push("t.status IN ('open','claimed')");
      else if (status === 'open')       where.push("t.status='open'");
      else if (status === 'claimed')    where.push("t.status='claimed'");
      else if (status === 'done')       where.push("t.status IN ('done','auto_archived')");
      if (req.query.plan_id)    { where.push('t.plan_id=$'+(i++)); vals.push(parseInt(req.query.plan_id)); }
      if (req.query.claimed_by) { where.push('t.claimed_by=$'+(i++)); vals.push(req.query.claimed_by); }
      const sql = 'SELECT t.*, p.plan_number, s.name AS supplier_name FROM lg_tasks t LEFT JOIN lg_plans p ON p.id=t.plan_id LEFT JOIN lg_suppliers s ON s.id=p.supplier_id' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        " ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END, CASE t.priority WHEN 'high' THEN 0 ELSE 1 END, t.due_date NULLS LAST LIMIT 500";
      const r = await db.query(sql, vals);
      res.json({ tasks: r.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/tasks/:id/claim', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const r = await db.query("UPDATE lg_tasks SET status='claimed', claimed_by=$1, claimed_at=NOW() WHERE id=$2 AND status='open' RETURNING *", [actor(req), id]);
      if (!r.rows.length) return res.status(409).json({ error: 'Task not available' });
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [r.rows[0].plan_id, 'task_claimed', r.rows[0].title, actor(req)]);
      res.json({ task: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/tasks/:id/unclaim', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const r = await db.query("UPDATE lg_tasks SET status='open', claimed_by=NULL, claimed_at=NULL WHERE id=$1 AND status='claimed' RETURNING *", [id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      res.json({ task: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/tasks/:id/done', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const note = (req.body && req.body.completion_note) || null;
      const r = await db.query("UPDATE lg_tasks SET status='done', completed_by=$1, completed_at=NOW(), completion_note=$2 WHERE id=$3 RETURNING *", [actor(req), note, id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      const task = r.rows[0];
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [task.plan_id, 'task_done', task.title + (note ? ' — ' + note : ''), actor(req)]);
      if (task.rule_key === 'production_check_day_7' || task.rule_key === 'production_check_day_21') {
        const outcome = (req.body && req.body.outcome) || 'on_track';
        await db.query('INSERT INTO lg_production_checks (plan_id, check_label, outcome, note, checked_by) VALUES ($1,$2,$3,$4,$5)',
          [task.plan_id, task.rule_key, outcome, note, actor(req)]);
      }
      if (task.rule_key === 'eta_check') await bumpEtaCheck(db, task.plan_id);
      await evaluateTasks(db, task.plan_id);
      res.json({ task });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/plans/:id/slips', async function(req, res) {
    const db = req._db;
    try { const r = await db.query('SELECT * FROM lg_date_slips WHERE plan_id=$1 ORDER BY created_at DESC', [parseInt(req.params.id)]); res.json({ slips: r.rows }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/dashboard', async function(req, res) {
    const db = req._db;
    try {
      const all = await db.query(`SELECT p.*, s.name AS supplier_name, s.payment_terms AS supplier_payment_terms
        FROM lg_plans p LEFT JOIN lg_suppliers s ON s.id=p.supplier_id ORDER BY p.created_at DESC`);
      const supMap = {};
      (await db.query('SELECT * FROM lg_suppliers')).rows.forEach(s => supMap[s.id] = s);
      const enriched = all.rows.map(p => enrichPlan(p, supMap[p.supplier_id]));

      const today = todayDate();
      const wkPlus7  = addDays(today, 7);
      const wkPlus14 = addDays(today, 14);

      const inFlight  = enriched.filter(p => p.status === 'active' && !p.closed_at);
      const overdue   = inFlight.filter(p => p.is_overdue);
      const atKemballs = enriched.filter(p => p.disposition === 'campbells' && !p.campbells_out_date);
      const withIssues = enriched.filter(p => p.disposition === 'issues');

      const loadingThisWeek = inFlight.filter(p => p.approx_loading_date && asIso(p.approx_loading_date) <= wkPlus7 && !p.actual_loading_date);
      const loadingNextWeek = inFlight.filter(p => p.approx_loading_date && asIso(p.approx_loading_date) > wkPlus7 && asIso(p.approx_loading_date) <= wkPlus14 && !p.actual_loading_date);
      const arrivingThisWeek = inFlight.filter(p => p.new_eta && asIso(p.new_eta) <= wkPlus7 && !p.delivery_date && !p.disposition);
      const arrivingNextWeek = inFlight.filter(p => p.new_eta && asIso(p.new_eta) > wkPlus7 && asIso(p.new_eta) <= wkPlus14 && !p.delivery_date && !p.disposition);
      const paymentsDueSoon = inFlight.filter(p => {
        if (p.final_payment_received_date) return false;
        const due = p.final_payment_due_date_computed;
        return due && due <= wkPlus14;
      });

      let valueInTransit = 0;
      enriched.forEach(p => { if (!p.closed_at && p.bl_date && !p.delivery_date) valueInTransit += parseFloat(p.total_amount_usd || 0); });
      let owedNext14 = 0;
      paymentsDueSoon.forEach(p => { const owe = parseFloat(p.final_amount_usd || (p.total_amount_usd || 0) - (p.deposit_usd || 0)); owedNext14 += isNaN(owe) ? 0 : owe; });
      let kemballsWeekly = 0, kemballsIncurred = 0;
      atKemballs.forEach(p => { kemballsWeekly += parseFloat(p.campbells_weekly_effective_gbp || 0); kemballsIncurred += parseFloat(p.campbells_incurred_gbp || 0); });

      const tasks = (await db.query(`SELECT t.*, p.plan_number, s.name AS supplier_name
        FROM lg_tasks t LEFT JOIN lg_plans p ON p.id=t.plan_id LEFT JOIN lg_suppliers s ON s.id=p.supplier_id
        WHERE t.status IN ('open','claimed')
        ORDER BY CASE t.priority WHEN 'high' THEN 0 ELSE 1 END, t.due_date NULLS LAST`)).rows;
      const overdueTasks  = tasks.filter(t => t.due_date && asIso(t.due_date) < today);
      const dueTodayTasks = tasks.filter(t => t.due_date && asIso(t.due_date) === today);
      const upcomingTasks = tasks.filter(t => t.due_date && asIso(t.due_date) > today && asIso(t.due_date) <= wkPlus7);
      const otherTasks    = tasks.filter(t => !t.due_date || asIso(t.due_date) > wkPlus7);

      res.json({
        kpis: {
          in_flight: inFlight.length,
          overdue:   overdue.length,
          value_in_transit_usd: Math.round(valueInTransit),
          at_kemballs: atKemballs.length, at_campbells: atKemballs.length,
          kemballs_weekly_gbp: Math.round(kemballsWeekly * 100)/100, campbells_weekly_gbp: Math.round(kemballsWeekly * 100)/100,
          kemballs_incurred_gbp: Math.round(kemballsIncurred * 100)/100, campbells_incurred_gbp: Math.round(kemballsIncurred * 100)/100,
          owed_next_14_usd: Math.round(owedNext14),
          with_issues: withIssues.length,
          tasks_overdue: overdueTasks.length, tasks_due_today: dueTodayTasks.length
        },
        tasks: { overdue: overdueTasks, due_today: dueTodayTasks, upcoming: upcomingTasks, other: otherTasks },
        operational: {
          loading_this_week: loadingThisWeek, loading_next_week: loadingNextWeek,
          arriving_this_week: arrivingThisWeek, arriving_next_week: arrivingNextWeek,
          payments_due_soon: paymentsDueSoon
        },
        lanes: { at_campbells: atKemballs, at_kemballs: atKemballs, with_issues: withIssues },
        all_in_flight: inFlight, overdue
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
