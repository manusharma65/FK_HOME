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

module.exports = router;
