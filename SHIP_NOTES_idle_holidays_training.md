# FK Home — ship 1 of the fix list: false-idle, holidays placement, HR-training

Three independent, tested fixes. No schema changes. Does NOT ship server.js — the
Academy /api/learning mount stays as-is. Version string is unchanged (r1.26b).

#5 FALSE IDLE (public/index.html, startHeartbeat):
  The heartbeat only fired when FK Home was the focused tab (`if (document.hidden) return`).
  Your team works in other tabs/apps all day, so the heartbeat paused, the server saw no
  beat for 5 min, flipped them to idle and fired the 20-min idle alert. Now it beats every
  30s regardless of focus, plus an immediate beat on refocus. "Active" = FK Home open in
  their browser = at their desk. (Only index.html's startHeartbeat changed.)

#6 HOLIDAYS PLACEMENT (public/modules/leaves-time.js):
  Company holidays moved from the very bottom to directly under the "My attendance" calendar,
  so people see the company days off while planning leave.

#7 HR SEES LOGISTICS TRAINING (server/modules/learning.js):
  Course visibility is now department-scoped. A learner's profile (/progress) and their own
  Academy list (/my-courses) only show a course for their own discipline — the Logistics
  course never renders for HR/Amazon/etc., even if a stale assignment row exists. Manual
  cross-assignments (assigned_via='manual') still show. Auto-assign was already correctly
  gated to logistics; this closes the display leak. (No data deleted; purely a visibility gate.)

Tested: full suite 25/25 on a fresh DB; #7 scoping logic 5/5; all inline JS + modules parse.

STILL TO COME (next ship, under its own full test pass — not rushed in here):
  #1 split "Take rest" from off-sick + clean up the stuck people (un-block their leave),
  #2/#3 "Who's in today" driven by today's attendance (In / Not in yet / Off),
  #4 names → Option D.

FILES: public/index.html, public/modules/leaves-time.js, server/modules/learning.js
