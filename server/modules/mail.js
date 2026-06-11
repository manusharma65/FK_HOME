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

// Pull recent items for a mailbox section. Inbox/Sent/Archive are grouped by
// conversation (thread); Drafts are listed individually.
async function listInbox(userEmail, opts = {}) {
  const { box = 'inbox', q = '', pageToken = '', max = 25 } = opts;
  const gmail = gmailFor(userEmail);
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

// JSON endpoint for the inbox screen — supports box, server-side search (q), paging.
router.get('/inbox', async (req, res) => {
  try {
    const box = ['inbox', 'sent', 'archive', 'drafts'].includes(req.query.box) ? req.query.box : 'inbox';
    const q = String(req.query.q || '').slice(0, 200).trim();
    const pageToken = String(req.query.pageToken || '');
    const out = await listInbox(req.user.email, { box, q, pageToken });
    res.json({ mailbox: req.user.email, box, count: out.messages.length, messages: out.messages, nextPageToken: out.nextPageToken });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Colleague address book for compose autocomplete.
router.get('/contacts', async (req, res) => {
  try {
    const r = await db.query("SELECT full_name, display_name, email FROM users WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> '' ORDER BY full_name");
    res.json({ contacts: r.rows.map(u => ({ name: u.display_name || u.full_name, email: u.email })) });
  } catch (e) { res.status(500).json({ error: e.message, contacts: [] }); }
});

// Friendly read-only proof page — visit /api/mail/test while logged in.

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

// Walk a Gmail payload tree and pull out plain + html bodies, file attachments,
// and inline (Content-ID) image parts used by cid: refs in the HTML.
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

// Rewrite cid: references in the HTML to self-contained data: URIs by fetching
// the inline parts' bytes. Best-effort per image: a failed fetch leaves the cid
// ref untouched (no worse than today's broken image) rather than failing the read.
async function inlineCidImages(gmail, messageId, html, inline) {
  if (!html || !inline || !inline.length) return html;
  let out = html;
  for (const part of inline) {
    if (!part.cid || !part.attachmentId) continue;
    if (out.indexOf('cid:' + part.cid) === -1) continue; // not referenced — skip the fetch
    try {
      const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: part.attachmentId });
      const std = String(a.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
      if (!std) continue;
      const uri = 'data:' + (part.mimeType || 'image/png') + ';base64,' + std;
      const esc = part.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('cid:' + esc, 'g'), uri);
    } catch (e) { /* leave the cid ref in place */ }
  }
  return out;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (str) => Buffer.from(str, 'utf8').toString('base64');

// Build a raw RFC822 message: plain, or text+html alternative, with optional attachments.
function buildRaw(fromEmail, { to, cc, bcc, subject, text, html, inReplyTo, references, attachments }) {
  const atts = attachments || [];
  // Strip CR/LF from header values so a newline can't inject extra headers.
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
    const { text, html, attachments, inline } = extractBodies(m.data.payload);
    const htmlOut = await inlineCidImages(gmail, req.params.id, html, inline);
    try { await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch (e) {}
    res.json({
      id: req.params.id, threadId: m.data.threadId,
      from: header(h, 'From'), to: header(h, 'To'), cc: header(h, 'Cc'),
      subject: header(h, 'Subject') || '(no subject)', date: header(h, 'Date'),
      messageId: header(h, 'Message-ID'), text, html: htmlOut, attachments,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full conversation (all messages in a thread) for the inline thread view.
router.get('/thread/:id', async (req, res) => {
  try {
    const gmail = gmailFor(req.user.email);
    const tg = await gmail.users.threads.get({ userId: 'me', id: req.params.id, format: 'full' });
    const msgs = await Promise.all((tg.data.messages || []).map(async (mm) => {
      const h = (mm.payload && mm.payload.headers) || [];
      const { text, html, attachments, inline } = extractBodies(mm.payload);
      const htmlOut = await inlineCidImages(gmail, mm.id, html, inline);
      return { id: mm.id, from: header(h, 'From'), to: header(h, 'To'), cc: header(h, 'Cc'), subject: header(h, 'Subject') || '(no subject)', date: header(h, 'Date'), messageId: header(h, 'Message-ID'), text, html: htmlOut, attachments, unread: (mm.labelIds || []).includes('UNREAD') };
    }));
    res.json({ threadId: req.params.id, messages: msgs });
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

// Send / reply / forward / compose-new (text, optional html, cc, attachments, or save as draft).
router.post('/send', async (req, res) => {
  try {
    const { to, cc, bcc, subject, text, html, inReplyTo, references, threadId, attachments, draft, draftId } = req.body || {};
    if (!draft && (!to || !(text || html))) return res.status(400).json({ error: 'Need at least a recipient and a message.' });
    const out = await sendMail(req.user.email, { to: to || '', cc: cc || '', bcc: bcc || '', subject: subject || '(no subject)', text, html, inReplyTo, references, threadId, attachments, draft });
    if (!draft && draftId) { try { await gmailFor(req.user.email).users.drafts.delete({ userId: 'me', id: draftId }); } catch (e) {} }
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Per-user email signature (stored in FK Home, appended in the composer).
router.get('/signature', async (req, res) => {
  try {
    const r = await db.query('SELECT signature FROM mail_settings WHERE user_id = $1', [req.user.id]);
    res.json({ signature: (r.rows[0] && r.rows[0].signature) || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/signature', async (req, res) => {
  try {
    const sig = String((req.body && req.body.signature) || '').slice(0, 4000);
    await db.query(
      `INSERT INTO mail_settings (user_id, signature, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET signature = EXCLUDED.signature, updated_at = NOW()`,
      [req.user.id, sig]
    );
    res.json({ ok: true, signature: sig });
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

// Unified compose AI — one endpoint, many modes. Used by the compose modal.
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
      prompt = 'Make this email more concise without losing key information' + british + '. Reply with only the shortened body.\n\n' + text;
      max = 600;
    } else if (mode === 'expand') {
      prompt = 'Add a little more detail and courtesy to this email while keeping it professional and concise' + british + '. Reply with only the expanded body.\n\n' + text;
    } else { // polish
      prompt = 'Polish this email so it reads clearly and professionally' + british + ': improve flow and word choice and fix any grammar, but keep the meaning, tone and intent, and add no new content or commentary. Reply with only the polished body.\n\n' + text;
    }
    res.json({ result: await callClaude(prompt, max) });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message, code: e.code }); }
});

module.exports = router;
// Exposed for unit tests (harmless extra props on the router function).
module.exports.extractBodies = extractBodies;
module.exports.inlineCidImages = inlineCidImages;
