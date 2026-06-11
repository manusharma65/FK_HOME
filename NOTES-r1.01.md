# r1.01 — manual confirm-to-count UI + monitoring + cid images (one ship)

Branch: r10-test. VERSION r1.01. Verified against a real Postgres 16 in the
sandbox: full suite 25/25 + custom tests for each piece. Deploys on top of r1.00.

## 1. #4 manual items — now usable end to end
- public/modules/hr-today.js — per person, their PENDING manual items render with
  full-size Confirm (orange) / Reject buttons + a "x of 5 confirmed today" counter.
  Confirm/reject hit POST /api/daily/manual-item/confirm and update live.
- public/modules/today.js — staff see each manual item tagged "pending" or
  "counting"; the cap line reads "x of 5 counting · y pending".
- server/modules/daily.js — GET /api/daily/team now returns each person's
  manualPending[] + manualConfirmed count (the backend confirm endpoint + scoring
  shipped in r1.00). Verified: only confirmed items count, cap 5/day holds.

## 2. Monitoring (new)
- server/schema/37-system-errors.sql — error log table (append-only migration).
- server/modules/monitoring.js — best-effort error sink (logError never throws),
  Express error middleware, process-level unhandledRejection/uncaughtException
  capture, a daily 07:00 heartbeat, and a health() reader.
- server.js — installs process handlers at boot; public GET /healthz (uptime, last
  heartbeat, 24h error count, version); error middleware last in the chain;
  heartbeat cron added. Verified: table applies, errors log, heartbeat + /healthz read.

## 3. cid inline images (mail)
- server/modules/mail.js — extractBodies now also collects inline (Content-ID)
  image parts; new inlineCidImages() rewrites cid: refs in the HTML to self-
  contained data: URIs (message + thread routes). Best-effort per image: a failed
  fetch leaves the ref untouched — never fails the read. Real file attachments are
  still listed separately. Client needs no change. Verified with a synthetic payload.

## Colour note
Confirm button is orange (#E8722B, your locked primary). One-line flip to green if
you prefer the approve=green convention — say the word.
