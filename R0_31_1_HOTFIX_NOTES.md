# FK Home r0.31.1 — HOTFIX (onboarding sidebar nav item)

You already deployed r0.31. This is a SMALL follow-up: the sidebar "Onboarding" nav item
(navHrOnboarding) was still jumping to /admin.html#onboarding. It now routes in-shell to
People (#hr/users), where HR manages onboarding via each person's profile.

ONLY ONE FILE CHANGED vs r0.31: public/index.html.

## Deploy (on r10-test) — branch-guarded
cd ~/Downloads && unzip -o fk-r0_31_1.zip && cd ~/Documents/GitHub/campaignpulse-setup && BR=$(git branch --show-current) && if [ "$BR" != "r10-test" ]; then echo "STOP: on $BR, not r10-test"; else cp ~/Downloads/fk-r0_31_1/public/index.html public/index.html && cp ~/Downloads/fk-r0_31_1/R0_31_1_HOTFIX_NOTES.md . && git add public/index.html R0_31_1_HOTFIX_NOTES.md && git commit -m "r0.31.1 hotfix: onboarding sidebar item in-shell" && git push origin r10-test && echo "=== DEPLOYED OK ==="; fi
