# R0.66 — Nav text bigger + bolder (fixed the rule that actually wins)

Root cause of why earlier nav edits did nothing: there were TWO `.nav-item` rules; the
later one (the real styling block) overrode the earlier one I'd been editing. This edits
the WINNING rule:
- nav items: 16px → 17.5px, weight 500 → 600
- active item + group labels weight/size matched so nothing looks lighter or tiny
Sidebar stays on the system font (r0.65). No page-content change.

## Check after deploy (hard refresh)
- Sidebar items (My FK Space, My work, HR Queue, etc.) are noticeably larger + bolder.
