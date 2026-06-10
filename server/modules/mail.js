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
const { db } = require('../db');

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

// Pull recent messages (metadata only) for a mailbox section.
async function listInbox(userEmail, box = 'inbox', max = 20) {
  const gmail = gmailFor(userEmail);
  const params = { userId: 'me', maxResults: max };
  if (box === 'sent') params.labelIds = ['SENT'];
  else if (box === 'archive') params.q = '-in:inbox -in:sent -in:trash -in:spam -in:drafts';
  else params.labelIds = ['INBOX'];
  const list = await gmail.users.messages.list(params);
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
    const box = ['inbox', 'sent', 'archive'].includes(req.query.box) ? req.query.box : 'inbox';
    const items = await listInbox(req.user.email, box);
    res.json({ mailbox: req.user.email, box, count: items.length, messages: items });
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
  let text = '', html = ''; const attachments = [];
  (function walk(p) {
    if (!p) return;
    const mime = p.mimeType || '';
    const fn = p.filename || '';
    if (fn && p.body && p.body.attachmentId) {
      attachments.push({ filename: fn, mimeType: mime, attachmentId: p.body.attachmentId, size: p.body.size || 0 });
    } else if (mime === 'text/plain' && p.body && p.body.data) text += decodeB64(p.body.data);
    else if (mime === 'text/html' && p.body && p.body.data) html += decodeB64(p.body.data);
    if (p.parts) p.parts.forEach(walk);
  })(payload);
  return { text, html, attachments };
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (str) => Buffer.from(str, 'utf8').toString('base64');

// Build a raw RFC822 message: plain, or text+html alternative, with optional attachments.
function buildRaw(fromEmail, { to, subject, text, html, inReplyTo, references, attachments }) {
  const atts = attachments || [];
  const headers = [`From: ${fromEmail}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0'];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
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
      parts += `--${mixed}\r\nContent-Type: ${a.mimeType || 'application/octet-stream'}; name="${a.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${a.filename}"\r\n\r\n${clean}\r\n\r\n`;
    }
    parts += `--${mixed}--`;
    mime = headers.concat([`Content-Type: multipart/mixed; boundary="${mixed}"`]).join('\r\n') + '\r\n\r\n' + parts;
  } else {
    const body = bodyBlock();
    mime = headers.concat([`Content-Type: ${body.ctype}`]).join('\r\n') + '\r\n\r\n' + body.content;
  }
  return b64url(Buffer.from(mime, 'utf8'));
}

// Send (or draft) a real message AS the mailbox, with optional reply threading.
async function sendMail(fromEmail, opts) {
  const gmail = gmailFor(fromEmail);
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

// Full message for the reading pane (and mark it read).
router.get('/message/:id', async (req, res) => {
  try {
    const gmail = gmailFor(req.user.email);
    const m = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    const h = (m.data.payload && m.data.payload.headers) || [];
    const { text, html, attachments } = extractBodies(m.data.payload);
    try { await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch (e) {}
    res.json({
      id: req.params.id, threadId: m.data.threadId,
      from: header(h, 'From'), to: header(h, 'To'),
      subject: header(h, 'Subject') || '(no subject)', date: header(h, 'Date'),
      messageId: header(h, 'Message-ID'), text, html, attachments,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Download a single attachment (returns base64url data).
router.get('/message/:id/attachment/:attId', async (req, res) => {
  try {
    const gmail = gmailFor(req.user.email);
    const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: req.params.id, id: req.params.attId });
    res.json({ data: a.data.data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send / reply / forward from the composer (text, optional html, attachments, or save as draft).
router.post('/send', async (req, res) => {
  try {
    const { to, subject, text, html, inReplyTo, references, threadId, attachments, draft } = req.body || {};
    if (!draft && (!to || !(text || html))) return res.status(400).json({ error: 'Need at least a recipient and a message.' });
    const out = await sendMail(req.user.email, { to: to || '', subject: subject || '(no subject)', text, html, inReplyTo, references, threadId, attachments, draft });
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AI "Focus today" — triage the visible inbox into what needs action today.
router.post('/ai/focus', async (req, res) => {
  try {
    const items = (req.body && req.body.items) || [];
    if (!items.length) return res.json({ focus: '' });
    const list = items.slice(0, 40).map((m, i) => `${i + 1}. From ${m.from} — ${m.subject} — ${m.snippet}`).join('\n');
    const prompt = 'These are the recent emails in my inbox. In one or two short sentences of plain British English, tell me what genuinely needs a reply or action today and what can wait. Be specific and brief; refer to senders by name.\n\n' + list;
    res.json({ focus: await callClaude(prompt, 220) });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message, code: e.code }); }
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

// ---- Personal labels (stored in FK Home) ----
router.get('/labels', async (req, res) => {
  try {
    const r = await db.query('SELECT id, name, colour FROM mail_labels WHERE user_id=$1 ORDER BY name', [req.user.id]);
    res.json({ labels: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/labels', async (req, res) => {
  try {
    const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
    const colour = String((req.body && req.body.colour) || '#6F57A0').slice(0, 9);
    if (!name) return res.status(400).json({ error: 'Label needs a name.' });
    const r = await db.query('INSERT INTO mail_labels (user_id, name, colour) VALUES ($1,$2,$3) RETURNING id, name, colour', [req.user.id, name, colour]);
    res.json({ label: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/labels/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM mail_labels WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Map of messageId -> [labelId,...] for this user (for chips + counts).
router.get('/labelmap', async (req, res) => {
  try {
    const r = await db.query('SELECT message_id, label_id FROM mail_message_labels WHERE user_id=$1', [req.user.id]);
    const map = {};
    for (const row of r.rows) { (map[row.message_id] = map[row.message_id] || []).push(row.label_id); }
    res.json({ map });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Apply / remove a label on a message.
router.post('/message/:id/label', async (req, res) => {
  try {
    const labelId = parseInt((req.body && req.body.labelId), 10);
    const on = !!(req.body && req.body.on);
    if (!labelId) return res.status(400).json({ error: 'Missing label.' });
    const own = await db.query('SELECT 1 FROM mail_labels WHERE id=$1 AND user_id=$2', [labelId, req.user.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'Label not found.' });
    if (on) await db.query('INSERT INTO mail_message_labels (label_id, user_id, message_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [labelId, req.user.id, req.params.id]);
    else await db.query('DELETE FROM mail_message_labels WHERE label_id=$1 AND user_id=$2 AND message_id=$3', [labelId, req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Pinned private notes (stored in FK Home) ----
router.get('/notes', async (req, res) => {
  try {
    const r = await db.query('SELECT message_id, body FROM mail_notes WHERE user_id=$1', [req.user.id]);
    const map = {};
    for (const row of r.rows) map[row.message_id] = row.body;
    res.json({ map });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/note/:id', async (req, res) => {
  try {
    const body = String((req.body && req.body.body) || '').trim().slice(0, 2000);
    if (!body) { await db.query('DELETE FROM mail_notes WHERE user_id=$1 AND message_id=$2', [req.user.id, req.params.id]); return res.json({ ok: true, body: '' }); }
    await db.query('INSERT INTO mail_notes (user_id, message_id, body) VALUES ($1,$2,$3) ON CONFLICT (user_id, message_id) DO UPDATE SET body=$3, updated_at=NOW()', [req.user.id, req.params.id, body]);
    res.json({ ok: true, body });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/note/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM mail_notes WHERE user_id=$1 AND message_id=$2', [req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AI spell/grammar polish — on demand, one call, returns corrected text only.
router.post('/ai/polish', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').slice(0, 6000);
    if (!text.trim()) return res.json({ polished: '' });
    const prompt = 'Correct the spelling, grammar and punctuation of this email reply written in British English. Keep the meaning, tone and line breaks; do not add or remove content or add any commentary. Reply with only the corrected text.\n\n' + text;
    res.json({ polished: await callClaude(prompt, 800) });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message, code: e.code }); }
});

module.exports = router;
