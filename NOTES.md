# FK Home — fix console error from removed daily-report card

Branch: r10-test. ONE file: public/index.html.

Root cause: the home daily-report card was removed earlier (the report is filed on
the Today page now), so #dailyReportSummary no longer exists in the DOM.
loadDailyReport() was guarded for this, but refreshDailyReportSummary() was not —
so each time loadAttendanceToday() called it, it did
  document.getElementById('dailyReportSummary').innerHTML = ...
on a null element and threw:
  [loadAttendanceToday] TypeError: Cannot set properties of null (setting 'innerHTML')

Fix: refreshDailyReportSummary() now returns early if #dailyReportSummary is absent
(same guard pattern loadDailyReport already uses). No behaviour change where the
element exists. The other write site (inside loadDailyReport) is already behind that
function's existing guard, so it can't fire.

Verified: inline JS passes node --check; Academy nav (grpAcademy) intact. Shell is
served no-cache, so a normal reload picks it up — no version bump needed.
