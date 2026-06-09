# r0.87 — Mail: full personal experience to match the mock (one consolidated ship)

Branch: **r10-test**. Cumulative — includes everything from r0.83–r0.86
(top-level "My Mail", no hero, cards, bulk archive/delete, reply/forward fix,
AI summary + draft, Haiku default, on-demand cached summary). Deploy ONLY this.

## What's new vs the mock
- **3-column layout inside FK Home**: collapsible Mail column | list | reading pane.
- **Collapsible Mail column** (the bit that wouldn't collapse before): collapse/expand toggle.
- **Mailbox sections**: Inbox / Sent / Archive (real, via Gmail).
- **Personal labels** (stored in FK Home, not Gmail): create with a colour, delete,
  apply/remove per email, colour dots on rows, chips in the reading pane, click a
  label to filter the list.
- **Search** box (filters the list).
- **Pinned private note** per email: add / edit / delete, shows as a chip on the row
  and a block in the reading pane.
- **AI Polish** ("Polish with AI") in the composer for spelling/grammar, plus the
  browser's own live spell-check underline. On demand, one call.

## Database
A new migration `server/schema/35-mail.sql` creates `mail_labels`,
`mail_message_labels`, `mail_notes`. It runs automatically on boot (idempotent) —
nothing to do by hand.

## AI key (unchanged)
Railway variable on FK Home: `ANTHROPIC_API_KEY` = your `sk-ant-...`. Without it,
mail works fully; AI summary/draft/polish just say they need setup. Model defaults
to Haiku; override with `ANTHROPIC_MODEL` if ever needed.

## Deliberately NOT in this ship (by agreement)
- Global icon-rail shell (separate next ship — it changes every screen).
- Snooze (needs a background un-snooze job — next).
- Attachments send/receive — later.
- "Focus today" inbox-wide strip — optional, can add on-demand next.
- Customer Service shared mailbox — the CS phase.

## Files
- public/modules/mail.js     — full 3-column UI
- server/modules/mail.js     — boxes, labels, notes, AI polish endpoints
- server/schema/35-mail.sql  — new tables
- public/index.html, server.js — nav + VERSION r0.87

## Deploy (branch-guarded)
```bash
cd ~/Downloads && unzip -o fkhome-r0.87-mail-full.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.87-mail-full/public/. public/ && \
  cp -R ~/Downloads/fkhome-r0.87-mail-full/server/. server/ && \
  cp ~/Downloads/fkhome-r0.87-mail-full/server.js . && \
  cp ~/Downloads/fkhome-r0.87-mail-full/R0_87_DEPLOY_NOTES.md . && \
  git add public/ server/ server.js R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.87 — Mail: collapsible column, mailbox sections, labels, notes, search, AI polish" && \
  git push origin r10-test; fi
```
After deploy: hard-refresh (Cmd+Shift+R), open My Mail.
