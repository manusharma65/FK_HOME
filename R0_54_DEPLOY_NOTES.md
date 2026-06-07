# R0.54 — Home page redesigned to the People theme (+ carries r0.53)

## Home page (new)
Built to the approved mock, scoped to the home view (`.home-zone` / `.home-hero`) so no
other page changes until its turn:
- **Fraunces + Hanken Grotesk** loaded; warm canvas; **hero greeting** banner
  (dark->orange gradient) wrapping the existing greeting.
- All home cards: rounded, soft shadow, **Fraunces card titles**, larger text.
- **Who's-in-today** KPIs are now big energised tiles.
- **Team chat moved beside Who's-in-today** (was stacked underneath via CSS-columns;
  Managing zone is now a 2-col grid). Chat stays its dark panel, as you asked.
- Shared theme tokens (`--canvas/--orange/--disp/--body`) added to :root so the rest of
  the rollout (Attendance, Profile/Pay/Time, Leaves, My Growth, HR pages) reuses one source.

## Also included (was r0.53, in case not yet deployed)
- Salary form = Monthly CTC + Effective from only; employees can VIEW their own salary
  (read-only), editing stays Owner/HR.
- Attendance calendar fully redesigned (big Fraunces dates, real orange Today, proper cells).
- 4-tier role titles (Executive/Senior Executive/Team Lead/Manager) + migration 32.
- People hub redesign + add-user wizard + merged record. Old Employment nav still kept.

## Validation
- index.html: style tags balanced, parses clean, scoped so non-home pages untouched.
- node --check clean: profile.js, server/profile.js, users.js, admin.js, team.js.

## After deploy
- Home: hero greeting on top; cards warm + larger; chat sits to the right of Who's-in-today.
- Other pages unchanged (they get the theme in their own upcoming ships).
