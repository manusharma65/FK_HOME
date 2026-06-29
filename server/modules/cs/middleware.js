'use strict';

const { requireAuth, requirePermission } = require('../../auth');
const { qOne } = require('./helpers');

function requireCsView(req, res, next) {
  return requirePermission('cs.tickets.view')(req, res, next);
}

function requireCsReply(req, res, next) {
  return requirePermission('cs.tickets.reply')(req, res, next);
}

function requireCsAssign(req, res, next) {
  return requirePermission('cs.assign')(req, res, next);
}

function requireCsAdmin(req, res, next) {
  return requirePermission('cs.admin')(req, res, next);
}

async function loadTicket(req, res, next) {
  const id = parseInt(req.params.id || req.params.ticketId, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ticket id' });
  try {
    const ticket = await qOne(
      'SELECT * FROM cs_tickets WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    req.csTicket = ticket;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function assertTicketAccess(req, res, next) {
  const ticket = req.csTicket;
  const user = req.user;
  if (!ticket || !user) return next();

  const role = user.can('cs.admin') || user.inGroup('owner') ? 'admin'
    : (user.can('cs.team_leader') || user.isManagerOf('cs') ? 'team_leader' : 'agent');

  if (role === 'admin' || role === 'team_leader') return next();

  // Agents can only access assigned tickets
  if (role === 'agent' && ticket.assignee_id !== user.id) {
    return res.status(403).json({ error: 'You can only work on tickets assigned to you' });
  }
  next();
}

async function hasDelegatedPermission(userId, permission) {
  const row = await qOne(
    `SELECT 1 FROM cs_delegated_permissions
     WHERE delegate_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       AND permissions @> $2::jsonb`,
    [userId, JSON.stringify([permission])]
  );
  return !!row;
}

async function canAssign(req) {
  if (req.user.can('cs.assign') || req.user.can('cs.admin') || req.user.inGroup('owner')) return true;
  if (req.user.can('cs.team_leader') || req.user.isManagerOf('cs')) return true;
  return hasDelegatedPermission(req.user.id, 'assign');
}

async function canReassign(req, ticket) {
  if (await canAssign(req)) return true;
  // First assignment allowed for agents on unassigned tickets in their queue
  if (!ticket.assignee_id && req.user.can('cs.tickets.reply')) return true;
  return false;
}

module.exports = {
  requireAuth,
  requireCsView,
  requireCsReply,
  requireCsAssign,
  requireCsAdmin,
  loadTicket,
  assertTicketAccess,
  canAssign,
  canReassign,
  hasDelegatedPermission,
};
