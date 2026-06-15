# FK Home — onboarding, Academy-by-department, daily report, timer, manager-assign

No server.js change (Academy mount untouched). No schema change. Builds on the deployed
state (ship 1 learning.js, ship 2 reactivity/board). Tested: full suite + 20 targeted on a fresh DB.

#1 UPLOAD (server/modules/files.js) — a person can upload their OWN documents to
   personal / onboarding / employment / insurance; salary/payroll/reviews/appraisals/performance
   stay HR-only. Fixes new hires' "not allowed."

#2 EMPLOYEE ID (server/modules/admin.js + public/modules/users.js) — create-employee form has
   an Employee ID field; uses what HR types (validated FK###, checked unique), auto-numbers only
   if blank. 409 on duplicate, 400 on bad format.

#3 NO-REFRESH — already wired: every file-upload path re-renders on success (profile drawers,
   pay, onboarding, offboarding, task card). New-hire uploads only *seemed* to need a refresh
   because they were failing on permission (#1); fixed by #1.

#4 DAILY REPORT (server/modules/daily.js + public/index.html + public/modules/today.js) —
   - Removed the redundant home "Daily report" card (the report is filed on the Today page).
   - freezeDay keeps the day's snapshot for scoring but NEVER auto-submits; an unsubmitted day
     stays missed (submitted_at NULL).
   - New GET /api/daily/reminder; the home screen shows a big terracotta top banner
     "You didn't submit yesterday's report" with a "Submit it now" button -> Today page, every
     login until submitted (dismissable per session). Today page text updated (no more "submits
     itself at midnight").

#5 TIMER (public/modules/my-work.js) — "Start timer" renamed to "Start task". Behaviour unchanged.

#6 MANAGER ASSIGN (server/modules/profile.js) — PUT /:userId/manager now also accepts
   admin.users.edit, so onboarding HR can set a new hire's manager.

#8 ACADEMY BY DEPARTMENT (server/modules/learning.js + public/modules/learning.js) —
   - /kb scoped to the VIEWER's own department(s) (was hardcoded logistics for everyone).
   - new /available returns only courses for the viewer's department; the frontend "Available"
     list uses it (was a hardcoded logistics card shown to all — that was the leak HR saw).
   - /assign gated so a person can only self-assign a course for their own department.
   - empty states: "No training for your department yet" / "Nothing for your department yet".

FILES: server/modules/{learning,files,profile,admin,daily}.js,
       public/modules/{learning,my-work,users,today}.js, public/index.html
