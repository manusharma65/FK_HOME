# R0.63 — Inner text scale fixed app-wide (task page etc. no longer cramped)

## Problem (sanity check)
~280 hard-coded small fonts (13px ×126, 12px ×110, 11px ×40, 10px ×3) baked into the
modules' own style blocks — titles, subs, labels, list rows — read as cramped next to the
new theme. Worst: profile (53), recruitment (33), hr-payroll (32), hr-insights (24),
my-work/task page (22), chat (21).

## Fix (one systematic pass, all modules)
A collision-free proportional bump applied across every module:
  13px -> 14.5px, 12px -> 13.5px, 11px -> 12.5px, 10px -> 11.5px.
Because the theme sizes I set earlier use decimals (11.5/13.5/14.5/18px), the bump only
touched the OLD integer sizes — themed elements (hero, cards, chips, pills) are unchanged.

Result: task page, recruitment board/modal, payroll, insights, chat, profile inner content
all step up to a readable, on-theme scale in one go.

## Validation
- All modules pass node --check after the change. No integer small sizes remain.

## Note
If a specific tight spot now overflows (a narrow label/badge), tell me which page and I'll
nudge that one element back; the bump is mild (+1.5–2px) so this should be rare.

## Carried (cumulative)
Shared hero on every page, Employment removed, orange pill buttons, all prior theme work.
