// FK Home — Lifecycle engine
// ----------------------------------------------------------------------------
// One central place for:
//   * Reviewer routing                — who reviews whom
//   * Review schedule generation      — 1mo, 4mo, 8mo, annual records
//   * Task creation                   — reviewer + orchestrator copies
//   * Task lifecycle cron             — pending → open → due → overdue
//   * Onboarding template application — copy base list to new hire
//   * Probation lifecycle             — auto-stamp on hire, manual confirm
//
// These functions are called from admin.js (on user create / update) and
// from server.js (cron 06:00 London).

const { db } = require('../db');
const { notifyEvent } = require('../notify');

// ---------- Settings ----------
// Cached for 60s. Pulled from `settings` table; defaults hard-coded as fallback.

let _settingsCache = null;
let _settingsCacheAt = 0;
const SETTINGS_DEFAULTS = {
  review_open_window_days: 7,
  review_grace_days: 3,
  review_nudge_interval_days: 7,
  probation_months: 6,
};

async function getSettings() {
  if (_settingsCache && (Date.now() - _settingsCacheAt) < 60000) return _settingsCache;
  try {
    const r = await db.query(`SELECT key, value FROM settings`);
    const merged = Object.assign({}, SETTINGS_DEFAULTS);
    for (const row of r.rows) {
      // value is stored as jsonb. Coerce to number if numeric.
      const v = row.value;
      merged[row.key] = (typeof v === 'number' || typeof v === 'string')
        ? Number(v) : v;
    }
    _settingsCache = merged;
    _settingsCacheAt = Date.now();
    return merged;
  } catch (e) {
    console.error('[lifecycle.getSettings] failed:', e.message);
    return SETTINGS_DEFAULTS;
  }
}

function invalidateSettings() {
  _settingsCache = null;
  _settingsCacheAt = 0;
}

// ---------- Date helpers ----------

function addMonths(date, months) {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  d.setMonth(targetMonth);
  // Handle Feb 29 etc — JS already shifts forward correctly, fine for our use.
  return d;
}

