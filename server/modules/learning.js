// FK Home — Learning module (server). Ship 1 (r1.26).
// In-house light LMS: Logistics course #1. Sequential gated sessions, MCQ + scenario
// graded server-side, free-text held for manager/AI review, manager sign-off flips a
// per-role competency gate (logistics_ready) with annual recert.
// Same shape as the other modules: router + requireAuth + { db } from ../db.

const express = require('express');
const { requireAuth } = require('../auth');
const { db } = require('../db');
const content = require('../learning-content');

const router = express.Router();
router.use(requireAuth);

// Seed the Logistics course + KB on first use (idempotent). Runs after boot migrations
// have created the tables, so there's no server.js boot-order wiring to get wrong.
let _seeded = false;
async function ensureSeeded() {
  if (_seeded) return;
  try { await seedCourse(content.course, 1); await seedReference(content.reference); _seeded = true; }
  catch (e) { console.error('[learning] seed failed:', e.message); }
}
router.use(async (req, res, next) => { try { await ensureSeeded(); } catch (e) {} next(); });

async function seedCourse(course, ownerId) {
  const c = await db.query(
    `INSERT INTO lms_courses (slug,title,department,competency_key,recert_months,owner_user_id,status,version)
     VALUES ($1,$2,$3,$4,$5,$6,'published',1)
     ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, status='published'
     RETURNING id`,
    [course.slug, course.title, course.department, course.competency_key, course.recert_months || 12, ownerId || null]
  );
  const courseId = c.rows[0].id;
  // rebuild sessions/checks cleanly so re-seeding reflects edits
  await db.query(`DELETE FROM lms_sessions WHERE course_id=$1`, [courseId]);
  for (let si = 0; si < course.sessions.length; si++) {
    const s = course.sessions[si];
    const sr = await db.query(
      `INSERT INTO lms_sessions (course_id,position,title,objective,body_html,est_minutes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [courseId, si, s.title, s.objective || null, s.body_html || null, s.est || null]
    );
    const sessionId = sr.rows[0].id;
    const checks = s.checks || [];
    for (let ci = 0; ci < checks.length; ci++) {
      const k = checks[ci];
      await db.query(
        `INSERT INTO lms_checks (session_id,position,type,prompt,options_json,model_answer,pass_criteria,hard_fail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [sessionId, ci, k.type, k.prompt, k.options ? JSON.stringify(k.options) : null,
         k.model_answer || null, k.pass_criteria || null, !!k.hard_fail]
      );
    }
  }
  return courseId;
}

async function seedReference(items) {
  for (const r of items) {
    await db.query(
      `INSERT INTO lms_reference (department,title,type,body_html,config_json,verified_on)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (department,title) DO UPDATE
         SET type=EXCLUDED.type, body_html=EXCLUDED.body_html,
             config_json=EXCLUDED.config_json, verified_on=EXCLUDED.verified_on, updated_at=now()`,
      [r.department, r.title, r.type, r.body_html || null, r.config_json ? JSON.stringify(r.config_json) : null, r.verified_on || null]
    );
  }
}

// ---------- Assignment + progress ----------
async function assignCourse(courseId, userId, assignedBy, via, dueDate) {
  const a = await db.query(
    `INSERT INTO lms_assignments (course_id,user_id,assigned_by,assigned_via,due_date,status)
     VALUES ($1,$2,$3,$4,$5,'assigned')
     ON CONFLICT (course_id,user_id) DO UPDATE SET due_date=EXCLUDED.due_date
     RETURNING id`,
    [courseId, userId, assignedBy || null, via || 'manual', dueDate || null]
  );
  const assignmentId = a.rows[0].id;
  const sessions = await db.query(`SELECT id, position FROM lms_sessions WHERE course_id=$1 ORDER BY position`, [courseId]);
  for (const s of sessions.rows) {
    await db.query(
      `INSERT INTO lms_progress (assignment_id,session_id,status)
       VALUES ($1,$2,$3) ON CONFLICT (assignment_id,session_id) DO NOTHING`,
      [assignmentId, s.id, s.position === 0 ? 'current' : 'locked']
    );
  }
  return assignmentId;
}

