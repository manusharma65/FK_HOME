# FK Home r0.31.3 — candidate card restyled to match the task card

The candidate card now uses the SAME design language as the task card (the one you liked):
- Blue header bar with the role kicker, big name in white, stage pill top-right, and a "From <source>" line.
- "Why shortlisted" strip.
- Details: a single "Add details" button (not seven inline "add" links). When empty, one calm line
  ("No company, salary, notice or contact yet — add them as you learn them."); once filled, the values grid.
- Files in a grouped panel with a full-width Upload button.
- Stage history, Notes, and an action row: Edit details / Close / End candidate.
- Stage moves are DRAG ONLY (no "Advance" button on the card), as requested.

ONLY ONE FILE CHANGED vs r0.31: public/modules/recruitment.js (supersedes r0.31.2).

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_31_3.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_31_3/public/modules/recruitment.js public/modules/recruitment.js && cp ~/Downloads/fk-r0_31_3/R0_31_3_HOTFIX_NOTES.md . && git add public/modules/recruitment.js R0_31_3_HOTFIX_NOTES.md && git commit -m "r0.31.3 candidate card restyled to match task card (blue header, panels, drag-only)" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
