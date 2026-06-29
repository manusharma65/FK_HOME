'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db');

async function q(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows;
}

async function qOne(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

async function withTx(cb) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const txQ = (sql, params) => client.query(sql, params).then((r) => r.rows);
    const result = await cb(txQ);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function actorFromReq(req) {
  const u = req.user;
  return {
    id: u.id,
    name: u.display_name || u.full_name || u.email,
    email: u.email,
    role: resolveCsRole(u),
  };
}

function resolveCsRole(user) {
  if (user.can('cs.admin') || user.inGroup('owner')) return 'admin';
  if (user.can('cs.team_leader') || user.isManagerOf('cs')) return 'team_leader';
  return 'agent';
}

function ticketSelectFields(prefix = 't') {
  return `
    ${prefix}.id,
    ${prefix}.ticket_number AS "ticketNumber",
    ${prefix}.customer_name AS customer,
    ${prefix}.customer_name AS "customerName",
    ${prefix}.customer_email AS "customerEmail",
    ${prefix}.customer_phone AS "customerPhone",
    ${prefix}.subject,
    ${prefix}.description,
    ${prefix}.snippet,
    ${prefix}.status,
    ${prefix}.category,
    ${prefix}.queue_id AS "queueId",
    ${prefix}.platform,
    ${prefix}.case_ref AS "caseRef",
    ${prefix}.order_id AS "orderId",
    ${prefix}.assignee_id AS "assigneeId",
    ${prefix}.priority,
    ${prefix}.source,
    ${prefix}.channel,
    ${prefix}.is_new AS "isNew",
    ${prefix}.is_vip AS "isVip",
    ${prefix}.matched,
    ${prefix}.active_cases AS "activeCases",
    COALESCE(${prefix}.sla_resolution_due, ${prefix}.sla_first_response_due) AS "slaDueAt",
    ${prefix}.sla_first_response_due AS "slaFirstResponseDue",
    ${prefix}.sla_resolution_due AS "slaResolutionDue",
    ${prefix}.created_at AS "createdAt",
    ${prefix}.updated_at AS "updatedAt",
    ${prefix}.opened_at AS "openedAt"
  `;
}

function formatMessageRow(row) {
  return {
    id: row.id,
    dir: row.direction || row.dir,
    who: row.author_name || row.who,
    at: row.at || formatTs(row.created_at),
    body: row.body,
    attachments: typeof row.attachments === 'string' ? JSON.parse(row.attachments) : (row.attachments || []),
    createdAt: row.created_at || row.createdAt,
    deliveryStatus: row.delivery_status || row.deliveryStatus || 'sent',
    readAt: row.read_at || row.readAt,
    isInternal: row.is_internal || row.isInternal || false,
    isPinned: row.is_pinned || row.isPinned || false,
    replyToId: row.reply_to_id || row.replyToId,
    authorId: row.author_id || row.authorId,
    messageType: row.message_type || row.messageType || 'message',
  };
}

function formatTs(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function clientIp(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || null;
}

module.exports = {
  uuidv4,
  q,
  qOne,
  withTx,
  actorFromReq,
  resolveCsRole,
  ticketSelectFields,
  formatMessageRow,
  formatTs,
  clientIp,
};
