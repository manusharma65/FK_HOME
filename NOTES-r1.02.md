# r1.02 — Mobile batch 1: table modules (one ship)

Branch: r10-test. VERSION r1.02. Front-end only (CSS + markup). Desktop untouched —
every new rule lives inside @media (max-width:768px); the added classes/data-labels
are inert above that width.

## What changed
- public/index.html — one shared `.fk-stack` mobile rule: any table tagged it
  collapses to stacked cards on a phone (one card per row, label:value lines).
  Handles header cells (.cell-head), full-width wrapping values (.cell-block),
  full-width action buttons (.action-col), and expandable/loading sub-rows.
  Plus `.mtable-scroll` for wide matrices that should swipe instead of stack.

## Modules made mobile (stacked cards)
- leaves.js (incl. the expandable balance row), holidays.js, regularisations.js,
  audit.js, groups.js, approvals.js (all three tables).
- Each table tagged `fk-stack`; each cell carries a `data-label` (or .cell-head /
  .cell-block) so the phone view reads as labelled cards matching the approved mock.

## Swipe (not stacked)
- csrota.js — the agent×day rota matrix is wrapped in `.mtable-scroll` so it scrolls
  sideways on a phone (stacking a matrix doesn't make sense).

## Verified
All 7 modules syntax-clean (jsc/node --check). Desktop layout unchanged by
construction (mobile-only media query). Phone layout is visual — eyeball on device;
the leaves balance panel when expanded is the main thing to glance at.

## Next batches
- Batch 2 — heavy data: hr-payroll, hr-insights, my-growth, users, team-work/review,
  recruitment, leaves-time (swipe-vs-stack decided per table).
- Batch 3 — Mail: 3-column → single pane with back nav.
