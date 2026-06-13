# FK Home r1.22 — home flicker + dead drill-through tiles (frontend only)

Supersedes r1.21 (includes its home-composition fix) so it works whether or not r1.21 was deployed.

Fixes:
1. "Who's in today" FLICKER (appears then vanishes on refresh) — caused by the r1.20 cockpit
   hiding every home child on a timer, while the async hr/today fetch re-showed the Managing
   section; the two raced. r1.21 removed the hide entirely (greeting kept, nothing hidden), which
   ends the flicker. Carried here.
2. "Off" and "Worked anyway" tiles were NOT clickable (no onclick at all) — clicking did nothing.
   Now both drill through to the people list. The "Off" tile is a merged bucket
   (pattern + CS rota + holiday); the people-list filter now matches all three for it.

Files: server.js (VERSION r1.22), public/index.html. No backend/schema change.

NOT in this ship (needs your input — see chat): the "worked anyway / everyone off" mislabel on a
working Saturday is a pattern-anchor phase problem, fixed separately once you confirm the live anchor.
