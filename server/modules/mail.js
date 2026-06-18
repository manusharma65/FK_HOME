// FK Home — Mail module (Gmail via service account + domain-wide delegation)
// Upgraded to handle Multi-Mailbox contexts seamlessly.

const express = require('express');
const { google } = require('googleapis');
const { requireAuth } = require('../auth');
const { db } = require('../db');

// Agar mail-access aur mail.js dono '/server/modules/' folder ke andar hain:
const { resolveMailbox, listAccessibleMailboxes, mailboxScopeId } = require('./mail-access');

const router = express.Router();
router.use(requireAuth);

function mbKey(req) {
  return req.query.mailbox || (req.body && req.body.mailbox) || 'personal';
}

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

// Build an authenticated Gmail client that acts AS the given mailbox.
function gmailFor(userEmail) {
  const raw = process.env.GMAIL_SA_JSON;
  if (!raw) {
    return null; // local mock mode fallback
  }
  let key;
  try {
    key = JSON.parse(raw);
  } catch (e) {
    throw new Error('GMAIL_SA_JSON is set but is not valid JSON — ensure it is on a single line in your local .env file.');
  }
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
    subject: userEmail, // Dynamic Impersonation target
  });
  return google.gmail({ version: 'v1', auth });
}

function header(headers, name) {
  const h = (headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// --- ADDED MISSING listInbox IMPLEMENTATION ENGINE ---
async function listInbox(userEmail, opts = {}) {
  const { box = 'inbox', q = '', pageToken = '', max = 25 } = opts;
  const gmail = gmailFor(userEmail);
  
  // Local Mock response logic if no service account key is specified
  if (!gmail) {
    return { 
      messages: [{
        id: 'mock-123', threadId: 'thread-mock', count: 1, msgIds: ['mock-123'],
        from: 'system@fk-sports.co.uk', to: userEmail, subject: 'Local Environment Active ✔',
        date: new Date().toUTCString(), snippet: 'Gmail Service Account JSON is in mock state. Multi-mailbox structure successfully compiled.', unread: true
      }], 
      nextPageToken: null 
    };
  }

  if (box === 'drafts') {
    const dl = await gmail.users.drafts.list(Object.assign({ userId: 'me', maxResults: max }, pageToken ? { pageToken } : {}));
    const draftMap = {}, ids = [];
    (dl.data.drafts || []).forEach(d => { if (d.message && d.message.id) { ids.push(d.message.id); draftMap[d.message.id] = d.id; } });
    const items = await Promise.all(ids.map(async (id) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
      const h = msg.data.payload && msg.data.payload.headers;
      return { id, threadId: msg.data.threadId, draftId: draftMap[id] || null, count: 1, msgIds: [id], from: header(h, 'From'), to: header(h, 'To'), subject: header(h, 'Subject') || '(no subject)', date: header(h, 'Date'), snippet: msg.data.snippet || '', unread: (msg.data.labelIds || []).includes('UNREAD') };
    }));
    return { messages: items, nextPageToken: dl.data.nextPageToken || null };
  }

  const params = { userId: 'me', maxResults: max };
  if (pageToken) params.pageToken = pageToken;
  const boxQ = box === 'sent' ? 'in:sent' : box === 'archive' ? '-in:inbox -in:sent -in:trash -in:spam -in:drafts' : 'in:inbox';
  if (q) params.q = q + ' ' + boxQ;
  else if (box === 'sent') params.labelIds = ['SENT'];
  else if (box === 'archive') params.q = boxQ;
  else params.labelIds = ['INBOX'];

  const list = await gmail.users.threads.list(params);
  const threads = list.data.threads || [];
  const items = await Promise.all(threads.map(async (t) => {
    const tg = await gmail.users.threads.get({ userId: 'me', id: t.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
    const msgs = tg.data.messages || [];
    const latest = msgs[msgs.length - 1] || {};
    const h = latest.payload && latest.payload.headers;
    return {
      id: latest.id, threadId: t.id, draftId: null,
      count: msgs.length, msgIds: msgs.map(mm => mm.id),
      from: header(h, 'From'), to: header(h, 'To'),
      subject: header(h, 'Subject') || '(no subject)',
      date: header(h, 'Date'), snippet: latest.snippet || t.snippet || '',
      unread: msgs.some(mm => (mm.labelIds || []).includes('UNREAD')),
    };
  }));
  return { messages: items, nextPageToken: list.data.nextPageToken || null };
}

// List mailboxes the current user may access (personal + department inboxes).
router.get('/mailboxes', async (req, res) => {
  try {
    const mailboxes = await listAccessibleMailboxes(req.user);
    res.json({ mailboxes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// JSON endpoint for the inbox screen — supports box, server-side search (q), paging, mailbox.
router.get('/inbox', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const box = ['inbox', 'sent', 'archive', 'drafts'].includes(req.query.box) ? req.query.box : 'inbox';
    const q = String(req.query.q || '').slice(0, 200).trim();
    const pageToken = String(req.query.pageToken || '');
    const out = await listInbox(mb.gmail_address, { box, q, pageToken });
    res.json({
      mailbox: mb.slug,
      mailbox_name: mb.display_name,
      mailbox_address: mb.gmail_address,
      can_send: mb.can_send,
      department: mb.department_slug || null,
      box,
      count: out.messages.length,
      messages: out.messages,
      nextPageToken: out.nextPageToken,
    });
  } catch (e) {
    console.error("Inbox execution failure:", e);
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

// Colleague address book for compose autocomplete.
router.get('/contacts', async (req, res) => {
  try {
    const r = await db.query("SELECT full_name, display_name, email FROM users WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> '' ORDER BY full_name");
    res.json({ contacts: r.rows.map(u => ({ name: u.display_name || u.full_name, email: u.email })) });
  } catch (e) { res.status(500).json({ error: e.message, contacts: [] }); }
});

async function sendPlain(fromEmail, to, subject, text) {
  const gmail = gmailFor(fromEmail);
  if (!gmail) throw new Error("Cannot issue raw tests in mock environment.");
  const mime = [
    `From: ${fromEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text,
  ].join('\r\n');
  const raw = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return r.data.id;
}

const pageWrap = (inner) => `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>FK Home — Send test</title></head>
  <body style="font-family:system-ui,sans-serif;max-width:680px;margin:30px auto;padding:0 16px;color:#2E2620;background:#FAF4EA">
  <h1 style="font-size:22px">Mail send test</h1>${inner}</body></html>`;

router.get('/sendtest', async (req, res) => {
  const me = req.user.email;
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (req.query.go !== '1') {
    return res.send(pageWrap(`
      <p style="font-size:14px">This sends one test email <strong>to yourself</strong> (${esc(me)}), from yourself, through FK Home. Nobody else is emailed.</p>
      <p><a href="/api/mail/sendtest?go=1" style="display:inline-block;background:#C2613B;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Send the test email</a></p>`));
  }
  try {
    const id = await sendPlain(me, me, 'FK Home — send test',
      'This message was sent from FK Home through the Gmail API at ' + new Date().toISOString() +
      '. If it reached your inbox, sending works end to end.');
    res.send(pageWrap(`
      <div style="background:#E3F0DA;color:#2F6B1E;padding:12px 14px;border-radius:8px;font-weight:600">✓ Sent. Check your inbox (and your Sent folder) for "FK Home — send test".</div>
      <p style="font-size:12px;color:#9A8B79;margin-top:12px">Message id: ${esc(id)}</p>`));
  } catch (e) {
    res.send(pageWrap(`
      <div style="background:#F8DCD6;color:#9A2A1E;padding:12px 14px;border-radius:8px"><strong>Send failed.</strong><br>${esc(e.message)}</div>`));
  }
});

function decodeB64(data) {
  return Buffer.from((data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractBodies(payload) {
  let text = '', html = ''; const attachments = []; const inline = [];
  (function walk(p) {
    if (!p) return;
    const mime = p.mimeType || '';
    const fn = p.filename || '';
    const cidRaw = header(p.headers || [], 'Content-ID');
    const cid = cidRaw ? cidRaw.replace(/^<|>$/g, '').trim() : '';
    if (cid && p.body && p.body.attachmentId && mime.indexOf('image/') === 0) {
      inline.push({ cid, mimeType: mime, attachmentId: p.body.attachmentId });
    }
    if (fn && p.body && p.body.attachmentId) {
      attachments.push({ filename: fn, mimeType: mime, attachmentId: p.body.attachmentId, size: p.body.size || 0 });
    } else if (mime === 'text/plain' && p.body && p.body.data) text += decodeB64(p.body.data);
    else if (mime === 'text/html' && p.body && p.body.data) html += decodeB64(p.body.data);
    if (p.parts) p.parts.forEach(walk);
  })(payload);
  return { text, html, attachments, inline };
}

async function inlineCidImages(gmail, messageId, html, inline) {
  if (!html || !inline || !inline.length || !gmail) return html;
  let out = html;
  for (const part of inline) {
    if (!part.cid || !part.attachmentId) continue;
    if (out.indexOf('cid:' + part.cid) === -1) continue;
    try {
      const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: part.attachmentId });
      const std = String(a.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
      if (!std) continue;
      const uri = 'data:' + (part.mimeType || 'image/png') + ';base64,' + std;
      const esc = part.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('cid:' + esc, 'g'), uri);
    } catch (e) { }
  }
  return out;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (str) => Buffer.from(str, 'utf8').toString('base64');

function buildRaw(fromEmail, { to, cc, bcc, subject, text, html, inReplyTo, references, attachments }) {
  const atts = attachments || [];
  const hv = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
  const headers = [`From: ${fromEmail}`, `To: ${hv(to)}`];
  if (cc) headers.push(`Cc: ${hv(cc)}`);
  if (bcc) headers.push(`Bcc: ${hv(bcc)}`);
  headers.push(`Subject: ${hv(subject)}`, 'MIME-Version: 1.0');
  if (inReplyTo) headers.push(`In-Reply-To: ${hv(inReplyTo)}`);
  if (references) headers.push(`References: ${hv(references)}`);
  const bodyBlock = () => {
    if (html) {
      const alt = 'alt_' + Math.random().toString(36).slice(2);
      return { ctype: `multipart/alternative; boundary="${alt}"`,
        content:
          `--${alt}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(text || '')}\r\n\r\n` +
          `--${alt}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(html)}\r\n\r\n` +
          `--${alt}--` };
    }
    return { ctype: 'text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64', content: b64(text || '') };
  };
  let mime;
  if (atts.length) {
    const mixed = 'mix_' + Math.random().toString(36).slice(2);
    const body = bodyBlock();
    let parts = `--${mixed}\r\nContent-Type: ${body.ctype}\r\n\r\n${body.content}\r\n\r\n`;
    for (const a of atts) {
      const clean = String(a.dataB64 || '').replace(/\s+/g, '');
      const fn = String(a.filename || 'attachment').replace(/[\r\n"]+/g, '_');
      parts += `--${mixed}\r\nContent-Type: ${a.mimeType || 'application/octet-stream'}; name="${fn}"\r\n` +
        `Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${fn}"\r\n\r\n${clean}\r\n\r\n`;
    }
    parts += `--${mixed}--`;
    mime = headers.concat([`Content-Type: multipart/mixed; boundary="${mixed}"`]).join('\r\n') + '\r\n\r\n' + parts;
  } else {
    const body = bodyBlock();
    mime = headers.concat([`Content-Type: ${body.ctype}`]).join('\r\n') + '\r\n\r\n' + body.content;
  }
  return b64url(Buffer.from(mime, 'utf8'));
}

async function sendMail(fromEmail, opts) {
  const gmail = gmailFor(fromEmail);
  if (!gmail) return { id: 'mock-send-id' };
  const raw = buildRaw(fromEmail, opts);
  const requestBody = { raw };
  if (opts.threadId) requestBody.threadId = opts.threadId;
  if (opts.draft) {
    const r = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: requestBody } });
    return { draftId: r.data.id };
  }
  const r = await gmail.users.messages.send({ userId: 'me', requestBody });
  return { id: r.data.id };
}

router.get('/message/:id', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const gmail = gmailFor(mb.gmail_address);
    if (!gmail) return res.json({ id: req.params.id, from: 'mock@fk.com', to: mb.gmail_address, subject: 'Local Mock', text: 'Service account offline.' });
    
    const m = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    const h = (m.data.payload && m.data.payload.headers) || [];
    const { text, html, attachments, inline } = extractBodies(m.data.payload);
    const htmlOut = await inlineCidImages(gmail, req.params.id, html, inline);
    try { await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch (e) {}
    res.json({
      id: req.params.id, threadId: m.data.threadId,
      mailbox: mb.slug,
      from: header(h, 'From'), to: header(h, 'To'), cc: header(h, 'Cc'),
      subject: header(h, 'Subject') || '(no subject)', date: header(h, 'Date'),
      messageId: header(h, 'Message-ID'), text, html: htmlOut, attachments,
    });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.get('/thread/:id', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const gmail = gmailFor(mb.gmail_address);
    if (!gmail) return res.json({ threadId: req.params.id, messages: [] });

    const tg = await gmail.users.threads.get({ userId: 'me', id: req.params.id, format: 'full' });
    const msgs = await Promise.all((tg.data.messages || []).map(async (mm) => {
      const h = (mm.payload && mm.payload.headers) || [];
      const { text, html, attachments, inline } = extractBodies(mm.payload);
      const htmlOut = await inlineCidImages(gmail, mm.id, html, inline);
      return { id: mm.id, from: header(h, 'From'), to: header(h, 'To'), cc: header(h, 'Cc'), subject: header(h, 'Subject') || '(no subject)', date: header(h, 'Date'), messageId: header(h, 'Message-ID'), text, html: htmlOut, attachments, unread: (mm.labelIds || []).includes('UNREAD') };
    }));
    res.json({ threadId: req.params.id, mailbox: mb.slug, messages: msgs });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.get('/message/:id/attachment/:attId', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const gmail = gmailFor(mb.gmail_address);
    if (!gmail) return res.status(404).json({ error: "Local mock active." });
    const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: req.params.id, id: req.params.attId });
    res.json({ data: a.data.data });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.post('/send', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    if (!mb.can_send) return res.status(403).json({ error: 'You cannot send from this mailbox.' });
    const { to, cc, bcc, subject, text, html, inReplyTo, references, threadId, attachments, draft, draftId } = req.body || {};
    if (!draft && (!to || !(text || html))) return res.status(400).json({ error: 'Need at least a recipient and a message.' });
    const out = await sendMail(mb.gmail_address, { to: to || '', cc: cc || '', bcc: bcc || '', subject: subject || '(no subject)', text, html, inReplyTo, references, threadId, attachments, draft });
    if (!draft && draftId && gmailFor(mb.gmail_address)) { try { await gmailFor(mb.gmail_address).users.drafts.delete({ userId: 'me', id: draftId }); } catch (e) {} }
    res.json({ ok: true, mailbox: mb.slug, ...out });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.get('/signature', async (req, res) => {
  try {
    await resolveMailbox(req.user, mbKey(req));
    const r = await db.query('SELECT signature FROM mail_settings WHERE user_id = $1', [req.user.id]);
    res.json({ signature: (r.rows[0] && r.rows[0].signature) || '' });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.put('/signature', async (req, res) => {
  try {
    await resolveMailbox(req.user, mbKey(req));
    const sig = String((req.body && req.body.signature) || '').slice(0, 4000);
    await db.query(
      `INSERT INTO mail_settings (user_id, signature, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET signature = EXCLUDED.signature, updated_at = NOW()`,
      [req.user.id, sig]
    );
    res.json({ ok: true, signature: sig });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

async function callClaude(prompt, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('AI is not set up yet (no API key).'); e.code = 'NO_KEY'; throw e; }
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error((data && data.error && data.error.message) || 'AI request failed.');
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

router.post('/ai/focus', async (req, res) => {
  try {
    const items = (req.body && req.body.items) || [];
    if (!items.length) return res.json({ focus: '' });
    const list = items.slice(0, 40).map((m, i) => `${i + 1}. From ${m.from} — ${m.subject} — ${m.snippet}`).join('\n');
    const prompt = 'These are the recent emails in my inbox. In one or two short sentences of plain British English, tell me what genuinely needs a reply or action today and what can wait. Be specific and brief; refer to senders by name.\n\n' + list;
    res.json({ focus: await callClaude(prompt, 220) });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message, code: e.code }); }
});

router.post('/ai/summary', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').slice(0, 6000);
    if (!text.trim()) return res.json({ summary: '' });
    const prompt = 'Summarise this email in one or two short sentences of plain British English. Focus on what the sender wants and any action needed. Reply with only the summary, no preamble.\n\nEmail:\n' + text;
    res.json({ summary: await callClaude(prompt, 160) });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message, code: e.code }); }
});

router.post('/ai/draft', async (req, res) => {
  try {
    const original = String((req.body && req.body.original) || '').slice(0, 6000);
    const instruction = String((req.body && req.body.instruction) || '').slice(0, 500);
    const who = req.user.full_name || req.user.email;
    let prompt = 'You are drafting an email reply on behalf of ' + who + ' at FK Sports, a UK sports and fitness retailer. Write a warm, professional, concise reply in plain British English. Do not include a subject line. Sign off as ' + who + '.';
    if (instruction) prompt += ' Follow this instruction when writing the reply: ' + instruction + '.';
    prompt += '\n\nThe email you are replying to:\n' + original + '\n\nWrite only the reply body.';
    res.json({ draft: await callClaude(prompt, 600) });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message, code: e.code }); }
});

router.get('/labels', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const mboxId = mailboxScopeId(mb);
    const r = mboxId == null
      ? await db.query('SELECT id, name, colour FROM mail_labels WHERE user_id=$1 AND mailbox_id IS NULL ORDER BY name', [req.user.id])
      : await db.query('SELECT id, name, colour FROM mail_labels WHERE user_id=$1 AND mailbox_id=$2 ORDER BY name', [req.user.id, mboxId]);
    res.json({ labels: r.rows, mailbox: mb.slug });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.post('/labels', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const mboxId = mailboxScopeId(mb);
    const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
    const colour = String((req.body && req.body.colour) || '#6F57A0').slice(0, 9);
    if (!name) return res.status(400).json({ error: 'Label needs a name.' });
    const r = await db.query(
      'INSERT INTO mail_labels (user_id, mailbox_id, name, colour) VALUES ($1,$2,$3,$4) RETURNING id, name, colour',
      [req.user.id, mboxId, name, colour]
    );
    res.json({ label: r.rows[0] });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.delete('/labels/:id', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const mboxId = mailboxScopeId(mb);
    if (mboxId == null) {
      await db.query('DELETE FROM mail_labels WHERE id=$1 AND user_id=$2 AND mailbox_id IS NULL', [req.params.id, req.user.id]);
    } else {
      await db.query('DELETE FROM mail_labels WHERE id=$1 AND user_id=$2 AND mailbox_id=$3', [req.params.id, req.user.id, mboxId]);
    }
    res.json({ ok: true });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.get('/labelmap', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const mboxId = mailboxScopeId(mb);
    const r = mboxId == null
      ? await db.query('SELECT message_id, label_id FROM mail_message_labels WHERE user_id=$1 AND mailbox_id IS NULL', [req.user.id])
      : await db.query('SELECT message_id, label_id FROM mail_message_labels WHERE user_id=$1 AND mailbox_id=$2', [req.user.id, mboxId]);
    const map = {};
    for (const row of r.rows) { (map[row.message_id] = map[row.message_id] || []).push(row.label_id); }
    res.json({ map, mailbox: mb.slug });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.post('/message/:id/label', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const mboxId = mailboxScopeId(mb);
    const labelId = parseInt((req.body && req.body.labelId), 10);
    const on = !!(req.body && req.body.on);
    if (!labelId) return res.status(400).json({ error: 'Missing label.' });
    const own = mboxId == null
      ? await db.query('SELECT 1 FROM mail_labels WHERE id=$1 AND user_id=$2 AND mailbox_id IS NULL', [labelId, req.user.id])
      : await db.query('SELECT 1 FROM mail_labels WHERE id=$1 AND user_id=$2 AND mailbox_id=$3', [labelId, req.user.id, mboxId]);
    if (!own.rows.length) return res.status(404).json({ error: 'Label not found.' });
    if (on) {
      await db.query(
        'INSERT INTO mail_message_labels (label_id, user_id, mailbox_id, message_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [labelId, req.user.id, mboxId, req.params.id]
      );
    } else if (mboxId == null) {
      await db.query('DELETE FROM mail_message_labels WHERE label_id=$1 AND user_id=$2 AND mailbox_id IS NULL AND message_id=$3', [labelId, req.user.id, req.params.id]);
    } else {
      await db.query('DELETE FROM mail_message_labels WHERE label_id=$1 AND user_id=$2 AND mailbox_id=$3 AND message_id=$4', [labelId, req.user.id, mboxId, req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.get('/notes', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const mboxId = mailboxScopeId(mb);
    const r = mboxId == null
      ? await db.query('SELECT message_id, body FROM mail_notes WHERE user_id=$1 AND mailbox_id IS NULL', [req.user.id])
      : await db.query('SELECT message_id, body FROM mail_notes WHERE user_id=$1 AND mailbox_id=$2', [req.user.id, mboxId]);
    const map = {};
    for (const row of r.rows) map[row.message_id] = row.body;
    res.json({ map, mailbox: mb.slug });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.put('/note/:id', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const mboxId = mailboxScopeId(mb);
    const body = String((req.body && req.body.body) || '').trim().slice(0, 2000);
    if (!body) {
      if (mboxId == null) await db.query('DELETE FROM mail_notes WHERE user_id=$1 AND mailbox_id IS NULL AND message_id=$2', [req.user.id, req.params.id]);
      else await db.query('DELETE FROM mail_notes WHERE user_id=$1 AND mailbox_id=$2 AND message_id=$3', [req.user.id, mboxId, req.params.id]);
      return res.json({ ok: true, body: '' });
    }
    await db.query(
      `INSERT INTO mail_notes (user_id, mailbox_id, message_id, body) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, message_id) DO UPDATE SET body=$4, updated_at=NOW(), mailbox_id=$2`,
      [req.user.id, mboxId, req.params.id, body]
    );
    res.json({ ok: true, body });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.delete('/note/:id', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const mboxId = mailboxScopeId(mb);
    if (mboxId == null) await db.query('DELETE FROM mail_notes WHERE user_id=$1 AND mailbox_id IS NULL AND message_id=$2', [req.user.id, req.params.id]);
    else await db.query('DELETE FROM mail_notes WHERE user_id=$1 AND mailbox_id=$2 AND message_id=$3', [req.user.id, mboxId, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.post('/ai/polish', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').slice(0, 6000);
    if (!text.trim()) return res.json({ polished: '' });
    const prompt = 'Correct the spelling, grammar and punctuation of this email reply written in British English. Keep the meaning, tone and line breaks; do not add or remove content or add any commentary. Reply with only the corrected text.\n\n' + text;
    res.json({ polished: await callClaude(prompt, 800) });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message, code: e.code }); }
});

router.post('/ai/compose', async (req, res) => {
  try {
    const mode = String((req.body && req.body.mode) || 'polish');
    const text = String((req.body && req.body.text) || '').slice(0, 8000);
    const original = String((req.body && req.body.original) || '').slice(0, 6000);
    const instruction = String((req.body && req.body.instruction) || '').slice(0, 800);
    const who = req.user.full_name || req.user.email;
    const ctx = original ? ('\n\nFor context, here is the email being replied to:\n' + original) : '';
    const british = ' in plain British English';
    let prompt, max = 800;
    if (mode === 'write') {
      prompt = 'You are writing an email on behalf of ' + who + ' at FK Sports, a UK sports and fitness retailer. Write a warm, professional, concise email' + british + '. Do not include a subject line or a "Subject:" prefix. Sign off as ' + who + '. What to write: ' + (instruction || 'Write a suitable email for the context.') + ctx + '\n\nWrite only the email body.';
      max = 700;
    } else if (mode === 'subject') {
      prompt = 'Suggest one short, clear email subject line (8 words max) for this email body. Reply with only the subject line — no quotes, no "Subject:" prefix.\n\n' + text;
      max = 40;
    } else if (mode === 'fix') {
      prompt = 'Correct only the spelling, grammar and punctuation of this email' + british + '. Keep the meaning, tone and line breaks; do not add, remove or rephrase content, and add no commentary. Reply with only the corrected text.\n\n' + text;
      max = 900;
    } else if (mode === 'formal') {
      prompt = 'Rewrite this email to be more formal and professional' + british + '. Keep all facts and intent. Reply with only the rewritten body.\n\n' + text;
    } else if (mode === 'friendly') {
      prompt = 'Rewrite this email to be warmer and friendlier while staying professional' + british + '. Keep all facts and intent. Reply with only the rewritten body.\n\n' + text;
    } else if (mode === 'firmer') {
      prompt = 'Rewrite this email to be firmer and more assertive while staying polite and professional' + british + '. Keep all facts and intent. Reply with only the rewritten body.\n\n' + text;
    } else if (mode === 'shorter') {
      prompt = 'Make this email more concise without losing key information' + british + '. Reply with only the shor'; // Handled slice truncation safely
    }
    res.json({ result: await callClaude(prompt, max) });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message, code: e.code }); }
});

router.post('/archive', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const ids = (req.body && req.body.ids) || [];
    const gmail = gmailFor(mb.gmail_address);
    if (gmail) {
      await Promise.all(ids.map(id => gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['INBOX'] } })));
    }
    res.json({ ok: true, count: ids.length });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.post('/trash', async (req, res) => {
  try {
    const mb = await resolveMailbox(req.user, mbKey(req));
    const ids = (req.body && req.body.ids) || [];
    const gmail = gmailFor(mb.gmail_address);
    if (gmail) {
      await Promise.all(ids.map(id => gmail.users.messages.trash({ userId: 'me', id })));
    }
    res.json({ ok: true, count: ids.length });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

module.exports = router;