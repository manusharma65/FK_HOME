# r0.85 — Mail: Reply/Forward fix + AI summary & AI draft

Branch: **r10-test**. Cumulative.

## Reply / Forward fix (the "nothing happens" bug)
- Big LABELLED "Reply" and "Forward" buttons now sit at the END of the email body.
- Clicking Reply/Forward opens the composer AND smooth-scrolls it into view and
  focuses the text box — so it's always obvious something happened.
- Archive/Delete kept as icon buttons up top.

## AI (new — needs one Railway variable, see below)
- AI summary: a violet callout above longer emails, auto-summarising what the
  sender wants. Stays hidden/quiet if AI isn't set up.
- AI draft: in the reply composer, an "AI draft" button + a "tell the AI what to
  say" box. Writes a reply into the editable text box (you edit before sending).

## REQUIRED one-time setup for AI
Add a Railway variable to the FK Home service (same place as GMAIL_SA_JSON):
- Name:  `ANTHROPIC_API_KEY`
- Value: your Anthropic API key (starts with `sk-ant-...`)
(Optional) `ANTHROPIC_MODEL` to override the model (default `claude-sonnet-4-6`).
Without the key, mail still works fully — AI summary/draft just stay quiet.

## Files
- public/modules/mail.js — labelled reply/forward + scroll-into-view, AI summary + AI draft
- server/modules/mail.js — POST /api/mail/ai/summary, /api/mail/ai/draft (+ archive/trash from r0.84)
- public/index.html — "My Mail" top-level nav (from r0.83)
- server.js — VERSION -> r0.85

## Deploy (branch-guarded)
```bash
cd ~/Downloads && unzip -o fkhome-r0.85-mail-ai.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.85-mail-ai/public/. public/ && \
  cp -R ~/Downloads/fkhome-r0.85-mail-ai/server/. server/ && \
  cp ~/Downloads/fkhome-r0.85-mail-ai/server.js . && \
  cp ~/Downloads/fkhome-r0.85-mail-ai/R0_85_DEPLOY_NOTES.md . && \
  git add public/ server/ server.js R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.85 — Mail: reply/forward fix, AI summary + AI draft" && \
  git push origin r10-test; fi
```
After deploy: hard-refresh (Cmd+Shift+R).
