-- ============================================================================
-- FK Home — r0.26: Recruitment pipeline (tracking)
-- ============================================================================
-- No new columns needed — recruitment reuses the existing tasks table:
--   OPENING   = tasks row, kind='recruitment', parent_task_id NULL,
--               title = role name, department_id = hiring dept,
--               meta = { platform, hiring_manager_id, opened_by }
--   CANDIDATE = tasks row, kind='recruitment', parent_task_id = opening id,
--               title = candidate name,
--               meta = { stage, source, phone, email, salary_expectation,
--                        notice_period, standby_note, reject_reason, reject_stage,
--                        ready_to_onboard, notes:[{at,by,text}] }
--
-- Stages (meta.stage): sourced | screening | interview | offer | hired
--                      | standby            (visible holding column)
--                      | rejected | dropped (exits, tucked away with reason)
--
-- This migration just adds an index for fast per-opening candidate lookups
-- and is safe to re-run.
-- ============================================================================

-- Fast lookup of an opening's candidates (and openings themselves).
CREATE INDEX IF NOT EXISTS idx_tasks_recruitment
  ON tasks(parent_task_id)
  WHERE kind = 'recruitment';

-- Fast lookup of all openings.
CREATE INDEX IF NOT EXISTS idx_tasks_recruitment_openings
  ON tasks(kind, status)
  WHERE kind = 'recruitment' AND parent_task_id IS NULL;
