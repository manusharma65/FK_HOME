/**
 * cs-backend.js  —  Customer Service Module  (PostgreSQL edition)
 * ================================================================
 * Every operation is persisted to PostgreSQL via the `pg` pool.
 * Run the schema first:  psql -U postgres -d your_db -f cs-schema.sql
 *
 * Mount:   app.use('/api/cs', require('./cs-backend'));
 * Standalone: node cs-backend.js
 *
 * Auth: this router assumes req.user is already populated by your app's
 * existing session/auth middleware BEFORE this router is mounted, e.g.:
 *   app.use(sessionAuthMiddleware);   // sets req.user = { id, full_name, ... }
 *   app.use('/api/cs', require('./cs-backend'));
 * Every route below reads req.user — there is no separate fake-user helper.
 *
 * Env vars (.env):
 *   DATABASE_URL   postgres://user:pass@host:5432/dbname
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
 *   PORT           (default 3001)
 */

'use strict';

require('dotenv').config();

const express        = require('express');
const { Pool }        = require('pg');
const { v4: uuidv4 }  = require('uuid');
const nodemailer      = require('nodemailer');
const db = require('../db').db;


const router = express.Router();
router.use(express.json({ limit: '10mb' }));

// ─────────────────────────────────────────────────────────────
// DATABASE POOL
// ─────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgres://postgres:password@localhost:5432/cs_helpdesk',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB Pool Error]', err.message);
});

/** Execute a parameterized query. Returns rows array. */
async function q(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

/** Execute inside a transaction. cb receives a txQ helper bound to one client. */
async function withTx(cb) {
  const client = await pool.connect();
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

// ─────────────────────────────────────────────────────────────
// EMAIL TRANSPORT
// ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.ethereal.email',
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'test@ethereal.email',
    pass: process.env.SMTP_PASS || 'testpassword',
  },
});

async function sendEmailToCustomer({ ticket, body, fromName }) {
  if (!ticket || !ticket.customer_email)
    throw new Error('Customer email unknown — cannot send.');
  const info = await transporter.sendMail({
    from:    `"${fromName || 'Customer Support'}" <${process.env.SMTP_FROM || 'support@example.com'}>`,
    to:      ticket.customer_email,
    subject: `Re: [${ticket.case_ref}] ${ticket.subject}`,
    text:    body,
    html:    `<p>${body.replace(/\n/g, '<br>')}</p>`,
  });
  return { messageId: info.messageId };
}

// ─────────────────────────────────────────────────────────────
// AUTH / PERMISSIONS
// ─────────────────────────────────────────────────────────────
// req.user is set upstream by the app's existing session middleware.
// This guard makes that requirement explicit and gives a clean 401
// instead of a "Cannot read properties of undefined" crash if it's ever
// missing (e.g. router mounted before auth middleware by mistake).
function requireUser(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}
router.use(requireUser);

function isTeamLeadRole(role) {
  const r = String(role || '').toLowerCase();
  return r.includes('lead') || r.includes('manager') || r.includes('senior') || r === 'admin' || r === 'supervisor';
}

