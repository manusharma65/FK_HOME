// FK Home — Learning module (server). Ship 1 (r1.26).
// In-house light LMS: Logistics course #1. Sequential gated sessions, MCQ + scenario
// graded server-side, free-text held for manager/AI review, manager sign-off flips a
// per-role competency gate (logistics_ready) with annual recert.
// Same shape as the other modules: router + requireAuth + { db } from ../db.

const express = require('express');
const { requireAuth } = require('../auth');
const { db } = require('../db');
const content = require('../learning-content');
const fs = require('fs');
const path = require('path');
// Notifications + line-manager / HR resolution. Required lazily-safe: these only
// touch the DB inside calls, never at load, so importing here is fine.
let notify = null, approvals = null;
try { notify = require('../notify'); } catch (e) { /* optional in some test rigs */ }
try { approvals = require('../approval-flow'); } catch (e) { /* optional */ }

const router = express.Router();

// Wrap router verbs so any async handler error becomes a clean 500 (Express 4 otherwise hangs).
['get','post','put','delete'].forEach((m) => {
  const orig = router[m].bind(router);
  router[m] = (rp, ...hs) => orig(rp, ...hs.map((h) => (typeof h === 'function'
    ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h)));
});

router.use(requireAuth);

// Seed the Logistics course + KB on first use (idempotent). Runs after boot migrations
// have created the tables, so there's no server.js boot-order wiring to get wrong.
let _ready = null;
async function ensureSchema() {
  // The learning module owns these schema files; apply them all, in order.
  // All are idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),
  // so this is safe even though server.js also runs them via its migration runner.
  for (const f of ['44-learning.sql', '45-check-tag.sql', '46-kb-docs.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema', f), 'utf8');
    await db.query(sql);
  }
}
async function init() {
  try { await ensureSchema(); for (const c of (content.courses || [content.course])) await seedCourse(c, 1); await seedReference(content.reference); await seedKbDocs(content.kbDocs || []); }
  catch (e) { console.error('[learning] init failed:', e.message); _ready = null; throw e; }
}
function ensureReady() { if (!_ready) _ready = init(); return _ready; }
// IMPORTANT: do NOT init at module load — server/db.js has no pool until initDb() runs
// on boot. Init lazily on the first request, by which point the pool is up.
// gate the first requests on it, but never hang: errors flow to the 500 handler below
router.use((req, res, next) => { ensureReady().then(() => next()).catch(next); });

