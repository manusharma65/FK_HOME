-- 55-cs-enterprise.sql
-- Enterprise Customer Service module — ReplyDesk-style helpdesk on FK Home users/permissions.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Queues
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_queues (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(60) NOT NULL UNIQUE,
  name            VARCHAR(120) NOT NULL,
  description     TEXT,
  color           VARCHAR(7) NOT NULL DEFAULT '#9b8e7d',
  icon            VARCHAR(60) NOT NULL DEFAULT 'ti-inbox',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_spam         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cs_queue_members (
  id              SERIAL PRIMARY KEY,
  queue_id        INTEGER NOT NULL REFERENCES cs_queues(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'team_leader', 'admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (queue_id, user_id)
);

CREATE TABLE IF NOT EXISTS cs_queue_permissions (
  id              SERIAL PRIMARY KEY,
  queue_id        INTEGER NOT NULL REFERENCES cs_queues(id) ON DELETE CASCADE,
  permission_slug VARCHAR(80) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (queue_id, permission_slug)
);

-- ---------------------------------------------------------------------------
-- Statuses (configurable workflow)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_statuses (
  key             VARCHAR(60) PRIMARY KEY,
  label           VARCHAR(120) NOT NULL,
  color           VARCHAR(7) NOT NULL DEFAULT '#9b8e7d',
  icon            VARCHAR(60) NOT NULL DEFAULT 'ti-circle-dot',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  is_resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed       BOOLEAN NOT NULL DEFAULT FALSE,
  pauses_sla      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- SLA rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_sla_rules (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  queue_id        INTEGER REFERENCES cs_queues(id) ON DELETE SET NULL,
  priority        VARCHAR(20),
  first_response_minutes INTEGER NOT NULL DEFAULT 240,
  resolution_minutes     INTEGER NOT NULL DEFAULT 2880,
  business_hours_only    BOOLEAN NOT NULL DEFAULT TRUE,
  pause_on_pending_customer BOOLEAN NOT NULL DEFAULT TRUE,
  escalation_minutes     INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cs_business_hours (
  id              SERIAL PRIMARY KEY,
  day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  timezone        VARCHAR(60) NOT NULL DEFAULT 'Europe/London'
);

CREATE TABLE IF NOT EXISTS cs_holidays (
  id              SERIAL PRIMARY KEY,
  holiday_date    DATE NOT NULL UNIQUE,
  name            VARCHAR(120) NOT NULL
);

-- ---------------------------------------------------------------------------
-- Auto-routing rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_routing_rules (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  rule_type       VARCHAR(40) NOT NULL CHECK (rule_type IN (
    'queue', 'email', 'keyword', 'department', 'round_robin',
    'least_loaded', 'vip', 'country', 'language', 'custom'
  )),
  priority        INTEGER NOT NULL DEFAULT 100,
  conditions      JSONB NOT NULL DEFAULT '{}',
  actions         JSONB NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Delegated permissions (team leader delegation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_delegated_permissions (
  id              SERIAL PRIMARY KEY,
  delegator_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions     JSONB NOT NULL DEFAULT '[]',
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cs_delegation_active ON cs_delegated_permissions (delegate_id, expires_at)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_tickets (
  id              SERIAL PRIMARY KEY,
  ticket_number   VARCHAR(20) NOT NULL UNIQUE,
  customer_name   VARCHAR(255) NOT NULL,
  customer_email  VARCHAR(255),
  customer_phone  VARCHAR(40),
  subject         VARCHAR(500) NOT NULL,
  description     TEXT,
  snippet         TEXT,
  category        VARCHAR(60) NOT NULL DEFAULT 'unsorted',
  queue_id        INTEGER REFERENCES cs_queues(id) ON DELETE SET NULL,
  platform        VARCHAR(40) NOT NULL DEFAULT 'email',
  status          VARCHAR(60) NOT NULL DEFAULT 'new' REFERENCES cs_statuses(key) ON UPDATE CASCADE,
  priority        VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  case_ref        VARCHAR(120),
  order_id        VARCHAR(120),
  matched         BOOLEAN NOT NULL DEFAULT FALSE,
  assignee_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source          VARCHAR(40) NOT NULL DEFAULT 'manual' CHECK (source IN (
    'email', 'contact_form', 'manual', 'api', 'webhook', 'internal'
  )),
  channel         VARCHAR(40),
  customer_address TEXT,
  country         VARCHAR(2),
  language        VARCHAR(10) DEFAULT 'en',
  is_vip          BOOLEAN NOT NULL DEFAULT FALSE,
  is_new          BOOLEAN NOT NULL DEFAULT TRUE,
  is_spam         BOOLEAN NOT NULL DEFAULT FALSE,
  active_cases    JSONB NOT NULL DEFAULT '[]',
  sla_first_response_due TIMESTAMPTZ,
  sla_resolution_due     TIMESTAMPTZ,
  sla_first_response_at  TIMESTAMPTZ,
  sla_resolved_at        TIMESTAMPTZ,
  sla_paused_at          TIMESTAMPTZ,
  first_response_at      TIMESTAMPTZ,
  resolved_at            TIMESTAMPTZ,
  closed_at              TIMESTAMPTZ,
  opened_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_tickets_assignee ON cs_tickets (assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cs_tickets_status ON cs_tickets (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cs_tickets_queue ON cs_tickets (queue_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cs_tickets_email ON cs_tickets (LOWER(customer_email)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cs_tickets_number ON cs_tickets (ticket_number);
CREATE INDEX IF NOT EXISTS idx_cs_tickets_created ON cs_tickets (created_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Messages (conversation thread)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  direction       VARCHAR(3) NOT NULL CHECK (direction IN ('in', 'out')),
  message_type    VARCHAR(20) NOT NULL DEFAULT 'message' CHECK (message_type IN (
    'message', 'note', 'system', 'internal'
  )),
  author_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name     VARCHAR(255) NOT NULL,
  body            TEXT NOT NULL,
  attachments     JSONB NOT NULL DEFAULT '[]',
  reply_to_id     UUID REFERENCES cs_messages(id) ON DELETE SET NULL,
  email_message_id VARCHAR(255),
  delivery_status VARCHAR(20) DEFAULT 'sent' CHECK (delivery_status IN (
    'pending', 'sent', 'delivered', 'read', 'failed'
  )),
  read_at         TIMESTAMPTZ,
  is_internal     BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  pending         BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_messages_ticket ON cs_messages (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Team notes (internal, visible to agents)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_team_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  author_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  attachments     JSONB NOT NULL DEFAULT '[]',
  mentions        JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_team_notes_ticket ON cs_team_notes (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Personal notes (private per agent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_personal_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  html            TEXT NOT NULL DEFAULT '',
  collapsed       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Ticket history (immutable audit log — never deleted)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_ticket_history (
  id              BIGSERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name      VARCHAR(255),
  actor_role      VARCHAR(40),
  action          VARCHAR(60) NOT NULL,
  field_name      VARCHAR(60),
  old_value       TEXT,
  new_value       TEXT,
  details         JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_ticket_history_ticket ON cs_ticket_history (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Assignment & status logs (timeline events)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_assignment_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  action          VARCHAR(20) NOT NULL CHECK (action IN ('assign', 'unassign', 'reassign', 'transfer')),
  actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name      VARCHAR(255),
  from_agent_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_agent_name VARCHAR(255),
  to_agent_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_agent_name   VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_assignment_log_ticket ON cs_assignment_log (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS cs_status_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name      VARCHAR(255),
  from_status     VARCHAR(60),
  to_status       VARCHAR(60) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_status_log_ticket ON cs_status_log (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Tags, watchers, saved filters
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_ticket_tags (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  tag             VARCHAR(80) NOT NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_cs_ticket_tags_tag ON cs_ticket_tags (tag);

CREATE TABLE IF NOT EXISTS cs_ticket_watchers (
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS cs_saved_filters (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  filters         JSONB NOT NULL DEFAULT '{}',
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Attachments (standalone file records)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       INTEGER REFERENCES cs_tickets(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES cs_messages(id) ON DELETE CASCADE,
  file_name       VARCHAR(500) NOT NULL,
  mime_type       VARCHAR(120) NOT NULL,
  byte_size       INTEGER NOT NULL,
  storage_path    TEXT,
  data_url        TEXT,
  uploaded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_attachments_ticket ON cs_attachments (ticket_id);

-- ---------------------------------------------------------------------------
-- Email integration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_email_accounts (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  email_address   VARCHAR(255) NOT NULL UNIQUE,
  imap_host       VARCHAR(255),
  imap_port       INTEGER DEFAULT 993,
  smtp_host       VARCHAR(255),
  smtp_port       INTEGER DEFAULT 587,
  username        VARCHAR(255),
  password_enc    TEXT,
  queue_id        INTEGER REFERENCES cs_queues(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cs_email_threads (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  email_account_id INTEGER REFERENCES cs_email_accounts(id) ON DELETE SET NULL,
  thread_id       VARCHAR(255),
  message_id      VARCHAR(255),
  in_reply_to     VARCHAR(255),
  subject         VARCHAR(500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_email_threads_ticket ON cs_email_threads (ticket_id);
CREATE INDEX IF NOT EXISTS idx_cs_email_threads_msg ON cs_email_threads (message_id);

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_template_categories (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS cs_templates (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  category_id     INTEGER REFERENCES cs_template_categories(id) ON DELETE SET NULL,
  color           VARCHAR(7),
  favorite        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  usage_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cs_template_usage (
  id              SERIAL PRIMARY KEY,
  template_id     INTEGER NOT NULL REFERENCES cs_templates(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Order cases & customer order history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_order_cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  type            VARCHAR(40) NOT NULL,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cs_order_history (
  id              SERIAL PRIMARY KEY,
  customer_email  VARCHAR(255) NOT NULL,
  order_id        VARCHAR(120) NOT NULL,
  channel         VARCHAR(40) NOT NULL,
  status          VARCHAR(60) NOT NULL,
  order_date      DATE NOT NULL,
  total           VARCHAR(40)
);

CREATE INDEX IF NOT EXISTS idx_cs_order_history_email ON cs_order_history (LOWER(customer_email));

-- ---------------------------------------------------------------------------
-- Presence (real-time ticket viewing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_ticket_presence (
  ticket_id       INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'viewing' CHECK (status IN ('viewing', 'typing')),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, user_id)
);

-- ---------------------------------------------------------------------------
-- CS-specific notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id       INTEGER REFERENCES cs_tickets(id) ON DELETE CASCADE,
  type            VARCHAR(40) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  body            TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_notifications_user ON cs_notifications (user_id, is_read, created_at DESC);

-- ---------------------------------------------------------------------------
-- Activity logs (system-wide CS events)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_activity_logs (
  id              BIGSERIAL PRIMARY KEY,
  ticket_id       INTEGER REFERENCES cs_tickets(id) ON DELETE SET NULL,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type      VARCHAR(60) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Ticket number sequence
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS cs_ticket_number_seq START 100001;

CREATE OR REPLACE FUNCTION cs_generate_ticket_number() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := 'TKT-' || LPAD(nextval('cs_ticket_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cs_ticket_number ON cs_tickets;
CREATE TRIGGER trg_cs_ticket_number
  BEFORE INSERT ON cs_tickets FOR EACH ROW
  EXECUTE FUNCTION cs_generate_ticket_number();

-- ---------------------------------------------------------------------------
-- Auto status log trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cs_log_status_change() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO cs_status_log (ticket_id, from_status, to_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cs_ticket_status_log ON cs_tickets;
CREATE TRIGGER trg_cs_ticket_status_log
  BEFORE UPDATE ON cs_tickets FOR EACH ROW
  EXECUTE FUNCTION cs_log_status_change();

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cs_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cs_queues_touch ON cs_queues;
CREATE TRIGGER trg_cs_queues_touch BEFORE UPDATE ON cs_queues FOR EACH ROW EXECUTE FUNCTION cs_touch_updated_at();
DROP TRIGGER IF EXISTS trg_cs_tickets_touch ON cs_tickets;
CREATE TRIGGER trg_cs_tickets_touch BEFORE UPDATE ON cs_tickets FOR EACH ROW EXECUTE FUNCTION cs_touch_updated_at();
DROP TRIGGER IF EXISTS trg_cs_team_notes_touch ON cs_team_notes;
CREATE TRIGGER trg_cs_team_notes_touch BEFORE UPDATE ON cs_team_notes FOR EACH ROW EXECUTE FUNCTION cs_touch_updated_at();
DROP TRIGGER IF EXISTS trg_cs_personal_notes_touch ON cs_personal_notes;
CREATE TRIGGER trg_cs_personal_notes_touch BEFORE UPDATE ON cs_personal_notes FOR EACH ROW EXECUTE FUNCTION cs_touch_updated_at();
DROP TRIGGER IF EXISTS trg_cs_templates_touch ON cs_templates;
CREATE TRIGGER trg_cs_templates_touch BEFORE UPDATE ON cs_templates FOR EACH ROW EXECUTE FUNCTION cs_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seed default statuses
-- ---------------------------------------------------------------------------
INSERT INTO cs_statuses (key, label, color, icon, sort_order, is_default, is_resolved, is_closed, pauses_sla) VALUES
  ('new',              'New',               '#6366F1', 'ti-sparkles',       1,  TRUE,  FALSE, FALSE, FALSE),
  ('open',             'Open',              '#3B82F6', 'ti-inbox',          2,  FALSE, FALSE, FALSE, FALSE),
  ('assigned',         'Assigned',          '#8B5CF6', 'ti-user-check',     3,  FALSE, FALSE, FALSE, FALSE),
  ('pending_customer', 'Pending Customer',  '#F59E0B', 'ti-clock-pause',    4,  FALSE, FALSE, FALSE, TRUE),
  ('pending_internal', 'Pending Internal',  '#F97316', 'ti-building',       5,  FALSE, FALSE, FALSE, FALSE),
  ('in_progress',      'In Progress',       '#0EA5E9', 'ti-progress',       6,  FALSE, FALSE, FALSE, FALSE),
  ('waiting',          'Waiting',           '#64748B', 'ti-hourglass',      7,  FALSE, FALSE, FALSE, TRUE),
  ('resolved',         'Resolved',          '#22C55E', 'ti-check',          8,  FALSE, TRUE,  FALSE, FALSE),
  ('closed',           'Closed',            '#6B7280', 'ti-circle-check',   9,  FALSE, TRUE,  TRUE,  FALSE),
  ('reopened',         'Reopened',          '#EF4444', 'ti-refresh',        10, FALSE, FALSE, FALSE, FALSE),
  ('escalated',        'Escalated',         '#DC2626', 'ti-alert-triangle', 11, FALSE, FALSE, FALSE, FALSE),
  ('spam',             'Spam',              '#78716C', 'ti-ban',            12, FALSE, TRUE,  TRUE,  FALSE),
  ('cancelled',        'Cancelled',         '#A8A29E', 'ti-x',              13, FALSE, TRUE,  TRUE,  FALSE),
  -- Legacy keys used by existing frontend
  ('new_ticket',       'New Ticket',        '#6366F1', 'ti-sparkles',       20, FALSE, FALSE, FALSE, FALSE),
  ('awaiting_reply',   'Awaiting Reply',    '#F59E0B', 'ti-message',        21, FALSE, FALSE, FALSE, FALSE),
  ('to_do',            'To Do',             '#3B82F6', 'ti-list-check',     22, FALSE, FALSE, FALSE, FALSE)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed default queues
-- ---------------------------------------------------------------------------
INSERT INTO cs_queues (slug, name, description, color, icon, sort_order) VALUES
  ('support',       'Support',        'General customer support',           '#3B82F6', 'ti-headset',      1),
  ('technical',     'Technical',      'Technical issues and troubleshooting','#8B5CF6', 'ti-tool',         2),
  ('returns',       'Returns',        'Return requests and RMAs',         '#F59E0B', 'ti-package-export',3),
  ('refund',        'Refund',         'Refund processing',                '#EF4444', 'ti-credit-card-refund',4),
  ('order_issues',  'Order Issues',   'Order problems and modifications', '#0EA5E9', 'ti-shopping-cart', 5),
  ('shipping',      'Shipping',       'Shipping and delivery inquiries',  '#06B6D4', 'ti-truck-delivery',6),
  ('accounts',      'Accounts',       'Account and login issues',         '#6366F1', 'ti-user',          7),
  ('vip',           'VIP Customers',  'Priority VIP customer support',    '#EAB308', 'ti-crown',         8),
  ('spam',          'Spam',           'Spam and junk tickets',            '#78716C', 'ti-ban',           9)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed template categories
-- ---------------------------------------------------------------------------
INSERT INTO cs_template_categories (name) VALUES
  ('General'), ('Returns'), ('Shipping'), ('Refunds'), ('Technical'), ('VIP')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Default SLA rule
-- ---------------------------------------------------------------------------
INSERT INTO cs_sla_rules (name, first_response_minutes, resolution_minutes, business_hours_only)
SELECT 'Default SLA', 240, 2880, TRUE
WHERE NOT EXISTS (SELECT 1 FROM cs_sla_rules LIMIT 1);

-- ---------------------------------------------------------------------------
-- Default business hours (Mon-Fri 9-17 London)
-- ---------------------------------------------------------------------------
INSERT INTO cs_business_hours (day_of_week, start_time, end_time)
SELECT d, '09:00'::time, '17:00'::time
FROM generate_series(1, 5) AS d
WHERE NOT EXISTS (SELECT 1 FROM cs_business_hours LIMIT 1);
