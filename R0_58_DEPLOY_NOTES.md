# R0.58 — Action buttons fixed (pills, not full-width bars) + shared button standard

## The button fix (HR Queue)
The two full-width button bars per card were too heavy. Now:
- Buttons are **right-aligned padded pills** (still full-size/tappable, not tiny/inline).
- Open = orange primary pill; Cover = clean outline pill (dropped the cream bar).
This is the action-button look we'll carry to every page.

## Shared standard (so it IS global)
Added `.fk-btn` / `.fk-btn-primary` / `.fk-btn-outline` to the shell so every page reuses
the exact same pill. As each self-styled page is redesigned it uses these.

## Validation
- node --check clean: hr-queue.js. index.html parses clean.

## Carried (cumulative)
Home + Profile + HR Queue + app-wide theme + table polish + salary self-view + attendance
calendar + 4-tier roles (+ migration 32) + People hub. Old Employment nav still kept.
