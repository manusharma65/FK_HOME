// FK Home — Recruitment module (r0.27)
// ----------------------------------------------------------------------------
// Hiring pipeline (tracking). Reuses the tasks table:
//   OPENING   = kind='recruitment', parent_task_id NULL
//   CANDIDATE = kind='recruitment', parent_task_id = opening id, meta.stage
// Candidate files reuse the files table with task_id set + drawer='candidate'.
//
// meta on a candidate:
//   stage, source, why_shortlist,
//   current_company, experience_years, current_salary, expected_salary,
//   notice_period, phone, email,
//   history:[{stage,at}]            — auto stage trail
//   outcomes:[{stage,text,at,by,by_name}]  — per-round "how did it go"
//   notes:[{at,by,by_name,text}]
//   standby_note,
//   ended:{ how:'passed'|'withdrew', reason, at, stage_at_end }  — reversible exit
//   ready_to_onboard, hired_at
//
// Stages: sourced screening interview offer hired standby | (exits via meta.ended)
// ----------------------------------------------------------------------------

const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { requireAuth, logAudit } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const STAGES = ['sourced','screening','interview','interview_2','offer','accepted','joined','standby'];
const ACTIVE_STAGES = ['sourced','screening','interview','interview_2','offer','accepted'];
const CARD_FIELDS = ['source','why_shortlist','current_company','experience_years',
                     'current_salary','expected_salary','notice_period','phone','email','joining_date'];

// ---------- access: HR team + owner/management (matches Profile pages) ----------
async function isHr(req) {
  if (req.user.can('profile.view.any')) return true;
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
      console.error('[recruitment] ' + req.path + ' failed:', e.message);
      res.status(500).json({ error: 'Something went wrong' });
    }
  };
}
const metaOf = (row) => (row && row.meta) ? row.meta : {};
const whoName = (req) => req.user.display_name || req.user.full_name;

// ---------- multer (candidate CV/photo) — PDF + PNG + JPG, 15MB ----------
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf','image/png','image/jpeg']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Use a PDF, PNG or JPG.'));
    cb(null, true);
  },
});

// ---------- GET /openings ----------
router.get('/openings', guard(async (req, res) => {
  const r = await db.query(
    `SELECT o.id, o.title, o.status, o.created_at, o.meta, o.department_id,
            d.name AS dept_name,
            (SELECT COUNT(*) FROM tasks c
              WHERE c.parent_task_id = o.id AND c.kind='recruitment'
                AND c.meta->'ended' IS NULL) AS active_count,
            (SELECT json_object_agg(stage, n) FROM (
                SELECT COALESCE(c.meta->>'stage','sourced') AS stage, COUNT(*) AS n
                  FROM tasks c
                 WHERE c.parent_task_id = o.id AND c.kind='recruitment'
                   AND c.meta->'ended' IS NULL
                 GROUP BY 1) s) AS stage_counts
       FROM tasks o
  LEFT JOIN departments d ON d.id = o.department_id
      WHERE o.kind='recruitment' AND o.parent_task_id IS NULL
      ORDER BY (o.status='open') DESC, o.created_at DESC`);
  res.json({ openings: r.rows });
}));

// ---------- POST /openings ----------
router.post('/openings', guard(async (req, res) => {
  const { title, department_id, platform } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Role title is required' });
  const meta = { platform: platform || null };
  const r = await db.query(
    `INSERT INTO tasks (kind, source, title, category, status, department_id, assignee_user_id, assigned_by_user_id, opens_at, meta)
     VALUES ('recruitment','manual',$1,'opening','open',$2,$3,$3,NOW(),$4) RETURNING id`,
    [String(title).trim(), department_id || null, req.user.id, JSON.stringify(meta)]);
  await logAudit({ req, module:'recruitment', action:'opening.created', target_type:'task', target_id:r.rows[0].id, after:{ title } });
  res.json({ ok:true, id:r.rows[0].id });
}));

// ---------- PATCH /openings/:id (rename / close / reopen) ----------
router.patch('/openings/:id', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { title, status } = req.body || {};
  const cur = await db.query(`SELECT * FROM tasks WHERE id=$1 AND kind='recruitment' AND parent_task_id IS NULL`, [id]);
  if (cur.rows.length === 0) return res.status(404).json({ error: 'Opening not found' });
  const sets = [], vals = []; let i = 1;
  if (title != null && String(title).trim()) { sets.push(`title=$${i++}`); vals.push(String(title).trim()); }
  if (status && ['open','cancelled'].includes(status)) { sets.push(`status=$${i++}`); vals.push(status); }
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
    `SELECT id, title, meta, created_at, updated_at, moved_at FROM tasks
      WHERE parent_task_id=$1 AND kind='recruitment'
      ORDER BY created_at ASC`, [id]);
  const byStage = {}; for (const s of STAGES) byStage[s] = [];
  const ended = [];
  for (const cand of c.rows) {
    const m = cand.meta || {};
    if (m.ended) { ended.push(cand); continue; }       // exits go to the archive list
    const stage = m.stage || 'sourced';
    (byStage[stage] || byStage.sourced).push(cand);
  }
  res.json({ opening: o.rows[0], byStage, ended, stages: STAGES });
}));