function addYears(date, years) {
  return addMonths(date, years * 12);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(s) {
  // Accepts 'YYYY-MM-DD' or Date or ISO timestamp
  if (s instanceof Date) return s;
  if (typeof s === 'string') return new Date(s.length === 10 ? (s + 'T00:00:00Z') : s);
  return new Date(s);
}

// ---------- Reviewer routing ----------
// Rules:
//   1. Primary department manager (role='manager' else 'lead'). Skip self.
//   2. Else: first user in 'company-manager' group. Skip self.
//   3. Else: first user in 'owner' group. Skip self.
//   4. Else: null.
async function getReviewerFor(userId) {
  if (!userId) return null;
  try {
    // 1. Primary department manager/lead
    const dept = await db.query(
      `SELECT department_id FROM user_department_memberships
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY is_primary DESC,
                (SELECT sort_order FROM departments WHERE id = department_id) ASC
       LIMIT 1`,
      [userId]
    );
    if (dept.rows.length > 0) {
      const m = await db.query(
        `SELECT user_id FROM user_department_memberships
         WHERE department_id = $1 AND role IN ('manager','lead')
           AND deleted_at IS NULL AND user_id <> $2
         ORDER BY CASE WHEN role = 'manager' THEN 0 ELSE 1 END,
                  user_id ASC
         LIMIT 1`,
        [dept.rows[0].department_id, userId]
      );
      if (m.rows.length > 0) return m.rows[0].user_id;
    }

    // 2. company-manager group
    const cm = await db.query(
      `SELECT ug.user_id
         FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
         JOIN users u ON u.id = ug.user_id
        WHERE g.slug = 'company-manager' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'
          AND ug.user_id <> $1
        ORDER BY ug.user_id ASC
        LIMIT 1`,
      [userId]
    );
    if (cm.rows.length > 0) return cm.rows[0].user_id;

    // 3. owner group
    const ow = await db.query(
      `SELECT ug.user_id
         FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
         JOIN users u ON u.id = ug.user_id
        WHERE g.slug = 'owner' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'
          AND ug.user_id <> $1
        ORDER BY ug.user_id ASC
        LIMIT 1`,
      [userId]
    );
    if (ow.rows.length > 0) return ow.rows[0].user_id;

    return null;
  } catch (e) {
    console.error('[lifecycle.getReviewerFor] failed:', e.message);
    return null;
  }
}

// ---------- HR area owner ----------
// The active hr-team member who owns a given hr_area:
//   'recruitment_judgement' (reviews/probation/appraisal/policy) = Tanu (senior)
//   'daily_ops'             (attendance/leave/regularisation/payroll/onboarding) = Deepanshi
// excludeIds keeps us from routing a person's own review back to them.
async function getHrOwnerForArea(area, excludeIds) {
  if (!area) return null;
  const ex = (excludeIds || []).filter(Boolean);
  try {
    const r = await db.query(
      `SELECT ug.user_id
         FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
         JOIN users u ON u.id = ug.user_id
        WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'
          AND u.hr_area = $1
          AND ($2::int[] IS NULL OR ug.user_id <> ALL($2::int[]))
        ORDER BY ug.user_id ASC
        LIMIT 1`,
      [area, ex.length ? ex : null]
    );
    return r.rows.length > 0 ? r.rows[0].user_id : null;
  } catch (e) {
    console.error('[lifecycle.getHrOwnerForArea] failed:', e.message);
    return null;
  }
}

// ---------- Orchestrator routing ----------
// Route by hr_area first (so reviews land on the judgement owner, not whoever
// sorts first). Fall back to the first active hr-team member so nothing is ever
// dropped when an area owner isn't set.
async function getOrchestratorFor(userId, reviewerUserId, area) {
  if (area) {
    const owner = await getHrOwnerForArea(area, [userId, reviewerUserId]);
    if (owner) return owner;
  }
  try {
    const r = await db.query(
      `SELECT ug.user_id
         FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
         JOIN users u ON u.id = ug.user_id
        WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'
          AND ug.user_id <> $1
          AND ($2::int IS NULL OR ug.user_id <> $2)
        ORDER BY ug.user_id ASC
        LIMIT 1`,
      [userId, reviewerUserId || null]
    );
    if (r.rows.length > 0) return r.rows[0].user_id;
    return null;
  } catch (e) {
    console.error('[lifecycle.getOrchestratorFor] failed:', e.message);
    return null;
  }
}

// ---------- Review titles for tasks ----------
const REVIEW_TYPE_LABELS = {
  '1_month': '1-month review',
  '4_month': '4-month review (probation decision)',
  '8_month': '8-month review',
  'annual':  'Annual review',
  'ad_hoc':  'Ad-hoc review',
};

function reviewTypeLabel(reviewType) {
  return REVIEW_TYPE_LABELS[reviewType] || 'Review';
}

// ---------- Schedule generation ----------
// Given a hire_date, build the array of review records to create.
// Annual reviews are generated for 5 years out; the cron will continue
// scheduling future annuals as each annual completes.

function buildScheduleForHireDate(hireDate) {
  const hd = parseDate(hireDate);
  const schedule = [];
  schedule.push({ type: '1_month', date: isoDate(addMonths(hd, 1))  });
  schedule.push({ type: '4_month', date: isoDate(addMonths(hd, 4))  });
  schedule.push({ type: '8_month', date: isoDate(addMonths(hd, 8))  });
  // Annual reviews: anniversary date each year. Generate 5 years' worth up front.
  for (let yr = 1; yr <= 5; yr++) {
    schedule.push({ type: 'annual', date: isoDate(addYears(hd, yr)) });
  }
  return schedule;
}

// ---------- Create review records + tasks for a user ----------
// Idempotent: skips any review_type that already exists for the user
//             (so re-running on existing users won't duplicate).
async function generateReviewSchedule(userId, opts) {
  opts = opts || {};
  const silent = opts.silent === true; // skip notifications

  const u = await db.query(
    `SELECT id, hire_date, full_name, display_name, employment_status
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (u.rows.length === 0) return { created: 0, error: 'User not found' };
  const user = u.rows[0];
  if (!user.hire_date) return { created: 0, error: 'No hire_date set' };
  if (user.employment_status === 'left') return { created: 0, error: 'User has left' };

  const reviewerUserId = await getReviewerFor(userId);
  if (!reviewerUserId) {
    console.warn('[lifecycle] no reviewer for user', userId);
  }
  // Reviews (probation / appraisal) are judgement work → route to the
  // recruitment_judgement owner (Tanu), falling back to any HR member.
  const orchestratorUserId = await getOrchestratorFor(userId, reviewerUserId, 'recruitment_judgement');

  const schedule = buildScheduleForHireDate(user.hire_date);
  const settings = await getSettings();

  let created = 0;
  for (const entry of schedule) {
    // Skip if already exists for this user + type + date (idempotent)
    const existing = await db.query(
      `SELECT id FROM profile_notes
        WHERE user_id = $1 AND kind = 'review' AND review_type = $2
          AND review_date = $3`,
      [userId, entry.type, entry.date]
    );
    if (existing.rows.length > 0) continue;

    // Create the review record (scheduled state)
    const noteIns = await db.query(
      `INSERT INTO profile_notes
         (user_id, kind, title, body, is_completed, author_user_id,
          review_type, review_date, status)
       VALUES ($1, 'review', $2, NULL, FALSE, $3, $4, $5, 'scheduled')
       RETURNING id`,
      [
        userId,
        reviewTypeLabel(entry.type),
        reviewerUserId || orchestratorUserId || userId, // author = best available
        entry.type,
        entry.date,
      ]
    );
    const noteId = noteIns.rows[0].id;
    created++;

    // Create tasks: one for reviewer, one for orchestrator.
    // opens_at = review_date - open_window_days at 09:00 London
    // due_at   = review_date at 17:00 London
    const reviewDate = parseDate(entry.date);
    const opensAt = addDaysToDate(reviewDate, -settings.review_open_window_days);
    const dueAt = reviewDate;
    // Persist as the start of the day in UTC — the cron resolves windows in London.
    const opensIso = isoDate(opensAt) + 'T09:00:00Z';
    const dueIso   = isoDate(dueAt)   + 'T17:00:00Z';

    const title = reviewTypeLabel(entry.type) + ' for ' + (user.display_name || user.full_name);

    if (reviewerUserId) {
      await db.query(
        `INSERT INTO tasks
           (kind, source, related_user_id, related_profile_note_id, assignee_user_id,
            reason, title, body, opens_at, due_at, status)
         VALUES ('review', 'cron', $1, $2, $3, 'reviewer', $4,
                 $5, $6, $7, 'pending')`,
        [userId, noteId, reviewerUserId, title,
         'Open the profile, fill in the review status and notes.',
         opensIso, dueIso]
      );
    }
    if (orchestratorUserId && orchestratorUserId !== reviewerUserId) {
      await db.query(
        `INSERT INTO tasks
           (kind, source, related_user_id, related_profile_note_id, assignee_user_id,
            reason, title, body, opens_at, due_at, status)
         VALUES ('review', 'cron', $1, $2, $3, 'orchestrator', $4,
                 $5, $6, $7, 'pending')`,
        [userId, noteId, orchestratorUserId, title,
         'Make sure this review happens. Arrange with the reviewer.',
         opensIso, dueIso]
      );
    }
  }

  return { created, reviewerUserId, orchestratorUserId };
}

function addDaysToDate(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ---------- Apply onboarding template to a new hire ----------
// Copies all active rows from onboarding_templates to profile_notes for this user.
async function applyOnboardingTemplate(userId, createdByUserId) {
  try {
    const tmpls = await db.query(
      `SELECT title, body, sort_order FROM onboarding_templates
        WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC`
    );
    let count = 0;
    for (const t of tmpls.rows) {
      // Idempotent: skip if a row with same title already exists for this user
      const existing = await db.query(
        `SELECT id FROM profile_notes
          WHERE user_id = $1 AND kind = 'onboarding' AND title = $2`,
        [userId, t.title]
      );
      if (existing.rows.length > 0) continue;
      await db.query(
        `INSERT INTO profile_notes (user_id, kind, title, body, author_user_id)
         VALUES ($1, 'onboarding', $2, $3, $4)`,
        [userId, t.title, t.body, createdByUserId || userId]
      );
      count++;
    }
    return count;
  } catch (e) {
    console.error('[lifecycle.applyOnboardingTemplate] failed:', e.message);
    return 0;
  }
}

// ---------- Cancel all open tasks for a user (on leave) ----------
async function cancelTasksForUser(userId, reason) {
  try {
    const r = await db.query(
      `UPDATE tasks SET status = 'cancelled',
                        cancelled_at = NOW(),
                        cancel_reason = $1,
                        updated_at = NOW()
        WHERE related_user_id = $2
          AND status NOT IN ('done','cancelled')
        RETURNING id`,
      [reason || 'user_left', userId]
    );
    return r.rows.length;
  } catch (e) {
    console.error('[lifecycle.cancelTasksForUser] failed:', e.message);
    return 0;
  }
}

// ---------- Mark a review complete + close its tasks ----------
async function completeReview(profileNoteId, completedByUserId) {
  try {
    // Close any open tasks tied to this review (reviewer + orchestrator).
    await db.query(
      `UPDATE tasks SET status = 'done',
                        completed_at = NOW(),
                        completed_by_user_id = $1,
                        updated_at = NOW()
        WHERE related_profile_note_id = $2
          AND status NOT IN ('done','cancelled')`,
      [completedByUserId, profileNoteId]
    );
    // Also flag the review row itself
    await db.query(
      `UPDATE profile_notes SET is_completed = TRUE,
                                completed_at = NOW(),
                                completed_by_user_id = $1,
                                updated_at = NOW()
        WHERE id = $2`,
      [completedByUserId, profileNoteId]
    );
  } catch (e) {
    console.error('[lifecycle.completeReview] failed:', e.message);
  }
}

// ---------- Cron tick: promote task states + nudge ----------
async function tickTasks() {
  const settings = await getSettings();
  const now = new Date();
  const nowIso = now.toISOString();
  const graceMs = settings.review_grace_days * 24 * 60 * 60 * 1000;
  const nudgeMs = settings.review_nudge_interval_days * 24 * 60 * 60 * 1000;
  const overdueCutoff = new Date(now.getTime() - graceMs).toISOString();

  // pending → open  (opens_at <= now)
  const opened = await db.query(
    `UPDATE tasks SET status = 'open', updated_at = NOW()
      WHERE status = 'pending' AND opens_at <= $1
      RETURNING id, kind, assignee_user_id, related_user_id,
                related_profile_note_id, title, reason`,
    [nowIso]
  );
  for (const t of opened.rows) {
    await fireTaskNotification(t, 'opened');
  }

  // open → due  (due_at <= now, status still open)
  const dued = await db.query(
    `UPDATE tasks SET status = 'due', updated_at = NOW()
      WHERE status = 'open' AND due_at <= $1
      RETURNING id, kind, assignee_user_id, related_user_id,
                related_profile_note_id, title, reason`,
    [nowIso]
  );
  for (const t of dued.rows) {
    await fireTaskNotification(t, 'due');
  }

  // due → overdue  (due_at <= now - grace)
  const overdued = await db.query(
    `UPDATE tasks SET status = 'overdue',
                       last_nudged_at = NOW(),
                       updated_at = NOW()
      WHERE status = 'due' AND due_at <= $1
      RETURNING id, kind, assignee_user_id, related_user_id,
                related_profile_note_id, title, reason`,
    [overdueCutoff]
  );
  for (const t of overdued.rows) {
    await fireTaskNotification(t, 'overdue');
  }

  // Re-nudge: status=overdue and last_nudged_at < now - nudgeInterval
  const reNudgeCutoff = new Date(now.getTime() - nudgeMs).toISOString();
  const reNudged = await db.query(
    `UPDATE tasks SET last_nudged_at = NOW(), updated_at = NOW()
      WHERE status = 'overdue'
        AND (last_nudged_at IS NULL OR last_nudged_at <= $1)
      RETURNING id, kind, assignee_user_id, related_user_id,
                related_profile_note_id, title, reason`,
    [reNudgeCutoff]
  );
  for (const t of reNudged.rows) {
    await fireTaskNotification(t, 'overdue_nudge');
  }

  return {
    opened: opened.rows.length,
    dued: dued.rows.length,
    overdued: overdued.rows.length,
    reNudged: reNudged.rows.length,
  };
}

async function fireTaskNotification(task, stage) {
  // stage: 'opened' | 'due' | 'overdue' | 'overdue_nudge'
  const eventType =
    stage === 'opened' ? 'task.opened'
    : stage === 'due'  ? 'task.due'
    : 'task.overdue';
  await notifyEvent(eventType, {
    targetUserId: task.assignee_user_id,
    taskTitle: task.title,
    relatedUserId: task.related_user_id,
    reason: task.reason,
    related_id: task.id,
  });
}

// ---------- Cron tick: probation end nudge ----------
// Fires a notification to HR + owner when a user's probation_end_date is reached,
// IF they're still in 'in_probation' or 'probation_pass_expected' state.
// Idempotent — uses a once-per-user marker in audit_log to avoid double-firing.
async function tickProbationNudges() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Find users whose probation_end_date is today or earlier and who still
    // need a decision (in_probation or probation_pass_expected).
    const due = await db.query(
      `SELECT u.id, u.full_name, u.display_name, u.probation_end_date, u.probation_status
         FROM users u
        WHERE u.deleted_at IS NULL
          AND u.employment_status = 'active'
          AND u.probation_end_date IS NOT NULL
          AND u.probation_end_date <= CURRENT_DATE
          AND u.probation_status IN ('in_probation','probation_pass_expected')
          -- Skip those already nudged today
          AND NOT EXISTS (
            SELECT 1 FROM audit_log a
             WHERE a.module = 'lifecycle' AND a.action = 'probation.nudge'
               AND a.target_id = u.id::text
               AND a.occurred_at::date = CURRENT_DATE
          )`
    );
    if (due.rows.length === 0) return { nudged: 0 };

    // Resolve HR + owner targets
    const targets = await db.query(
      `SELECT DISTINCT ug.user_id
         FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
         JOIN users u ON u.id = ug.user_id
        WHERE g.slug IN ('hr-team','owner') AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'`
    );
    const targetIds = targets.rows.map(r => r.user_id);

    let nudged = 0;
    for (const user of due.rows) {
      for (const tid of targetIds) {
        if (tid === user.id) continue; // skip self
        await notifyEvent('probation.end_due', {
          targetUserId: tid,
          subjectUserId: user.id,
          subjectName: user.display_name || user.full_name,
        });
      }
      await db.query(
        `INSERT INTO audit_log (module, action, target_type, target_id, details)
         VALUES ('lifecycle', 'probation.nudge', 'user', $1, $2)`,
        [String(user.id), 'Probation end date reached, awaiting HR decision']
      );
      nudged++;
    }
    return { nudged };
  } catch (e) {
    console.error('[lifecycle.tickProbationNudges] failed:', e.message);
    return { nudged: 0, error: e.message };
  }
}

