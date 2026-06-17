-- r1.41 — file attachments for accounting (bills, invoices, bank lines).
-- One row attaches exactly one file to exactly one target.
CREATE TABLE IF NOT EXISTS acc_attachment (
  id            SERIAL PRIMARY KEY,
  bill_id       INTEGER REFERENCES acc_bill(id)      ON DELETE CASCADE,
  invoice_id    INTEGER REFERENCES acc_invoice(id)   ON DELETE CASCADE,
  bank_line_id  INTEGER REFERENCES acc_bank_line(id) ON DELETE CASCADE,
  filename      TEXT    NOT NULL,
  mime_type     TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  content       BYTEA   NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT acc_attachment_one_target CHECK (num_nonnulls(bill_id, invoice_id, bank_line_id) = 1)
);
CREATE INDEX IF NOT EXISTS idx_acc_att_bill     ON acc_attachment(bill_id)      WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acc_att_invoice  ON acc_attachment(invoice_id)   WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acc_att_bankline ON acc_attachment(bank_line_id) WHERE bank_line_id IS NOT NULL;
