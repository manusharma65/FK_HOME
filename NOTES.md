# FK Home r1.29 — dates on the attendance calendar

Branch: r10-test. Files: server.js (version bump only) + public/modules/leaves-time.js.

The "My attendance · last 30 days" grid was coloured squares with no dates — unreadable.
Rebuilt as a proper calendar:
- Mon-Sun weekday header row.
- The grid is weekday-aligned (leading blank cells before the first day).
- Every square shows its date number (Fraunces), with the month label on the 1st
  and on the first cell. Today is outlined in terracotta.
- Colour still = that day's status; same counts and key.
- Pulls the real days from /api/attendance/me/week (no API change).

server.js: VERSION r1.28 -> r1.29 ONLY (taken from verified-live; Academy mount +
boot reconcile intact). Needed so the browser fetches the new leaves-time.js
(?v=r1.29) instead of the cached copy — same cache issue as before.

No index.html change (the console-error guard is already live). No DB/test change.