function permissionsFor(user) {
  const lead = isTeamLeadRole(user.role);
  return {
    assign:      lead,
    templates:   lead,
    manageNotes: lead,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
async function getTicketOr404(id, res) {
  const [ticket] = await q('SELECT * FROM public.cs_tickets WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!ticket) { res.status(404).json({ error: 'Case not found' }); return null; }
  return ticket;
}

// ─────────────────────────────────────────────────────────────
// TICKET CREATION + QUEUE ROUTING
//
// Req 2: every new ticket lands in All Work automatically (GET /queue with
// no `view` param has no assignee/status filter, so it's already there —
// nothing extra needed for that half). Based on cs_queue_routing, it's also
// placed in the right queue (its `category`).
// Req 3: if that category currently has an employee configured in
// cs_queue_routing, the ticket is auto-assigned to them, so it shows up in
// their My Work immediately (My Work = WHERE assignee_id = req.user.id).
//
// This is the single entry point for creating a ticket — used by the
// manual-creation route below AND by the email-ingestion poller
// (server/email/imapPoller.js), so both paths get identical routing
// behavior instead of two implementations drifting apart.
// ─────────────────────────────────────────────────────────────
async function resolveQueueAgent(category) {
  const [row] = await q(
    `SELECT agent_id AS "agentId" FROM public.cs_queue_routing WHERE category = $1`,
    [category]
  );
  return row ? row.agentId : null;
}

async function createTicket({
  subject, snippet, customerName, customerEmail, customerAddress,
  category, channel, platform, mailbox, actor,
}) {
  const cat = category || 'unsorted';
  const routedAgentId = await resolveQueueAgent(cat);

  let routedAgentName = null;
  if (routedAgentId) {
    const [agent] = await q('SELECT full_name AS name FROM public.users WHERE id = $1', [routedAgentId]);
    routedAgentName = agent ? agent.name : null;
  }

  return withTx(async (txQ) => {
    const [ticket] = await txQ(
      `INSERT INTO public.cs_tickets
         (subject, snippet, customer_name, customer_email, customer_address,
          status, category, channel, platform, mailbox, assignee_id, matched, is_new)
       VALUES ($1,$2,$3,$4,$5,'new_ticket',$6,$7,$8,$9,$10,FALSE,TRUE)
       RETURNING *`,
      [
        subject, snippet || null, customerName || null, customerEmail || null, customerAddress || null,
        cat, channel || null, platform || null, mailbox || null, routedAgentId,
      ]
    );

    // Req 8: activity history includes assignment — auto-routing on
    // creation is logged the same way a manual assign is.
    if (routedAgentId) {
      await txQ(
        `INSERT INTO public.cs_assignment_log
           (id, ticket_id, action, actor_id, actor_name, to_agent_id, to_agent_name)
         VALUES ($1,$2,'assign',$3,$4,$5,$6)`,
        [
          uuidv4(), ticket.id,
          actor ? actor.id : null,
          actor ? (actor.name || 'System') : 'System (queue routing)',
          routedAgentId, routedAgentName,
        ]
      );
    }

    return ticket;
  });
}

// ═════════════════════════════════════════════════════════════
// ROUTE  GET /api/cs/bootstrap
// ═════════════════════════════════════════════════════════════
router.get('/bootstrap', async (req, res) => {
  try {
    const currentUserId = req.user?.id || 1; 

    // 1. Fetch current logged-in user profile details using full_name
    const userQuery = `SELECT id, full_name FROM public.users WHERE id = $1;`;
    const userResult = await db.query(userQuery, [currentUserId]);
    const userProfile = userResult.rows[0] || { id: 1, full_name: "You" };

    // 2. Fetch Customer Service agents mapped to your exact columns
    const agentsQuery = `
      SELECT 
        u.id, 
        u.full_name AS name, 
        CASE WHEN u.employment_status = 'active' THEN true ELSE false END AS is_active,
        udm.role,
        udm.is_primary
      FROM public.user_department_memberships udm
      JOIN public.users u ON udm.user_id = u.id
      WHERE udm.department_id = 3 
        AND udm.deleted_at IS NULL
        AND u.employment_status = 'active'
      ORDER BY u.full_name ASC;
    `;
    const agentsResult = await db.query(agentsQuery);
    
    const currentUserMembership = agentsResult.rows.find(a => String(a.id) === String(currentUserId));
    const userRole = currentUserMembership ? currentUserMembership.role : 'agent';
    
    res.json({
      user: {
        id: userProfile.id,
        name: userProfile.full_name,
        role: userRole
      },
      permissions: {
        assign: ['lead', 'manager', 'senior'].includes(userRole),
        templates: true,
        manageNotes: ['lead', 'manager'].includes(userRole)
      },
      agents: agentsResult.rows.filter(agent => String(agent.id) !== String(currentUserId))
    });

  } catch (error) {
    console.error('Database bootstrap fetch crash:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  GET /api/cs/queue
// ═════════════════════════════════════════════════════════════
router.get('/queue', async (req, res) => {
  try {
    const { view, filter } = req.query;
    const queryConditions = ['t.deleted_at IS NULL'];
    const queryParams = [];

    // Light query for sidebar / counter sync across the whole board.
    const countRows = await q(
      'SELECT id, status, assignee_id FROM public.cs_tickets WHERE deleted_at IS NULL'
    );

    let queueQuery = `
      SELECT
        t.id,
        t.customer_name AS "customer",
        t.customer_email AS "customerEmail",
        t.subject,
        t.snippet,
        t.status,
        t.category,
        t.platform,
        t.case_ref AS "caseRef",
        t.assignee_id AS "assigneeId",
        t.is_new AS "isNew",
        t.active_cases AS "activeCases",
        t.sla_resolution_due AS "slaDueAt"
      FROM public.cs_tickets t
    `;

    if (view === 'my-work') {
      queryParams.push(req.user.id);
      queryConditions.push(`t.assignee_id = $${queryParams.length}`);
    } else if (view === 'unassigned') {
      queryConditions.push('t.assignee_id IS NULL');
    } else if (view && view.startsWith('agent:')) {
      const targetAgentId = parseInt(view.split(':')[1], 10);
      queryParams.push(targetAgentId);
      queryConditions.push(`t.assignee_id = $${queryParams.length}`);
    } else if (view && view.startsWith('status:')) {
      const targetStatus = view.split(':')[1];
      queryParams.push(targetStatus);
      queryConditions.push(`t.status = $${queryParams.length}`);
    }

    if (filter && filter !== 'all') {
      queryParams.push(filter);
      queryConditions.push(`t.category = $${queryParams.length}`);
    }

    if (queryConditions.length > 0) {
      queueQuery += ' WHERE ' + queryConditions.join(' AND ');
    }
    
    queueQuery += ' ORDER BY t.sla_resolution_due ASC NULLS LAST';
    let queueRows = await q(queueQuery, queryParams);

    // ── 🎯 AUTOMATED QUEUE ROUTING AUTOMATION LAYER ──
    // 1. Fetch active rules safely from your routing configuration storage
    let queueRouting = {};
    try {
      // Adjust this configuration table or file lookup if your rules are stored differently
      const routingResult = await q('SELECT routing_rules FROM public.queue_routing_config LIMIT 1;');
      if (routingResult && routingResult.length) {
        queueRouting = routingResult[0].routing_rules || {};
      }
    } catch (e) {
      console.error('[queue-routing] Configuration lookup fallback:', e.message);
    }

    // 2. Scan and re-route unassigned tickets hitting active rules
    let directMutationOccurred = false;
    for (let ticket of queueRows) {
      if (ticket.category && queueRouting[ticket.category]) {
        const designatedAgentId = parseInt(queueRouting[ticket.category], 10);
        
        // Match condition: Ticket must be currently unassigned
        if (designatedAgentId && !ticket.assigneeId) {
          try {
            await q(
              'UPDATE public.cs_tickets SET assignee_id = $1 WHERE id = $2',
              [designatedAgentId, ticket.id]
            );
            
            // Apply inline modification for immediate frontend data payload sync
            ticket.assigneeId = designatedAgentId;
            directMutationOccurred = true;
          } catch (routingError) {
            console.error(`[auto-route] Failed for ticket ID ${ticket.id}:`, routingError.message);
          }
        }
      }
    }

    // 3. Re-sync counter references pool if updates were committed to the pool
    if (directMutationOccurred) {
      for (let countItem of countRows) {
        if (countItem.category && queueRouting[countItem.category] && !countItem.assignee_id) {
          countItem.assignee_id = parseInt(queueRouting[countItem.category], 10);
        }
      }
    }

    res.json({
      cases: queueRows,
      allCasesReferencePool: countRows,
    });
  } catch (err) {
    console.error('[queue]', err);
    res.status(500).json({ error: 'Queue computation failure' });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  GET /api/cs/cases/:id
// ═════════════════════════════════════════════════════════════
router.get('/cases/:id', async (req, res) => {
  try {
    const [ticket] = await q(
      `SELECT t.*, a.full_name AS assignee_name
       FROM   public.cs_tickets t
       LEFT   JOIN public.users a ON a.id = t.assignee_id
       WHERE  t.id = $1 AND t.deleted_at IS NULL`, [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Case not found' });

    const [thread, teamNoteRows, assignLog, statusLog] = await Promise.all([
      q(`SELECT id, direction AS dir,
                author_name AS who,
                TO_CHAR(created_at, 'DD Mon YYYY HH24:MI') AS at,
                body, attachments, created_at AS "createdAt"
         FROM   public.cs_messages
         WHERE  ticket_id = $1
         ORDER  BY created_at ASC`, [ticket.id]),

      q(`SELECT n.id, n.author_id AS "authorId", a.full_name AS "authorName",
                n.body, n.attachments, n.mentions,
                n.created_at AS "createdAt", n.updated_at AS "updatedAt"
         FROM   public.cs_team_notes n
         JOIN   public.users a ON a.id = n.author_id
         WHERE  n.ticket_id = $1
         ORDER  BY n.created_at ASC`, [ticket.id]),

      q(`SELECT id, action, actor_name AS "actorName",
                from_agent_name AS "fromName", to_agent_name AS "toName",
                to_agent_id AS "toId",
                created_at AS "createdAt", created_at AS at
         FROM   public.cs_assignment_log
         WHERE  ticket_id = $1
         ORDER  BY created_at ASC`, [ticket.id]),

      q(`SELECT id, actor_name AS "actorName",
                from_status AS "fromStatus", to_status AS "toStatus",
                created_at AS "createdAt", created_at AS at,
                'status' AS "sysType"
         FROM   public.cs_status_log
         WHERE  ticket_id = $1
         ORDER  BY created_at ASC`, [ticket.id]),
    ]);

    // Personal note for the current viewer only (private scratchpad).
    const [personalNote] = await q(
      `SELECT html, collapsed, updated_at AS "updatedAt"
       FROM   public.cs_personal_notes
       WHERE  ticket_id = $1 AND author_id = $2`, [ticket.id, req.user.id]);

    await q(`UPDATE public.cs_tickets SET is_new = FALSE WHERE id = $1 AND is_new = TRUE`, [ticket.id]);

    res.json({
      ticket: {
        ...ticket,
        customer:   ticket.customer_name,
        email:      ticket.customer_email,
        address:    ticket.customer_address,
        assigneeId: ticket.assignee_id,
        isNew:      ticket.is_new,
        slaDueAt: ticket.sla_resolution_due,
        caseRef:    ticket.case_ref,
      },
      thread,
      notes: {
        team: teamNoteRows,
        personal: personalNote || { html: '', collapsed: false, updatedAt: null },
      },
      assignmentLog: assignLog,
      statusLog,
      order: {
        ref:      ticket.case_ref || '—',
        external: ticket.case_ref || '—',
        status:   ticket.status,
        customer: ticket.customer_name,
        email:    ticket.customer_email,
        address:  ticket.customer_address || '—',
        items:    [],
        total:    '—',
      },
      details: {
        status:   ticket.status,
        priority: ticket.priority || 'Normal',
        opened:   ticket.opened_at,
        channel:  ticket.channel || ticket.platform || '—',
        assignee: ticket.assignee_name || 'Unassigned',
        matched:  ticket.matched,
      },
    });
  } catch (err) {
    console.error('[case detail]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/cases/:id/reply   — SEND MSG + SAVE
// ═════════════════════════════════════════════════════════════
router.post('/cases/:id/reply', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const { body, attachments = [] } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Reply body is required' });

    const msgId = uuidv4();

    const [savedMsg] = await withTx(async (txQ) => {
      const [msg] = await txQ(
        `INSERT INTO public.cs_messages
           (id, ticket_id, direction, author_name, author_id, body, attachments)
         VALUES ($1, $2, 'out', $3, $4, $5, $6)
         RETURNING id, direction AS dir, author_name AS who,
                   TO_CHAR(created_at,'DD Mon YYYY HH24:MI') AS at,
                   body, attachments, created_at AS "createdAt"`,
        [msgId, ticket.id, req.user.full_name || req.user.name, req.user.id,
         body.trim(), JSON.stringify(attachments)]);

      const autoAdvance = ['new_ticket', 'to_do'];
      if (autoAdvance.includes(ticket.status)) {
        await txQ(
          `UPDATE public.cs_tickets SET status = 'awaiting_reply', updated_at = NOW()
           WHERE id = $1`, [ticket.id]);
        // status log written automatically by trg_ticket_status_log
      } else {
        await txQ(`UPDATE public.cs_tickets SET updated_at = NOW() WHERE id = $1`, [ticket.id]);
      }

      return [msg];
    });

    let emailSent = false;
    let emailError = null;
    let emailMessageId = null;
    try {
      const r = await sendEmailToCustomer({ ticket, body: body.trim(), fromName: req.user.full_name || req.user.name });
      emailSent = true;
      emailMessageId = r.messageId;
      await q(`UPDATE public.cs_messages SET email_message_id = $1 WHERE id = $2`, [emailMessageId, msgId]);
    } catch (err) {
      emailError = err.message;
    }

    res.json({ ok: true, message: savedMsg, emailSent, emailError, emailMessageId });
  } catch (err) {
    console.error('[reply]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  PATCH /api/cs/cases/:id/status
// ═════════════════════════════════════════════════════════════
router.patch('/cases/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status string parameter is required' });

    const [updated] = await q(
      `UPDATE public.cs_tickets SET status = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
      [status, req.params.id]
    );
    if (!updated) return res.status(404).json({ error: 'Ticket record mapping not found' });

    const countRows = await q(
      'SELECT id, status, assignee_id FROM public.cs_tickets WHERE deleted_at IS NULL'
    );

    res.json({ ok: true, ticket: updated, allCasesReferencePool: countRows });
  } catch (err) {
    console.error('[status patch]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  PATCH /api/cs/cases/:id/category  — UPDATE QUEUE/CATEGORY
// ═════════════════════════════════════════════════════════════
router.patch('/cases/:id/category', async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) return res.status(400).json({ error: 'Category string parameter is required' });

    const [updated] = await q(
      `UPDATE public.cs_tickets SET category = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
      [category, req.params.id]
    );
    if (!updated) return res.status(404).json({ error: 'Ticket record mapping not found' });

    const countRows = await q(
      'SELECT id, status, assignee_id FROM public.cs_tickets WHERE deleted_at IS NULL'
    );

    res.json({ success: true, ticket: updated, allCasesReferencePool: countRows });
  } catch (err) {
    console.error('[category patch]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/cases/:id/assign  — ASSIGN / REASSIGN
// ═════════════════════════════════════════════════════════════
router.post('/cases/:id/assign', async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { agentId } = req.body;

    if (agentId === undefined) {
      return res.status(400).json({ error: 'agentId is required' });
    }

    const [ticket] = await q(
      'SELECT id, assignee_id FROM public.cs_tickets WHERE id = $1 AND deleted_at IS NULL',
      [ticketId]
    );
    if (!ticket) return res.status(404).json({ error: 'Case not found' });

    // Reassigning an already-assigned ticket requires a Team Lead.
    if (ticket.assignee_id !== null && !isTeamLeadRole(req.user.role)) {
      return res.status(403).json({ error: 'Access Denied: Only a Team Lead can reassign this ticket.' });
    }

    let newAgent = null;
    if (agentId !== null) {
      const [fetchedAgent] = await q('SELECT id, full_name AS name FROM public.users WHERE id = $1', [agentId]);
      if (!fetchedAgent) return res.status(404).json({ error: 'Agent not found' });
      newAgent = fetchedAgent;
    }

    const prevAgent = ticket.assignee_id
      ? (await q('SELECT id, full_name AS name FROM public.users WHERE id = $1', [ticket.assignee_id]))[0]
      : null;

    let action = 'unassign';
    if (agentId !== null) action = ticket.assignee_id ? 'reassign' : 'assign';

    const [logEntry, updatedTicket] = await withTx(async (txQ) => {
      const [t] = await txQ(
        `UPDATE public.cs_tickets
         SET    assignee_id = $1, matched = TRUE, updated_at = NOW()
         WHERE  id = $2 RETURNING *`,
        [agentId !== null ? parseInt(agentId, 10) : null, ticketId]
      );

      const [log] = await txQ(
        `INSERT INTO public.cs_assignment_log
           (id, ticket_id, action, actor_id, actor_name,
            from_agent_id, from_agent_name, to_agent_id, to_agent_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, action, actor_name AS "actorName",
                   from_agent_name AS "fromName", to_agent_name AS "toName",
                   to_agent_id AS "toId", created_at AS at`,
        [
          uuidv4(),
          ticketId,
          action,
          req.user.id,
          req.user.full_name || req.user.name || 'System',
          prevAgent?.id || null,
          prevAgent?.name || null,
          newAgent?.id || null,
          newAgent?.name || null,
        ]
      );

      return [log, t];
    });

    res.json({ ok: true, ticket: updatedTicket, logEntry });
  } catch (err) {
    console.error('[assign]', err);
    res.status(400).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/cases/:id/match
// ═════════════════════════════════════════════════════════════
router.post('/cases/:id/match', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const { platform, orderRef } = req.body;
    if (!platform) return res.status(400).json({ error: 'platform is required' });

    const [updated] = await withTx(async (txQ) => {
      const [t] = await txQ(
        `UPDATE public.cs_tickets
         SET matched = TRUE, platform = $1, case_ref = COALESCE($2, case_ref), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [platform, orderRef || null, ticket.id]
      );

      await txQ(
        `INSERT INTO public.cs_assignment_log
           (id, ticket_id, action, actor_id, actor_name, to_agent_name)
         VALUES ($1, $2, 'assign', $3, $4, 'Matched')`,
        [uuidv4(), ticket.id, req.user.id, req.user.full_name || req.user.name]
      );

      return [t];
    });

    res.json({ ok: true, ticket: updated });
  } catch (err) {
    console.error('[match]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  GET /api/cs/cases/:id/notes   (team notes)
// ═════════════════════════════════════════════════════════════
router.get('/cases/:id/notes', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const notes = await q(
      `SELECT n.id, n.author_id AS "authorId", a.full_name AS "authorName",
              n.body, n.attachments, n.mentions,
              n.created_at AS "createdAt", n.updated_at AS "updatedAt"
       FROM   public.cs_team_notes n
       JOIN   public.users a ON a.id = n.author_id
       WHERE  n.ticket_id = $1
       ORDER  BY n.created_at ASC`, [ticket.id]);

    res.json({ notes });
  } catch (err) {
    console.error('[notes list]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/cases/:id/notes   — ADD INTERNAL TEAM NOTE
// ═════════════════════════════════════════════════════════════
router.post('/cases/:id/notes', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const { body, attachments = [], mentions = [] } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Note body is required' });

    const [note] = await q(
      `INSERT INTO public.cs_team_notes (id, ticket_id, author_id, body, attachments, mentions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, author_id AS "authorId", body, attachments, mentions,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [uuidv4(), ticket.id, req.user.id, body.trim(), JSON.stringify(attachments), JSON.stringify(mentions)]
    );

    await q(`UPDATE public.cs_tickets SET updated_at = NOW() WHERE id = $1`, [ticket.id]);

    res.json({ ok: true, note: { ...note, authorName: req.user.full_name || req.user.name } });
  } catch (err) {
    console.error('[note add]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// PERSONAL NOTES — private per-agent scratchpad on a ticket.
// The front end calls PUT (save), PATCH (toggle collapsed), and DELETE
// (clear) on /cases/:id/notes/personal. None of these existed in the
// uploaded backend file; added here against cs_personal_notes.
//
// IMPORTANT — registered BEFORE /cases/:id/notes/:noteId below: Express
// matches routes in registration order, and ':noteId' matches the literal
// string "personal" just as readily as a real UUID. If the :noteId routes
// were registered first, PATCH/DELETE .../notes/personal would always be
// swallowed by the :noteId handler instead (with noteId = "personal").
// ═════════════════════════════════════════════════════════════
router.put('/cases/:id/notes/personal', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const { html = '' } = req.body;

    const [saved] = await q(
      `INSERT INTO public.cs_personal_notes (ticket_id, author_id, html, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (ticket_id, author_id)
       DO UPDATE SET html = EXCLUDED.html, updated_at = NOW()
       RETURNING html, collapsed, updated_at AS "updatedAt"`,
      [ticket.id, req.user.id, html]
    );

    res.json({ ok: true, note: saved });
  } catch (err) {
    console.error('[personal note save]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/cases/:id/notes/personal', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const { collapsed } = req.body;
    if (typeof collapsed !== 'boolean') {
      return res.status(400).json({ error: 'collapsed boolean is required' });
    }

    const [saved] = await q(
      `INSERT INTO public.cs_personal_notes (ticket_id, author_id, collapsed, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (ticket_id, author_id)
       DO UPDATE SET collapsed = EXCLUDED.collapsed, updated_at = NOW()
       RETURNING html, collapsed, updated_at AS "updatedAt"`,
      [ticket.id, req.user.id, collapsed]
    );

    res.json({ ok: true, note: saved });
  } catch (err) {
    console.error('[personal note collapse]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/cases/:id/notes/personal', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    await q(
      'DELETE FROM public.cs_personal_notes WHERE ticket_id = $1 AND author_id = $2',
      [ticket.id, req.user.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[personal note delete]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  PATCH /api/cs/cases/:id/notes/:noteId  (team note, author-only)
// ═════════════════════════════════════════════════════════════
router.patch('/cases/:id/notes/:noteId', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const [note] = await q('SELECT * FROM public.cs_team_notes WHERE id = $1', [req.params.noteId]);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    if (String(note.author_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the author can edit this note' });
    }

    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Note body is required' });

    const [updated] = await q(
      `UPDATE public.cs_team_notes SET body = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, author_id AS "authorId", body, attachments, mentions,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [body.trim(), note.id]
    );

    res.json({ ok: true, note: { ...updated, authorName: req.user.full_name || req.user.name } });
  } catch (err) {
    console.error('[note edit]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  DELETE /api/cs/cases/:id/notes/:noteId  (team note)
// Front end calls this with ?kind=team to delete a shared team note.
// Personal notes have their own dedicated /notes/personal routes above.
// Author may always delete their own note; permissions.manageNotes
// (Team Lead/Admin) may delete anyone's.
// ═════════════════════════════════════════════════════════════
router.delete('/cases/:id/notes/:noteId', async (req, res) => {
  try {
    const [note] = await q('SELECT author_id FROM public.cs_team_notes WHERE id = $1', [req.params.noteId]);
    if (!note) return res.status(404).json({ error: 'Internal note not found.' });

    const isAuthor = parseInt(note.author_id, 10) === parseInt(req.user.id, 10);
    const canManageAny = permissionsFor(req.user).manageNotes;

    if (!isAuthor && !canManageAny) {
      return res.status(403).json({ error: 'Access Denied: You can only delete notes that you created.' });
    }

    await q('DELETE FROM public.cs_team_notes WHERE id = $1', [req.params.noteId]);
    res.json({ ok: true, message: 'Note deleted.' });
  } catch (err) {
    console.error('[note delete]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  GET /api/cs/cases/:id/order-cases
// ═════════════════════════════════════════════════════════════
router.get('/cases/:id/order-cases', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const cases = await q(
      `SELECT id, type, opened_at AS "openedAt", resolved_at AS "resolvedAt"
       FROM   public.cs_order_cases
       WHERE  ticket_id = $1 AND resolved_at IS NULL
       ORDER  BY opened_at ASC`, [ticket.id]);

    res.json({ cases });
  } catch (err) {
    console.error('[order-cases list]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/cases/:id/order-cases
// ═════════════════════════════════════════════════════════════
router.post('/cases/:id/order-cases', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const { type } = req.body;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const [entry] = await q(
      `INSERT INTO public.cs_order_cases (id, ticket_id, type)
       VALUES ($1, $2, $3)
       RETURNING id, type, opened_at AS "openedAt"`,
      [uuidv4(), ticket.id, type]);

    res.status(201).json({ ok: true, case: entry });
  } catch (err) {
    console.error('[order-case add]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  DELETE /api/cs/cases/:id/order-cases/:caseId
// ═════════════════════════════════════════════════════════════
router.delete('/cases/:id/order-cases/:caseId', async (req, res) => {
  try {
    const ticket = await getTicketOr404(req.params.id, res);
    if (!ticket) return;

    const [oc] = await q(
      'SELECT id FROM public.cs_order_cases WHERE id = $1 AND ticket_id = $2',
      [req.params.caseId, ticket.id]
    );
    if (!oc) return res.status(404).json({ error: 'Order case not found' });

    await q(
      'UPDATE public.cs_order_cases SET resolved_at = NOW(), resolved_by = $1 WHERE id = $2',
      [req.user.id, oc.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[order-case resolve]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  GET /api/cs/customers/:email/orders
// ═════════════════════════════════════════════════════════════
router.get('/customers/:email/orders', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const orders = await q(
      `SELECT order_id AS "orderId", channel, status, order_date AS date, total
       FROM   public.cs_order_history
       WHERE  LOWER(customer_email) = $1
       ORDER  BY order_date DESC`, [email]);
    res.json({ orders });
  } catch (err) {
    console.error('[order history]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  GET /api/cs/templates
// ═════════════════════════════════════════════════════════════
router.get('/templates', async (req, res) => {
  try {
    const templateRows = await q(`
      SELECT t.id, t.title, t.body, LOWER(c.name) AS category, t.favorite
      FROM   public.cs_templates t
      LEFT   JOIN public.cs_template_categories c ON t.category_id = c.id
      ORDER  BY t.favorite DESC, t.title ASC
    `);
    const categoryRows = await q('SELECT name FROM public.cs_template_categories ORDER BY id ASC');

    res.json({
      templates: templateRows,
      categories: categoryRows.length ? categoryRows.map((r) => r.name) : ['General'],
    });
  } catch (err) {
    console.error('[templates list]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/templates
// ═════════════════════════════════════════════════════════════
router.post('/templates', async (req, res) => {
  try {
    const { title, body, category } = req.body;

    const [catRecord] = await q(
      'SELECT id FROM public.cs_template_categories WHERE LOWER(name) = $1 LIMIT 1',
      [String(category || 'general').toLowerCase()]
    );
    const categoryId = catRecord ? catRecord.id : 1;

    const [newTpl] = await q(
      `INSERT INTO public.cs_templates (title, body, category_id, favorite, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, body, category_id, favorite`,
      [title || 'New template', body || '', categoryId, false, req.user.id]
    );

    res.status(201).json(newTpl);
  } catch (err) {
    console.error('[template create]', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  PATCH /api/cs/templates/:id
// ═════════════════════════════════════════════════════════════
router.patch('/templates/:id', async (req, res) => {
  try {
    const tplId = req.params.id;
    const { title, body, category, favorite } = req.body;

    let categoryId;
    if (category) {
      const [catRecord] = await q(
        'SELECT id FROM public.cs_template_categories WHERE LOWER(name) = $1 LIMIT 1',
        [String(category).toLowerCase()]
      );
      if (catRecord) categoryId = catRecord.id;
    }

    const [updated] = await q(
      `UPDATE public.cs_templates
       SET title = COALESCE($1, title),
           body = COALESCE($2, body),
           category_id = COALESCE($3, category_id),
           favorite = COALESCE($4, favorite),
           updated_at = NOW()
       WHERE id = $5
       RETURNING id`,
      [title, body, categoryId, favorite, tplId]
    );
    if (!updated) return res.status(404).json({ error: 'Template not found' });

    res.json({ ok: true, message: 'Template updated successfully.' });
  } catch (err) {
    console.error('[template update]', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  DELETE /api/cs/templates/:id
// ═════════════════════════════════════════════════════════════
router.delete('/templates/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM public.cs_templates WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Template not found or already deleted.' });
    }
    res.json({ ok: true, message: 'Template permanently deleted.' });
  } catch (err) {
    console.error('[template delete]', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/templates/:id/touch  — bump recently-used tracking
// Front end calls this on every send-via-template; no route existed for
// it in the uploaded file. Increments use_count and stamps last_used_at.
// ═════════════════════════════════════════════════════════════
router.post('/templates/:id/touch', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE public.cs_templates
       SET use_count = use_count + 1, last_used_at = NOW()
       WHERE id = $1
       RETURNING id, use_count, last_used_at`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[template touch]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  GET /api/cs/statuses
// ═════════════════════════════════════════════════════════════
router.get('/statuses', async (req, res) => {
  try {
    const statuses = await q('SELECT * FROM public.cs_statuses ORDER BY sort_order, key');
    res.json({ statuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/statuses  (Team Lead / Admin only)
// ═════════════════════════════════════════════════════════════
router.post('/statuses', async (req, res) => {
  try {
    if (!permissionsFor(req.user).manageNotes) {
      // manageNotes doubles as the "lead/admin" permission bucket today;
      // swap for a dedicated permissions.manageStatuses check once your
      // RBAC table exists (see proposal doc, item 19).
      return res.status(403).json({ error: 'Only Team Leads/Admins can manage statuses.' });
    }

    const { key, label, color, icon } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'key and label are required' });

    const [maxRow] = await q('SELECT COALESCE(MAX(sort_order), 0) AS max FROM public.cs_statuses');

    const result = await pool.query(
      `INSERT INTO public.cs_statuses (key, label, color, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO NOTHING
       RETURNING *`,
      [key, label, color || '#5F5E5A', icon || 'ti-circle-dot', maxRow.max + 1]
    );

    if (!result.rows[0]) return res.status(409).json({ error: 'A status with that key already exists.' });
    res.json({ ok: true, status: result.rows[0] });
  } catch (err) {
    console.error('[status create]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  PATCH /api/cs/statuses/:key  (Team Lead / Admin only)
// ═════════════════════════════════════════════════════════════
router.patch('/statuses/:key', async (req, res) => {
  try {
    if (!permissionsFor(req.user).manageNotes) {
      return res.status(403).json({ error: 'Only Team Leads/Admins can manage statuses.' });
    }

    const [existing] = await q('SELECT * FROM public.cs_statuses WHERE key = $1', [req.params.key]);
    if (!existing) return res.status(404).json({ error: 'Status not found' });

    const { label, color, icon, sort_order } = req.body;
    const sets = ['updated_at = NOW()'];
    const vals = [];

    if (label !== undefined)      { vals.push(label.trim()); sets.push(`label = $${vals.length}`); }
    if (color !== undefined)      { vals.push(color);         sets.push(`color = $${vals.length}`); }
    if (icon !== undefined)       { vals.push(icon);          sets.push(`icon = $${vals.length}`); }
    if (sort_order !== undefined) { vals.push(sort_order);    sets.push(`sort_order = $${vals.length}`); }

    vals.push(existing.key);
    const [updated] = await q(
      `UPDATE public.cs_statuses SET ${sets.join(', ')} WHERE key = $${vals.length} RETURNING *`, vals);

    res.json({ ok: true, status: updated });
  } catch (err) {
    console.error('[status update]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  DELETE /api/cs/statuses/:key  (Team Lead / Admin only)
// Blocks deletion while tickets still reference the status, rather than
// silently orphaning them — the FK to cs_tickets.status enforces this
// at the DB level too, but we check first for a clean error message.
// ═════════════════════════════════════════════════════════════
router.delete('/statuses/:key', async (req, res) => {
  try {
    if (!permissionsFor(req.user).manageNotes) {
      return res.status(403).json({ error: 'Only Team Leads/Admins can manage statuses.' });
    }

    const [{ count }] = await q(
      'SELECT COUNT(*)::int AS count FROM public.cs_tickets WHERE status = $1 AND deleted_at IS NULL',
      [req.params.key]
    );
    if (count > 0) {
      return res.status(409).json({
        error: `${count} ticket(s) still use this status. Reassign them before deleting.`,
      });
    }

    const result = await pool.query('DELETE FROM public.cs_statuses WHERE key = $1 RETURNING key', [req.params.key]);
    if (!result.rowCount) return res.status(404).json({ error: 'Status not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[status delete]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// ROUTE  POST /api/cs/cases  — CREATE TICKET (manual)
// Req 1/2/3: goes through the same createTicket() the email poller uses,
// so a manually-opened ticket is routed into the right queue and, if that
// queue has an employee assigned, appears in their My Work immediately.
// ═════════════════════════════════════════════════════════════
router.post('/cases', async (req, res) => {
  try {
    const { subject, customerName, customerEmail, customerAddress, category, channel, platform, snippet } = req.body;
    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'subject is required' });
    }

    const ticket = await createTicket({
      subject: subject.trim(),
      snippet: (snippet || '').trim() || null,
      customerName, customerEmail, customerAddress, category, channel, platform,
      actor: { id: req.user.id, name: req.user.full_name || req.user.name },
    });

    const countRows = await q(
      'SELECT id, status, assignee_id FROM public.cs_tickets WHERE deleted_at IS NULL'
    );

    res.status(201).json({ ok: true, ticket, allCasesReferencePool: countRows });
  } catch (err) {
    console.error('[create ticket]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
// QUEUE ROUTING — GET/POST /api/cs/queue-routing
// Front end's csQueueRoutingModal saves a flat category -> agentId map.
// No table or routes existed for this in the uploaded backend file;
// added here against cs_queue_routing.
// ═════════════════════════════════════════════════════════════
router.get('/queue-routing', async (req, res) => {
  try {
    const rows = await q('SELECT category, agent_id AS "agentId" FROM public.cs_queue_routing');
    const routing = {};
    rows.forEach((r) => { routing[r.category] = r.agentId; });
    res.json({ routing });
  } catch (err) {
    console.error('[queue-routing get]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue-routing', async (req, res) => {
  try {
    if (!permissionsFor(req.user).assign) {
      return res.status(403).json({ error: 'Only Team Leads can configure queue routing.' });
    }

    const { routing } = req.body;
    if (!routing || typeof routing !== 'object') {
      return res.status(400).json({ error: 'routing object is required' });
    }

    await withTx(async (txQ) => {
      for (const [category, agentId] of Object.entries(routing)) {
        await txQ(
          `INSERT INTO public.cs_queue_routing (category, agent_id, updated_at, updated_by)
           VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (category)
           DO UPDATE SET agent_id = EXCLUDED.agent_id, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
          [category, agentId !== null ? parseInt(agentId, 10) : null, req.user.id]
        );
      }
    });

    res.json({ ok: true, routing });
  } catch (err) {
    console.error('[queue-routing save]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────────────────────
router.use((err, req, res, _next) => {
  console.error('[CS Error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = router;
module.exports.pool = pool; // expose pool for graceful shutdown
module.exports.createTicket = createTicket; // reused by server/email/imapPoller.js (req 1/2/3)

// ─────────────────────────────────────────────────────────────
// STANDALONE
// ─────────────────────────────────────────────────────────────
if (require.main === module) {
  const app = express();
  // Standalone mode has no real session middleware — stub req.user so
  // the router's requireUser guard doesn't immediately 401 everything.
  // Replace this with your real auth middleware when mounting into the
  // main app; do not ship this stub to production.
  app.use((req, _res, next) => {
    req.user = { id: 1, full_name: 'Manu Sharma', role: 'admin' };
    next();
  });
  app.use('/api/cs', router);

  const PORT = process.env.PORT || 3001;
  const server = app.listen(PORT, () =>
    console.log(`✅  CS backend → http://localhost:${PORT}/api/cs`));

  const shutdown = async () => {
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}