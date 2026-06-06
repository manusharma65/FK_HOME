// FK Home — /api/leaves/*
//   POST /api/leaves/request          — submit a leave request
//   POST /api/leaves/:id/cancel       — cancel your own pending request
//   GET  /api/leaves/mine             — list your own requests
//   GET  /api/leaves/pending          — pending requests visible to you (manager/HR view)
//   POST /api/leaves/:id/decide       — approve or reject (manager/HR)

const express = require('express');
const { db } = require('../db');
const { requireAuth, logAudit } = require('../auth');
const { notify, notifyManagersOf, notifyEvent } = require('../notify');
const leaveEngine = require('./leave-engine');

const router = express.Router();
router.use(requireAuth);

// Helper — count business days inclusive
function businessDaysBetween(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  let days = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) days++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// Helpers for notification text
function formatDateUK(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function formatDays(n) {
  const num = Number(n);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

// Helper — recompute leave balance after a request changes status.
// r0.21 (HR-1.5 fix) — anniversary model: update the CURRENT leave-year row
// (keyed by leave_year_start) and count taken/pending only WITHIN that year
// (since the last hire-anniversary), not the calendar year.
async function recomputeBalance(userId) {
  const today = leaveEngine.nowLondonDate ? leaveEngine.nowLondonDate() : new Date().toISOString().slice(0, 10);
  const u = await db.query(`SELECT to_char(hire_date, 'YYYY-MM-DD') AS hire_date FROM users WHERE id = $1`, [userId]);
  const hire = u.rows[0] && u.rows[0].hire_date ? u.rows[0].hire_date : null;
  if (!hire) return; // no hire_date → engine owns nothing to recompute
  const anniv = leaveEngine.lastAnniversary(hire, today);
  if (!anniv) return; // invalid date → nothing to recompute (don't crash)

  const r = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status='approved' THEN total_days END), 0) AS taken,
       COALESCE(SUM(CASE WHEN status='pending'  THEN total_days END), 0) AS pending
     FROM leave_requests
     WHERE user_id = $1
       AND start_date >= $2
       AND request_type = 'annual'`,
    [userId, anniv]
  );
  const taken = Number(r.rows[0].taken);
  const pending = Number(r.rows[0].pending);
  await db.query(
    `UPDATE leave_balances SET taken_days = $1, pending_days = $2, updated_at = NOW()
     WHERE user_id = $3 AND leave_year_start = $4`,
    [taken, pending, userId, anniv]
  );
}

// ---------- REQUEST ----------
router.post('/request', async (req, res) => {
  if (!req.user.can('me.leaves.request')) return res.status(403).json({ error: 'Permission denied' });
  const { request_type, start_date, end_date, reason, is_half_day, half_day_part } = req.body || {};
  const type = request_type || 'annual';
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  }
  if (end_date < start_date) return res.status(400).json({ error: 'end_date must be >= start_date' });

  const totalDays = is_half_day && start_date === end_date ? 0.5 : businessDaysBetween(start_date, end_date);
  if (totalDays <= 0) return res.status(400).json({ error: 'No working days in that range' });

  try {
    // r0.31 — block overlapping requests. A pending or approved leave that
    // intersects [start_date, end_date] means this is a duplicate/clashing ask.
    const clash = await db.query(
      `SELECT id, start_date, end_date, status FROM leave_requests
        WHERE user_id = $1
          AND status IN ('pending','approved')
          AND start_date <= $3::date AND end_date >= $2::date
        LIMIT 1`,
      [req.user.id, start_date, end_date]);
    if (clash.rows.length) {
      const c = clash.rows[0];
      return res.status(409).json({
        error: 'You already have a ' + c.status + ' leave request that overlaps those dates ('
          + String(c.start_date).slice(0,10) + ' → ' + String(c.end_date).slice(0,10)
          + '). Cancel or edit that one first.'
      });
    }

    const r = await db.query(
      `INSERT INTO leave_requests
         (user_id, request_type, start_date, end_date, total_days, is_half_day, half_day_part, reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING *`,
      [req.user.id, type, start_date, end_date, totalDays, !!is_half_day, half_day_part || null, reason || null]
    );
    // r0.21 (HR-1.5 fix) — anniversary model. The engine owns balance rows
    // (keyed by leave_year_start), so we no longer invent a flat-25 calendar
    // row here. Ensure the current leave-year row exists by asking the engine
    // to recompute it from accrual, then update taken/pending.
    // The request is saved above. Derivative updates + notifications must NEVER
    // fail the response — a recompute crash here is exactly what made Tanu's
    // "leave assigned but the screen did nothing" happen.
    try {
      await leaveEngine.recomputeBalanceFor(req.user.id, { note: 'Ensure balance row on leave request' });
      await recomputeBalance(req.user.id);
    } catch (e) { console.error('[leaves/request] balance recompute failed:', e.message); }

    try {
      await logAudit({ req, module: 'leaves', action: 'request.created', target_type: 'leave_request', target_id: r.rows[0].id, after: r.rows[0] });
    } catch (e) { console.error('[leaves/request] audit failed:', e.message); }

    try {
      const range = start_date === end_date
        ? formatDateUK(start_date)
        : `${formatDateUK(start_date)} → ${formatDateUK(end_date)}`;
      const daysText = `${formatDays(totalDays)} day${totalDays === 1 ? '' : 's'}`;
      await notifyEvent('leave.requested', {
        actorUserId: req.user.id,
        name: req.user.display_name || req.user.full_name,
        range, daysText, reason: reason || null,
        related_id: r.rows[0].id,
      });
    } catch (e) { console.error('[leaves/request] notify failed:', e.message); }

    res.json({ ok: true, request: r.rows[0] });
  } catch (err) {
    console.error('[leaves/request] error:', err);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// ---------- CANCEL OWN ----------
router.post('/:id/cancel', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });

  try {
    const r = await db.query(`SELECT * FROM leave_requests WHERE id = $1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const lr = r.rows[0];

    if (lr.user_id !== req.user.id) return res.status(403).json({ error: 'Not your request' });
    if (lr.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be cancelled' });

    await db.query(
      `UPDATE leave_requests SET status='cancelled', updated_at=NOW() WHERE id=$1`,
      [id]
    );
    await recomputeBalance(lr.user_id);

    // r0.31 — cancel the routed HR-queue task too (the ask is withdrawn).
    try {
      await db.query(
        `UPDATE tasks SET status='cancelled', updated_at=NOW()
          WHERE kind='event' AND category='leave'
            AND (meta->>'event_related_id') = $1
            AND status NOT IN ('done','cancelled')`,
        [String(id)]);
    } catch (e) { console.error('[leaves/cancel] close routed task failed:', e.message); }

    await logAudit({ req, module: 'leaves', action: 'request.cancelled', target_type: 'leave_request', target_id: id, before: lr });
    res.json({ ok: true });
  } catch (err) {
    console.error('[leaves/cancel] error:', err);
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

// ---------- LIST OWN ----------
//   ?user_id=X — view another user's leaves. Requires leaves.view.any or
//                leaves.view.dept (target must be in your dept).
router.get('/mine', async (req, res) => {
  try {
    let targetUserId = req.user.id;
    if (req.query.user_id) {
      const requested = parseInt(req.query.user_id, 10);
      if (!Number.isFinite(requested)) {
        return res.status(400).json({ error: 'user_id must be a number' });
      }
      if (requested !== req.user.id) {
        const canAny = req.user.can('leaves.view.any');
        const canDept = req.user.can('leaves.view.dept');
        if (!canAny && !canDept) {
          return res.status(403).json({ error: 'Cannot view other users' });
        }
        if (canDept && !canAny) {
          const sameDept = await db.query(
            `SELECT 1 FROM user_department_memberships m1
             JOIN user_department_memberships m2 ON m1.department_id = m2.department_id
             WHERE m1.user_id = $1 AND m2.user_id = $2
               AND m1.deleted_at IS NULL AND m2.deleted_at IS NULL
             LIMIT 1`,
            [req.user.id, requested]
          );
          if (sameDept.rows.length === 0) {
            return res.status(403).json({ error: 'User is not in your department' });
          }
        }
        targetUserId = requested;
      }
    }

    const r = await db.query(
      `SELECT id, request_type, start_date, end_date, total_days, is_half_day, half_day_part,
              reason, status, decision_note, decided_at, created_at
       FROM leave_requests WHERE user_id = $1
       ORDER BY start_date DESC LIMIT 50`,
      [targetUserId]
    );

    // Balance comes from the leave engine (handles adjustments + correct remaining math).
    const balance = await leaveEngine.getBalance(targetUserId);

    // Map columns for the frontend (keep both names for compatibility):
    const rows = r.rows.map(x => ({
      ...x,
      leave_type: x.request_type,
      days: x.total_days,
    }));
    res.json({ requests: rows, balance, user_id: targetUserId });
  } catch (err) {
    console.error('[leaves/mine] failed:', err.message);
    res.status(500).json({ error: 'Failed to list requests' });
  }
});

// ---------- PENDING (manager / HR) ----------
router.get('/pending', async (req, res) => {
  const canAny = req.user.can('leaves.approve.any');
  const canDept = req.user.can('leaves.approve.dept');
  if (!canAny && !canDept) return res.status(403).json({ error: 'Permission denied' });

  try {
    let query, params;
    if (canAny) {
      query = `
        SELECT lr.*, u.full_name AS user_full_name, u.display_name AS user_display_name,
               u.initials AS user_initials, u.avatar_colour AS user_avatar_colour
        FROM leave_requests lr JOIN users u ON u.id = lr.user_id
        WHERE lr.status = 'pending'
        ORDER BY lr.start_date`;
      params = [];
    } else {
      // Dept managers see requests for users in their managed departments
      const managedDeptIds = req.user.departments
        .filter(d => d.role === 'manager' || d.role === 'lead')
        .map(d => d.id);
      if (managedDeptIds.length === 0) return res.json({ requests: [] });
      query = `
        SELECT DISTINCT lr.*, u.full_name AS user_full_name, u.display_name AS user_display_name,
               u.initials AS user_initials, u.avatar_colour AS user_avatar_colour
        FROM leave_requests lr
        JOIN users u ON u.id = lr.user_id
        JOIN user_department_memberships m ON m.user_id = u.id AND m.deleted_at IS NULL
        WHERE lr.status = 'pending' AND m.department_id = ANY($1::int[])
        ORDER BY lr.start_date`;
      params = [managedDeptIds];
    }
    const r = await db.query(query, params);

    // r0.19 (Ship C) — attach each requester's leave balance so the manager can
    // see remaining days and the post-approval figure right on the request,
    // without clicking away. Uses the same engine as /mine (adjustments-aware).
    // De-dupe getBalance calls per user_id since a manager may have several
    // pending requests from the same person.
    const balanceCache = {};
    const rows = [];
    for (const row of r.rows) {
      if (!(row.user_id in balanceCache)) {
        try {
          balanceCache[row.user_id] = await leaveEngine.getBalance(row.user_id);
        } catch (e) {
          console.error('[leaves/pending] getBalance failed for user', row.user_id, e.message);
          balanceCache[row.user_id] = null;
        }
      }
      rows.push({ ...row, balance: balanceCache[row.user_id] });
    }
    res.json({ requests: rows });
  } catch (err) {
    console.error('[leaves/pending] error:', err);
    res.status(500).json({ error: 'Failed to list pending' });
  }
});

// ---------- APPROVE / REJECT ----------
router.post('/:id/decide', async (req, res) => {
  const canAny = req.user.can('leaves.approve.any');
  const canDept = req.user.can('leaves.approve.dept');
  if (!canAny && !canDept) return res.status(403).json({ error: 'Permission denied' });

  const id = parseInt(req.params.id, 10);
  const { decision, decision_note } = req.body || {};
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });

  try {
    const r = await db.query(`SELECT * FROM leave_requests WHERE id = $1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const lr = r.rows[0];
    if (lr.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be decided' });

    // If dept-only manager, check they manage this user's dept
    if (!canAny) {
      const managedDeptIds = req.user.departments
        .filter(d => d.role === 'manager' || d.role === 'lead')
        .map(d => d.id);
      const userDepts = await db.query(
        `SELECT department_id FROM user_department_memberships WHERE user_id = $1 AND deleted_at IS NULL`,
        [lr.user_id]
      );
      const overlap = userDepts.rows.some(x => managedDeptIds.includes(x.department_id));
      if (!overlap) return res.status(403).json({ error: 'You do not manage this user\'s department' });
    }

    await db.query(
      `UPDATE leave_requests
       SET status = $1, decided_by_user_id = $2, decided_at = NOW(), decision_note = $3, updated_at = NOW()
       WHERE id = $4`,
      [decision, req.user.id, decision_note || null, id]
    );

    // r0.31 — the leave decision is the single source of truth. Close the HR-queue
    // task the router created for this leave (matched by event_related_id) so it
    // doesn't linger as "open" after the leave is decided.
    try {
      await db.query(
        `UPDATE tasks
            SET status = 'done', completed_at = NOW(), completed_by_user_id = $1, updated_at = NOW()
          WHERE kind = 'event' AND category = 'leave'
            AND (meta->>'event_related_id') = $2
            AND status NOT IN ('done','cancelled')`,
        [req.user.id, String(id)]);
    } catch (e) {
      console.error('[leaves/decide] close routed task failed:', e.message);
    }

    const year = new Date(lr.start_date).getFullYear();
    const startStr = new Date(lr.start_date).toISOString().slice(0, 10);
    const endStr = new Date(lr.end_date).toISOString().slice(0, 10);

    // Balance recompute is a derivative cache update — never let it fail the
    // decision (which is already committed above).
    try { await recomputeBalance(lr.user_id); }
    catch (e) { console.error('[leaves/decide] recomputeBalance failed:', e.message); }

    // Log to accrual ledger so the take is visible in audit history.
    if (decision === 'approved') {
      try {
        await db.query(
          `INSERT INTO leave_accrual_log
             (user_id, year, event_date, event_type, days_delta, note, actor_user_id)
           VALUES ($1, $2, $3, 'leave_taken', $4, $5, $6)`,
          [lr.user_id, year, startStr,
           -Number(lr.total_days), `Leave request #${id} approved by ${req.user.full_name}`,
           req.user.id]
        );
      } catch (e) {
        console.error('[leaves/decide] accrual-log insert failed:', e.message);
      }
      // r0.15 (HR-1.5) — recompute weekend pay for every Mon–Sun week
      // overlapping this leave, in case it pushes the week below 5 days.
      try {
        const r = await leaveEngine.recomputeWeekendPayForRange(lr.user_id, startStr, endStr);
        console.log(`[leaves/decide] weekend pay recomputed for user ${lr.user_id} weeks=${r.weeks || 0}`);
      } catch (e) {
        console.error('[leaves/decide] weekend recompute failed:', e.message);
      }
    }

    // Decision is saved above — audit + notify must never 500 the response
    // (this is what made approve/reject "do nothing" while actually working).
    try {
      await logAudit({
        req, module: 'leaves',
        action: decision === 'approved' ? 'request.approved' : 'request.rejected',
        target_type: 'leave_request', target_id: id,
        before: { status: lr.status }, after: { status: decision, decision_note }
      });
    } catch (e) { console.error('[leaves/decide] audit failed:', e.message); }

    try {
      const range2 = lr.start_date === lr.end_date
        ? formatDateUK(lr.start_date)
        : `${formatDateUK(lr.start_date)} → ${formatDateUK(lr.end_date)}`;
      const daysText2 = `${formatDays(lr.total_days)} day${Number(lr.total_days) === 1 ? '' : 's'}`;
      await notifyEvent(decision === 'approved' ? 'leave.approved' : 'leave.rejected', {
        actorUserId: lr.user_id,
        range: range2, daysText: daysText2,
        decisionNote: decision_note || null,
        related_id: id,
      });
    } catch (e) { console.error('[leaves/decide] notify failed:', e.message); }

    res.json({ ok: true });
  } catch (err) {
    console.error('[leaves/decide] error:', err);
    res.status(500).json({ error: 'Failed to decide' });
  }
});

module.exports = router;
