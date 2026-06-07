# R0.62 — Remove Employment nav + black primary buttons → orange pill (everywhere)

## Employment removed
People now carries the employment record (reports-to, joining, type, pattern, probation,
notice, leave recompute/adjust), so the standalone Employment nav is gone:
- removed the nav item, the `employment.js` script include, and its show() call in index.html.
- (employment.js file left in place but no longer loaded — nothing references it.)

## Black primary buttons fixed globally
The "+ Add task" (My Work) and other primary buttons were still ink/black because they use
classes my earlier rule didn't cover. Added a global rule so `.mw-add`, the My Work form
save, and `.btn-primary`/`.btn.primary` all render as the orange pill — matches "+ New
opening" on Recruitment. One rule, fixed on every page that uses them.

## Validation
- index.html parses clean. No remaining references to Employment nav/route/script.

## Carried (cumulative)
Shared hero on every page, all prior theme work, redesigns, salary/roles/attendance/People.
