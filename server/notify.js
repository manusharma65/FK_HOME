// FK Home — notification helper
// ----------------------------------------------------------------------------
// Three public functions:
//   notify({userIds, type, title, body, ...})  — raw insert, used internally
//   notifyManagersOf(userId, opts)             — escalation fan-out
//   notifyEvent(eventType, ctx)                — TEMPLATE-driven; preferred
//
// notifyEvent is the recommended way to fire notifications going forward.
// It centralises the title/body strings so we don't hand-roll templates at
// every call site (which is how we ended up with "User has been idle...").
//
// To add a new event: drop a row in TEMPLATES below + call notifyEvent.

const { db } = require('./db');

// ---------- TEMPLATES registry ----------
// title/body are functions of `ctx`. They MUST handle missing keys gracefully.
// recipients is a function that returns: 'managers_of:<userId>' to fan out to
// managers/owner/HR of that user, or an array of userIds.

const TEMPLATES = {
  // Leaves
  'leave.requested': {
    title: c => c.name + ' requested leave',
    body:  c => c.range + ' \u00b7 ' + c.daysText + (c.reason ? ' \u00b7 ' + c.reason : ''),
    recipients: c => 'managers_of:' + c.actorUserId,
    action_url: c => '/admin.html#leaves',
    related_type: 'leave_request',
  },
  'leave.approved': {
    title: c => 'Your leave was approved',
    body:  c => c.range + ' \u00b7 ' + c.daysText + (c.decisionNote ? ' \u00b7 ' + c.decisionNote : ''),
    recipients: c => [c.actorUserId],
    action_url: c => '/',
    related_type: 'leave_request',
  },
  'leave.rejected': {
    title: c => 'Your leave was not approved',
    body:  c => c.range + ' \u00b7 ' + c.daysText + (c.decisionNote ? ' \u00b7 ' + c.decisionNote : ''),
    recipients: c => [c.actorUserId],
    action_url: c => '/',
    related_type: 'leave_request',
  },

  // r0.14 — Birthday pre-notify (HR only, one day before)
  'birthday.upcoming': {
    title: c => 'Birthday tomorrow: ' + c.name,
    body:  c => c.name + ' turns ' + c.age + ' tomorrow (' + c.dateText + ').',
    recipients: c => 'group:hr-team',
    action_url: c => '/',
    related_type: 'birthday',
  },

  // Lateness / sick
  'lateness.reported': {
    title: c => c.name + ' is running late',
    body:  c => 'Arriving ' + c.estimatedArrival + (c.reason ? ' \u00b7 ' + c.reason : ''),
    recipients: c => 'managers_of:' + c.actorUserId,
    action_url: c => '/',
    related_type: 'lateness_log',
  },
  'sick.reported': {
    title: c => c.name + ' is off sick today',
    body:  c => (c.reason || 'No further detail') + (c.paidNote || ''),
    recipients: c => 'managers_of:' + c.actorUserId,
    action_url: c => '/',
    related_type: 'sick_log',
  },

  // r0.14 — Status nudges (sitting too long on a transient status)
  'status.self_nudge': {
    title: c => 'Still "' + c.statusLabel + '"?',
    body:  c => 'You\'ve been on "' + c.statusLabel + '" for an hour. If you\'re back, switch yourself to Active.',
    recipients: c => [c.targetUserId],
    action_url: c => '/',
    related_type: 'status_nudge',
  },
  'status.manager_escalation': {
    title: c => c.name + ' still on "' + c.statusLabel + '"',
    body:  c => c.name + ' has been on "' + c.statusLabel + '" for over 90 minutes.',
    recipients: c => 'managers_of:' + c.actorUserId,
    action_url: c => '/',
    related_type: 'status_nudge',
  },

  // Attendance idle / regularisation
  'attendance.idle_extended': {
    title: c => c.name + ' idle for 20+ minutes',
    body:  c => c.name + ' has been idle since ' + c.sinceLocalTime,
    recipients: c => 'managers_of:' + c.actorUserId,
    action_url: c => '/',
    related_type: 'idle_event',
  },
  'attendance.late_arrival': {
    title: c => c.name + ' is late (not logged in)',
    body:  c => 'Expected at ' + c.expectedTime + ', now ' + c.nowTime,
    recipients: c => 'managers_of:' + c.actorUserId,
    action_url: c => '/',
    related_type: 'attendance_day',
  },
  'attendance.no_show': {
    title: c => c.name + ' no-show alert',
    body:  c => 'Expected at ' + c.expectedTime + ', ' + c.nowTime + ' now — no login yet',
    recipients: c => 'managers_of:' + c.actorUserId,
    action_url: c => '/',
    related_type: 'attendance_day',
  },
  'attendance.regularise.requested': {
    title: c => c.name + ' submitted an attendance correction',
    body:  c => c.forDate + ' \u00b7 ' + (c.reason || ''),
    recipients: c => 'managers_of:' + c.actorUserId,
    action_url: c => '/admin.html#regularisation',
    related_type: 'attendance_regularisation',
  },
  'attendance.regularise.decided': {
    title: c => 'Your attendance adjustment was ' + c.newStatus,
    body:  c => c.note || (c.decision === 'approve' ? 'Approved.' : 'Denied.'),
    recipients: c => [c.targetUserId],
    action_url: c => '/',
    related_type: 'attendance_regularisation',
  },
  'hr.chronic_idle_flagged': {
    title: c => 'Chronic idle pattern: ' + (c.targetName || 'user'),
    body:  c => c.daysAffected + ' days with 2+ idle events in the last 14 days',
    recipients: c => c.hrUserIds || [],
    action_url: c => '/admin.html#chronic-idle',
    related_type: 'hr_chronic_idle_flag',
  },

  // r0.20.2 — WFH set with location (notify owner + HR so they can see where)
  'status.wfh_set': {
    title: c => c.name + ' set Working from home',
    body:  c => c.hasLocation ? 'Location captured \u00b7 view on their status' : 'No location captured',
    recipients: c => c.userIds || [],
    action_url: c => '/',
    related_type: 'status_wfh',
  },

  // System
  'system.welcome': {
    title: c => 'Welcome to FK Home',
    body:  c => "You'll be asked to change your password on first login.",
    recipients: c => [c.targetUserId],
    action_url: c => '/',
    related_type: null,
  },

  // Chat
  'chat.message': {
    title: c => c.isDm
      ? c.senderName + ' sent you a message'
      : c.senderName + ' in ' + c.channelName,
    body:  c => c.bodyPreview,
    recipients: c => c.userIds || [],
    action_url: c => '/chat.html?channel=' + c.channelId,
    related_type: 'chat_message',
  },

  // Lifecycle — task notifications (r0.10)
  'task.opened': {
    title: c => 'Task open: ' + c.taskTitle,
    body:  c => c.reason === 'orchestrator'
      ? 'You need to arrange this. Reviewer is doing the writing.'
      : 'You need to fill this review in.',
    recipients: c => [c.targetUserId],
    action_url: c => c.relatedUserId ? '/profile.html?id=' + c.relatedUserId + '#reviews' : '/',
    related_type: 'task',
  },
  'task.due': {
    title: c => 'Due today: ' + c.taskTitle,
    body:  c => c.reason === 'orchestrator'
      ? 'This was due today. Make sure it gets done.'
      : 'This review is due today.',
    recipients: c => [c.targetUserId],
    action_url: c => c.relatedUserId ? '/profile.html?id=' + c.relatedUserId + '#reviews' : '/',
    related_type: 'task',
  },
  'task.overdue': {
    title: c => 'OVERDUE: ' + c.taskTitle,
    body:  c => c.reason === 'orchestrator'
      ? 'This is now overdue. Please chase it up.'
      : 'This review is now overdue. Please complete it as soon as possible.',
    recipients: c => [c.targetUserId],
    action_url: c => c.relatedUserId ? '/profile.html?id=' + c.relatedUserId + '#reviews' : '/',
    related_type: 'task',
  },
  'schedule.generated': {
    title: c => 'New review tasks scheduled',
    body:  c => 'You have ' + c.taskCount + ' new review task(s) assigned over the coming months.',
    recipients: c => [c.targetUserId],
    action_url: c => '/',
    related_type: 'task',
  },
  'probation.confirmed': {
    title: c => c.targetName + ' passed probation',
    body:  c => 'Probation marked as confirmed by ' + c.actorName + '.',
    recipients: c => c.hrUserIds || [],
    action_url: c => '/profile.html?id=' + c.targetUserId,
    related_type: 'user',
  },
  'probation.end_due': {
    title: c => c.subjectName + '\u2019s probation period has ended',
    body:  c => 'Their 6-month probation date is today or earlier. Confirm, extend, or end employment.',
    recipients: c => [c.targetUserId],
    action_url: c => '/profile.html?id=' + c.subjectUserId,
    related_type: 'user',
  },

  // Daily report review
  'report.flagged.agent': {
    title: c => 'Your daily report was flagged',
    body:  c => c.forDate + (c.comment ? ' \u00b7 ' + c.comment : ''),
    recipients: c => [c.targetUserId],
    action_url: c => '/my-growth.html',
    related_type: 'daily_report',
  },
  'report.flagged.hr': {
    title: c => 'Daily report flagged: ' + c.targetName,
    body:  c => c.reviewerName + ' marked ' + c.forDate + ' Not satisfactory.' + (c.comment ? ' "' + String(c.comment).slice(0, 120) + '"' : ''),
    recipients: c => c.hrUserIds || [],
    action_url: c => '/admin.html#reports',
    related_type: 'daily_report',
  },

  // Profile (r0.9)
  'profile.file.uploaded': {
    title: c => c.uploaderName + ' added a document to your profile',
    body:  c => c.drawerLabel + ' \u00b7 ' + c.filename,
    recipients: c => [c.targetUserId],
    action_url: c => '/profile.html?id=' + c.targetUserId + '#' + c.drawer,
    related_type: 'file',
  },
  'profile.note.added': {
    title: c => c.authorName + ' added a ' + c.kindLabel + ' note to your profile',
    body:  c => c.noteTitle,
    recipients: c => [c.targetUserId],
    action_url: c => '/profile.html?id=' + c.targetUserId + '#' + c.kind,
    related_type: 'profile_note',
  },
  'profile.onboarding.completed': {
    title: c => 'Onboarding item ticked: ' + c.targetName,
    body:  c => c.completerName + ' marked "' + c.noteTitle + '" complete',
    recipients: c => c.hrUserIds || [],
    action_url: c => '/profile.html?id=' + c.targetUserId + '#onboarding',
    related_type: 'profile_note',
  },
};

