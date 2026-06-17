-- r1.32 (Ship 2) — settlement tracking for reconcile.
-- When a bank line settles an invoice/bill, we mark the doc 'paid' and remember
-- the settlement journal so the reconcile "Undo" can reverse it cleanly.
-- ('paid' is already an allowed status on both tables; we only add the link.)

ALTER TABLE acc_invoice ADD COLUMN IF NOT EXISTS settled_journal_id INTEGER REFERENCES acc_journal(id);
ALTER TABLE acc_bill    ADD COLUMN IF NOT EXISTS settled_journal_id INTEGER REFERENCES acc_journal(id);

CREATE INDEX IF NOT EXISTS idx_acc_invoice_settle ON acc_invoice(settled_journal_id) WHERE settled_journal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acc_bill_settle    ON acc_bill(settled_journal_id)    WHERE settled_journal_id IS NOT NULL;
