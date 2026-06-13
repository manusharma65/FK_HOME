# FK Home r1.25 — fix batch (15 items + cockpit revert + selfie)

VERSION r1.25. One deploy. Migrations 40/42/43 auto-apply on boot.

BACKEND-LOGIC (tested: 25-suite green + targeted tests)
1+13 Who's-in / working Saturday: migration 42 force-corrects the pattern anchor to 2026-05-25
     (the old seed used ON CONFLICT DO NOTHING so a stale live value could never be fixed); a
     boot reconcile (reconcileTodayPattern) re-derives today's already-written rows.
6   Timezone: combineDT now stamps Europe/London (fixed the +1hr on Tanu); snapshot + formatTime
     render London. Selfie ack column/endpoints (migration 40 + attendance.js + clockin-modal.js) ship.
     Auto-clockout already existed; the real morning gap was the stale page (see 7).
15  Leave chain: request -> line manager ONLY (no owner, no HR, no HR task); manager approve ->
     senior HR (Tanu, auto-fallback to Deepanshi if she's on leave) + HR task created THEN; HR
     approve applies balance/accrual. Proven 8/8 + suite.
8   HR task cancel now DELETES the task (matches Amazon), audit-logged.
14  "Feeling sick" -> "Take rest": the picker sets a temporary presence status (via /status), not
     the formal sick-day call, so flipping back to Active is clean and Company-today no longer
     shows a stale "sick". Relabelled everywhere.

FRONT-END
2   Names: FULL NAME in caps + designation beneath, themed.
3   Company holidays now visible to ALL staff in Leave & Time (the GET /holidays endpoint was
     gated to attendance.view.any, so employees got 403 — now readable by any logged-in user).
4   Profile/Leave list: collapsible — shows 5, "Show all" reveals the rest.
5   Leave & Time "My attendance": hardened empty state; root cause was the anchor bug (all grey).
7+10+12 Day-rollover guard: a page left open overnight now reloads on the new London day, so the
     morning shows today (fresh login/selfie, today's blank daily report, correct attendance).
9   Add task opens a centered modal card (with the due-date field inside), not the old inline strip.
11  Home "My attendance" / "Time off" tiles now open Leave & Time (cards clickable), not My Growth.
0   Cockpit reverted to OWNER-ONLY (managers/leads/agents get their normal home back).

FILES: server.js, server/modules/{attendance,leaves,tasks}.js, server/notify.js,
server/hr-task-router.js, server/schema/{40-clockin-ack,42-fix-pattern-anchor,43-leave-approval-stage}.sql,
public/index.html, public/modules/{clockin-modal,my-work,leaves-time}.js
