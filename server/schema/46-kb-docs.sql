-- r1.29 — Knowledge Base downloadable documents (PDFs) stored as bytea, the
-- same file-storage pattern the rest of FK Home uses. Seeded from server/kb-files/.
CREATE TABLE IF NOT EXISTS lms_kb_docs (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  department TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/pdf',
  data BYTEA NOT NULL,
  byte_size INTEGER,
  verified_on DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