// ---------- POST /openings/:id/candidates  (light add) ----------
router.post('/openings/:id/candidates', guard(async (req, res) => {
  const openingId = parseInt(req.params.id, 10);
  const { name, source, why_shortlist } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Candidate name is required' });
  const op = await db.query(`SELECT id, department_id FROM tasks WHERE id=$1 AND kind='recruitment' AND parent_task_id IS NULL`, [openingId]);
  if (op.rows.length === 0) return res.status(404).json({ error: 'Opening not found' });
  const nowIso = new Date().toISOString();
  const meta = {
    stage: 'sourced', source: source || null, why_shortlist: why_shortlist || null,
    history: [{ stage: 'sourced', at: nowIso }], outcomes: [], notes: [],
  };
  const r = await db.query(
    `INSERT INTO tasks (kind, source, title, category, status, parent_task_id, department_id, assignee_user_id, assigned_by_user_id, opens_at, moved_at, meta)
     VALUES ('recruitment','manual',$1,'candidate','open',$2,$3,$4,$4,NOW(),NOW(),$5) RETURNING id`,
    [String(name).trim(), openingId, op.rows[0].department_id || null, req.user.id, JSON.stringify(meta)]);
  await logAudit({ req, module:'recruitment', action:'candidate.added', target_type:'task', target_id:r.rows[0].id, after:{ name, openingId } });
  res.json({ ok:true, id:r.rows[0].id });
}));

async function loadCandidate(id) {
  const r = await db.query(`SELECT * FROM tasks WHERE id=$1 AND kind='recruitment' AND parent_task_id IS NOT NULL`, [id]);
  return r.rows[0] || null;
}

// ---------- PATCH /candidates/:id  (move stage / edit fields / standby / hire) ----------
// Body may include: stage, outcome (text captured for the round just completed),
// standby_note, name, + any CARD_FIELDS.
router.patch('/candidates/:id', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cand = await loadCandidate(id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found' });
  const meta = metaOf(cand);
  if (!Array.isArray(meta.history)) meta.history = [];
  if (!Array.isArray(meta.outcomes)) meta.outcomes = [];
  const b = req.body || {};
  const nowIso = new Date().toISOString();
  let stageChanged = false;

  if (b.stage) {
    if (!STAGES.includes(b.stage)) return res.status(400).json({ error: 'Unknown stage' });
    const prevStage = meta.stage || 'sourced';
    if (b.stage !== prevStage) {
      // capture the outcome of the round being LEFT, if given
      if (b.outcome != null && String(b.outcome).trim()) {
        meta.outcomes.push({ stage: prevStage, text: String(b.outcome).trim(), at: nowIso, by: req.user.id, by_name: whoName(req) });
      }
      meta.stage = b.stage;
      meta.history.push({ stage: b.stage, at: nowIso });
      stageChanged = true;
      if (b.stage === 'standby') meta.standby_note = b.standby_note || meta.standby_note || null;
      if (b.stage === 'accepted' && b.joining_date) meta.joining_date = b.joining_date;
      if (b.stage === 'joined') { meta.ready_to_onboard = true; meta.joined_at = nowIso; }
    }
  }
  if (b.standby_note != null) meta.standby_note = b.standby_note;
  // editable card fields
  for (const f of CARD_FIELDS) if (b[f] != null) meta[f] = b[f];
  const newTitle = (b.name != null && String(b.name).trim()) ? String(b.name).trim() : cand.title;

  await db.query(`UPDATE tasks SET title=$1, meta=$2, ${stageChanged ? 'moved_at=NOW(),' : ''} updated_at=NOW() WHERE id=$3`,
    [newTitle, JSON.stringify(meta), id]);
  await logAudit({ req, module:'recruitment', action:'candidate.updated', target_type:'task', target_id:id, after:{ stage: meta.stage } });
  res.json({ ok:true, stage: meta.stage, ready_to_onboard: !!meta.ready_to_onboard });
}));

