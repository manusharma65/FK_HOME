# FK Home r0.14 — Deploy notes

**Branch:** `r10-test` (NOT main, NOT fk-one-staging)
**Deploy:** `cd ~/Documents/GitHub/campaignpulse-setup` then `git push origin r10-test`
(If rejected with non-fast-forward: `git push origin r10-test --force-with-lease`)

Prod and staging have **separate databases**. The migration + seed run automatically on boot for whichever service the branch deploys to.

Healthz should return `r0.14` after deploy.

---

## What shipped in r0.14

### 1. Module system (the Ship 2 core)
- `loadModule` infrastructure in the shell: home content is now in `#homeView`,
  modules render in `#moduleView`. Loader handles render → mount → unmount,
  loading state, errors, deep links, and the browser back button.
- **Home is a module** (shown/hidden, never re-rendered — zero behaviour change).
- **HR Insights migrated** to a module at `#hr/insights`. The Insights sidebar
  item now loads inside the shell instead of jumping to admin.html.
- All OTHER admin links still go to admin.html until their own ships migrate them.
- New files: `public/modules/loader.js`, `public/modules/hr-insights.js`.

### 2. Salary edit for HR
- HR Team group now has `profile.salary.edit` (was view-only). Owner + HR can
  edit salary; Head of Ops still cannot. Applies automatically — the seed
  re-syncs group permissions on boot.

### 3. Backfill (onboarding + reviews)
- The existing Admin backfill button (`POST /api/admin/backfill/review-schedules`)
  now ALSO applies the onboarding template, not just review schedules.
- Active employees only. Idempotent — safe to run repeatedly.
- **Action:** after deploy, go to Admin → run the backfill once so existing staff
  get their onboarding + review records (back-dated as-is, per your decision).

### 4. Birthday
- **Banner** on the home page on the user's own birthday (private to them,
  dismissible).
- **HR pre-notify**: one day before each active employee's birthday, Tanu +
  Deepanshi get a notification (no task). Fires in the 06:00 daily cron.

### 5. Status pill rework
- New set: Active / In meeting / Heads down / Feeling sick / WFH.
  (On break + Running late removed from the picker; running-late still has its
  own separate flow.)
- **WFH requires location.** Picking WFH asks the browser for location; if the
  user blocks it, WFH does NOT activate. A single lat/long stamp is saved.
- **Status nudges:** if someone sits on Feeling sick / Heads down / In meeting
  for 1 hour, they get a self-nudge; after 1.5 hours their manager is notified.

### 6. Company Today simplified
- "Pending" removed (folded into "Not yet in").
- The three off-types (pattern / CS rota / holiday) merged into one "Off" count
  with a hover breakdown. The people drill-through modal still lets you filter
  by each type.

### 7. Idle panel
- No change needed — it already works (banner at 10 min idle, manager notified
  at 20 min). Verified in code.

---

## POST-DEPLOY CHECKS (please do these)

1. **Healthz** = r0.14.
2. **Tanu's drawers bug** — this was a DATA issue, not code. After deploy, open
   Admin → Users → Tanu and confirm she is in the **HR Team** group. If she's
   not, add her (one click). Same for Deepanshi. That's what makes the profile
   drawers (onboarding/reviews/etc.) visible to them.
3. **Run the backfill** once (Admin) for existing staff.
4. **Salary** — log in as Tanu, open a profile, confirm she can now EDIT salary.
5. **Insights** — click Insights in the HR sidebar; it should load inside the
   shell (URL becomes `…/#hr/insights`), and the three tables populate.
   Test the browser back button returns to home.
6. **Status** — set yourself to WFH (should ask for location), and to Feeling
   sick. Check the pill + colour.
7. **Birthday banner** — only testable on an actual birthday, or temporarily set
   your DOB to today in Admin to verify, then set it back.

---

## NOT in this ship (deferred, as agreed)
- File View / Replace / download-gate, and the Monday-style reviews card with
  cancel/amend → these come with the **Profile module ship (r0.17)**, built once
  in the new architecture rather than patched into the old profile.html now.
- Attendance calendar, leave-from-notification → their later ships.

## New cron summary
06:00 daily now also runs: birthday pre-notify.
5-min tick now also runs: status nudges (1h self / 1.5h manager).