async function seedCourse(course, ownerId) {
  const c = await db.query(
    `INSERT INTO lms_courses (slug,title,department,competency_key,recert_months,owner_user_id,status,version)
     VALUES ($1,$2,$3,$4,$5,$6,'published',1)
     ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, status='published'
     RETURNING id`,
    [course.slug, course.title, course.department, course.competency_key, course.recert_months || 12, ownerId || null]
  );
  const courseId = c.rows[0].id;
  // Upsert sessions by (course_id, position) so their IDs stay STABLE across re-seeds.
  // lms_progress is keyed to session_id (ON DELETE CASCADE) — deleting sessions on every
  // boot wiped learner progress and locked the whole course. Upserting preserves it.
  for (let si = 0; si < course.sessions.length; si++) {
    const s = course.sessions[si];
    const sr = await db.query(
      `INSERT INTO lms_sessions (course_id,position,title,objective,body_html,est_minutes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (course_id,position) DO UPDATE
         SET title=EXCLUDED.title, objective=EXCLUDED.objective,
             body_html=EXCLUDED.body_html, est_minutes=EXCLUDED.est_minutes
       RETURNING id`,
      [courseId, si, s.title, s.objective || null, s.body_html || null, s.est || null]
    );
    const sessionId = sr.rows[0].id;
    // Checks can be rebuilt per session (attempts are audit only; progress is keyed to session).
    await db.query(`DELETE FROM lms_checks WHERE session_id=$1`, [sessionId]);
    const checks = s.checks || [];
    for (let ci = 0; ci < checks.length; ci++) {
      const k = checks[ci];
      await db.query(
        `INSERT INTO lms_checks (session_id,position,type,prompt,options_json,model_answer,pass_criteria,hard_fail,tag)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [sessionId, ci, k.type, k.prompt, k.options ? JSON.stringify(k.options) : null,
         k.model_answer || null, k.pass_criteria || null, !!k.hard_fail, k.tag || null]
      );
    }
  }
  // Drop any sessions beyond the current course length (if a version shrank).
  await db.query(`DELETE FROM lms_sessions WHERE course_id=$1 AND position >= $2`, [courseId, course.sessions.length]);
  return courseId;
}

// Self-heal an assignment's progress: insert any missing rows, and if nothing is
// current/passed (e.g. progress was wiped by an old destructive re-seed), open session 1.
async function ensureProgress(assignmentId, courseId) {
  const sessions = await db.query(`SELECT id, position FROM lms_sessions WHERE course_id=$1 ORDER BY position`, [courseId]);
  for (const s of sessions.rows) {
    await db.query(
      `INSERT INTO lms_progress (assignment_id,session_id,status) VALUES ($1,$2,'locked')
       ON CONFLICT (assignment_id,session_id) DO NOTHING`,
      [assignmentId, s.id]
    );
  }
  const active = await db.query(
    `SELECT 1 FROM lms_progress WHERE assignment_id=$1 AND status IN ('current','passed') LIMIT 1`, [assignmentId]
  );
  if (!active.rows.length && sessions.rows.length) {
    await db.query(`UPDATE lms_progress SET status='current' WHERE assignment_id=$1 AND session_id=$2`,
      [assignmentId, sessions.rows[0].id]);
  }
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
  // Purge retired titles: for each department we just seeded, drop any rows
  // whose title is no longer in the content set (e.g. old thin articles).
  const depts = [...new Set(items.map(r => r.department))];
  for (const d of depts) {
    const titles = items.filter(r => r.department === d).map(r => r.title);
    await db.query(
      `DELETE FROM lms_reference WHERE department = $1 AND title <> ALL($2::text[])`,
      [d, titles]
    );
  }
}

// Seed the downloadable KB documents (PDFs) from server/kb-files/ into bytea.
// A missing/unreadable file is skipped, never fatal — Academy init must not break.
async function seedKbDocs(docs) {
  for (const d of docs) {
    try {
      const buf = fs.readFileSync(path.join(__dirname, '..', 'kb-files', d.file));
      await db.query(
        `INSERT INTO lms_kb_docs (slug,department,title,filename,mime,data,byte_size,verified_on)
         VALUES ($1,$2,$3,$4,'application/pdf',$5,$6,$7)
         ON CONFLICT (slug) DO UPDATE
           SET department=EXCLUDED.department, title=EXCLUDED.title, filename=EXCLUDED.filename,
               data=EXCLUDED.data, byte_size=EXCLUDED.byte_size, verified_on=EXCLUDED.verified_on, updated_at=now()`,
        [d.slug, d.department, d.title, d.filename, buf, buf.length, d.verified_on || null]);
    } catch (e) {
      console.error('[learning] kb doc seed skipped (' + d.slug + '):', e.message);
    }
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
  await ensureProgress(assignmentId, courseId);
  const rows = await db.query(
    `SELECT s.id, s.position, s.title, s.objective, COALESCE(p.status,'locked') AS status
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
    notifyAwaitingSignoff(assignmentId).catch(() => {}); // best-effort: tell line manager + HR
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
  notifySignedOff(courseId, userId, managerId).catch(() => {}); // best-effort
  return { ok: true, competency: key };
}

async function getCompetency(userId, key) {
  const r = await db.query(`SELECT competency_key, status, recert_due FROM lms_competencies WHERE user_id=$1 AND competency_key=$2`, [userId, key]);
  return r.rows[0] || null;
}

// ---------- management gate (real req.user shape from auth.js) ----------
// Manager of any dept, HR-team, owner, or an explicit learning.manage perm.
function canManage(req) {
  const u = req.user || {};
  try {
    if (typeof u.inGroup === 'function' && (u.inGroup('owner') || u.inGroup('hr-team'))) return true;
    if (typeof u.can === 'function' && (u.can('learning.manage') || u.can('reviews.complete'))) return true;
    if (Array.isArray(u.departments) && u.departments.some(d => d && (d.role === 'manager' || d.role === 'lead'))) return true;
  } catch (e) { /* fall through to deny */ }
  return false;
}

// ---------- completion + sign-off side-effects (best-effort; never block flow) ----------
// On course completion: notify line manager + HR, AND drop a "Sign off training"
// task in the line manager's My Work (shared with HR), mirroring how hr-task-router
// creates review tasks. All wrapped — a failure here never breaks the gate.
async function notifyAwaitingSignoff(assignmentId) {
  const a = await db.query(
    `SELECT a.user_id, a.course_id, c.title AS course_title, u.full_name
       FROM lms_assignments a JOIN lms_courses c ON c.id=a.course_id
       JOIN users u ON u.id=a.user_id WHERE a.id=$1`, [assignmentId]);
  if (!a.rows.length) return;
  const t = a.rows[0];
  let manager = null, hr = [];
  try { if (approvals && approvals.resolveStageOneManager) manager = await approvals.resolveStageOneManager(t.user_id); } catch (e) {}
  try { if (approvals && approvals.hrTeamIds) hr = await approvals.hrTeamIds(); } catch (e) {}

  // 1) notify line manager + HR
  if (notify && notify.notifyEvent) {
    const ids = []; if (manager) ids.push(manager); for (const h of hr) if (!ids.includes(h)) ids.push(h);
    if (ids.length) { try {
      await notify.notifyEvent('learning.awaiting_signoff', { name: t.full_name, courseTitle: t.course_title, userIds: ids, related_id: assignmentId });
    } catch (e) {} }
  }

  // 2) "Sign off training" task in the line manager's My Work (idempotent, shared w/ HR)
  if (manager) {
    try {
      const exists = await db.query(
        `SELECT 1 FROM tasks WHERE category='training' AND status NOT IN ('done','cancelled')
           AND (meta->>'assignment_id') = $1 LIMIT 1`, [String(assignmentId)]);
      if (!exists.rows.length) {
        let deptId = null; try { if (approvals && approvals.primaryDeptId) deptId = await approvals.primaryDeptId(t.user_id); } catch (e) {}
        const meta = { context_url: '#learning', shared_with: hr, learning_signoff: true, assignment_id: String(assignmentId), course_id: t.course_id };
        await db.query(
          `INSERT INTO tasks (kind, source, title, body, category, assignee_user_id, related_user_id, department_id, status, opens_at, meta)
           VALUES ('event','auto_event',$1,$2,'training',$3,$4,$5,'open',NOW(),$6)`,
          ['Sign off training \u2014 ' + (t.full_name || 'employee'),
           (t.course_title || 'Course') + ' \u2014 all sessions complete, ready to sign off',
           manager, t.user_id, deptId, JSON.stringify(meta)]);
      }
    } catch (e) { /* tasks shape differs → notification already delivered, no harm */ }
  }
}

async function notifySignedOff(courseId, userId, managerId) {
  const c = await db.query(`SELECT title, competency_key FROM lms_courses WHERE id=$1`, [courseId]);
  const courseTitle = c.rows[0] && c.rows[0].title;
  const label = ((c.rows[0] && c.rows[0].competency_key) || '').replace(/_/g, '-') || 'qualified';

  // 1) notify the trainee
  if (notify && notify.notifyEvent) {
    let byName = null;
    if (managerId) { const m = await db.query(`SELECT full_name FROM users WHERE id=$1`, [managerId]); byName = m.rows[0] && m.rows[0].full_name; }
    try { await notify.notifyEvent('learning.signed_off', { targetUserId: userId, courseTitle, byName, competencyLabel: label }); } catch (e) {}
  }

  // 2) close the open "Sign off training" task
  try {
    await db.query(
      `UPDATE tasks SET status='done', completed_at=NOW(), completed_by_user_id=$1, updated_at=NOW()
        WHERE category='training' AND related_user_id=$2 AND status NOT IN ('done','cancelled')`,
      [managerId || null, userId]);
  } catch (e) { /* tasks shape differs → harmless */ }

  // 3) tick a completed onboarding item on the trainee's profile (idempotent by title)
  try {
    const title = ('Training: ' + (courseTitle || 'course') + ' \u2014 signed off').slice(0, 200);
    const dup = await db.query(
      `SELECT 1 FROM profile_notes WHERE user_id=$1 AND kind='onboarding' AND title=$2 LIMIT 1`, [userId, title]);
    if (!dup.rows.length) {
      await db.query(
        `INSERT INTO profile_notes (user_id, kind, title, body, author_user_id, review_type, review_date, status, is_completed)
         VALUES ($1,'onboarding',$2,$3,$4,NULL,NULL,NULL,TRUE)`,
        [userId, title, 'Academy course completed and signed off by manager.', managerId || null]);
    }
  } catch (e) { /* profile_notes shape differs → harmless */ }
}

// ---------- Express router (mounted at /api/learning in server.js) ----------
router.post('/assign', async (req, res) => {
    const userId = req.body.userId || req.user.id;
    const c = await db.query(`SELECT id, department FROM lms_courses WHERE slug=$1 LIMIT 1`, [req.body.slug || 'logistics-dispatch']);
    if (!c.rows.length) return res.status(404).json({ error: 'course not seeded' });
    // r1.28 — a person self-assigning may only take a course for their OWN department.
    // Managers/HR assigning to someone else (passing userId) pass through.
    if (userId === req.user.id && !canManage(req)) {
      const hay = await userDeptHay(req.user.id);
      if (!courseVisible(hay, c.rows[0].department, null))
        return res.status(403).json({ error: 'That course is not for your department.' });
    }
    const aId = await assignCourse(c.rows[0].id, userId, req.user.id, req.body.via || 'manual', req.body.due || null);
    res.json({ ok: true, courseId: c.rows[0].id, assignmentId: aId });
  });

  // r1.27 — a course is only visible to someone who belongs to that course's
  // discipline (so HR never sees the Logistics course), UNLESS a manager deliberately
  // assigned it (assigned_via='manual'). This guards display everywhere a learner's
  // own courses are read, independent of any stale auto/onboarding assignment rows.
  async function userDeptHay(uid) {
    try {
      const r = await db.query(
        `SELECT COALESCE(string_agg(DISTINCT lower(coalesce(dep.slug,'') || ' ' || coalesce(dep.name,'')), ' '), '') AS depts,
                COALESCE((SELECT string_agg(lower(g.slug), ' ') FROM user_groups ug JOIN groups g ON g.id = ug.group_id WHERE ug.user_id = $1), '') AS groups
           FROM user_department_memberships m
           JOIN departments dep ON dep.id = m.department_id
          WHERE m.user_id = $1 AND m.deleted_at IS NULL`, [uid]);
      const row = r.rows[0] || {};
      return ((row.depts || '') + ' ' + (row.groups || '')).toLowerCase();
    } catch (e) { return ''; }
  }
  function courseVisible(hay, courseDept, assignedVia) {
    if (assignedVia === 'manual') return true; // deliberate cross-discipline assignment
    const d = String(courseDept || '').toLowerCase();
    if (/logist|despatch|dispatch|warehouse|courier|shipping/.test(d))
      return /logist|despatch|dispatch|warehouse|courier|shipping/.test(hay);
    return !d || hay.includes(d);
  }
  // Owner is cross-discipline by definition — they see every course and every KB entry,
  // regardless of department. Owner has no department membership, so the normal gate
  // would otherwise show them nothing (the "coming soon" they were seeing).
  const ownerSeesAll = (req) => !!(req && req.user && typeof req.user.inGroup === 'function' && req.user.inGroup('owner'));

  router.get('/my-courses', async (req, res) => {
    const fetch = () => db.query(
      `SELECT c.id, c.title, c.department, c.slug, a.status, a.due_date, a.assigned_via
         FROM lms_assignments a JOIN lms_courses c ON c.id=a.course_id
        WHERE a.user_id=$1 ORDER BY a.created_at`, [req.user.id]);
    let rows = await fetch();
    // Auto-assign: a logistics/despatch user with no course assigned gets Course A
    // automatically the first time they open Academy ("everyone goes through").
    // Keys off the real FK Home identity model that auth.js puts on req.user:
    //   req.user.departments = [{ slug, name, role, ... }]
    //   req.user.group_slugs = ['logistics-agent', ...]
    // Fully guarded — never throws, never blocks the course listing.
    if (!rows.rows.length) {
      try {
        const depts = Array.isArray(req.user.departments) ? req.user.departments : [];
        const groups = Array.isArray(req.user.group_slugs) ? req.user.group_slugs : [];
        const hay = depts.map(d => ((d && d.slug) || '') + ' ' + ((d && d.name) || ''))
          .concat(groups)
          .join(' ').toLowerCase();
        if (/logist|despatch|dispatch|warehouse|courier|shipping/.test(hay)) {
          // assign every active logistics-discipline course (despatch + stock-in, and
          // any future logistics course) the first time they open Academy.
          const cs = await db.query(`SELECT id, department FROM lms_courses WHERE status='published'`);
          for (const cc of cs.rows) {
            if (/logist|despatch|dispatch|warehouse|courier|shipping/.test(String(cc.department || '').toLowerCase()))
              await assignCourse(cc.id, req.user.id, req.user.id, 'onboarding', null);
          }
          rows = await fetch();
        }
      } catch (e) { /* best-effort auto-assign; fall through with whatever we have */ }
    }
    // r1.27 — hide courses that aren't for this person's discipline (a stale logistics
    // assignment on a non-logistics user must not render). Manual assignments pass.
    const hay = await userDeptHay(req.user.id);
    const visible = rows.rows.filter(r => courseVisible(hay, r.department, r.assigned_via));
    res.json(visible);
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
    const ck = await db.query(`SELECT id,position,type,prompt,options_json,tag FROM lms_checks WHERE session_id=$1 ORDER BY position`, [sid]);
    const checks = ck.rows.map(c => {
      const opts = c.options_json ? (typeof c.options_json === 'string' ? JSON.parse(c.options_json) : c.options_json) : [];
      return { id: c.id, type: c.type, tag: c.tag || null, prompt: c.prompt, options: opts.map(o => ({ text: o.text })) };
    });
    res.json({ session: s.rows[0], checks });
  });

  router.get('/kb', async (req, res) => {
    // r1.28 — scope the knowledge base to the VIEWER's own department(s). Was hardcoded
    // to 'logistics' (via a query-param default), so every employee saw logistics KB.
    const hay = await userDeptHay(req.user.id);
    const all = ownerSeesAll(req);
    const rows = await db.query(`SELECT id,department,type,title,body_html,config_json,verified_on FROM lms_reference ORDER BY id`);
    res.json(rows.rows.filter(r => all || courseVisible(hay, r.department, null)));
  });

  // r1.29 — list the downloadable KB documents (SOW/SOP PDFs) for this viewer's dept.
  router.get('/kb/docs', async (req, res) => {
    const hay = await userDeptHay(req.user.id);
    const all = ownerSeesAll(req);
    const rows = await db.query(
      `SELECT slug, department, title, filename, byte_size, verified_on FROM lms_kb_docs ORDER BY id`);
    res.json(rows.rows.filter(d => all || courseVisible(hay, d.department, null)));
  });
  // Stream one KB document as a download (cookie-authed, same dept-visibility gate).
  router.get('/kb/doc/:slug', async (req, res) => {
    const hay = await userDeptHay(req.user.id);
    const all = ownerSeesAll(req);
    const r = await db.query(`SELECT department, title, filename, mime, data FROM lms_kb_docs WHERE slug=$1`, [req.params.slug]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const doc = r.rows[0];
    if (!all && !courseVisible(hay, doc.department, null)) return res.status(403).json({ error: 'Not allowed' });
    res.setHeader('Content-Type', doc.mime || 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + String(doc.filename || 'document.pdf').replace(/[^\w.\- ]/g, '') + '"');
    res.send(doc.data);
  });

  // r1.28 — courses available to THIS viewer's discipline, for the Academy "Available"
  // list. Replaces the frontend's hardcoded logistics card so HR/Amazon/etc. only ever
  // see training for a department they belong to (none -> empty -> "nothing for you yet").
  router.get('/available', async (req, res) => {
    const hay = await userDeptHay(req.user.id);
    const all = ownerSeesAll(req);
    const rows = await db.query(
      `SELECT id, slug, title, department FROM lms_courses WHERE status='published' ORDER BY id`);
    res.json(rows.rows.filter(c => all || courseVisible(hay, c.department, null)));
  });

  // Manager: progress across everyone assigned to a course, WITH a first-attempt
  // accuracy score so 4–5 trainees on probation can be compared (who got it right
  // first time, not just who eventually passed). Free-text checks (result 'flagged')
  // are excluded from the score denominator — they're manager-reviewed.
  router.get('/manager/progress/:courseId', async (req, res) => {
    if (!canManage(req)) return res.status(403).json({ error: 'Managers and HR only' });
    const cid = parseInt(req.params.courseId, 10);
    const rows = await db.query(
      `SELECT a.id assignment_id, a.user_id, u.full_name, a.status,
              (SELECT count(*) FROM lms_sessions s WHERE s.course_id=a.course_id) AS total,
              (SELECT count(*) FROM lms_progress p WHERE p.assignment_id=a.id AND p.status='passed') AS done,
              (SELECT count(*) FROM (
                 SELECT DISTINCT ON (check_id) result FROM lms_check_attempts
                  WHERE assignment_id=a.id ORDER BY check_id, id
               ) f WHERE f.result='pass') AS first_pass,
              (SELECT count(*) FROM (
                 SELECT DISTINCT ON (check_id) result FROM lms_check_attempts
                  WHERE assignment_id=a.id ORDER BY check_id, id
               ) f WHERE f.result IN ('pass','fail')) AS first_graded,
              (SELECT count(*) FROM lms_check_attempts WHERE assignment_id=a.id) AS attempts_total,
              comp.status AS competency_status
         FROM lms_assignments a
         JOIN users u ON u.id=a.user_id
         LEFT JOIN lms_competencies comp ON comp.user_id=a.user_id AND comp.course_id=a.course_id
        WHERE a.course_id=$1 ORDER BY u.full_name`, [cid]);
    const out = rows.rows.map(r => {
      const fp = Number(r.first_pass), fg = Number(r.first_graded);
      return { ...r, accuracy_pct: fg > 0 ? Math.round((fp / fg) * 100) : null };
    });
    res.json(out);
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
    if (!canManage(req)) return res.status(403).json({ error: 'Only a manager or HR can sign off' });
    const out = await signOff(req.body.courseId, req.body.userId, req.user.id);
    res.json(out);
  });

  // Competencies for a user — for the profile "Training & competencies" drawer to read.
  router.get('/competencies/:userId', async (req, res) => {
    const uid = parseInt(req.params.userId, 10);
    if (req.user.id !== uid && !canManage(req)) return res.status(403).json({ error: 'Not allowed' });
    const rows = await db.query(
      `SELECT comp.competency_key, comp.status, comp.recert_due, comp.signed_off_at,
              c.title AS course_title, c.slug AS course_slug
         FROM lms_competencies comp
         LEFT JOIN lms_courses c ON c.id=comp.course_id
        WHERE comp.user_id=$1
        ORDER BY comp.signed_off_at DESC NULLS LAST`, [uid]);
    res.json(rows.rows);
  });

  // Per-user course progress — powers the profile Training tab. Self, or a manager/HR.
  router.get('/progress/:userId', async (req, res) => {
    const uid = parseInt(req.params.userId, 10);
    if (req.user.id !== uid && !canManage(req)) return res.status(403).json({ error: 'Not allowed' });
    const rows = await db.query(
      `SELECT c.id AS course_id, c.title, c.slug, c.department, a.status, a.assigned_via,
              (SELECT count(*) FROM lms_sessions s WHERE s.course_id=a.course_id) AS total,
              (SELECT count(*) FROM lms_progress p WHERE p.assignment_id=a.id AND p.status='passed') AS done,
              (SELECT count(*) FROM (SELECT DISTINCT ON (check_id) result FROM lms_check_attempts WHERE assignment_id=a.id ORDER BY check_id, id) f WHERE f.result='pass') AS first_pass,
              (SELECT count(*) FROM (SELECT DISTINCT ON (check_id) result FROM lms_check_attempts WHERE assignment_id=a.id ORDER BY check_id, id) f WHERE f.result IN ('pass','fail')) AS first_graded,
              comp.status AS competency_status, comp.recert_due, comp.signed_off_at
         FROM lms_assignments a
         JOIN lms_courses c ON c.id=a.course_id
         LEFT JOIN lms_competencies comp ON comp.user_id=a.user_id AND comp.course_id=a.course_id
        WHERE a.user_id=$1 ORDER BY a.created_at`, [uid]);
    // r1.27 — department-scope: a learner's profile only shows courses for their own
    // discipline (HR never sees the Logistics course), manual assignments excepted.
    const hay = await userDeptHay(uid);
    res.json(rows.rows
      .filter(r => courseVisible(hay, r.department, r.assigned_via))
      .map(r => {
        const fp = Number(r.first_pass), fg = Number(r.first_graded);
        return { ...r, accuracy_pct: fg > 0 ? Math.round((fp / fg) * 100) : null };
      }));
  });


router.use((err, req, res, next) => {
  console.error('[learning]', err && err.message);
  if (!res.headersSent) res.status(500).json({ error: 'learning: ' + (err && err.message || 'error') });
});

module.exports = router;
// helpers exposed for boot-seed + onboarding auto-assign:
module.exports.seedCourse = seedCourse;
module.exports.seedReference = seedReference;
module.exports.assignCourse = assignCourse;
