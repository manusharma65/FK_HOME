// server/logistics.js — Logistics module (r31n.1)
//
// r31n.1 — Foolproof bucket model. Replaces r31n's overcomplicated kemballs_parked status.
//   Plans flow between buckets purely from field values (no status flags):
//     • Active             = customs_cleared_date IS NULL (and status='active', not closed)
//     • Kemballs           = customs cleared + disposition=kemballs + no delivery booked
//     • Warehouse incoming = (clean + customs cleared) OR (kemballs + delivery booked); not received
//     • Warehouse received = warehouse_received_date NOT NULL; not verified
//     • Archive            = closed_at NOT NULL
//   Every transition is reversible. Cancel delivery booking → returns to prior bucket. Switch
//   disposition → moves bucket, storage clock handled, booking reset. Un-receive (manager only)
//   → returns plan to incoming.
//
// New endpoints:
//   POST /plans/:id/book-delivery           — partner + delivery_date; auto-stops Kemballs clock
//   POST /plans/:id/cancel-delivery-booking — clears delivery fields; resumes Kemballs clock
//   POST /plans/:id/switch-disposition      — route change w/ booking reset + clock handling
//   POST /plans/:id/unreceive               — manager only; clears warehouse_received_date
//
// Removed from r31n:
//   • kemballs_parked status (never set, never read)
//   • /plans/:id/bring-to-warehouse endpoint (no parking, so nothing to release)
//   • Mandatory disposition picker at gate-8 still present (correct) but no status side-effect
//
// Inherits r31n's items 2/4/5/6/7/8/10/12/13/14/15 (modal close, Satyam routing, /q /s /f mounts,
//   drop claim, production check 1wk/2wk, gate-6 due, gate-4 review, hide gate-9 if Kemballs,
//   notify() helper, 19-task assignee matrix). Item 11 redesigned per above. Item 9 (supplier
//   form) untouched from r31n.
//
// Aging warnings: Kemballs cards flag at 8+ weeks; warehouse-incoming cards flag if delivery
//   date passed by 7+ days without receipt.
//
// Mounted from server.js (unchanged from r31n):
//   const logisticsRouter = require('./server/logistics')(function(){ return db; });
//   app.use('/api/logistics', logisticsRouter);
//   app.use('/s', logisticsRouter._supplierShare);
//   app.use('/q', logisticsRouter._agentShare);
//   app.use('/f', logisticsRouter._fileShare);
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
    `CREATE INDEX IF NOT EXISTS idx_lg_tasks_rule_plan ON lg_tasks(plan_id, rule_key)`,
    // r30c — track who last set each plan field (supplier vs agent) for override audit badges
    `CREATE TABLE IF NOT EXISTS lg_field_audit (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       field_name TEXT NOT NULL,
       new_value TEXT,
       set_by TEXT,
       set_by_role TEXT,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_field_audit_plan ON lg_field_audit(plan_id, field_name, created_at DESC)`,

    // r30e — extend audit to record old_value so we can show before/after edits past grace window
    `ALTER TABLE lg_field_audit ADD COLUMN IF NOT EXISTS old_value TEXT`,
    `ALTER TABLE lg_field_audit ADD COLUMN IF NOT EXISTS within_grace BOOLEAN DEFAULT TRUE`,
    // r30i — Final PI amount column (what's on the supplier's Final PI document; final_amount_usd remains "actually paid")
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS final_pi_amount_usd NUMERIC(12,2)`,
    // r30j — Kemballs is a transit stop: track retrieval booking (when leaving Kemballs for warehouse)
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS kemballs_retrieval_booked_date DATE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS kemballs_retrieval_partner TEXT`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS kemballs_retrieval_confirmed_date DATE`,

    // ── r30d additions ─────────────────────────────────────────────────────
    // File slot grouping + pinning
    `ALTER TABLE lg_plan_files ADD COLUMN IF NOT EXISTS slot_group TEXT DEFAULT 'other'`,
    `ALTER TABLE lg_plan_files ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE lg_plan_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE lg_plan_files ADD COLUMN IF NOT EXISTS deleted_by TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_lg_files_group ON lg_plan_files(plan_id, slot_group)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_files_pinned ON lg_plan_files(plan_id, pinned)`,
    // Claims (post-delivery discrepancies)
    `CREATE TABLE IF NOT EXISTS lg_claims (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       description TEXT NOT NULL,
       claim_value_gbp NUMERIC(12,2),
       status TEXT NOT NULL DEFAULT 'open',
       supplier_proposed_resolution TEXT,
       supplier_resolution_note TEXT,
       supplier_replacement_plan_ref TEXT,
       supplier_responded_at TIMESTAMP,
       agreed_resolution TEXT,
       agreed_resolution_note TEXT,
       agreed_at TIMESTAMP,
       agreed_by TEXT,
       closed_at TIMESTAMP,
       closed_by TEXT,
       next_chase_date DATE,
       created_at TIMESTAMP DEFAULT NOW(),
       created_by TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_claims_plan ON lg_claims(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_claims_status ON lg_claims(status)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_claims_chase ON lg_claims(next_chase_date)`,
    // r30h — resolution tracking: replacement-received-in-plan + resolution proof
    `ALTER TABLE lg_claims ADD COLUMN IF NOT EXISTS resolution_received_in_plan_id INTEGER REFERENCES lg_plans(id)`,
    `ALTER TABLE lg_claims ADD COLUMN IF NOT EXISTS resolution_received_at TIMESTAMP`,
    `ALTER TABLE lg_claims ADD COLUMN IF NOT EXISTS resolution_received_by TEXT`,
    `ALTER TABLE lg_claims ADD COLUMN IF NOT EXISTS resolution_proof_note TEXT`,
    // Claim files (photos / delivery sheets)
    `CREATE TABLE IF NOT EXISTS lg_claim_files (
       id SERIAL PRIMARY KEY,
       claim_id INTEGER NOT NULL REFERENCES lg_claims(id) ON DELETE CASCADE,
       filename TEXT NOT NULL,
       stored_path TEXT NOT NULL,
       mime_type TEXT,
       size_bytes INTEGER,
       uploaded_by TEXT,
       uploaded_by_role TEXT,
       uploaded_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_claim_files_claim ON lg_claim_files(claim_id)`,
    // Replacement promises (when supplier says "replace" we record which future plan)
    `CREATE TABLE IF NOT EXISTS lg_replacement_promises (
       id SERIAL PRIMARY KEY,
       source_claim_id INTEGER NOT NULL REFERENCES lg_claims(id) ON DELETE CASCADE,
       supplier_id INTEGER NOT NULL REFERENCES lg_suppliers(id),
       promised_plan_ref TEXT,
       description TEXT,
       fulfilled BOOLEAN DEFAULT FALSE,
       fulfilled_in_plan_id INTEGER REFERENCES lg_plans(id),
       fulfilled_at TIMESTAMP,
       fulfilled_by TEXT,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_repl_supplier ON lg_replacement_promises(supplier_id, fulfilled)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_repl_claim ON lg_replacement_promises(source_claim_id)`,

    // ── r31a — supplier_order_ref (used in r31c), lg_freight_agents, lg_quotes ─────────────────────────
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS supplier_order_ref TEXT`,

    `CREATE TABLE IF NOT EXISTS lg_freight_agents (
       id SERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       email TEXT NOT NULL,
       role TEXT NOT NULL CHECK (role IN ('quote','delivery','both')),
       active BOOLEAN NOT NULL DEFAULT TRUE,
       notes TEXT,
       created_at TIMESTAMP NOT NULL DEFAULT NOW(),
       created_by TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_freight_agents_active ON lg_freight_agents(active)`,
    // r31b — unique name needed for idempotent seeding
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_lg_freight_agents_name ON lg_freight_agents(LOWER(name))`,

    `CREATE TABLE IF NOT EXISTS lg_quotes (
       id SERIAL PRIMARY KEY,
       plan_id INTEGER NOT NULL REFERENCES lg_plans(id) ON DELETE CASCADE,
       agent_id INTEGER NOT NULL REFERENCES lg_freight_agents(id),
       link_token TEXT,
       route TEXT,
       eta_date DATE,
       free_days INTEGER,
       price NUMERIC(12,2),
       currency TEXT DEFAULT 'USD',
       validity_date DATE,
       notes TEXT,
       status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired')),
       submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
       decided_at TIMESTAMP,
       decided_by TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_quotes_plan ON lg_quotes(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_quotes_agent ON lg_quotes(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_quotes_status ON lg_quotes(status)`,

    // ── r31b — drop r31a tables we won't use; replace with lg_links; add plan agent FKs ────────────────
    `DROP TABLE IF EXISTS lg_external_submissions`,
    // r31b.1 — lg_quotes was created in r31a with a job_id FK to lg_agent_jobs. The r31b
    // CREATE TABLE IF NOT EXISTS was a no-op (table already existed), so the FK persisted
    // and the drop of lg_agent_jobs failed. Fix order: add link_token, drop FK + column, then drop table.
    `ALTER TABLE lg_quotes ADD COLUMN IF NOT EXISTS link_token TEXT`,
    `ALTER TABLE lg_quotes DROP COLUMN IF EXISTS job_id CASCADE`,
    `DROP TABLE IF EXISTS lg_agent_jobs`,

    `CREATE TABLE IF NOT EXISTS lg_links (
       token TEXT PRIMARY KEY,
       kind TEXT NOT NULL CHECK (kind IN ('quote','delivery')),
       agent_id INTEGER NOT NULL REFERENCES lg_freight_agents(id),
       plan_ids INTEGER[] NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT NOW(),
       created_by TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_links_agent ON lg_links(agent_id)`,

    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS freight_agent_id  INTEGER REFERENCES lg_freight_agents(id)`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS delivery_agent_id INTEGER REFERENCES lg_freight_agents(id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_freight_agent  ON lg_plans(freight_agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_plans_delivery_agent ON lg_plans(delivery_agent_id)`,

    // ── r31c — expanded quote fields + accepted-quote denormalisation on plan + audit change_note ───
    `ALTER TABLE lg_plans   ADD COLUMN IF NOT EXISTS etd_date DATE`,
    `ALTER TABLE lg_plans   ADD COLUMN IF NOT EXISTS shipping_line TEXT`,
    `ALTER TABLE lg_plans   ADD COLUMN IF NOT EXISTS arrival_port TEXT`,
    `ALTER TABLE lg_field_audit ADD COLUMN IF NOT EXISTS change_note TEXT`,
    `ALTER TABLE lg_quotes  ADD COLUMN IF NOT EXISTS etd_date DATE`,
    `ALTER TABLE lg_quotes  ADD COLUMN IF NOT EXISTS transit_time_days INTEGER`,
    `ALTER TABLE lg_quotes  ADD COLUMN IF NOT EXISTS demurrage_days INTEGER`,
    `ALTER TABLE lg_quotes  ADD COLUMN IF NOT EXISTS detention_days INTEGER`,
    `ALTER TABLE lg_quotes  ADD COLUMN IF NOT EXISTS shipping_line TEXT`,
    `ALTER TABLE lg_quotes  ADD COLUMN IF NOT EXISTS arrival_port TEXT`,

    // ── r31e — public file download tokens (30-day expiry) + per-plan import agent emails ───
    `ALTER TABLE lg_plan_files ADD COLUMN IF NOT EXISTS public_token TEXT`,
    `ALTER TABLE lg_plan_files ADD COLUMN IF NOT EXISTS public_token_expires_at TIMESTAMP`,
    `ALTER TABLE lg_plan_files ADD COLUMN IF NOT EXISTS public_token_revoked_at TIMESTAMP`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_lg_plan_files_public_token ON lg_plan_files(public_token) WHERE public_token IS NOT NULL`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS import_agent_emails TEXT`,
    // ── r31e.1 — disposition cleanup: 'issues' was an overloaded value; claims live independently now.
    `UPDATE lg_plans SET disposition='clean' WHERE disposition='issues'`,

    // ── r31g — warehouse receive/verify two-stage flow + 30d auto-close ───
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS warehouse_received_date TIMESTAMP`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS warehouse_received_by TEXT`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS warehouse_verified_date TIMESTAMP`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS warehouse_verified_by TEXT`,
    // ── r31i — manager-override reason when closing a plan without all required files
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS close_override_reason TEXT`,
    // ── r31j — separate tracking URL (distinct from tracking_number which stays as text ID)
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS tracking_link TEXT`,
    // ── r31g — orphan task cleanup: decide_disposition rule was removed; auto-archive any leftover open rows ───
    `UPDATE lg_tasks SET status='auto_archived', completed_at=NOW(), completion_note=COALESCE(completion_note,'') || ' [auto-archived r31g: rule removed]' WHERE rule_key='decide_disposition' AND status IN ('open','claimed')`,
    // ── r31j — drop verify_telex task (gate 5 UI is the only telex tick surface; standalone task was redundant)
    `UPDATE lg_tasks SET status='auto_archived', completed_at=NOW(), completion_note=COALESCE(completion_note,'') || ' [auto-archived r31j: rule removed]' WHERE rule_key='verify_telex' AND status IN ('open','claimed')`,
    // ── r31j — drop kemballs-route-specific tasks; replaced by unified book_local_delivery + log_delivery_sheet
    `UPDATE lg_tasks SET status='auto_archived', completed_at=NOW(), completion_note=COALESCE(completion_note,'') || ' [auto-archived r31j: rule consolidated]' WHERE rule_key IN ('book_kemballs_retrieval','confirm_kemballs_delivery','log_delivery_sheet_kemballs') AND status IN ('open','claimed')`,
    // ── r31j — production check timing: day 7 → day 14, day 21 → day 28. Rename rule_keys to match new cadence.
    `UPDATE lg_tasks SET rule_key='production_check_day_14' WHERE rule_key='production_check_day_7'`,
    `UPDATE lg_tasks SET rule_key='production_check_day_28' WHERE rule_key='production_check_day_21'`,
    // ── r31m-prep — Google Chat webhook URL per user for real-time notifications
    //   r31n note: GChat path is being killed in r32 (replaced by in-app bell). Column kept
    //   for now to avoid breaking existing rows; gets dropped when the bell ships.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS gchat_webhook_url TEXT`,
    // ── r31n — per-name task assignment (in addition to per-role).
    //   Used for tasks owned by a specific person (e.g. production checks → Satyam,
    //   book_container → Shauraya, eta_check → Shauraya). NULL = falls back to role-based.
    `ALTER TABLE lg_tasks ADD COLUMN IF NOT EXISTS intended_assignee_name TEXT`,
    // ── r31n — gate-4 review task tracking. Flag flips true when Shauraya/Neha mark
    //   the docs reviewed (and amended if needed) after supplier submits gate-4 uploads.
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS gate4_review_done BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS gate4_review_done_at TIMESTAMP`,
    `ALTER TABLE lg_plans ADD COLUMN IF NOT EXISTS gate4_review_done_by TEXT`,
    // ── r31n — notifications scaffolding. notify() helper writes here (logs only for now);
    //   r32 reads from this table to render the bell. Keeps r31n forward-compatible without
    //   shipping a UI yet.
    `CREATE TABLE IF NOT EXISTS lg_notifications (
       id SERIAL PRIMARY KEY,
       user_id INTEGER,
       user_name TEXT,
       event_type TEXT NOT NULL,
       title TEXT NOT NULL,
       body TEXT,
       plan_id INTEGER,
       task_id INTEGER,
       read_at TIMESTAMP,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_notif_user ON lg_notifications(user_id, read_at)`,
    `CREATE INDEX IF NOT EXISTS idx_lg_notif_created ON lg_notifications(created_at DESC)`
  ];
  let ok = 0, fail = 0;
  for (const sql of stmts) {
    try { await db.query(sql); ok++; }
    catch(e) { fail++; console.error('[logistics schema] ' + e.message + ' — ' + sql.split('\n')[0].slice(0,80)); }
  }
  console.log('[logistics schema r31n] ' + ok + '/' + (ok+fail) + ' statements applied');
}

async function ensureLogisticsSeed(db) {
  // r30l — backfill supplier_share_token for plans created before the column existed
  try {
    const missing = await db.query("SELECT id FROM lg_plans WHERE supplier_share_token IS NULL OR supplier_share_token = ''");
    for (const row of missing.rows) {
      const tok = crypto.randomBytes(16).toString('hex');
      await db.query('UPDATE lg_plans SET supplier_share_token=$1 WHERE id=$2', [tok, row.id]);
    }
    if (missing.rows.length) console.log('[logistics seed] backfilled supplier_share_token for ' + missing.rows.length + ' plans');
  } catch(e) { console.error('[logistics seed] backfill share tokens: ' + e.message); }

  // r30m — rename disposition value 'campbells' → 'kemballs' (one-time data migration)
  try {
    const r = await db.query("UPDATE lg_plans SET disposition='kemballs' WHERE disposition='campbells'");
    if (r.rowCount) console.log('[logistics seed] migrated ' + r.rowCount + " plans from disposition='campbells' to 'kemballs'");
  } catch(e) { console.error('[logistics seed] disposition migration: ' + e.message); }

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

  // r31b — seed freight agents (Yobonstar, Sienna, Origin Logistics)
  const defaultFreightAgents = [
    { name: 'Yobonstar',        email: '', role: 'quote'    },
    { name: 'Sienna',           email: '', role: 'quote'    },
    { name: 'Origin Logistics', email: '', role: 'both'     }
  ];
  for (const fa of defaultFreightAgents) {
    try {
      const exists = await db.query('SELECT id FROM lg_freight_agents WHERE LOWER(name)=LOWER($1)', [fa.name]);
      if (!exists.rows.length) {
        await db.query(
          'INSERT INTO lg_freight_agents (name, email, role, created_by) VALUES ($1,$2,$3,$4)',
          [fa.name, fa.email, fa.role, 'seed']
        );
        console.log('[logistics seed] freight agent created: ' + fa.name);
      }
    } catch(e) { console.error('[logistics seed] freight agent ' + fa.name + ': ' + e.message); }
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
  if (!u) return false;
  if (isManager(u)) return true;
  const role = (u.role || '').toLowerCase();
  // r31f — new logistics roles all have access to the module
  if (['logistics_agent','accounts_agent','warehouse_agent'].includes(role)) return true;
  return (u.department || '').toLowerCase() === 'logistics';
}
// r31f — accounts-only view (Mahima): financial fields only
function isAccountsOnlyUser(u) {
  if (!u) return false;
  return (u.role || '').toLowerCase() === 'accounts_agent';
}
// r31f — warehouse-only view (Harp): warehouse incoming + archive only, no plan edit
function isWarehouseOnlyUser(u) {
  if (!u) return false;
  return (u.role || '').toLowerCase() === 'warehouse_agent';
}
function actor(req) { return (req.user && req.user.name) || 'unknown'; }

// ─────────────────────────────────────────────────────────────────────────────
// r31n — notify() helper. Single entry point for all in-app notifications.
//
// Today: writes a row to lg_notifications + console.log. No UI surface yet.
// r32: the bell-icon dropdown reads from lg_notifications; same call sites work
// unchanged. This keeps r31n code forward-compatible without shipping a UI
// we'd have to redo in r32.
//
// GChat webhook delivery is INTENTIONALLY NOT WIRED — being replaced by the
// in-app bell in r32. No point building the webhook fan-out now just to delete
// it in two weeks. The gchat_webhook_url column stays on users for now (cheap)
// and gets dropped when r32 ships.
//
// Usage:
//   await notify(db, { user_name: 'Mahima' }, 'task_created', {
//     title: 'Pay deposit — Plan no 142',
//     body: 'Due Friday 23 May. Supplier sent PI yesterday.',
//     plan_id: 142, task_id: 9871
//   });
//
// `target` is either { user_id } or { user_name } or { role } — notify() resolves
// to one or more user rows and writes a notification per recipient. For shared
// roles like 'logistics_shared', writes one row per matching user. Failure is
// silent — notifications must never block the action that triggered them.
// ─────────────────────────────────────────────────────────────────────────────
async function notify(db, target, eventType, data) {
  try {
    let recipients = [];
    if (target && target.user_id) {
      const r = await db.query('SELECT id, name FROM users WHERE id=$1', [target.user_id]);
      recipients = r.rows;
    } else if (target && target.user_name) {
      // Case-insensitive match on first name (covers 'Mahima' / 'mahima')
      const r = await db.query("SELECT id, name FROM users WHERE LOWER(name)=LOWER($1) AND is_active=TRUE", [target.user_name]);
      recipients = r.rows;
    } else if (target && target.role) {
      // 'logistics_shared' = both Shauraya and Neha (any logistics_agent)
      // 'logistics_agent' / 'accounts_agent' / 'warehouse_agent' = matching role
      const roleQuery = target.role === 'logistics_shared'
        ? "SELECT id, name FROM users WHERE role='logistics_agent' AND is_active=TRUE"
        : "SELECT id, name FROM users WHERE role=$1 AND is_active=TRUE";
      const args = target.role === 'logistics_shared' ? [] : [target.role];
      const r = await db.query(roleQuery, args);
      recipients = r.rows;
    }
    if (!recipients.length) {
      // No-op but not an error — e.g. nobody currently has logistics_agent role
      console.log('[notify] no recipients for ' + JSON.stringify(target) + ' event=' + eventType);
      return;
    }
    for (const u of recipients) {
      await db.query(
        `INSERT INTO lg_notifications (user_id, user_name, event_type, title, body, plan_id, task_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [u.id, u.name, eventType, data.title || eventType, data.body || null,
         data.plan_id || null, data.task_id || null]
      );
    }
    console.log('[notify] ' + eventType + ' → ' + recipients.map(r=>r.name).join(',') + ' "' + (data.title||'').slice(0,60) + '"');
  } catch(e) {
    console.error('[notify] failed: ' + e.message);
    // never throw — notifications are best-effort
  }
}

// r31c — compute which supplier-portal tasks are pending for a plan
function computeSupplierAvailableTasks(p) {
  const tasks = [];
  if (!p.approx_loading_date) tasks.push('loading_date');
  if (!p.actual_loading_date || !p.bl_number || !p.bl_date || p.final_amount_usd == null) tasks.push('bl_docs');
  if (!p.telex_supplier_declared) tasks.push('telex');
  return tasks;
}
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
  if (!has(plan.final_payment_received_date) || !plan.shipper_payment_made || !has(plan.disposition)) {
    const due = computeFinalPaymentDue(plan, supplier);
    const overdue = due ? daysBetween(due, today) > 0 : false;
    return mk(5, 'Final payment + disposition', 'accounts', Math.max(0, due ? daysBetween(due, today) : 0), overdue, 'Pay final, pay shipper, decide disposition, tick telex when verified');
  }
  // r30i — telex no longer a standalone gate; it's an inline tick on gate 5.
  // Once gate 5 is done, plan advances straight to gate 6 (docs to import agent).
  if (!has(plan.docs_sent_to_import_agent_date)) {
    return mk(6, 'Send docs to import agent', 'agent', 0, false, 'Send BL + PI + Packing List to import agent (telex check can run in parallel)');
  }
  if (!has(plan.duty_paid_date)) {
    if (!has(plan.duty_invoice_received_date)) return mk(7, 'Awaiting duty invoice', 'accounts', 0, false, 'Waiting for duty invoice from import agent');
    return mk(7, 'Pay UK customs duty', 'accounts', 0, false, 'Mahima to pay duty');
  }
  if (!has(plan.customs_cleared_date)) return mk(8, 'Confirm customs cleared', 'agent', 0, false, 'Confirm customs clearance');
  // r31h — gate 9 is now FINAL. After delivery_date set, plan moves into warehouse-handoff state.
  // No gate 10. Plan auto-closes 14 days post-warehouse-verify (see dailyTaskEvaluation sweep).
  // r31j — Kemballs is a transit waypoint, not a destination. From the agent's POV gate 9
  //   is the same for both routes: book delivery to warehouse, then mark delivered. The only
  //   difference is the partner field (typically Kemballs's nominated agent for kemballs route).
  if (plan.disposition === 'clean' || plan.disposition === 'kemballs' || plan.disposition === 'campbells') {
    if (!has(plan.delivery_date)) {
      const subtitle = (plan.disposition === 'kemballs' || plan.disposition === 'campbells')
        ? 'Book retrieval from Kemballs to warehouse'
        : 'Book + complete delivery to warehouse';
      return mk(9, 'Local delivery', 'agent', 0, false, subtitle);
    }
    return mk(9, 'Awaiting warehouse', 'warehouse', 0, false, 'With warehouse for receive + verify');
  }
  return mk(0, 'Unknown', '—', 0, false, null);

  function mk(n, name, owner, days, overdue, action) {
    return { current_gate: n, current_gate_name: name, current_gate_owner: owner,
             days_stuck: days, is_overdue: overdue, overdue_days: overdue ? days : 0, next_action: action };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// r30g — STAGES_CONFIG: declarative definition of each gate's stage card.
// Each entry describes: fields to render, required-doc slots, payment amount source,
// and the completion check (when can "Mark stage complete" fire).
// ─────────────────────────────────────────────────────────────────────────────
const STAGES_CONFIG = {
  1: {
    name: 'Pay deposit', subtitle: 'Mahima sends deposit to supplier, captures proof',
    owner: 'accounts', kind: 'payment',
    money: {
      label: 'Amount to pay',
      compute: function(p) {
        const total = parseFloat(p.total_amount_usd) || 0;
        const dep = parseFloat(p.deposit_usd) || (total * (parseFloat(p.deposit_pct) || 0) / 100);
        const pct = total > 0 ? Math.round(dep / total * 100) : (parseFloat(p.deposit_pct) || null);
        return { amount: dep, currency: 'USD',
                 breakdown: pct ? (pct + '% of $' + Math.round(total).toLocaleString()) : '' };
      }
    },
    fields: [
      { id: 'deposit_received_date', label: 'Date paid', type: 'date', required: true }
    ],
    docs: [
      { slot: 'deposit_proof', label: 'Proof of deposit transfer', required: true },
      // r31i — quote OR original_pi must exist by end of gate 1. We list both as not-individually-required
      //   here; the gate complete() and the close-plan check both treat them as one-of.
      { slot: 'quote', label: 'Quote (or Original PI)', required: false },
      { slot: 'original_pi', label: 'Original PI (or Quote)', required: false }
    ],
    complete: function(p, hasDocs) {
      // r31i — at least one of quote or original_pi must exist + deposit_proof.
      return !!p.deposit_received_date && hasDocs('deposit_proof') && (hasDocs('quote') || hasDocs('original_pi'));
    }
  },
  2: {
    name: 'Get approx loading date', subtitle: 'Confirm with supplier when goods will load',
    owner: 'agent', kind: 'fields',
    fields: [
      { id: 'approx_loading_date', label: 'Approx loading date', type: 'date', required: true }
    ],
    docs: [],
    complete: function(p) { return !!p.approx_loading_date; }
  },
  3: {
    name: 'Book container', subtitle: 'Lock in shipper, container price, free days',
    owner: 'agent', kind: 'fields',
    fields: [
      { id: 'shipper_name', label: 'Shipper / forwarder', type: 'text', required: true, placeholder: 'e.g. Maersk' },
      { id: 'container_price_usd', label: 'Container price (USD)', type: 'number', required: true },
      { id: 'free_days', label: 'Free days at destination', type: 'number', required: false }
    ],
    docs: [],
    complete: function(p) { return !!p.shipper_name && p.container_price_usd != null; }
  },
  4: {
    name: 'Loading & documents', subtitle: 'Container loaded. Capture loading date, BL, final amount. All key docs uploaded.',
    owner: 'agent', kind: 'fields',
    fields: [
      { id: 'actual_loading_date', label: 'Actual loading date', type: 'date', required: true },
      { id: 'bl_number', label: 'BL number', type: 'text', required: true, placeholder: 'e.g. MAEU-12783451' },
      { id: 'bl_date', label: 'BL date', type: 'date', required: false },
      { id: 'final_amount_usd', label: 'Final amount (USD)', type: 'number', required: true },
      { id: 'original_eta', label: 'Original ETA', type: 'date', required: true },
      { id: 'container_number', label: 'Container number', type: 'text', required: false }
    ],
    docs: [
      { slot: 'bl', label: 'Bill of lading', required: true },
      { slot: 'final_pi', label: 'Final PI', required: true },
      { slot: 'packing_list', label: 'Packing list', required: true },
      // r31i — loading photos flipped from optional to required (every plan must have photos of loaded goods).
      { slot: 'loading_photo', label: 'Loading photos', required: true }
    ],
    complete: function(p, hasDocs) {
      return !!p.actual_loading_date && !!p.bl_number && p.final_amount_usd != null
          && !!p.original_eta && hasDocs('bl') && hasDocs('final_pi') && hasDocs('packing_list') && hasDocs('loading_photo');
    }
  },
  5: {
    name: 'Final payment + disposition', subtitle: 'Pay final to supplier, pay shipper, decide where it goes, tick telex when verified',
    owner: 'accounts', kind: 'payment',
    money: {
      label: 'Amount to pay (supplier)',
      compute: function(p) {
        // r30i — Final PI − Deposit is the authoritative number. Falls back to (Total − Deposit) only if Final PI not set.
        const total = parseFloat(p.total_amount_usd) || 0;
        const dep = parseFloat(p.deposit_usd) || 0;
        const finalPi = parseFloat(p.final_pi_amount_usd);
        let owed, breakdown;
        if (!isNaN(finalPi) && finalPi > 0) {
          owed = finalPi - dep;
          breakdown = 'Final PI $' + Math.round(finalPi).toLocaleString() + ' − Deposit $' + Math.round(dep).toLocaleString() + ' already paid';
        } else {
          owed = total - dep;
          breakdown = 'Total $' + Math.round(total).toLocaleString() + ' − Deposit $' + Math.round(dep).toLocaleString() + ' (Final PI amount not yet recorded — pull from Final PI doc)';
        }
        return { amount: owed, currency: 'USD', breakdown: breakdown };
      },
      secondary: {
        label: 'Plus shipper',
        compute: function(p) {
          const ship = parseFloat(p.container_price_usd) || 0;
          return { amount: ship, currency: 'USD', breakdown: 'To: ' + (p.shipper_name || 'shipper') };
        }
      }
    },
    fields: [
      { id: 'final_pi_amount_usd', label: 'Final PI amount (USD)', type: 'number', required: true,
        placeholder: 'Pull from Final PI document', help: 'What\'s on the Final PI document. System uses this minus deposit to calculate amount to pay.' },
      { id: 'final_amount_usd', label: 'Amount actually paid (USD)', type: 'number', required: true,
        placeholder: 'Auto-fills from Final PI − Deposit', help: 'Defaults to Final PI − Deposit. Edit only if real amount differs (e.g. credit applied).' },
      { id: 'final_payment_received_date', label: 'Final payment date', type: 'date', required: true },
      { id: 'shipper_payment_made', label: 'Shipper paid', type: 'boolean', required: true },
      { id: 'shipper_payment_date', label: 'Shipper payment date', type: 'date', required: false },
      // r30g — disposition decided HERE, not at gate 10
      { id: 'disposition', label: 'Where will it go?', type: 'select', required: true,
        options: [
          { value: 'clean', label: 'Direct to warehouse' },
          { value: 'kemballs', label: 'Kemballs (storage)' }
        ] },
      // r30i — telex tick is now part of gate 5 (parallel concern, doesn't block docs to import agent)
      { id: 'telex_confirmed_by_agent', label: 'Telex verified by FK (can be ticked later)', type: 'boolean', required: false }
    ],
    docs: [
      { slot: 'final_payment_proof', label: 'Final payment proof', required: true },
      { slot: 'shipper_payment_proof', label: 'Shipper payment proof', required: true },
      { slot: 'telex', label: 'Telex confirmation (when supplier sends it)', required: false }
    ],
    complete: function(p, hasDocs) {
      return !!p.final_payment_received_date && !!p.shipper_payment_made && !!p.disposition
          && hasDocs('final_payment_proof') && hasDocs('shipper_payment_proof');
      // Note: telex_confirmed_by_agent is NOT required to advance — runs parallel.
    }
  },
  // r30i — gate 6 was telex; now removed. Gate 6 = docs to import agent.
  6: {
    name: 'Send docs to import agent', subtitle: 'Forward BL + Final PI + Packing list to UK import agent (telex check can run in parallel)',
    owner: 'agent', kind: 'fields',
    fields: [
      { id: 'docs_sent_to_import_agent_date', label: 'Date docs sent', type: 'date', required: true }
    ],
    docs: [],
    complete: function(p) { return !!p.docs_sent_to_import_agent_date; }
  },
  7: {
    name: 'Customs duty', subtitle: 'Receive duty invoice from import agent, pay HMRC',
    owner: 'accounts', kind: 'payment',
    money: {
      label: 'Duty to pay',
      compute: function(p) {
        const amt = parseFloat(p.duty_invoice_amount_gbp) || 0;
        return { amount: amt, currency: 'GBP',
                 breakdown: p.duty_invoice_received_date ? 'Invoice received ' + asIso(p.duty_invoice_received_date) : 'Invoice not yet received' };
      }
    },
    fields: [
      { id: 'duty_invoice_received_date', label: 'Duty invoice received', type: 'date', required: true },
      { id: 'duty_invoice_amount_gbp', label: 'Duty invoice amount (GBP)', type: 'number', required: true },
      { id: 'duty_paid_date', label: 'Duty paid date', type: 'date', required: true }
    ],
    docs: [
      { slot: 'duty_invoice', label: 'Duty invoice', required: true },
      { slot: 'duty_payment_proof', label: 'Duty payment proof', required: true }
    ],
    complete: function(p, hasDocs) {
      return !!p.duty_paid_date && !!p.duty_invoice_amount_gbp
          && hasDocs('duty_invoice') && hasDocs('duty_payment_proof');
    }
  },
  8: {
    name: 'Ready to deliver', subtitle: 'Customs cleared. Container ready for collection.',
    owner: 'agent', kind: 'milestone',
    fields: [
      { id: 'customs_cleared_date', label: 'Customs cleared on', type: 'date', required: true }
    ],
    docs: [],
    complete: function(p) { return !!p.customs_cleared_date; }
  },
  9: {
    name: 'Local delivery', subtitle: 'Book delivery to warehouse (from port directly, or from Kemballs)',
    owner: 'agent', kind: 'fields',
    fields: [
      { id: 'local_delivery_booked_date', label: 'Delivery booked date', type: 'date', required: true },
      { id: 'local_delivery_partner', label: 'Delivery partner', type: 'text', required: true,
        help: 'For Kemballs route, this is usually the same local agent that handles direct deliveries' },
      { id: 'delivery_date', label: 'Actual delivery date', type: 'date', required: true }
    ],
    // r31i — delivery_sheet moved to warehouse stage as "Final delivery sheet" (Neha's Linnworks export).
    //   PL Match + Stock/Location Sheet are also warehouse-stage uploads, not gate-9 ones.
    docs: [],
    complete: function(p) { return !!p.delivery_date; }
  }
  // r31j — `9_kemballs` variant removed. Kemballs is a transit waypoint, not a separate
  //   destination gate. Same gate 9 handles both routes; differences are cosmetic only.
  //   Container arrival at Kemballs is auto-set on customs_cleared_date (no separate gate).
  // r31h — gate 10 and 10_close removed entirely. After delivery_date set, plan is in warehouse-handoff.
};

function gateConfigKey(plan, gate) {
  // r31j — `9_kemballs` variant removed; gate 9 is unified for both routes.
  return String(gate);
}

function buildStageCard(plan, supplier, files) {
  const stageInfo = computeStage(plan, supplier);
  const gate = stageInfo.current_gate;
  // r30j — resolve variant config key (e.g. '9_kemballs' for Kemballs route)
  const cfgKey = gateConfigKey(plan, gate);
  const cfg = STAGES_CONFIG[cfgKey];
  if (!cfg) return { stage: stageInfo, config: null };
  // files: array of {slot, slot_group, ...}
  const filesBySlot = {};
  (files || []).forEach(function(f) {
    if (!f.deleted_at) (filesBySlot[f.slot] = filesBySlot[f.slot] || []).push(f);
  });
  function hasDocs(slot) { return !!(filesBySlot[slot] && filesBySlot[slot].length); }
  // Annotate docs with upload status
  const docs = (cfg.docs || []).map(function(d) {
    const fs = filesBySlot[d.slot] || [];
    return { slot: d.slot, label: d.label, required: !!d.required,
             uploaded: fs.length > 0, latest_file: fs[0] || null, count: fs.length };
  });
  const money = cfg.money ? cfg.money.compute(plan) : null;
  const moneySecondary = cfg.money && cfg.money.secondary ? cfg.money.secondary.compute(plan) : null;
  const canComplete = cfg.complete(plan, hasDocs);
  // Identify what's still missing for the user-facing "x of y required still missing" line
  const missing = [];
  (cfg.fields || []).forEach(function(f) {
    if (!f.required) return;
    const v = plan[f.id];
    const empty = (v === null || v === undefined || v === '');
    if (empty) missing.push({ kind: 'field', id: f.id, label: f.label });
  });
  docs.forEach(function(d) {
    if (d.required && !d.uploaded) missing.push({ kind: 'doc', slot: d.slot, label: d.label });
  });
  return {
    stage: stageInfo,
    config: {
      gate: gate, name: cfg.name, subtitle: cfg.subtitle, owner: cfg.owner, kind: cfg.kind,
      fields: cfg.fields || [], docs: docs,
      money: money ? { label: cfg.money.label, amount: money.amount, currency: money.currency, breakdown: money.breakdown } : null,
      money_secondary: moneySecondary ? { label: cfg.money.secondary.label, amount: moneySecondary.amount, currency: moneySecondary.currency, breakdown: moneySecondary.breakdown } : null,
      can_complete: canComplete, missing: missing
    }
  };
}


function kemballsCost(plan) {
  if ((plan.disposition !== 'kemballs' && plan.disposition !== 'campbells') || !plan.campbells_in_date) return { weeks: 0, incurred: 0, weekly: 0 };
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
  // r30f — single merged notes field for UI (old shipping_notes appended after remarks if present)
  const remarksStr = plan.remarks || '';
  const shippingStr = plan.shipping_notes || '';
  const notesMerged = (remarksStr && shippingStr) ? (remarksStr + '\n\n— Older shipping notes —\n' + shippingStr)
                    : (remarksStr || shippingStr || null);
  return Object.assign({}, plan, {
    supplier_name: supplier && supplier.name || null,
    supplier_payment_terms: supplier && supplier.payment_terms || null,
    ...stage,
    campbells_weeks: cost.weeks,
    campbells_incurred_gbp: cost.incurred,
    campbells_weekly_effective_gbp: cost.weekly,
    final_payment_due_date_computed: finalDue,
    notes: notesMerged
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

// r30f — rules now declare `requires` (array of rule_keys that must be done first).
// A rule won't fire unless its condition is true AND all required rule_keys exist with status 'done' or 'auto_archived'.
// `primary` marks the one rule per gate that is the "headline next action" surfaced in the per-plan card.
//
// r31n — `assignee_name` (item 15): per-name assignment for tasks owned by a specific person.
//   When set, the task is created with intended_assignee_name = that name. Task-listing queries
//   filter by name (when present) OR role (when name is null). Shared roles like 'logistics_shared'
//   stay role-only — visible to all logistics_agents (Shauraya + Neha).
//
// Locked 19-task assignee matrix (r31n item 15):
//   #1  pay_deposit            → Mahima
//   #2  chase_approx_loading   → logistics_shared (Shauraya + Neha)
//   #3  production_check_day_14→ Satyam       (r31n item 4)
//   #4  production_check_day_28→ Satyam       (r31n item 4)
//   #5  confirm_exact_loading  → logistics_shared
//   #6  final_loading_confirm  → logistics_shared
//   #7  book_container         → Shauraya
//   #8  pay_final              → Mahima
//   #9  pay_shipper            → Mahima
//   #10 send_docs_to_agent     → logistics_shared  (also gets gate-6 due-date fix below — item 10)
//   #11 await_duty_invoice     → Mahima
//   #12 pay_duty               → Mahima
//   #13 confirm_customs_clear  → logistics_shared
//   #14 book_local_delivery    → logistics_shared
//   #15 log_delivery_sheet     → logistics_shared
//   #16 eta_check (recurring)  → Shauraya (set in bumpEtaCheck/dailyTaskEvaluation, not here)
//   #17 review_gate4_docs      → logistics_shared (NEW — r31n item 12)
//   #18 mark_warehouse_received→ Harp (warehouse_agent — set at action site, not a task rule)
//   #19 mark_warehouse_verified→ logistics_shared (action site, not a task rule)
const TASK_RULES = [
  { key: 'pay_deposit', role: 'accounts', assignee_name: 'Mahima', primary: true,
    title: p => 'Pay deposit — ' + p.plan_number,
    title_cn: p => '支付订金 — ' + p.plan_number,
    condition: p => !p.deposit_received_date && p.status === 'active',
    due: p => p.order_date ? addDays(p.order_date, 1) : todayDate() },
  { key: 'chase_approx_loading', role: 'agent', primary: true,
    title: p => 'Get approx loading date from supplier — ' + p.plan_number,
    title_cn: p => '向供应商确认大致装柜日期 — ' + p.plan_number,
    condition: p => p.deposit_received_date && !p.approx_loading_date && p.status === 'active',
    due: p => addDays(p.deposit_received_date, 3) },
  // r31n item 4 — production checks routed to Satyam (was role:'agent' → fell to Shauraya/Neha)
  { key: 'production_check_day_14', role: 'agent', assignee_name: 'Satyam',
    title: p => 'Day 14 production check — ' + p.plan_number,
    title_cn: p => '生产第14天检查 — ' + p.plan_number,
    condition: p => p.deposit_received_date && !p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.deposit_received_date, 14) },
  { key: 'production_check_day_28', role: 'agent', assignee_name: 'Satyam',
    title: p => 'Day 28 mid-production check — ' + p.plan_number,
    title_cn: p => '生产第28天中期检查 — ' + p.plan_number,
    requires: ['production_check_day_14'],
    condition: p => p.deposit_received_date && !p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.deposit_received_date, 28) },
  { key: 'confirm_exact_loading', role: 'agent', primary: true,
    title: p => 'Confirm exact loading date — ' + p.plan_number,
    title_cn: p => '确认准确装柜日期 — ' + p.plan_number,
    condition: p => p.approx_loading_date && !p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.approx_loading_date, -14) },
  { key: 'final_loading_confirm', role: 'agent',
    title: p => 'Final pre-loading confirmation — ' + p.plan_number,
    title_cn: p => '装柜前最终确认 — ' + p.plan_number,
    requires: ['confirm_exact_loading'],
    condition: p => p.approx_loading_date && !p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.approx_loading_date, -2) },
  // r31n item 15 — book_container specifically Shauraya (not shared)
  { key: 'book_container', role: 'agent', assignee_name: 'Shauraya', primary: true,
    title: p => 'Book container with shipper — ' + p.plan_number,
    title_cn: p => '与货代订舱 — ' + p.plan_number,
    condition: p => p.approx_loading_date && !p.shipper_name && p.status === 'active',
    due: p => addDays(p.approx_loading_date, -7) },
  // r31n item 12 (NEW) — Gate-4 review task. After supplier uploads BL+PI+packing list+loading photos
  //   at gate 4, Shauraya/Neha review the docs, amend if needed, and re-upload. Marks
  //   gate4_review_done=TRUE which closes the task.
  { key: 'review_gate4_docs', role: 'agent', primary: true,
    title: p => 'Review supplier gate-4 docs (BL/PI/PL/loading photos) — ' + p.plan_number,
    title_cn: p => '审核装柜文件 — ' + p.plan_number,
    condition: p => p.actual_loading_date && p.bl_number && !p.gate4_review_done && p.status === 'active',
    due: p => addDays(p.actual_loading_date, 2) },
  { key: 'pay_final', role: 'accounts', assignee_name: 'Mahima', primary: true,
    title: p => 'Pay final payment to supplier — ' + p.plan_number,
    title_cn: p => '向供应商支付尾款 — ' + p.plan_number,
    condition: p => p.original_eta && !p.final_payment_received_date && p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.original_eta, -14) },
  { key: 'pay_shipper', role: 'accounts', assignee_name: 'Mahima', primary: true,
    title: p => 'Pay shipping cost to freight forwarder — ' + p.plan_number,
    title_cn: p => '向货代支付运输费 — ' + p.plan_number,
    // r31k — promoted to primary + dependency on pay_final removed. Mahima typically pays both
    //   at the same time (telex won't be released until shipper is paid). Showing them as two
    //   parallel tasks makes the obligation clearer than burying shipper-pay behind final-pay.
    condition: p => p.original_eta && !p.shipper_payment_made && p.actual_loading_date && p.status === 'active',
    due: p => addDays(p.original_eta, -14) },
  // r31j — verify_telex rule removed. Gate 5 has a checkbox `telex_confirmed_by_agent` which is
  //   the only place to verify telex. Standalone task was a safety net that just added noise.
  //   Boot migration auto-archives any open verify_telex tasks.
  // r31n item 10 — gate-6 due date fix. Was `due: todayDate()` which meant the task was due
  //   the moment it fired (order_date in some Plan no 140 case). Per Bobby: send docs to import
  //   agent ~14 days before ETA (aligns with final-payment timing). Fall back to today + 7 if
  //   no ETA yet (shouldn't happen — gate 4 must be complete first, which sets original_eta).
  { key: 'send_docs_to_agent', role: 'agent', primary: true,
    title: p => 'Send BL + PI + Packing List to import agent — ' + p.plan_number,
    title_cn: p => '将提单+发票+装箱单发给报关行 — ' + p.plan_number,
    condition: p => p.telex_confirmed_by_agent && !p.docs_sent_to_import_agent_date && p.status === 'active',
    due: p => {
      const eta = p.new_eta || p.original_eta;
      return eta ? addDays(eta, -14) : addDays(todayDate(), 7);
    } },
  { key: 'await_duty_invoice', role: 'accounts', assignee_name: 'Mahima', primary: true,
    title: p => 'Watch for duty invoice from import agent — ' + p.plan_number,
    title_cn: p => '等待报关行发来关税发票 — ' + p.plan_number,
    condition: p => p.docs_sent_to_import_agent_date && !p.duty_invoice_received_date && p.status === 'active',
    due: p => addDays(p.docs_sent_to_import_agent_date, 5) },
  { key: 'pay_duty', role: 'accounts', assignee_name: 'Mahima', primary: true,
    title: p => 'Pay UK customs duty — ' + p.plan_number,
    title_cn: p => '支付英国关税 — ' + p.plan_number,
    requires: ['await_duty_invoice'],
    condition: p => p.duty_invoice_received_date && !p.duty_paid_date && p.status === 'active',
    due: p => addDays(p.duty_invoice_received_date, 2) },
  { key: 'confirm_customs_clear', role: 'agent', primary: true,
    title: p => 'Confirm customs cleared — ' + p.plan_number,
    title_cn: p => '确认通关完成 — ' + p.plan_number,
    requires: ['pay_duty'],
    condition: p => p.duty_paid_date && !p.customs_cleared_date && p.status === 'active',
    due: p => addDays(p.duty_paid_date, 2) },
  // r31g — `decide_disposition` rule removed: disposition is now set at gate 5 (per r30i), long before
  //   customs_cleared_date. The old condition (customs_cleared && !disposition) could never fire.
  //   Dependencies rewired to require confirm_customs_clear directly.
  // r31j — Unified delivery tasks. Previously had separate book_local_delivery (clean only)
  //   and book_kemballs_retrieval (kemballs only). Now one task fires regardless of route;
  //   the agent books delivery with whichever partner is appropriate for the disposition.
  // r31n.1 — Same task fires for both clean and Kemballs routes. Plan stays status='active'
  //   throughout (no parking flag). For Kemballs plans, condition fires once customs cleared;
  //   due date is later (7d from clearance) so it doesn't show as red immediately during storage.
  //   For clean plans, due date = today so it surfaces urgently.
  { key: 'book_local_delivery', role: 'agent', primary: true,
    title: p => 'Book local delivery — ' + p.plan_number,
    title_cn: p => '与本地承运商预约送货 — ' + p.plan_number,
    requires: ['confirm_customs_clear'],
    condition: p => p.customs_cleared_date && !p.local_delivery_booked_date && !p.delivery_date
                 && p.status === 'active',
    // r31n.1 — Due dates differ by route. Clean = immediate (container needs delivery booked
    //   right after customs clearance). Kemballs = +7 days from clearance (storage is the
    //   buffer; no urgency until cost starts to bite, and the 8-week aging warning catches stale ones).
    due: p => {
      const isKemballs = p.disposition === 'kemballs' || p.disposition === 'campbells';
      return isKemballs ? addDays(p.customs_cleared_date, 7) : todayDate();
    } },
  { key: 'log_delivery_sheet', role: 'agent', primary: true,
    title: p => 'Upload delivery sheet — ' + p.plan_number,
    title_cn: p => '上传送货单 — ' + p.plan_number,
    requires: ['book_local_delivery'],
    condition: p => p.delivery_date && !p.closed_at && p.status === 'active',
    due: p => todayDate() }
];

async function evaluateTasks(db, planId) {
  if (!planId) return;
  const r = await db.query('SELECT * FROM lg_plans WHERE id=$1', [planId]);
  if (!r.rows.length) return;
  const plan = r.rows[0];
  // r31n.1 — Cancelled/closed plans pause task firing. Kemballs is NOT a status — it's a bucket
  //   computed from field values, so a Kemballs plan stays status='active' and tasks fire normally.
  //   The book_local_delivery task is what surfaces "container needs delivery booked" in both
  //   Kemballs and warehouse-incoming views — same task, same assignee, same rule.
  if (plan.status !== 'active') {
    const stale = await db.query("SELECT id FROM lg_tasks WHERE plan_id=$1 AND status IN ('open','claimed')", [planId]);
    if (stale.rows.length) {
      await db.query(
        "UPDATE lg_tasks SET status='auto_archived', completed_at=NOW(), completion_note=COALESCE(completion_note,'') || ' [auto-archived: plan status=' || $1 || ']' WHERE plan_id=$2 AND status IN ('open','claimed')",
        [plan.status, planId]
      );
    }
    return;
  }
  // r30f — load not just rule_keys but also their status, so we can check predecessor completion
  const existing = await db.query('SELECT id, rule_key, status FROM lg_tasks WHERE plan_id=$1', [planId]);
  const existingKeys = new Set(existing.rows.map(t => t.rule_key));
  const doneKeys = new Set(existing.rows.filter(t => t.status === 'done' || t.status === 'auto_archived').map(t => t.rule_key));

  // r31d — auto-close open/claimed tasks whose data is now filled (condition no longer true)
  // For each open or claimed task, find the matching rule. If the rule's condition is false,
  // the work is done — auto-close it. Skip recurring rules like eta_check which work differently.
  const rulesByKey = {};
  TASK_RULES.forEach(function(rule){ rulesByKey[rule.key] = rule; });
  for (const t of existing.rows) {
    if (t.status !== 'open' && t.status !== 'claimed') continue;
    const rule = rulesByKey[t.rule_key];
    if (!rule) continue;  // unknown rule (e.g. eta_check) — leave alone
    try {
      if (!rule.condition(plan)) {
        await db.query(
          "UPDATE lg_tasks SET status='auto_archived', completion_note=COALESCE(completion_note,'') || ' [auto-closed: data filled]', completed_at=NOW(), completed_by='auto' WHERE id=$1",
          [t.id]);
        await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
          [planId, 'task_auto_closed', 'Task auto-closed: ' + t.rule_key + ' (data now filled)', 'system']);
        doneKeys.add(t.rule_key);
        existingKeys.add(t.rule_key);
      }
    } catch(e) { console.error('[tasks auto-close ' + t.rule_key + '] ' + e.message); }
  }

  for (const rule of TASK_RULES) {
    try {
      if (!rule.condition(plan)) continue;
      if (existingKeys.has(rule.key)) continue;
      // r30f — sequential gate: skip if any required predecessor is not done
      if (rule.requires && rule.requires.length) {
        const missing = rule.requires.filter(k => !doneKeys.has(k));
        if (missing.length) continue;
      }
      const title    = rule.title(plan);
      const titleCn  = rule.title_cn ? rule.title_cn(plan) : null;
      const due      = rule.due(plan);
      const priority = ['pay_deposit','pay_final','pay_shipper','pay_duty'].includes(rule.key) ? 'high' : 'normal';
      // r31n item 15 — intended_assignee_name pulled from rule (NULL if rule is role-only)
      const assigneeName = rule.assignee_name || null;
      const inserted = await db.query(
        `INSERT INTO lg_tasks (plan_id, rule_key, title, title_cn, intended_role, intended_assignee_name, priority, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [planId, rule.key, title, titleCn, rule.role, assigneeName, priority, due]
      );
      // r31n item 14 — notify the assignee (or role group). Best-effort, never throws.
      const notifyTarget = assigneeName ? { user_name: assigneeName }
                          : (rule.role === 'agent' ? { role: 'logistics_shared' } : { role: rule.role });
      await notify(db, notifyTarget, 'task_created', {
        title: title, body: 'Due ' + due, plan_id: planId, task_id: inserted.rows[0] && inserted.rows[0].id
      });
    } catch(e) { console.error('[tasks evaluate ' + rule.key + '] ' + e.message); }
  }

  // Recurring ETA-check task
  // r31n item 15 — eta_check is Shauraya's (task #16 in the locked matrix)
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
        // r31k — Only create the next eta_check task when its due date is today or earlier.
        //   Previously it spawned immediately with a future due date, making the agent see a
        //   task they couldn't act on yet. The next evaluation cycle (daily sweep + on-plan-update)
        //   will spawn the task when its time arrives.
        const dueIso = asIso(due);
        const today = todayDate();
        if (dueIso <= today) {
          const ins = await db.query(
            `INSERT INTO lg_tasks (plan_id, rule_key, title, title_cn, intended_role, intended_assignee_name, priority, due_date)
             VALUES ($1,'eta_check',$2,$3,'agent','Shauraya','normal',$4)
             RETURNING id`,
            [planId, 'Check ETA — ' + plan.plan_number, '检查到港日期 — ' + plan.plan_number, dueIso]
          );
          await notify(db, { user_name: 'Shauraya' }, 'task_created', {
            title: 'Check ETA — ' + plan.plan_number, body: 'Due ' + dueIso, plan_id: planId,
            task_id: ins.rows[0] && ins.rows[0].id
          });
        }
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
    // r31j — Tightened cadence: under 7 days, check daily. Last-mile ETA slip is critical for
    //   warehouse planning, so we trade quiet for accuracy in the final week.
    let nextDays = 4;
    if (eta) {
      const daysToEta = daysBetween(today, eta);
      if (daysToEta <= 7) nextDays = 1;          // r31j — daily under 7 days
      else if (daysToEta <= 14) nextDays = 2;
      else if (daysToEta <= 28) nextDays = 4;
      else nextDays = 7;
    }
    const next = addDays(today, nextDays);
    await db.query('UPDATE lg_plans SET next_eta_check_date=$1 WHERE id=$2', [next, planId]);
  } catch(e) { console.error('[bumpEtaCheck] ' + e.message); }
}

async function dailyTaskEvaluation(db) {
  try {
    // r31h — auto-close plans verified more than 14 days ago (was 30 in r31g, tightened per Bobby).
    //   Manager can still re-open via /plans/:id/reopen.
    try {
      const sweep = await db.query(`
        UPDATE lg_plans
           SET closed_at = NOW(), closed_by = 'system', status = 'closed'
         WHERE warehouse_verified_date IS NOT NULL
           AND warehouse_verified_date < NOW() - INTERVAL '14 days'
           AND closed_at IS NULL
        RETURNING id, plan_number
      `);
      for (const row of sweep.rows) {
        await db.query(
          `INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)`,
          [row.id, 'auto_closed', '14 days post-verify', 'system']
        );
      }
      if (sweep.rows.length) console.log('[logistics daily-eval] auto-closed ' + sweep.rows.length + ' plans (14d post-verify)');
    } catch(e) { console.error('[logistics auto-close sweep] ' + e.message); }

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

// r30c — record who last set each tracked field (supplier vs agent) for override badges
// r30e — expanded to all updatable fields, captures old_value + within_grace flag (24h grace window)
const AUDITED_FIELDS = [
  // Dates
  'deposit_received_date', 'approx_loading_date', 'actual_loading_date',
  'bl_date', 'original_eta', 'new_eta',
  'final_payment_received_date', 'shipper_payment_date',
  'telex_supplier_declared_date', 'telex_release_date',
  'docs_sent_to_import_agent_date', 'duty_invoice_received_date', 'duty_paid_date',
  'customs_cleared_date', 'delivery_date', 'local_delivery_booked_date',
  'campbells_in_date', 'campbells_out_date', 'campbells_estimated_retrieval',
  'kemballs_retrieval_booked_date', 'kemballs_retrieval_partner', 'kemballs_retrieval_confirmed_date',
  // Text
  'container_number', 'tracking_number', 'shipper_name',
  'bl_number', 'loading_port',
  'remarks', 'shipping_notes',
  'campbells_reference', 'campbells_routing_reason',
  'local_delivery_partner', 'disposition',
  // r31c — accepted-quote denormalised fields
  'etd_date', 'shipping_line', 'arrival_port',
  // Numbers / amounts
  'total_amount_usd', 'deposit_usd', 'deposit_pct', 'final_amount_usd', 'final_pi_amount_usd',
  'container_price_usd', 'duty_invoice_amount_gbp', 'campbells_weekly_gbp',
  'free_days',
  // Booleans
  'shipper_payment_made', 'telex_confirmed_by_agent', 'telex_supplier_declared',
  'supplier_final_payment_acknowledged', 'supplier_form_locked'
];
const GRACE_WINDOW_HOURS = 24;
async function logFieldAudit(db, planId, field, oldVal, newVal, setBy, setByRole, changeNote) {
  if (!AUDITED_FIELDS.includes(field)) return;
  // Skip no-op changes
  const oldStr = oldVal == null ? null : String(oldVal);
  const newStr = newVal == null ? null : String(newVal);
  // Date columns may serialize as Date objects — normalize for comparison
  const normalize = function(v) { if (v == null) return null; const s = String(v); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10); return s; };
  if (normalize(oldStr) === normalize(newStr)) return;
  try {
    // Determine if this change is within the grace window:
    // Grace = no PRIOR audit entry exists for this field, OR the most recent entry is < 24h ago
    const prior = await db.query(
      'SELECT created_at FROM lg_field_audit WHERE plan_id=$1 AND field_name=$2 ORDER BY created_at ASC LIMIT 1',
      [planId, field]
    );
    let withinGrace = true;
    if (prior.rows.length) {
      const firstSet = new Date(prior.rows[0].created_at);
      const ageMs = Date.now() - firstSet.getTime();
      withinGrace = (ageMs <= GRACE_WINDOW_HOURS * 3600 * 1000);
    }
    const ov = oldVal == null ? null : String(oldVal).slice(0, 200);
    const nv = newVal == null ? null : String(newVal).slice(0, 200);
    const note = changeNote ? String(changeNote).slice(0, 1000) : null;
    await db.query(
      `INSERT INTO lg_field_audit (plan_id, field_name, old_value, new_value, set_by, set_by_role, within_grace, change_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [planId, field, ov, nv, setBy, setByRole, withinGrace, note]
    );
  } catch(e) { console.error('[field audit] ' + e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

// r30d — allow PDF + images only
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
function isMimeAllowed(mime) {
  if (!mime) return false;
  return ALLOWED_MIME_TYPES.includes(mime.toLowerCase());
}

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
  fileFilter: function(req, file, cb) {
    if (!isMimeAllowed(file.mimetype)) {
      cb(new Error('Only PDF and image files are allowed (PNG, JPG, GIF, WebP, PDF)'));
    } else cb(null, true);
  },
  limits: { fileSize: 25 * 1024 * 1024 }
});

// r30d — wrap upload.single to convert multer errors into clean JSON responses
function uploadSingleFile(fieldName) {
  return function(req, res, next) {
    upload.single(fieldName)(req, res, function(err) {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      next();
    });
  };
}

// Slot → slot_group mapping for file organization
const SLOT_GROUPS = {
  'quote': 'order', 'original_pi': 'order', 'final_pi': 'order', 'packing_list': 'order',
  'bl': 'shipping', 'loading_photo': 'shipping', 'telex': 'shipping', 'container_doc': 'shipping',
  'duty_invoice': 'customs', 'customs_doc': 'customs', 'commercial_invoice': 'customs',
  // r31i — warehouse stage now has 4 file types:
  //   delivery_sheet  → "Final delivery sheet" (Neha's Linnworks PO export) — required for close
  //   pl_match        → Harp's PL Match confirmation — required for close
  //   stock_location_sheet → Harp's Stock/Location Sheet (per-SKU location codes) — required for close
  //   warehouse_photo → general arrival photos (existing) — NOT required for close
  'delivery_sheet': 'delivery',
  'pl_match': 'delivery',
  'stock_location_sheet': 'delivery',
  'warehouse_photo': 'delivery',
  'discrepancy_photo': 'delivery',
  'other': 'other'
};
function slotToGroup(slot) {
  const s = (slot || 'other').toLowerCase();
  return SLOT_GROUPS[s] || 'other';
}

// ─────────────────────────────────────────────────────────────────────────────
// r31i — Required-files checklist for plan close. Returns array of missing slots.
//        Each item: { slot, label, gate, one_of_group }
//        Quote / Original PI are a one-of group (either satisfies the requirement).
// ─────────────────────────────────────────────────────────────────────────────
function requiredFilesForClose(plan, planFiles) {
  // planFiles is rows from lg_plan_files. Build a set of slot names present.
  const have = new Set();
  for (const f of (planFiles || [])) if (f && f.slot) have.add(String(f.slot));
  const missing = [];
  // Gate 1: deposit_proof + (quote OR original_pi)
  if (!have.has('deposit_proof')) missing.push({ slot: 'deposit_proof', label: 'Proof of deposit', gate: 1 });
  if (!have.has('quote') && !have.has('original_pi')) {
    missing.push({ slot: 'quote', label: 'Quote OR Original PI', gate: 1, one_of_group: 'quote_or_pi' });
  }
  // Gate 4: BL + Final PI + Packing List + Loading photos
  if (!have.has('bl'))             missing.push({ slot: 'bl',             label: 'Bill of lading',  gate: 4 });
  if (!have.has('final_pi'))       missing.push({ slot: 'final_pi',       label: 'Final PI',        gate: 4 });
  if (!have.has('packing_list'))   missing.push({ slot: 'packing_list',   label: 'Packing list',    gate: 4 });
  if (!have.has('loading_photo'))  missing.push({ slot: 'loading_photo',  label: 'Loading photos',  gate: 4 });
  // Gate 5: final_payment_proof
  if (!have.has('final_payment_proof')) missing.push({ slot: 'final_payment_proof', label: 'Proof of final payment', gate: 5 });
  // r31k — Gate 7: duty invoice (Mahima uploads when import agent sends it)
  if (!have.has('duty_invoice')) missing.push({ slot: 'duty_invoice', label: 'Duty invoice', gate: 7 });
  // Warehouse stage: PL Match + Stock/Location Sheet + Final delivery sheet
  if (!have.has('pl_match'))             missing.push({ slot: 'pl_match',             label: 'PL Match',             gate: 'warehouse' });
  if (!have.has('stock_location_sheet')) missing.push({ slot: 'stock_location_sheet', label: 'Stock/Location Sheet', gate: 'warehouse' });
  if (!have.has('delivery_sheet'))       missing.push({ slot: 'delivery_sheet',       label: 'Final delivery sheet', gate: 'warehouse' });
  return missing;
}

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
    console.log('[supplier-portal] GET /s/api/' + req.params.token + ' db=' + !!db + ' task=' + (req.query.task || ''));
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const r = await db.query(
        `SELECT p.*, s.name AS supplier_name FROM lg_plans p LEFT JOIN lg_suppliers s ON s.id=p.supplier_id WHERE p.supplier_share_token=$1`,
        [req.params.token]
      );
      console.log('[supplier-portal] token=' + req.params.token + ' rows=' + r.rows.length);
      if (!r.rows.length) return res.status(404).json({ error: 'Invalid link' });
      const p = r.rows[0];
      // r31c — fetch supplier-edited field history for "previously submitted" display + strike-through
      const supplierEdits = (await db.query(
        "SELECT field_name, old_value, new_value, set_by, created_at, change_note FROM lg_field_audit WHERE plan_id=$1 AND set_by_role='supplier' ORDER BY created_at ASC",
        [p.id])).rows;
      const fieldHistory = {};
      supplierEdits.forEach(function(a){
        if (!fieldHistory[a.field_name]) fieldHistory[a.field_name] = [];
        fieldHistory[a.field_name].push({
          old_value: a.old_value, new_value: a.new_value,
          by: a.set_by, at: a.created_at, change_note: a.change_note
        });
      });
      // r31i — flag if there are open claims on this plan, so the supplier portal can render the
      //   order-update form READ-ONLY (B option from Bobby). Discrepancy response form stays editable.
      //   Also ship a minimal claims summary so the supplier sees what's being raised.
      const openClaims = (await db.query(
        `SELECT id, description, claim_value_gbp, status, created_at,
                supplier_proposed_resolution, supplier_resolution_note,
                supplier_replacement_plan_ref
         FROM lg_claims
         WHERE plan_id=$1 AND status NOT IN ('closed','archived')
         ORDER BY created_at DESC`,
        [p.id])).rows;
      res.json({
        plan_number: p.plan_number, supplier_name: p.supplier_name,
        supplier_order_ref: p.supplier_order_ref || '',
        locked: !!p.supplier_form_locked, submitted_by: p.supplier_submitted_by,
        last_submitted_at: p.supplier_last_submitted_at,
        order_date: p.order_date, total_amount_usd: p.total_amount_usd, deposit_usd: p.deposit_usd,
        deposit_received_date: p.deposit_received_date,
        approx_loading_date: p.approx_loading_date, loading_port: p.loading_port,
        actual_loading_date: p.actual_loading_date,
        container_number: p.container_number, tracking_number: p.tracking_number, tracking_link: p.tracking_link,
        bl_number: p.bl_number, bl_date: p.bl_date, final_amount_usd: p.final_amount_usd,
        telex_supplier_declared: !!p.telex_supplier_declared,
        telex_supplier_declared_date: p.telex_supplier_declared_date,
        supplier_final_payment_acknowledged: !!p.supplier_final_payment_acknowledged,
        current_gate: undefined,
        field_history: fieldHistory,
        available_tasks: computeSupplierAvailableTasks(p),
        // r31i — claim-aware fields
        has_open_claim: openClaims.length > 0,
        open_claims: openClaims
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
        "SELECT id, slot, slot_group, filename, mime_type, uploaded_at, uploaded_by FROM lg_plan_files WHERE plan_id=$1 AND deleted_at IS NULL AND slot IN ('bl','final_pi','original_pi','packing_list','loading_photo','telex') ORDER BY uploaded_at DESC",
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
      // r31c — supplier_order_ref added to allowed fields
      // r31j — tracking_link added (URL distinct from tracking_number)
      const allowed = ['approx_loading_date','actual_loading_date','container_number','tracking_number','tracking_link',
        'bl_number','bl_date','final_amount_usd','telex_supplier_declared','telex_supplier_declared_date','supplier_final_payment_acknowledged',
        'supplier_order_ref'];
      const sets = []; const vals = []; let i = 1;
      const changes = [];
      const changeNote = (req.body && req.body.change_note) ? String(req.body.change_note).trim().slice(0, 1000) : null;
      for (const f of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
          let v = req.body[f]; if (v === '') v = null;
          sets.push(f + '=$' + (i++)); vals.push(v); changes.push(f);
          if (SLIP_TRACKED_FIELDS.includes(f))
            await logSlipIfChanged(db, planRow.id, f, planRow[f], v, req.body.slip_reason, req.body.slip_reason_category, 'supplier:' + (req.body.submitted_by || 'unknown'));
          await logFieldAudit(db, planRow.id, f, planRow[f], v, req.body.submitted_by || 'unknown', 'supplier', changeNote);
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
  publicRouter.post('/api/:token/files', uploadSingleFile('file'), async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const plan = (await db.query('SELECT id, supplier_form_locked FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Invalid link' });
      if (plan.supplier_form_locked) return res.status(423).json({ error: 'Form is locked' });
      if (!req.file) return res.status(400).json({ error: 'No file' });
      // r31i — quote added (supplier can attach the quote they sent us, in addition to original PI/final PI)
      const allowedSupplierSlots = ['bl','final_pi','original_pi','quote','packing_list','loading_photo','telex','other'];
      let slot = (req.body.slot || 'other').toLowerCase();
      if (!allowedSupplierSlots.includes(slot)) slot = 'other';
      const slot_group = slotToGroup(slot);
      const submitter = req.body.submitted_by || 'unknown';
      await db.query(
        `INSERT INTO lg_plan_files (plan_id, slot, slot_group, filename, stored_path, mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [plan.id, slot, slot_group, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, 'supplier:' + submitter]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [plan.id, 'supplier_file', slot + ': ' + req.file.originalname, 'supplier:' + submitter]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // r30d — supplier sees claims on their plan
  publicRouter.get('/api/:token/claims', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const plan = (await db.query('SELECT id FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Invalid link' });
      const claims = (await db.query("SELECT id, description, claim_value_gbp, status, supplier_proposed_resolution, supplier_resolution_note, supplier_replacement_plan_ref, supplier_responded_at, agreed_resolution, created_at FROM lg_claims WHERE plan_id=$1 AND status NOT IN ('closed') ORDER BY created_at DESC", [plan.id])).rows;
      const cf = claims.length ? (await db.query('SELECT id, claim_id, filename, mime_type, uploaded_by, uploaded_by_role FROM lg_claim_files WHERE claim_id = ANY($1::int[]) ORDER BY uploaded_at DESC', [claims.map(c=>c.id)])).rows : [];
      const byClaim = {};
      cf.forEach(f => { (byClaim[f.claim_id] = byClaim[f.claim_id] || []).push(f); });
      claims.forEach(c => { c.files = byClaim[c.id] || []; });
      res.json({ claims });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // Supplier responds to a claim
  publicRouter.post('/api/:token/claims/:claimId/respond', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const plan = (await db.query('SELECT id, supplier_form_locked FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Invalid link' });
      if (plan.supplier_form_locked) return res.status(423).json({ error: 'Form is locked' });
      const claimId = parseInt(req.params.claimId);
      const b = req.body || {};
      const resolution = b.proposed_resolution; // 'refund' | 'replace' | 'credit' | 'dispute'
      if (!['refund','replace','credit','dispute'].includes(resolution)) return res.status(400).json({ error: 'Invalid resolution' });
      const replacementRef = resolution === 'replace' ? (b.replacement_plan_ref || null) : null;
      // Verify claim belongs to plan
      const claim = (await db.query('SELECT id FROM lg_claims WHERE id=$1 AND plan_id=$2', [claimId, plan.id])).rows[0];
      if (!claim) return res.status(404).json({ error: 'Claim not found on this plan' });
      await db.query(
        `UPDATE lg_claims SET supplier_proposed_resolution=$1, supplier_resolution_note=$2, supplier_replacement_plan_ref=$3,
         supplier_responded_at=NOW(), status='supplier_responded' WHERE id=$4`,
        [resolution, b.note || null, replacementRef, claimId]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [plan.id, 'claim_supplier_responded', resolution + ': ' + (b.note || '').slice(0,80), 'supplier:' + (b.submitted_by || 'unknown')]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // Supplier uploads file to a claim
  publicRouter.post('/api/:token/claims/:claimId/files', uploadSingleFile('file'), async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const plan = (await db.query('SELECT id, supplier_form_locked FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Invalid link' });
      if (plan.supplier_form_locked) return res.status(423).json({ error: 'Form is locked' });
      const claimId = parseInt(req.params.claimId);
      if (!req.file) return res.status(400).json({ error: 'No file' });
      const claim = (await db.query('SELECT id FROM lg_claims WHERE id=$1 AND plan_id=$2', [claimId, plan.id])).rows[0];
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      const submitter = req.body.submitted_by || 'unknown';
      await db.query(
        `INSERT INTO lg_claim_files (claim_id, filename, stored_path, mime_type, size_bytes, uploaded_by, uploaded_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,'supplier')`,
        [claimId, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, 'supplier:' + submitter]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [plan.id, 'claim_supplier_file', req.file.originalname, 'supplier:' + submitter]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // Public claim file view (supplier can see what FK uploaded)
  publicRouter.get('/api/:token/claim-files/:fileId/view', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).send('not ready');
    try {
      const plan = (await db.query('SELECT id FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!plan) return res.status(404).send('Invalid link');
      // Verify file belongs to a claim on this plan
      const f = (await db.query(
        `SELECT cf.* FROM lg_claim_files cf JOIN lg_claims c ON c.id = cf.claim_id
         WHERE cf.id=$1 AND c.plan_id=$2`, [parseInt(req.params.fileId), plan.id])).rows[0];
      if (!f) return res.status(404).send('Not found');
      if (!fs.existsSync(f.stored_path)) return res.status(410).send('File missing');
      res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline; filename="' + (f.filename || 'file').replace(/[^a-zA-Z0-9._\-]/g,'_') + '"');
      res.sendFile(path.resolve(f.stored_path));
    } catch(e) { res.status(500).send(e.message); }
  });
  // Public regular file view (supplier can also see plan files like Final PI, etc.)
  publicRouter.get('/api/:token/files/:fileId/view', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).send('not ready');
    try {
      const plan = (await db.query('SELECT id FROM lg_plans WHERE supplier_share_token=$1', [req.params.token])).rows[0];
      if (!plan) return res.status(404).send('Invalid link');
      const f = (await db.query('SELECT * FROM lg_plan_files WHERE id=$1 AND plan_id=$2 AND deleted_at IS NULL', [parseInt(req.params.fileId), plan.id])).rows[0];
      if (!f) return res.status(404).send('Not found');
      if (!fs.existsSync(f.stored_path)) return res.status(410).send('File missing');
      res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline; filename="' + (f.filename || 'file').replace(/[^a-zA-Z0-9._\-]/g,'_') + '"');
      res.sendFile(path.resolve(f.stored_path));
    } catch(e) { res.status(500).send(e.message); }
  });
  router._supplierShare = publicRouter;

  // r31e — Public file download router (mounted at /f in server.js)
  // Token-protected download for import-agent docs. 30-day expiry, manager-revokable.
  const filePublic = express.Router();
  filePublic.use(async function(req, res, next) { await bootIfReady(); next(); });
  filePublic.get('/:token', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).send('Database not ready');
    try {
      const r = await db.query(
        `SELECT pf.*, p.plan_number FROM lg_plan_files pf
         LEFT JOIN lg_plans p ON p.id = pf.plan_id
         WHERE pf.public_token=$1 AND pf.deleted_at IS NULL`,
        [req.params.token]);
      if (!r.rows.length) return res.status(404).send('Link not found or expired.');
      const f = r.rows[0];
      if (f.public_token_revoked_at) return res.status(410).send('This link has been revoked.');
      if (f.public_token_expires_at && new Date(f.public_token_expires_at).getTime() < Date.now()) {
        return res.status(410).send('This link has expired.');
      }
      if (!fs.existsSync(f.stored_path)) return res.status(410).send('File no longer available.');
      res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
      // r31k — ?d=1 forces download (import-agent email links). Default = inline preview.
      const forceDownload = req.query && (req.query.d === '1' || req.query.d === 'true' || req.query.download === '1');
      const dispKind = forceDownload ? 'attachment' : 'inline';
      const cleanName = (f.filename || 'file').replace(/[^a-zA-Z0-9._\-]/g,'_');
      res.setHeader('Content-Disposition', dispKind + '; filename="' + cleanName + '"');
      res.sendFile(path.resolve(f.stored_path));
    } catch(e) { res.status(500).send(e.message); }
  });
  router._fileShare = filePublic;

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
    try {
      const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
      const sql = includeInactive
        ? 'SELECT * FROM lg_suppliers ORDER BY is_active DESC, name'
        : 'SELECT * FROM lg_suppliers WHERE is_active=TRUE ORDER BY name';
      const r = await db.query(sql);
      res.json({ suppliers: r.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
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
      // r31n.1 — Bucket counts driven entirely by field values, no status flags.
      //   Active        = customs not cleared yet, status=active, not closed
      //   Kemballs      = customs cleared + disposition=kemballs + no delivery booked
      //   Incoming      = (clean + customs cleared) OR (kemballs + delivery booked); not received
      //   Issues        = plans with at least one non-closed claim
      const activeQ = await db.query(`
        SELECT COUNT(*)::int AS n FROM lg_plans
        WHERE status='active' AND closed_at IS NULL AND customs_cleared_date IS NULL`);
      const kemballsQ = await db.query(`
        SELECT COUNT(*)::int AS n FROM lg_plans
        WHERE status='active' AND closed_at IS NULL
          AND customs_cleared_date IS NOT NULL
          AND disposition IN ('kemballs','campbells')
          AND delivery_date IS NULL`);
      // For overdue: active plans where any task is overdue
      const overdueQ = await db.query(`
        SELECT COUNT(DISTINCT t.plan_id)::int AS n
        FROM lg_tasks t JOIN lg_plans p ON p.id=t.plan_id
        WHERE t.status IN ('open','claimed') AND t.due_date < CURRENT_DATE
          AND p.status='active' AND p.closed_at IS NULL`);
      const issuesQ = await db.query("SELECT COUNT(DISTINCT plan_id)::int AS n FROM lg_claims WHERE status NOT IN ('closed','archived','dropped')");
      const tasks = await db.query("SELECT COUNT(*)::int AS n FROM lg_tasks WHERE status IN ('open','claimed') AND due_date < CURRENT_DATE");
      res.json({
        open: activeQ.rows[0].n,
        overdue: overdueQ.rows[0].n,
        at_campbells: kemballsQ.rows[0].n,
        at_kemballs: kemballsQ.rows[0].n,
        with_issues: issuesQ.rows[0].n,
        overdue_tasks: tasks.rows[0].n
      });
    } catch(e) { res.json({ open:0, overdue:0, at_campbells:0, at_kemballs:0, with_issues:0, overdue_tasks: 0 }); }
  });

  router.get('/plans/:id', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_plans WHERE id=$1', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      const plan = r.rows[0];
      const sup = plan.supplier_id ? (await db.query('SELECT * FROM lg_suppliers WHERE id=$1', [plan.supplier_id])).rows[0] : null;
      const files = (await db.query('SELECT id, slot, slot_group, pinned, filename, mime_type, size_bytes, uploaded_by, uploaded_at FROM lg_plan_files WHERE plan_id=$1 AND deleted_at IS NULL ORDER BY pinned DESC, uploaded_at DESC', [plan.id])).rows;
      // r31h — dropped lg_plan_issues query (dead system; replaced by lg_claims). Frontend addIssue/resolveIssue also removed.
      const activity = (await db.query('SELECT * FROM lg_activity WHERE plan_id=$1 ORDER BY created_at DESC LIMIT 50', [plan.id])).rows;
      const tasks    = (await db.query("SELECT * FROM lg_tasks WHERE plan_id=$1 ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END, due_date NULLS LAST", [plan.id])).rows;
      const slips    = (await db.query('SELECT * FROM lg_date_slips WHERE plan_id=$1 ORDER BY created_at DESC LIMIT 20', [plan.id])).rows;
      const prodChecks = (await db.query('SELECT * FROM lg_production_checks WHERE plan_id=$1 ORDER BY created_at DESC', [plan.id])).rows;
      // r30d — include claims for this plan with their files
      const claims = (await db.query('SELECT * FROM lg_claims WHERE plan_id=$1 ORDER BY created_at DESC', [plan.id])).rows;
      if (claims.length) {
        const cf = (await db.query('SELECT id, claim_id, filename, mime_type, uploaded_by, uploaded_by_role, uploaded_at FROM lg_claim_files WHERE claim_id = ANY($1::int[]) ORDER BY uploaded_at DESC', [claims.map(c => c.id)])).rows;
        const byClaim = {};
        cf.forEach(f => { (byClaim[f.claim_id] = byClaim[f.claim_id] || []).push(f); });
        claims.forEach(c => { c.files = byClaim[c.id] || []; });
      }
      // r30c/r30e — per-field provenance + full edit history past grace window
      const auditRows = (await db.query('SELECT field_name, old_value, new_value, set_by, set_by_role, within_grace, created_at FROM lg_field_audit WHERE plan_id=$1 ORDER BY created_at ASC', [plan.id])).rows;
      const field_audit = {};
      auditRows.forEach(function(a) {
        if (!field_audit[a.field_name]) field_audit[a.field_name] = { history: [], post_grace_edits: 0 };
        // Last-set per role (for r30c supplier badges)
        field_audit[a.field_name][a.set_by_role === 'supplier' ? 'supplier' : 'agent'] = {
          value: a.new_value, by: a.set_by, at: a.created_at, role: a.set_by_role
        };
        // Full history
        field_audit[a.field_name].history.push({
          old_value: a.old_value, new_value: a.new_value,
          by: a.set_by, role: a.set_by_role, at: a.created_at, within_grace: a.within_grace
        });
        if (a.within_grace === false) field_audit[a.field_name].post_grace_edits++;
      });
      // r31c — bundle quote + delivery state for stage cards
      const today = todayDate();
      const linkRows = (await db.query("SELECT token, kind, agent_id, created_at FROM lg_links WHERE $1 = ANY(plan_ids) ORDER BY created_at DESC", [plan.id])).rows;
      const allQuotes = (await db.query(
        `SELECT q.*, fa.name AS agent_name
         FROM lg_quotes q
         LEFT JOIN lg_freight_agents fa ON fa.id = q.agent_id
         WHERE q.plan_id = $1
         ORDER BY q.submitted_at DESC`,
        [plan.id])).rows.map(function(q) {
          const expired = q.status === 'pending' && q.validity_date && String(q.validity_date).slice(0,10) < today;
          return Object.assign({}, q, { is_expired: !!expired });
        });
      // Build pending_links for quote: links of kind=quote with no response from that agent yet
      const quoteAgentsResponded = new Set(allQuotes.map(function(q){ return q.agent_id; }));
      const agentNames = {};
      (await db.query('SELECT id, name FROM lg_freight_agents')).rows.forEach(function(a){ agentNames[a.id] = a.name; });
      const quoteSummary = {
        pending_links: linkRows.filter(function(l){ return l.kind==='quote' && !quoteAgentsResponded.has(l.agent_id); }).map(function(l){
          return { agent_id: l.agent_id, agent_name: agentNames[l.agent_id] || ('#' + l.agent_id), sent_at: l.created_at };
        }),
        total_received: allQuotes.length,
        quotes: allQuotes,
        accepted_quote: allQuotes.find(function(q){ return q.status === 'accepted'; }) || null
      };
      // Delivery summary
      const deliveryLinks = linkRows.filter(function(l){ return l.kind==='delivery'; });
      let deliveryBookedAt = null;
      // We don't have a dedicated delivery row table; signal "booked" via either local_delivery_booked_date or kemballs_retrieval_booked_date
      const isKemballsRoute = plan.disposition === 'kemballs' || plan.disposition === 'campbells';
      const bookedDate = isKemballsRoute ? plan.kemballs_retrieval_booked_date : plan.local_delivery_booked_date;
      const bookedPartner = isKemballsRoute ? plan.kemballs_retrieval_partner : plan.local_delivery_partner;
      const deliverySummary = {
        pending_links: deliveryLinks.filter(function(){ return !bookedDate; }).map(function(l){
          return { agent_id: l.agent_id, agent_name: agentNames[l.agent_id] || ('#' + l.agent_id), sent_at: l.created_at };
        }),
        booked_date: bookedDate || null,
        booked_partner: bookedPartner || null
      };
      // r31i — required-files checklist for the redesigned sidebar + close-banner. One canonical list.
      const closeMissing = requiredFilesForClose(plan, files);
      res.json({ plan: enrichPlan(plan, sup), supplier: sup, files, activity, tasks, slips, production_checks: prodChecks, field_audit: field_audit, claims: claims, quote_summary: quoteSummary, delivery_summary: deliverySummary, close_missing: closeMissing });
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
      // r30d — surface open replacement promises from this supplier
      const promises = (await db.query(
        `SELECT rp.*, c.description AS claim_description, p.plan_number AS source_plan_number
         FROM lg_replacement_promises rp
         LEFT JOIN lg_claims c ON c.id = rp.source_claim_id
         LEFT JOIN lg_plans p ON p.id = c.plan_id
         WHERE rp.supplier_id=$1 AND rp.fulfilled=FALSE`,
        [b.supplier_id])).rows;
      res.json({ plan: r.rows[0], outstanding_replacements: promises });
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
      'container_number','tracking_number','tracking_link','shipper_name','container_price_usd','bl_number','bl_date','free_days',
      'final_amount_usd','final_pi_amount_usd','final_payment_due_date','final_payment_received_date',
      'shipper_payment_made','shipper_payment_date',
      'original_eta','new_eta','telex_release_date','telex_confirmed_by_agent','telex_supplier_declared','telex_supplier_declared_date',
      'supplier_final_payment_acknowledged',
      'docs_sent_to_import_agent_date','duty_invoice_amount_gbp','duty_invoice_received_date','duty_paid_date','customs_cleared_date',
      'disposition','delivery_date','local_delivery_booked_date','local_delivery_partner',
      'campbells_in_date','campbells_out_date','campbells_reference','campbells_weekly_gbp','campbells_routing_reason','campbells_estimated_retrieval',
      'kemballs_retrieval_booked_date','kemballs_retrieval_partner','kemballs_retrieval_confirmed_date',
      'remarks','shipping_notes','supplier_form_locked','status'
    ];
    try {
      const before = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [id])).rows[0];
      if (!before) return res.status(404).json({ error: 'Plan not found' });
      const sets = []; const vals = []; let i = 1;
      // r31j — Authz: privileged fields (status, supplier_form_locked) are manager-only.
      //   Closes the hole where any logged-in user could update any field, including cancelling plans.
      if (!isManager(req.user)) {
        const privileged = ['status', 'supplier_form_locked'];
        for (const pf of privileged) {
          if (Object.prototype.hasOwnProperty.call(req.body || {}, pf)) {
            return res.status(403).json({ error: pf + ' is manager-only — use /cancel or /reopen endpoints' });
          }
        }
      }

      const changes = [];
      for (const f of updatable) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
          let v = req.body[f] === '' ? null : req.body[f];
          sets.push(f + '=$' + (i++)); vals.push(v); changes.push(f);
          if (SLIP_TRACKED_FIELDS.includes(f))
            await logSlipIfChanged(db, id, f, before[f], v, req.body.slip_reason, req.body.slip_reason_category, actor(req));
          await logFieldAudit(db, id, f, before[f], v, actor(req), isManager(req.user) ? 'manager' : 'agent');
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'No fields' });

      // r31j — Auto-set campbells_in_date when customs clears for a Kemballs plan.
      //   Local agent moves the container from port to Kemballs same-day after clearance, so we
      //   approximate arrival = clearance. Storage cost clock starts ticking. Doesn't overwrite
      //   if already set (e.g. agent corrected it from the weekly Kemballs sheet).
      const isClearingNow = Object.prototype.hasOwnProperty.call(req.body || {}, 'customs_cleared_date')
                          && req.body.customs_cleared_date
                          && !before.customs_cleared_date;
      const dispoAfter = Object.prototype.hasOwnProperty.call(req.body || {}, 'disposition')
                          ? req.body.disposition : before.disposition;
      const isKemballs = dispoAfter === 'kemballs' || dispoAfter === 'campbells';
      // r31n item 11 — Mandatory disposition confirmation at customs clearance.
      //   Without a disposition the plan can't progress: agent must pick clean or kemballs.
      if (isClearingNow && !dispoAfter) {
        return res.status(400).json({ error: 'Disposition required when marking customs cleared. Choose Warehouse (clean) or Kemballs.' });
      }
      // r31n.1 — Storage clock starts when customs cleared with kemballs disposition.
      //   No status flip (that was the r31n overengineering); bucket is computed from field values.
      if (isClearingNow && isKemballs && !before.campbells_in_date) {
        sets.push('campbells_in_date=$' + (i++));
        vals.push(req.body.customs_cleared_date);
        changes.push('campbells_in_date (auto-set from customs clearance)');
        await logFieldAudit(db, id, 'campbells_in_date', null, req.body.customs_cleared_date, 'system', 'system');
      }

      sets.push('updated_at=NOW()'); vals.push(id);
      const r = await db.query('UPDATE lg_plans SET ' + sets.join(',') + ' WHERE id=$' + i + ' RETURNING *', vals);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'updated', 'Fields: ' + changes.join(', '), actor(req)]);
      // r31n.1 — notify logistics on customs clearance with Kemballs route (they'll need to act)
      if (isClearingNow && isKemballs) {
        await notify(db, { role: 'logistics_shared' }, 'kemballs_arrival', {
          title: 'Container at Kemballs — ' + r.rows[0].plan_number,
          body: 'Container cleared customs and is in Kemballs storage. Book delivery when ready.',
          plan_id: id
        });
      }
      await evaluateTasks(db, id);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/plans/:id/close', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const overrideReason = (req.body && req.body.override_reason || '').toString().trim();

      // r31i — required-file checklist enforced on close.
      //   Agents: must have all 9 required files (Quote OR Original PI counts as one).
      //   Managers/owners: can override with a reason note. Without a reason, also blocked.
      const plan = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [id])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Plan not found' });
      const files = (await db.query("SELECT slot FROM lg_plan_files WHERE plan_id=$1 AND deleted_at IS NULL", [id])).rows;
      const missing = requiredFilesForClose(plan, files);
      const isManagerUser = isManager(req.user);
      if (missing.length) {
        if (!isManagerUser) {
          return res.status(400).json({
            error: 'Cannot close — required files missing',
            missing_slots: missing.map(m => m.slot),
            missing_labels: missing.map(m => m.label),
            requires_override: true
          });
        }
        // Manager override path — must provide a reason
        if (!overrideReason) {
          return res.status(400).json({
            error: 'Override reason required to close plan with missing files',
            missing_slots: missing.map(m => m.slot),
            missing_labels: missing.map(m => m.label),
            requires_override: true
          });
        }
      }

      const setClause = overrideReason
        ? "UPDATE lg_plans SET closed_at=NOW(), closed_by=$1, status='closed', close_override_reason=$2 WHERE id=$3 RETURNING *"
        : "UPDATE lg_plans SET closed_at=NOW(), closed_by=$1, status='closed' WHERE id=$2 RETURNING *";
      const params = overrideReason ? [actor(req), overrideReason, id] : [actor(req), id];
      const r = await db.query(setClause, params);

      await db.query("UPDATE lg_tasks SET status='auto_archived', completed_at=NOW(), completion_note='Plan closed' WHERE plan_id=$1 AND status IN ('open','claimed')", [id]);
      const closeDetail = overrideReason
        ? 'Plan closed with override · ' + missing.length + ' file(s) missing · reason: ' + overrideReason
        : 'Plan closed';
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'closed', closeDetail, actor(req)]);
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/plans/:id/reopen', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    try {
      const id = parseInt(req.params.id);
      // r31j — clear warehouse_verified_date on reopen. Without this, the daily auto-close
      //   sweep (which fires on plans verified >14 days ago) would immediately re-close any
      //   reopened plan. Infinite loop bug fix. Also clear stale override reason.
      const r = await db.query(`
        UPDATE lg_plans
           SET closed_at=NULL, closed_by=NULL, status='active',
               warehouse_verified_date=NULL, warehouse_verified_by=NULL,
               close_override_reason=NULL
         WHERE id=$1 RETURNING *`, [id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'reopened', 'Plan reopened (warehouse verification cleared)', actor(req)]);
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
    // r30n.1 — cascade delete with per-step try/catch. A missing/optional table (e.g. lg_slips not yet migrated)
    // logs a skip and continues. Only the final lg_plans delete is treated as fatal.
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Bad plan id' });
    const childTables = [
      { sql: 'DELETE FROM lg_slips WHERE plan_id=$1', label: 'lg_slips' },
      { sql: 'DELETE FROM lg_claim_files WHERE claim_id IN (SELECT id FROM lg_claims WHERE plan_id=$1)', label: 'lg_claim_files' },
      { sql: 'DELETE FROM lg_claims WHERE plan_id=$1', label: 'lg_claims' },
      { sql: 'DELETE FROM lg_tasks WHERE plan_id=$1', label: 'lg_tasks' },
      { sql: 'DELETE FROM lg_plan_issues WHERE plan_id=$1', label: 'lg_plan_issues' },
      { sql: 'DELETE FROM lg_replacement_promises WHERE source_claim_id IN (SELECT id FROM lg_claims WHERE plan_id=$1) OR fulfilled_in_plan_id=$1', label: 'lg_replacement_promises' },
      { sql: 'DELETE FROM lg_activity WHERE plan_id=$1', label: 'lg_activity' },
      { sql: 'DELETE FROM lg_plan_files WHERE plan_id=$1', label: 'lg_plan_files' }
    ];
    const cleaned = []; const skipped = [];
    for (const step of childTables) {
      try {
        const r = await db.query(step.sql, [id]);
        cleaned.push(step.label + ':' + (r.rowCount || 0));
      } catch(e) {
        // Most likely cause: "relation does not exist" — table not migrated yet. Log and skip.
        skipped.push(step.label + ' (' + (e.code || 'err') + ')');
        console.warn('[logistics delete plan ' + id + '] skipped ' + step.label + ': ' + e.message);
      }
    }
    try {
      const r = await db.query('DELETE FROM lg_plans WHERE id=$1 RETURNING plan_number', [id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
      console.log('[logistics] plan ' + id + ' (' + r.rows[0].plan_number + ') hard-deleted by ' + (req.user.email || req.user.name) + ' · cleaned=[' + cleaned.join(',') + '] skipped=[' + skipped.join(',') + ']');
      res.json({ ok: true, deleted: r.rows[0].plan_number, cleaned: cleaned, skipped: skipped });
    } catch(e) {
      console.error('[logistics] delete plan ' + id + ' FAILED on lg_plans: ' + e.message);
      res.status(500).json({ error: 'Could not delete plan: ' + e.message + ' (child cleanup: ' + cleaned.join(',') + ')' });
    }
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

  // r31n item 12 — Mark gate-4 review done. Shauraya/Neha reviews supplier-uploaded BL/PI/PL/photos
  //   (and amends/re-uploads if needed via the regular file endpoint), then flips this flag.
  //   Closes any open review_gate4_docs task on this plan and logs to activity.
  router.post('/plans/:id/gate4-review-done', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const note = (req.body && req.body.note) || null;
      const r = await db.query(
        'UPDATE lg_plans SET gate4_review_done=TRUE, gate4_review_done_at=NOW(), gate4_review_done_by=$1 WHERE id=$2 AND gate4_review_done=FALSE RETURNING *',
        [actor(req), id]
      );
      if (!r.rows.length) {
        // Either plan not found or already marked done
        const exists = (await db.query('SELECT gate4_review_done FROM lg_plans WHERE id=$1', [id])).rows[0];
        if (!exists) return res.status(404).json({ error: 'Plan not found' });
        return res.json({ ok: true, already: true });
      }
      // Auto-close the matching task
      await db.query(
        "UPDATE lg_tasks SET status='done', completed_by=$1, completed_at=NOW(), completion_note=$2 WHERE plan_id=$3 AND rule_key='review_gate4_docs' AND status IN ('open','claimed')",
        [actor(req), note || 'Gate-4 review marked complete', id]
      );
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'gate4_review_done', note || '', actor(req)]);
      await evaluateTasks(db, id);
      res.json({ ok: true, plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ─── r31n.1 — Field-driven bucket transitions ────────────────────────────
  // No more parking flow. Plans move between Active / Kemballs / Warehouse Incoming /
  // Warehouse Received purely by what fields are set:
  //   Active             = customs_cleared_date IS NULL
  //   Kemballs           = customs cleared + disposition=kemballs + no delivery booked
  //   Warehouse incoming = (clean + customs cleared) OR (kemballs + delivery booked); not received
  //   Warehouse received = warehouse_received_date NOT NULL; not verified
  // All transitions reversible. Each endpoint below changes fields; bucket follows.

  // Book delivery — used from Kemballs card AND from Warehouse incoming card. Same form, same
  //   endpoint. Sets partner + delivery_date + booked_date. For Kemballs plans, also sets
  //   campbells_out_date=delivery_date (storage clock stops, final cost locked).
  router.post('/plans/:id/book-delivery', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const partner = (req.body && req.body.partner || '').toString().trim();
      const deliveryDate = (req.body && req.body.delivery_date || '').toString().trim();
      if (!partner) return res.status(400).json({ error: 'Delivery partner required' });
      if (!deliveryDate) return res.status(400).json({ error: 'Delivery date required' });
      const before = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [id])).rows[0];
      if (!before) return res.status(404).json({ error: 'Plan not found' });
      if (!before.customs_cleared_date) {
        return res.status(409).json({ error: 'Customs not cleared yet — cannot book delivery' });
      }
      const today = todayDate();
      const isKemballs = before.disposition === 'kemballs' || before.disposition === 'campbells';
      // For Kemballs plans, lock storage end-date to delivery_date (so cost is final).
      const setOut = isKemballs && !before.campbells_out_date;
      const sql = setOut
        ? `UPDATE lg_plans SET local_delivery_partner=$1, delivery_date=$2,
             local_delivery_booked_date=$3, campbells_out_date=$2, updated_at=NOW()
             WHERE id=$4 RETURNING *`
        : `UPDATE lg_plans SET local_delivery_partner=$1, delivery_date=$2,
             local_delivery_booked_date=$3, updated_at=NOW()
             WHERE id=$4 RETURNING *`;
      const r = await db.query(sql, [partner, deliveryDate, today, id]);
      await logFieldAudit(db, id, 'local_delivery_partner', before.local_delivery_partner, partner, actor(req), 'agent');
      await logFieldAudit(db, id, 'delivery_date', before.delivery_date, deliveryDate, actor(req), 'agent');
      if (setOut) await logFieldAudit(db, id, 'campbells_out_date', null, deliveryDate, 'system', 'system');
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'delivery_booked', partner + ' on ' + deliveryDate + (setOut ? ' (Kemballs storage closed)' : ''), actor(req)]);
      await evaluateTasks(db, id);
      await notify(db, { role: 'warehouse_agent' }, 'delivery_booked', {
        title: 'Incoming delivery — ' + before.plan_number,
        body: partner + ' delivering on ' + deliveryDate, plan_id: id
      });
      res.json({ ok: true, plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Cancel delivery booking. Clears partner + delivery_date + booked_date. For Kemballs plans
  //   this also re-opens campbells_out_date=NULL so storage clock resumes.
  router.post('/plans/:id/cancel-delivery-booking', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const reason = (req.body && req.body.reason || '').toString().trim();
      const before = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [id])).rows[0];
      if (!before) return res.status(404).json({ error: 'Plan not found' });
      if (!before.local_delivery_booked_date && !before.delivery_date) {
        return res.status(409).json({ error: 'No delivery booking to cancel' });
      }
      if (before.warehouse_received_date) {
        return res.status(409).json({ error: 'Already received at warehouse — cannot cancel delivery' });
      }
      const isKemballs = before.disposition === 'kemballs' || before.disposition === 'campbells';
      const sql = isKemballs
        ? `UPDATE lg_plans SET local_delivery_partner=NULL, delivery_date=NULL,
             local_delivery_booked_date=NULL, campbells_out_date=NULL, updated_at=NOW()
             WHERE id=$1 RETURNING *`
        : `UPDATE lg_plans SET local_delivery_partner=NULL, delivery_date=NULL,
             local_delivery_booked_date=NULL, updated_at=NOW()
             WHERE id=$1 RETURNING *`;
      const r = await db.query(sql, [id]);
      await logFieldAudit(db, id, 'delivery_date', before.delivery_date, null, actor(req), 'agent', reason || 'delivery cancelled');
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'delivery_cancelled', reason || '(no reason given)', actor(req)]);
      // r31n.1 — Remove the auto-archived book_local_delivery task so evaluator re-creates it.
      //   Without this, the task stays archived and evaluator's `existingKeys.has(rule.key)`
      //   check at line ~1186 skips re-firing forever.
      await db.query("DELETE FROM lg_tasks WHERE plan_id=$1 AND rule_key='book_local_delivery' AND status='auto_archived'", [id]);
      await evaluateTasks(db, id);  // re-fires book_local_delivery task
      res.json({ ok: true, plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Switch disposition — used for last-minute route changes (warehouse → kemballs or vice versa).
  //   Handles storage clock + clears delivery booking if one exists (route change usually means
  //   you have to re-book with a different partner/timing).
  router.post('/plans/:id/switch-disposition', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const newDispo = (req.body && req.body.disposition || '').toString().trim();
      if (newDispo !== 'clean' && newDispo !== 'kemballs') {
        return res.status(400).json({ error: "disposition must be 'clean' or 'kemballs'" });
      }
      const before = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [id])).rows[0];
      if (!before) return res.status(404).json({ error: 'Plan not found' });
      if (before.disposition === newDispo) return res.json({ ok: true, plan: before, noop: true });
      if (before.warehouse_received_date) {
        return res.status(409).json({ error: 'Already received at warehouse — cannot change route' });
      }
      const wasKemballs = before.disposition === 'kemballs' || before.disposition === 'campbells';
      const becomingKemballs = newDispo === 'kemballs';
      const today = todayDate();
      const sets = ['disposition=$1'];
      const vals = [newDispo];
      let i = 2;
      // Reset delivery booking on route change — different partner usually needed.
      sets.push('local_delivery_partner=NULL', 'delivery_date=NULL', 'local_delivery_booked_date=NULL');
      // Storage clock: switching INTO Kemballs starts it (if not already started); switching OUT
      //   closes it (set out_date=today since container is leaving Kemballs to go direct).
      if (becomingKemballs && !before.campbells_in_date && before.customs_cleared_date) {
        sets.push('campbells_in_date=$' + (i++));
        vals.push(before.customs_cleared_date);  // started when customs cleared
      }
      if (becomingKemballs) {
        sets.push('campbells_out_date=NULL');  // reopened
      } else if (wasKemballs && !before.campbells_out_date) {
        sets.push('campbells_out_date=$' + (i++));
        vals.push(today);
      }
      sets.push('updated_at=NOW()');
      vals.push(id);
      const sql = 'UPDATE lg_plans SET ' + sets.join(',') + ' WHERE id=$' + i + ' RETURNING *';
      const r = await db.query(sql, vals);
      await logFieldAudit(db, id, 'disposition', before.disposition, newDispo, actor(req), 'agent', 'route change');
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'disposition_switched', (before.disposition || '—') + ' → ' + newDispo, actor(req)]);
      // r31n.1 — Clear any auto-archived book_local_delivery so a fresh one fires for the new route.
      await db.query("DELETE FROM lg_tasks WHERE plan_id=$1 AND rule_key='book_local_delivery' AND status='auto_archived'", [id]);
      await evaluateTasks(db, id);
      res.json({ ok: true, plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Un-receive — manager-only. Rare correction: Harp marked received but turns out it was wrong
  //   container, or there was a mistake. Clears warehouse_received_date + receiver. Plan returns
  //   to warehouse_incoming bucket.
  router.post('/plans/:id/unreceive', async function(req, res) {
    const db = req._db;
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager only' });
    try {
      const id = parseInt(req.params.id);
      const reason = (req.body && req.body.reason || '').toString().trim();
      if (!reason) return res.status(400).json({ error: 'Reason required for un-receive' });
      const before = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [id])).rows[0];
      if (!before) return res.status(404).json({ error: 'Plan not found' });
      if (!before.warehouse_received_date) return res.status(409).json({ error: 'Not received yet — nothing to undo' });
      if (before.warehouse_verified_date) return res.status(409).json({ error: 'Already verified — cannot un-receive' });
      const r = await db.query(
        'UPDATE lg_plans SET warehouse_received_date=NULL, warehouse_received_by=NULL, updated_at=NOW() WHERE id=$1 RETURNING *',
        [id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [id, 'unreceived', reason, actor(req)]);
      await evaluateTasks(db, id);
      res.json({ ok: true, plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/plans/:id/files', uploadSingleFile('file'), async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const slot = (req.body.slot || 'other').toLowerCase();
    const slot_group = slotToGroup(slot);
    if (!req.file) return res.status(400).json({ error: 'No file' });
    // r31g — accounts_agent (Mahima, financial-only) shouldn't upload warehouse photos
    if (slot === 'warehouse_photo' && isAccountsOnlyUser(req.user)) {
      return res.status(403).json({ error: 'Warehouse uploads not allowed for accounts role' });
    }
    try {
      const r = await db.query(`INSERT INTO lg_plan_files (plan_id, slot, slot_group, filename, stored_path, mime_type, size_bytes, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [id, slot, slot_group, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, actor(req)]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [id, 'file_uploaded', slot + ': ' + req.file.originalname, actor(req)]);
      res.json({ file: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // r30d — inline view endpoint (returns the file with inline disposition so browser can render)
  router.get('/files/:id/view', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_plan_files WHERE id=$1 AND deleted_at IS NULL', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).send('Not found');
      const f = r.rows[0];
      if (!fs.existsSync(f.stored_path)) return res.status(410).send('File missing on disk');
      res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline; filename="' + (f.filename || 'file').replace(/[^a-zA-Z0-9._\-]/g,'_') + '"');
      res.sendFile(path.resolve(f.stored_path));
    } catch(e) { res.status(500).send(e.message); }
  });
  router.get('/files/:id/download', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_plan_files WHERE id=$1 AND deleted_at IS NULL', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).send('Not found');
      const f = r.rows[0];
      if (!fs.existsSync(f.stored_path)) return res.status(410).send('File missing on disk (likely lost on redeploy)');
      res.download(f.stored_path, f.filename);
    } catch(e) { res.status(500).send(e.message); }
  });
  // r31k — lightweight metadata endpoint so file viewer can render correctly when called from
  //   pages where _currentPlan isn't loaded (Kemballs, warehouse incoming, etc).
  router.get('/files/:id/meta', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT id, filename, mime_type, slot FROM lg_plan_files WHERE id=$1 AND deleted_at IS NULL', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // r30d — pin/unpin file
  router.post('/files/:id/pin', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const pinned = !!(req.body && req.body.pinned);
      const r = await db.query('UPDATE lg_plan_files SET pinned=$1 WHERE id=$2 RETURNING plan_id, filename', [pinned, id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [r.rows[0].plan_id, pinned ? 'file_pinned' : 'file_unpinned', r.rows[0].filename, actor(req)]);
      res.json({ ok: true, pinned });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/files/:id', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_plan_files WHERE id=$1 AND deleted_at IS NULL', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      const f = r.rows[0];
      // Soft delete — keep DB row for audit, remove from disk
      try { fs.unlinkSync(f.stored_path); } catch(e) {}
      await db.query('UPDATE lg_plan_files SET deleted_at=NOW(), deleted_by=$1 WHERE id=$2', [actor(req), f.id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [f.plan_id, 'file_deleted', f.slot + ': ' + f.filename, actor(req)]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // r31h — removed: POST /plans/:id/issues and PATCH /issues/:id (legacy lg_plan_issues system).
  //   Replaced by the claims system (POST /plans/:id/claims). Frontend addIssue/resolveIssue also removed.
  //   Table lg_plan_issues remains in DB for historical data; no new rows are written.

  // ── r30d — Claims (post-delivery discrepancies) ──────────────────────────
  // GET plan claims (also returns claim files)
  router.get('/plans/:id/claims', async function(req, res) {
    const db = req._db;
    try {
      const planId = parseInt(req.params.id);
      const claims = (await db.query('SELECT * FROM lg_claims WHERE plan_id=$1 ORDER BY created_at DESC', [planId])).rows;
      const cf = (await db.query('SELECT id, claim_id, filename, mime_type, uploaded_by, uploaded_by_role, uploaded_at FROM lg_claim_files WHERE claim_id = ANY($1::int[]) ORDER BY uploaded_at DESC', [claims.map(c => c.id)])).rows;
      const byClaim = {};
      cf.forEach(f => { (byClaim[f.claim_id] = byClaim[f.claim_id] || []).push(f); });
      claims.forEach(c => { c.files = byClaim[c.id] || []; });
      res.json({ claims });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // Create claim
  router.post('/plans/:id/claims', async function(req, res) {
    const db = req._db;
    const planId = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.description) return res.status(400).json({ error: 'description required' });
    try {
      const nextChase = addDays(todayDate(), 4);
      const r = await db.query(
        `INSERT INTO lg_claims (plan_id, description, claim_value_gbp, next_chase_date, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [planId, b.description, b.claim_value_gbp || null, nextChase, actor(req)]);
      const claim = r.rows[0];
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [planId, 'claim_opened', String(b.description).slice(0,100), actor(req)]);
      // r31e.1 — claims live independently from disposition. Do NOT flip disposition='issues'.
      // The plan's routing decision (clean/kemballs) is separate from whether there's a discrepancy.
      // r31n item 7 — Create chase task with fixed assignees (logistics_shared = Shauraya + Neha).
      //   Claims fall to whoever in logistics picks them up; no specific name.
      const chaseIns = await db.query(
        `INSERT INTO lg_tasks (plan_id, rule_key, title, title_cn, intended_role, priority, due_date)
         VALUES ($1, $2, $3, $4, 'agent', 'high', $5)
         RETURNING id`,
        [planId, 'claim_chase_' + claim.id,
         'Chase supplier on claim — ' + String(b.description).slice(0,60),
         '催促供应商处理索赔 — ' + String(b.description).slice(0,60),
         nextChase]);
      await notify(db, { role: 'logistics_shared' }, 'claim_raised', {
        title: 'New claim — ' + String(b.description).slice(0,80),
        body: 'Chase due ' + nextChase, plan_id: planId,
        task_id: chaseIns.rows[0] && chaseIns.rows[0].id
      });
      res.json({ claim });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // r30k — Agent fallback: log what supplier said outside the portal (WeChat / email / phone)
  // Moves claim to supplier_responded state with the proposal noted; audit records agent name
  router.post('/claims/:id/log-supplier-response', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const b = req.body || {};
    try {
      const claim = (await db.query('SELECT * FROM lg_claims WHERE id=$1', [id])).rows[0];
      if (!claim) return res.status(404).json({ error: 'Issue not found' });
      const resolution = b.supplier_proposed_resolution;
      if (!['refund','replace','credit','dispute'].includes(resolution)) {
        return res.status(400).json({ error: 'Invalid proposed resolution' });
      }
      const note = b.supplier_resolution_note || null;
      const replaceRef = resolution === 'replace' ? (b.supplier_replacement_plan_ref || null) : null;
      await db.query(
        `UPDATE lg_claims SET supplier_proposed_resolution=$1, supplier_resolution_note=$2,
         supplier_replacement_plan_ref=$3, supplier_responded_at=NOW(), status='supplier_responded'
         WHERE id=$4`,
        [resolution, note, replaceRef, id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [claim.plan_id, 'claim_supplier_responded_logged_by_agent',
         resolution + (note ? ': ' + note.slice(0,100) : '') + ' (logged on supplier\'s behalf)',
         actor(req)]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // r31n item 7 — Drop a claim. Distinct from "close" (which means resolved).
  //   Drop = "this claim shouldn't have been raised, or was decided against pursuing".
  //   Records actor + reason; auto-archives the chase task. Cannot be undone except by manager
  //   manually editing status back.
  router.post('/claims/:id/drop', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const reason = (req.body && req.body.reason || '').toString().trim();
    if (!reason) return res.status(400).json({ error: 'Reason required when dropping a claim' });
    try {
      const claim = (await db.query('SELECT * FROM lg_claims WHERE id=$1', [id])).rows[0];
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      if (claim.status === 'closed' || claim.status === 'dropped') {
        return res.status(409).json({ error: 'Claim is already ' + claim.status });
      }
      await db.query("UPDATE lg_claims SET status='dropped', closed_at=NOW(), closed_by=$1, agreed_resolution=$2 WHERE id=$3",
        [actor(req), 'dropped: ' + reason, id]);
      await db.query("UPDATE lg_tasks SET status='auto_archived', completed_at=NOW(), completion_note='Claim dropped' WHERE rule_key=$1 AND status IN ('open','claimed')",
        ['claim_chase_' + id]);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [claim.plan_id, 'claim_dropped', reason, actor(req)]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Agent updates claim (agree to resolution, close, etc.)
  router.patch('/claims/:id', async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    const b = req.body || {};
    // r30n — frontend may send 'resolution_note' (free text from the optional textarea); route it to resolution_proof_note
    if (b.resolution_note != null && b.resolution_proof_note == null) {
      b.resolution_proof_note = b.resolution_note;
    }
    try {
      const before = (await db.query('SELECT * FROM lg_claims WHERE id=$1', [id])).rows[0];
      if (!before) return res.status(404).json({ error: 'Not found' });
      // r30h — enforce resolution proof before allowing close
      // r31i — direct-close path: allowed from any state if a resolution note is supplied.
      //   This handles the common case where the supplier-negotiation flow isn't used
      //   (resolved via WhatsApp, internal reconcile, abandoned, etc.). The note is the
      //   audit trail. Structured path (agreed_resolution + file/replacement) still applies
      //   when the agreed_resolution flow IS used.
      if (b.status === 'closed') {
        const resolution = b.agreed_resolution || before.agreed_resolution;
        const noteText = (b.resolution_proof_note || b.resolution_note || '').toString().trim();
        // Direct-close: any state, with a note → allowed.
        if (noteText) {
          // OK — proceed with close.
        } else if (!resolution) {
          return res.status(400).json({ error: 'To close: either pick an agreed resolution OR add a resolution note explaining how it was resolved' });
        } else if (resolution === 'refund' || resolution === 'credit') {
          const fc = (await db.query('SELECT COUNT(*)::int AS n FROM lg_claim_files WHERE claim_id=$1', [id])).rows[0].n;
          if (!fc) {
            return res.status(400).json({ error: 'Upload a credit note / refund proof before closing this issue (or add a resolution note explaining the resolution)' });
          }
        } else if (resolution === 'replace') {
          const recvPlanId = b.resolution_received_in_plan_id || before.resolution_received_in_plan_id;
          const fc = (await db.query('SELECT COUNT(*)::int AS n FROM lg_claim_files WHERE claim_id=$1', [id])).rows[0].n;
          if (!recvPlanId && !fc) {
            return res.status(400).json({ error: 'To close: pick replacement plan, upload a screenshot, or add a resolution note' });
          }
        }
      }
      const fields = ['description','claim_value_gbp','status','agreed_resolution','agreed_resolution_note',
                      'resolution_received_in_plan_id','resolution_proof_note'];
      const sets = []; const vals = []; let i = 1;
      const changes = [];
      for (const f of fields) {
        if (Object.prototype.hasOwnProperty.call(b, f)) {
          sets.push(f + '=$' + (i++));
          vals.push(b[f] === '' ? null : b[f]);
          changes.push(f);
        }
      }
      // If status moving to 'agreed', stamp agreed_at + agreed_by
      if (b.status === 'agreed') {
        sets.push('agreed_at=NOW()'); sets.push('agreed_by=$' + (i++)); vals.push(actor(req));
      }
      // If status moving to 'closed', stamp closed_at + closed_by + resolution_received_at
      if (b.status === 'closed') {
        sets.push('closed_at=NOW()'); sets.push('closed_by=$' + (i++)); vals.push(actor(req));
        sets.push('next_chase_date=NULL');
        if (b.resolution_received_in_plan_id && !before.resolution_received_at) {
          sets.push('resolution_received_at=NOW()');
          sets.push('resolution_received_by=$' + (i++)); vals.push(actor(req));
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'No fields' });
      vals.push(id);
      const r = await db.query('UPDATE lg_claims SET ' + sets.join(',') + ' WHERE id=$' + i + ' RETURNING *', vals);
      const claim = r.rows[0];
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [claim.plan_id, 'claim_updated', 'Status: ' + claim.status + ' · ' + changes.join(', '), actor(req)]);
      // When claim closed with replacement actually received, mark the promise fulfilled
      if (b.status === 'closed' && claim.agreed_resolution === 'replace' && claim.resolution_received_in_plan_id) {
        try {
          await db.query(
            `UPDATE lg_replacement_promises SET fulfilled=TRUE, fulfilled_in_plan_id=$1, fulfilled_at=NOW(), fulfilled_by=$2
             WHERE source_claim_id=$3 AND fulfilled=FALSE`,
            [claim.resolution_received_in_plan_id, actor(req), claim.id]);
        } catch(e) {}
      }
      // When claim closed with replacement, ensure a promise row exists (legacy support if not previously created)
      if (b.status === 'closed' && claim.agreed_resolution === 'replace' && claim.supplier_replacement_plan_ref) {
        const plan = (await db.query('SELECT supplier_id FROM lg_plans WHERE id=$1', [claim.plan_id])).rows[0];
        if (plan && plan.supplier_id) {
          const existing = (await db.query('SELECT id FROM lg_replacement_promises WHERE source_claim_id=$1', [claim.id])).rows;
          if (!existing.length) {
            await db.query(
              `INSERT INTO lg_replacement_promises (source_claim_id, supplier_id, promised_plan_ref, description, fulfilled, fulfilled_in_plan_id, fulfilled_at, fulfilled_by)
               VALUES ($1,$2,$3,$4, TRUE, $5, NOW(), $6)`,
              [claim.id, plan.supplier_id, claim.supplier_replacement_plan_ref, claim.description,
               claim.resolution_received_in_plan_id || null, actor(req)]);
          }
        }
      }
      // Auto-close chase task if claim closed/agreed
      if (b.status === 'closed' || b.status === 'agreed') {
        try {
          await db.query("UPDATE lg_tasks SET status='done', completed_at=NOW(), completed_by=$1, completion_note=$2 WHERE plan_id=$3 AND rule_key=$4 AND status IN ('open','claimed')",
            [actor(req), 'Claim ' + b.status, claim.plan_id, 'claim_chase_' + claim.id]);
        } catch(e) {}
      }
      res.json({ claim });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // Upload file to a claim (agent side)
  router.post('/claims/:id/files', uploadSingleFile('file'), async function(req, res) {
    const db = req._db;
    const id = parseInt(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
      const claim = (await db.query('SELECT plan_id FROM lg_claims WHERE id=$1', [id])).rows[0];
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      await db.query(
        `INSERT INTO lg_claim_files (claim_id, filename, stored_path, mime_type, size_bytes, uploaded_by, uploaded_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, actor(req), isManager(req.user) ? 'manager' : 'agent']);
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [claim.plan_id, 'claim_file_uploaded', req.file.originalname, actor(req)]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // View / download claim file
  router.get('/claim-files/:id/view', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_claim_files WHERE id=$1', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).send('Not found');
      const f = r.rows[0];
      if (!fs.existsSync(f.stored_path)) return res.status(410).send('File missing on disk');
      res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline; filename="' + (f.filename || 'file').replace(/[^a-zA-Z0-9._\-]/g,'_') + '"');
      res.sendFile(path.resolve(f.stored_path));
    } catch(e) { res.status(500).send(e.message); }
  });
  router.get('/claim-files/:id/download', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_claim_files WHERE id=$1', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).send('Not found');
      const f = r.rows[0];
      res.download(f.stored_path, f.filename);
    } catch(e) { res.status(500).send(e.message); }
  });
  router.delete('/claim-files/:id', async function(req, res) {
    const db = req._db;
    try {
      const r = await db.query('SELECT * FROM lg_claim_files WHERE id=$1', [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      const f = r.rows[0];
      try { fs.unlinkSync(f.stored_path); } catch(e) {}
      await db.query('DELETE FROM lg_claim_files WHERE id=$1', [f.id]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  // Replacement promises (open list per supplier)
  // r31h — removed: GET /suppliers/:id/replacement-promises and POST /replacement-promises/:id/fulfill.
  //   Never called from any frontend. Table lg_replacement_promises retained for any future use.

  // r30h — candidate replacement plans (for an issue's "received in which plan" dropdown)
  // Returns active plans from the same supplier as the source plan, excluding the source plan itself.
  router.get('/claims/:id/candidate-replacement-plans', async function(req, res) {
    const db = req._db;
    try {
      const claimId = parseInt(req.params.id);
      const claim = (await db.query('SELECT plan_id FROM lg_claims WHERE id=$1', [claimId])).rows[0];
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      const plan = (await db.query('SELECT supplier_id FROM lg_plans WHERE id=$1', [claim.plan_id])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Source plan not found' });
      const candidates = (await db.query(
        `SELECT id, plan_number, status, order_date
         FROM lg_plans
         WHERE supplier_id=$1 AND id<>$2 AND status='active'
         ORDER BY order_date DESC NULLS LAST LIMIT 50`,
        [plan.supplier_id, claim.plan_id])).rows;
      res.json({ candidates });
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
      // r31n item 15 — mine=true: filter to tasks intended for the current user.
      //   Matches if (a) task is name-assigned to this user, OR (b) task is role-only and the
      //   user's role matches OR is in the shared-role pool (logistics_agent sees role='agent').
      //   Manager/owner see all (no filter).
      if (req.query.mine === 'true' && req.user && !isManager(req.user)) {
        const myName = req.user.name || '';
        const myRole = (req.user.role || '').toLowerCase();
        const myDept = (req.user.department || '').toLowerCase();
        // Build role inclusion list — what role-only tasks does this user see?
        //   logistics_agent → sees role='agent' tasks (the shared logistics pool)
        //   accounts_agent  → sees role='accounts' tasks
        //   warehouse_agent → sees role='warehouse' tasks (no rules currently emit this, future-proof)
        const roleVisible = [];
        if (myRole === 'logistics_agent' || myDept === 'logistics') roleVisible.push('agent');
        if (myRole === 'accounts_agent'  || myDept === 'accounts')  roleVisible.push('accounts');
        if (myRole === 'warehouse_agent' || myDept === 'warehouse') roleVisible.push('warehouse');
        const namePlaceholder = '$' + (i++); vals.push(myName);
        if (roleVisible.length) {
          const rolePlaceholders = roleVisible.map(function(){ return '$' + (i++); }).join(',');
          vals.push.apply(vals, roleVisible);
          where.push('(LOWER(t.intended_assignee_name) = LOWER(' + namePlaceholder + ')'
                     + ' OR (t.intended_assignee_name IS NULL AND t.intended_role IN (' + rolePlaceholders + ')))');
        } else {
          // No role visibility — only name-assigned tasks
          where.push('LOWER(t.intended_assignee_name) = LOWER(' + namePlaceholder + ')');
        }
      }
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
      // r31j — renamed rule_keys: production_check_day_7 → day_14, day_21 → day_28
      // r31n item 8 — Outcome options changed from "on_track / 1-3 days / 4+ days" to
      //   "on_track / delay_1wk / delay_2wk". When a delay is reported, push the ETA forward
      //   accordingly (new_eta = current new_eta or original_eta + 7 or 14 days). Records the
      //   push in lg_field_audit so it shows up in the slip log.
      if (task.rule_key === 'production_check_day_14' || task.rule_key === 'production_check_day_28') {
        const rawOutcome = (req.body && req.body.outcome) || 'on_track';
        // Backward compat: accept legacy outcome names but normalise. Legacy "1-3" treated as on_track
        // (no ETA push); "4+" treated as 1-week (single-bucket simplification).
        let outcome = rawOutcome;
        if (rawOutcome === 'delay_1_3_days') outcome = 'on_track';
        if (rawOutcome === 'delay_4_plus_days') outcome = 'delay_1wk';
        if (!['on_track','delay_1wk','delay_2wk'].includes(outcome)) outcome = 'on_track';
        await db.query('INSERT INTO lg_production_checks (plan_id, check_label, outcome, note, checked_by) VALUES ($1,$2,$3,$4,$5)',
          [task.plan_id, task.rule_key, outcome, note, actor(req)]);
        // Push ETA when delay reported
        if (outcome === 'delay_1wk' || outcome === 'delay_2wk') {
          const push = outcome === 'delay_1wk' ? 7 : 14;
          const planRow = (await db.query('SELECT new_eta, original_eta FROM lg_plans WHERE id=$1', [task.plan_id])).rows[0];
          if (planRow) {
            const base = planRow.new_eta ? asIso(planRow.new_eta) : (planRow.original_eta ? asIso(planRow.original_eta) : null);
            if (base) {
              const pushed = addDays(base, push);
              await db.query('UPDATE lg_plans SET new_eta=$1 WHERE id=$2', [pushed, task.plan_id]);
              await logFieldAudit(db, task.plan_id, 'new_eta', base, pushed, actor(req), 'agent', 'production_check_delay');
              await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
                [task.plan_id, 'eta_pushed', task.rule_key + ' reported ' + outcome + ' → ETA pushed to ' + pushed, actor(req)]);
            } else {
              // No ETA yet — just record on the production check, no push possible
              await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
                [task.plan_id, 'eta_push_skipped', task.rule_key + ' reported ' + outcome + ' but no ETA on plan yet', actor(req)]);
            }
          }
        }
      }
      if (task.rule_key === 'eta_check') await bumpEtaCheck(db, task.plan_id);
      await evaluateTasks(db, task.plan_id);
      res.json({ task });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // r30n.1 — Bulk task actions: claim / done / delete. Multi-id POST.
  // - claim: agents can only claim for themselves (always self). Open → claimed.
  // - done : marks done with optional shared completion note. Any role.
  // - delete: OWNER ONLY. Hard delete with activity audit line per task.
  router.post('/tasks/bulk', async function(req, res) {
    const db = req._db;
    const b = req.body || {};
    const action = String(b.action || '').toLowerCase();
    const ids = Array.isArray(b.ids) ? b.ids.map(x => parseInt(x)).filter(x => !!x) : [];
    if (!ids.length) return res.status(400).json({ error: 'No task ids supplied' });
    if (!['claim','done','delete'].includes(action)) return res.status(400).json({ error: 'Bad action (claim|done|delete)' });
    if (action === 'delete' && (req.user.role || '').toLowerCase() !== 'owner') {
      return res.status(403).json({ error: 'Delete is owner only' });
    }
    const note = (b.completion_note || '').toString().trim() || null;
    const me = actor(req);
    const results = { ok: 0, skipped: 0, failed: 0, details: [] };
    for (const id of ids) {
      try {
        if (action === 'claim') {
          const r = await db.query("UPDATE lg_tasks SET status='claimed', claimed_by=$1, claimed_at=NOW() WHERE id=$2 AND status='open' RETURNING id, plan_id, title", [me, id]);
          if (!r.rows.length) { results.skipped++; results.details.push({ id, status: 'skipped', reason: 'not open or not found' }); continue; }
          await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [r.rows[0].plan_id, 'task_claimed', r.rows[0].title + ' (bulk)', me]);
          results.ok++; results.details.push({ id, status: 'claimed' });
        } else if (action === 'done') {
          const r = await db.query("UPDATE lg_tasks SET status='done', completed_by=$1, completed_at=NOW(), completion_note=$2 WHERE id=$3 AND status IN ('open','claimed') RETURNING id, plan_id, title, rule_key", [me, note, id]);
          if (!r.rows.length) { results.skipped++; results.details.push({ id, status: 'skipped', reason: 'already done or not found' }); continue; }
          const t = r.rows[0];
          await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [t.plan_id, 'task_done', t.title + (note ? ' — ' + note : '') + ' (bulk)', me]);
          if (t.rule_key === 'eta_check') { try { await bumpEtaCheck(db, t.plan_id); } catch(_) {} }
          try { await evaluateTasks(db, t.plan_id); } catch(_) {}
          results.ok++; results.details.push({ id, status: 'done' });
        } else if (action === 'delete') {
          const r = await db.query('DELETE FROM lg_tasks WHERE id=$1 RETURNING id, plan_id, title', [id]);
          if (!r.rows.length) { results.skipped++; results.details.push({ id, status: 'skipped', reason: 'not found' }); continue; }
          try {
            await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)', [r.rows[0].plan_id, 'task_deleted', r.rows[0].title + ' (bulk by owner)', me]);
          } catch(_) {}
          results.ok++; results.details.push({ id, status: 'deleted' });
        }
      } catch(e) {
        results.failed++;
        results.details.push({ id, status: 'failed', error: e.message });
        console.error('[logistics tasks bulk ' + action + ' ' + id + '] ' + e.message);
      }
    }
    console.log('[logistics] tasks bulk ' + action + ' by ' + me + ' · ' + results.ok + ' ok / ' + results.skipped + ' skipped / ' + results.failed + ' failed');
    res.json(results);
  });

  // r31h — removed: GET /plans/:id/slips (slips are already included in GET /plans/:id payload).

  // r30i — Cashflow page: upcoming payments grouped by due window
  // r30j — Warehouse incoming page: plans arriving soon, both direct and from Kemballs
  // No financial fields. Returns plan number, supplier, source (direct/kemballs), ETA, packing list file ref.
  router.get('/warehouse/incoming', async function(req, res) {
    const db = req._db;
    try {
      const today = todayDate();
      const horizon = asIso(addDays(today, 60));
      // r31g — include plans where Harp's marked received (delivery_date may or may not be set) but
      //   not yet auto-closed. The auto-close sweep handles plans >30 days post-verify.
      const rows = (await db.query(`
        SELECT p.id, p.plan_number, p.supplier_id, p.disposition,
               p.original_eta, p.new_eta,
               p.local_delivery_booked_date, p.local_delivery_partner, p.delivery_date,
               p.kemballs_retrieval_booked_date, p.kemballs_retrieval_partner, p.kemballs_retrieval_confirmed_date,
               p.campbells_in_date,
               p.warehouse_received_date, p.warehouse_received_by,
               p.warehouse_verified_date, p.warehouse_verified_by,
               s.name AS supplier_name
        FROM lg_plans p
        LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
        WHERE p.status='active' AND p.closed_at IS NULL
          AND (
            p.delivery_date IS NULL
            OR p.warehouse_received_date IS NOT NULL
          )
      `)).rows;

      const preReceipt = [];
      const receivedRecently = [];
      const stuckVerification = [];
      // r31h — stuck threshold 5 days (was 14). Tightened to nag Neha sooner since the verify→archive cycle is 14d.
      const stuckCutoffMs = Date.now() - 5 * 86400000;

      for (const p of rows) {
        // ── Received branch ──
        if (p.warehouse_received_date) {
          const item = {
            plan_id: p.id, plan_number: p.plan_number, supplier_name: p.supplier_name,
            warehouse_received_date: asIso(p.warehouse_received_date),
            warehouse_received_by: p.warehouse_received_by,
            warehouse_verified_date: p.warehouse_verified_date ? asIso(p.warehouse_verified_date) : null,
            warehouse_verified_by: p.warehouse_verified_by,
            days_since_received: Math.floor((Date.now() - new Date(p.warehouse_received_date).getTime()) / 86400000)
          };
          // r31h — Stuck = unverified for >5 days. Receives top-of-page amber lane to nag Neha.
          if (!p.warehouse_verified_date && new Date(p.warehouse_received_date).getTime() < stuckCutoffMs) {
            stuckVerification.push(item);
          } else {
            receivedRecently.push(item);
          }
          continue;
        }

        // ── Pre-receipt branch ──
        // r31n.1 — Simpler logic:
        //   • Plan has delivery booked (delivery_date set) → Harp expecting it. Aging warning if past.
        //   • Plan past customs but no delivery booked yet → "needs booking" surface. Includes both
        //     clean-route arrivals AND Kemballs plans where delivery has been booked since
        //     (Kemballs without booking = stays on Kemballs page, not here).
        //   • Plan still in transit (no customs clearance) → not here, on active list instead.
        let source, expected_date, action_label, needs_booking = false, aging = false;
        const isKemballsRoute = (p.disposition === 'kemballs' || p.disposition === 'campbells');
        const effectiveBookedDate = p.local_delivery_booked_date || p.kemballs_retrieval_booked_date || p.kemballs_retrieval_confirmed_date;

        if (p.delivery_date) {
          // Delivered (or scheduled) but not yet marked-received — Harp's queue
          source = isKemballsRoute ? 'kemballs' : 'direct';
          expected_date = asIso(p.delivery_date);
          action_label = isKemballsRoute ? 'From Kemballs · delivery on ' + expected_date : 'Delivery on ' + expected_date;
          // r31n.1 — aging: delivery date past + still not marked received → confirm with carrier
          if (expected_date < addDays(today, -7)) aging = true;
        } else if (effectiveBookedDate) {
          source = isKemballsRoute ? 'kemballs' : 'direct';
          expected_date = asIso(effectiveBookedDate);
          action_label = isKemballsRoute ? 'From Kemballs · booked' : 'Delivery booked';
        } else if (isKemballsRoute && p.campbells_in_date) {
          continue;  // Sitting at Kemballs, no delivery booked yet → on Kemballs page
        } else if (p.customs_cleared_date) {
          // Clean route past customs, no delivery booked → needs Shauraya/Neha to book
          source = 'direct';
          expected_date = asIso(p.customs_cleared_date);
          action_label = 'Customs cleared — book delivery';
          needs_booking = true;
        } else if (p.new_eta || p.original_eta) {
          // Pre-customs ETA visibility (legacy); only show if customs nominally close
          source = 'direct';
          expected_date = asIso(p.new_eta || p.original_eta);
          action_label = 'Direct · ETA (delivery not yet booked)';
        } else {
          continue;
        }
        if (expected_date > horizon) continue;
        preReceipt.push({
          plan_id: p.id, plan_number: p.plan_number, supplier_name: p.supplier_name,
          source: source, expected_date: expected_date, action_label: action_label,
          delivery_partner: p.local_delivery_partner || p.kemballs_retrieval_partner || null,
          warehouse_received_date: null, warehouse_received_by: null,
          warehouse_verified_date: null, warehouse_verified_by: null,
          // r31n.1 — flags drive UI actions on the card
          needs_booking: needs_booking,
          aging: aging,
          disposition: p.disposition,
          delivery_date: p.delivery_date ? asIso(p.delivery_date) : null,
          local_delivery_booked_date: p.local_delivery_booked_date ? asIso(p.local_delivery_booked_date) : null
        });
      }

      // r31i — surface the 3 required warehouse-stage slots + photos, so the expandable row shows what's uploaded.
      const all = preReceipt.concat(receivedRecently).concat(stuckVerification);
      if (all.length) {
        const planIds = all.map(i => i.plan_id);
        const files = (await db.query(`
          SELECT plan_id, id, filename, mime_type, uploaded_at, uploaded_by, slot
          FROM lg_plan_files
          WHERE plan_id = ANY($1::int[]) AND deleted_at IS NULL
            AND slot IN ('packing_list','final_pi','warehouse_photo','pl_match','stock_location_sheet','delivery_sheet')
          ORDER BY uploaded_at DESC
        `, [planIds])).rows;
        const pkBy = {}, piBy = {}, photosBy = {}, slotsBy = {};
        files.forEach(function(f){
          if (f.slot === 'packing_list' && !pkBy[f.plan_id]) pkBy[f.plan_id] = f;
          else if (f.slot === 'final_pi' && !piBy[f.plan_id]) piBy[f.plan_id] = f;
          else if (f.slot === 'warehouse_photo') {
            if (!photosBy[f.plan_id]) photosBy[f.plan_id] = [];
            photosBy[f.plan_id].push(f);
          } else if (f.slot === 'pl_match' || f.slot === 'stock_location_sheet' || f.slot === 'delivery_sheet') {
            // Keep most recent per slot per plan (files already sorted DESC by uploaded_at)
            if (!slotsBy[f.plan_id]) slotsBy[f.plan_id] = {};
            if (!slotsBy[f.plan_id][f.slot]) slotsBy[f.plan_id][f.slot] = f;
          }
        });
        all.forEach(function(i){
          i.packing_list = pkBy[i.plan_id] || null;
          i.final_pi = piBy[i.plan_id] || null;
          i.warehouse_photos = photosBy[i.plan_id] || [];
          i.warehouse_files_by_slot = slotsBy[i.plan_id] || {};
        });
      }

      preReceipt.sort((a, b) => (a.expected_date || '9999').localeCompare(b.expected_date || '9999'));
      receivedRecently.sort((a, b) => (b.warehouse_received_date || '').localeCompare(a.warehouse_received_date || ''));
      stuckVerification.sort((a, b) => (b.days_since_received || 0) - (a.days_since_received || 0));

      const wk1 = asIso(addDays(today, 7));
      const wk2 = asIso(addDays(today, 14));
      const wk4 = asIso(addDays(today, 28));
      const overdue = preReceipt.filter(i => i.expected_date < today);
      const this_week = preReceipt.filter(i => i.expected_date >= today && i.expected_date < wk1);
      const next_week = preReceipt.filter(i => i.expected_date >= wk1 && i.expected_date < wk2);
      const weeks_3_4 = preReceipt.filter(i => i.expected_date >= wk2 && i.expected_date < wk4);
      const later = preReceipt.filter(i => i.expected_date >= wk4);
      res.json({
        as_of: today,
        overdue, this_week, next_week, weeks_3_4, later,
        received_recently: receivedRecently,
        stuck_verification: stuckVerification,
        total: preReceipt.length,
        received_count: receivedRecently.length,
        stuck_count: stuckVerification.length
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // r31g — Mark warehouse received (any logistics-allowed user including warehouse_agent)
  router.post('/warehouse/plans/:id/mark-received', async function(req, res) {
    const db = req._db;
    try {
      const id = parseInt(req.params.id);
      const planRow = await db.query('SELECT id, plan_number, warehouse_received_date FROM lg_plans WHERE id=$1', [id]);
      if (!planRow.rows.length) return res.status(404).json({ error: 'Plan not found' });
      if (planRow.rows[0].warehouse_received_date) {
        return res.status(409).json({ error: 'Already marked received' });
      }
      const note = (req.body && req.body.note) || '';
      const r = await db.query(
        `UPDATE lg_plans SET warehouse_received_date=NOW(), warehouse_received_by=$1 WHERE id=$2 RETURNING *`,
        [actor(req), id]
      );
      await db.query(
        `INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)`,
        [id, 'warehouse_received', note ? ('note: ' + note) : '', actor(req)]
      );
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // r31g — Mark warehouse verified (logistics_agent + manager + owner only; separation of duties)
  router.post('/warehouse/plans/:id/mark-verified', async function(req, res) {
    const db = req._db;
    try {
      if (isWarehouseOnlyUser(req.user) || isAccountsOnlyUser(req.user)) {
        return res.status(403).json({ error: 'Verification restricted to logistics/manager' });
      }
      const id = parseInt(req.params.id);
      const planRow = await db.query('SELECT id, plan_number, warehouse_received_date, warehouse_verified_date FROM lg_plans WHERE id=$1', [id]);
      if (!planRow.rows.length) return res.status(404).json({ error: 'Plan not found' });
      if (!planRow.rows[0].warehouse_received_date) {
        return res.status(409).json({ error: 'Plan must be marked received before it can be verified' });
      }
      if (planRow.rows[0].warehouse_verified_date) {
        return res.status(409).json({ error: 'Already verified' });
      }
      const note = (req.body && req.body.note) || '';
      const r = await db.query(
        `UPDATE lg_plans SET warehouse_verified_date=NOW(), warehouse_verified_by=$1 WHERE id=$2 RETURNING *`,
        [actor(req), id]
      );
      await db.query(
        `INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)`,
        [id, 'warehouse_verified', note ? ('note: ' + note) : '', actor(req)]
      );
      res.json({ plan: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // r30j — Kemballs page: rich data with packing list, retrieval booking
  router.get('/kemballs/active', async function(req, res) {
    const db = req._db;
    try {
      // r31n.1 — Kemballs bucket: container has cleared customs, disposition=kemballs, no
      //   delivery booked yet, not closed. Plan stays status='active' throughout (no parking flag).
      //   Once delivery is booked the plan disappears from this query and shows up in
      //   warehouse-incoming. If delivery is cancelled, plan returns here.
      const rows = (await db.query(`
        SELECT p.*, s.name AS supplier_name, s.payment_terms AS supplier_payment_terms
        FROM lg_plans p LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
        WHERE p.status='active' AND p.closed_at IS NULL
          AND p.customs_cleared_date IS NOT NULL
          AND p.disposition IN ('kemballs','campbells')
          AND p.delivery_date IS NULL
        ORDER BY p.campbells_in_date ASC NULLS LAST
      `)).rows;
      // Attach packing list + final PI file refs
      if (rows.length) {
        const planIds = rows.map(r => r.id);
        const files = (await db.query(`
          SELECT plan_id, id, filename, mime_type, uploaded_at, slot
          FROM lg_plan_files
          WHERE plan_id = ANY($1::int[]) AND deleted_at IS NULL AND slot IN ('packing_list','final_pi')
          ORDER BY uploaded_at DESC
        `, [planIds])).rows;
        const pkBy = {}, piBy = {};
        files.forEach(function(f){
          if (f.slot === 'packing_list' && !pkBy[f.plan_id]) pkBy[f.plan_id] = f;
          if (f.slot === 'final_pi' && !piBy[f.plan_id]) piBy[f.plan_id] = f;
        });
        rows.forEach(function(r){
          r.packing_list_file = pkBy[r.id] || null;
          r.final_pi_file = piBy[r.id] || null;
          // Compute days at Kemballs + cost
          if (r.campbells_in_date) {
            const inMs = Date.now() - new Date(r.campbells_in_date).getTime();
            r.days_at_kemballs = Math.floor(inMs / 86400000);
            r.weeks_at_kemballs = Math.floor(r.days_at_kemballs / 7);
            const weekly = parseFloat(r.campbells_weekly_gbp) || 0;
            r.cost_so_far_gbp = Math.round(weekly * r.weeks_at_kemballs * 100) / 100;
            // r31n.1 — Aging flag: 8+ weeks at Kemballs is a serious cost signal. Surfaces an
            //   amber warning on the card prompting Shauraya to either book delivery or escalate
            //   (e.g. clarify with Mahima if there's a payment hold-up).
            r.aging_warning = r.weeks_at_kemballs >= 8;
          } else {
            // r31j — defensive guard: campbells_in_date may be null for very old plans before
            //   auto-set landed. Show zeros rather than "undefined days" garbage.
            r.days_at_kemballs = 0;
            r.weeks_at_kemballs = 0;
            r.cost_so_far_gbp = 0;
            r.aging_warning = false;
          }
        });
      }
      res.json({ plans: rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/cashflow', async function(req, res) {
    const db = req._db;
    try {
      const today = todayDate();
      // Pull active plans + supplier
      const all = (await db.query(`SELECT p.*, s.name AS supplier_name, s.payment_terms AS supplier_payment_terms
        FROM lg_plans p LEFT JOIN lg_suppliers s ON s.id=p.supplier_id
        WHERE p.status='active' AND p.closed_at IS NULL`)).rows;
      // r31l — One-off payments (have a real due date) vs Running costs (recurring/ongoing).
      const due = [];          // one-off payments → bucketed by due date
      const runningCosts = []; // accruing costs → shown separately, not "due"
      all.forEach(function(p){
        // Deposit due (only if not paid)
        if (!p.deposit_received_date) {
          const dep = parseFloat(p.deposit_usd) || ((parseFloat(p.total_amount_usd)||0) * (parseFloat(p.deposit_pct)||0) / 100);
          if (dep > 0) {
            const dueDate = p.order_date ? asIso(addDays(p.order_date, 1)) : today;
            due.push({
              plan_id: p.id, plan_number: p.plan_number, supplier_name: p.supplier_name,
              kind: 'deposit', currency: 'USD', amount: dep, due_date: dueDate,
              // r31l — cleaner notes; no internal "(Total − Dep, Final PI not set)" leakage
              note: 'Deposit'
            });
          }
        }
        // Final payment due (only if not paid; supplier_payment_terms = days before ETA)
        let finalDueIso = null;
        let finalAmount = 0;
        if (!p.final_payment_received_date && (p.original_eta || p.new_eta)) {
          const finalPi = parseFloat(p.final_pi_amount_usd);
          const dep = parseFloat(p.deposit_usd) || 0;
          if (!isNaN(finalPi) && finalPi > 0) {
            finalAmount = finalPi - dep;
          } else {
            const total = parseFloat(p.total_amount_usd) || 0;
            finalAmount = total - dep;
          }
          if (finalAmount > 0) {
            const dueDate = computeFinalPaymentDue(p, { payment_terms: p.supplier_payment_terms });
            finalDueIso = dueDate ? asIso(dueDate) : asIso(addDays(p.new_eta || p.original_eta, -14));
            due.push({
              plan_id: p.id, plan_number: p.plan_number, supplier_name: p.supplier_name,
              kind: 'final', currency: 'USD', amount: finalAmount, due_date: finalDueIso,
              note: 'Final payment'
            });
          }
        }
        // Shipper payment due
        // r31l — Due date now mirrors final payment (paid together — telex won't release until shipper is paid).
        //   Fallback: 14 days after loading, only if final-payment due date couldn't be computed.
        if (!p.shipper_payment_made && p.actual_loading_date && p.container_price_usd) {
          const ship = parseFloat(p.container_price_usd);
          if (ship > 0) {
            const shipDue = finalDueIso || asIso(addDays(p.actual_loading_date, 14));
            due.push({
              plan_id: p.id, plan_number: p.plan_number, supplier_name: p.supplier_name,
              kind: 'shipper', currency: 'USD', amount: ship, due_date: shipDue,
              note: 'Shipping · ' + (p.shipper_name || 'freight forwarder')
            });
          }
        }
        // Duty payment due (if invoice received but not paid)
        if (p.duty_invoice_received_date && !p.duty_paid_date && p.duty_invoice_amount_gbp) {
          const amt = parseFloat(p.duty_invoice_amount_gbp);
          if (amt > 0) {
            const dueDate = asIso(addDays(p.duty_invoice_received_date, 2));
            due.push({
              plan_id: p.id, plan_number: p.plan_number, supplier_name: p.supplier_name,
              kind: 'duty', currency: 'GBP', amount: amt, due_date: dueDate,
              note: 'UK customs duty'
            });
          }
        }
        // r31l — Kemballs storage: pulled OUT of "due" list, into separate runningCosts.
        //   It's a recurring accrual, not a one-off payment due on a date. Lumping it into
        //   "Overdue" (as r31j did) was misleading.
        if ((p.disposition === 'kemballs' || p.disposition === 'campbells')
            && p.campbells_in_date && !p.campbells_out_date) {
          const cost = kemballsCost(p);
          if (cost.incurred > 0) {
            runningCosts.push({
              plan_id: p.id, plan_number: p.plan_number, supplier_name: p.supplier_name,
              kind: 'kemballs_storage', currency: 'GBP', amount: cost.incurred,
              accrued_since: p.campbells_in_date,
              weeks: cost.weeks, weekly_rate: cost.weekly,
              note: 'Kemballs storage · ' + cost.weeks + ' wk × £' + cost.weekly + '/wk'
            });
          }
        }
      });
      // Sort by due date
      due.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
      runningCosts.sort((a, b) => (b.amount || 0) - (a.amount || 0));
      // Group into buckets
      const wk1 = asIso(addDays(today, 7));
      const wk2 = asIso(addDays(today, 14));
      const mo1 = asIso(addDays(today, 30));
      const overdue = due.filter(d => d.due_date < today);
      const this_week = due.filter(d => d.due_date >= today && d.due_date < wk1);
      const next_week = due.filter(d => d.due_date >= wk1 && d.due_date < wk2);
      const this_month = due.filter(d => d.due_date >= wk2 && d.due_date < mo1);
      const later = due.filter(d => d.due_date >= mo1);
      // Totals by currency for each bucket
      function totals(arr) {
        const t = { USD: 0, GBP: 0 };
        arr.forEach(d => { t[d.currency] = (t[d.currency] || 0) + (parseFloat(d.amount) || 0); });
        return t;
      }
      // r31l — Index of suppliers in the dataset so frontend filter pill knows which to show.
      const supplierSet = new Set();
      due.concat(runningCosts).forEach(function(d){ if (d.supplier_name) supplierSet.add(d.supplier_name); });
      const supplierIndex = Array.from(supplierSet).sort();

      res.json({
        as_of: today,
        overdue: { items: overdue, totals: totals(overdue) },
        this_week: { items: this_week, totals: totals(this_week) },
        next_week: { items: next_week, totals: totals(next_week) },
        this_month: { items: this_month, totals: totals(this_month) },
        later: { items: later, totals: totals(later) },
        all: { items: due, totals: totals(due) },
        // r31l — additions
        running_costs: { items: runningCosts, totals: totals(runningCosts) },
        suppliers: supplierIndex,
        grand_totals: totals(due)  // pipeline totals (running costs shown separately)
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // r30e — centralized "Recently edited (post-grace)" feed for dashboard
  // Combines field edits past grace window AND file activity (uploads, deletes, pins)
  router.get('/audit/recent', async function(req, res) {
    const db = req._db;
    try {
      const days = Math.min(parseInt(req.query.days || '7'), 60);
      const limit = Math.min(parseInt(req.query.limit || '100'), 200);
      // Field edits past grace
      const fieldEdits = (await db.query(`
        SELECT 'field' AS kind, fa.field_name AS detail_key, fa.old_value, fa.new_value,
               fa.set_by AS by_user, fa.set_by_role AS by_role, fa.created_at,
               p.id AS plan_id, p.plan_number, s.name AS supplier_name
        FROM lg_field_audit fa
        JOIN lg_plans p ON p.id = fa.plan_id
        LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
        WHERE fa.within_grace = FALSE
          AND fa.created_at > NOW() - ($1 || ' days')::INTERVAL
        ORDER BY fa.created_at DESC
        LIMIT $2`, [String(days), limit])).rows;
      // File activity (uploads, deletes, pins) — always shown regardless of grace
      const fileEvents = (await db.query(`
        SELECT 'file' AS kind, a.action AS detail_key, NULL AS old_value, a.detail AS new_value,
               a.actor_name AS by_user, NULL AS by_role, a.created_at,
               p.id AS plan_id, p.plan_number, s.name AS supplier_name
        FROM lg_activity a
        JOIN lg_plans p ON p.id = a.plan_id
        LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
        WHERE a.action IN ('file_uploaded','file_deleted','file_pinned','file_unpinned','supplier_file')
          AND a.created_at > NOW() - ($1 || ' days')::INTERVAL
        ORDER BY a.created_at DESC
        LIMIT $2`, [String(days), limit])).rows;
      // Merge + sort by created_at desc, cap at limit
      const all = fieldEdits.concat(fileEvents).sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
      res.json({ edits: all, days: days });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  // r31f — slim summary endpoint for shell.html Logistics card
  router.get('/summary', async function(req, res) {
    const db = req._db;
    try {
      const all = await db.query(`SELECT p.*, s.name AS supplier_name FROM lg_plans p LEFT JOIN lg_suppliers s ON s.id=p.supplier_id WHERE p.status='active' AND p.closed_at IS NULL`);
      const supMap = {};
      (await db.query('SELECT * FROM lg_suppliers')).rows.forEach(s => supMap[s.id] = s);
      const enriched = all.rows.map(p => enrichPlan(p, supMap[p.supplier_id]));
      const fires = enriched.filter(p => p.is_overdue);
      // r31g — fix: column is deposit_usd, not deposit_amount_usd. Previous fallback always returned 0.
      const valueInTransit = enriched.filter(p => p.actual_loading_date && !p.delivery_date).reduce((sum, p) => sum + (parseFloat(p.final_amount_usd) || parseFloat(p.deposit_usd) || 0), 0);
      // r31n.1 — Kemballs bucket = customs cleared + kemballs disposition + no delivery booked
      const atKemballs = enriched.filter(p =>
        p.customs_cleared_date && (p.disposition === 'kemballs' || p.disposition === 'campbells') && !p.delivery_date);
      // attention_message: most urgent fire (or null)
      let attention = null;
      if (fires.length) {
        const top = fires.slice().sort((a,b) => (b.overdue_days||0) - (a.overdue_days||0))[0];
        attention = top.plan_number + ' stuck on "' + (top.current_gate_name || 'stage') + '" · ' + (top.overdue_days || 0) + 'd';
      }
      res.json({
        in_flight: enriched.length,
        fires: fires.length,
        value_in_transit_usd: Math.round(valueInTransit),
        at_kemballs: atKemballs.length,
        attention_message: attention,
        version: 'r31n.1'
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
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
      const wkPlus21 = addDays(today, 21);   // r31f — for "next 2 weeks" lane

      const inFlight  = enriched.filter(p => p.status === 'active' && !p.closed_at);
      const overdue   = inFlight.filter(p => p.is_overdue);
      // r31n.1 — Kemballs count = plans physically at Kemballs (customs cleared + kemballs route +
      //   no delivery booked). Was previously "any disposition=kemballs with no campbells_out_date"
      //   which over-counted plans that hadn't even reached customs yet.
      const atKemballs = inFlight.filter(p =>
        p.customs_cleared_date && (p.disposition === 'kemballs' || p.disposition === 'campbells') && !p.delivery_date);
      // r31e.1 — plans with issues = plans with at least one non-closed claim (independent of disposition)
      const planIdsWithOpenClaims = new Set(
        (await db.query("SELECT DISTINCT plan_id FROM lg_claims WHERE status NOT IN ('closed','archived','dropped')")).rows.map(function(r){ return r.plan_id; })
      );
      const withIssues = inFlight.filter(p => planIdsWithOpenClaims.has(p.id));

      // r31n.1 — Lane filters only show plans STILL IN TRANSIT (pre-customs). Plans past customs
      //   are managed on the Kemballs page or warehouse-incoming page — surfacing them here too
      //   would double-show with conflicting actions.
      const stillInTransit = inFlight.filter(p => !p.customs_cleared_date);
      const loadingThisWeek = stillInTransit.filter(p => p.approx_loading_date && asIso(p.approx_loading_date) <= wkPlus7 && !p.actual_loading_date);
      const loadingNextWeek = stillInTransit.filter(p => p.approx_loading_date && asIso(p.approx_loading_date) > wkPlus7 && asIso(p.approx_loading_date) <= wkPlus14 && !p.actual_loading_date);
      const loadingThisWeekDash = loadingThisWeek;
      const loadingNext2WeeksDash = stillInTransit.filter(p => p.approx_loading_date && asIso(p.approx_loading_date) > wkPlus7 && asIso(p.approx_loading_date) <= wkPlus21 && !p.actual_loading_date);
      const arrivingThisWeek = stillInTransit.filter(p => p.new_eta && asIso(p.new_eta) <= wkPlus7);
      const arrivingNextWeek = stillInTransit.filter(p => p.new_eta && asIso(p.new_eta) > wkPlus7 && asIso(p.new_eta) <= wkPlus14);
      const arrivingThisWeekDash = arrivingThisWeek;
      const arrivingNext2WeeksDash = stillInTransit.filter(p => p.new_eta && asIso(p.new_eta) > wkPlus7 && asIso(p.new_eta) <= wkPlus21);
      const paymentsDueSoon = inFlight.filter(p => {
        if (p.final_payment_received_date) return false;
        const due = p.final_payment_due_date_computed;
        return due && due <= wkPlus14;
      });

      let valueInTransit = 0;
      enriched.forEach(p => { if (p.status === 'active' && !p.closed_at && p.bl_date && !p.delivery_date) valueInTransit += parseFloat(p.total_amount_usd || 0); });
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

      // ── r30f — anomalies (real fires) ───────────────────────────────────────
      // Build a list of plans that need attention NOW, not "in 14 days".
      const anomalies = [];
      // 1) Overdue payments (final_payment_due_date_computed passed, not paid)
      inFlight.forEach(function(p){
        if (p.final_payment_received_date) return;
        const due = p.final_payment_due_date_computed;
        if (due && due < today) {
          const owe = parseFloat(p.final_amount_usd || (p.total_amount_usd || 0) - (p.deposit_usd || 0));
          const daysOver = daysBetween(due, today);
          anomalies.push({
            kind: 'overdue_payment', plan_id: p.id, plan_number: p.plan_number,
            supplier_name: p.supplier_name,
            severity: 'high',
            message: 'Final payment ' + daysOver + ' day' + (daysOver === 1 ? '' : 's') + ' overdue · $' + Math.round(owe || 0).toLocaleString()
          });
        }
      });
      // 2) Overdue gates (computeStage flagged it)
      inFlight.forEach(function(p){
        if (!p.is_overdue) return;
        anomalies.push({
          kind: 'overdue_gate', plan_id: p.id, plan_number: p.plan_number,
          supplier_name: p.supplier_name,
          severity: p.overdue_days > 7 ? 'high' : 'medium',
          message: 'Stuck on "' + (p.current_gate_name || 'stage') + '" for ' + p.overdue_days + ' days'
        });
      });
      // 3) ETA passed but no delivery & no disposition
      inFlight.forEach(function(p){
        if (!p.new_eta && !p.original_eta) return;
        if (p.delivery_date || (p.disposition === 'kemballs' || p.disposition === 'campbells')) return;
        const eta = asIso(p.new_eta || p.original_eta);
        if (eta < today) {
          const daysOver = daysBetween(eta, today);
          anomalies.push({
            kind: 'eta_passed', plan_id: p.id, plan_number: p.plan_number,
            supplier_name: p.supplier_name,
            severity: daysOver > 5 ? 'high' : 'medium',
            message: 'ETA was ' + daysOver + ' day' + (daysOver === 1 ? '' : 's') + ' ago · no delivery yet'
          });
        }
      });
      // 4) Stale supplier claims (open or awaiting_supplier for > 5 days)
      const staleClaims = await db.query(
        `SELECT c.id, c.plan_id, c.description, c.created_at, p.plan_number, s.name AS supplier_name,
                EXTRACT(DAY FROM NOW() - c.created_at)::int AS age_days
         FROM lg_claims c
         JOIN lg_plans p ON p.id = c.plan_id
         LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
         WHERE c.status IN ('open','awaiting_supplier')
           AND c.created_at < NOW() - INTERVAL '5 days'`);
      staleClaims.rows.forEach(function(c){
        anomalies.push({
          kind: 'stale_claim', plan_id: c.plan_id, plan_number: c.plan_number,
          supplier_name: c.supplier_name,
          severity: c.age_days > 14 ? 'high' : 'medium',
          message: 'Claim open ' + c.age_days + ' days · no supplier response'
        });
      });
      // r31j — ETA slipped ≥5 days within last 7 days. Field audit tracks new_eta changes;
      //   we look for the most recent change vs the previous and flag big jumps.
      try {
        const etaSlips = await db.query(`
          WITH recent_eta_changes AS (
            SELECT plan_id, new_value, old_value, changed_at,
                   ROW_NUMBER() OVER (PARTITION BY plan_id ORDER BY changed_at DESC) AS rn
              FROM lg_field_audit
             WHERE field_name = 'new_eta'
               AND changed_at > NOW() - INTERVAL '7 days'
               AND old_value IS NOT NULL AND new_value IS NOT NULL
          )
          SELECT r.plan_id, r.new_value, r.old_value, r.changed_at, p.plan_number, s.name AS supplier_name
            FROM recent_eta_changes r
            JOIN lg_plans p ON p.id = r.plan_id
       LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
           WHERE r.rn = 1
             AND p.status = 'active' AND p.closed_at IS NULL
             AND p.delivery_date IS NULL
        `);
        etaSlips.rows.forEach(function(row){
          const oldEta = row.old_value;
          const newEta = row.new_value;
          if (!oldEta || !newEta) return;
          let slipDays;
          try { slipDays = Math.abs(daysBetween(oldEta, newEta)); } catch(_){ slipDays = 0; }
          if (slipDays >= 5) {
            anomalies.push({
              kind: 'eta_slipped', plan_id: row.plan_id, plan_number: row.plan_number,
              supplier_name: row.supplier_name,
              severity: slipDays > 14 ? 'high' : 'medium',
              message: 'ETA slipped ' + slipDays + ' days · ' + asIso(oldEta) + ' → ' + asIso(newEta)
            });
          }
        });
      } catch(e) { console.error('[anomalies eta_slipped] ' + e.message); }
      // Severity sort: high first
      anomalies.sort((a,b) => (a.severity === 'high' && b.severity !== 'high') ? -1 : (b.severity === 'high' && a.severity !== 'high') ? 1 : 0);

      // ── r30g — Missing Original PI anomaly ──────────────────────────────────
      // For every active plan, check if Original PI has been uploaded. Surface a soft warning if not.
      const allFilesForCheck = (await db.query(
        `SELECT plan_id, slot FROM lg_plan_files WHERE deleted_at IS NULL AND plan_id = ANY($1::int[])`,
        [inFlight.map(p => p.id)])).rows;
      const piBySlot = {};
      allFilesForCheck.forEach(function(f){
        if (f.slot === 'original_pi') (piBySlot[f.plan_id] = true);
      });
      inFlight.forEach(function(p){
        // Only flag if plan is past gate 2 (well into the workflow) and no PI
        if (p.current_gate >= 2 && !piBySlot[p.id]) {
          anomalies.push({
            kind: 'missing_pi', plan_id: p.id, plan_number: p.plan_number,
            supplier_name: p.supplier_name,
            severity: p.current_gate >= 4 ? 'medium' : 'low',
            message: 'Original PI not uploaded yet'
          });
        }
      });

      // ── r30g — Auto-archive closed claims older than 7 days ─────────────────
      // (Hides them from dashboard but they remain in DB for audit)
      try {
        await db.query(`UPDATE lg_claims SET status='archived'
                        WHERE status='closed' AND closed_at < NOW() - INTERVAL '7 days'`);
      } catch(e) { console.error('[claims auto-archive] ' + e.message); }

      // ── r30f — Next action per plan (one card per plan with something to do) ─
      const tasksByPlan = {};
      tasks.forEach(t => { (tasksByPlan[t.plan_id] = tasksByPlan[t.plan_id] || []).push(t); });
      const primaryKeys = new Set(TASK_RULES.filter(r => r.primary).map(r => r.key));
      primaryKeys.add('eta_check');

      // r30g — Pre-load all files for in-flight plans (bulk), build stage cards
      const allFileRows = (await db.query(
        `SELECT * FROM lg_plan_files WHERE deleted_at IS NULL AND plan_id = ANY($1::int[]) ORDER BY uploaded_at DESC`,
        [inFlight.map(p => p.id)])).rows;
      const filesByPlan = {};
      allFileRows.forEach(function(f){ (filesByPlan[f.plan_id] = filesByPlan[f.plan_id] || []).push(f); });
      // Field audit history per plan (for inline change history) — limit to plans in flight, last 180 days
      const auditRowsAll = (await db.query(
        `SELECT plan_id, field_name, old_value, new_value, set_by, set_by_role, within_grace, created_at
         FROM lg_field_audit WHERE plan_id = ANY($1::int[]) AND within_grace = FALSE ORDER BY created_at ASC`,
        [inFlight.map(p => p.id)])).rows;
      const auditByPlan = {};
      auditRowsAll.forEach(function(a){
        const m = auditByPlan[a.plan_id] = auditByPlan[a.plan_id] || {};
        (m[a.field_name] = m[a.field_name] || []).push({
          old_value: a.old_value, new_value: a.new_value,
          by: a.set_by, role: a.set_by_role, at: a.created_at
        });
      });

      const nextActions = [];
      inFlight.forEach(function(p){
        // r31n.1 — Active plans bucket only. Plans in later buckets are managed from their
        //   own pages (Kemballs page, warehouse incoming page, warehouse received page).
        //   Showing them here too would double-surface the same plan with conflicting actions.
        //   Bucket rule for active = customs not cleared yet AND not received at warehouse.
        if (p.customs_cleared_date) return;          // gone past customs → Kemballs or Incoming
        if (p.warehouse_received_date) return;       // already at warehouse
        // r30g — Build the full stage card for this plan (independent of legacy tasks)
        const planFiles = filesByPlan[p.id] || [];
        const cardData = buildStageCard(p, supMap[p.supplier_id], planFiles);
        const stageCfg = cardData.config;
        if (!stageCfg) return;  // closed / cancelled
        // Build legacy primary_task pointer for backward UI compatibility
        const planTasks = tasksByPlan[p.id] || [];
        const sorted = planTasks.slice().sort(function(a,b){
          const aP = primaryKeys.has(a.rule_key) ? 0 : 1;
          const bP = primaryKeys.has(b.rule_key) ? 0 : 1;
          if (aP !== bP) return aP - bP;
          const aPr = a.priority === 'high' ? 0 : 1;
          const bPr = b.priority === 'high' ? 0 : 1;
          if (aPr !== bPr) return aPr - bPr;
          const aD = a.due_date ? asIso(a.due_date) : '9999';
          const bD = b.due_date ? asIso(b.due_date) : '9999';
          return aD.localeCompare(bD);
        });
        const t = sorted[0] || null;
        const followups = sorted.slice(1).map(t2 => ({
          id: t2.id, rule_key: t2.rule_key, title: t2.title, status: t2.status,
          priority: t2.priority, due_date: t2.due_date, claimed_by: t2.claimed_by,
          intended_role: t2.intended_role
        }));
        nextActions.push({
          plan_id: p.id, plan_number: p.plan_number, supplier_name: p.supplier_name,
          current_gate: p.current_gate, current_gate_name: p.current_gate_name,
          total_amount_usd: p.total_amount_usd, order_date: p.order_date,
          notes: p.remarks || null,
          // r30g — the stage card content (fields, docs, money, completion)
          stage_card: stageCfg,
          // r30g — field audit history (only post-grace) by field name
          field_audit: auditByPlan[p.id] || {},
          // r30g — files for this plan (so the card can resolve "uploaded" status)
          files: planFiles.map(f => ({ id: f.id, slot: f.slot, slot_group: f.slot_group,
            filename: f.filename, mime_type: f.mime_type, uploaded_by: f.uploaded_by,
            uploaded_at: f.uploaded_at, pinned: f.pinned })),
          // Legacy fields kept for any older UI paths
          primary_task: t ? {
            id: t.id, rule_key: t.rule_key, title: t.title, status: t.status,
            priority: t.priority, due_date: t.due_date, claimed_by: t.claimed_by,
            intended_role: t.intended_role
          } : null,
          followups: followups,
          // r31g — fix: telex is part of gate 5 since r30i, not gate 6. Old condition (gate===6 && !telex_declared) was always false.
          waiting_on_supplier: !!(t && t.intended_role === 'agent' && p.current_gate === 5 && p.telex_supplier_declared === false)
        });
      });

      // ── r30f — On-track plans (no anomalies, no active tasks) ──────────────
      const anomalyPlanIds = new Set(anomalies.map(a => a.plan_id));
      const actionPlanIds  = new Set(nextActions.map(n => n.plan_id));
      const onTrack = inFlight.filter(p => !anomalyPlanIds.has(p.id) && !actionPlanIds.has(p.id));

      // r30g — Top-level claims list for dashboard "Claims" section
      // r31e.1 — exclude closed claims; the panel is for ACTIVE issues only.
      // Once a claim is closed, it stops showing on the dashboard (still accessible per-plan).
      const dashboardClaims = (await db.query(
        `SELECT c.*, p.plan_number, p.supplier_id, s.name AS supplier_name
         FROM lg_claims c
         JOIN lg_plans p ON p.id = c.plan_id
         LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
         WHERE c.status NOT IN ('archived','closed')
         ORDER BY
           CASE WHEN c.status IN ('open','awaiting_supplier','supplier_responded') THEN 0 ELSE 1 END,
           c.created_at DESC`)).rows;
      // Attach claim files
      if (dashboardClaims.length) {
        const cf = (await db.query(
          'SELECT id, claim_id, filename, mime_type, uploaded_by, uploaded_by_role FROM lg_claim_files WHERE claim_id = ANY($1::int[])',
          [dashboardClaims.map(c => c.id)])).rows;
        const byClaim = {};
        cf.forEach(f => { (byClaim[f.claim_id] = byClaim[f.claim_id] || []).push(f); });
        dashboardClaims.forEach(c => { c.files = byClaim[c.id] || []; });
      }

      // r31h — verified in last 7 days (for the "Verified · 7 days" dashboard tile)
      const verifiedLast7d = (await db.query(
        `SELECT COUNT(*)::int AS c FROM lg_plans
          WHERE warehouse_verified_date IS NOT NULL
            AND warehouse_verified_date >= NOW() - INTERVAL '7 days'`)).rows[0].c;

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
          tasks_overdue: overdueTasks.length, tasks_due_today: dueTodayTasks.length,
          anomalies: anomalies.length, next_actions: nextActions.length, on_track: onTrack.length,
          open_claims: dashboardClaims.filter(c => c.status !== 'closed').length,
          verified_last_7d: verifiedLast7d
        },
        // r30f/r30g fields
        anomalies: anomalies,
        verified_last_7d: verifiedLast7d,
        next_actions: nextActions,
        on_track: onTrack,
        claims: dashboardClaims,   // r30g
        // r31f — lane buckets for dashboard "Logistics flow" panel
        flow_lanes: {
          loading: {
            this_week:    { count: loadingThisWeekDash.length,    plan_ids: loadingThisWeekDash.map(p=>p.id),    plan_numbers: loadingThisWeekDash.map(p=>p.plan_number) },
            next_2_weeks: { count: loadingNext2WeeksDash.length,  plan_ids: loadingNext2WeeksDash.map(p=>p.id),  plan_numbers: loadingNext2WeeksDash.map(p=>p.plan_number) }
          },
          arriving: {
            this_week:    { count: arrivingThisWeekDash.length,   plan_ids: arrivingThisWeekDash.map(p=>p.id),   plan_numbers: arrivingThisWeekDash.map(p=>p.plan_number) },
            next_2_weeks: { count: arrivingNext2WeeksDash.length, plan_ids: arrivingNext2WeeksDash.map(p=>p.id), plan_numbers: arrivingNext2WeeksDash.map(p=>p.plan_number) }
          }
        },
        // r31h — arriving_timeline (9-week chart) removed. Replaced by anomalies hero feed.
        // Legacy fields (kept for backward compatibility)
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

  // ─────────────────────────────────────────────────────────────────────────────
  // r31b — Freight agents directory + quote / delivery booking flows
  // ─────────────────────────────────────────────────────────────────────────────

  // List agents (manager+)
  router.get('/agents', async function(req, res) {
    const db = req._db;
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Not allowed' });
    try {
      const r = await db.query('SELECT id, name, email, role, active, notes, created_at FROM lg_freight_agents ORDER BY active DESC, name ASC');
      res.json({ agents: r.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Create agent (owner)
  router.post('/agents', async function(req, res) {
    const db = req._db;
    if ((req.user.role || '').toLowerCase() !== 'owner') return res.status(403).json({ error: 'Owner only' });
    const b = req.body || {};
    if (!b.name || !b.role) return res.status(400).json({ error: 'name and role required' });
    if (!['quote','delivery','both'].includes(b.role)) return res.status(400).json({ error: 'role must be quote|delivery|both' });
    try {
      const r = await db.query(
        'INSERT INTO lg_freight_agents (name, email, role, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [b.name.trim(), (b.email || '').trim(), b.role, b.notes || null, actor(req)]);
      res.json({ agent: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Update agent (owner)
  router.patch('/agents/:id', async function(req, res) {
    const db = req._db;
    if ((req.user.role || '').toLowerCase() !== 'owner') return res.status(403).json({ error: 'Owner only' });
    const fields = ['name','email','role','active','notes'];
    const sets = []; const vals = []; let i = 1;
    for (const f of fields) if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) { sets.push(f+'=$'+(i++)); vals.push(req.body[f]); }
    if (!sets.length) return res.status(400).json({ error: 'No fields' });
    vals.push(parseInt(req.params.id));
    try {
      const r = await db.query('UPDATE lg_freight_agents SET '+sets.join(',')+' WHERE id=$'+i+' RETURNING *', vals);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      res.json({ agent: r.rows[0] });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Create quote link(s): one per agent, all targeting the same plan list
  // Body: { plan_ids: [int], agent_ids: [int] }  → returns { links: [{token, agent_id, agent_name, agent_email, url_path}] }
  router.post('/links/quote', async function(req, res) {
    const db = req._db;
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Not allowed' });
    const planIds = Array.isArray(req.body && req.body.plan_ids) ? req.body.plan_ids.map(function(x){return parseInt(x);}).filter(function(n){return !isNaN(n);}) : [];
    const agentIds = Array.isArray(req.body && req.body.agent_ids) ? req.body.agent_ids.map(function(x){return parseInt(x);}).filter(function(n){return !isNaN(n);}) : [];
    if (!planIds.length || !agentIds.length) return res.status(400).json({ error: 'plan_ids and agent_ids required' });
    try {
      // Validate agents
      const agents = (await db.query('SELECT id, name, email, role, active FROM lg_freight_agents WHERE id = ANY($1::int[])', [agentIds])).rows;
      const bad = agents.filter(function(a){ return !a.active || (a.role !== 'quote' && a.role !== 'both'); });
      if (bad.length) return res.status(400).json({ error: 'One or more agents not active or not eligible for quotes: ' + bad.map(function(a){return a.name;}).join(', ') });
      if (agents.length !== agentIds.length) return res.status(400).json({ error: 'Unknown agent id(s)' });
      // Validate plans (must exist + active)
      const plans = (await db.query("SELECT id, plan_number FROM lg_plans WHERE id = ANY($1::int[]) AND status='active' AND closed_at IS NULL", [planIds])).rows;
      if (plans.length !== planIds.length) return res.status(400).json({ error: 'One or more plans not found or not active' });

      const links = [];
      for (const a of agents) {
        const token = crypto.randomBytes(16).toString('hex');
        await db.query(
          'INSERT INTO lg_links (token, kind, agent_id, plan_ids, created_by) VALUES ($1,$2,$3,$4,$5)',
          [token, 'quote', a.id, planIds, actor(req)]);
        for (const pid of planIds) {
          await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
            [pid, 'quote_link_created', 'Quote link issued to ' + a.name, actor(req)]);
        }
        links.push({ token: token, agent_id: a.id, agent_name: a.name, agent_email: a.email, url_path: '/q/' + token });
      }
      res.json({ links: links });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Create one delivery booking link to a single agent for a list of plans
  // Body: { plan_ids: [int], agent_id: int }  → returns { link: {token, agent_id, agent_name, agent_email, url_path} }
  router.post('/links/delivery', async function(req, res) {
    const db = req._db;
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Not allowed' });
    const planIds = Array.isArray(req.body && req.body.plan_ids) ? req.body.plan_ids.map(function(x){return parseInt(x);}).filter(function(n){return !isNaN(n);}) : [];
    const agentId = parseInt(req.body && req.body.agent_id);
    if (!planIds.length || isNaN(agentId)) return res.status(400).json({ error: 'plan_ids and agent_id required' });
    try {
      const a = (await db.query('SELECT id, name, email, role, active FROM lg_freight_agents WHERE id=$1', [agentId])).rows[0];
      if (!a) return res.status(400).json({ error: 'Unknown agent' });
      if (!a.active || (a.role !== 'delivery' && a.role !== 'both')) return res.status(400).json({ error: 'Agent not eligible for delivery booking' });
      const plans = (await db.query("SELECT id, plan_number FROM lg_plans WHERE id = ANY($1::int[]) AND status='active' AND closed_at IS NULL", [planIds])).rows;
      if (plans.length !== planIds.length) return res.status(400).json({ error: 'One or more plans not found or not active' });

      const token = crypto.randomBytes(16).toString('hex');
      await db.query(
        'INSERT INTO lg_links (token, kind, agent_id, plan_ids, created_by) VALUES ($1,$2,$3,$4,$5)',
        [token, 'delivery', a.id, planIds, actor(req)]);
      // r31h — persist delivery_agent_id on each plan so the dropdown on gate 9 reflects who was emailed.
      await db.query('UPDATE lg_plans SET delivery_agent_id=$1, updated_at=NOW() WHERE id = ANY($2::int[]) AND (delivery_agent_id IS NULL OR delivery_agent_id <> $1)',
        [a.id, planIds]);
      for (const pid of planIds) {
        await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
          [pid, 'delivery_link_created', 'Delivery booking link issued to ' + a.name, actor(req)]);
      }
      res.json({ link: { token: token, agent_id: a.id, agent_name: a.name, agent_email: a.email, url_path: '/q/' + token } });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // List quotes for a plan (manager/logistics) — for the Quotes tab on the stage drawer
  router.get('/plans/:id/quotes', async function(req, res) {
    const db = req._db;
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Not allowed' });
    try {
      const r = await db.query(
        `SELECT q.*, fa.name AS agent_name
         FROM lg_quotes q
         LEFT JOIN lg_freight_agents fa ON fa.id = q.agent_id
         WHERE q.plan_id = $1
         ORDER BY
           CASE q.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
           q.submitted_at DESC`,
        [parseInt(req.params.id)]);
      // Mark expired any pending past validity_date (display-only flag)
      const today = todayDate();
      const out = r.rows.map(function(q) {
        const expired = q.status === 'pending' && q.validity_date && String(q.validity_date).slice(0,10) < today;
        return Object.assign({}, q, { is_expired: !!expired });
      });
      res.json({ quotes: out });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Accept a quote (manager+). Fills plan fields, rejects sibling pending quotes.
  router.post('/quotes/:id/accept', async function(req, res) {
    const db = req._db;
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Not allowed' });
    try {
      const q = (await db.query('SELECT * FROM lg_quotes WHERE id=$1', [parseInt(req.params.id)])).rows[0];
      if (!q) return res.status(404).json({ error: 'Quote not found' });
      if (q.status !== 'pending') return res.status(400).json({ error: 'Quote is not pending (current: ' + q.status + ')' });
      const agent = (await db.query('SELECT id, name FROM lg_freight_agents WHERE id=$1', [q.agent_id])).rows[0];
      if (!agent) return res.status(400).json({ error: 'Agent missing' });
      const plan = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [q.plan_id])).rows[0];
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      // r31c — Build update with expanded fields. free_days no longer auto-set (DM/DT live on the quote only).
      const userName = actor(req);
      const userRole = ((req.user && req.user.role) || 'manager').toLowerCase();
      const updates = {
        shipper_name:        agent.name,
        freight_agent_id:    agent.id,
        container_price_usd: q.price,
        original_eta:        q.eta_date,
        etd_date:            q.etd_date,
        shipping_line:       q.shipping_line,
        arrival_port:        q.arrival_port
      };
      const sets = []; const vals = []; let i = 1;
      for (const f in updates) {
        if (updates[f] !== null && updates[f] !== undefined) {
          sets.push(f + '=$' + (i++));
          vals.push(updates[f]);
          // Audit each field change
          await logFieldAudit(db, plan.id, f, plan[f], updates[f], userName, userRole);
        }
      }
      vals.push(plan.id);
      if (sets.length) await db.query('UPDATE lg_plans SET ' + sets.join(',') + ', updated_at=NOW() WHERE id=$' + i, vals);

      // Mark this quote accepted
      await db.query("UPDATE lg_quotes SET status='accepted', decided_at=NOW(), decided_by=$1 WHERE id=$2", [userName, q.id]);
      // Reject other pending quotes for same plan
      await db.query("UPDATE lg_quotes SET status='rejected', decided_at=NOW(), decided_by=$1 WHERE plan_id=$2 AND id<>$3 AND status='pending'", [userName, plan.id, q.id]);

      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [plan.id, 'quote_accepted', 'Accepted quote from ' + agent.name + (q.price != null ? ' at $' + q.price : ''), userName]);
      await evaluateTasks(db, plan.id);

      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── r31e — EMAIL DRAFT + TRIGGER ENDPOINTS ─────────────────────────────────
  // Generates a Gmail compose URL for a given gate, returns it + the parts.
  // The frontend opens window.open(gmail_url) and then calls /email-triggered.
  router.post('/plans/:id/email-draft', async function(req, res) {
    const db = req._db;
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Not allowed' });
    try {
      const gate = parseInt((req.body && req.body.gate) || 0);
      // r31h — gate 9 added for freight-partner delivery booking. agent_id required for gate 9.
      // r31g — frontend gate numbering synced to backend. The import-agent send is gate 6.
      if (!gate || ![2,4,5,6,9].includes(gate)) return res.status(400).json({ error: 'gate must be 2, 4, 5, 6 or 9' });
      const planId = parseInt(req.params.id);
      const p = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [planId])).rows[0];
      if (!p) return res.status(404).json({ error: 'Plan not found' });
      // r31n item 13 — Kemballs route does not use a freight-partner delivery email at gate 9.
      //   For Kemballs plans, the route is: park → "Bring to warehouse" → local delivery booking
      //   handled differently (often direct phone/WeChat to the local agent). Server-level guard
      //   prevents the email being composed at all; frontend should also hide the button (UI work).
      if (gate === 9 && (p.disposition === 'kemballs' || p.disposition === 'campbells')) {
        return res.status(400).json({ error: 'Gate-9 freight-partner email not used for Kemballs route. Use "Bring to warehouse" from the Kemballs section.' });
      }
      const sup = p.supplier_id ? (await db.query('SELECT * FROM lg_suppliers WHERE id=$1', [p.supplier_id])).rows[0] : null;
      // r31h — freight agent lookup (gate 9 only)
      let freightAgent = null;
      if (gate === 9) {
        const agentId = parseInt((req.body && req.body.agent_id) || 0);
        if (!agentId) return res.status(400).json({ error: 'agent_id required for gate 9 freight-partner email' });
        freightAgent = (await db.query('SELECT id, name, email, role, active FROM lg_freight_agents WHERE id=$1', [agentId])).rows[0];
        if (!freightAgent) return res.status(400).json({ error: 'Freight agent not found' });
        if (!freightAgent.active || (freightAgent.role !== 'delivery' && freightAgent.role !== 'both')) {
          return res.status(400).json({ error: 'Freight agent not eligible for delivery booking' });
        }
      }

      const CC_FIXED = 'bobby@fksports.co.uk';
      const portalBase = (process.env.PUBLIC_APP_URL || 'https://app.fksports.co.uk').replace(/\/+$/, '');
      const planRef = p.plan_number;

      let to = '', subject = '', body = '', taskId = null, fileLinks = [];

      if (gate === 2) {
        to = (sup && sup.contact_email) || '';
        taskId = 'loading_date';
        subject = 'FK Sports — ' + planRef + ' — Approx loading date needed';
        body = 'Hi,\n\n'
             + 'For order ' + planRef + ', we need you to confirm the approximate loading date.\n\n'
             + 'Please open the link below (no login required):\n'
             + portalBase + '/s/' + p.supplier_share_token + '?task=' + taskId + '\n\n'
             + 'Thanks,\nFK Sports\n\n'
             + '— — —\n\n'
             + '您好，\n\n'
             + '关于订单 ' + planRef + '，请您确认大致装柜日期。\n\n'
             + '请打开以下链接（无需登录）：\n'
             + portalBase + '/s/' + p.supplier_share_token + '?task=' + taskId + '\n\n'
             + '谢谢，\nFK Sports\n';
      } else if (gate === 4) {
        to = (sup && sup.contact_email) || '';
        taskId = 'bl_docs';
        subject = 'FK Sports — ' + planRef + ' — BL & loading docs needed';
        body = 'Hi,\n\n'
             + 'For order ' + planRef + ', we need you to fill in the BL details and upload Final PI, BL, packing list and loading photos.\n\n'
             + 'Please open the link below (no login required):\n'
             + portalBase + '/s/' + p.supplier_share_token + '?task=' + taskId + '\n\n'
             + 'Thanks,\nFK Sports\n\n'
             + '— — —\n\n'
             + '您好，\n\n'
             + '关于订单 ' + planRef + '，请填写提单信息并上传最终PI、提单、装箱单和装柜照片。\n\n'
             + '请打开以下链接（无需登录）：\n'
             + portalBase + '/s/' + p.supplier_share_token + '?task=' + taskId + '\n\n'
             + '谢谢，\nFK Sports\n';
      } else if (gate === 5) {
        to = (sup && sup.contact_email) || '';
        taskId = 'telex';
        subject = 'FK Sports — ' + planRef + ' — Final payment & telex release';
        // r31k — Gate 5 email now asks for BOTH confirmations: payment received + telex released.
        //   They are normally answered together (telex is only issued once payment is received).
        body = 'Hi,\n\n'
             + 'For order ' + planRef + ', please confirm two things via the link below:\n\n'
             + '  1. Final payment received from FK Sports\n'
             + '  2. Telex release issued with the shipping line\n\n'
             + 'Open the link (no login required):\n'
             + portalBase + '/s/' + p.supplier_share_token + '?task=' + taskId + '\n\n'
             + 'Thanks,\nFK Sports\n\n'
             + '— — —\n\n'
             + '您好，\n\n'
             + '关于订单 ' + planRef + '，请通过以下链接确认两项：\n\n'
             + '  1. 已收到 FK Sports 的尾款\n'
             + '  2. 已与船公司办理电放\n\n'
             + '请打开以下链接（无需登录）：\n'
             + portalBase + '/s/' + p.supplier_share_token + '?task=' + taskId + '\n\n'
             + '谢谢，\nFK Sports\n';
      } else if (gate === 6) {
        // r31g — import-agent send. Was old frontend gate 7; now gate 6 per r30i + r31g sync.
        // Import agent — assemble file links with public tokens (ensure tokens exist)
        const IMPORT_AGENT_PRIMARY = 'imports@origin-logistics.com';
        const extras = p.import_agent_emails ? String(p.import_agent_emails).split(',').map(s => s.trim()).filter(Boolean) : [];
        const allTo = [IMPORT_AGENT_PRIMARY].concat(extras);
        to = allTo.join(', ');
        subject = 'FK Sports — ' + planRef + ' — BL + PI + PL + Shipping cost';

        // Find the 3 docs (pinned versions preferred)
        const filesRes = await db.query(
          "SELECT id, slot, filename, mime_type, pinned, public_token, public_token_expires_at, public_token_revoked_at FROM lg_plan_files WHERE plan_id=$1 AND deleted_at IS NULL AND slot IN ('bl','final_pi','packing_list') ORDER BY pinned DESC, uploaded_at DESC",
          [planId]);
        // One file per slot (the pinned/latest)
        const bySlot = {};
        for (const f of filesRes.rows) { if (!bySlot[f.slot]) bySlot[f.slot] = f; }

        // Ensure each has a valid public_token; mint if missing or expired
        const slotLabels = { bl: 'Bill of Lading', final_pi: 'Final PI', packing_list: 'Packing List' };
        const orderedSlots = ['bl', 'final_pi', 'packing_list'];
        const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);  // 30 days
        for (const slot of orderedSlots) {
          const f = bySlot[slot];
          if (!f) {
            fileLinks.push({ slot: slot, label: slotLabels[slot], filename: null, url: null, missing: true });
            continue;
          }
          const needsMint = !f.public_token
            || f.public_token_revoked_at
            || (f.public_token_expires_at && new Date(f.public_token_expires_at).getTime() < Date.now());
          let tok = f.public_token;
          if (needsMint) {
            tok = require('crypto').randomBytes(16).toString('hex');
            await db.query(
              `UPDATE lg_plan_files SET public_token=$1, public_token_expires_at=$2, public_token_revoked_at=NULL WHERE id=$3`,
              [tok, expiresAt, f.id]);
          }
          fileLinks.push({ slot: slot, label: slotLabels[slot], filename: f.filename, url: portalBase + '/f/' + tok + '?d=1', missing: false });
        }

        // Compose body
        const eta = p.new_eta || p.original_eta;
        const etaStr = eta ? new Date(eta).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        const ship = p.container_price_usd != null ? '$' + Number(p.container_price_usd).toLocaleString() : '—';
        const docLines = fileLinks.map(function(l){
          if (l.missing) return '  • ' + l.label + ' — (not yet uploaded)';
          // r31k — clearer "click to download" framing. Most email clients auto-detect URLs and
          //   render them as clickable links; the ?d=1 query param ensures browser downloads
          //   instead of showing inline preview when clicked.
          return '  • ' + l.label + ' (' + l.filename + ')\n    Download: ' + l.url;
        }).join('\n\n');

        body = 'Hi,\n\n'
             + 'Please find the documents for our order ' + planRef + ' below. Click each "Download" link to save the file.\n\n'
             + 'Plan: ' + planRef + '\n'
             + 'Container: ' + (p.container_number || '—') + '\n'
             + 'BL: ' + (p.bl_number || '—') + '\n'
             + 'ETA: ' + etaStr + '\n'
             + 'Shipping cost (USD): ' + ship + '\n\n'
             + 'Documents:\n\n' + docLines + '\n\n'
             + 'These download links are valid for 30 days. Please confirm receipt and let me know if anything is needed.\n\n'
             + 'Thanks,\nFK Sports\n';
      } else if (gate === 9) {
        // r31h — freight partner delivery booking. Needs a /q/<token> booking link.
        to = freightAgent.email || '';
        // Generate (or reuse) a booking link for this plan + agent
        const existingLink = (await db.query(
          "SELECT token FROM lg_links WHERE kind='delivery' AND agent_id=$1 AND plan_ids @> $2::int[] ORDER BY created_at DESC LIMIT 1",
          [freightAgent.id, [planId]]
        )).rows[0];
        let bookingToken;
        if (existingLink) {
          bookingToken = existingLink.token;
        } else {
          bookingToken = crypto.randomBytes(16).toString('hex');
          await db.query(
            'INSERT INTO lg_links (token, kind, agent_id, plan_ids, created_by) VALUES ($1,$2,$3,$4,$5)',
            [bookingToken, 'delivery', freightAgent.id, [planId], actor(req)]);
          await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
            [planId, 'delivery_link_created', 'Delivery booking link issued to ' + freightAgent.name, actor(req)]);
        }
        const bookingUrl = portalBase + '/q/' + bookingToken;
        const etaStr2 = (p.new_eta || p.original_eta) ? String(p.new_eta || p.original_eta).slice(0,10) : 'TBC';
        // r31k — Single clear destination value. Kemballs route delivery goes TO Kemballs depot
        //   (container stays there). FK warehouse only used for direct deliveries OR retrieval
        //   from Kemballs later. The freight agent only needs to know where they're driving to.
        const dest = (p.disposition === 'kemballs' || p.disposition === 'campbells') ? 'Kemballs depot' : 'FK Sports warehouse';
        subject = 'FK Sports — ' + planRef + ' — Delivery booking';
        body = 'Hi ' + freightAgent.name + ',\n\n'
             + 'Please book delivery for the following container:\n\n'
             + 'Plan: ' + planRef + '\n'
             + 'Supplier: ' + ((sup && sup.name) || '—') + '\n'
             + 'Container: ' + (p.container_number || '—') + '\n'
             + 'BL: ' + (p.bl_number || '—') + '\n'
             + 'ETA: ' + etaStr2 + '\n'
             + 'Destination: ' + dest + '\n\n'
             + 'Please confirm your delivery date and transport reference via the link below:\n'
             + bookingUrl + '\n\n'
             + 'Thanks,\nFK Sports\n';
      }

      // Build Gmail compose URL
      const params = new URLSearchParams();
      params.set('view', 'cm');
      params.set('fs', '1');
      if (to) params.set('to', to);
      params.set('cc', CC_FIXED);
      params.set('su', subject);
      params.set('body', body);
      const gmailUrl = 'https://mail.google.com/mail/?' + params.toString();

      res.json({ gate: gate, to: to, cc: CC_FIXED, subject: subject, body: body, files: fileLinks, gmail_url: gmailUrl });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Log the email send + (for gate 7) auto-set docs_sent_to_import_agent_date
  router.post('/plans/:id/email-triggered', async function(req, res) {
    const db = req._db;
    if (!isLogisticsAllowed(req.user)) return res.status(403).json({ error: 'Not allowed' });
    try {
      const gate = parseInt((req.body && req.body.gate) || 0);
      // r31h — gate 9 added for freight-partner delivery booking email.
      // r31g — gate 6 = import-agent send (was 7).
      if (!gate || ![2,4,5,6,9].includes(gate)) return res.status(400).json({ error: 'gate must be 2, 4, 5, 6 or 9' });
      const planId = parseInt(req.params.id);
      const p = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [planId])).rows[0];
      if (!p) return res.status(404).json({ error: 'Plan not found' });
      const userName = actor(req);
      const userRole = ((req.user && req.user.role) || 'agent').toLowerCase();

      const gateLabels = { 2: 'Loading date', 4: 'BL & docs', 5: 'Telex', 6: 'Docs to import agent', 9: 'Delivery booking' };
      await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
        [planId, 'email_triggered', 'Email opened in Gmail — ' + gateLabels[gate] + ' (gate ' + gate + ')', userName]);

      // r31g — gate 6 (was 7): auto-set docs_sent_to_import_agent_date if not already set
      if (gate === 6 && !p.docs_sent_to_import_agent_date) {
        const today = todayDate();
        await db.query("UPDATE lg_plans SET docs_sent_to_import_agent_date=$1, updated_at=NOW() WHERE id=$2", [today, planId]);
        await logFieldAudit(db, planId, 'docs_sent_to_import_agent_date', null, today, userName, userRole);
        await evaluateTasks(db, planId);
      }

      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── PUBLIC AGENT PORTAL ROUTER (no auth) — mounted at /q in server.js ──────
  const agentPublic = express.Router();
  agentPublic.use(async function(req, res, next) { await bootIfReady(); next(); });

  // HTML page
  agentPublic.get('/:token', async function(req, res) {
    res.sendFile(path.join(__dirname, '..', 'public', 'agent.html'));
  });

  // Data for the page
  agentPublic.get('/api/:token', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const link = (await db.query('SELECT * FROM lg_links WHERE token=$1', [req.params.token])).rows[0];
      if (!link) return res.status(404).json({ error: 'Invalid link' });
      const agent = (await db.query('SELECT id, name, email, role FROM lg_freight_agents WHERE id=$1', [link.agent_id])).rows[0];
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      // Fetch the relevant plan info — strictly what's needed for this kind
      let plans = [];
      if (link.kind === 'quote') {
        plans = (await db.query(
          `SELECT p.id, p.plan_number, p.supplier_order_ref,
                  p.approx_loading_date, p.actual_loading_date,
                  p.loading_port,
                  s.name AS supplier_name
           FROM lg_plans p
           LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
           WHERE p.id = ANY($1::int[])
           ORDER BY p.plan_number`,
          [link.plan_ids])).rows;
      } else if (link.kind === 'delivery') {
        plans = (await db.query(
          `SELECT p.id, p.plan_number, p.supplier_order_ref,
                  p.container_number, p.bl_number,
                  p.original_eta, p.new_eta,
                  p.disposition,
                  p.local_delivery_booked_date, p.local_delivery_partner,
                  p.kemballs_retrieval_booked_date, p.kemballs_retrieval_partner,
                  s.name AS supplier_name
           FROM lg_plans p
           LEFT JOIN lg_suppliers s ON s.id = p.supplier_id
           WHERE p.id = ANY($1::int[])
           ORDER BY p.plan_number`,
          [link.plan_ids])).rows;
      }
      // For quote kind, also fetch any prior quotes BY THIS AGENT for these plans (so they see what they submitted before)
      let priorQuotes = [];
      if (link.kind === 'quote') {
        priorQuotes = (await db.query(
          'SELECT id, plan_id, route, etd_date, eta_date, transit_time_days, demurrage_days, detention_days, shipping_line, arrival_port, price, currency, validity_date, notes, status, submitted_at FROM lg_quotes WHERE agent_id=$1 AND plan_id = ANY($2::int[]) ORDER BY submitted_at ASC',
          [link.agent_id, link.plan_ids])).rows;
      }
      res.json({
        kind: link.kind,
        agent: { name: agent.name },
        plans: plans,
        prior_quotes: priorQuotes
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Submission
  // Body for quote:    { rows: [{plan_id, route, eta_date, free_days, price, validity_date, notes}] }
  // Body for delivery: { rows: [{plan_id, delivery_date, transport_ref, driver, notes}] }
  agentPublic.post('/api/:token', async function(req, res) {
    const db = getDb && getDb();
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    try {
      const link = (await db.query('SELECT * FROM lg_links WHERE token=$1', [req.params.token])).rows[0];
      if (!link) return res.status(404).json({ error: 'Invalid link' });
      const agent = (await db.query('SELECT id, name FROM lg_freight_agents WHERE id=$1', [link.agent_id])).rows[0];
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
      if (!rows.length) return res.status(400).json({ error: 'No rows' });

      const allowedPlans = new Set(link.plan_ids.map(function(n){return parseInt(n);}));
      const submittedBy = 'agent:' + agent.name;
      const submittedByRole = 'freight_agent';
      const accepted = []; const skipped = [];

      if (link.kind === 'quote') {
        for (const r of rows) {
          const pid = parseInt(r.plan_id);
          if (!allowedPlans.has(pid)) { skipped.push({plan_id: pid, reason: 'plan not in link'}); continue; }
          // r31c — Skip rows that are entirely empty (new fields included)
          const meaningfulFields = ['shipping_line','arrival_port','etd_date','eta_date','transit_time_days','demurrage_days','detention_days','price','validity_date','notes','route'];
          const hasAny = meaningfulFields.some(function(k){ return r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== ''; });
          if (!hasAny) { skipped.push({plan_id: pid, reason: 'empty'}); continue; }
          const price    = r.price === '' || r.price == null ? null : parseFloat(r.price);
          const tt       = r.transit_time_days === '' || r.transit_time_days == null ? null : parseInt(r.transit_time_days);
          const dm       = r.demurrage_days     === '' || r.demurrage_days     == null ? null : parseInt(r.demurrage_days);
          const dt       = r.detention_days     === '' || r.detention_days     == null ? null : parseInt(r.detention_days);
          await db.query(
            `INSERT INTO lg_quotes (plan_id, agent_id, link_token, route, etd_date, eta_date, transit_time_days, demurrage_days, detention_days, shipping_line, arrival_port, price, currency, validity_date, notes, status, submitted_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'USD',$13,$14,'pending',NOW())`,
            [pid, agent.id, link.token, r.route || null, r.etd_date || null, r.eta_date || null, tt, dm, dt, r.shipping_line || null, r.arrival_port || null, price, r.validity_date || null, r.notes || null]);
          const summary = [agent.name];
          if (r.shipping_line) summary.push('via ' + r.shipping_line);
          if (r.arrival_port) summary.push('→ ' + r.arrival_port);
          if (price != null) summary.push('$' + price);
          await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
            [pid, 'quote_submitted', 'Quote received from ' + summary.join(' · '), submittedBy]);
          accepted.push(pid);
        }
      } else if (link.kind === 'delivery') {
        for (const r of rows) {
          const pid = parseInt(r.plan_id);
          if (!allowedPlans.has(pid)) { skipped.push({plan_id: pid, reason: 'plan not in link'}); continue; }
          const hasAny = ['delivery_date','transport_ref','driver','notes'].some(function(k){ return r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== ''; });
          if (!hasAny) { skipped.push({plan_id: pid, reason: 'empty'}); continue; }
          // Determine partner field based on plan disposition
          const plan = (await db.query('SELECT * FROM lg_plans WHERE id=$1', [pid])).rows[0];
          if (!plan) { skipped.push({plan_id: pid, reason: 'plan not found'}); continue; }
          // Compose notes augmenting transport ref + driver into shipping_notes (no dedicated columns)
          const detail = [];
          if (r.transport_ref) detail.push('Transport ref: ' + r.transport_ref);
          if (r.driver) detail.push('Driver/contact: ' + r.driver);
          if (r.notes) detail.push(r.notes);
          const combinedNote = detail.join(' · ');
          if (plan.disposition === 'kemballs' || plan.disposition === 'campbells') {
            const updates = {
              kemballs_retrieval_partner:   agent.name,
              kemballs_retrieval_booked_date: r.delivery_date || null,
              delivery_agent_id:             agent.id
            };
            const sets = []; const vals = []; let i = 1;
            for (const f in updates) {
              if (updates[f] !== null && updates[f] !== undefined) {
                sets.push(f + '=$' + (i++));
                vals.push(updates[f]);
                await logFieldAudit(db, pid, f, plan[f], updates[f], submittedBy, submittedByRole);
              }
            }
            vals.push(pid);
            if (sets.length) await db.query('UPDATE lg_plans SET ' + sets.join(',') + ', updated_at=NOW() WHERE id=$' + i, vals);
          } else {
            const updates = {
              local_delivery_partner:     agent.name,
              local_delivery_booked_date: r.delivery_date || null,
              delivery_agent_id:          agent.id
            };
            const sets = []; const vals = []; let i = 1;
            for (const f in updates) {
              if (updates[f] !== null && updates[f] !== undefined) {
                sets.push(f + '=$' + (i++));
                vals.push(updates[f]);
                await logFieldAudit(db, pid, f, plan[f], updates[f], submittedBy, submittedByRole);
              }
            }
            vals.push(pid);
            if (sets.length) await db.query('UPDATE lg_plans SET ' + sets.join(',') + ', updated_at=NOW() WHERE id=$' + i, vals);
          }
          // r31h — fix: transport_ref + driver + notes from freight partner used to only land in activity log,
          //   never on the plan itself. Now appended to remarks so Bobby actually sees the booking detail.
          if (combinedNote) {
            const dateStamp = todayDate();
            const noteLine = '[' + dateStamp + ' · ' + agent.name + '] ' + combinedNote;
            const existingRemarks = (plan.remarks || '').trim();
            const newRemarks = existingRemarks ? (existingRemarks + '\n' + noteLine) : noteLine;
            await db.query('UPDATE lg_plans SET remarks=$1, updated_at=NOW() WHERE id=$2', [newRemarks, pid]);
            await logFieldAudit(db, pid, 'remarks', plan.remarks || null, newRemarks, submittedBy, submittedByRole);
          }
          await db.query('INSERT INTO lg_activity (plan_id, action, detail, actor_name) VALUES ($1,$2,$3,$4)',
            [pid, 'delivery_booked', 'Delivery booked by ' + agent.name + (combinedNote ? ' · ' + combinedNote : ''), submittedBy]);
          await evaluateTasks(db, pid);
          accepted.push(pid);
        }
      } else {
        return res.status(400).json({ error: 'Unknown link kind' });
      }

      res.json({ ok: true, accepted: accepted, skipped: skipped });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router._agentShare = agentPublic;

  return router;
};
