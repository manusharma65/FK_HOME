// FK Home — /api/files/*
// ----------------------------------------------------------------------------
// Bytea-backed file storage attached to a user profile + drawer.
// Routes:
//   POST   /api/files/upload         — multipart upload (one file)
//   GET    /api/files/:id            — stream content (download)
//   GET    /api/files/:id/meta       — metadata only
//   DELETE /api/files/:id            — soft-delete
//   POST   /api/files/:id/restore    — restore (only within 90 days)
//
// Also exports tickHardPurge() — daily 03:00 cron that hard-deletes rows
// where deleted_at < NOW() - 90 days.

const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { requireAuth, logAudit } = require('../auth');
const { notifyEvent } = require('../notify');

const router = express.Router();
router.use(requireAuth);

// ---------- multer setup ----------
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
// r0.16 — narrowed to PDF + PNG only (Bobby's spec). Existing JPG/DOC/DOCX
// rows in DB remain viewable; only NEW uploads must be PDF/PNG.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
]);
const ALLOWED_DRAWERS = new Set([
  'personal','employment','salary','reviews',
  'payroll','insurance','onboarding','offboarding',
]);
const DRAWER_LABELS = {
  personal: 'Personal',
  employment: 'Employment',
  salary: 'Salary',
  reviews: 'Reviews',
  payroll: 'Payroll',
  insurance: 'Insurance',
  onboarding: 'Onboarding',
  offboarding: 'Offboarding',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('File type not allowed. Use PDF, JPG, PNG, DOC, or DOCX.'));
    }
    cb(null, true);
  },
});

// ---------- permission helper: can user upload to (targetUserId, drawer)? ----------
async function canUploadTo(viewer, targetUserId, drawer) {
  if (viewer.can('files.upload.any')) return true;
  // r1.28 — a person can upload their OWN documents to the drawers used during onboarding
  // (was 'personal' only, which blocked new hires uploading ID / contract / onboarding docs).
  // Salary, payroll, reviews, appraisals and performance stay HR-only.
  const OWN_UPLOAD_DRAWERS = ['personal','onboarding','employment','insurance'];
  if (viewer.id === targetUserId && OWN_UPLOAD_DRAWERS.includes(drawer) && viewer.can('files.upload.own')) return true;
  return false;
}

// ---------- permission helper: can user view this file? ----------
async function canViewFile(viewer, fileRow) {
  if (viewer.can('profile.view.any')) return true;
  if (viewer.id === fileRow.user_id) return true; // own
  if (viewer.can('profile.view.dept')) {
    // Same-department check
    const r = await db.query(
      `SELECT 1 FROM user_department_memberships m1
       JOIN user_department_memberships m2 ON m1.department_id = m2.department_id
       WHERE m1.user_id = $1 AND m2.user_id = $2
         AND m1.deleted_at IS NULL AND m2.deleted_at IS NULL
       LIMIT 1`,
      [viewer.id, fileRow.user_id]
    );
    if (r.rows.length > 0) return true;
  }
  // Salary drawer is gated by profile.salary.view
  if (fileRow.drawer === 'salary' && !viewer.can('profile.salary.view')) return false;
  return false;
}

// ---------- permission helper: can user delete this file? ----------
function canDeleteFile(viewer, fileRow) {
  if (viewer.can('files.delete.any')) return true;
  // Own personal-drawer file
  if (viewer.id === fileRow.user_id && fileRow.drawer === 'personal') return true;
  return false;
}

