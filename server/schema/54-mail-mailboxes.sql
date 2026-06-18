-- 54-mail-mailboxes.sql
-- FK Home — shared / department mailboxes, aliases, routing rules, and access grants.
-- Extends personal mail (mailbox_id IS NULL) with shared department inboxes
-- (e.g. HR, Accounts, Customer Service). Idempotent — safe to run repeatedly.

-- Shared / department mailboxes. The Gmail address is impersonated via the
-- existing service account + domain-wide delegation (same mechanism as personal mail).
CREATE TABLE IF NOT EXISTS mail_mailboxes (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  gmail_address   TEXT NOT NULL,
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mail_mailboxes_dept
  ON mail_mailboxes(department_id) WHERE is_active = TRUE;

-- Email aliases that route into a mailbox (e.g. info@, support@).
CREATE TABLE IF NOT EXISTS mail_mailbox_aliases (
  id              SERIAL PRIMARY KEY,
  mailbox_id      INTEGER NOT NULL REFERENCES mail_mailboxes(id) ON DELETE CASCADE,
  alias_address   TEXT NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (alias_address)
);
CREATE INDEX IF NOT EXISTS idx_mail_aliases_mailbox ON mail_mailbox_aliases(mailbox_id);

-- Routing rules — match inbound mail to a mailbox (admin-configured).
-- match_type: to | from | subject | alias
CREATE TABLE IF NOT EXISTS mail_routing_rules (
  id              SERIAL PRIMARY KEY,
  mailbox_id      INTEGER NOT NULL REFERENCES mail_mailboxes(id) ON DELETE CASCADE,
  match_type      TEXT NOT NULL CHECK (match_type IN ('to', 'from', 'subject', 'alias')),
  match_value     TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 100,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mail_routing_mailbox ON mail_routing_rules(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_mail_routing_active ON mail_routing_rules(is_active, priority);

-- Explicit per-user grants (overrides / cross-department access).
CREATE TABLE IF NOT EXISTS mail_mailbox_access (
  mailbox_id      INTEGER NOT NULL REFERENCES mail_mailboxes(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_read        BOOLEAN NOT NULL DEFAULT TRUE,
  can_send        BOOLEAN NOT NULL DEFAULT FALSE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mailbox_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_access_user ON mail_mailbox_access(user_id);

-- Scope personal labels / message-labels / notes to a mailbox when set.
ALTER TABLE mail_labels         ADD COLUMN IF NOT EXISTS mailbox_id INTEGER REFERENCES mail_mailboxes(id) ON DELETE CASCADE;
ALTER TABLE mail_message_labels ADD COLUMN IF NOT EXISTS mailbox_id INTEGER REFERENCES mail_mailboxes(id) ON DELETE CASCADE;
ALTER TABLE mail_notes          ADD COLUMN IF NOT EXISTS mailbox_id INTEGER REFERENCES mail_mailboxes(id) ON DELETE CASCADE;

-- Seed starter shared mailboxes for the real departments.
-- Seeded INACTIVE on purpose: switch each one on only once its Gmail address
-- exists in Google Workspace and is covered by the service-account delegation.
-- To activate later:  UPDATE mail_mailboxes
--                     SET gmail_address = 'real@address', is_active = TRUE
--                     WHERE slug = 'hr';
INSERT INTO mail_mailboxes (slug, display_name, gmail_address, department_id, description, sort_order, is_active)
SELECT v.slug, v.display_name, v.gmail, d.id, v.description, v.sort_order, FALSE
FROM (VALUES
  ('info',         'Info (Customer Service)', 'info@fksports.co.uk',        'cs',        'Customer service main inbox',   1),
  ('fitnesskarma', 'Fitness Karma',           'fitnesskarmaltd@gmail.com',  'cs',        'Fitness Karma shared inbox',    2),
  ('accounts',     'Accounts',                'accounts@fksports.co.uk',    'accounts',  'Accounts inbox',                3),
  ('hr',           'HR',                      'hr@fksports.co.uk',          'hr',        'Human resources inbox',         4),
  ('logistics',    'Logistics',               'logistics@fksports.co.uk',   'logistics', 'Logistics inbox',               5)
) AS v(slug, display_name, gmail, dept_slug, description, sort_order)
JOIN departments d ON d.slug = v.dept_slug AND d.deleted_at IS NULL
ON CONFLICT (slug) DO NOTHING;

-- Primary alias for each seeded mailbox (its own address).
INSERT INTO mail_mailbox_aliases (mailbox_id, alias_address, is_primary)
SELECT m.id, m.gmail_address, TRUE
FROM mail_mailboxes m
WHERE NOT EXISTS (
  SELECT 1 FROM mail_mailbox_aliases a WHERE a.mailbox_id = m.id AND a.is_primary = TRUE
);

-- Starter routing rule (alias -> mailbox) for each primary alias.
INSERT INTO mail_routing_rules (mailbox_id, match_type, match_value, priority, notes)
SELECT m.id, 'alias', a.alias_address, 10, 'Auto-seeded alias route'
FROM mail_mailbox_aliases a
JOIN mail_mailboxes m ON m.id = a.mailbox_id
WHERE NOT EXISTS (
  SELECT 1 FROM mail_routing_rules r
  WHERE r.mailbox_id = m.id AND r.match_type = 'alias' AND r.match_value = a.alias_address
);
