# r0.84 — Mail: card look + Gmail daily functions

Branch: **r10-test**. Cumulative (includes r0.83's move/rename). Makes the inbox
match the mock and adds the everyday Gmail functions.

What's new:
- Conversation list is now CARDS (white, rounded, soft shadow, selected ring,
  unread = orange dot + bold) — matching the mock, not plain rows.
- Select-all + per-row checkboxes.
- Bulk **Archive** (removes from Inbox) and bulk **Delete** (to Gmail Trash,
  recoverable 30 days) from the list toolbar.
- Open a message: **Reply**, **Forward** (enter any address; original quoted),
  **Archive**, **Delete** buttons.
- "My Mail" top-level nav item, no hero banner, clean sans (from r0.83).

Still to come (next layers): AI summary line + AI draft, pinned notes, custom
labels, snooze, and the shared Customer-Service mode (lanes/ownership/collision/
order panel). The icon-rail global shell remains a separate later change, so this
lives inside FK Home's current sidebar.

## Files
- public/modules/mail.js — card list, bulk select/archive/delete, reply + forward
- server/modules/mail.js — adds POST /api/mail/archive and /api/mail/trash
- public/index.html — "My Mail" top-level nav (from r0.83)
- server.js — VERSION -> r0.84

No package / DB / variable changes.

## Deploy (branch-guarded)
```bash
cd ~/Downloads && unzip -o fkhome-r0.84-mail-cards-bulk.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.84-mail-cards-bulk/public/. public/ && \
  cp -R ~/Downloads/fkhome-r0.84-mail-cards-bulk/server/. server/ && \
  cp ~/Downloads/fkhome-r0.84-mail-cards-bulk/server.js . && \
  cp ~/Downloads/fkhome-r0.84-mail-cards-bulk/R0_84_DEPLOY_NOTES.md . && \
  git add public/ server/ server.js R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.84 — Mail: card list, bulk archive/delete, reply+forward" && \
  git push origin r10-test; fi
```
After deploy: hard-refresh (Cmd+Shift+R), open My Mail.
