// FK Home — Recruitment module (r0.26)
// ----------------------------------------------------------------------------
// Hiring pipeline (tracking). Reuses the tasks table:
//   OPENING   = kind='recruitment', parent_task_id NULL
//   CANDIDATE = kind='recruitment', parent_task_id = opening id, meta.stage
// Scope: openings + candidates + stages + notes + ready-to-onboard flag.
// NOT in scope: CV upload, offer-letter generation, job-board APIs (deferred).
//
// Endpoints:
//   GET    /api/recruitment/openings              list openings + per-stage counts
//   POST   /api/recruitment/openings              create opening
//   PATCH  /api/recruitment/openings/:id          edit / close opening
//   GET    /api/recruitment/openings/:id          opening + its candidates (by stage)
//   POST   /api/recruitment/openings/:id/candidates   add candidate
//   PATCH  /api/recruitment/candidates/:id        move stage / edit / standby / hire
//   POST   /api/recruitment/candidates/:id/reject reject with reason
//   POST   /api/recruitment/candidates/:id/note   add a note
//   GET    /api/recruitment/pointer               { count } for My Work home-base
// ----------------------------------------------------------------------------

const express = require('express');
const { db } = require('../db');
const { requireAuth, logAudit } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const STAGES = ['sourced','screening','interview','offer','hired','standby','rejected','dropped'];
const ACTIVE_STAGES = ['sourced','screening','interview','offer']; // "need action" for the pointer

// Who can use recruitment: HR team + owner.
async function isHr(req) {
  if (req.user.can('*')) return true;
  const m = await db.query(
    `SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug.group_id
      WHERE ug.user_id = $1 AND g.slug = 'hr-team' AND g.deleted_at IS NULL LIMIT 1`,
    [req.user.id]);
  return m.rows.length > 0;
}
function guard(handler) {
  return async (req, res) => {
    try {
      if (!(await isHr(req))) return res.status(403).json({ error: 'Recruitment is for the HR team.' });
      return await handler(req, res);
    } catch (e) {
      console.error('[recruitment] ' + (req.path) + ' failed:', e.message);
      res.status(500).json({ error: 'Something went wrong' });
    }
  };
}
const metaOf = (row) => (row && row.meta) ? row.meta : {};

// ---------- GET /openings ----------
router.get('/openings', guard(async (req, res) => {
  const r = await db.query(
    `SELECT o.id, o.title, o.status, o.created_at, o.meta, o.department_id,
            d.name AS dept_name,
            ob.display_name AS opened_by_name,
            (SELECT COUNT(*) FROM tasks c
              WHERE c.parent_task_id = o.id AND c.kind='recruitment'
                AND COALESCE(c.meta->>'stage','sourced') NOT IN ('rejected','dropped')) AS active_count,
            (SELECT json_object_agg(stage, n) FROM (
                SELECT COALESCE(c.meta->>'stage','sourced') AS stage, COUNT(*) AS n
                  FROM tasks c
                 WHERE c.parent_task_id = o.id AND c.kind='recruitment'
                 GROUP BY 1) s) AS stage_counts
       FROM tasks o
  LEFT JOIN departments d ON d.id = o.department_id
  LEFT JOIN users ob ON ob.id = o.assigned_by_user_id
      WHERE o.kind='recruitment' AND o.parent_task_id IS NULL
      ORDER BY (o.status='open') DESC, o.created_at DESC`);
  res.json({ openings: r.rows });
}));

// ---------- POST /openings ----------
router.post('/openings', guard(async (req, res) => {
  const { title, department_id, platform, hiring_manager_id } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Role title is required' });
  const meta = { platform: platform || null, hiring_manager_id: hiring_manager_id || null };
  const r = await db.query(
    `INSERT INTO tasks (kind, source, title, category, status, department_id, assigned_by_user_id, opens_at, meta)
     VALUES ('recruitment','manual',$1,'opening','open',$2,$3,NOW(),$4) RETURNING id`,
    [String(title).trim(), department_id || null, req.user.id, JSON.stringify(meta)]);
  await logAudit({ req, module:'recruitment', action:'opening.created', target_type:'task', target_id:r.rows[0].id, after:{ title } });
  res.json({ ok:true, id:r.rows[0].id });
}));

// ---------- PATCH /openings/:id (edit / close / reopen) ----------
router.patch('/openings/:id', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { title, status } = req.body || {};
  const cur = await db.query(`SELECT * FROM tasks WHERE id=$1 AND kind='recruitment' AND parent_task_id IS NULL`, [id]);
  if (cur.rows.length === 0) return res.status(404).json({ error: 'Opening not found' });
  const sets = [], vals = []; let i = 1;
  if (title != null) { sets.push(`title=$${i++}`); vals.push(String(title).trim()); }
  if (status && ['open','done','cancelled'].includes(status)) { sets.push(`status=$${i++}`); vals.push(status); }
  if (sets.length === 0) return res.json({ ok:true });
  vals.push(id);
  await db.query(`UPDATE tasks SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${i}`, vals);
  await logAudit({ req, module:'recruitment', action:'opening.updated', target_type:'task', target_id:id, after:{ title, status } });
  res.json({ ok:true });
}));

