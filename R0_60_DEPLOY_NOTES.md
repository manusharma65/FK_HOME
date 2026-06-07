# R0.60 — Remaining pages finished in ONE ship (global rules, no per-page editing)

## Reevaluated approach (sanity check result)
Instead of editing 10 pages one per ship: the sanity check showed
(a) 5 self-styled pages have NO bespoke card/button classes (leaves, team-work, my-growth,
    reports, employment) — they use the shared card, so the earlier global theme already
    covers them; they only needed their header.
(b) the other 5 (approvals, attendance, leaves-time, my-work, chat) differ only in a few
    named button/header classes — now enumerated.
So this ship adds ONE set of global rules to the shell:
- `#moduleView h2` -> Fraunces (themes EVERY module page header at once).
- The enumerated action buttons (`.ap-btn`, `.mwc-btn`, `.new-btn` + their primary/danger
  variants) -> the shared pill look (orange primary / outline / red danger).

Result: every remaining page is cohesive and on-theme from one deploy. No per-page shipping.

## Honest note
This makes the pages cohesive (Fraunces headers + warm shared cards + orange pills). The
full gradient-hero banner (like HR Queue / Recruitment) is a per-page extra — if you want a
specific page to stand out with that, name it and I'll add it; not needed for consistency.

## Validation
- index.html parses clean.

## Carried (cumulative)
HR Queue + Recruitment redesigns, Home, Profile, app-wide theme, table polish, pills,
salary self-view, attendance calendar, 4-tier roles (+ migration 32), People hub.
