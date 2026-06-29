-- ============================================================================
-- cs-schema.sql — Customer Service module
-- ============================================================================
-- Run once against your existing database, which already has:
--   public.users (id, full_name, email, avatar_url, avatar_colour,
--                  employment_status, deleted_at, ...)
--   public.user_department_memberships (user_id, department_id, role,
--                  deleted_at, ...)
-- This migration only adds the cs_* tables the CS backend needs.
-- Safe to re-run: every statement is IF NOT EXISTS / ON CONFLICT guarded.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Statuses — admin-managed, drives sidebar folders + ticket.status values
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_statuses (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#5F5E5A',
  icon        TEXT NOT NULL DEFAULT 'ti-circle-dot',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.cs_statuses
(
    key,
    label,
    color,
    icon,
    sort_order,
    is_default,
    is_resolved,
    is_closed,
    pauses_sla
)
VALUES
('new_ticket',     'New Ticket',     '#E8722B', 'ti-circle-dot',          1, FALSE, FALSE, FALSE, FALSE),
('awaiting_reply', 'Awaiting Reply', '#B56D1D', 'ti-clock-hour-4',        2, FALSE, FALSE, FALSE, FALSE),
('to_do',          'To Do',          '#1A4FB5', 'ti-circle-check',        3, FALSE, FALSE, FALSE, FALSE),
('replacement',    'Replacement',    '#9A4A2B', 'ti-package',             4, FALSE, FALSE, FALSE, FALSE),
('refund',         'Refund',         '#8A6A1E', 'ti-receipt-refund',      5, FALSE, FALSE, FALSE, FALSE),
('resolved',       'Resolved',       '#34B27B', 'ti-circle-check-filled', 6, FALSE, TRUE, TRUE, FALSE)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Tickets — the core entity. Columns match exactly what cs-backend.js
--    selects/updates (see t.* usages and INSERT/UPDATE statements).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          TEXT NOT NULL,
  snippet          TEXT,
  customer_name    TEXT,
  customer_email   TEXT,
  customer_address TEXT,
  status           TEXT NOT NULL DEFAULT 'new_ticket' REFERENCES public.cs_statuses(key),
  category         TEXT,                       -- routing category (returns, claims, ...)
  platform         TEXT,                       -- amazon / ebay / shopify / walmart
  channel          TEXT,                       -- inbound channel (email, chat, ...)
  case_ref         TEXT,                       -- external marketplace case/order ref
  priority         TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low','Normal','Medium','High','Urgent')),
  assignee_id      INTEGER REFERENCES public.users(id),
  matched          BOOLEAN NOT NULL DEFAULT FALSE,
  is_new           BOOLEAN NOT NULL DEFAULT TRUE,
  active_cases     INTEGER NOT NULL DEFAULT 0,  -- count of open order-cases, kept in sync by trigger below
  sla_due_at       TIMESTAMPTZ,
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cs_tickets_status     ON public.cs_tickets(status)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cs_tickets_assignee    ON public.cs_tickets(assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cs_tickets_resolution_sla
ON public.cs_tickets(sla_resolution_due)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cs_tickets_category    ON public.cs_tickets(category)    WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Messages (customer <-> agent thread shown in the merged timeline)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        UUID NOT NULL REFERENCES public.cs_tickets(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('in','out')), -- in = customer, out = agent
  author_id        INTEGER REFERENCES public.users(id),             -- NULL when direction = 'in'
  author_name      TEXT NOT NULL,
  body             TEXT NOT NULL,
  attachments      JSONB NOT NULL DEFAULT '[]',
  email_message_id TEXT,                                            -- SMTP Message-ID, for threading
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_messages_ticket ON public.cs_messages(ticket_id, created_at);

-- ----------------------------------------------------------------------------
-- 4. Internal team notes (agent-only, with @mentions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_team_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES public.cs_tickets(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES public.users(id),
  body        TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]',
  mentions    JSONB NOT NULL DEFAULT '[]',      -- array of user ids mentioned
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_team_notes_ticket ON public.cs_team_notes(ticket_id, created_at);

-- ----------------------------------------------------------------------------
-- 4b. Personal notes — private scratchpad, one per (ticket, author), used by
--     the front end's PUT/PATCH/DELETE /cases/:id/notes/personal endpoints,
--     which had no backing table/routes in the uploaded file.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_personal_notes (
  ticket_id   UUID NOT NULL REFERENCES public.cs_tickets(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES public.users(id),
  html        TEXT NOT NULL DEFAULT '',
  collapsed   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, author_id)
);

-- ----------------------------------------------------------------------------
-- 5. Assignment log (who assigned/reassigned, from whom, to whom)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_assignment_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES public.cs_tickets(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (action IN ('assign','reassign','unassign')),
  actor_id        INTEGER REFERENCES public.users(id),
  actor_name      TEXT,
  from_agent_id   INTEGER REFERENCES public.users(id),
  from_agent_name TEXT,
  to_agent_id     INTEGER REFERENCES public.users(id),
  to_agent_name   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_assignment_log_ticket ON public.cs_assignment_log(ticket_id, created_at);

-- ----------------------------------------------------------------------------
-- 6. Status change log (auto-written by trigger on cs_tickets.status change)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_status_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES public.cs_tickets(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES public.users(id),
  actor_name  TEXT,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_status_log_ticket ON public.cs_status_log(ticket_id, created_at);

-- Trigger: every time cs_tickets.status changes, write a row automatically.
-- (The original file's comment "status log is auto-written by DB trigger" —
--  this implements that trigger so the comment is actually true.)
CREATE OR REPLACE FUNCTION public.fn_cs_log_status_change() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.cs_status_log (ticket_id, from_status, to_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_status_log ON public.cs_tickets;
CREATE TRIGGER trg_ticket_status_log
  AFTER UPDATE ON public.cs_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cs_log_status_change();

-- ----------------------------------------------------------------------------
-- 7. Order cases (return/INR/A-to-Z/chargeback/replacement indicators)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_order_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES public.cs_tickets(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN
                 ('return_request','inr','a2z_claim','chargeback','replacement_request')),
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  INTEGER REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_cs_order_cases_ticket_open
  ON public.cs_order_cases(ticket_id) WHERE resolved_at IS NULL;

-- Keep cs_tickets.active_cases in sync automatically.
CREATE OR REPLACE FUNCTION public.fn_cs_sync_active_cases() RETURNS TRIGGER AS $$
DECLARE
  affected_ticket UUID := COALESCE(NEW.ticket_id, OLD.ticket_id);
BEGIN
  UPDATE public.cs_tickets
  SET active_cases = (
    SELECT COUNT(*) FROM public.cs_order_cases
    WHERE ticket_id = affected_ticket AND resolved_at IS NULL
  )
  WHERE id = affected_ticket;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_cases_sync ON public.cs_order_cases;
CREATE TRIGGER trg_order_cases_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.cs_order_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cs_sync_active_cases();

-- ----------------------------------------------------------------------------
-- 8. Order history (per-customer, shown in the side panel)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_order_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email TEXT NOT NULL,
  order_id       TEXT NOT NULL,
  channel        TEXT NOT NULL,
  status         TEXT NOT NULL,
  order_date     TIMESTAMPTZ NOT NULL,
  total          NUMERIC(10,2)
);

CREATE INDEX IF NOT EXISTS idx_cs_order_history_email ON public.cs_order_history(LOWER(customer_email));

-- ----------------------------------------------------------------------------
-- 9. Templates / canned responses
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_template_categories (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

INSERT INTO public.cs_template_categories (name) VALUES ('General') ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cs_templates (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  category_id INTEGER NOT NULL DEFAULT 1 REFERENCES public.cs_template_categories(id),
  favorite    BOOLEAN NOT NULL DEFAULT FALSE,
  use_count   INTEGER NOT NULL DEFAULT 0,        -- incremented by POST /templates/:id/touch
  last_used_at TIMESTAMPTZ,
  created_by  INTEGER REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 10. Queue routing rules — one fallback agent per category, matching what
--     queueRouting / GET+POST /api/cs/queue-routing expect on the front end.
--     (No table or routes existed for this in the uploaded backend file.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_queue_routing (
  category TEXT PRIMARY KEY,
  agent_id INTEGER REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES public.users(id)
);

INSERT INTO public.cs_queue_routing (category, agent_id) VALUES
  ('returns', NULL), ('item_not_received', NULL), ('claims', NULL), ('unsorted', NULL)
ON CONFLICT (category) DO NOTHING;

-- ============================================================================
-- Done. Verify with:  \dt public.cs_*
-- ============================================================================
