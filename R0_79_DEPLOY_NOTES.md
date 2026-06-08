# r0.79 — Office-device clock-in/out (mobile can't fake attendance)

Branch: **r10-test** (FK Home). Closes the hole where a mobile login stamped the
official arrival, so someone could open the app on their phone before the shift
bell and be recorded "on time" regardless of when they reached the office.

## The problem this fixes
Arrival (`first_login`) was written by the first login OR heartbeat of the day
from **any** device — no device check anywhere. So:
- A phone login at 11:55 (12:00 start) stamped you **on time**, locked; the later
  desk login was a no-op.
- Filing a "running late" notice from your phone *also* stamped you on time,
  because you had to log in on the phone to file it — notice said late, the
  attendance record said on time, and the record won.
- A mobile logout stamped an early clock-out, shortening the day.

## What changed (gate the WRITE, not the screen)

1. **New `server/modules/device.js`** — `isMobileRequest(req)`. Reads the
   client's `x-fk-device` hint; falls back to the user-agent if it's missing.

2. **`me.js`** — heartbeat now passes the device flag to `recordClockIn`, which
   **skips the arrival stamp on mobile** (the day row is still ensured, so the
   calendar isn't blank — it just waits for the desk login to set the time).
   Mobile heartbeats also no longer flip you to "active", so a phone in a pocket
   can't show you at work.

3. **`attendance.js`** — `recordLogin` ensures the day row but **does not stamp
   arrival on mobile**; `recordLogout` **ignores mobile** so a phone sign-out
   can't clock you out early.

4. **`auth.js`** — login and logout pass `isMobileRequest(req)` into the two
   functions above.

5. **Client** — `login.html`, and `index.html` (heartbeat + logout) now send
   `x-fk-device: mobile|desktop`. Arriving at an office device clears a lingering
   **running-late** status to active, so the notice and the real record agree.

Net: the official arrival and departure are set by an **office device**. Mobile
keeps you logged in and can file a running-late notice, but it no longer touches
the attendance record.

## Known edge (by design)
Someone working **only** from a phone all day gets no auto clock-in (status stays
"pending"). Genuine WFH staff are on a laptop/desktop (counts as office device),
so this only affects literal phone-only days — fixable via the existing
**Request a correction** flow in Leaves & time.

## Files in this zip
server/modules/device.js (new), server/modules/me.js,
server/modules/attendance.js, server/modules/auth.js,
public/index.html, public/login.html

## Deploy (branch-guarded — HALTS if not on r10-test)
```bash
cd ~/Downloads && unzip -o fkhome-r0.79-mobile-clockin.zip && \
cd ~/Documents/GitHub/campaignpulse-setup && git checkout r10-test && \
BR=$(git branch --show-current); if [ "$BR" != "r10-test" ]; then echo "STOP wrong branch: $BR"; else \
  cp -R ~/Downloads/fkhome-r0.79-mobile-clockin/server/. server/ && \
  cp -R ~/Downloads/fkhome-r0.79-mobile-clockin/public/. public/ && \
  cp ~/Downloads/fkhome-r0.79-mobile-clockin/R0_79_DEPLOY_NOTES.md . && \
  git add server/ public/ R0_*_DEPLOY_NOTES.md && \
  git commit -m "r0.79 — office-device clock-in/out (mobile can't stamp arrival/departure)" && \
  git push origin r10-test; fi
```

## Verify after deploy (hard-refresh)
1. **Phone:** open FK Home on your phone before your shift start. Your attendance
   for today should stay **pending** — no arrival time, not marked on time.
2. **Desk:** then log in on your office computer. Arrival stamps now, lateness
   computed against the real desk-login time; "Welcome in" banner shows once.
3. **Running late from phone → arrive at desk:** file a running-late notice on the
   phone, then log in at the desk — status flips to active and the late record
   matches the desk arrival.
4. **Mobile logout:** signing out on the phone does not set a clock-out.
5. Desktop behaviour unchanged: login = clock-in, logout = clock-out as before.
