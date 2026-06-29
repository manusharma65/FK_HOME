'use strict';

const { q } = require('./helpers');

async function recordHistory({
  ticketId, actor, action, fieldName, oldValue, newValue, details, req,
}) {
  await q(
    `INSERT INTO cs_ticket_history
       (ticket_id, actor_id, actor_name, actor_role, action, field_name, old_value, new_value, details, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      ticketId,
      actor?.id || null,
      actor?.name || 'System',
      actor?.role || null,
      action,
      fieldName || null,
      oldValue != null ? String(oldValue) : null,
      newValue != null ? String(newValue) : null,
      details ? JSON.stringify(details) : null,
      req?.ip || null,
      req?.headers?.['user-agent'] || null,
    ]
  );
}

async function getTicketHistory(ticketId) {
  return q(
    `SELECT id, actor_name AS "actorName", actor_role AS "actorRole",
            action, field_name AS "fieldName", old_value AS "oldValue",
            new_value AS "newValue", details, created_at AS "createdAt"
     FROM cs_ticket_history
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticketId]
  );
}

async function getActivityTimeline(ticketId) {
  const [history, assignments, statuses, messages] = await Promise.all([
    getTicketHistory(ticketId),
    q(`SELECT action, actor_name AS "actorName", from_agent_name AS "fromName",
              to_agent_name AS "toName", created_at AS "createdAt"
       FROM cs_assignment_log WHERE ticket_id = $1 ORDER BY created_at`, [ticketId]),
    q(`SELECT actor_name AS "actorName", from_status AS "fromStatus",
              to_status AS "toStatus", created_at AS "createdAt"
       FROM cs_status_log WHERE ticket_id = $1 ORDER BY created_at`, [ticketId]),
    q(`SELECT author_name AS "authorName", direction, message_type AS "messageType",
              created_at AS "createdAt"
       FROM cs_messages WHERE ticket_id = $1 ORDER BY created_at`, [ticketId]),
  ]);

  const events = [];

  for (const h of history) {
    events.push({ type: 'history', ...h, at: h.createdAt });
  }
  for (const a of assignments) {
    events.push({ type: 'assignment', ...a, at: a.createdAt });
  }
  for (const s of statuses) {
    events.push({ type: 'status', ...s, at: s.createdAt });
  }
  for (const m of messages) {
    events.push({
      type: m.messageType === 'internal' ? 'internal_note' : (m.direction === 'in' ? 'customer_reply' : 'agent_reply'),
      actorName: m.authorName,
      at: m.createdAt,
    });
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  return events;
}

module.exports = { recordHistory, getTicketHistory, getActivityTimeline };
