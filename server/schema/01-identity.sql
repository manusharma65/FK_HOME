-- ============================================================================
-- FK Home — Section 1: Identity & access
-- ============================================================================
-- Tables: departments, users, user_department_memberships, groups,
--         permissions, group_permissions, user_groups, user_sessions, audit_log
-- ============================================================================

-- ---------- departments ----------
CREATE TABLE IF NOT EXISTS departments (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  colour          TEXT,
  icon            TEXT,
  home_module     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active) WHERE deleted_at IS NULL;

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id                      SERIAL PRIMARY KEY,
  email                   TEXT NOT NULL UNIQUE,
  password_hash           TEXT NOT NULL,
  full_name               TEXT NOT NULL,
  display_name            TEXT,
  initials                TEXT,
  avatar_url              TEXT,
  avatar_colour           TEXT,
  phone                   TEXT,
  timezone                TEXT NOT NULL DEFAULT 'Europe/London',
  hire_date               DATE,
  employment_status       TEXT NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','on_leave','left')),
  must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at           TIMESTAMPTZ,
  last_password_change_at TIMESTAMPTZ,
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_active ON users(employment_status) WHERE deleted_at IS NULL;

-- ---------- user_department_memberships ----------
CREATE TABLE IF NOT EXISTS user_department_memberships (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  department_id   INTEGER NOT NULL REFERENCES departments(id),
  role            TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent','lead','manager')),
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_udm_user ON user_department_memberships(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_udm_dept ON user_department_memberships(department_id) WHERE deleted_at IS NULL;

-- ---------- groups ----------
CREATE TABLE IF NOT EXISTS groups (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- permissions ----------
CREATE TABLE IF NOT EXISTS permissions (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  module          TEXT NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);

-- ---------- group_permissions ----------
CREATE TABLE IF NOT EXISTS group_permissions (
  group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  permission_id   INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, permission_id)
);

-- ---------- user_groups ----------
CREATE TABLE IF NOT EXISTS user_groups (
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_ug_user ON user_groups(user_id);

-- ---------- user_sessions ----------
CREATE TABLE IF NOT EXISTS user_sessions (
  token           TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);

-- ---------- audit_log ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id   INTEGER REFERENCES users(id),
  actor_name      TEXT,
  module          TEXT NOT NULL,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  before_data     JSONB,
  after_data      JSONB,
  details         TEXT,
  ip_address      TEXT,
  user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_module_action ON audit_log(module, action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id, occurred_at DESC);

-- ---------- shared trigger function ----------
CREATE OR REPLACE FUNCTION fk_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_departments_updated_at') THEN
    CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON departments
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_udm_updated_at') THEN
    CREATE TRIGGER trg_udm_updated_at BEFORE UPDATE ON user_department_memberships
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_groups_updated_at') THEN
    CREATE TRIGGER trg_groups_updated_at BEFORE UPDATE ON groups
      FOR EACH ROW EXECUTE FUNCTION fk_set_updated_at();
  END IF;
END $$;
