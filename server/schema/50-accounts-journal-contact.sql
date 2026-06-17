-- r1.36 (small-Xero) — Who/Why on coding.
-- A journal can carry an optional contact (the "Who" when coding a bank line),
-- enabling supplier/customer spend views later. The "Why" rides in narration.
ALTER TABLE acc_journal ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES acc_contact(id);
