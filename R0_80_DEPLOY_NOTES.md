# r0.80 — Mail engine (read-only proof)

Branch: **r10-test**. First step of the in-house Gmail integration. Adds a mail
module that logs in as the `fk-home-mail` service account, impersonates a staff
mailbox via domain-wide delegation, and READS recent inbox messages. No sending,
no EmailEngine, no licence — just Google's free Gmail API.

## Files
- server/modules/mail.js (new) — Gmail client + /api/mail/inbox (JSON) and /api/mail/test (proof page)
- server.js — require + mount /api/mail
- package.json — adds googleapis dependency (Railway installs on deploy)

## BEFORE deploy — add the service-account key as a Railway secret
1. Railway → your FK Home service → **Variables** → **New Variable**.
2. Name: `GMAIL_SA_JSON`
3. Value: open the downloaded service-account .json file, copy the ENTIRE contents, paste as the value.
4. Save. (Secret only — never in code, never committed.)

## Deploy (branch-guarded — HALTS if not on r10-test)
```bash
cd ~/Downloads && unzip -o fkhome-r0.80-mail-readonly.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.80-mail-readonly/server/. server/ && \
  cp ~/Downloads/fkhome-r0.80-mail-readonly/server.js . && \
  cp ~/Downloads/fkhome-r0.80-mail-readonly/package.json . && \
  cp ~/Downloads/fkhome-r0.80-mail-readonly/R0_80_DEPLOY_NOTES.md . && \
  git add server/ server.js package.json R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.80 — mail engine read-only proof (Gmail via service account)" && \
  git push origin r10-test; fi
```

## Verify after deploy
Log into FK Home, then visit:  `https://<your-fk-home-url>/api/mail/test`
- Green banner + your recent emails = the whole chain works.
- Red banner = read the message; usually GMAIL_SA_JSON missing, or delegation
  still propagating (wait up to 60 min after authorising), or scope mismatch.