// ---------- POST /candidates/:id/end  (reversible exit: passed | withdrew) ----------
router.post('/candidates/:id/end', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { how, reason } = req.body || {};
  if (!['passed','withdrew'].includes(how)) return res.status(400).json({ error: 'how must be passed or withdrew' });
  const cand = await loadCandidate(id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found' });
  const meta = metaOf(cand);
  meta.ended = { how, reason: reason || null, at: new Date().toISOString(), stage_at_end: meta.stage || 'sourced' };
  await db.query(`UPDATE tasks SET meta=$1, status='done', moved_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [JSON.stringify(meta), id]);
  // Soft-delete this candidate's files so the existing 90-day purge cron clears them.
  await db.query(`UPDATE files SET deleted_at=NOW(), deleted_by_user_id=$1 WHERE task_id=$2 AND deleted_at IS NULL`,
    [req.user.id, id]);
  await logAudit({ req, module:'recruitment', action:'candidate.ended', target_type:'task', target_id:id, after:{ how, reason } });
  res.json({ ok:true });
}));

// ---------- POST /candidates/:id/reopen  (undo an end — bring them back) ----------
router.post('/candidates/:id/reopen', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cand = await loadCandidate(id);
  if (!cand) return res.status(404).json({ error: 'Candidate not found' });
  const meta = metaOf(cand);
  const backTo = (meta.ended && meta.ended.stage_at_end) || meta.stage || 'sourced';
  delete meta.ended;
  meta.stage = backTo;
  await db.query(`UPDATE tasks SET meta=$1, status='open', moved_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [JSON.stringify(meta), id]);
  // Restore files soft-deleted by the end (only if still within retention).
  await db.query(`UPDATE files SET deleted_at=NULL, deleted_by_user_id=NULL
                   WHERE task_id=$1 AND deleted_at IS NOT NULL
                     AND deleted_at > NOW() - INTERVAL '90 days'`, [id]);
  await logAudit({ req, module:'recruitment', action:'candidate.reopened', target_type:'task', target_id:id, after:{ backTo } });
  res.json({ ok:true, stage: backTo });
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
  meta.notes.push({ at: new Date().toISOString(), by: req.user.id, by_name: whoName(req), text: String(text).trim() });
  await db.query(`UPDATE tasks SET meta=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(meta), id]);
  res.json({ ok:true, notes: meta.notes });
}));

// ---------- candidate files (reuse files table, task_id + drawer='candidate') ----------
// GET list
router.get('/candidates/:id/files', guard(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await db.query(
    `SELECT id, filename, mime_type, size_bytes, uploaded_at
       FROM files WHERE task_id=$1 AND deleted_at IS NULL ORDER BY uploaded_at DESC`, [id]);
  res.json({ files: r.rows });
}));

// POST upload (multipart: file)
router.post('/candidates/:id/files', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (!(await isHr(req))) return res.status(403).json({ error: 'Recruitment is for the HR team.' });
      if (err) return res.status(400).json({ error: (err && err.message) || 'Upload failed' });
      if (!req.file) return res.status(400).json({ error: 'No file received' });
      const id = parseInt(req.params.id, 10);
      const cand = await loadCandidate(id);
      if (!cand) return res.status(404).json({ error: 'Candidate not found' });
      const ins = await db.query(
        `INSERT INTO files (task_id, drawer, filename, mime_type, size_bytes, content, uploaded_by_user_id)
         VALUES ($1, 'candidate', $2, $3, $4, $5, $6)
         RETURNING id, filename, mime_type, size_bytes, uploaded_at`,
        [id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.user.id]);
      await logAudit({ req, module:'recruitment', action:'candidate.file.uploaded', target_type:'file', target_id:ins.rows[0].id, after:{ candidate:id, filename:req.file.originalname } });
      res.json({ ok:true, file: ins.rows[0] });
    } catch (e) {
      console.error('[recruitment] file upload failed:', e.message);
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

// GET stream one candidate file (inline view / download)
router.get('/files/:fileId', guard(async (req, res) => {
  const fid = parseInt(req.params.fileId, 10);
  const r = await db.query(
    `SELECT id, task_id, filename, mime_type, size_bytes, content, deleted_at
       FROM files WHERE id=$1 AND task_id IS NOT NULL`, [fid]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  const row = r.rows[0];
  if (row.deleted_at) return res.status(410).json({ error: 'File deleted' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', row.size_bytes);
  const inlineOk = ['application/pdf','image/png','image/jpeg'].includes(row.mime_type);
  res.setHeader('Content-Disposition', `${inlineOk ? 'inline' : 'attachment'}; filename="${encodeURIComponent(row.filename)}"`);
  res.send(row.content);
}));

// DELETE one candidate file (soft-delete)
router.delete('/files/:fileId', guard(async (req, res) => {
  const fid = parseInt(req.params.fileId, 10);
  const r = await db.query(`SELECT id, deleted_at FROM files WHERE id=$1 AND task_id IS NOT NULL`, [fid]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  if (r.rows[0].deleted_at) return res.status(400).json({ error: 'Already deleted' });
  await db.query(`UPDATE files SET deleted_at=NOW(), deleted_by_user_id=$1 WHERE id=$2`, [req.user.id, fid]);
  res.json({ ok:true });
}));

// ---------- GET /pointer (My Work home-base) ----------
router.get('/pointer', guard(async (req, res) => {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM tasks
      WHERE kind='recruitment' AND parent_task_id IS NOT NULL
        AND meta->'ended' IS NULL
        AND COALESCE(meta->>'stage','sourced') = ANY($1::text[])`,
    [ACTIVE_STAGES]);
  res.json({ count: r.rows[0].n });
}));

module.exports = router;