// r0.14 — Birthday pre-notify. Runs daily; finds active employees whose
// birthday (month+day) is TOMORROW and notifies HR once. De-duped via a
// guard on the notifications table (related_type='birthday' same day).
async function tickBirthdayNudges() {
  try {
    // "Tomorrow" in London time, as month/day.
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const parts = fmt.formatToParts(tomorrow);
    const get = t => parts.find(p => p.type === t).value;
    const tmMonth = get('month'); // '01'..'12'
    const tmDay = get('day');     // '01'..'31'
    const tmYear = parseInt(get('year'), 10);

    const rows = await db.query(
      `SELECT id, full_name, display_name, date_of_birth
         FROM users
        WHERE deleted_at IS NULL
          AND employment_status = 'active'
          AND date_of_birth IS NOT NULL
          AND to_char(date_of_birth, 'MM') = $1
          AND to_char(date_of_birth, 'DD') = $2`,
      [tmMonth, tmDay]
    );

    let nudged = 0;
    for (const u of rows.rows) {
      // De-dupe: skip if we already fired a birthday notice referencing this
      // user within the last 20 hours.
      const dup = await db.query(
        `SELECT 1 FROM notifications
          WHERE related_type = 'birthday' AND related_user_id = $1
            AND created_at > NOW() - INTERVAL '20 hours' LIMIT 1`,
        [u.id]
      );
      if (dup.rows.length > 0) continue;

      const dob = new Date(u.date_of_birth);
      const age = tmYear - dob.getUTCFullYear();
      const name = u.display_name || u.full_name || 'An employee';
      const dateText = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', day: 'numeric', month: 'long'
      }).format(tomorrow);

      await notifyEvent('birthday.upcoming', {
        name, age, dateText,
        targetUserId: u.id,      // related_user_id on the notification
        related_id: u.id,
      });
      nudged++;
    }
    return { nudged, candidates: rows.rows.length };
  } catch (e) {
    console.error('[lifecycle.tickBirthdayNudges] failed:', e.message);
    return { nudged: 0, error: e.message };
  }
}

module.exports = {
  // routing
  getReviewerFor, getOrchestratorFor,
  // schedule
  buildScheduleForHireDate, generateReviewSchedule,
  // onboarding
  applyOnboardingTemplate,
  // lifecycle
  cancelTasksForUser, completeReview,
  // cron
  tickTasks, tickProbationNudges, tickBirthdayNudges,
  // settings
  getSettings, invalidateSettings,
};
