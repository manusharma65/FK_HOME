'use strict';

const { q, qOne } = require('./helpers');

async function applyRoutingRules(ticket, txQ = q) {
  const rules = await txQ(
    `SELECT * FROM cs_routing_rules WHERE is_active = TRUE ORDER BY priority ASC, id ASC`
  );

  for (const rule of rules) {
    const matched = await matchRule(rule, ticket);
    if (!matched) continue;

    const actions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : rule.actions;
    if (actions.queue_id) {
      await txQ(`UPDATE cs_tickets SET queue_id = $1 WHERE id = $2`, [actions.queue_id, ticket.id]);
      ticket.queue_id = actions.queue_id;
    }
    if (actions.assignee_id) {
      await txQ(`UPDATE cs_tickets SET assignee_id = $1 WHERE id = $2`, [actions.assignee_id, ticket.id]);
      ticket.assignee_id = actions.assignee_id;
    }
    if (actions.priority) {
      await txQ(`UPDATE cs_tickets SET priority = $1 WHERE id = $2`, [actions.priority, ticket.id]);
      ticket.priority = actions.priority;
    }
    if (actions.method === 'round_robin') {
      const agent = await pickRoundRobin(ticket.queue_id, txQ);
      if (agent) {
        await txQ(`UPDATE cs_tickets SET assignee_id = $1 WHERE id = $2`, [agent.id, ticket.id]);
        ticket.assignee_id = agent.id;
      }
    }
    if (actions.method === 'least_loaded') {
      const agent = await pickLeastLoaded(ticket.queue_id, txQ);
      if (agent) {
        await txQ(`UPDATE cs_tickets SET assignee_id = $1 WHERE id = $2`, [agent.id, ticket.id]);
        ticket.assignee_id = agent.id;
      }
    }
    break;
  }
  return ticket;
}

async function matchRule(rule, ticket) {
  const cond = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions;

  switch (rule.rule_type) {
    case 'queue':
      return cond.queue_slug && ticket.category === cond.queue_slug;
    case 'email':
      return cond.email_domain && ticket.customer_email?.toLowerCase().endsWith('@' + cond.email_domain.toLowerCase());
    case 'keyword': {
      const text = `${ticket.subject} ${ticket.description || ''}`.toLowerCase();
      const keywords = cond.keywords || [];
      return keywords.some((k) => text.includes(String(k).toLowerCase()));
    }
    case 'vip':
      return ticket.is_vip === true;
    case 'country':
      return cond.country && ticket.country === cond.country;
    case 'language':
      return cond.language && ticket.language === cond.language;
    default:
      return false;
  }
}

async function pickRoundRobin(queueId, txQ) {
  const members = await txQ(
    `SELECT qm.user_id AS id FROM cs_queue_members qm
     WHERE qm.queue_id = $1 ORDER BY qm.user_id`,
    [queueId]
  );
  if (!members.length) return null;

  const last = await qOne(
    `SELECT to_agent_id FROM cs_assignment_log al
     JOIN cs_tickets t ON t.id = al.ticket_id
     WHERE t.queue_id = $1 AND al.to_agent_id IS NOT NULL
     ORDER BY al.created_at DESC LIMIT 1`,
    [queueId]
  );

  const ids = members.map((m) => m.id);
  if (!last?.to_agent_id) return { id: ids[0] };
  const idx = ids.indexOf(last.to_agent_id);
  return { id: ids[(idx + 1) % ids.length] };
}

async function pickLeastLoaded(queueId, txQ) {
  const rows = await txQ(
    `SELECT u.id, COUNT(t.id)::int AS load
     FROM cs_queue_members qm
     JOIN users u ON u.id = qm.user_id
     LEFT JOIN cs_tickets t ON t.assignee_id = u.id
       AND t.deleted_at IS NULL
       AND t.status NOT IN ('closed', 'resolved', 'spam', 'cancelled')
     WHERE qm.queue_id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id
     ORDER BY load ASC, u.id ASC
     LIMIT 1`,
    [queueId]
  );
  return rows[0] || null;
}

module.exports = { applyRoutingRules, pickRoundRobin, pickLeastLoaded };
