# R0.55 — Theme promoted app-wide + Profile finished (big sweep, one ship)

You asked for as many pages as possible in one go. Done by promoting the look to the
shell's shared classes rather than editing each page.

## Global (converts every page built on the shared blocks)
- Shell `body`: Hanken Grotesk + warm canvas background.
- Shell `.card` / `.card-title` / `.card-header`: rounded, soft shadow, **Fraunces titles**,
  larger text, orange icons.
- Verified these pages use the shared card (so they themed automatically): attendance,
  my-growth, my-work, team-work, hr-insights, approvals, reports, holidays, settings.
- 3 pages don't use the shared card structure (leaves-time, hr-queue, recruitment) — they
  still pick up the new font + canvas, but their bespoke layouts get individual polish in a
  later ship (flagged, not forgotten).

## Profile (finished)
- Header is now a warm gradient hero; name, stat numbers, and section titles in Fraunces.
- Pay tab + Time calendar were already converted earlier — left untouched (no duplication).

## Already done before (untouched)
- People hub (users.js) and Home (index.html hero/cards) — not re-done.

## Carried (in case not yet deployed)
- Salary self-view + CTC/effective-only form; attendance calendar redesign; 4-tier roles
  (+ migration 32); People hub + wizard + merged record. Old Employment nav still kept.

## Validation
- index.html parses clean; node --check clean on profile.js + carried server modules.
