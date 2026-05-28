-- ============================================================================
-- FK Home — Section 2b: Attendance records (HR foundation)
-- ============================================================================
-- Tables: lateness_log, sick_log
--
-- Purpose: persistent record of every lateness + sick report.
-- Used later by HR view + performance reports.
-- These tables are written automatically when an agent uses the
-- "Running late?" or "Report sick" flow on My FK Space.
--
-- Note: r0.9 removed the duplicate definitions from 02-presence.sql so the
-- old DROP TABLE preamble below is no longer needed. These are now the only
-- definitions of these tables.
-- ============================================================================

-- ---------- lateness_log ----------
CREATE TABLE IF NOT EXISTS lateness_log (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  reported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reported_by_user_id INTEGER REFERENCES users(id),
  for_date        DATE NOT NULL,
  estimated_arrival TEXT,
  actual_arrival  TIMESTAMPTZ,
  reason          TEXT,
  hr_status       TEXT NOT NULL DEFAULT 'pending'
                  CHECK (hr_status IN ('pending','confirmed','excused')),
  hr_notes        TEXT,
  hr_reviewed_by_user_id INTEGER REFERENCES users(id),
  hr_reviewed_at  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lateness_log_user_date ON lateness_log(user_id, for_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lateness_log_status ON lateness_log(hr_status, for_date DESC) WHERE deleted_at IS NULL;

-- ---------- sick_log ----------
CREATE TABLE IF NOT EXISTS sick_log (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  reported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reported_by_user_id INTEGER REFERENCES users(id),
  start_date      DATE NOT NULL,
  end_date        DATE,
  reason          TEXT,
  hr_status       TEXT NOT NULL DEFAULT 'pending'
                  CHECK (hr_status IN ('pending','confirmed','excused')),
  hr_notes        TEXT,
  hr_reviewed_by_user_id INTEGER REFERENCES users(id),
  hr_reviewed_at  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sick_log_user_date ON sick_log(user_id, start_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sick_log_status ON sick_log(hr_status, start_date DESC) WHERE deleted_at IS NULL;

-- ---------- triggers ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lateness_log_updated_at') THEN
    CREATE TRIGGER trg_lateness_log_updated_at BEFORE UPDATE ON lateness_log
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sick_log_updated_at') THEN
    CREATE TRIGGER trg_sick_log_updated_at BEFORE UPDATE ON sick_log
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
END $$;
