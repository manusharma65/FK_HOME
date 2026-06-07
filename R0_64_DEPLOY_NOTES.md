# R0.64 — Bespoke pages nudged toward the Insights look (headings + card boxes)

## What this does
Safe global additions so bespoke pages read more like Insights:
- All module h3/h4 + bespoke item titles (task title, onboarding titles, candidate name)
  -> Fraunces.
- Bespoke card boxes (.review-card, .lv-card, .rec-cand, .setup, .fnf-card) -> warm rounded
  card chrome (radius + border + shadow) matching the shared .card.

## Honest status — what still won't fully match Insights
These pages were built with their OWN older design (amber accents, slate gradient banners,
tighter panels) and need genuine per-page conversion, not a global toggle:
- my-work TASK DETAIL modal (colored header) + the "YOUR REQUESTS/COMPLETED" dividers
- recruitment candidate BOARD (kanban) + candidate detail modal (blue)
- offboarding / exit setup panels (.fk-exit — gradient welcome/exit banners)
- chat messaging layout
The shared-card pages (Insights, approvals, payroll, settings, holidays, regularisations,
audit, backups, groups, csrota, attpolicy) already match Insights.

## Validation
- index.html parses clean.
