# FK Home r1.26 — Learning module (Ship 1)

In-house light LMS. Logistics course #1 (8 sessions, escalating brutal checks), a Knowledge
Base (rate cards + flashcards), manager sign-off that flips `logistics_ready` with a 12-month
recert. Matched to r10-test conventions and tested.

## Verified before packaging
- Migration **44** (your latest was 43) — applies clean + idempotent; unique key on KB items so re-seeding can't duplicate.
- Server module shaped exactly like mail (`router.use(requireAuth)`, `{ db }`/`requireAuth` from `../`, `module.exports = router`); mounted on Express and exercised over HTTP — **16/16**.
- Content seeds on first use (no boot-order wiring); 8 sessions, 17 checks (2 free-text, 1 hard-fail), 6 KB items; triple-seed stays at 6.
- Frontend registers as `window.fkModules['learning']` and `['kb']`, `render()` returns HTML into `<main class="content">`, fetches + paints — **8/8** in a simulated browser.
- Wiring (`wire.pl`) tested against fixtures mirroring your anchors: inserts correctly, idempotent.

## What the deploy does
1. **Branch guard** — halts unless on `r10-test`.
2. Copies in 4 new files: `server/schema/44-learning.sql`, `server/modules/learning.js`, `server/learning-content.js`, `public/modules/learning.js`.
3. Runs `wire.pl` — adds to your live files, idempotently:
   - `server.js`: `const learningRoutes = require('./server/modules/learning');` (after the mail require) and `app.use('/api/learning', learningRoutes);` (after the mail mount).
   - `public/index.html`: **My Learning** + **Knowledge Base** nav items (between My Mail and My work) and `<script src="/modules/learning.js"></script>` (after reports.js).
4. Commits + pushes to `r10-test`. Railway redeploys; the migration runs on boot; the course seeds on first visit.

## Deploy — paste from the repo root
```sh
BR=$(git rev-parse --abbrev-ref HEAD); if [ "$BR" != "r10-test" ]; then echo "STOP — on $BR, not r10-test"; else \
cd ~/Downloads && unzip -o fkhome-r1_26-learning.zip >/dev/null && \
cd ~/Documents/GitHub/campaignpulse-setup && \
cp -R ~/Downloads/fkhome-r1_26-learning/server/. server/ && \
cp -R ~/Downloads/fkhome-r1_26-learning/public/. public/ && \
cp ~/Downloads/fkhome-r1_26-learning/wire.pl ~/Downloads/fkhome-r1_26-learning/R10_LEARNING_DEPLOY_NOTES.md . && \
perl wire.pl && rm wire.pl && \
git add server/ public/ R10_LEARNING_DEPLOY_NOTES.md && \
git commit -m "r1.26 Learning module (Ship 1): in-house LMS, Logistics course, KB, sign-off gate" && \
git push origin r10-test; fi
```

## After it deploys (1–2 min)
- Sidebar shows **My Learning** and **Knowledge Base**.
- My Learning → Start → work the course; checks gate each session; manager view signs off → `logistics_ready`.
- Knowledge Base → rate cards + flashcards, searchable.
- If a nav item shows but the page is blank, hard-refresh once (cached index.html). If the clash check ever flags, stop and send me the line — but it came back clean.

## Follow-ups (need the profile + onboarding files when you want them)
- Profile "Training & competencies" drawer (reads `lms_competencies`).
- Auto-assign on onboarding for Logistics joiners (`learningRoutes.assignCourse(...)`).
- Ship 2: AI free-text grading + manager review queue (needs `ANTHROPIC_API_KEY` on FK Home Railway).
