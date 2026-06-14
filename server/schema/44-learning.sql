-- FK Home — Learning module (Ship 1).
-- One module covering all departments: courses -> sessions -> checks, assignments,
-- per-session progress, attempts, competency gates, version acks, and the KB reference store.
-- All tables IF NOT EXISTS so re-runs on boot are safe. DATE columns read as strings (server/db.js parser).

-- ---------- Courses ----------
CREATE TABLE IF NOT EXISTS lms_courses (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  department      TEXT NOT NULL,                       -- 'logistics','amazon','cs','accounts','warehouse'
  role_tag        TEXT,                                -- role this course trains toward
  competency_key  TEXT,                                -- e.g. 'logistics_ready' (the gate it flips)
  owner_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version         INTEGER NOT NULL DEFAULT 1,
  recert_months   INTEGER DEFAULT 12,                  -- annual default
  rates_verified_on DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Sessions (ordered lessons in a course) ----------
CREATE TABLE IF NOT EXISTS lms_sessions (
  id          SERIAL PRIMARY KEY,
  course_id   INTEGER NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       TEXT NOT NULL,
  objective   TEXT,
  body_html   TEXT,
  est_minutes INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

-- ---------- Checks (questions per session) ----------
CREATE TABLE IF NOT EXISTS lms_checks (
  id            SERIAL PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES lms_sessions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('mcq','scenario','free_text')),
  prompt        TEXT NOT NULL,
  options_json  JSONB,            -- [{text, correct}] for mcq/scenario
  model_answer  TEXT,             -- free_text: the reference answer for AI grading (Ship 2)
  pass_criteria TEXT,             -- free_text: what counts as a pass
  hard_fail     BOOLEAN NOT NULL DEFAULT false,  -- e.g. payment-before-dispatch
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, position)
);

-- ---------- Assignments (who must do which course) ----------
CREATE TABLE IF NOT EXISTS lms_assignments (
  id           SERIAL PRIMARY KEY,
  course_id    INTEGER NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_via TEXT NOT NULL DEFAULT 'manual' CHECK (assigned_via IN ('onboarding','manual')),
  due_date     DATE,
  status       TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (course_id, user_id)
);

-- ---------- Per-session progress ----------
CREATE TABLE IF NOT EXISTS lms_progress (
  id            SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  session_id    INTEGER NOT NULL REFERENCES lms_sessions(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','current','passed')),
  passed_at     TIMESTAMPTZ,
  UNIQUE (assignment_id, session_id)
);

-- ---------- Check attempts ----------
CREATE TABLE IF NOT EXISTS lms_check_attempts (
  id            SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  check_id      INTEGER NOT NULL REFERENCES lms_checks(id) ON DELETE CASCADE,
  answer        TEXT,
  ai_score      INTEGER,          -- Ship 2
  ai_feedback   TEXT,             -- Ship 2
  result        TEXT NOT NULL CHECK (result IN ('pass','fail','flagged')),
  graded_by     TEXT NOT NULL DEFAULT 'auto' CHECK (graded_by IN ('auto','ai','manager')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Competency gates (on the profile) ----------
CREATE TABLE IF NOT EXISTS lms_competencies (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competency_key TEXT NOT NULL,
  course_id      INTEGER REFERENCES lms_courses(id) ON DELETE SET NULL,
  signed_off_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  signed_off_at  TIMESTAMPTZ,
  recert_due     DATE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','lapsed')),
  UNIQUE (user_id, competency_key)
);

-- ---------- Version acknowledgements (SOP-decay handling) ----------
CREATE TABLE IF NOT EXISTS lms_version_acks (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id        INTEGER NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  retest_required  BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at  TIMESTAMPTZ,
  retest_done_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id, version)
);

-- ---------- Knowledge Base reference items (not tied to a course) ----------
CREATE TABLE IF NOT EXISTS lms_reference (
  id            SERIAL PRIMARY KEY,
  department    TEXT NOT NULL,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('rate_card','flashcard','flow','error_table','sop','article','calculator_link')),
  body_html     TEXT,
  config_json   JSONB,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_on   DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Indexes ----------
CREATE INDEX IF NOT EXISTS idx_lms_sessions_course   ON lms_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_lms_checks_session    ON lms_checks(session_id);
CREATE INDEX IF NOT EXISTS idx_lms_assign_user       ON lms_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_lms_progress_assign   ON lms_progress(assignment_id);
CREATE INDEX IF NOT EXISTS idx_lms_attempts_assign   ON lms_check_attempts(assignment_id);
CREATE INDEX IF NOT EXISTS idx_lms_comp_user         ON lms_competencies(user_id);
CREATE INDEX IF NOT EXISTS idx_lms_ref_dept          ON lms_reference(department);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_ref_dept_title ON lms_reference(department, title);
