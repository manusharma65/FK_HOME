# FK Home r0.89 — Mail: full personal experience (matches the mock)

This finishes the personal Mail mock in one ship.

## What changed
- **Full-page, no left gaps** — in Mail the FK sidebar is hidden and Mail fills
  the whole area, flush, edge to edge.
- **Dark icon rail** (the mock's left column): Home / People / Leave & time /
  Tasks / Mail / Settings + your avatar. Clicking any icon jumps to that part of
  FK Home (and brings the normal menu back).
- **Focus today** strip at the top of the Inbox — tap "What needs me today?" and
  the AI tells you what to deal with now vs what can wait (on-demand, costs ~0.1p).
- **Attachments**
  - *Receiving*: emails with files now show download chips (e.g. the Kemball
    "Stock Report") — click to download.
  - *Sending*: paperclip in the reply box to attach files (up to 20MB each).
- **Formatting**: Bold / Italic buttons in the reply box.
- **Save draft**: saves straight to your Gmail Drafts.

## Files
- public/index.html         (full-bleed layout while in Mail)
- public/modules/mail.js     (rail, focus strip, attachments, rich reply, save draft)
- server/modules/mail.js     (attachment download + send-with-attachments + html + drafts + AI focus)
- server.js                  (VERSION r0.89; request limit 5mb → 30mb for attachments)
- server/schema/35-mail.sql  (labels/notes tables — unchanged, included for completeness)

## After deploy
- Hard refresh: **Cmd + Shift + R**.
- AI features (Focus today, summary, draft, polish) still need the Railway
  variable **ANTHROPIC_API_KEY** set — everything else works without it.
