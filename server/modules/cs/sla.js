'use strict';

const { q, qOne } = require('./helpers');

async function computeSlaDueDates(ticket, txQ = q) {
  const rule = await txQ(
    `SELECT * FROM cs_sla_rules
     WHERE is_active = TRUE
       AND (queue_id IS NULL OR queue_id = $1)
       AND (priority IS NULL OR priority = $2)
     ORDER BY queue_id NULLS LAST, priority NULLS LAST
     LIMIT 1`,
    [ticket.queue_id, ticket.priority]
  ).then((rows) => rows[0]);

  if (!rule) return ticket;

  const now = new Date();
  const firstDue = addMinutes(now, rule.first_response_minutes);
  const resolutionDue = addMinutes(now, rule.resolution_minutes);

  await txQ(
    `UPDATE cs_tickets
     SET sla_first_response_due = $1, sla_resolution_due = $2
     WHERE id = $3`,
    [firstDue.toISOString(), resolutionDue.toISOString(), ticket.id]
  );

  ticket.sla_first_response_due = firstDue;
  ticket.sla_resolution_due = resolutionDue;
  return ticket;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

async function pauseSla(ticketId, txQ = q) {
  await txQ(
    `UPDATE cs_tickets SET sla_paused_at = NOW() WHERE id = $1 AND sla_paused_at IS NULL`,
    [ticketId]
  );
}

async function resumeSla(ticketId, txQ = q) {
  const ticket = await qOne('SELECT * FROM cs_tickets WHERE id = $1', [ticketId]);
  if (!ticket?.sla_paused_at) return;

  const pausedMs = Date.now() - new Date(ticket.sla_paused_at).getTime();
  const extend = (d) => (d ? new Date(new Date(d).getTime() + pausedMs).toISOString() : null);

  await txQ(
    `UPDATE cs_tickets SET
       sla_first_response_due = COALESCE(sla_first_response_due, NULL),
       sla_resolution_due = CASE WHEN sla_resolution_due IS NOT NULL
         THEN $2::timestamptz ELSE sla_resolution_due END,
       sla_paused_at = NULL
     WHERE id = $1`,
    [ticketId, extend(ticket.sla_resolution_due)]
  );
}

async function markFirstResponse(ticketId, txQ = q) {
  await txQ(
    `UPDATE cs_tickets SET
       first_response_at = COALESCE(first_response_at, NOW()),
       sla_first_response_at = COALESCE(sla_first_response_at, NOW())
     WHERE id = $1`,
    [ticketId]
  );
}

async function getSlaViolations() {
  return q(
    `SELECT id, ticket_number, subject, status, priority,
            sla_first_response_due, sla_resolution_due,
            CASE WHEN sla_first_response_at IS NULL AND sla_first_response_due < NOW() THEN TRUE ELSE FALSE END AS first_response_breach,
            CASE WHEN resolved_at IS NULL AND sla_resolution_due < NOW() THEN TRUE ELSE FALSE END AS resolution_breach
     FROM cs_tickets
     WHERE deleted_at IS NULL
       AND status NOT IN ('closed', 'resolved', 'spam', 'cancelled')
       AND (
         (sla_first_response_at IS NULL AND sla_first_response_due < NOW())
         OR (resolved_at IS NULL AND sla_resolution_due < NOW())
       )
     ORDER BY sla_resolution_due ASC NULLS LAST
     LIMIT 100`
  );
}

module.exports = {
  computeSlaDueDates,
  pauseSla,
  resumeSla,
  markFirstResponse,
  getSlaViolations,
};
