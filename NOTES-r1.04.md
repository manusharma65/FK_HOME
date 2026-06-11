# r1.04 — Mobile batch 2: heavy-data screens (one ship)

Branch: r10-test. VERSION r1.04. Front-end only. Desktop untouched (all rules are
inside @media (max-width:768px); added classes/data-labels are inert above it).

## In this ship
- public/index.html — fixed-column summary grids collapse on a phone:
  my-growth & leaves-time stat grids 3-col -> 2-col; users .r2 2-col -> 1-col;
  recruitment .rec-grid 2-col -> 1-col. (One place, no module edits for these.)
- hr-insights.js — all four dashboard tables (probation, overdue tasks,
  onboarding, exits) now STACK to labelled cards on mobile instead of scrolling
  sideways — name as the card title, each field labelled, action button full width.
- csrota.js — CS rota stacks to one card per agent (folded in from the fix you
  told me not to ship on its own).

## Already mobile-fine (verified, no change needed)
- hr-payroll: summary tiles are auto-fit (collapse already); the money tables keep
  their horizontal scroll — correct for wide financial columns.
- team-work, team-review, reports: flex-row / card / tab layouts that already stack.

## Verified
hr-insights.js + csrota.js syntax-clean (node --check). Desktop unchanged by
construction. Phone layout is visual — worth a glance on device.

## Next (last mobile piece)
- Batch 3 — Mail: the 3-column layout collapses to a single pane (list -> message
  with a back arrow). Its own ship since it touches the mail renderer.
