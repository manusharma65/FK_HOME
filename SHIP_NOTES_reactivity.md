# FK Home — ship 2: holidays-as-tab (redo), selfie-without-refresh, live-refresh, evening auto-logout

Supersedes the holidays placement from the previous ship. No schema changes. Does NOT ship
server.js (Academy /api/learning mount stays). Version string unchanged (r1.26b).

HOLIDAYS — 3rd action button (public/modules/leaves-time.js):
  "Company holidays" is now a third button beside Request leave / Request a correction; it
  opens a holidays modal. Removed the inline section under the calendar.

SELFIE WITHOUT REFRESH (public/index.html, startHeartbeat):
  fkClockInMaybe() ran at init BEFORE the first heartbeat stamped the clock-in, so it saw
  "not clocked in yet" and the selfie only appeared after a manual refresh. It now fires
  right after the first heartbeat lands, so the photo prompt shows on first login.

LIVE REFRESH — changes show without refresh (public/index.html, startHeartbeat):
  The app only re-fetched after YOUR own actions, so others' status changes and the evening
  auto-clock-out never appeared without a manual refresh. Added a 45s poll of the dashboard +
  board (and a refresh on tab refocus), skipped while a modal is open or the user is typing
  so it never disrupts an in-progress action.

EVENING AUTO-LOGOUT (server/modules/attendance.js, tickAutoClockout):
  autoClockOut already sets people offline + stamps clock-out, but its "shift end + idle"
  trigger can't fire now that the heartbeat keeps "active" alive on a background tab. Added a
  hard end-of-day close: past 22:30 London, anyone still open is clocked out + set offline
  (server-side, runs every 5 min). Combined with the live-refresh above, the board clears in
  the evening without anyone refreshing. (22:30 is adjustable — tell me if you want a different
  time or to base it on each person's shift end.)

Tested: full suite 25/25 on a fresh DB; 22:30 cutoff logic verified; all modules + inline JS parse.

FILES: public/index.html, public/modules/leaves-time.js, server/modules/attendance.js
