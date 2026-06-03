# FK Home r0.30 (Ship 3) — attendance truth + Leaves & time + slim My Growth + nav + mobile + idle-pause

## What this ship does (Option B — two separate personal pages)
- **Leaves & time** = the employee's self-service page (NEW module): leave balance/history +
  Request leave, attendance calendar (last 30 days), lateness + Request a correction. Self only.
- **My Growth** = the development/performance page (slimmed): conduct summary (on time / days late /
  unauthorised / leaves taken — reads what the system already classified), My reviews, and a
  Performance & scoring placeholder for when scoring migrates. Keeps the person switcher so
  managers/HR can review someone's conduct.
- They share the same underlying attendance data but answer different questions: Leaves & time =
  "the record + actions"; My Growth = "how it reflects on me". No duplication.

## 1. Attendance truth (the "2 late but empty calendar" bug) — server/modules/me.js
Login wrote nothing to attendance_day; the calendar reads attendance_day while the late count read
lateness_log — two stores, so they disagreed. Fix: on the first heartbeat of the day, recordClockIn()
writes first_login + late_minutes and flips the day pending->working/late on attendance_day.
Idempotent (only if first_login is null), never overrides on_leave/off_sick/off_holiday/off_pattern/
off_cs_rota, and creates the day row from shift_policies if the cron hasn't seeded it. Verified the
(user_id, for_date) unique constraint and the columns exist (sick path + cron already use them).

## 2. Leaves & time — NEW public/modules/leaves-time.js (route #leaves-time)
Self-service page. Request leave / Request a correction buttons call the existing global modals
openLeaveModal() / openRegulariseModal() in index.html. Reads /api/leaves/mine,
/api/attendance/me/week, /api/attendance/me/lateness.

## 3. My Growth — public/modules/my-growth.js (rewritten, slim)
Conduct counts from /api/attendance/me/week + /api/leaves/mine. Reviews from
/api/profile/<id>/drawer/reviews. The raw attendance/leaves/lateness TABLES that used to live here
have moved to Leaves & time — My Growth is now the performance lens only.

## 4. Nav + jumps — public/index.html
- Dropped the "WORKSPACE" header; "My work"/"Team work" sit directly under "My FK Space".
- "YOU" section renamed "ABOUT ME".
- "Request leave" nav item replaced by "Leaves & time" -> #leaves-time (the new module).
- Employee onboarding ("Your onboarding" + the home card "Open my onboarding") now open the
  profile module in-shell (#profile/me) instead of jumping to /profile.html.
- NOTE: the HR "Onboarding" nav item (managing OTHERS' onboarding) still points at /admin.html#onboarding
  because there is no onboarding module yet. It works; migrating it is a separate task, not this ship.

## 5. Mobile safeguard + idle-pause — public/index.html
- Mobile: the status control is view-only (arrival logged, status set from the office device).
- Office (non-mobile): auto-set active on load from a passive state only (never overrides a deliberate
  status), with a one-time "Welcome in" banner per day.
- When status goes idle/offline, the client calls /api/tasks/idle-stop to pause any running task timer.

## IMPORTANT — index.html includes the r0.29 (Ship 2) changes too
This index.html is a superset: it has BOTH r0.29 (notifications) and r0.30 changes.
- If you have NOT deployed r0.29: you ALSO need its other files (server/notify.js, server/modules/tasks.js,
  public/modules/my-work.js) from fk-r0_29.zip, or the notification routing won't fully work.
- If you HAVE deployed r0.29: this index.html is safe (same notif code + the r0.30 additions).

## Files
server/modules/me.js              (clock-in write)
public/modules/leaves-time.js     (NEW self-service page)
public/modules/my-growth.js       (slim performance page)
public/index.html                 (nav + mobile + idle-pause + onboarding jumps; includes r0.29 notif)

## After deploy — quick checks
1. Sidebar: no WORKSPACE header; "My work" under "My FK Space"; "ABOUT ME" at the bottom with
   "Leaves & time" in it.
2. Click "Leaves & time" -> the new page loads (balance tiles, Request leave, calendar, lateness).
   (If it shows blank/Home, the loader didn't resolve #leaves-time — tell me; it follows the exact
   team-work/my-work pattern so it should.)
3. Request leave / Request a correction buttons open the existing modals.
4. Log in at your desk -> "Welcome in" banner -> My Growth conduct counts + Leaves & time calendar
   show today (this is the attendance fix working).
5. Open the status pill on a phone -> view-only message.
6. Click "Your onboarding" -> opens your profile in-shell (not a page jump).

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_30.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_30/server/modules/me.js server/modules/me.js && cp ~/Downloads/fk-r0_30/public/modules/leaves-time.js public/modules/leaves-time.js && cp ~/Downloads/fk-r0_30/public/modules/my-growth.js public/modules/my-growth.js && cp ~/Downloads/fk-r0_30/public/index.html public/index.html && cp ~/Downloads/fk-r0_30/R0_30_DEPLOY_NOTES.md . && git add server/modules/me.js public/modules/leaves-time.js public/modules/my-growth.js public/index.html R0_30_DEPLOY_NOTES.md && git commit -m "r0.30 attendance clock-in + Leaves&time module + slim My Growth + nav + mobile safeguard + idle-pause" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
