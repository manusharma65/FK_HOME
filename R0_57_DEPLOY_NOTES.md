# R0.57 — HR Queue redesigned (page-by-page begins) + honest theme map

## HR Queue (self-styled page — now done properly)
It injects its own CSS, so the global theme never reached it (only the font did). Rebuilt:
- Hero header (dark->orange) with the open/yours count.
- Intro as a warm banner; section label tightened.
- Task cards: rounded, soft shadow, hover lift, Fraunces titles, People-style owner chips.
- Full-size buttons kept (per the rule): Open = orange primary; Cover = soft amber outline.

## Honest status of the theme rollout
- DONE (self-styled): People, Profile, HR Queue.
- LIFTED by the global pass (use the shared card): hr-insights, hr-payroll, settings,
  holidays, backups, audit, groups, regularisations, attpolicy, csrota, loader.
- STILL TO DO (self-styled, each needs its own redesign): approvals, attendance,
  leaves-time, leaves, my-growth, my-work, recruitment, reports, team-work, chat, employment.

## Validation
- node --check clean: hr-queue.js.

## Carried (cumulative)
Home + Profile + theme + table polish + salary self-view + attendance calendar + 4-tier
roles (+ migration 32) + People hub. Old Employment nav still kept.