// ---------- POST /api/files/upload ----------
// multipart fields: file (the file), user_id (int), drawer (slug), description (text, optional)
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = (err && err.message) || 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received' });

    const targetUserId = parseInt(req.body.user_id, 10);
    const drawer = String(req.body.drawer || '').trim();
    const description = req.body.description ? String(req.body.description).slice(0, 500) : null;
    const profileNoteId = req.body.profile_note_id ? parseInt(req.body.profile_note_id, 10) : null;

    if (!Number.isFinite(targetUserId)) return res.status(400).json({ error: 'user_id required' });
    if (!ALLOWED_DRAWERS.has(drawer)) return res.status(400).json({ error: 'Unknown drawer' });

    const allowed = await canUploadTo(req.user, targetUserId, drawer);
    if (!allowed) return res.status(403).json({ error: 'Permission denied' });

    // Salary drawer extra: only profile.salary.edit or owner can upload there
    if (drawer === 'salary' && !req.user.can('profile.salary.edit')) {
      return res.status(403).json({ error: 'Salary drawer is restricted' });
    }

    // If linking to a profile_note, validate it belongs to the same user
    if (profileNoteId) {
      const n = await db.query(
        `SELECT id, user_id, kind FROM profile_notes WHERE id = $1`, [profileNoteId]);
      if (n.rows.length === 0) return res.status(400).json({ error: 'profile_note_id not found' });
      if (n.rows[0].user_id !== targetUserId) {
        return res.status(400).json({ error: 'profile_note_id does not match user_id' });
      }
    }

    try {
      const ins = await db.query(
        `INSERT INTO files
           (user_id, drawer, filename, mime_type, size_bytes, content, description,
            uploaded_by_user_id, profile_note_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, user_id, drawer, filename, mime_type, size_bytes, description,
                   uploaded_by_user_id, uploaded_at, profile_note_id`,
        [targetUserId, drawer, req.file.originalname, req.file.mimetype,
         req.file.size, req.file.buffer, description, req.user.id, profileNoteId]
      );
      const row = ins.rows[0];

      await logAudit({
        req, module: 'profile', action: 'file.uploaded',
        target_type: 'file', target_id: row.id,
        after: { user_id: targetUserId, drawer, filename: row.filename, size: row.size_bytes,
                 profile_note_id: profileNoteId }
      });

      // Notify the target user (unless they uploaded to themselves)
      if (targetUserId !== req.user.id) {
        await notifyEvent('profile.file.uploaded', {
          targetUserId,
          uploaderName: req.user.display_name || req.user.full_name,
          drawer,
          drawerLabel: DRAWER_LABELS[drawer] || drawer,
          filename: row.filename,
          related_id: row.id,
        });
      }

      res.json({ ok: true, file: row });
    } catch (e) {
      console.error('[files/upload] failed:', e.message);
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

// ---------- POST /api/files/:id/replace ----------
// r0.16 — Replace a file: upload new content, HARD-DELETE old row (not soft).
// Keeps the same drawer + profile_note_id link. Same permissions as upload.
router.post('/:id/replace', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = (err && err.message) || 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

    try {
      const r = await db.query(
        `SELECT id, user_id, drawer, filename, profile_note_id FROM files WHERE id = $1`,
        [id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const old = r.rows[0];

      // Same upload permission check as POST /upload
      const allowed = await canUploadTo(req.user, old.user_id, old.drawer);
      if (!allowed) return res.status(403).json({ error: 'Permission denied' });
      if (old.drawer === 'salary' && !req.user.can('profile.salary.edit')) {
        return res.status(403).json({ error: 'Salary drawer is restricted' });
      }

      // Hard-delete the old row, insert the new one
      await db.query(`DELETE FROM files WHERE id = $1`, [id]);
      const ins = await db.query(
        `INSERT INTO files
           (user_id, drawer, filename, mime_type, size_bytes, content,
            uploaded_by_user_id, profile_note_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, user_id, drawer, filename, mime_type, size_bytes,
                   uploaded_by_user_id, uploaded_at, profile_note_id`,
        [old.user_id, old.drawer, req.file.originalname, req.file.mimetype,
         req.file.size, req.file.buffer, req.user.id, old.profile_note_id]
      );
      const row = ins.rows[0];
      await logAudit({
        req, module: 'profile', action: 'file.replaced',
        target_type: 'file', target_id: row.id,
        before: { old_id: old.id, old_filename: old.filename },
        after: { user_id: old.user_id, drawer: old.drawer, filename: row.filename, size: row.size_bytes }
      });
      res.json({ ok: true, file: row });
    } catch (e) {
      console.error('[files/replace] failed:', e.message);
      res.status(500).json({ error: 'Replace failed' });
    }
  });
});

