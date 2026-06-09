# r0.88 — Mail fixes: slim main nav, show email images, note by reply

Branch: **r10-test**. Incremental on r0.87.

## Fixes
1. **Main nav slims to icons while in Mail** — the FK sidebar shrinks to a 64px
   icon rail so the two nav columns stop fighting for space. It restores to full
   width automatically when you leave Mail. The menu button (top-left of the list)
   toggles the full nav back if you need HR/Payroll etc. without leaving Mail.
2. **Email images now show** — HTML emails render with their images and layout
   (HTML-first, like Gmail), inside a sandboxed frame so the email's styles/scripts
   can't leak into FK Home. External images load; truly embedded (cid:) images come
   with the attachments work later.
3. **Note moved next to Reply/Forward** — the pinned private note now sits just
   above the Reply/Forward buttons, with a "Note" button right beside them, so it
   isn't missed at the top.

## Files
- public/index.html        — slim main-nav CSS (.app.mail-focus)
- public/modules/mail.js   — iframe email render, note relocation, nav toggle/slim
- server.js                — VERSION r0.88
(backend mail.js + 35-mail.sql unchanged, included for a complete copy)

## Deploy (branch-guarded)
```bash
cd ~/Downloads && unzip -o fkhome-r0.88-mail-fixes.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.88-mail-fixes/public/. public/ && \
  cp -R ~/Downloads/fkhome-r0.88-mail-fixes/server/. server/ && \
  cp ~/Downloads/fkhome-r0.88-mail-fixes/server.js . && \
  cp ~/Downloads/fkhome-r0.88-mail-fixes/R0_88_DEPLOY_NOTES.md . && \
  git add public/ server/ server.js R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.88 — Mail: slim main nav in Mail, render email images, note by reply" && \
  git push origin r10-test; fi
```
After deploy: hard-refresh (Cmd+Shift+R).
