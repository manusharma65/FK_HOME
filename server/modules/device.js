// FK Home — request device detection (shared)
//
// Used to keep attendance honest. A phone can stay logged in and file a
// running-late notice, but it must NOT stamp the official arrival or departure
// on attendance_day — that only happens on an office device. The client sends
// an explicit `x-fk-device` hint; we fall back to the user-agent when it's
// missing (older client, or a direct API call).
const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i;
const crypto = require('crypto');
const { db } = require('../db');

function isMobileRequest(req) {
  try {
    const hint = String((req && req.headers && req.headers['x-fk-device']) || '').toLowerCase();
    if (hint === 'mobile') return true;
    if (hint === 'desktop') return false;
    return MOBILE_UA.test((req && req.headers && req.headers['user-agent']) || '');
  } catch (e) {
    return false; // never block a desktop clock-in because detection threw
  }
}

// Hash a raw device token before storing/looking up. The raw token only ever
// lives in the office machine's cookie; the DB keeps the hash.
function hashDeviceToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

// Is this request coming from a trusted (office) machine? Verified server-side
// against trusted_devices — not spoofable like the user-agent hint. Best-effort:
// any error means "not an office device" (clock-in falls back to remote/WFH).
async function isOfficeDevice(req) {
  try {
    const raw = req && req.cookies && req.cookies['fk_device'];
    if (!raw) return false;
    const r = await db.query(
      `SELECT id FROM trusted_devices WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashDeviceToken(raw)]
    );
    if (r.rows.length) {
      db.query(`UPDATE trusted_devices SET last_seen_at = NOW() WHERE id = $1`, [r.rows[0].id]).catch(() => {});
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

module.exports = { isMobileRequest, hashDeviceToken, isOfficeDevice };
