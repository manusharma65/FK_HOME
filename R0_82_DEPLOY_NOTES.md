# r0.82 — Mail inbox (Ship 1: personal inbox, read + reply)

Branch: **r10-test**. First working slice of the in-house mailbox, wired to the
proven Gmail engine. A "Mail" item now appears in the FK Home sidebar. Opening it
lists your own recent mail, opens a message to read, and lets you reply — sent
from your address through the same engine. Native FK Home theme (orange accent,
app fonts, no serif).

This ship is deliberately the foundation. NOT yet included (next ships): AI
brief/summary, AI draft, grammar-check, pinned notes, custom labels, snooze, and
the shared Customer-Service mode (lanes, ownership, collision, order panel). The
icon-rail global shell is also a later, separate change.

## Files
- public/modules/mail.js (new) — the inbox UI (list + read + reply)
- public/index.html — adds the mail module script + a "Mail" sidebar item
- server/modules/mail.js — adds GET /api/mail/message/:id and POST /api/mail/send
- server.js — VERSION r0.81 -> r0.82

No package changes (googleapis already installed). No DB or variable changes.

## Deploy (branch-guarded — HALTS if not on r10-test)
```bash
cd ~/Downloads && unzip -o fkhome-r0.82-mail-inbox.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.82-mail-inbox/server/. server/ && \
  cp -R ~/Downloads/fkhome-r0.82-mail-inbox/public/. public/ && \
  cp ~/Downloads/fkhome-r0.82-mail-inbox/server.js . && \
  cp ~/Downloads/fkhome-r0.82-mail-inbox/R0_82_DEPLOY_NOTES.md . && \
  git add server/ public/ server.js R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.82 — Mail inbox ship 1: personal read + reply" && \
  git push origin r10-test; fi
```

## Verify after deploy
Log into FK Home → click **Mail** in the sidebar.
- Your recent emails list on the left; click one to read it on the right.
- Type a reply and hit Send — it goes from your address; check your Sent folder.