// ---------- Raw notify ----------
async function notify({ userIds, type, title, body, action_url, related_user_id, related_type, related_id }) {
  if (!userIds || userIds.length === 0) return;
  const uniq = [...new Set(userIds.filter(Boolean))];
  if (uniq.length === 0) return;

  try {
    const values = [];
    const params = [];
    let p = 1;
    for (const uid of uniq) {
      values.push('($' + (p++) + ', $' + (p++) + ', $' + (p++) + ', $' + (p++) + ', $' + (p++) + ', $' + (p++) + ', $' + (p++) + ', $' + (p++) + ')');
      params.push(
        uid,
        type,
        title,
        body || null,
        action_url || null,
        related_user_id || null,
        related_type || null,
        related_id ? String(related_id) : null
      );
    }
    const sql =
      'INSERT INTO notifications ' +
      '(user_id, type, title, body, action_url, related_user_id, related_type, related_id) ' +
      'VALUES ' + values.join(', ');
    await db.query(sql, params);
  } catch (err) {
    console.error('[notify] failed:', err.message);
  }
}

// ---------- Escalation recipients ----------
async function getEscalationRecipients(actorUserId) {
  try {
    const r = await db.query(
      "WITH actor_depts AS (" +
      "  SELECT department_id FROM user_department_memberships " +
      "  WHERE user_id = $1 AND deleted_at IS NULL" +
      "), " +
      "dept_managers AS (" +
      "  SELECT DISTINCT m.user_id FROM user_department_memberships m " +
      "  JOIN actor_depts ad ON ad.department_id = m.department_id " +
      "  WHERE m.role IN ('manager','lead') AND m.deleted_at IS NULL" +
      "), " +
      "owners AS (SELECT DISTINCT ug.user_id FROM user_groups ug " +
      "  JOIN groups g ON g.id = ug.group_id WHERE g.slug = 'owner'), " +
      "company_managers AS (SELECT DISTINCT ug.user_id FROM user_groups ug " +
      "  JOIN groups g ON g.id = ug.group_id WHERE g.slug = 'company-manager'), " +
      "hr AS (SELECT DISTINCT ug.user_id FROM user_groups ug " +
      "  JOIN groups g ON g.id = ug.group_id WHERE g.slug = 'hr-team') " +
      "SELECT DISTINCT user_id FROM (" +
      "  SELECT user_id FROM dept_managers UNION " +
      "  SELECT user_id FROM owners UNION " +
      "  SELECT user_id FROM company_managers UNION " +
      "  SELECT user_id FROM hr" +
      ") all_recipients WHERE user_id <> $1",
      [actorUserId]
    );
    return r.rows.map(x => x.user_id);
  } catch (err) {
    console.error('[notify] getEscalationRecipients failed:', err.message);
    return [];
  }
}

