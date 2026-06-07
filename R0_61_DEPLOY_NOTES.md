# R0.61 — One shared hero on EVERY page (single source, no per-page work)

## What changed (the "make it all look the same" fix)
The router (loader.js) already knows each page's title. It now:
- Renders the SAME gradient hero banner at the top of every module page, from `mod.title`.
- Automatically strips that page's own duplicate title heading (matches by text), so the
  hero is the single header — works regardless of each page's internal structure.
Result: approvals, attendance, leaves, leaves-time, my-work, team-work, my-growth, reports,
employment, hr-insights, hr-payroll, settings, holidays, etc. all get the identical hero,
matching People / Home / HR Queue. No per-page editing, one source of truth.

- `.fk-page-hero` style added once to the shell.
- Opt-outs (own hero / special layout): People, HR Queue, Recruitment, Chat.

## Honest notes
- The shared hero shows the title (no per-page subtitle). HR Queue & Recruitment keep their
  own hero with the live count (they opt out) — same look, they just also carry a sub-line.
- If a page had a button sitting next to its old title, the button stays; if any page looks
  off (button floating, etc.) tell me that page and I'll tidy it.

## Validation
- node --check clean: loader, users, hr-queue, recruitment, chat. index.html parses clean.

## Carried (cumulative)
All prior theme work + HR Queue/Recruitment redesigns + salary/roles/attendance/People.
