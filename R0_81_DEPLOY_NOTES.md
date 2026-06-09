# r0.81 — Mail send proof (+ version label fix)

Branch: **r10-test**. Adds sending to the mail engine and proves it safely.
Also bumps the stale boot label (logs said r0.77; now r0.81).

## Files
- server/modules/mail.js — adds sendPlain() + GET /api/mail/sendtest (self-send proof)
- server.js — VERSION label r0.77 → r0.81

No package changes (googleapis already installed). No DB/variable changes.

## Deploy (branch-guarded — HALTS if not on r10-test)
```bash
cd ~/Downloads && unzip -o fkhome-r0.81-mail-send.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.81-mail-send/server/. server/ && \
  cp ~/Downloads/fkhome-r0.81-mail-send/server.js . && \
  cp ~/Downloads/fkhome-r0.81-mail-send/R0_81_DEPLOY_NOTES.md . && \
  git add server/ server.js R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.81 — mail send proof + version label fix" && \
  git push origin r10-test; fi
```

## Verify (log in first)
Visit /api/mail/sendtest → click "Send the test email" → green = sent.
Then check your own inbox + Sent folder for "FK Home — send test".
It emails only you, from you. Read AND send now both proven.
