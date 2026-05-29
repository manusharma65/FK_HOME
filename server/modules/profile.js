// FK Home — /api/profile/*
// ----------------------------------------------------------------------------
// Routes:
//   GET    /api/profile/:userId/overview                — header + drawer fill summary
//   GET    /api/profile/:userId/drawer/:drawer          — files + structured data
//   GET    /api/profile/:userId/drawer/:drawer/deleted  — soft-deleted files
//   PUT    /api/profile/:userId/salary                  — owner-only salary edit
//   GET    /api/profile/:userId/salary/history          — past salary changes via audit_log
//   POST   /api/profile/:userId/notes                   — add performance/appraisal/onboarding note
//   PATCH  /api/profile/:userId/notes/:noteId           — edit / mark complete
//   DELETE /api/profile/:userId/notes/:noteId           — remove

const express = require('express');
const { db } = require('../db');
const { requireAuth, logAudit } = require('../auth');
const { notifyEvent } = require('../notify');
const lifecycle = require('./lifecycle');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_DRAWERS = new Set([
  'onboarding','reviews','employment','salary',
  'payroll','insurance','personal',
]);
const NOTE_KINDS = new Set(['review','onboarding']);
const NOTE_KIND_LABELS = { review: 'review', onboarding: 'onboarding' };
const DRAWER_ORDER = ['onboarding','reviews','employment','salary','payroll','insurance','personal'];

// ---------- helpers ----------
async function isSameDept(viewerId, targetUserId) {
  const r = await db.query(
    `SELECT 1 FROM user_department_memberships m1
     JOIN user_department_memberships m2 ON m1.department_id = m2.department_id
     WHERE m1.user_id = $1 AND m2.user_id = $2
       AND m1.deleted_at IS NULL AND m2.deleted_at IS NULL
     LIMIT 1`,
    [viewerId, targetUserId]
  );
  return r.rows.length > 0;
}

async function canViewProfile(viewer, targetUserId) {
  if (viewer.id === targetUserId && viewer.can('profile.view.own')) return true;
  if (viewer.can('profile.view.any')) return true;
  if (viewer.can('profile.view.dept') && await isSameDept(viewer.id, targetUserId)) return true;
  return false;
}

// Which drawers can THIS viewer see for THIS target?
async function visibleDrawers(viewer, targetUserId) {
  const drawers = new Set();
  const isOwn = viewer.id === targetUserId;
  const hasAny = viewer.can('profile.view.any');
  const hasDept = viewer.can('profile.view.dept');
  const sameDept = hasDept && !hasAny ? await isSameDept(viewer.id, targetUserId) : true;
  const canSeeDept = hasAny || (hasDept && sameDept);

  if (isOwn || canSeeDept) {
    // Everyone with view rights can see these
    drawers.add('onboarding');
    drawers.add('reviews');
    drawers.add('employment');
    drawers.add('payroll');
    drawers.add('insurance');
    drawers.add('personal');
  }
  if (viewer.can('profile.salary.view') || viewer.can('profile.salary.edit')) {
    drawers.add('salary');
  }
  return DRAWER_ORDER.filter(d => drawers.has(d));
}

