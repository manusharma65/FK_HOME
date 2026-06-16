# FK Home r1.30 — Leave & time gets the monthly attendance calendar

Replaces the flat 30-day colour strip in Leave & time with the SAME monthly
calendar already used on the profile Attendance drawer (the "Time / Monthly
attendance calendar" view): month navigation, big Fraunces date cells with
W/L/S/A.L./H flags, today highlighted with the orange gradient, a Days worked /
Late / Annual leave / Sick summary row, and a click-a-day detail popup
(status, login, logout, active time).

Files:
- server/modules/attendance.js : NEW GET /api/attendance/me/month?year=&month=
  (self-scoped; optional user_id with the same permission rules as /me/week).
  The endpoint was documented in the file header but had never been built, so
  the month view had no data source until now.
- public/modules/leaves-time.js: calendar markup + CSS + render ported from the
  profile drawer, re-scoped to #lt-mod, fed by /me/month. Day-detail modal
  included. Old #ltCal / counts / colour-key removed.
- server.js : VERSION r1.29 -> r1.30 (taken from verified-live; Academy mount +
  boot reconcile intact). Forces the browser to fetch the new module.

Tests: 34/34 pass (3 new for the month query — single-month, ascending,
user-scoped, empty-month).  Lateness & corrections list below is unchanged.
