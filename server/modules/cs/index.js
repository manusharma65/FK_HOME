'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  q, qOne, withTx, uuidv4, actorFromReq, ticketSelectFields,
  formatMessageRow, clientIp,
} = require('./helpers');
const {
  requireAuth, requireCsView, requireCsReply, requireCsAssign, requireCsAdmin,
  loadTicket, assertTicketAccess, canAssign, canReassign,
} = require('./middleware');
const { recordHistory, getTicketHistory, getActivityTimeline } = require('./history');
const { applyRoutingRules } = require('./routing');
const { computeSlaDueDates, pauseSla, resumeSla, markFirstResponse, getSlaViolations } = require('./sla');
const { sendEmailToCustomer, findOrCreateTicketFromEmail, createTicketFromSource } = require('./email');
const { notifyAssignment, notifyTicketEvent, getUnreadNotifications } = require('./notifications');

const router = express.Router();
router.use(requireAuth);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(apiLimiter);

let csSocket = null;
function setCsSocket(socketApi) { csSocket = socketApi; }
function emit(event, data) {
  if (!csSocket) return;
  if (data.ticketId) csSocket.emitToTicket(data.ticketId, event, data);
  if (data.userId) csSocket.emitToUser(data.userId, event, data);
  csSocket.emitDashboard(event, data);
}

function permissionsFor(user) {
  const role = user.can('cs.admin') || user.inGroup('owner') ? 'admin'
    : (user.can('cs.team_leader') || user.isManagerOf('cs') ? 'team_leader' : 'agent');
  return {
    role,
    assign: user.can('cs.assign') || user.can('cs.admin') || role !== 'agent',
    reassign: user.can('cs.assign') || user.can('cs.admin') || role === 'team_leader',
    templates: user.can('cs.templates.manage') || user.can('cs.admin'),
    manageNotes: user.can('cs.admin') || role === 'team_leader',
    deleteTickets: user.can('cs.admin'),
    changeQueue: user.can('cs.assign') || user.can('cs.admin') || role === 'team_leader',
    configure: user.can('cs.admin'),
    viewAll: role !== 'agent' || user.can('cs.tickets.view'),
  };
}

