# FK Home — the big ship: rest/sick split, "Who's in today" from attendance, Option D names

No server.js change (Academy mount stays). New migration 46 (slots after Learning's 44/45).
Builds on ship 2 (selfie/poll/holidays/22:30 are already in this index.html).

#1 — SPLIT "TAKE REST" FROM OFF-SICK + UN-BLOCK STUCK PEOPLE
  Two different things were both stored as 'off_sick': a casual breather and a genuine sick day.
  - "Take rest" in the status picker now sets a NEW presence value 'resting' (server/modules/me.js
    already allows it; migration 46 widens the DB CHECK constraint to accept it). It writes
    presence ONLY — never a sick_log, never an attendance day, and it never blocks leave. Shows
    as "Resting". Flips back to Active when they return, and resets to Active on the next day's
    first clock-in (recordClockIn), so it can't stick.
  - Genuine sick stays 'off_sick' (dated, lives in Leave & Time) and always has an end_date.
  - MIGRATION 46 CLEANUP (one-time, idempotent): closes any open-ended sick_log (end_date=NULL)
    to its own start date — these were what made every future date read "off sick" and rejected
    leave requests — and clears any stale 'off_sick' PRESENCE to offline. This un-blocks the
    people who were stuck and couldn't request leave.

#2/#3 — "WHO'S IN TODAY" FROM TODAY'S ATTENDANCE (server/modules/team.js + the board render)
  The board read sticky presence, so it couldn't show who simply hadn't arrived. It's now driven
  by today's attendance_day: each person is In / Not in yet / Off-with-reason (on leave, off sick,
  on holiday, rota, pattern). Presence (Active/Resting/etc.) only overlays people who are actually in.

#4 — OPTION D NAME CARDS (the board render)
  Each person is a directory card: rounded-square dept-coloured avatar, dept-colour left accent,
  name in Fraunces, role in a tracked uppercase label, and a status line with a coloured dot.

Tested: full suite 28/28 on a fresh DB (migration 46 applied); targeted 7/7 — resting accepted by
the DB constraint, open sick_log closed (leave un-blocks), stale off_sick cleared, stale resting
reset on clock-in, and the In/Not-in-yet/Off derivation.

FILES: public/index.html, server/modules/me.js, server/modules/team.js,
       server/schema/46-resting-split-and-sick-cleanup.sql
