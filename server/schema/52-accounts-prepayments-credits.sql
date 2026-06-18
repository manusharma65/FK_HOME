-- r1.46 — Prepayments / contact credits + a settlement ledger.
--
-- Two ideas:
--  1. A bill/invoice is now whittled down by a LEDGER of settlements (acc_settlement)
--     rather than one all-or-nothing payment. Each cash payment OR applied credit is
--     a row; outstanding = payable − SUM(settlements). The doc flips to 'paid' only
--     when outstanding hits zero. This is what makes split payments (rent to landlord
--     + GST to authorities) reconcile against ONE bill.
--  2. A prepayment / credit note sits as available credit AGAINST A CONTACT
--     (acc_credit). When a bill for that contact is open, the credit can be applied
--     manually — Dr AP, Cr Prepayments — no cash moves. Single Prepayments control
--     account (1300); per-contact balance is tracked in acc_credit.

-- Single control account for both supplier advances (debit) and customer deposits (credit).
INSERT INTO acc_account (code, name, type, system_tag, sort)
VALUES ('1300', 'Prepayments', 'asset', 'prepayments', 35)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS acc_credit (
  id               SERIAL PRIMARY KEY,
  contact_id       INTEGER NOT NULL REFERENCES acc_contact(id),
  kind             TEXT NOT NULL CHECK (kind IN ('supplier','customer')),
  credit_date      DATE NOT NULL,
  amount           NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  remaining_amount NUMERIC(16,2) NOT NULL CHECK (remaining_amount >= 0),
  source_type      TEXT NOT NULL CHECK (source_type IN ('prepayment','credit_note')),
  bank_line_id     INTEGER REFERENCES acc_bank_line(id),
  journal_id       INTEGER REFERENCES acc_journal(id),
  narration        TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','void')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acc_credit_contact ON acc_credit(contact_id, kind) WHERE status = 'open';

-- One row per cash payment OR applied credit against a bill/invoice.
CREATE TABLE IF NOT EXISTS acc_settlement (
  id            SERIAL PRIMARY KEY,
  target_type   TEXT NOT NULL CHECK (target_type IN ('bill','invoice')),
  target_id     INTEGER NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('bank','credit')),
  bank_line_id  INTEGER REFERENCES acc_bank_line(id),
  credit_id     INTEGER REFERENCES acc_credit(id),
  amount        NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  journal_id    INTEGER REFERENCES acc_journal(id),
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acc_settlement_target ON acc_settlement(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_acc_settlement_bankline ON acc_settlement(bank_line_id) WHERE bank_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acc_settlement_credit ON acc_settlement(credit_id) WHERE credit_id IS NOT NULL;