async function countPool() {
  return q('SELECT id, status, assignee_id AS "assigneeId", queue_id AS "queueId" FROM cs_tickets WHERE deleted_at IS NULL');
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
router.get('/bootstrap', requireCsView, async (req, res) => {
  try {
    const dept = await qOne(`SELECT id FROM departments WHERE slug = 'cs' LIMIT 1`);
    const departmentId = dept?.id || 3;

    const team = await q(
      `SELECT u.id, u.full_name AS name, u.email, udm.role,
              u.avatar_url, u.avatar_colour, TRUE AS is_active
       FROM user_department_memberships udm
       JOIN users u ON udm.user_id = u.id
       WHERE udm.department_id = $1 AND udm.deleted_at IS NULL
         AND u.deleted_at IS NULL AND u.employment_status = 'active'
       ORDER BY u.full_name ASC`,
      [departmentId]
    );

    const statuses = await q(`SELECT key, label, color, icon FROM cs_statuses ORDER BY sort_order ASC`);
    const queues = await q(`SELECT id, slug, name, color, icon FROM cs_queues WHERE is_active = TRUE ORDER BY sort_order`);

    res.json({
      user: {
        id: req.user.id,
        name: req.user.display_name || req.user.full_name,
        email: req.user.email,
        role: permissionsFor(req.user).role,
      },
      permissions: permissionsFor(req.user),
      agents: team,
      statuses,
      queues,
    });
  } catch (err) {
    console.error('[cs/bootstrap]', err);
    res.status(500).json({ error: 'Failed to load CS workspace' });
  }
});

// ─── Queues ──────────────────────────────────────────────────────────────────
router.get('/queues', requireCsView, async (req, res) => {
  try {
    const queues = await q(
      `SELECT q.id, q.slug, q.name, q.color, q.icon, q.description,
              COUNT(t.id)::int AS ticket_count,
              COUNT(t.id) FILTER (WHERE t.status IN ('pending_customer','pending_internal','waiting'))::int AS pending_count,
              COUNT(t.id) FILTER (WHERE t.status NOT IN ('closed','resolved','spam','cancelled'))::int AS open_count,
              COUNT(t.id) FILTER (WHERE t.assignee_id IS NOT NULL)::int AS assigned_count
       FROM cs_queues q
       LEFT JOIN cs_tickets t ON t.queue_id = q.id AND t.deleted_at IS NULL
       WHERE q.is_active = TRUE
       GROUP BY q.id ORDER BY q.sort_order`
    );

    // Average response/resolution times
    for (const queue of queues) {
      const stats = await qOne(
        `SELECT
           AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60)::int AS avg_response_min,
           AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/60)::int AS avg_resolution_min
         FROM cs_tickets
         WHERE queue_id = $1 AND deleted_at IS NULL AND created_at > NOW() - INTERVAL '30 days'`,
        [queue.id]
      );
      queue.avgResponseMinutes = stats?.avg_response_min || 0;
      queue.avgResolutionMinutes = stats?.avg_resolution_min || 0;
    }

    res.json({ queues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Queue (ticket list) ─────────────────────────────────────────────────────
router.get('/queue', requireCsView, async (req, res) => {
  try {
    const { view, filter, sort, queue: queueSlug, status, agent, tag, customer, email, ticketId, dateFrom, dateTo, q: searchQ } = req.query;
    const perms = permissionsFor(req.user);
    const conditions = ['t.deleted_at IS NULL'];
    const params = [];

    if (perms.role === 'agent' && !req.user.can('cs.admin')) {
      params.push(req.user.id);
      conditions.push(`t.assignee_id = $${params.length}`);
    }

    if (view === 'my-work') {
      params.push(req.user.id);
      conditions.push(`t.assignee_id = $${params.length}`);
    } else if (view === 'unassigned') {
      conditions.push('t.assignee_id IS NULL');
    } else if (view?.startsWith('agent:')) {
      params.push(parseInt(view.split(':')[1], 10));
      conditions.push(`t.assignee_id = $${params.length}`);
    } else if (view?.startsWith('status:')) {
      params.push(view.split(':')[1]);
      conditions.push(`t.status = $${params.length}`);
    }

    if (filter && filter !== 'all') {
      params.push(filter);
      conditions.push(`t.category = $${params.length}`);
    }
    if (queueSlug) {
      params.push(queueSlug);
      conditions.push(`EXISTS (SELECT 1 FROM cs_queues cq WHERE cq.id = t.queue_id AND cq.slug = $${params.length})`);
    }
    if (status) { params.push(status); conditions.push(`t.status = $${params.length}`); }
    if (agent) { params.push(parseInt(agent, 10)); conditions.push(`t.assignee_id = $${params.length}`); }
    if (tag) {
      params.push(tag);
      conditions.push(`EXISTS (SELECT 1 FROM cs_ticket_tags tt WHERE tt.ticket_id = t.id AND tt.tag = $${params.length})`);
    }
    if (customer) { params.push(`%${customer}%`); conditions.push(`t.customer_name ILIKE $${params.length}`); }
    if (email) { params.push(email.toLowerCase()); conditions.push(`LOWER(t.customer_email) = $${params.length}`); }
    if (ticketId) { params.push(ticketId); conditions.push(`t.ticket_number = $${params.length}`); }
    if (dateFrom) { params.push(dateFrom); conditions.push(`t.created_at >= $${params.length}::date`); }
    if (dateTo) { params.push(dateTo); conditions.push(`t.created_at < ($${params.length}::date + INTERVAL '1 day')`); }
    if (searchQ) {
      params.push(`%${searchQ}%`);
      conditions.push(`(t.subject ILIKE $${params.length} OR t.customer_name ILIKE $${params.length} OR t.ticket_number ILIKE $${params.length})`);
    }

    let orderBy = 'COALESCE(t.sla_resolution_due, t.sla_first_response_due) ASC NULLS LAST';
    if (sort === 'newest') orderBy = 't.created_at DESC';
    if (sort === 'oldest') orderBy = 't.created_at ASC';
    if (sort === 'priority') orderBy = `CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.created_at DESC`;

    const sql = `
      SELECT ${ticketSelectFields('t')}
      FROM cs_tickets t
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT 500`;

    const cases = await q(sql, params);
    const allCasesReferencePool = await countPool();
    res.json({ cases, allCasesReferencePool });
  } catch (err) {
    console.error('[cs/queue]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Create ticket ───────────────────────────────────────────────────────────
router.post('/cases', requireCsView, async (req, res) => {
  try {
    const actor = actorFromReq(req);
    const {
      customerName, customerEmail, customerPhone, subject, description,
      priority, queueId, queueSlug, platform, caseRef, orderId, tags, source,
    } = req.body;

    if (!customerName || !subject) {
      return res.status(400).json({ error: 'customerName and subject are required' });
    }

    let qid = queueId;
    if (!qid && queueSlug) {
      const qr = await qOne('SELECT id FROM cs_queues WHERE slug = $1', [queueSlug]);
      qid = qr?.id;
    }

    const ticket = await createTicketFromSource({
      customerName, customerEmail, customerPhone, subject, description,
      priority: priority || 'medium', queueId: qid,
      source: source || 'manual', platform: platform || 'manual',
      caseRef, orderId, tags: tags || [],
      createdBy: req.user.id, actor, req,
    });

    emit('cs:ticket-created', { ticketId: ticket.id, ticket });
    res.status(201).json({ ok: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Ticket detail ───────────────────────────────────────────────────────────
router.get('/cases/:id', requireCsView, loadTicket, assertTicketAccess, async (req, res) => {
  try {
    const ticket = req.csTicket;
    const actor = actorFromReq(req);

    const [thread, teamNoteRows, assignLog, statusLog, personalNote, tags, history] = await Promise.all([
      q(`SELECT id, direction, author_name, author_id, body, attachments, created_at,
                delivery_status, read_at, is_internal, is_pinned, reply_to_id, message_type
         FROM cs_messages WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticket.id]),
      q(`SELECT n.id, n.author_id AS "authorId", u.full_name AS "authorName",
                n.body, n.attachments, n.mentions, n.created_at AS "createdAt", n.updated_at AS "updatedAt"
         FROM cs_team_notes n JOIN users u ON u.id = n.author_id
         WHERE n.ticket_id = $1 ORDER BY n.created_at ASC`, [ticket.id]),
      q(`SELECT id, action, actor_name AS "actorName", from_agent_name AS "fromName",
                to_agent_name AS "toName", to_agent_id AS "toId", created_at AS "createdAt", created_at AS at
         FROM cs_assignment_log WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticket.id]),
      q(`SELECT id, actor_name AS "actorName", from_status AS "fromStatus", to_status AS "toStatus",
                created_at AS "createdAt", created_at AS at, 'status' AS "sysType"
         FROM cs_status_log WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticket.id]),
      qOne(`SELECT html, collapsed, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM cs_personal_notes WHERE ticket_id = $1 AND user_id = $2`, [ticket.id, req.user.id]),
      q(`SELECT tag FROM cs_ticket_tags WHERE ticket_id = $1`, [ticket.id]),
      getTicketHistory(ticket.id),
    ]);

    await q(`UPDATE cs_tickets SET is_new = FALSE WHERE id = $1 AND is_new = TRUE`, [ticket.id]);

    const assignee = ticket.assignee_id
      ? await qOne('SELECT full_name FROM users WHERE id = $1', [ticket.assignee_id])
      : null;

    res.json({
      ticket: {
        ...ticket,
        customer: ticket.customer_name,
        email: ticket.customer_email,
        address: ticket.customer_address,
        assigneeId: ticket.assignee_id,
        isNew: ticket.is_new,
        slaDueAt: ticket.sla_resolution_due || ticket.sla_first_response_due,
        caseRef: ticket.case_ref,
        tags: tags.map((t) => t.tag),
      },
      thread: thread.map(formatMessageRow),
      notes: {
        team: teamNoteRows.map((n) => ({
          ...n,
          canEdit: n.authorId === req.user.id || permissionsFor(req.user).manageNotes,
        })),
        personal: personalNote ? { [req.user.id]: { ...personalNote, authorId: req.user.id } } : {},
      },
      assignmentLog: assignLog,
      statusLog,
      history,
      order: {
        ref: ticket.case_ref || ticket.order_id || '—',
        external: ticket.case_ref || '—',
        status: ticket.status,
        customer: ticket.customer_name,
        email: ticket.customer_email,
        address: ticket.customer_address || '—',
        items: [],
        total: '—',
      },
      details: {
        status: ticket.status,
        priority: ticket.priority || 'medium',
        opened: ticket.opened_at,
        channel: ticket.channel || ticket.platform || '—',
        assignee: assignee?.full_name || 'Unassigned',
        matched: ticket.matched,
      },
    });
  } catch (err) {
    console.error('[cs/case detail]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Reply ───────────────────────────────────────────────────────────────────
router.post('/cases/:id/reply', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  try {
    const ticket = req.csTicket;
    const actor = actorFromReq(req);
    const { body, attachments = [], replyToId } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Reply body is required' });

    const msgId = uuidv4();
    const [savedMsg] = await withTx(async (txQ) => {
      const [msg] = await txQ(
        `INSERT INTO cs_messages (id, ticket_id, direction, author_name, author_id, body, attachments, reply_to_id)
         VALUES ($1,$2,'out',$3,$4,$5,$6,$7)
         RETURNING *`,
        [msgId, ticket.id, actor.name, actor.id, body.trim(), JSON.stringify(attachments), replyToId || null]
      );

      const advance = ['new', 'new_ticket', 'open', 'to_do', 'assigned'];
      if (advance.includes(ticket.status)) {
        await txQ(`UPDATE cs_tickets SET status = 'in_progress', updated_at = NOW() WHERE id = $1`, [ticket.id]);
      } else {
        await txQ(`UPDATE cs_tickets SET updated_at = NOW(), snippet = $1 WHERE id = $2`, [body.slice(0, 200), ticket.id]);
      }

      await markFirstResponse(ticket.id, txQ);
      await recordHistory({
        ticketId: ticket.id, actor, action: 'replied', fieldName: 'message',
        newValue: msgId, req,
      });

      return [msg];
    });

    let emailSent = false;
    let emailError = null;
    let emailMessageId = null;
    try {
      const r = await sendEmailToCustomer({ ticket, body: body.trim(), fromName: actor.name });
      emailSent = true;
      emailMessageId = r.messageId;
      await q(`UPDATE cs_messages SET email_message_id = $1, delivery_status = 'sent' WHERE id = $2`, [emailMessageId, msgId]);
    } catch (err) {
      emailError = err.message;
      await q(`UPDATE cs_messages SET delivery_status = 'failed' WHERE id = $1`, [msgId]);
    }

    const formatted = formatMessageRow(savedMsg);
    emit('cs:message', { ticketId: ticket.id, message: formatted });
    emit('cs:dashboard-update', { ticketId: ticket.id });

    res.json({ ok: true, message: formatted, emailSent, emailError, emailMessageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Status ──────────────────────────────────────────────────────────────────
router.patch('/cases/:id/status', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  try {
    const ticket = req.csTicket;
    const actor = actorFromReq(req);
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const statusRow = await qOne('SELECT * FROM cs_statuses WHERE key = $1', [status]);
    if (!statusRow) return res.status(400).json({ error: 'Invalid status' });

    const [updated] = await withTx(async (txQ) => {
      const [t] = await txQ(
        `UPDATE cs_tickets SET status = $1, updated_at = NOW(),
           resolved_at = CASE WHEN $2 THEN NOW() ELSE resolved_at END,
           closed_at = CASE WHEN $3 THEN NOW() ELSE closed_at END
         WHERE id = $4 RETURNING *`,
        [status, statusRow.is_resolved, statusRow.is_closed, ticket.id]
      );

      if (statusRow.pauses_sla) await pauseSla(ticket.id, txQ);
      else await resumeSla(ticket.id, txQ);

      await recordHistory({
        ticketId: ticket.id, actor, action: 'status_changed',
        fieldName: 'status', oldValue: ticket.status, newValue: status, req,
      });

      return [t];
    });

    const allCasesReferencePool = await countPool();
    emit('cs:status-change', { ticketId: ticket.id, status, ticket: updated });
    res.json({ ok: true, ticket: updated, allCasesReferencePool });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Category / Queue change ─────────────────────────────────────────────────
router.patch('/cases/:id/category', requireCsAssign, loadTicket, async (req, res) => {
  try {
    const ticket = req.csTicket;
    const actor = actorFromReq(req);
    const { category, queueId, queueSlug } = req.body;

    let qid = queueId;
    if (!qid && queueSlug) {
      const qr = await qOne('SELECT id, slug FROM cs_queues WHERE slug = $1', [queueSlug]);
      qid = qr?.id;
    }

    const newCategory = category || (qid ? (await qOne('SELECT slug FROM cs_queues WHERE id = $1', [qid]))?.slug : null);
    if (!newCategory && !qid) return res.status(400).json({ error: 'category or queueId required' });

    const [updated] = await q(
      `UPDATE cs_tickets SET category = COALESCE($1, category), queue_id = COALESCE($2, queue_id), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [newCategory, qid, ticket.id]
    );

    await recordHistory({
      ticketId: ticket.id, actor, action: 'queue_changed',
      fieldName: 'queue', oldValue: ticket.category, newValue: newCategory, req,
    });

    emit('cs:queue-change', { ticketId: ticket.id, queueId: qid, category: newCategory });
    res.json({ success: true, ticket: updated, allCasesReferencePool: await countPool() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Priority ────────────────────────────────────────────────────────────────
router.patch('/cases/:id/priority', requireCsAssign, loadTicket, async (req, res) => {
  try {
    const ticket = req.csTicket;
    const actor = actorFromReq(req);
    const { priority } = req.body;
    const allowed = ['low', 'medium', 'high', 'urgent'];
    if (!allowed.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });

    const [updated] = await q(
      `UPDATE cs_tickets SET priority = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [priority, ticket.id]
    );

    await recordHistory({
      ticketId: ticket.id, actor, action: 'priority_changed',
      fieldName: 'priority', oldValue: ticket.priority, newValue: priority, req,
    });

    emit('cs:priority-change', { ticketId: ticket.id, priority });
    res.json({ ok: true, ticket: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Assign ──────────────────────────────────────────────────────────────────
router.post('/cases/:id/assign', requireCsReply, loadTicket, async (req, res) => {
  try {
    const ticket = req.csTicket;
    const actor = actorFromReq(req);
    const agentId = req.body.agentId === null ? null : parseInt(req.body.agentId, 10);

    if (req.body.agentId === undefined) return res.status(400).json({ error: 'agentId is required' });

    if (ticket.assignee_id && !(await canReassign(req, ticket))) {
      return res.status(403).json({ error: 'Only team leaders can reassign tickets' });
    }
    if (!ticket.assignee_id && agentId && !(await canAssign(req))) {
      return res.status(403).json({ error: 'You do not have permission to assign tickets' });
    }

    let newAgent = null;
    if (agentId) {
      newAgent = await qOne('SELECT id, full_name AS name FROM users WHERE id = $1', [agentId]);
      if (!newAgent) return res.status(404).json({ error: 'Agent not found' });
    }

    const prevAgent = ticket.assignee_id
      ? await qOne('SELECT id, full_name AS name FROM users WHERE id = $1', [ticket.assignee_id])
      : null;

    const action = agentId == null ? 'unassign' : (prevAgent ? 'reassign' : 'assign');

    const [logEntry, updatedTicket] = await withTx(async (txQ) => {
      const [t] = await txQ(
        `UPDATE cs_tickets SET assignee_id = $1, matched = TRUE, status = CASE WHEN $1 IS NOT NULL AND status = 'new' THEN 'assigned' ELSE status END, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [agentId, ticket.id]
      );

      const [log] = await txQ(
        `INSERT INTO cs_assignment_log (id, ticket_id, action, actor_id, actor_name, from_agent_id, from_agent_name, to_agent_id, to_agent_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, action, actor_name AS "actorName", from_agent_name AS "fromName", to_agent_name AS "toName", to_agent_id AS "toId", created_at AS at`,
        [uuidv4(), ticket.id, action, actor.id, actor.name,
          prevAgent?.id || null, prevAgent?.name || null, newAgent?.id || null, newAgent?.name || null]
      );

      await recordHistory({
        ticketId: ticket.id, actor, action,
        fieldName: 'assignee', oldValue: prevAgent?.name, newValue: newAgent?.name || 'Unassigned', req,
      });

      return [log, t];
    });

    if (agentId) await notifyAssignment({ ticket: updatedTicket, assigneeId: agentId, actor, action });
    emit('cs:assignment', { ticketId: ticket.id, assigneeId: agentId, action, userId: agentId });

    res.json({ ok: true, ticket: updatedTicket, logEntry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Match ───────────────────────────────────────────────────────────────────
router.post('/cases/:id/match', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  try {
    const ticket = req.csTicket;
    const actor = actorFromReq(req);
    const { platform, orderRef, order_ref: orderRefAlt } = req.body;
    if (!platform) return res.status(400).json({ error: 'platform is required' });

    const [updated] = await withTx(async (txQ) => {
      const [t] = await txQ(
        `UPDATE cs_tickets SET matched = TRUE, platform = $1, case_ref = COALESCE($2, case_ref), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [platform, orderRef || orderRefAlt || null, ticket.id]
      );
      await recordHistory({ ticketId: ticket.id, actor, action: 'matched', newValue: platform, req });
      return [t];
    });

    res.json({ ok: true, ticket: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Merge tickets ───────────────────────────────────────────────────────────
router.post('/cases/:id/merge', requireCsAssign, loadTicket, async (req, res) => {
  try {
    const primary = req.csTicket;
    const actor = actorFromReq(req);
    const { targetId } = req.body;
    const secondary = await qOne('SELECT * FROM cs_tickets WHERE id = $1 AND deleted_at IS NULL', [targetId]);
    if (!secondary) return res.status(404).json({ error: 'Secondary ticket not found' });

    await withTx(async (txQ) => {
      await txQ(`UPDATE cs_messages SET ticket_id = $1 WHERE ticket_id = $2`, [primary.id, secondary.id]);
      await txQ(`UPDATE cs_team_notes SET ticket_id = $1 WHERE ticket_id = $2`, [primary.id, secondary.id]);
      await txQ(`UPDATE cs_tickets SET deleted_at = NOW(), status = 'closed' WHERE id = $1`, [secondary.id]);
    });

    await recordHistory({
      ticketId: primary.id, actor, action: 'merged',
      oldValue: secondary.ticket_number, newValue: primary.ticket_number, req,
    });

    res.json({ ok: true, ticketId: primary.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete ticket (admin only) ──────────────────────────────────────────────
router.delete('/cases/:id', requireCsAdmin, loadTicket, async (req, res) => {
  try {
    const actor = actorFromReq(req);
    await q(`UPDATE cs_tickets SET deleted_at = NOW() WHERE id = $1`, [req.csTicket.id]);
    await recordHistory({ ticketId: req.csTicket.id, actor, action: 'deleted', req });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Timeline ────────────────────────────────────────────────────────────────
router.get('/cases/:id/timeline', requireCsView, loadTicket, assertTicketAccess, async (req, res) => {
  try {
    const timeline = await getActivityTimeline(req.csTicket.id);
    res.json({ timeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Team notes ──────────────────────────────────────────────────────────────
router.get('/cases/:id/notes', requireCsView, loadTicket, assertTicketAccess, async (req, res) => {
  const notes = await q(
    `SELECT n.id, n.author_id AS "authorId", u.full_name AS "authorName", n.body, n.attachments, n.mentions,
            n.created_at AS "createdAt", n.updated_at AS "updatedAt"
     FROM cs_team_notes n JOIN users u ON u.id = n.author_id
     WHERE n.ticket_id = $1 ORDER BY n.created_at ASC`, [req.csTicket.id]);
  res.json({ notes });
});

router.post('/cases/:id/notes', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  try {
    const actor = actorFromReq(req);
    const { body, attachments = [], mentions = [] } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Note body is required' });

    const [note] = await q(
      `INSERT INTO cs_team_notes (id, ticket_id, author_id, body, attachments, mentions)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, author_id AS "authorId", body, attachments, mentions, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [uuidv4(), req.csTicket.id, actor.id, body.trim(), JSON.stringify(attachments), JSON.stringify(mentions)]
    );

    await recordHistory({ ticketId: req.csTicket.id, actor, action: 'internal_note_added', req });
    emit('cs:internal-note', { ticketId: req.csTicket.id, note: { ...note, authorName: actor.name } });

    res.json({ ok: true, note: { ...note, authorName: actor.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/cases/:id/notes/:noteId', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  const note = await qOne('SELECT * FROM cs_team_notes WHERE id = $1 AND ticket_id = $2', [req.params.noteId, req.csTicket.id]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.author_id !== req.user.id && !permissionsFor(req.user).manageNotes) {
    return res.status(403).json({ error: 'Only the author can edit this note' });
  }
  const { body } = req.body;
  const [updated] = await q(
    `UPDATE cs_team_notes SET body = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, author_id AS "authorId", body, attachments, mentions, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [body.trim(), note.id]
  );
  res.json({ ok: true, note: updated });
});

router.delete('/cases/:caseId/notes/:noteId', requireCsReply, async (req, res) => {
  const note = await qOne('SELECT author_id FROM cs_team_notes WHERE id = $1', [req.params.noteId]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.author_id !== req.user.id && !permissionsFor(req.user).manageNotes) {
    return res.status(403).json({ error: 'Access denied' });
  }
  await q('DELETE FROM cs_team_notes WHERE id = $1', [req.params.noteId]);
  res.json({ ok: true });
});

// ─── Personal notes ──────────────────────────────────────────────────────────
router.put('/cases/:id/notes/personal', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  const { html } = req.body;
  await q(
    `INSERT INTO cs_personal_notes (ticket_id, user_id, html)
     VALUES ($1,$2,$3)
     ON CONFLICT (ticket_id, user_id) DO UPDATE SET html = $3, updated_at = NOW()`,
    [req.csTicket.id, req.user.id, html || '']
  );
  res.json({ ok: true });
});

router.patch('/cases/:id/notes/personal', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  const { collapsed } = req.body;
  await q(
    `UPDATE cs_personal_notes SET collapsed = $1, updated_at = NOW() WHERE ticket_id = $2 AND user_id = $3`,
    [!!collapsed, req.csTicket.id, req.user.id]
  );
  res.json({ ok: true });
});

router.delete('/cases/:id/notes/personal', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  await q('DELETE FROM cs_personal_notes WHERE ticket_id = $1 AND user_id = $2', [req.csTicket.id, req.user.id]);
  res.json({ ok: true });
});

// ─── Order cases ─────────────────────────────────────────────────────────────
router.get('/cases/:id/order-cases', requireCsView, loadTicket, assertTicketAccess, async (req, res) => {
  const cases = await q(
    `SELECT id, type, opened_at AS "openedAt", resolved_at AS "resolvedAt"
     FROM cs_order_cases WHERE ticket_id = $1 AND resolved_at IS NULL ORDER BY opened_at ASC`,
    [req.csTicket.id]
  );
  res.json({ cases });
});

router.post('/cases/:id/order-cases', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });
  const [entry] = await q(
    `INSERT INTO cs_order_cases (id, ticket_id, type) VALUES ($1,$2,$3)
     RETURNING id, type, opened_at AS "openedAt"`,
    [uuidv4(), req.csTicket.id, type]
  );
  res.status(201).json({ ok: true, case: entry });
});

router.delete('/cases/:id/order-cases/:caseId', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  await q(
    `UPDATE cs_order_cases SET resolved_at = NOW(), resolved_by = $1 WHERE id = $2 AND ticket_id = $3`,
    [req.user.id, req.params.caseId, req.csTicket.id]
  );
  res.json({ ok: true });
});

// ─── Customer orders ─────────────────────────────────────────────────────────
router.get('/customers/:email/orders', requireCsView, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const orders = await q(
    `SELECT order_id AS "orderId", channel, status, order_date AS date, total
     FROM cs_order_history WHERE LOWER(customer_email) = $1 ORDER BY order_date DESC`, [email]
  );
  res.json({ orders });
});

// ─── Templates ───────────────────────────────────────────────────────────────
router.get('/templates', requireCsView, async (req, res) => {
  const templateRows = await q(
    `SELECT t.id, t.title, t.body, LOWER(c.name) AS category, t.favorite, t.color
     FROM cs_templates t LEFT JOIN cs_template_categories c ON t.category_id = c.id
     ORDER BY t.favorite DESC, t.title ASC`
  );
  const categoryRows = await q('SELECT name FROM cs_template_categories ORDER BY id ASC');
  res.json({ templates: templateRows, categories: categoryRows.map((r) => r.name) });
});

router.post('/templates', requirePermission('cs.templates.manage'), async (req, res) => {
  const { title, body, category } = req.body;
  const cat = await qOne('SELECT id FROM cs_template_categories WHERE LOWER(name) = $1 LIMIT 1', [String(category || 'general').toLowerCase()]);
  const [newTpl] = await q(
    `INSERT INTO cs_templates (title, body, category_id, favorite) VALUES ($1,$2,$3,FALSE) RETURNING id, title, body, favorite`,
    [title || 'New template', body || '', cat?.id || 1]
  );
  res.status(201).json(newTpl);
});

router.patch('/templates/:id', requirePermission('cs.templates.manage'), async (req, res) => {
  const { title, body, category, favorite, color } = req.body;
  let categoryId;
  if (category) {
    const cat = await qOne('SELECT id FROM cs_template_categories WHERE LOWER(name) = $1 LIMIT 1', [String(category).toLowerCase()]);
    categoryId = cat?.id;
  }
  const [updated] = await q(
    `UPDATE cs_templates SET title = COALESCE($1,title), body = COALESCE($2,body),
       category_id = COALESCE($3,category_id), favorite = COALESCE($4,favorite), color = COALESCE($5,color), updated_at = NOW()
     WHERE id = $6 RETURNING id`,
    [title, body, categoryId, favorite, color, req.params.id]
  );
  if (!updated) return res.status(404).json({ error: 'Template not found' });
  res.json({ ok: true });
});

router.delete('/templates/:id', requirePermission('cs.templates.manage'), async (req, res) => {
  const r = await q('DELETE FROM cs_templates WHERE id = $1 RETURNING id', [req.params.id]);
  if (!r.length) return res.status(404).json({ error: 'Template not found' });
  res.json({ ok: true });
});

router.post('/templates/:id/touch', requireCsView, async (req, res) => {
  await q(`INSERT INTO cs_template_usage (template_id, user_id) VALUES ($1,$2)`, [req.params.id, req.user.id]);
  await q(`UPDATE cs_templates SET usage_count = usage_count + 1 WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ─── Statuses CRUD ───────────────────────────────────────────────────────────
router.get('/statuses', requireCsView, async (req, res) => {
  const statuses = await q('SELECT * FROM cs_statuses ORDER BY sort_order, key');
  res.json({ statuses });
});

router.post('/statuses', requireCsAdmin, async (req, res) => {
  const { key, label, color, icon } = req.body;
  const [status] = await q(
    `INSERT INTO cs_statuses (key, label, color, icon) VALUES ($1,$2,$3,$4)
     ON CONFLICT (key) DO NOTHING RETURNING *`,
    [key, label, color || '#9b8e7d', icon || 'ti-circle-dot']
  );
  res.json({ ok: true, status });
});

router.patch('/statuses/:key', requireCsAdmin, async (req, res) => {
  const { label, color, icon } = req.body;
  const [updated] = await q(
    `UPDATE cs_statuses SET label = COALESCE($1,label), color = COALESCE($2,color), icon = COALESCE($3,icon), updated_at = NOW()
     WHERE key = $4 RETURNING *`,
    [label, color, icon, req.params.key]
  );
  if (!updated) return res.status(404).json({ error: 'Status not found' });
  res.json({ ok: true, status: updated });
});

router.delete('/statuses/:key', requireCsAdmin, async (req, res) => {
  const r = await q('DELETE FROM cs_statuses WHERE key = $1 RETURNING key', [req.params.key]);
  if (!r.length) return res.status(404).json({ error: 'Status not found' });
  res.json({ ok: true });
});

// ─── Tags ────────────────────────────────────────────────────────────────────
router.post('/cases/:id/tags', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  const { tag } = req.body;
  if (!tag) return res.status(400).json({ error: 'tag required' });
  await q(
    `INSERT INTO cs_ticket_tags (ticket_id, tag, created_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [req.csTicket.id, tag, req.user.id]
  );
  res.json({ ok: true });
});

router.delete('/cases/:id/tags/:tag', requireCsReply, loadTicket, assertTicketAccess, async (req, res) => {
  await q('DELETE FROM cs_ticket_tags WHERE ticket_id = $1 AND tag = $2', [req.csTicket.id, req.params.tag]);
  res.json({ ok: true });
});

// ─── Saved filters ───────────────────────────────────────────────────────────
router.get('/filters', requireCsView, async (req, res) => {
  const filters = await q(
    `SELECT id, name, filters, is_default AS "isDefault" FROM cs_saved_filters WHERE user_id = $1 ORDER BY name`,
    [req.user.id]
  );
  res.json({ filters });
});

router.post('/filters', requireCsView, async (req, res) => {
  const { name, filters, isDefault } = req.body;
  const [row] = await q(
    `INSERT INTO cs_saved_filters (user_id, name, filters, is_default) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, name, JSON.stringify(filters || {}), !!isDefault]
  );
  res.status(201).json({ filter: row });
});

router.delete('/filters/:id', requireCsView, async (req, res) => {
  await q('DELETE FROM cs_saved_filters WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ─── Global search ───────────────────────────────────────────────────────────
router.get('/search', requireCsView, async (req, res) => {
  const term = (req.query.q || '').trim();
  if (!term) return res.json({ tickets: [], messages: [] });

  const like = `%${term}%`;
  const [tickets, messages] = await Promise.all([
    q(
      `SELECT ${ticketSelectFields('t')} FROM cs_tickets t
       WHERE t.deleted_at IS NULL AND (
         t.ticket_number ILIKE $1 OR t.subject ILIKE $1 OR t.customer_name ILIKE $1
         OR t.customer_email ILIKE $1 OR t.customer_phone ILIKE $1 OR t.case_ref ILIKE $1 OR t.order_id ILIKE $1
       ) ORDER BY t.updated_at DESC LIMIT 50`, [like]
    ),
    q(
      `SELECT m.id, m.ticket_id AS "ticketId", m.body, m.author_name AS "authorName", m.created_at AS "createdAt"
       FROM cs_messages m JOIN cs_tickets t ON t.id = m.ticket_id
       WHERE t.deleted_at IS NULL AND m.body ILIKE $1 ORDER BY m.created_at DESC LIMIT 30`, [like]
    ),
  ]);

  res.json({ tickets, messages });
});

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', requireCsView, async (req, res) => {
  try {
    const [totals, queueStats, agentStats, slaViolations, todayCount] = await Promise.all([
      qOne(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status NOT IN ('closed','resolved','spam','cancelled'))::int AS open,
           COUNT(*) FILTER (WHERE status IN ('pending_customer','pending_internal','waiting'))::int AS pending,
           COUNT(*) FILTER (WHERE status IN ('resolved','closed'))::int AS resolved,
           COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
           AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60)::int AS avg_response_min,
           AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/60)::int AS avg_resolution_min
         FROM cs_tickets WHERE deleted_at IS NULL`
      ),
      q(
        `SELECT q.name, q.slug, q.color, COUNT(t.id)::int AS count
         FROM cs_queues q LEFT JOIN cs_tickets t ON t.queue_id = q.id AND t.deleted_at IS NULL
         WHERE q.is_active = TRUE GROUP BY q.id ORDER BY q.sort_order`
      ),
      q(
        `SELECT u.full_name AS name, u.id,
                COUNT(t.id)::int AS assigned,
                COUNT(t.id) FILTER (WHERE t.status IN ('resolved','closed'))::int AS resolved,
                AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at))/60)::int AS avg_response_min
         FROM users u
         JOIN cs_tickets t ON t.assignee_id = u.id AND t.deleted_at IS NULL
         WHERE t.created_at > NOW() - INTERVAL '30 days'
         GROUP BY u.id ORDER BY assigned DESC LIMIT 20`
      ),
      getSlaViolations(),
      qOne(`SELECT COUNT(*)::int AS count FROM cs_tickets WHERE deleted_at IS NULL AND created_at >= CURRENT_DATE`),
    ]);

    res.json({
      totals,
      queueStats,
      agentStats,
      slaViolations,
      todayTickets: todayCount?.count || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Notifications ───────────────────────────────────────────────────────────
router.get('/notifications', requireCsView, async (req, res) => {
  const notifications = await getUnreadNotifications(req.user.id);
  res.json({ notifications });
});

router.post('/notifications/:id/read', requireCsView, async (req, res) => {
  await q('UPDATE cs_notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ─── Delegation ──────────────────────────────────────────────────────────────
router.post('/delegation', requireCsAssign, async (req, res) => {
  const { delegateId, permissions: perms, expiresAt } = req.body;
  if (!delegateId || !expiresAt) return res.status(400).json({ error: 'delegateId and expiresAt required' });
  const [row] = await q(
    `INSERT INTO cs_delegated_permissions (delegator_id, delegate_id, permissions, expires_at)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, delegateId, JSON.stringify(perms || ['assign']), expiresAt]
  );
  res.status(201).json({ delegation: row });
});

router.get('/delegation/active', requireCsView, async (req, res) => {
  const rows = await q(
    `SELECT d.*, u.full_name AS "delegateName"
     FROM cs_delegated_permissions d JOIN users u ON u.id = d.delegate_id
     WHERE d.delegator_id = $1 AND d.revoked_at IS NULL AND d.expires_at > NOW()`,
    [req.user.id]
  );
  res.json({ delegations: rows });
});

router.delete('/delegation/:id', requireCsAssign, async (req, res) => {
  await q(
    `UPDATE cs_delegated_permissions SET revoked_at = NOW() WHERE id = $1 AND delegator_id = $2`,
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

// ─── SLA config ──────────────────────────────────────────────────────────────
router.get('/sla/rules', requireCsView, async (req, res) => {
  const rules = await q('SELECT * FROM cs_sla_rules WHERE is_active = TRUE ORDER BY id');
  const hours = await q('SELECT * FROM cs_business_hours ORDER BY day_of_week');
  const holidays = await q('SELECT * FROM cs_holidays ORDER BY holiday_date');
  res.json({ rules, businessHours: hours, holidays });
});

router.post('/sla/rules', requireCsAdmin, async (req, res) => {
  const { name, queueId, priority, firstResponseMinutes, resolutionMinutes } = req.body;
  const [rule] = await q(
    `INSERT INTO cs_sla_rules (name, queue_id, priority, first_response_minutes, resolution_minutes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, queueId || null, priority || null, firstResponseMinutes || 240, resolutionMinutes || 2880]
  );
  res.status(201).json({ rule });
});

// ─── Routing rules ───────────────────────────────────────────────────────────
router.get('/routing/rules', requireCsAdmin, async (req, res) => {
  const rules = await q('SELECT * FROM cs_routing_rules ORDER BY priority, id');
  res.json({ rules });
});

router.post('/routing/rules', requireCsAdmin, async (req, res) => {
  const { name, ruleType, priority, conditions, actions } = req.body;
  const [rule] = await q(
    `INSERT INTO cs_routing_rules (name, rule_type, priority, conditions, actions)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, ruleType, priority || 100, JSON.stringify(conditions || {}), JSON.stringify(actions || {})]
  );
  res.status(201).json({ rule });
});

// ─── Webhook / API ticket creation ───────────────────────────────────────────
router.post('/webhook/ticket', async (req, res) => {
  const secret = req.headers['x-cs-webhook-secret'] || req.body.secret;
  if (process.env.CS_WEBHOOK_SECRET && secret !== process.env.CS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const { customerName, customerEmail, subject, description, priority, queueSlug, tags, source } = req.body;
    const ticket = await createTicketFromSource({
      customerName: customerName || customerEmail,
      customerEmail, subject: subject || 'Webhook ticket',
      description, priority, queueSlug, tags, source: source || 'webhook',
      actor: { name: 'Webhook', role: 'system' }, req,
    });
    emit('cs:ticket-created', { ticketId: ticket.id, ticket });
    res.status(201).json({ ok: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Email ingest (webhook from mail provider) ───────────────────────────────
router.post('/webhook/email', async (req, res) => {
  const secret = req.headers['x-cs-webhook-secret'] || req.body.secret;
  if (process.env.CS_WEBHOOK_SECRET && secret !== process.env.CS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const { from, fromName, subject, body, messageId, inReplyTo, attachments, queueId } = req.body;
    const result = await findOrCreateTicketFromEmail({
      fromEmail: from, fromName, subject, body, messageId, inReplyTo, attachments, queueId,
    });
    emit('cs:ticket-created', { ticketId: result.ticket.id, ticket: result.ticket, created: result.created });
    emit('cs:message', { ticketId: result.ticket.id });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Contact form ────────────────────────────────────────────────────────────
router.post('/contact-form', async (req, res) => {
  try {
    const { name, email, subject, message, phone } = req.body;
    if (!email || !message) return res.status(400).json({ error: 'email and message required' });

    const ticket = await createTicketFromSource({
      customerName: name || email,
      customerEmail: email,
      customerPhone: phone,
      subject: subject || 'Contact form submission',
      description: message,
      source: 'contact_form',
      queueSlug: 'support',
      actor: { name: 'Contact Form', role: 'system' },
      req,
    });

    emit('cs:ticket-created', { ticketId: ticket.id, ticket });
    res.status(201).json({ ok: true, ticketNumber: ticket.ticket_number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Presence ────────────────────────────────────────────────────────────────
router.get('/presence', requireCsView, async (req, res) => {
  const rows = await q(
    `SELECT p.ticket_id AS "ticketId", p.user_id AS "userId", u.full_name AS "userName",
            p.status, p.last_seen_at AS "lastSeenAt"
     FROM cs_ticket_presence p JOIN users u ON u.id = p.user_id
     WHERE p.last_seen_at > NOW() - INTERVAL '2 minutes'`
  );
  res.json({ presence: rows });
});

function requirePermission(slug) {
  const { requirePermission: rp } = require('../../auth');
  return rp(slug);
}

module.exports = router;
module.exports.setCsSocket = setCsSocket;