// ---------- GET /openings/:id (opening + candidates grouped by stage) ----------
router.get('/openings/:id', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const o = await db.query(
    `SELECT o.*, d.name AS dept_name FROM tasks o
     LEFT JOIN departments d ON d.id = o.department_id
      WHERE o.id=$1 AND o.kind='recruitment' AND o.parent_task_id IS NULL`, [id]);
  if (o.rows.length === 0) return res.status(404).json({ error: 'Opening not found' });
  const c = await db.query(
    `SELECT id, title, meta, created_at, updated_at FROM tasks
      WHERE parent_task_id=$1 AND kind='recruitment'
      ORDER BY created_at ASC`, [id]);
  // group by stage
  const byStage = {};
  for (const s of STAGES) byStage[s] = [];
  for (const cand of c.rows) {
    const stage = (cand.meta && cand.meta.stage) || 'sourced';
    (byStage[stage] || byStage.sourced).push(cand);
  }
  res.json({ opening: o.rows[0], byStage, stages: STAGES });
}));

// ---------- POST /openings/:id/candidates ----------
router.post('/openings/:id/candidates', guard(async (req, res) => {
  const openingId = parseInt(req.params.id, 10);
  const { name, source, phone, email, salary_expectation, notice_period } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Candidate name is required' });
  const op = await db.query(`SELECT id, department_id FROM tasks WHERE id=$1 AND kind='recruitment' AND parent_task_id IS NULL`, [openingId]);
  if (op.rows.length === 0) return res.status(404).json({ error: 'Opening not found' });
  const meta = {
    stage: 'sourced', source: source || null, phone: phone || null, email: email || null,
    salary_expectation: salary_expectation || null, notice_period: notice_period || null,
    notes: [],
  };
  const r = await db.query(
    `INSERT INTO tasks (kind, source, title, category, status, parent_task_id, department_id, assigned_by_user_id, opens_at, meta)
     VALUES ('recruitment','manual',$1,'candidate','open',$2,$3,$4,NOW(),$5) RETURNING id`,
    [String(name).trim(), openingId, op.rows[0].department_id || null, req.user.id, JSON.stringify(meta)]);
  await logAudit({ req, module:'recruitment', action:'candidate.added', target_type:'task', target_id:r.rows[0].id, after:{ name, openingId } });
  res.json({ ok:true, id:r.rows[0].id });
}));

// helper: load a candidate row
async function loadCandidate(id) {
  const r = await db.query(`SELECT * FROM tasks WHERE id=$1 AND kind='recruitment' AND parent_task_id IS NOT NULL`, [id]);
  return r.rows[0] || null;
}

// ---------- PATCH /candidates/:id (move stage / edit fields / standby / hire) ----------
router.patch('/candidates/:id', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cand = await loadCandidate(id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found' });
  const meta = metaOf(cand);
  const b = req.body || {};

  if (b.stage) {
    if (!STAGES.includes(b.stage)) return res.status(400).json({ error: 'Unknown stage' });
    meta.stage = b.stage;
    if (b.stage === 'standby') meta.standby_note = b.standby_note || meta.standby_note || null;
    if (b.stage === 'hired') {
      meta.ready_to_onboard = true;
      meta.hired_at = new Date().toISOString();
    }
  }
  if (b.standby_note != null) meta.standby_note = b.standby_note;
  // editable candidate fields
  for (const f of ['source','phone','email','salary_expectation','notice_period']) {
    if (b[f] != null) meta[f] = b[f];
  }
  const newTitle = (b.name != null && String(b.name).trim()) ? String(b.name).trim() : cand.title;

  await db.query(`UPDATE tasks SET title=$1, meta=$2, moved_at=NOW(), updated_at=NOW() WHERE id=$3`,
    [newTitle, JSON.stringify(meta), id]);
  await logAudit({ req, module:'recruitment', action:'candidate.updated', target_type:'task', target_id:id, after:{ stage: meta.stage } });
  res.json({ ok:true, stage: meta.stage, ready_to_onboard: !!meta.ready_to_onboard });
}));

// ---------- POST /candidates/:id/reject ----------
router.post('/candidates/:id/reject', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { reason } = req.body || {};
  const cand = await loadCandidate(id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found' });
  const meta = metaOf(cand);
  meta.reject_stage = meta.stage || 'sourced';   // remember which stage they fell at
  meta.stage = 'rejected';
  meta.reject_reason = reason || null;
  meta.rejected_at = new Date().toISOString();
  await db.query(`UPDATE tasks SET meta=$1, status='done', moved_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [JSON.stringify(meta), id]);
  await logAudit({ req, module:'recruitment', action:'candidate.rejected', target_type:'task', target_id:id, after:{ reason, fell_at: meta.reject_stage } });
  res.json({ ok:true });
}));

// ---------- POST /candidates/:id/note ----------
router.post('/candidates/:id/note', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Note text is required' });
  const cand = await loadCandidate(id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found' });
  const meta = metaOf(cand);
  if (!Array.isArray(meta.notes)) meta.notes = [];
  meta.notes.push({ at: new Date().toISOString(), by: req.user.id, by_name: req.user.display_name || req.user.full_name, text: String(text).trim() });
  await db.query(`UPDATE tasks SET meta=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(meta), id]);
  res.json({ ok:true, notes: meta.notes });
}));

// ---------- GET /pointer (for My Work home-base) ----------
// How many candidates are in active stages (need action) — a single number.
router.get('/pointer', guard(async (req, res) => {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM tasks
      WHERE kind='recruitment' AND parent_task_id IS NOT NULL
        AND COALESCE(meta->>'stage','sourced') = ANY($1::text[])`,
    [ACTIVE_STAGES]);
  res.json({ count: r.rows[0].n });
}));

module.exports = router;
