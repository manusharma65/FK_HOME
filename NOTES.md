# FK Home r1.28 — make the sick-grid fix + holidays redesign actually take effect

The previous ship (attendance.js + leaves-time.js, no server.js) didn't surface:
- leaves-time.js is a FRONTEND module — the shell only re-fetches it when the
  VERSION stamp in its URL changes. VERSION wasn't bumped, so browsers kept the
  cached old file and never showed the holidays redesign.
- Without a server.js change the container may not have rebooted, so the boot-time
  calendar re-stamp may not have run.

This ship fixes both by bumping VERSION r1.25 -> r1.28 (taken from the verified-live
server.js; Academy mount, Emp-ID backfill and boot reconcile all intact):
- New module URLs (?v=r1.28) => browser fetches the new leaves-time.js => holidays
  redesign appears.
- Push => Railway redeploy => fresh boot => reconcileTodayPattern() => the sick
  re-stamp runs.

Also:
- The one-time sick re-stamp guard is bumped v1 -> v2, so it runs once on THIS boot
  regardless of whether it ran before.
- New read-only endpoint GET /api/attendance/debug/sick (self) returns the caller's
  sick_log rows, the days still stored as off_sick, and whether the re-stamp ran.
  Open it in the browser while logged in if the grid is still purple after deploy.

Tests: 31/31 (suite + the 3 sick-fix cases). No index.html change.
