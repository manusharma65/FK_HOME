// FK Home — Mail module (Gmail via service account + domain-wide delegation)
//
// This is the engine room. It logs in as the `fk-home-mail` service account
// (credentials in the GMAIL_SA_JSON env var), impersonates a given staff
// mailbox, and reads/sends through the Gmail API. No per-user passwords, no
// EmailEngine — just Google's own free API on the delegation we set up.
//
// r0.80 milestone: READ-ONLY proof. Lists recent inbox messages so we can
// confirm the whole chain works before building the inbox screen or sending.

const express = require('express');
const { google } = require('googleapis');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

// Build an authenticated Gmail client that acts AS the given mailbox.
function gmailFor(userEmail) {
  const raw = process.env.GMAIL_SA_JSON;
  if (!raw) {
    throw new Error('GMAIL_SA_JSON is not set — paste the service-account JSON into Railway as that variable.');
  }
  let key;
  try {
    key = JSON.parse(raw);
  } catch (e) {
    throw new Error('GMAIL_SA_JSON is set but is not valid JSON — re-paste the whole file contents.');
  }
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
    subject: userEmail, // impersonate this staff mailbox
  });
  return google.gmail({ version: 'v1', auth });
}

function header(headers, name) {
  const h = (headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// Pull the most recent inbox messages (metadata only) for a mailbox.
async function listInbox(userEmail, max = 12) {
  const gmail = gmailFor(userEmail);
  const list = await gmail.users.messages.list({
    userId: 'me',
    maxResults: max,
    labelIds: ['INBOX'],
  });
  const ids = (list.data.messages || []).map(m => m.id);
  const items = await Promise.all(ids.map(async (id) => {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
    const h = msg.data.payload && msg.data.payload.headers;
    return {
      id,
      from: header(h, 'From'),
      subject: header(h, 'Subject') || '(no subject)',
      date: header(h, 'Date'),
      snippet: msg.data.snippet || '',
      unread: (msg.data.labelIds || []).includes('UNREAD'),
    };
  }));
  return items;
}

// JSON endpoint — the future inbox screen will read from this.
router.get('/inbox', async (req, res) => {
  try {
    const items = await listInbox(req.user.email);
    res.json({ mailbox: req.user.email, count: items.length, messages: items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Friendly read-only proof page — visit /api/mail/test while logged in.
router.get('/test', async (req, res) => {
  let body, ok = false, items = [];
  try {
    items = await listInbox(req.user.email);
    ok = true;
  } catch (e) {
    body = e.message;
  }
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = items.map(m => `
    <div style="padding:12px 14px;border-bottom:1px solid #EFE6D6;${m.unread ? 'background:#FFFDF9' : ''}">
      <div style="display:flex;justify-content:space-between;gap:10px">
        <strong style="font-size:14px;color:#3A2D22">${m.unread ? '● ' : ''}${esc(m.from)}</strong>
        <span style="font-size:12px;color:#9A8B79;white-space:nowrap">${esc(m.date)}</span>
      </div>
      <div style="font-size:13px;color:#3A2D22;margin-top:2px">${esc(m.subject)}</div>
      <div style="font-size:12px;color:#8A7E72;margin-top:2px">${esc(m.snippet)}</div>
    </div>`).join('');
  const banner = ok
    ? `<div style="background:#E3F0DA;color:#2F6B1E;padding:12px 14px;border-radius:8px;font-weight:600">✓ Connected. Reading mailbox: ${esc(req.user.email)} — ${items.length} recent message(s).</div>`
    : `<div style="background:#F8DCD6;color:#9A2A1E;padding:12px 14px;border-radius:8px"><strong>Not connected yet.</strong><br>${esc(body)}</div>`;
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>FK Home — Mail test</title></head>
    <body style="font-family:system-ui,sans-serif;max-width:680px;margin:30px auto;padding:0 16px;color:#2E2620;background:#FAF4EA">
      <h1 style="font-size:22px">Mail connection test</h1>
      ${banner}
      <div style="margin-top:16px;background:#fff;border:1px solid #E7DAC7;border-radius:12px;overflow:hidden">${rows || (ok ? '<div style="padding:14px;color:#8A7E72">Inbox is empty.</div>' : '')}</div>
      <p style="font-size:12px;color:#9A8B79;margin-top:14px">Read-only. Nothing is sent, changed, or deleted. This is a temporary proof page.</p>
    </body></html>`);
});

// Send a plain-text email AS the given mailbox. The real composer will build on
// this; for now it powers the send proof. Returns the sent message id.
async function sendPlain(fromEmail, to, subject, text) {
  const gmail = gmailFor(fromEmail);
  const mime = [
    `From: ${fromEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text,
  ].join('\r\n');
  const raw = Buffer.from(mime).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return r.data.id;
}

const pageWrap = (inner) => `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>FK Home — Send test</title></head>
  <body style="font-family:system-ui,sans-serif;max-width:680px;margin:30px auto;padding:0 16px;color:#2E2620;background:#FAF4EA">
  <h1 style="font-size:22px">Mail send test</h1>${inner}</body></html>`;

// Send proof — emails YOU, from YOU. Self-contained, spams nobody.
// Visiting the page explains it; the actual send only fires with ?go=1.
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

// ---- Reading a full message + sending real replies (r0.82) ----

function decodeB64(data) {
  return Buffer.from((data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Walk a Gmail payload tree and pull out plain + html bodies.
function extractBodies(payload) {
  let text = '', html = '';
  (function walk(p) {
    if (!p) return;
    const mime = p.mimeType || '';
    if (mime === 'text/plain' && p.body && p.body.data) text += decodeB64(p.body.data);
    else if (mime === 'text/html' && p.body && p.body.data) html += decodeB64(p.body.data);
    if (p.parts) p.parts.forEach(walk);
  })(payload);
  return { text, html };
}

// Send a real message AS the mailbox, with optional reply threading.
async function sendMail(fromEmail, { to, subject, text, inReplyTo, references, threadId }) {
  const gmail = gmailFor(fromEmail);
  const lines = [
    `From: ${fromEmail}`, `To: ${to}`, `Subject: ${subject}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  const mime = lines.join('\r\n') + '\r\n\r\n' + (text || '');
  const raw = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const requestBody = { raw };
  if (threadId) requestBody.threadId = threadId;
  const r = await gmail.users.messages.send({ userId: 'me', requestBody });
  return r.data.id;
}

// Full message for the reading pane (and mark it read).
router.get('/message/:id', async (req, res) => {
  try {
    const gmail = gmailFor(req.user.email);
    const m = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    const h = (m.data.payload && m.data.payload.headers) || [];
    const { text, html } = extractBodies(m.data.payload);
    try { await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch (e) {}
    res.json({
      id: req.params.id, threadId: m.data.threadId,
      from: header(h, 'From'), to: header(h, 'To'),
      subject: header(h, 'Subject') || '(no subject)', date: header(h, 'Date'),
      messageId: header(h, 'Message-ID'), text, html,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send / reply from the composer.
router.post('/send', async (req, res) => {
  try {
    const { to, subject, text, inReplyTo, references, threadId } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: 'Need at least a recipient and a message.' });
    const id = await sendMail(req.user.email, { to, subject: subject || '(no subject)', text, inReplyTo, references, threadId });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Archive (remove from Inbox) one or many — Gmail's "archive".
router.post('/archive', async (req, res) => {
  try {
    const ids = (req.body && req.body.ids) || [];
    const gmail = gmailFor(req.user.email);
    await Promise.all(ids.map(id => gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['INBOX'] } })));
    res.json({ ok: true, count: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete one or many — sends to Gmail Trash (recoverable for 30 days, like Gmail).
router.post('/trash', async (req, res) => {
  try {
    const ids = (req.body && req.body.ids) || [];
    const gmail = gmailFor(req.user.email);
    await Promise.all(ids.map(id => gmail.users.messages.trash({ userId: 'me', id })));
    res.json({ ok: true, count: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- AI layer (r0.85): summary + draft, via the Anthropic API ----
// Needs ANTHROPIC_API_KEY set in Railway. Model overridable via ANTHROPIC_MODEL.
async function callClaude(prompt, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('AI is not set up yet (no API key).'); e.code = 'NO_KEY'; throw e; }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error((data && data.error && data.error.message) || 'AI request failed.');
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

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

module.exports = router;