// ---------- GET /api/profile/:userId/overview ----------
router.get('/:userId/overview', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });

  const allowed = await canViewProfile(req.user, userId);
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  try {
    const u = await db.query(
      `SELECT u.id, u.email, u.full_name, u.display_name, u.initials,
              u.avatar_colour, u.phone, u.personal_address, u.date_of_birth,
              u.hire_date, u.employment_status,
              u.employment_type, u.work_pattern, u.probation_end_date,
              u.probation_status, u.left_date,
              u.notice_period_days, u.emergency_contact,
              s.status, s.status_note,
              (SELECT json_agg(json_build_object('slug', d.slug, 'name', d.name, 'role', m.role))
                 FROM user_department_memberships m
                 JOIN departments d ON d.id = m.department_id
                 WHERE m.user_id = u.id AND m.deleted_at IS NULL AND d.deleted_at IS NULL) AS departments,
              (SELECT json_agg(g.slug)
                 FROM user_groups ug JOIN groups g ON g.id = ug.group_id
                 WHERE ug.user_id = u.id AND g.deleted_at IS NULL) AS group_slugs
       FROM users u
       LEFT JOIN user_status s ON s.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId]
    );
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const drawers = await visibleDrawers(req.user, userId);

    // r0.12 — Redact date_of_birth for viewers who shouldn't see it.
    // Visible to: the user themselves, anyone with profile.view.any (HR + owner).
    const canSeeDob =
      req.user.id === userId ||
      req.user.can('profile.view.any');
    if (!canSeeDob) {
      u.rows[0].date_of_birth = null;
    }

    // Drawer fill summary.
    // Map review/onboarding counts to their drawer names so the UI can show
    // the right badges.
    const counts = {};
    const fileCounts = await db.query(
      `SELECT drawer, COUNT(*)::int AS n FROM files
       WHERE user_id = $1 AND deleted_at IS NULL
       GROUP BY drawer`,
      [userId]
    );
    for (const row of fileCounts.rows) counts[row.drawer] = row.n;

    const noteCounts = await db.query(
      `SELECT kind, COUNT(*)::int AS n,
              SUM(CASE WHEN is_completed THEN 1 ELSE 0 END)::int AS completed
       FROM profile_notes
       WHERE user_id = $1
       GROUP BY kind`,
      [userId]
    );
    for (const row of noteCounts.rows) {
      const drawerKey = row.kind === 'review' ? 'reviews' : 'onboarding';
      counts[drawerKey] = (counts[drawerKey] || 0) + row.n;
      // Track completion for onboarding so UI can show "x of y done"
      if (row.kind === 'onboarding') {
        counts.__onboarding_completed = row.completed || 0;
        counts.__onboarding_total = row.n;
      }
    }

    res.json({
      user: u.rows[0],
      drawers,
      counts,
      viewer: {
        user_id: req.user.id,
        can_edit_any: req.user.can('profile.edit.any'),
        can_edit_dept: req.user.can('profile.edit.dept'),
        can_view_salary: req.user.can('profile.salary.view'),
        can_edit_salary: req.user.can('profile.salary.edit'),
        can_upload_any: req.user.can('files.upload.any'),
        can_upload_own: req.user.can('files.upload.own'),
        can_delete_any: req.user.can('files.delete.any'),
        can_complete_reviews: req.user.can('reviews.complete'),
        can_schedule_reviews: req.user.can('reviews.schedule'),
        can_manage_probation: req.user.can('probation.manage'),
        can_reset_password: req.user.can('admin.users.reset_password'),
        is_self: req.user.id === userId,
      },
    });
  } catch (e) {
    console.error('[profile/overview] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/profile/:userId/drawer/:drawer ----------
router.get('/:userId/drawer/:drawer', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const drawer = req.params.drawer;
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });
  if (!ALLOWED_DRAWERS.has(drawer)) return res.status(400).json({ error: 'Unknown drawer' });

  const drawers = await visibleDrawers(req.user, userId);
  if (!drawers.includes(drawer)) return res.status(403).json({ error: 'Permission denied' });

  try {
    const out = { drawer, files: [], notes: [], salary: null };
    // Files
    const f = await db.query(
      `SELECT id, filename, mime_type, size_bytes, description,
              uploaded_by_user_id,
              (SELECT COALESCE(display_name, full_name) FROM users WHERE id = files.uploaded_by_user_id) AS uploaded_by_name,
              uploaded_at
       FROM files
       WHERE user_id = $1 AND drawer = $2 AND deleted_at IS NULL
       ORDER BY uploaded_at DESC`,
      [userId, drawer]
    );
    out.files = f.rows;

    // Notes — reviews + onboarding (the two kinds in r0.10)
    if (drawer === 'reviews' || drawer === 'onboarding') {
      const kind = drawer === 'reviews' ? 'review' : 'onboarding';
      const n = await db.query(
        `SELECT n.id, n.title, n.body, n.is_completed, n.completed_at,
                n.completed_by_user_id,
                n.review_type, n.review_date, n.status,
                n.cancelled_at, n.cancelled_by, n.cancel_reason,
                (SELECT COALESCE(display_name, full_name) FROM users WHERE id = n.completed_by_user_id) AS completed_by_name,
                n.author_user_id,
                (SELECT COALESCE(display_name, full_name) FROM users WHERE id = n.author_user_id) AS author_name,
                n.created_at, n.updated_at,
                -- r0.11 — reviewer's name (resolved from the active reviewer task)
                (SELECT COALESCE(u.display_name, u.full_name)
                   FROM tasks t JOIN users u ON u.id = t.assignee_user_id
                  WHERE t.related_profile_note_id = n.id
                    AND t.reason = 'reviewer'
                    AND t.status NOT IN ('cancelled')
                  ORDER BY t.id DESC LIMIT 1) AS reviewer_name,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', f.id, 'filename', f.filename, 'mime_type', f.mime_type,
                    'size_bytes', f.size_bytes, 'uploaded_at', f.uploaded_at,
                    'uploaded_by_user_id', f.uploaded_by_user_id
                  ) ORDER BY f.uploaded_at DESC)
                  FROM files f
                  WHERE f.profile_note_id = n.id AND f.deleted_at IS NULL
                ), '[]'::json) AS attached_files
         FROM profile_notes n
         WHERE n.user_id = $1 AND n.kind = $2
         ORDER BY
           CASE WHEN n.review_date IS NOT NULL THEN n.review_date::timestamptz
                ELSE n.created_at END ASC`,
        [userId, kind]
      );
      out.notes = n.rows;
    }

    // Salary structure
    if (drawer === 'salary') {
      const s = await db.query(
        `SELECT s.user_id, s.monthly_ctc, s.currency, s.effective_from,
                s.deduction_1_label, s.deduction_1_amount,
                s.deduction_2_label, s.deduction_2_amount,
                s.deduction_3_label, s.deduction_3_amount,
                s.notes, s.updated_by_user_id,
                (SELECT COALESCE(display_name, full_name) FROM users WHERE id = s.updated_by_user_id) AS updated_by_name,
                s.updated_at
         FROM salary_structures s WHERE s.user_id = $1`,
        [userId]
      );
      out.salary = s.rows[0] || null;
    }

    res.json(out);
  } catch (e) {
    console.error('[profile/drawer] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/profile/:userId/drawer/:drawer/deleted ----------
router.get('/:userId/drawer/:drawer/deleted', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const drawer = req.params.drawer;
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });
  if (!ALLOWED_DRAWERS.has(drawer)) return res.status(400).json({ error: 'Unknown drawer' });

  // Only viewers who can DELETE files can see the recycle bin
  const isOwn = req.user.id === userId;
  if (!req.user.can('files.delete.any') && !(isOwn && drawer === 'personal')) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  try {
    const r = await db.query(
      `SELECT id, filename, mime_type, size_bytes, deleted_at,
              deleted_by_user_id,
              (SELECT COALESCE(display_name, full_name) FROM users WHERE id = files.deleted_by_user_id) AS deleted_by_name
       FROM files
       WHERE user_id = $1 AND drawer = $2 AND deleted_at IS NOT NULL
         AND deleted_at > NOW() - INTERVAL '90 days'
       ORDER BY deleted_at DESC`,
      [userId, drawer]
    );
    res.json({ files: r.rows });
  } catch (e) {
    console.error('[profile/deleted] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- PUT /api/profile/:userId/salary ----------
router.put('/:userId/salary', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });
  if (!req.user.can('profile.salary.edit')) return res.status(403).json({ error: 'Permission denied' });

  const {
    monthly_ctc, currency, effective_from,
    deduction_1_label, deduction_1_amount,
    deduction_2_label, deduction_2_amount,
    deduction_3_label, deduction_3_amount,
    notes,
  } = req.body || {};

  if (monthly_ctc == null || isNaN(Number(monthly_ctc))) {
    return res.status(400).json({ error: 'monthly_ctc must be a number' });
  }
  if (!effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
    return res.status(400).json({ error: 'effective_from must be YYYY-MM-DD' });
  }
  const cur = (currency || 'INR').trim().toUpperCase().slice(0, 3);

  try {
    const before = await db.query(`SELECT * FROM salary_structures WHERE user_id = $1`, [userId]);
    const newRow = {
      monthly_ctc: Number(monthly_ctc),
      currency: cur,
      effective_from,
      deduction_1_label: deduction_1_label || null,
      deduction_1_amount: Number(deduction_1_amount || 0),
      deduction_2_label: deduction_2_label || null,
      deduction_2_amount: Number(deduction_2_amount || 0),
      deduction_3_label: deduction_3_label || null,
      deduction_3_amount: Number(deduction_3_amount || 0),
      notes: notes || null,
    };

    await db.query(
      `INSERT INTO salary_structures (user_id, monthly_ctc, currency, effective_from,
         deduction_1_label, deduction_1_amount,
         deduction_2_label, deduction_2_amount,
         deduction_3_label, deduction_3_amount,
         notes, updated_by_user_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         monthly_ctc = EXCLUDED.monthly_ctc,
         currency = EXCLUDED.currency,
         effective_from = EXCLUDED.effective_from,
         deduction_1_label = EXCLUDED.deduction_1_label,
         deduction_1_amount = EXCLUDED.deduction_1_amount,
         deduction_2_label = EXCLUDED.deduction_2_label,
         deduction_2_amount = EXCLUDED.deduction_2_amount,
         deduction_3_label = EXCLUDED.deduction_3_label,
         deduction_3_amount = EXCLUDED.deduction_3_amount,
         notes = EXCLUDED.notes,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = NOW()`,
      [userId, newRow.monthly_ctc, newRow.currency, newRow.effective_from,
       newRow.deduction_1_label, newRow.deduction_1_amount,
       newRow.deduction_2_label, newRow.deduction_2_amount,
       newRow.deduction_3_label, newRow.deduction_3_amount,
       newRow.notes, req.user.id]
    );

    // Audit log — full before/after (this IS the salary history)
    await logAudit({
      req, module: 'profile', action: 'salary.changed',
      target_type: 'user', target_id: userId,
      before: before.rows[0] || null,
      after: newRow,
    });

    // NO notification — salary changes are sensitive.

    res.json({ ok: true });
  } catch (e) {
    console.error('[profile/salary] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/profile/:userId/salary/history ----------
router.get('/:userId/salary/history', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });
  if (!req.user.can('profile.salary.view') && !req.user.can('profile.salary.edit')) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  try {
    const r = await db.query(
      `SELECT id, occurred_at, actor_user_id, actor_name, before_data, after_data
       FROM audit_log
       WHERE module = 'profile' AND action = 'salary.changed' AND target_id = $1
       ORDER BY occurred_at DESC
       LIMIT 50`,
      [String(userId)]
    );
    res.json({ history: r.rows });
  } catch (e) {
    console.error('[profile/salary/history] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/profile/:userId/notes ----------
// Body: { kind: 'review' | 'onboarding', title, body?,
//         review_type?, review_date?, status? }
// For reviews, the review_type and review_date are required.
// For onboarding, only title (and optional body) needed.
router.post('/:userId/notes', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });

  const { kind, title, body, review_type, review_date, status } = req.body || {};
  if (!NOTE_KINDS.has(kind)) return res.status(400).json({ error: 'Bad kind' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });

  // Reviews need extra fields
  if (kind === 'review') {
    if (!['1_month','4_month','8_month','annual','ad_hoc'].includes(review_type)) {
      return res.status(400).json({ error: 'Invalid review_type' });
    }
    if (!review_date || !/^\d{4}-\d{2}-\d{2}$/.test(review_date)) {
      return res.status(400).json({ error: 'review_date must be YYYY-MM-DD' });
    }
  }

  // Permission
  let allowed = req.user.can('profile.edit.any');
  if (!allowed && req.user.can('profile.edit.dept')) {
    allowed = await isSameDept(req.user.id, userId);
  }
  // Scheduling ad-hoc reviews needs reviews.schedule
  if (kind === 'review' && review_type === 'ad_hoc' && !req.user.can('reviews.schedule') && !allowed) {
    return res.status(403).json({ error: 'Cannot schedule reviews' });
  }
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  try {
    const r = await db.query(
      `INSERT INTO profile_notes
         (user_id, kind, title, body, author_user_id,
          review_type, review_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, kind, title.trim().slice(0, 200), body || null, req.user.id,
       kind === 'review' ? review_type : null,
       kind === 'review' ? review_date : null,
       kind === 'review' ? (status || 'scheduled') : null]
    );
    await logAudit({
      req, module: 'profile', action: 'note.added',
      target_type: 'profile_note', target_id: r.rows[0].id,
      after: { user_id: userId, kind, title: r.rows[0].title, review_type, review_date }
    });
    if (userId !== req.user.id) {
      await notifyEvent('profile.note.added', {
        targetUserId: userId,
        authorName: req.user.display_name || req.user.full_name,
        kind,
        kindLabel: NOTE_KIND_LABELS[kind] || kind,
        noteTitle: r.rows[0].title,
        related_id: r.rows[0].id,
      });
    }
    res.json({ ok: true, note: r.rows[0] });
  } catch (e) {
    console.error('[profile/notes/add] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- PATCH /api/profile/:userId/notes/:noteId ----------
// Accepted body fields:
//   - title, body                — text edits
//   - is_completed                — onboarding tick (or any explicit completion)
//   - review_date                 — reschedule a review (reviews.schedule perm)
//   - status                      — for reviews; setting to a FINAL value completes it
//     · 1_month/8_month/annual    — needs_improvement | satisfactory | good
//     · 4_month                   — pass | extend | fail
//     · all                       — scheduled (resets), final values trigger completion
router.patch('/:userId/notes/:noteId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const noteId = parseInt(req.params.noteId, 10);
  if (!Number.isFinite(userId) || !Number.isFinite(noteId)) return res.status(400).json({ error: 'Bad id' });

  const { title, body, is_completed, status, review_date } = req.body || {};

  // Load current state to know what we're changing
  const cur = await db.query(`SELECT * FROM profile_notes WHERE id = $1 AND user_id = $2`, [noteId, userId]);
  if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  const c = cur.rows[0];

  // Permission logic — varies by what's being changed
  let allowed = req.user.can('profile.edit.any');
  if (!allowed && req.user.can('profile.edit.dept')) {
    allowed = await isSameDept(req.user.id, userId);
  }
  // Onboarding ticks: the user themselves can mark their own onboarding items complete
  if (!allowed && req.user.id === userId && c.kind === 'onboarding'
      && is_completed != null && title == null && body == null && status == null) {
    allowed = true;
  }
  // Review completion (status change): needs reviews.complete OR profile.edit.* above
  if (!allowed && status != null && c.kind === 'review' && req.user.can('reviews.complete')) {
    // Reviewer can complete reviews even if they don't have profile.edit.* on this user
    allowed = true;
  }
  // Reschedule (review_date change for review): needs reviews.schedule
  if (!allowed && review_date != null && c.kind === 'review' && req.user.can('reviews.schedule')) {
    allowed = true;
  }
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  // Validate status for reviews
  // r0.16: Monday-style outcomes apply uniformly across all review types.
  // Legacy outcomes (pass/extend/fail/satisfactory/good) are still accepted
  // for backward-compat with rows created before r0.16.
  if (status != null && c.kind === 'review') {
    const mondayOutcomes = ['scheduled','needs_improvement','passed','excellent','salary_reviewed','in_process'];
    const legacyOutcomes = ['pass','extend','fail','satisfactory','good']; // pre-r0.16
    const allowedStatuses = [...mondayOutcomes, ...legacyOutcomes];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status for review' });
    }
  }
  if (review_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(review_date)) {
    return res.status(400).json({ error: 'review_date must be YYYY-MM-DD' });
  }

  try {
    const newTitle = title != null ? String(title).slice(0, 200) : c.title;
    const newBody = body != null ? body : c.body;
    const newReviewDate = review_date != null ? review_date : c.review_date;
    const newStatus = status != null ? status : c.status;

    // is_completed handling
    // For reviews: completed when status is set to a non-'scheduled' value
    // For onboarding: completed when is_completed is explicitly toggled
    let newCompleted = c.is_completed;
    let newCompletedAt = c.completed_at;
    let newCompletedBy = c.completed_by_user_id;
    let reviewWasCompletedNow = false;

    if (c.kind === 'review' && status != null) {
      const isFinal = status !== 'scheduled';
      newCompleted = isFinal;
      if (isFinal && !c.is_completed) {
        newCompletedAt = new Date().toISOString();
        newCompletedBy = req.user.id;
        reviewWasCompletedNow = true;
      } else if (!isFinal) {
        newCompletedAt = null;
        newCompletedBy = null;
      }
    }
    if (c.kind === 'onboarding' && is_completed != null) {
      newCompleted = !!is_completed;
      newCompletedAt = newCompleted ? new Date().toISOString() : null;
      newCompletedBy = newCompleted ? req.user.id : null;
    }

    const r = await db.query(
      `UPDATE profile_notes
         SET title = $1, body = $2, is_completed = $3,
             completed_at = $4, completed_by_user_id = $5,
             review_date = $6, status = $7,
             updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [newTitle, newBody, newCompleted, newCompletedAt, newCompletedBy,
       newReviewDate, newStatus, noteId]
    );

    await logAudit({
      req, module: 'profile', action: 'note.updated',
      target_type: 'profile_note', target_id: noteId,
      before: { is_completed: c.is_completed, title: c.title, status: c.status, review_date: c.review_date },
      after:  { is_completed: newCompleted, title: newTitle, status: newStatus, review_date: newReviewDate }
    });

    // ---------- Side effects ----------

    // Review just got completed: close its tasks + maybe update probation
    if (reviewWasCompletedNow) {
      await lifecycle.completeReview(noteId, req.user.id);

      // 4-month probation decision flow
      if (c.review_type === '4_month') {
        // r0.16 — map both legacy and Monday outcomes
        if (status === 'pass' || status === 'passed') {
          // r0.11 — Flip to "on track" state. HR confirms at 6 months.
          await db.query(
            `UPDATE users SET probation_status = 'probation_pass_expected',
                              updated_at = NOW()
              WHERE id = $1`,
            [userId]);
        } else if (status === 'extend' || status === 'needs_improvement') {
          // Push probation_end_date forward by another 3 months from now
          await db.query(
            `UPDATE users SET probation_status = 'extended',
                              probation_end_date = CURRENT_DATE + INTERVAL '3 months',
                              updated_at = NOW()
              WHERE id = $1`,
            [userId]);
        } else if (status === 'fail') {
          await db.query(
            `UPDATE users SET probation_status = 'failed', updated_at = NOW()
              WHERE id = $1`, [userId]);
        }
      }
    }

    // Onboarding complete notification → HR
    if (c.kind === 'onboarding' && !c.is_completed && newCompleted) {
      const hr = await db.query(
        `SELECT ug.user_id FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
         WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL`
      );
      const target = await db.query(`SELECT COALESCE(display_name, full_name) AS name FROM users WHERE id = $1`, [userId]);
      await notifyEvent('profile.onboarding.completed', {
        targetUserId: userId,
        targetName: target.rows[0] ? target.rows[0].name : 'user',
        completerName: req.user.display_name || req.user.full_name,
        noteTitle: newTitle,
        hrUserIds: hr.rows.map(x => x.user_id),
        related_id: noteId,
      });
    }

    res.json({ ok: true, note: r.rows[0] });
  } catch (e) {
    console.error('[profile/notes/patch] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/profile/:userId/attendance-days?year=&month= ----------
// r0.16 — Returns per-day attendance for one user/month. Gated on profile view
// (own + dept + any), NOT on salary view, so agents can see their own calendar.
// Returns same shape as /api/payroll/month/:userId/days but accessible to a
// wider audience.
router.get('/:userId/attendance-days', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });

  const allowed = await canViewProfile(req.user, userId);
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Bad year/month' });
  }
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${year}-${pad(month)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${pad(month)}-${pad(last)}`;

  try {
    const days = await db.query(
      `SELECT for_date, status, is_paid, weekend_pay_status,
              first_login, late_minutes, sick_notified_hours, active_minutes
         FROM attendance_day
        WHERE user_id = $1 AND for_date BETWEEN $2 AND $3
        ORDER BY for_date`,
      [userId, start, end]
    );
    res.json({ user_id: userId, year, month, days: days.rows });
  } catch (e) {
    console.error('[profile/attendance-days] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/profile/:userId/notes/:noteId/cancel ----------
// r0.16 — Mark a scheduled review as cancelled. Keeps the row (struck-through
// in UI) so the audit trail remains. Reverts is_completed=false so it doesn't
// count as a completed review.
router.post('/:userId/notes/:noteId/cancel', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const noteId = parseInt(req.params.noteId, 10);
  if (!Number.isFinite(userId) || !Number.isFinite(noteId)) return res.status(400).json({ error: 'Bad id' });
  const { reason } = req.body || {};

  let allowed = req.user.can('profile.edit.any');
  if (!allowed && req.user.can('profile.edit.dept')) {
    allowed = await isSameDept(req.user.id, userId);
  }
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  try {
    const cur = await db.query(
      `SELECT id, kind, title, cancelled_at FROM profile_notes WHERE id = $1 AND user_id = $2`,
      [noteId, userId]
    );
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (cur.rows[0].kind !== 'review') return res.status(400).json({ error: 'Only reviews can be cancelled' });
    if (cur.rows[0].cancelled_at) return res.status(400).json({ error: 'Already cancelled' });

    await db.query(
      `UPDATE profile_notes
         SET cancelled_at = NOW(), cancelled_by = $1, cancel_reason = $2,
             status = 'cancelled', updated_at = NOW()
       WHERE id = $3`,
      [req.user.id, (reason || '').toString().slice(0, 500), noteId]
    );
    // Close any open tasks tied to this review
    await db.query(
      `UPDATE tasks SET status = 'cancelled', updated_at = NOW()
        WHERE related_profile_note_id = $1 AND status NOT IN ('done','cancelled')`,
      [noteId]
    );
    await logAudit({
      req, module: 'profile', action: 'note.cancelled',
      target_type: 'profile_note', target_id: noteId,
      after: { reason: reason || null }
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[profile/notes/cancel] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- DELETE /api/profile/:userId/notes/:noteId ----------
router.delete('/:userId/notes/:noteId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const noteId = parseInt(req.params.noteId, 10);
  if (!Number.isFinite(userId) || !Number.isFinite(noteId)) return res.status(400).json({ error: 'Bad id' });

  let allowed = req.user.can('profile.edit.any');
  if (!allowed && req.user.can('profile.edit.dept')) {
    allowed = await isSameDept(req.user.id, userId);
  }
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  try {
    const r = await db.query(
      `DELETE FROM profile_notes WHERE id = $1 AND user_id = $2 RETURNING id, kind, title`,
      [noteId, userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await logAudit({
      req, module: 'profile', action: 'note.deleted',
      target_type: 'profile_note', target_id: noteId,
      before: r.rows[0]
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[profile/notes/delete] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- PUT /api/profile/:userId/probation ----------
// Manually change probation status. Body: { status: 'confirmed'|'extended'|'failed'|'in_probation' }
router.put('/:userId/probation', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });
  if (!req.user.can('probation.manage')) return res.status(403).json({ error: 'Permission denied' });

  const { status, probation_end_date } = req.body || {};
  if (!['confirmed','extended','failed','in_probation','probation_pass_expected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (probation_end_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(probation_end_date)) {
    return res.status(400).json({ error: 'Bad probation_end_date' });
  }

  try {
    const before = await db.query(
      `SELECT probation_status, probation_end_date FROM users WHERE id = $1`, [userId]);
    await db.query(
      `UPDATE users SET probation_status = $1,
                        probation_end_date = COALESCE($2::date, probation_end_date),
                        updated_at = NOW()
        WHERE id = $3`,
      [status, probation_end_date || null, userId]);

    await logAudit({
      req, module: 'profile', action: 'probation.changed',
      target_type: 'user', target_id: userId,
      before: before.rows[0] || null,
      after: { probation_status: status, probation_end_date: probation_end_date || null }
    });

    // If confirmed, notify HR (FYI)
    if (status === 'confirmed') {
      const hr = await db.query(
        `SELECT ug.user_id FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
         WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL`);
      const target = await db.query(`SELECT COALESCE(display_name, full_name) AS name FROM users WHERE id = $1`, [userId]);
      await notifyEvent('probation.confirmed', {
        targetUserId: userId,
        targetName: target.rows[0] ? target.rows[0].name : 'user',
        actorName: req.user.display_name || req.user.full_name,
        hrUserIds: hr.rows.map(x => x.user_id),
        related_id: userId,
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[profile/probation] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- PUT /api/profile/:userId/personal ----------
// r0.11 — Self-service personal info edits.
// r0.12 — Added date_of_birth (DOB)
// Editable: phone, emergency_contact, personal_address, date_of_birth
// Permission: user editing themselves, OR profile.edit.any
router.put('/:userId/personal', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Bad userId' });
  const isSelf = req.user.id === userId;
  const canAny = req.user.can('profile.edit.any');
  if (!isSelf && !canAny) return res.status(403).json({ error: 'Permission denied' });

  const { phone, emergency_contact, personal_address, date_of_birth } = req.body || {};
  // Light validation. Allow null/empty (clearing a field).
  if (phone != null && typeof phone !== 'string') return res.status(400).json({ error: 'phone must be string' });
  if (emergency_contact != null && typeof emergency_contact !== 'string') return res.status(400).json({ error: 'emergency_contact must be string' });
  if (personal_address != null && typeof personal_address !== 'string') return res.status(400).json({ error: 'personal_address must be string' });
  if (date_of_birth != null && date_of_birth !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
    return res.status(400).json({ error: 'date_of_birth must be YYYY-MM-DD' });
  }

  // Bound lengths
  const cap = s => (s == null ? null : String(s).slice(0, 1000));

  try {
    const before = await db.query(
      `SELECT phone, emergency_contact, personal_address, date_of_birth FROM users WHERE id = $1`, [userId]
    );
    if (before.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await db.query(
      `UPDATE users SET
         phone = COALESCE($1, phone),
         emergency_contact = COALESCE($2, emergency_contact),
         personal_address = COALESCE($3, personal_address),
         date_of_birth = COALESCE($4::date, date_of_birth),
         updated_at = NOW()
       WHERE id = $5`,
      [
        phone === '' ? null : cap(phone),
        emergency_contact === '' ? null : cap(emergency_contact),
        personal_address === '' ? null : cap(personal_address),
        date_of_birth === '' ? null : (date_of_birth || null),
        userId,
      ]
    );

    await logAudit({
      req, module: 'profile', action: 'personal.updated',
      target_type: 'user', target_id: userId,
      before: before.rows[0],
      after: { phone, emergency_contact, personal_address, date_of_birth }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[profile/personal] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
