-- 001_init.sql
-- Initial schema for the FK Home Customer Support module.
-- Tables map directly to what public/modules/cs.js already expects from
-- /api/cs/*, so the existing frontend works against this with no changes.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Agents (the people who log in and work tickets)
-- ---------------------------------------------------------------------------
CREATE TABLE agents (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  -- 'agent' = normal support agent, 'team_lead' = can reassign + manage notes/templates
  role            VARCHAR(20) NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'team_lead', 'admin')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agents_email ON agents (email);

-- ---------------------------------------------------------------------------
-- Statuses (agent-configurable ticket statuses, with custom colors —
-- matches the "By status" sidebar + the Gmail-style color picker)
-- ---------------------------------------------------------------------------
CREATE TABLE statuses (
  key             VARCHAR(60) PRIMARY KEY,
  label           VARCHAR(120) NOT NULL,
  color           VARCHAR(7) NOT NULL DEFAULT '#9b8e7d', -- hex, e.g. #E8722B
  icon            VARCHAR(60) NOT NULL DEFAULT 'ti-circle-dot',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE, -- new tickets land here
  is_resolved     BOOLEAN NOT NULL DEFAULT FALSE, -- counts as "closed" for SLA/reporting
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tickets (the core entity — one per customer conversation)
-- ---------------------------------------------------------------------------
CREATE TABLE tickets (
  id              SERIAL PRIMARY KEY,
  customer_name   VARCHAR(255) NOT NULL,
  customer_email  VARCHAR(255),
  subject         VARCHAR(500) NOT NULL,
  -- denormalized snippet of the latest message, for fast queue rendering
  snippet         TEXT,
  category        VARCHAR(60) NOT NULL DEFAULT 'unsorted',
  platform        VARCHAR(40) NOT NULL DEFAULT 'amazon', -- amazon | ebay | shopify | walmart | ...
  status_key      VARCHAR(60) NOT NULL REFERENCES statuses(key) ON UPDATE CASCADE,
  case_ref        VARCHAR(120), -- e.g. AMZ-88421 (platform's own order/case id)
  -- "matched" = this ticket has been linked to a real order/platform case.
  -- Unmatched tickets cannot be assigned (mirrors existing frontend rule).
  matched         BOOLEAN NOT NULL DEFAULT FALSE,
  assignee_id     INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  sla_due_at      TIMESTAMPTZ,
  is_new          BOOLEAN NOT NULL DEFAULT TRUE, -- unread-by-assignee flag
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_assignee ON tickets (assignee_id);
CREATE INDEX idx_tickets_status ON tickets (status_key);
CREATE INDEX idx_tickets_customer_email ON tickets (customer_email);
CREATE INDEX idx_tickets_matched ON tickets (matched);

-- ---------------------------------------------------------------------------
-- Messages (the customer<->agent conversation thread for a ticket)
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  direction       VARCHAR(3) NOT NULL CHECK (direction IN ('in', 'out')), -- in=customer, out=agent
  author_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL, -- null when direction='in'
  who_label       VARCHAR(255) NOT NULL, -- display name shown in the thread
  body            TEXT NOT NULL,
  pending         BOOLEAN NOT NULL DEFAULT FALSE, -- true during the 10s undo window
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_ticket ON messages (ticket_id, created_at);

CREATE TABLE message_attachments (
  id              SERIAL PRIMARY KEY,
  message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_name       VARCHAR(500) NOT NULL,
  mime_type       VARCHAR(120) NOT NULL,
  byte_size       INTEGER NOT NULL,
  storage_path    TEXT NOT NULL, -- relative path/key in object storage, not base64
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Internal (team) notes — visible to every agent
-- ---------------------------------------------------------------------------
CREATE TABLE team_notes (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_notes_ticket ON team_notes (ticket_id);

CREATE TABLE team_note_attachments (
  id              SERIAL PRIMARY KEY,
  team_note_id    INTEGER NOT NULL REFERENCES team_notes(id) ON DELETE CASCADE,
  file_name       VARCHAR(500) NOT NULL,
  mime_type       VARCHAR(120) NOT NULL,
  byte_size       INTEGER NOT NULL,
  storage_path    TEXT NOT NULL
);

-- @mentions inside a team note, so notifications can be sent reliably
-- without re-parsing the note body every time.
CREATE TABLE team_note_mentions (
  id              SERIAL PRIMARY KEY,
  team_note_id    INTEGER NOT NULL REFERENCES team_notes(id) ON DELETE CASCADE,
  mentioned_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Personal notes — ONE per (ticket, agent), private to that agent only.
-- The UNIQUE constraint enforces "one note per ticket per agent" at the DB
-- level, matching the frontend's "one personal note per ticket" rule.
-- ---------------------------------------------------------------------------
CREATE TABLE personal_notes (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  html            TEXT NOT NULL DEFAULT '',
  collapsed       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, agent_id)
);

-- ---------------------------------------------------------------------------
-- Reply templates — per-template custom color override (Gmail-label style),
-- favorites, categories, usage tracking for "Recently Used"
-- ---------------------------------------------------------------------------
CREATE TABLE template_categories (
  name            VARCHAR(120) PRIMARY KEY
);

CREATE TABLE templates (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  category        VARCHAR(120) NOT NULL REFERENCES template_categories(name) ON UPDATE CASCADE,
  color           VARCHAR(7),  -- null = use the auto category color; set = custom override
  favorite        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-agent "recently used" tracking (each agent has their own recent list)
CREATE TABLE template_usage (
  id              SERIAL PRIMARY KEY,
  template_id     INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  used_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_template_usage_agent ON template_usage (agent_id, used_at DESC);

-- ---------------------------------------------------------------------------
-- Assignment log — full audit trail of who assigned/reassigned what to whom
-- ---------------------------------------------------------------------------
CREATE TABLE assignment_log (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action          VARCHAR(20) NOT NULL CHECK (action IN ('assign', 'unassign', 'reassign')),
  actor_agent_id  INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id     INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignment_log_ticket ON assignment_log (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Order cases (Return / INR / A-to-Z / Chargeback / Replacement indicators)
-- ---------------------------------------------------------------------------
CREATE TABLE order_cases (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  case_type       VARCHAR(40) NOT NULL CHECK (case_type IN
                    ('return_request', 'inr', 'a2z_claim', 'chargeback', 'replacement_request', 'other')),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ -- null while active; badges stay visible until this is set
);

CREATE INDEX idx_order_cases_ticket ON order_cases (ticket_id) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Customer order history (multi-channel orders for a given email — powers
-- the "Customer order history" side panel)
-- ---------------------------------------------------------------------------
CREATE TABLE customer_orders (
  id              SERIAL PRIMARY KEY,
  customer_email  VARCHAR(255) NOT NULL,
  order_id        VARCHAR(120) NOT NULL,
  channel         VARCHAR(40) NOT NULL, -- amazon | ebay | shopify | walmart | ...
  status          VARCHAR(60) NOT NULL,
  order_date      DATE NOT NULL
);

CREATE INDEX idx_customer_orders_email ON customer_orders (customer_email);

-- ---------------------------------------------------------------------------
-- Presence — which agents currently have which ticket open (for the real
-- "agent is viewing this ticket" indicator, replacing the fake simulation)
-- ---------------------------------------------------------------------------
CREATE TABLE ticket_presence (
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, agent_id)
);

-- ---------------------------------------------------------------------------
-- updated_at auto-touch trigger, reused across several tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agents_touch BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_tickets_touch BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_team_notes_touch BEFORE UPDATE ON team_notes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_personal_notes_touch BEFORE UPDATE ON personal_notes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_templates_touch BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