// Course as the trainee sees it: sessions with lock/current/passed state.
async function getCourseForUser(courseId, userId) {
  const a = await db.query(`SELECT id, status FROM lms_assignments WHERE course_id=$1 AND user_id=$2`, [courseId, userId]);
  if (!a.rows.length) return null;
  const assignmentId = a.rows[0].id;
  const rows = await db.query(
    `SELECT s.id, s.position, s.title, COALESCE(p.status,'locked') AS status
       FROM lms_sessions s
       LEFT JOIN lms_progress p ON p.session_id=s.id AND p.assignment_id=$1
      WHERE s.course_id=$2 ORDER BY s.position`,
    [assignmentId, courseId]
  );
  return { assignmentId, status: a.rows[0].status, sessions: rows.rows };
}

// ---------- Grading ----------
// Returns { result:'pass'|'fail'|'flagged' }. Sequential rule enforced in markSessionPassed.
async function gradeCheck(assignmentId, checkId, answer) {
  const ck = await db.query(`SELECT * FROM lms_checks WHERE id=$1`, [checkId]);
  if (!ck.rows.length) throw new Error('check not found');
  const c = ck.rows[0];
  let result, feedback = null, cost = null;
  if (c.type === 'mcq' || c.type === 'scenario') {
    const opts = typeof c.options_json === 'string' ? JSON.parse(c.options_json) : c.options_json;
    const chosen = opts[parseInt(answer, 10)];
    result = chosen && chosen.correct ? 'pass' : 'fail';
    if (chosen) { feedback = chosen.fb || null; cost = chosen.cost || null; }
  } else {
    // free_text: Ship 1 records it for manager/AI review; never auto-pass at the gate.
    result = 'flagged';
    feedback = 'Saved for review. In the live version the AI grades this against the model answer; borderline answers go to your manager.';
  }
  await db.query(
    `INSERT INTO lms_check_attempts (assignment_id,check_id,answer,result,graded_by)
     VALUES ($1,$2,$3,$4,'auto')`,
    [assignmentId, checkId, String(answer), result]
  );
  return { result, feedback, cost };
}

// A session passes only when every check in it has at least one passing attempt.
async function markSessionPassed(assignmentId, sessionId) {
  const checks = await db.query(`SELECT id FROM lms_checks WHERE session_id=$1`, [sessionId]);
  for (const k of checks.rows) {
    const ok = await db.query(
      `SELECT 1 FROM lms_check_attempts WHERE assignment_id=$1 AND check_id=$2 AND result='pass' LIMIT 1`,
      [assignmentId, k.id]
    );
    if (!ok.rows.length) return { passed: false, reason: 'checks_incomplete' };
  }
  await db.query(`UPDATE lms_progress SET status='passed', passed_at=now() WHERE assignment_id=$1 AND session_id=$2`, [assignmentId, sessionId]);
  // unlock the next session
  const pos = await db.query(`SELECT position, course_id FROM lms_sessions WHERE id=$1`, [sessionId]);
  const nxt = await db.query(`SELECT id FROM lms_sessions WHERE course_id=$1 AND position=$2`, [pos.rows[0].course_id, pos.rows[0].position + 1]);
  if (nxt.rows.length) {
    await db.query(`UPDATE lms_progress SET status='current' WHERE assignment_id=$1 AND session_id=$2 AND status='locked'`, [assignmentId, nxt.rows[0].id]);
  } else {
    await db.query(`UPDATE lms_assignments SET status='completed', completed_at=now() WHERE id=$1`, [assignmentId]);
  }
  return { passed: true };
}

async function isCourseComplete(assignmentId) {
  const r = await db.query(`SELECT status FROM lms_assignments WHERE id=$1`, [assignmentId]);
  return r.rows.length && r.rows[0].status === 'completed';
}

// ---------- Sign-off + competency gate ----------
async function signOff(courseId, userId, managerId) {
  const a = await db.query(`SELECT id, status FROM lms_assignments WHERE course_id=$1 AND user_id=$2`, [courseId, userId]);
  if (!a.rows.length || a.rows[0].status !== 'completed') return { ok: false, reason: 'not_complete' };
  const c = await db.query(`SELECT competency_key, recert_months FROM lms_courses WHERE id=$1`, [courseId]);
  const key = c.rows[0].competency_key;
  const months = c.rows[0].recert_months || 12;
  await db.query(
    `INSERT INTO lms_competencies (user_id,competency_key,course_id,signed_off_by,signed_off_at,recert_due,status)
     VALUES ($1,$2,$3,$4,now(),(now()::date + ($5||' months')::interval)::date,'active')
     ON CONFLICT (user_id,competency_key) DO UPDATE
       SET signed_off_by=EXCLUDED.signed_off_by, signed_off_at=now(),
           recert_due=EXCLUDED.recert_due, status='active'`,
    [userId, key, courseId, managerId || null, months]
  );
  return { ok: true, competency: key };
}

