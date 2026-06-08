# FK Home r0.73 — HR Performance & Conduct (cumulative since r0.71)

Branch: **r10-test**. Cumulative — includes the r0.72 name→Fraunces fixes AND the
new performance system, so one push lands everything since your last confirmed deploy.

## New: HR performance & conduct
- **Migration 34** (`server/schema/34-hr-performance.sql`) — additive/idempotent.
  Extends `daily_reports`; adds `weekly_scores`, `attendance_ledger`, `recognition_log`.
  Nothing existing is dropped or rewritten.
- **Engine** (`server/modules/daily.js`) — assessDay / scoreWeek / conduct ledger /
  freezeDay / scoreLastWeek / retentionCleanup + endpoints under `/api/daily`.
- **server.js** — mounts `/api/daily`; adds freeze+retention after the midnight tick
  and scoreLastWeek after the weekly tick. The live tick functions are NOT edited.
- **Today** (`public/modules/today.js`) — new page, "My Day" group: auto tasks +
  manual items + full attendance block + Submit.
- **My Growth** (`public/modules/my-growth.js`) — filled the scoring placeholder:
  level ladder, this-week pillar breakdown, 8-week trend, attendance-record standing.
  Conduct + reviews sections kept intact.
- **HR today** (`public/modules/hr-today.js`) — new page, HR group, owner/manager only
  (gated on attendance.view.any). Flag-first scan. Nav badge + bell (via notifyManagersOf).
- **Attendance policy page** (`public/modules/attpolicy.js`) — published conduct rules added.
- **index.html** — Today + HR today nav entries, script includes, reveal, badge updater.

## Reused (not rebuilt), so nothing working breaks
- Submit/lock = existing `POST /api/attendance/daily-report` + midnight lock.
- Idle/lateness already detected by the live ticks; engine reads, doesn't re-detect.

## Calibration (code constants in daily.js — tunable)
SLA 40 / hiring 20 / accuracy 15 / conduct 10 / quality 15. Late-credit 0.4. Not-done
caps week at Good. HR bands: Good = 95%+ correct. Ledger: late 0.5/1, early 1, over-break 1,
chronic-idle 1, unauth 2, no-show-no-notice 3; steps at 4/6/9; rolls off 12 months.
Retention: day detail 13 months (storage), scores kept; self view 90 days.

## Verify after deploy (on screen)
1. **Today** (My Day group) — opens, shows your tasks/queue/attendance, Submit works.
2. **My Growth** — level ladder + pillar bars + trend show; Conduct + My reviews still there.
   (First weekly score appears next Monday; before that the level shows "No score yet".)
3. **HR today** (owner) — appears in HR group, lists HR people, flags + badge.
   If it shows empty, the HR department slug may not be 'hr' — tell me the actual slug.
4. Existing pages (attendance, payroll, approvals) unchanged; person names render in Fraunces.
