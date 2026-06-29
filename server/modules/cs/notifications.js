'use strict';

const { q } = require('./helpers');

async function notifyCsUser({ userId, ticketId, type, title, body }) {
  await q(
    `INSERT INTO cs_notifications (user_id, ticket_id, type, title, body)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, ticketId || null, type, title, body || null]
  );
}

async function notifyAssignment({ ticket, assigneeId, actor, action = 'assign' }) {
  if (!assigneeId) return;
  await notifyCsUser({
    userId: assigneeId,
    ticketId: ticket.id,
    type: action,
    title: `Ticket ${ticket.ticket_number} ${action === 'reassign' ? 'reassigned' : 'assigned'} to you`,
    body: ticket.subject,
  });
}

async function notifyTicketEvent({ ticket, userIds, type, title, body }) {
  for (const uid of userIds) {
    await notifyCsUser({ userId: uid, ticketId: ticket.id, type, title, body });
  }
}

async function getUnreadNotifications(userId, limit = 50) {
  return q(
    `SELECT id, ticket_id AS "ticketId", type, title, body, is_read AS "isRead", created_at AS "createdAt"
     FROM cs_notifications
     WHERE user_id = $1 AND is_read = FALSE
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
}

module.exports = {
  notifyCsUser,
  notifyAssignment,
  notifyTicketEvent,
  getUnreadNotifications,
};
