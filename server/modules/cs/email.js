'use strict';

const nodemailer = require('nodemailer');
const { q, qOne, uuidv4, withTx } = require('./helpers');
const { applyRoutingRules } = require('./routing');
const { computeSlaDueDates } = require('./sla');
const { recordHistory } = require('./history');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  } : undefined,
});

async function sendEmailToCustomer({ ticket, body, fromName, inReplyTo }) {
  if (!ticket?.customer_email) throw new Error('Customer email unknown');
  const info = await transporter.sendMail({
    from: `"${fromName || 'Customer Support'}" <${process.env.SMTP_FROM || 'support@example.com'}>`,
    to: ticket.customer_email,
    subject: `Re: [${ticket.ticket_number || ticket.case_ref}] ${ticket.subject}`,
    text: body,
    html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
    inReplyTo: inReplyTo || undefined,
    references: inReplyTo || undefined,
  });
  return { messageId: info.messageId };
}

async function findOrCreateTicketFromEmail({
  fromEmail, fromName, subject, body, messageId, inReplyTo, attachments = [], queueId,
}) {
  // Continue existing conversation via email thread
  if (inReplyTo || messageId) {
    const thread = await qOne(
      `SELECT t.* FROM cs_email_threads et
       JOIN cs_tickets t ON t.id = et.ticket_id
       WHERE (et.message_id = $1 OR et.in_reply_to = $1 OR et.thread_id = $2)
         AND t.deleted_at IS NULL
       ORDER BY t.updated_at DESC LIMIT 1`,
      [inReplyTo || messageId, inReplyTo || messageId]
    );
    if (thread) {
      await appendInboundMessage(thread, { fromName, fromEmail, body, messageId, attachments });
      return { ticket: thread, created: false };
    }
  }

  // Match by customer email on open tickets
  const existing = await qOne(
    `SELECT * FROM cs_tickets
     WHERE LOWER(customer_email) = LOWER($1)
       AND deleted_at IS NULL
       AND status NOT IN ('closed', 'resolved', 'spam', 'cancelled')
     ORDER BY updated_at DESC LIMIT 1`,
    [fromEmail]
  );
  if (existing) {
    await appendInboundMessage(existing, { fromName, fromEmail, body, messageId, attachments });
    return { ticket: existing, created: false };
  }

  const ticket = await createTicketFromSource({
    customerName: fromName || fromEmail,
    customerEmail: fromEmail,
    subject: subject || 'No subject',
    description: body,
    source: 'email',
    queueId,
    actor: { name: 'Email', role: 'system' },
  });

  await appendInboundMessage(ticket, { fromName, fromEmail, body, messageId, attachments });
  return { ticket, created: true };
}

async function createTicketFromSource({
  customerName, customerEmail, customerPhone, subject, description,
  priority = 'medium', queueId, source = 'manual', platform = 'email',
  caseRef, orderId, tags = [], createdBy, actor, req,
}) {
  const defaultStatus = await qOne(`SELECT key FROM cs_statuses WHERE is_default = TRUE LIMIT 1`);
  const status = defaultStatus?.key || 'new';

  let queue = queueId;
  if (!queue) {
    const qRow = await qOne(`SELECT id FROM cs_queues WHERE slug = 'support' LIMIT 1`);
    queue = qRow?.id;
  }

  const [ticket] = await withTx(async (txQ) => {
    const [t] = await txQ(
      `INSERT INTO cs_tickets
         (customer_name, customer_email, customer_phone, subject, description, snippet,
          status, priority, queue_id, source, platform, case_ref, order_id, created_by, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         (SELECT slug FROM cs_queues WHERE id = $9 LIMIT 1))
       RETURNING *`,
      [
        customerName, customerEmail, customerPhone || null,
        subject, description || null, (description || subject || '').slice(0, 200),
        status, priority, queue, source, platform, caseRef || null, orderId || null,
        createdBy || null,
      ]
    );

    await computeSlaDueDates(t, txQ);
    await applyRoutingRules(t, txQ);

    for (const tag of tags) {
      await txQ(`INSERT INTO cs_ticket_tags (ticket_id, tag, created_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [t.id, tag, createdBy || null]);
    }

    await recordHistory({
      ticketId: t.id, actor: actor || { name: 'System', role: 'system' },
      action: 'created', fieldName: 'ticket', newValue: t.ticket_number, req,
    });

    return [t];
  });

  return ticket;
}

async function appendInboundMessage(ticket, { fromName, body, messageId, attachments = [] }) {
  const msgId = uuidv4();
  await q(
    `INSERT INTO cs_messages (id, ticket_id, direction, author_name, body, attachments, email_message_id)
     VALUES ($1,$2,'in',$3,$4,$5,$6)`,
    [msgId, ticket.id, fromName, body, JSON.stringify(attachments), messageId || null]
  );
  await q(
    `UPDATE cs_tickets SET snippet = $1, updated_at = NOW(), is_new = TRUE WHERE id = $2`,
    [body.slice(0, 200), ticket.id]
  );
  if (messageId) {
    await q(
      `INSERT INTO cs_email_threads (ticket_id, message_id, in_reply_to, subject)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [ticket.id, messageId, null, ticket.subject]
    );
  }
  return msgId;
}

module.exports = {
  sendEmailToCustomer,
  findOrCreateTicketFromEmail,
  createTicketFromSource,
  appendInboundMessage,
};
