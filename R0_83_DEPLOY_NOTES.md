# r0.83 — Mail: move, rename, drop the ugly banner

Branch: **r10-test**. Cosmetic + placement fixes on top of r0.82.
- Moved "Mail" out of the My Day group to its own top-level item, now "My Mail",
  sitting directly under "My FK Space" and above "My work".
- Suppressed FK Home's default dark module hero banner for Mail (noHero), so the
  inbox fills the page like the mock instead of sitting under a heavy band.
- Forced the inbox headers to FK Home's clean sans (the module h2 was inheriting
  the Fraunces serif) — no serif.

## Files
- public/modules/mail.js — noHero + sans headers
- public/index.html — moved & renamed the nav item
- server.js — VERSION r0.82 -> r0.83

No package / DB / variable changes.

## Deploy (branch-guarded)
```bash
cd ~/Downloads && unzip -o fkhome-r0.83-mail-placement.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.83-mail-placement/public/. public/ && \
  cp -R ~/Downloads/fkhome-r0.83-mail-placement/server/. server/ && \
  cp ~/Downloads/fkhome-r0.83-mail-placement/server.js . && \
  cp ~/Downloads/fkhome-r0.83-mail-placement/R0_83_DEPLOY_NOTES.md . && \
  git add public/ server/ server.js R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.83 — Mail: top-level My Mail, drop hero banner, sans headers" && \
  git push origin r10-test; fi
```
After deploy: hard-refresh (Cmd+Shift+R). "My Mail" sits under My FK Space.
