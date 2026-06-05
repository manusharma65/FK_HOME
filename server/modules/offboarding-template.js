// FK Home — General exit (offboarding) template.
// One general checklist for everyone, plus a department-specific handover line
// where it applies (Amazon / Google). Reuses profile_notes (kind='offboarding')
// and the ob_* workflow columns. owner = which area clears it; leaver = shown in
// the departing person's own panel.

const { db } = require('../db');

// group | title | why | owner | leaver | sort
const GENERAL_EXIT = [
  // 1. Handover
  ['Handover', 'Hand over your work, accounts & in-flight tasks', 'Reassign anything you own — accounts, suppliers, in-flight work — to whoever is taking over, so nothing is dropped.', 'manager', true, 10],
  ['Handover', 'Knowledge handover doc', 'A short written handover of what they owned, open work, logins and how-tos for the person stepping in.', 'manager', false, 20],
  // 2. Access & assets
  ['Access & assets', 'Revoke system access', 'FK Home, email and chat — plus any department tools (Amazon Seller, Google Ads, etc.). Do this on the last working day.', 'it', false, 30],
  ['Access & assets', 'Clear & hand back your workstation', 'Clear your personal files and logins off your desktop and hand it over tidy — no data wipe, just cleared and returned. Include your access card.', 'it', true, 40],
  // 3. No-dues clearances
  ['No-dues clearances', 'Leave & notice verified', 'Confirm the final leave balance and that notice is served, or any shortfall is recovered.', 'hr', false, 50],
  ['No-dues clearances', 'Finance no-dues', 'Pending reimbursements, advances, loans or other recoverables are settled.', 'finance', false, 60],
  ['No-dues clearances', 'Manager sign-off', 'Manager confirms handover is complete and nothing is left open.', 'manager', false, 70],
  // 4. Full & Final
  ['Full & Final settlement', 'Full & Final settlement', 'Payroll runs the FnF (salary, leave encashment, gratuity if eligible, minus recoveries). Upload the statement and final payslip here, and set the EPFO exit date. Due within 2 working days of the last day.', 'hr', false, 80],
  // 5. Documents to issue
  ['Documents to issue', 'Relieving letter', 'Upload the signed relieving letter — it appears in the leaver\u2019s panel to download.', 'hr', true, 90],
  ['Documents to issue', 'Experience letter', 'Confirms their role and dates for their next employer.', 'hr', true, 100],
  // 6. Exit formalities
  ['Exit formalities', 'Exit interview', 'A candid conversation — notes stay internal to HR.', 'hr', false, 110],
  ['Exit formalities', 'Mark as left', 'Sets their status to Left on the last day, once everything above is cleared.', 'hr', false, 120],
];

// Department-specific handover line (only added where it applies).
function deptHandover(deptNames) {
  const set = (deptNames || []).map(d => String(d).toLowerCase());
  if (set.some(d => d.includes('amazon'))) {
    return ['Handover', 'Reassign Amazon SKUs & campaigns', 'Move owned ASINs, advertising campaigns and supplier contacts to the new owner.', 'manager', false, 12];
  }
  if (set.some(d => d.includes('google'))) {
    return ['Handover', 'Hand over Google Ads accounts & campaigns', 'Transfer ad accounts, campaigns and budgets to whoever takes over.', 'manager', false, 12];
  }
  return null;
}

// Apply the general exit checklist on offboarding start. Idempotent.
async function applyOffboardingTemplate(userId, authorUserId, deptNames) {
  const exists = await db.query(
    `SELECT 1 FROM profile_notes WHERE user_id = $1 AND kind = 'offboarding' LIMIT 1`, [userId]
  );
  if (exists.rows.length > 0) return;

  const rows = GENERAL_EXIT.slice();
  const dh = deptHandover(deptNames);
  if (dh) rows.push(dh);

  for (const [group, title, body, owner, leaver, sort] of rows) {
    await db.query(
      `INSERT INTO profile_notes
         (user_id, kind, title, body, author_user_id, is_completed,
          ob_status, ob_group, ob_sort, ob_owner, ob_leaver)
       VALUES ($1, 'offboarding', $2, $3, $4, FALSE, 'to_do', $5, $6, $7, $8)`,
      [userId, title, body, authorUserId, group, sort, owner, leaver]
    );
  }
}

module.exports = { GENERAL_EXIT, applyOffboardingTemplate };
