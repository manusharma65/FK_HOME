-- r1.33 (small-Xero) — editable chart of accounts.

-- Chart of accounts gains Xero-style fields: an optional description and a
-- default tax treatment used to pre-fill GST when coding/billing to the account.
ALTER TABLE acc_account ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE acc_account ADD COLUMN IF NOT EXISTS tax_default TEXT NOT NULL DEFAULT 'none'
  CHECK (tax_default IN ('none','gst18','gst12','gst5','zero'));
