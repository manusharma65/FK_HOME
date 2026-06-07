# R0.67 — Nav group labels bigger + Idle "why were you away" free text

## 1. Nav group labels bigger (HR / MY DAY / SYSTEM / ABOUT ME)
.navgrp-lbl 13px -> 15.5px, tighter tracking. (Nav items already bumped to 17.5px/600
in r0.66.) Whole sidebar now reads large + bold.

## 2. Idle notice -> free-text reason (replaces the passive "PC idle" banner)
"On break" was rejected (staff have dedicated breaks), so this captures WHY they stepped
away, in their own words.
- Banner now has a text box + "Log it" button.
- POST /api/attendance/idle-reason attaches the note to the current idle_event and marks
  it acknowledged -> this SUPPRESSES the 20-min manager escalation (managers only chase
  UNEXPLAINED idles). Migration 33 adds idle_events.reason (idempotent).
- HR chronic-idle review now shows the reasons per person for the window ("They explained:
  …" / "No reasons given").

## Files
public/index.html, server/modules/attendance.js, server/schema/33-idle-reason.sql

## Validation
index.html parses clean; node --check clean on attendance.js.

## Check after deploy (hard refresh)
- Sidebar: HR/MY DAY/SYSTEM/ABOUT ME visibly larger.
- Home: when idle 10+ min, banner shows a box -> type a reason -> Log it -> turns green
  "Thanks, logged". HR > Insights/chronic-idle review shows the reasons.
