# FK Home r0.31.2 — HOTFIX (recruitment candidate card)

The candidate card looked bare for a freshly-added candidate (only name/source/why showed;
all other fields were HIDDEN when empty, so the card looked broken / "no info saved").
Nothing was lost — the fields were just empty and the card hid them.

Fix (matches the approved candidate-card mock):
- Card now shows EVERY detail field always — filled ones show the value, EMPTY ones show a
  faint italic "add" that opens Edit details. The card never looks bare, and it's obvious
  what's still to fill.
- Added the avatar/initials circle + name + "role · source" line in the header (was a plain title).
- Everything else unchanged (why-shortlisted line, files, stage history, per-round outcomes,
  notes, Edit details, End candidate / Bring back).

ONLY ONE FILE CHANGED vs r0.31: public/modules/recruitment.js.

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_31_2.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_31_2/public/modules/recruitment.js public/modules/recruitment.js && cp ~/Downloads/fk-r0_31_2/R0_31_2_HOTFIX_NOTES.md . && git add public/modules/recruitment.js R0_31_2_HOTFIX_NOTES.md && git commit -m "r0.31.2 hotfix: candidate card shows all fields (empty=add prompt) + avatar header" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
