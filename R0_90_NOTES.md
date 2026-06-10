# FK Home r0.90 — Team review merge + Mail full-page

## 1. Mail is now true full-page
The FK topbar is hidden while you're in Mail, so the dark rail runs top-to-bottom
and the email client fills the whole screen (this was the "not full page" bit —
the topbar was always sitting above it). Leaving Mail brings the topbar back.
(Note: the global search / notifications / Active pill are hidden while you're
inside Mail, matching the mock; they return on every other page.)

## 2. Team review (owner-only) — one place for results
New owner-only page that replaces your separate "HR today" and "Reports" items:
- **Reports** is the landing tab — the daily reports your team submits (the results).
- **HR today** is a second tab, only loaded if you open it (its data call doesn't
  even fire otherwise). If you never want it, say so and I'll remove the tab in one line.
- Managers and HR are untouched — they keep their own Reports page and never see HR today.

Verified in a headless browser before shipping: Reports renders on open with only
its own data call; HR today lazy-mounts (and only then fetches) when its tab is clicked.

## Files
- public/index.html              (Mail topbar hidden; Team review nav + owner gating)
- public/modules/team-review.js  (new — tabbed wrapper reusing Reports + HR today)
- server.js                      (VERSION r0.90)

Reports and HR today modules are unchanged and already live; the new page reuses them.
