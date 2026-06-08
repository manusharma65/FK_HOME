-- ============================================================================
-- FK Home — Migration 34: HR Performance & Conduct
-- ----------------------------------------------------------------------------
-- Adds the performance/conduct layer on top of EXISTING tables. Nothing here
-- drops or rewrites live data. All additive + idempotent (safe to re-run).
--
--   1. daily_reports  — extend with the auto-assembled day (tasks, manual
--                       items, flags) + a submit stamp. The existing notes /
--                       snapshot_* columns and the midnight lock are untouched.
--   2. weekly_scores  — one row per person per ISO-week. Auto-facts + the
--                       owner's quality override (logged). Monthly = these
--                       averaged (computed, no separate table).
--   3. attendance_ledger — the accumulating conduct record (late / absence /
--                       over-break / chronic-idle). Counts UP, expires after
--                       12 months, excused = correctable. Separate from score.
--   4. recognition_log — manager-logged positives, so the evidence trail is
--                       not only negatives.
--
-- Weighting, bands, point values and thresholds are CODE CONSTANTS in
-- server/modules/daily.js (tunable) — deliberately NOT a config table.
-- ============================================================================

-- ---------- 1. Extend daily_reports (additive only) ----------
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS snapshot_tasks   JSONB;      -- auto-captured tasks done that day
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS manual_items     JSONB;      -- off-system items the person added [{category,note,counted}]
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS snapshot_flags   JSONB;      -- flags raised that day (frozen at lock)
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ;-- when the person hit "Submit my day" (NULL = not yet)
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS auto_submitted   BOOLEAN NOT NULL DEFAULT FALSE; -- TRUE if midnight closed it unreviewed

-- ---------- 2. weekly_scores ----------
-- One locked row per person per ISO-week (week_start = Monday). Pillars are the
-- auto-facts; quality_* is the owner's logged override (neutral when null).
CREATE TABLE IF NOT EXISTS weekly_scores (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start            DATE NOT NULL,                    -- Monday of the ISO week
  dept_slug             TEXT,                             -- weighting profile used (e.g. 'hr')
  -- auto-fact pillars (points earned, never negative)
  sla_pts               NUMERIC(6,2),
  hiring_pts            NUMERIC(6,2),
  accuracy_pts          NUMERIC(6,2),
  conduct_pts           NUMERIC(6,2),
  -- correctness headline (on-time + accurate %) — drives the band for HR
  correctness_pct       NUMERIC(6,2),
  -- quality (15) — neutral default; owner override is logged
  quality_pts           NUMERIC(6,2),                     -- effective quality used in total
  quality_override      NUMERIC(6,2),                     -- NULL = neutral/default
  quality_override_by   INTEGER REFERENCES users(id),
  quality_override_at   TIMESTAMPTZ,
  quality_override_note TEXT,
  -- result
  total                 NUMERIC(6,2),
  band                  TEXT,                             -- Poor/Average/Good/Excellent/Above Expectations
  band_capped           BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE if a not-done item capped it
  manual_counted        INTEGER NOT NULL DEFAULT 0,       -- manual items that counted toward score
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_scores_user ON weekly_scores(user_id, week_start DESC);

-- ---------- 3. attendance_ledger ----------
-- The accumulating conduct record. Each breach = a row of points. Approved /
-- excused = 0 or excused=TRUE. Rolls off at expires_on (occurred + 12 months).
CREATE TABLE IF NOT EXISTS attendance_ledger (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_on     DATE NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'late_reported','late_nonotice','left_early',
                    'unauth_absence','noshow_nonotify','over_break','chronic_idle'
                  )),
  points          NUMERIC(4,2) NOT NULL DEFAULT 0,
  source          TEXT,                                   -- which signal created it (lateness_log id, etc.)
  excused         BOOLEAN NOT NULL DEFAULT FALSE,
  excused_by      INTEGER REFERENCES users(id),
  excused_at      TIMESTAMPTZ,
  note            TEXT,
  expires_on      DATE,                                   -- occurred_on + 12 months
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, occurred_on, kind)                     -- one of each kind per day, idempotent re-runs
);
CREATE INDEX IF NOT EXISTS idx_att_ledger_user ON attendance_ledger(user_id, occurred_on DESC) WHERE excused = FALSE;

-- ---------- 4. recognition_log ----------
-- Manager-logged positives — feeds the quality pillar and shows on My Growth.
CREATE TABLE IF NOT EXISTS recognition_log (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_by_user_id INTEGER NOT NULL REFERENCES users(id),
  occurred_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  note            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recognition_user ON recognition_log(user_id, occurred_on DESC);
