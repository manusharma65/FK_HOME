// FK Home — HR task router (r0.25)
// ----------------------------------------------------------------------------
// Turns HR events (which already fire via notifyEvent) into TASKS in the shared
// HR queue, routed to the right owner by their hr_area, visible to both HR
// people, with cover. This is the ONE place HR routing lives.
//
// Called from notifyEvent (server/notify.js) right after a notification fires.
// It is additive and self-contained: if anything here throws, it is caught and
// logged so it never breaks the underlying event/notification.
//
// Routing (per Tanu & Deepanshi's SOPs, confirmed 1 Jun 2026):
//   daily_ops              → leave approval, regularisation, sick review,
//                            CS/Google/Ops recruitment, payroll, onboarding paperwork
//   recruitment_judgement  → probation decision, appraisal/review, KPI flag,
//                            Amazon-PPC recruitment   (senior: Tanu)
// Falls back to the whole hr-team if no one holds that area (nothing dropped).
// ----------------------------------------------------------------------------

const { db } = require('./db');

// event type -> { area, kind, category, title, contextUrl }
// area: which hr_area owns it by default
// kind: task kind (event = auto-generated)
// contextUrl(ctx): deep link to the evidence the owner needs to act
const HR_EVENT_ROUTING = {
  // r1.25 — the HR-queue task is created only AFTER the manager approves
  // (event 'leave.awaiting_hr'), not on the initial request. This is what stopped
  // every leave landing in the HR queue before a manager had seen it.
  'leave.awaiting_hr': {
    area: 'daily_ops', kind: 'event', category: 'leave',
    title: c => 'Leave to approve — ' + (c.name || 'employee'),
    body:  c => [c.range, c.daysText, 'manager approved', c.reason].filter(Boolean).join(' · '),
    contextUrl: c => '#hr/leaves',
  },
  'attendance.regularise.requested': {
    area: 'daily_ops', kind: 'event', category: 'regularisation',
    title: c => 'Attendance correction — ' + (c.name || 'employee'),
    body:  c => c.detail || 'Review the requested correction',
    contextUrl: c => '#hr/regularisations',
  },
  'sick.reported': {
    area: 'daily_ops', kind: 'event', category: 'sick',
    title: c => 'Sick review — ' + (c.name || 'employee'),
    body:  c => (c.reason || 'Off sick') + (c.paidNote || ''),
    contextUrl: c => c.actorUserId ? ('#profile/' + c.actorUserId + '/attendance') : '#hr/attendance',
  },
  'probation.end_due': {
    area: 'recruitment_judgement', kind: 'event', category: 'probation', judgement: true,
    title: c => 'Probation decision — ' + (c.name || 'employee'),
    body:  c => 'Decision due: confirm, extend, or end employment',
    contextUrl: c => c.targetUserId ? ('#profile/' + c.targetUserId + '/reviews') : '#hr/insights',
  },
};

// Resolve who owns an area right now (active hr-team members tagged with it).
// Returns { assignee, fallbackToTeam } — assignee may be null (then it's a team task).
async function ownerForArea(area) {
  try {
    const r = await db.query(
      `SELECT u.id
         FROM users u
         JOIN user_groups ug ON ug.user_id = u.id
         JOIN groups g ON g.id = ug.group_id
        WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'
          AND u.hr_area = $1
        ORDER BY u.id
        LIMIT 1`, [area]);
    return r.rows.length ? r.rows[0].id : null;
  } catch (e) {
    console.error('[hr-task-router] ownerForArea failed:', e.message);
    return null;
  }
}

// All active hr-team member ids (for the shared view + fallback).
async function hrTeamIds() {
  try {
    const r = await db.query(
      `SELECT u.id FROM users u
         JOIN user_groups ug ON ug.user_id = u.id
         JOIN groups g ON g.id = ug.group_id
        WHERE g.slug = 'hr-team' AND g.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.employment_status = 'active'`);
    return r.rows.map(x => x.id);
  } catch (e) {
    console.error('[hr-task-router] hrTeamIds failed:', e.message);
    return [];
  }
}

// Has a task already been created for this event+related_id? (idempotent — events
// can re-fire; we don't want duplicate HR tasks.)
async function alreadyExists(category, relatedId, relatedUserId) {
  if (!relatedId && !relatedUserId) return false;
  try {
    const r = await db.query(
      `SELECT 1 FROM tasks
        WHERE kind = 'event' AND category = $1
          AND status NOT IN ('done','cancelled')
          AND ( (meta->>'event_related_id') = $2
                OR ($3::int IS NOT NULL AND related_user_id = $3 AND created_at > NOW() - INTERVAL '12 hours') )
        LIMIT 1`,
      [category, relatedId != null ? String(relatedId) : null, relatedUserId || null]);
    return r.rows.length > 0;
  } catch (e) {
    console.error('[hr-task-router] alreadyExists failed:', e.message);
    return false; // on error, allow creation rather than silently swallow
  }
}

// Main entry — called after notifyEvent fires.
async function maybeCreateHrTask(eventType, ctx) {
  const route = HR_EVENT_ROUTING[eventType];
  if (!route) return; // not an HR-task event
  const c = ctx || {};
  try {
    const relatedUserId = c.actorUserId || c.targetUserId || null;
    const relatedId = c.related_id != null ? c.related_id : null;

    if (await alreadyExists(route.category, relatedId, relatedUserId)) return;

    // Who owns it? area owner, else fall back to the team (assignee = first team
    // member, but flagged shared so both see it).
    const owner = await ownerForArea(route.area);
    const team = await hrTeamIds();
    if (team.length === 0) return; // no HR team configured — nothing to route to

    // r1.25 — if the caller resolved a specific approver (the senior HR, with
    // fallback), assign the task to them so the task and the notification match.
    const assignee = (c.approverId && team.includes(c.approverId)) ? c.approverId : (owner || team[0]);

    const meta = {
      hr_area: route.area,
      shared_with: team,            // both HR see it in the shared view
      event_type: eventType,
      event_related_id: relatedId != null ? String(relatedId) : null,
      context_url: route.contextUrl ? route.contextUrl(c) : null,
      judgement: !!route.judgement,
      routed_owner: owner,          // null if it fell back to team
    };

    await db.query(
      `INSERT INTO tasks
         (kind, source, title, body, category, assignee_user_id, related_user_id,
          department_id, status, opens_at, meta)
       VALUES ($1, 'auto_event', $2, $3, $4, $5, $6,
               (SELECT id FROM departments WHERE LOWER(name) = 'hr' LIMIT 1),
               'open', NOW(), $7)`,
      [route.kind, route.title(c), route.body ? route.body(c) : null, route.category,
       assignee, relatedUserId, JSON.stringify(meta)]);
  } catch (e) {
    // Never let task-routing break the underlying event.
    console.error("[hr-task-router] maybeCreateHrTask('" + eventType + "') failed:", e.message);
  }
}

module.exports = { maybeCreateHrTask, HR_EVENT_ROUTING };
