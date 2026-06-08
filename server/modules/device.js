// FK Home — request device detection (shared)
//
// Used to keep attendance honest. A phone can stay logged in and file a
// running-late notice, but it must NOT stamp the official arrival or departure
// on attendance_day — that only happens on an office device. The client sends
// an explicit `x-fk-device` hint; we fall back to the user-agent when it's
// missing (older client, or a direct API call).
const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i;

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

module.exports = { isMobileRequest };
