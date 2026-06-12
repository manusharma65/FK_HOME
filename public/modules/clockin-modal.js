// FK Home — Clock-in selfie modal (r1.07)
// ----------------------------------------------------------------------------
// Login already stamped the clock-in (office or remote). This overlay only asks
// for the photo, and ONLY when one is owed. It is best-effort and defensive: any
// camera/permission/JS failure just lets the person continue — they are already
// clocked in, it simply lands in HR's queue as a no-photo exception. It never
// blocks login or the app.
// Reads  GET  /api/attendance/clock-in/context
// Writes POST /api/attendance/selfie  { image: dataURL }
// ----------------------------------------------------------------------------
(function () {
  let stream = null;

  function stop() { try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch (e) {} stream = null; }

  function close() {
    stop();
    const o = document.getElementById('fk-clockin-ovl');
    if (o) o.remove();
  }

  function shell(inner) {
    const o = document.createElement('div');
    o.id = 'fk-clockin-ovl';
    o.innerHTML =
      '<style>' +
      '#fk-clockin-ovl{position:fixed;inset:0;z-index:9000;background:rgba(20,22,27,.46);display:flex;align-items:center;justify-content:center;padding:18px;font-family:var(--body,sans-serif)}' +
      '#fk-clockin-ovl .ci-card{background:var(--canvas,#F4EFE7);border:1px solid var(--line);border-radius:18px;padding:22px;width:100%;max-width:380px;box-shadow:0 18px 48px rgba(20,22,27,.22)}' +
      '#fk-clockin-ovl .ci-h{font-family:var(--disp,serif);font-size:21px;font-weight:600;color:var(--ink);line-height:1.15}' +
      '#fk-clockin-ovl .ci-sub{font-size:13px;color:var(--muted);margin-top:3px}' +
      '#fk-clockin-ovl .ci-cam{position:relative;margin:16px 0;height:200px;border-radius:14px;background:#ece3d6;border:1px solid var(--line);overflow:hidden;display:flex;align-items:center;justify-content:center}' +
      '#fk-clockin-ovl .ci-cam video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}' +
      '#fk-clockin-ovl .ci-cam .ci-ph{font-size:12.5px;color:#9a8f82;text-align:center;padding:0 18px}' +
      '#fk-clockin-ovl .ci-wfh{background:var(--amber-soft,#FAEEDA);color:var(--amber-deep,#854F0B);border-radius:10px;padding:9px 11px;font-size:12.5px;line-height:1.5;margin:2px 0 14px}' +
      '#fk-clockin-ovl .ci-btn{width:100%;font-family:inherit;font-size:15px;font-weight:600;padding:13px;border-radius:11px;border:none;background:var(--orange,#E8722B);color:#fff;cursor:pointer}' +
      '#fk-clockin-ovl .ci-btn:disabled{opacity:.6;cursor:default}' +
      '#fk-clockin-ovl .ci-link{display:block;width:100%;text-align:center;font-size:12.5px;color:#8a6a56;margin-top:11px;cursor:pointer;text-decoration:underline;background:none;border:none}' +
      '#fk-clockin-ovl .ci-ok{display:flex;align-items:center;gap:10px;background:var(--green-soft,#EAF3DE);border:1px solid #cfe6cf;color:var(--green,#3B6D11);border-radius:12px;padding:14px;font-size:14.5px;font-weight:600}' +
      '</style>' +
      '<div class="ci-card">' + inner + '</div>';
    document.body.appendChild(o);
    return o;
  }

  async function startCamera(videoEl, phEl) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      videoEl.srcObject = stream;
      videoEl.style.display = 'block';
      if (phEl) phEl.style.display = 'none';
      await videoEl.play().catch(() => {});
      return true;
    } catch (e) {
      return false; // permission denied / no camera — caller offers "continue"
    }
  }

  function capture(videoEl) {
    try {
      const w = videoEl.videoWidth || 480, h = videoEl.videoHeight || 360;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return null; }
  }

  async function postSelfie(dataUrl) {
    try {
      const r = await fetch('/api/attendance/selfie', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      return r.ok;
    } catch (e) { return false; }
  }

  function doneState(ovl, place) {
    const card = ovl.querySelector('.ci-card');
    card.innerHTML =
      '<div class="ci-ok"><i class="ti ti-circle-check" style="font-size:20px"></i>' +
      '<div>Clocked in' + (place === 'remote' ? ' · working from home' : ' · office') + '</div></div>';
    setTimeout(close, 1100);
  }

  async function run(ctx) {
    const office = ctx.place !== 'remote';
    const heading = office ? 'Good ' + partOfDay() + ', ' + firstName(ctx.name) : 'Working from home today';
    const sub = office
      ? 'Take a quick clock-in photo.'
      : '';
    const wfhNote = office ? '' :
      '<div class="ci-wfh">You\u2019re clocked in as <b>working from home</b> \u2014 your manager can see this. A photo is optional.</div>';

    const ovl = shell(
      '<div class="ci-h">' + esc(heading) + '</div>' +
      (sub ? '<div class="ci-sub">' + esc(sub) + '</div>' : '') +
      '<div class="ci-cam"><video id="fk-ci-vid" playsinline muted style="display:none"></video>' +
        '<div class="ci-ph" id="fk-ci-ph">Starting camera\u2026</div></div>' +
      wfhNote +
      '<button class="ci-btn" id="fk-ci-go" disabled>' + (office ? 'Take photo & clock in' : 'Add photo') + '</button>' +
      '<button class="ci-link" id="fk-ci-skip">' + (office ? 'Camera not working? Continue \u2014 a manager will confirm' : 'Skip \u2014 no photo') + '</button>'
    );

    const vid = document.getElementById('fk-ci-vid');
    const ph = document.getElementById('fk-ci-ph');
    const go = document.getElementById('fk-ci-go');
    const skip = document.getElementById('fk-ci-skip');

    skip.addEventListener('click', function () {
      try { fetch('/api/attendance/clock-in/ack', { method: 'POST', credentials: 'include' }); } catch (e) {}
      doneState(ovl, ctx.place);
    });

    const camOk = await startCamera(vid, ph);
    if (!camOk) {
      ph.textContent = office
        ? 'No camera available. You can continue \u2014 your manager will confirm.'
        : 'No camera \u2014 that\u2019s fine for working from home.';
      go.style.display = 'none';
      return;
    }
    go.disabled = false;
    go.addEventListener('click', async function () {
      go.disabled = true; go.textContent = 'Saving\u2026';
      const img = capture(vid);
      if (img) await postSelfie(img);
      doneState(ovl, ctx.place);
    });
  }

  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
  function partOfDay() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Public: called once after boot. Shows the photo overlay only if one is owed.
  window.fkClockInMaybe = async function () {
    try {
      if (document.getElementById('fk-clockin-ovl')) return;
      const r = await fetch('/api/attendance/clock-in/context', { credentials: 'include' });
      if (!r.ok) return;
      const ctx = await r.json();
      if (ctx.isOffDay) return;          // day off — don't prompt
      if (!ctx.clockedIn) return;        // nothing stamped (shouldn't happen) — stay silent
      if (ctx.hasSelfie || ctx.acked) return; // already handled today (photo OR skip) — don't re-ask
      await run(ctx);
    } catch (e) { /* never block the app */ }
  };
})();