async function getCompetency(userId, key) {
  const r = await db.query(`SELECT competency_key, status, recert_due FROM lms_competencies WHERE user_id=$1 AND competency_key=$2`, [userId, key]);
  return r.rows[0] || null;
}

// ---------- Express router (mounted at /api/learning in server.js) ----------
router.post('/assign', async (req, res) => {
    const userId = req.body.userId || req.user.id;
    const c = await db.query(`SELECT id FROM lms_courses WHERE slug=$1 LIMIT 1`, [req.body.slug || 'logistics-dispatch']);
    if (!c.rows.length) return res.status(404).json({ error: 'course not seeded' });
    const aId = await assignCourse(c.rows[0].id, userId, req.user.id, req.body.via || 'manual', req.body.due || null);
    res.json({ ok: true, courseId: c.rows[0].id, assignmentId: aId });
  });

  router.get('/my-courses', async (req, res) => {
    const rows = await db.query(
      `SELECT c.id, c.title, c.department, a.status, a.due_date
         FROM lms_assignments a JOIN lms_courses c ON c.id=a.course_id
        WHERE a.user_id=$1 ORDER BY a.created_at`, [req.user.id]);
    res.json(rows.rows);
  });
  router.get('/course/:id', async (req, res) => {
    const data = await getCourseForUser(parseInt(req.params.id, 10), req.user.id);
    if (!data) return res.status(404).json({ error: 'not assigned' });
    res.json(data);
  });

  // Session detail for the trainee — options sent WITHOUT the correct flag/feedback,
  // so the answer can't be read from the browser. Feedback comes back on grade.
  router.get('/session/:id', async (req, res) => {
    const sid = parseInt(req.params.id, 10);
    const s = await db.query(`SELECT id,position,title,objective,body_html,est_minutes FROM lms_sessions WHERE id=$1`, [sid]);
    if (!s.rows.length) return res.status(404).json({ error: 'no session' });
    const ck = await db.query(`SELECT id,position,type,prompt,options_json FROM lms_checks WHERE session_id=$1 ORDER BY position`, [sid]);
    const checks = ck.rows.map(c => {
      const opts = c.options_json ? (typeof c.options_json === 'string' ? JSON.parse(c.options_json) : c.options_json) : [];
      return { id: c.id, type: c.type, prompt: c.prompt, options: opts.map(o => ({ text: o.text })) };
    });
    res.json({ session: s.rows[0], checks });
  });

  router.get('/kb', async (req, res) => {
    const dept = req.query.department || 'logistics';
    const rows = await db.query(`SELECT id,department,type,title,body_html,config_json,verified_on FROM lms_reference WHERE department=$1 ORDER BY id`, [dept]);
    res.json(rows.rows);
  });

  // Manager: progress across everyone assigned to a course.
  router.get('/manager/progress/:courseId', async (req, res) => {
    const cid = parseInt(req.params.courseId, 10);
    const rows = await db.query(
      `SELECT a.id assignment_id, a.user_id, u.full_name, a.status,
              (SELECT count(*) FROM lms_sessions s WHERE s.course_id=a.course_id) AS total,
              (SELECT count(*) FROM lms_progress p WHERE p.assignment_id=a.id AND p.status='passed') AS done,
              comp.status AS competency_status
         FROM lms_assignments a
         JOIN users u ON u.id=a.user_id
         LEFT JOIN lms_competencies comp ON comp.user_id=a.user_id AND comp.course_id=a.course_id
        WHERE a.course_id=$1 ORDER BY u.full_name`, [cid]);
    res.json(rows.rows);
  });
  router.post('/check/:checkId', async (req, res) => {
    const out = await gradeCheck(req.body.assignmentId, parseInt(req.params.checkId, 10), req.body.answer);
    res.json(out);
  });
  router.post('/session/:sessionId/complete', async (req, res) => {
    const out = await markSessionPassed(req.body.assignmentId, parseInt(req.params.sessionId, 10));
    res.json(out);
  });
  router.post('/signoff', async (req, res) => {
    // manager/owner only — gate in real auth middleware
    const out = await signOff(req.body.courseId, req.body.userId, req.user.id);
    res.json(out);
  });


module.exports = router;
// helpers exposed for boot-seed + onboarding auto-assign:
module.exports.seedCourse = seedCourse;
module.exports.seedReference = seedReference;
module.exports.assignCourse = assignCourse;
