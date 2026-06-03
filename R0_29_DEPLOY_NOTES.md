# FK Home r0.29 (Ship 2) — notifications redesign + card polish + HR queue fix

## Notifications (the big fix)
- Every notification now points at the in-app MODULE, not the old standalone pages.
  Before: action_urls were /admin.html#..., /profile.html?id=..., /chat.html, /my-growth.html, or /
  (home) — in the module shell these jumped out of the app or fell to Home. That was
  "click notification → nothing / goes home" and "can't approve leave from the notification".
  After: #hr/leaves/<id>, #profile/<id>, #profile/<id>/reviews, #hr/reports, #hr/regularisations,
  #my-growth, #chat/<id>, #chronic-idle, #my-work, #home. (19 templates repointed.)
- Click a notification → marks it read (auto-clears from the unread pile) → opens the actual thing.
- Old notifications still in the DB (pointing at .html pages) are translated on click by a safety
  fallback, so nothing dead-ends.
- Browser popup (opt-in, silent — no sound) for genuinely new unread notifications while the page is
  open; clicking the popup focuses the tab and opens the item. Permission is requested once, when the
  user first opens the bell (not a nag on load). Tracks last-seen id so the 90+ backlog never re-pops.
- The 90+ pileup clears as items are handled (auto-clear on click); "mark all read" still available.

## HR queue
- Was silently empty: the query required meta.hr_area to be set, so if an HR person's area was never
  assigned, every task was filtered out. Now shows all auto-event HR tasks — never silently empty.

## Task card polish (folded in)
- Bigger card (560 → 800px), roomier padding, larger title.
- Category-coloured header even for 'other' (was dead grey).
- Outcome pills look pickable (full colour; selected one gets a ring) — not faded/disabled-looking.
- "Mark blocked" button restored as a proper full-size button.
- Clear meta line: "Assigned by X · date · about <person> →" with a visible context link.

## Files
server/notify.js                 (action_urls repointed to modules)
server/modules/tasks.js          (HR queue: drop hr_area filter)
public/modules/my-work.js        (card polish)
public/index.html                (handleNotifClick rewrite + browser popup + opt-in permission)

## After deploy — quick checks
1. Click a notification → it opens the right module (not Home). Leave notif → opens the leave.
2. Open the bell once → browser may ask to allow notifications (allow to test popups).
3. HR Queue → shows auto-generated HR tasks (if any exist).
4. Open a task card → bigger, coloured header, pills look tappable, Mark blocked present.

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_29.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_29/server/notify.js server/notify.js && cp ~/Downloads/fk-r0_29/server/modules/tasks.js server/modules/tasks.js && cp ~/Downloads/fk-r0_29/public/modules/my-work.js public/modules/my-work.js && cp ~/Downloads/fk-r0_29/public/index.html public/index.html && cp ~/Downloads/fk-r0_29/R0_29_DEPLOY_NOTES.md . && git add server/notify.js server/modules/tasks.js public/modules/my-work.js public/index.html R0_29_DEPLOY_NOTES.md && git commit -m "r0.29 notifications repoint to modules + browser popup + auto-clear, HR queue never empty, task card polish" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
