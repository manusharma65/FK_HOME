-- ============================================================================
-- FK Home — r1.32 (Ship 1): FK Enterprises India bookkeeping — double-entry core
-- ============================================================================
-- Internal books for FK Enterprises (India entity that bills FK Sports UK).
-- Base currency INR; GBP invoices booked to INR at a captured rate (FX on
-- settlement). The UI is bills/invoices/reconcile — NO debit/credit shown to
-- the user — but every posting writes balanced journal lines underneath so the
-- trial balance, P&L and balance sheet are real, and the CA gets clean
-- registers. Records are never silently deleted: draft -> post -> void/reverse,
-- and a filed month is locked.
--
-- ADDITIVE + idempotent. Touches nothing outside the acc_* namespace. Reuses
-- the existing audit_log via logAudit() in the module (no audit table here).
-- ============================================================================

-- ---------- Chart of accounts ----------
CREATE TABLE IF NOT EXISTS acc_account (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  -- engine looks up control accounts by tag, never by name (rename-safe)
  system_tag  TEXT UNIQUE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Contacts (suppliers + customers) ----------
CREATE TABLE IF NOT EXISTS acc_contact (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'supplier' CHECK (kind IN ('supplier','customer','both')),
  gstin       TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Journal (entry header) ----------
CREATE TABLE IF NOT EXISTS acc_journal (
  id                  SERIAL PRIMARY KEY,
  entry_date          DATE NOT NULL,
  period              TEXT GENERATED ALWAYS AS (
                        EXTRACT(YEAR FROM entry_date)::int::text || '-' ||
                        lpad(EXTRACT(MONTH FROM entry_date)::int::text, 2, '0')
                      ) STORED,
  narration           TEXT,
  source_type         TEXT NOT NULL CHECK (source_type IN ('opening','bill','invoice','bank','manual','fx','reversal')),
  source_id           INTEGER,
  status              TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed','reversal')),
  reverses_journal_id INTEGER REFERENCES acc_journal(id),
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acc_journal_period ON acc_journal(period);
CREATE INDEX IF NOT EXISTS idx_acc_journal_source ON acc_journal(source_type, source_id);

-- ---------- Journal lines (always INR; one side each) ----------
CREATE TABLE IF NOT EXISTS acc_journal_line (
  id          SERIAL PRIMARY KEY,
  journal_id  INTEGER NOT NULL REFERENCES acc_journal(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES acc_account(id),
  debit       NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit      NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo        TEXT,
  currency    TEXT NOT NULL DEFAULT 'INR',
  fx_rate     NUMERIC(14,6),
  orig_amount NUMERIC(16,2),
  CONSTRAINT acc_line_one_side CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT acc_line_nonzero  CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX IF NOT EXISTS idx_acc_line_journal ON acc_journal_line(journal_id);
CREATE INDEX IF NOT EXISTS idx_acc_line_account ON acc_journal_line(account_id);

-- ---------- Period lock (a filed month freezes) ----------
CREATE TABLE IF NOT EXISTS acc_period_lock (
  period    TEXT PRIMARY KEY,                 -- 'YYYY-MM'
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by INTEGER REFERENCES users(id),
  note      TEXT
);

-- ---------- Purchase bills ----------
CREATE TABLE IF NOT EXISTS acc_bill (
  id                  SERIAL PRIMARY KEY,
  contact_id          INTEGER REFERENCES acc_contact(id),
  bill_date           DATE NOT NULL,
  due_date            DATE,
  category_account_id INTEGER REFERENCES acc_account(id),   -- the expense account
  currency            TEXT NOT NULL DEFAULT 'INR',
  fx_rate             NUMERIC(14,6) NOT NULL DEFAULT 1,
  taxable_amount      NUMERIC(16,2) NOT NULL,
  gst_rate            NUMERIC(6,3) NOT NULL DEFAULT 0,
  gst_amount          NUMERIC(16,2) NOT NULL DEFAULT 0,
  tds_section         TEXT,
  tds_rate            NUMERIC(6,3) NOT NULL DEFAULT 0,
  tds_amount          NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_payable         NUMERIC(16,2) NOT NULL DEFAULT 0,      -- taxable + gst - tds
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid','void','reversed')),
  journal_id          INTEGER REFERENCES acc_journal(id),
  pdf_file_id         INTEGER,                               -- bytea file via files module
  notes               TEXT,
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_acc_bill_status ON acc_bill(status);

-- ---------- Sales invoices ----------
CREATE TABLE IF NOT EXISTS acc_invoice (
  id             SERIAL PRIMARY KEY,
  contact_id     INTEGER REFERENCES acc_contact(id),
  invoice_date   DATE NOT NULL,
  due_date       DATE,
  tax_treatment  TEXT NOT NULL DEFAULT 'export_zero' CHECK (tax_treatment IN ('export_zero','domestic_gst')),
  currency       TEXT NOT NULL DEFAULT 'INR',
  fx_rate        NUMERIC(14,6) NOT NULL DEFAULT 1,
  taxable_amount NUMERIC(16,2) NOT NULL,                     -- in invoice currency
  gst_rate       NUMERIC(6,3) NOT NULL DEFAULT 0,
  gst_amount     NUMERIC(16,2) NOT NULL DEFAULT 0,
  amount_inr     NUMERIC(16,2) NOT NULL DEFAULT 0,           -- (taxable+gst) * fx_rate
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','sent','paid','void','reversed')),
  journal_id     INTEGER REFERENCES acc_journal(id),
  pdf_file_id    INTEGER,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_acc_invoice_status ON acc_invoice(status);

-- ---------- Bank statement imports (IDFC CSV) ----------
CREATE TABLE IF NOT EXISTS acc_bank_import (
  id          SERIAL PRIMARY KEY,
  filename    TEXT,
  hash        TEXT UNIQUE,          -- whole-file hash: blocks re-importing the same statement
  period_from DATE,
  period_to   DATE,
  row_count   INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS acc_bank_line (
  id                SERIAL PRIMARY KEY,
  import_id         INTEGER NOT NULL REFERENCES acc_bank_import(id) ON DELETE CASCADE,
  txn_date          DATE NOT NULL,
  description       TEXT,
  ref               TEXT,
  amount            NUMERIC(16,2) NOT NULL,    -- signed: + received, - spent
  running_balance   NUMERIC(16,2),
  row_hash          TEXT,                      -- per-line hash: belt-and-braces dedupe
  status            TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  matched_journal_id INTEGER REFERENCES acc_journal(id),
  match_type        TEXT,                      -- 'bill' | 'invoice' | 'manual'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acc_bank_line_status ON acc_bank_line(status);
CREATE INDEX IF NOT EXISTS idx_acc_bank_line_import ON acc_bank_line(import_id);

-- ---------- Balance guard: the DB itself refuses an unbalanced journal ----------
-- Deferred constraint trigger: validates at COMMIT, after all lines of a journal
-- have been inserted within the transaction. Sum(debit) must equal sum(credit).
CREATE OR REPLACE FUNCTION acc_check_journal_balanced() RETURNS trigger AS $$
DECLARE jid INTEGER; d NUMERIC; c NUMERIC;
BEGIN
  jid := COALESCE(NEW.journal_id, OLD.journal_id);
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c
    FROM acc_journal_line WHERE journal_id = jid;
  IF round(d,2) <> round(c,2) THEN
    RAISE EXCEPTION 'acc: journal % unbalanced (debits=%, credits=%)', jid, d, c;
  END IF;
  RETURN NULL;
END$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS acc_journal_balance_chk ON acc_journal_line;
CREATE CONSTRAINT TRIGGER acc_journal_balance_chk
  AFTER INSERT OR UPDATE OR DELETE ON acc_journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION acc_check_journal_balanced();

-- ---------- Lock guard: no NEW posting into a locked period ----------
-- A reversal/correction always posts into an OPEN period (today), so locked
-- history stays exactly as filed.
CREATE OR REPLACE FUNCTION acc_check_period_open() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM acc_period_lock WHERE period = to_char(NEW.entry_date,'YYYY-MM')) THEN
    RAISE EXCEPTION 'acc: period % is locked (filed) — post the correction into the current open month', to_char(NEW.entry_date,'YYYY-MM');
  END IF;
  RETURN NEW;
END$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS acc_journal_period_chk ON acc_journal;
CREATE TRIGGER acc_journal_period_chk
  BEFORE INSERT ON acc_journal
  FOR EACH ROW EXECUTE FUNCTION acc_check_period_open();
