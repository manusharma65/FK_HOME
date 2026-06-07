# R0.56 — Table polish so themed pages aren't flat (Insights, Payroll)

## Why
The r0.55 sweep correctly themed the card shells, fonts and canvas — but pages built on
`.data-table` (HR Insights, HR Payroll) kept plain thin rows with inline-styled headers
fighting the theme, so they read clean-but-flat. This styles the shared table globally:
- Header cells: themed (uppercase, tracked, muted) — overrides the inline styles.
- Rows: proper padding, hairline dividers, warm orange hover.
- Count badges (card-meta) a touch bolder.
Lifts every `.data-table` page at once (Insights + Payroll).

## Note on "full People richness"
The global passes give a cohesive, polished base everywhere. A page matching People's full
richness (hero, avatar rows, chips throughout) is a per-page redesign — available on request
for specific pages; this table fix gets the table pages looking finished, not flat.

## Carried (cumulative)
Home + Profile redesign, app-wide theme, salary self-view, attendance calendar, 4-tier
roles (+ migration 32), People hub. Old Employment nav still kept.

## Validation
- index.html parses clean.
