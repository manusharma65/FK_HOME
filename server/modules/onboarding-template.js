// FK Home — India onboarding template + the profile→onboarding auto-sync.
// One standard checklist, applied automatically when a user is created.
// Items linked to a profile field auto-advance when that field is filled in
// My details, so the joiner never enters anything twice.

const { db } = require('../db');
const { notify } = require('../notify');

// group | title | body (the "why") | required | field (profile link) | sort
const INDIA_ONBOARDING = [
  // 1. The basics
  ['The basics', 'Profile photo', 'A clear, friendly headshot, shoulders up, plain background. This becomes your profile picture and your FK ID badge — so pick a good one!', true, 'photo', 10],
  ['The basics', 'Personal details', 'Date of birth, blood group, personal email and mobile. Fill these in My details — takes a minute, and the blood group could matter one day.', true, 'personal', 20],
  ['The basics', 'Emergency contact', 'One person we can call if something happens — their name, how they are related, and their number.', true, 'emergency_contact', 30],
  // 2. So you get paid
  ['So you get paid', 'Your bank account', 'Account holder name (exactly as the bank has it), bank name, account number and IFSC. A small mismatch here is the #1 cause of a delayed first salary.', true, 'bank', 40],
  ['So you get paid', 'Cancelled cheque or passbook', 'A photo of a cancelled cheque, or your passbook first page, so Accounts can verify the account.', true, null, 50],
  ['So you get paid', 'PAN', 'Your PAN number (fill it in My details) plus a clear photo of the card. We need this for payroll and TDS — salary genuinely cannot be processed without it, so do it first.', true, 'pan', 60],
  // 3. Identity & statutory
  ['Identity & statutory', 'Aadhaar', 'A clear photo of the front and back. Used to confirm your identity and to set up your PF.', true, null, 70],
  ['Identity & statutory', 'UAN (Provident Fund)', 'Worked somewhere before? Share your UAN and we will continue your PF. First job? Mark this not applicable.', false, null, 80],
  // 4. From your last job
  ['From your last job', 'Relieving / experience letter', 'From your previous employer, confirming your last working day. Mark not applicable if we are your first job.', false, null, 90],
  ['From your last job', 'Last payslip / Form 12B', 'If you joined us partway through the tax year, this helps us get your tax right so you are not over-deducted.', false, null, 100],
  // 5. To sign
  ['To sign', 'Signed offer letter', 'Sign your offer letter and upload the signed copy back here.', true, null, 110],
];

// Linked fields that need no HR check → auto-verify when filled.
const AUTO_VERIFY_FIELDS = new Set(['photo', 'personal', 'emergency_contact']);
// Linked fields HR must check → auto-submit when filled, then HR verifies.
const AUTO_SUBMIT_FIELDS = new Set(['bank', 'pan']);

// Apply the template to a freshly-created user. Idempotent: skips if they
// already have onboarding items.
async function applyOnboardingTemplate(userId, authorUserId) {
  const exists = await db.query(
    `SELECT 1 FROM profile_notes WHERE user_id = $1 AND kind = 'onboarding' LIMIT 1`, [userId]
  );
  if (exists.rows.length > 0) return;
  for (const [group, title, body, required, field, sort] of INDIA_ONBOARDING) {
    await db.query(
      `INSERT INTO profile_notes
         (user_id, kind, title, body, author_user_id, is_completed,
          ob_status, ob_required, ob_group, ob_sort, ob_field)
       VALUES ($1, 'onboarding', $2, $3, $4, FALSE, 'to_do', $5, $6, $7, $8)`,
      [userId, title, body, authorUserId, required, group, sort, field]
    );
  }
}

// Is a linked profile field "filled" for this user row?
function fieldFilled(u, field) {
  switch (field) {
    case 'photo': return !!u.has_photo;
    case 'personal': return !!(u.personal_email && u.phone);
    case 'emergency_contact': return !!u.emergency_contact;
    case 'bank': return !!(u.bank_account_number && u.bank_ifsc);
    case 'pan': return !!u.pan;
    default: return false;
  }
}

// After a profile change, advance any linked onboarding items.
// Returns the count advanced (so callers can notify HR for submitted items).
async function syncOnboardingFromProfile(userId) {
  const r = await db.query(
    `SELECT u.personal_email, u.phone, u.emergency_contact,
            u.bank_account_number, u.bank_ifsc, u.pan,
            EXISTS(SELECT 1 FROM user_photos ph WHERE ph.user_id = u.id) AS has_photo
       FROM users u WHERE u.id = $1`, [userId]
  );
  if (r.rows.length === 0) return { submitted: 0, verified: 0 };
  const u = r.rows[0];

  const items = await db.query(
    `SELECT id, ob_field, ob_status FROM profile_notes
      WHERE user_id = $1 AND kind = 'onboarding' AND ob_field IS NOT NULL
        AND ob_status IN ('to_do','needs_redo')`, [userId]
  );
  let submitted = 0, verified = 0;
  for (const it of items.rows) {
    if (!fieldFilled(u, it.ob_field)) continue;
    if (AUTO_VERIFY_FIELDS.has(it.ob_field)) {
      await db.query(
        `UPDATE profile_notes SET ob_status='verified', is_completed=TRUE,
           completed_at=NOW(), ob_decided_at=NOW(), ob_redo_reason=NULL, updated_at=NOW()
         WHERE id=$1`, [it.id]);
      verified++;
    } else if (AUTO_SUBMIT_FIELDS.has(it.ob_field)) {
      await db.query(
        `UPDATE profile_notes SET ob_status='submitted', ob_redo_reason=NULL, updated_at=NOW()
         WHERE id=$1`, [it.id]);
      submitted++;
    }
  }
  if (submitted > 0) {
    try {
      const hr = await db.query(
        `SELECT DISTINCT u.id FROM users u
           JOIN user_groups ug ON ug.user_id=u.id
           JOIN group_permissions gp ON gp.group_id=ug.group_id
           JOIN permissions p ON p.id=gp.permission_id
          WHERE p.slug='profile.view.any' AND u.deleted_at IS NULL AND u.employment_status='active'`
      );
      const who = await db.query(`SELECT COALESCE(display_name,full_name) AS n FROM users WHERE id=$1`, [userId]);
      const name = who.rows[0] ? who.rows[0].n : 'An employee';
      await notify({
        userIds: hr.rows.map(x => x.id), type: 'onboarding.submitted',
        title: 'Onboarding details to verify',
        body: name + ' completed ' + submitted + ' onboarding item(s) that need HR verification.',
        action_url: '#profile/' + userId + '/onboarding',
        related_user_id: userId, related_type: 'user', related_id: userId,
      });
    } catch (e) { console.error('[ob sync notify]', e.message); }
  }
  return { submitted, verified };
}

module.exports = { INDIA_ONBOARDING, applyOnboardingTemplate, syncOnboardingFromProfile };