async function notifyManagersOf(actorUserId, opts) {
  const userIds = await getEscalationRecipients(actorUserId);
  if (userIds.length === 0) return;
  await notify(Object.assign({}, opts, { userIds, related_user_id: actorUserId }));
}

// r0.14 — resolve all active members of a permission group by slug
// (e.g. 'hr-team'). Used for the 'group:<slug>' recipient pattern.
async function getGroupMembers(groupSlug) {
  try {
    const r = await db.query(
      "SELECT DISTINCT ug.user_id FROM user_groups ug " +
      "JOIN groups g ON g.id = ug.group_id " +
      "JOIN users u ON u.id = ug.user_id " +
      "WHERE g.slug = $1 AND u.deleted_at IS NULL AND u.employment_status = 'active'",
      [groupSlug]
    );
    return r.rows.map(x => x.user_id);
  } catch (err) {
    console.error('[notify] getGroupMembers failed:', err.message);
    return [];
  }
}

// ---------- notifyEvent: template-driven ----------
async function notifyEvent(eventType, ctx) {
  const tpl = TEMPLATES[eventType];
  if (!tpl) {
    console.error('[notify] unknown event type: ' + eventType);
    return;
  }
  try {
    const c = ctx || {};
    const title = tpl.title(c);
    const body  = tpl.body ? tpl.body(c) : null;
    const action_url = tpl.action_url ? tpl.action_url(c) : null;
    const recipients = tpl.recipients(c);

    let userIds;
    if (typeof recipients === 'string' && recipients.indexOf('managers_of:') === 0) {
      const actorId = parseInt(recipients.split(':')[1], 10);
      userIds = await getEscalationRecipients(actorId);
    } else if (typeof recipients === 'string' && recipients.indexOf('group:') === 0) {
      // r0.14 — notify every active member of a permission group, e.g. 'group:hr-team'
      const slug = recipients.split(':')[1];
      userIds = await getGroupMembers(slug);
    } else if (Array.isArray(recipients)) {
      userIds = recipients.filter(x => Number.isFinite(x));
    } else {
      userIds = [];
    }
    if (userIds.length === 0) return;

    await notify({
      userIds,
      type: eventType,
      title,
      body,
      action_url,
      related_user_id: c.actorUserId || c.targetUserId || null,
      related_type: tpl.related_type || null,
      related_id: c.related_id || null,
    });
  } catch (err) {
    console.error("[notify] notifyEvent('" + eventType + "') failed:", err.message);
  }
}

module.exports = { notify, notifyManagersOf, getEscalationRecipients, getGroupMembers, notifyEvent };