// ---------- GET /api/files/:id/meta ----------
router.get('/:id/meta', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const r = await db.query(
      `SELECT id, user_id, drawer, filename, mime_type, size_bytes, description,
              uploaded_by_user_id, uploaded_at, deleted_at, deleted_by_user_id
       FROM files WHERE id = $1`, [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = r.rows[0];
    const allowed = await canViewFile(req.user, row);
    if (!allowed) return res.status(403).json({ error: 'Permission denied' });
    res.json({ file: row });
  } catch (e) {
    console.error('[files/meta] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- GET /api/files/:id ----------
// Default: inline view (for any user with view permission)
// With ?download=1: forces attachment download — gated on profile.salary.view
// (Owner + HR only, per r0.16 spec).
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  const isDownload = req.query.download === '1' || req.query.download === 'true';
  try {
    const r = await db.query(
      `SELECT id, user_id, drawer, filename, mime_type, size_bytes, content, deleted_at
       FROM files WHERE id = $1`, [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = r.rows[0];
    const allowed = await canViewFile(req.user, row);
    if (!allowed) return res.status(403).json({ error: 'Permission denied' });
    if (row.deleted_at) return res.status(410).json({ error: 'File deleted' });

    // r0.16 — download gate: only Owner + HR can force-download. Own files exempt.
    if (isDownload && req.user.id !== row.user_id && !req.user.can('profile.salary.view')) {
      return res.status(403).json({ error: 'Download is restricted to HR' });
    }

    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', row.size_bytes);
    const inlineOk = ['application/pdf','image/jpeg','image/png'].includes(row.mime_type);
    const disposition = (isDownload || !inlineOk) ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(row.filename)}"`);
    res.send(row.content);
  } catch (e) {
    console.error('[files/get] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- DELETE /api/files/:id ----------
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const r = await db.query(
      `SELECT id, user_id, drawer, filename, deleted_at FROM files WHERE id = $1`, [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = r.rows[0];
    if (row.deleted_at) return res.status(400).json({ error: 'Already deleted' });
    if (!canDeleteFile(req.user, row)) return res.status(403).json({ error: 'Permission denied' });

    await db.query(
      `UPDATE files SET deleted_at = NOW(), deleted_by_user_id = $1 WHERE id = $2`,
      [req.user.id, id]
    );
    await logAudit({
      req, module: 'profile', action: 'file.deleted',
      target_type: 'file', target_id: id,
      before: { user_id: row.user_id, drawer: row.drawer, filename: row.filename }
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[files/delete] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- POST /api/files/:id/restore ----------
router.post('/:id/restore', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const r = await db.query(
      `SELECT id, user_id, drawer, filename, deleted_at FROM files WHERE id = $1`, [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = r.rows[0];
    if (!row.deleted_at) return res.status(400).json({ error: 'Not deleted' });
    if (!canDeleteFile(req.user, row)) return res.status(403).json({ error: 'Permission denied' });

    // Refuse if older than 90 days (cron may have already purged anyway)
    const ageMs = Date.now() - new Date(row.deleted_at).getTime();
    if (ageMs > 90 * 24 * 3600 * 1000) {
      return res.status(400).json({ error: 'Deleted more than 90 days ago — cannot restore' });
    }

    await db.query(
      `UPDATE files SET deleted_at = NULL, deleted_by_user_id = NULL WHERE id = $1`, [id]
    );
    await logAudit({
      req, module: 'profile', action: 'file.restored',
      target_type: 'file', target_id: id,
      after: { user_id: row.user_id, drawer: row.drawer, filename: row.filename }
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[files/restore] failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- tickHardPurge — daily 03:00 cron ----------
async function tickHardPurge() {
  try {
    const r = await db.query(
      `DELETE FROM files
       WHERE deleted_at IS NOT NULL
         AND deleted_at < NOW() - INTERVAL '90 days'
       RETURNING id`
    );
    if (r.rows.length > 0) {
      console.log(`[cron file-purge] hard-deleted ${r.rows.length} file(s) past 90-day retention`);
    }
  } catch (e) {
    console.error('[cron file-purge] failed:', e.message);
  }
}

module.exports = router;
module.exports.tickHardPurge = tickHardPurge;
