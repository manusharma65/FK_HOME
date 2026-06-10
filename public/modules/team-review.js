// FK Home — Team review module (r0.90)
// ----------------------------------------------------------------------------
// Owner-only consolidation: one place to see results. Reuses the existing
// Reports module (daily-report review queue — the landing/default tab) and the
// HR today module (daily oversight scan — secondary, lazy-mounted only if its
// tab is opened, so its data call never fires unless wanted).
//
// Both sub-modules are root-scoped (el.querySelector) with unique container ids
// (#rep-mod, #hrt-mod), so mounting them into separate panels is collision-free.
//
// Nav: shown to the owner only; replaces the owner's separate "HR today" and
// "Reports" items. Managers/HR keep their own "Reports" page, untouched.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/team-review'] = {
  title: 'Team review',
  noHero: true,

  render() {
    return '' +
      '<div id="tr-mod" class="fk-mod">' +
        '<style>' +
          '#tr-mod h1,#tr-mod h2,#tr-mod h3{font-family:var(--body,"Hanken Grotesk",-apple-system,sans-serif)!important}' +
          '#tr-mod .tr-head{margin:0 0 14px}' +
          '#tr-mod .tr-head h2{font-size:26px;font-weight:700;margin:0;letter-spacing:-.01em}' +
          '#tr-mod .tr-head .meta{font-size:14px;color:var(--muted);margin-top:3px}' +
          '#tr-mod .tr-tabs{display:flex;gap:6px;margin:0 0 20px;border-bottom:1px solid var(--line)}' +
          '#tr-mod .tr-tab{font-family:inherit;font-size:14.5px;font-weight:600;padding:11px 18px;border:none;background:none;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;display:inline-flex;align-items:center;gap:8px}' +
          '#tr-mod .tr-tab i{font-size:17px}' +
          '#tr-mod .tr-tab:hover{color:var(--ink)}' +
          '#tr-mod .tr-tab.on{color:var(--orange,#E8722B);border-bottom-color:var(--orange,#E8722B)}' +
          '#tr-mod .tr-panel-load{padding:24px;text-align:center;color:var(--muted);font-size:14px}' +
        '</style>' +
        '<div class="tr-head">' +
          '<h2>Team review</h2>' +
          '<div class="meta">Everything your team submits, in one place. Reports are what they\u2019ve done; HR today is the live daily scan if you want it.</div>' +
        '</div>' +
        '<div class="tr-tabs">' +
          '<button class="tr-tab on" data-tab="reports"><i class="ti ti-notes"></i> Reports</button>' +
          '<button class="tr-tab" data-tab="today"><i class="ti ti-checkup-list"></i> HR today</button>' +
        '</div>' +
        '<div class="tr-panel" id="trReports"><div class="tr-panel-load">Loading reports\u2026</div></div>' +
        '<div class="tr-panel" id="trToday" style="display:none"></div>' +
      '</div>';
  },

  async mount(el) {
    const reportsMod = window.fkModules['hr/reports'];
    const todayMod = window.fkModules['hr/today'];
    const pReports = el.querySelector('#trReports');
    const pToday = el.querySelector('#trToday');
    let todayMounted = false;

    // Landing tab: Reports (the results).
    if (reportsMod) {
      pReports.innerHTML = reportsMod.render();
      try { await reportsMod.mount(pReports); } catch (e) { pReports.innerHTML = '<div class="tr-panel-load" style="color:var(--red)">Could not load reports.</div>'; }
    } else {
      pReports.innerHTML = '<div class="tr-panel-load" style="color:var(--red)">Reports module not available.</div>';
    }

    el.querySelectorAll('.tr-tab').forEach(tab => tab.addEventListener('click', async () => {
      el.querySelectorAll('.tr-tab').forEach(t => t.classList.remove('on'));
      tab.classList.add('on');
      const which = tab.dataset.tab;
      pReports.style.display = which === 'reports' ? 'block' : 'none';
      pToday.style.display = which === 'today' ? 'block' : 'none';
      // Lazy-mount HR today only the first time its tab is opened.
      if (which === 'today' && !todayMounted) {
        todayMounted = true;
        if (todayMod) {
          pToday.innerHTML = todayMod.render();
          try { await todayMod.mount(pToday); } catch (e) { pToday.innerHTML = '<div class="tr-panel-load" style="color:var(--red)">Could not load HR today.</div>'; }
        } else {
          pToday.innerHTML = '<div class="tr-panel-load" style="color:var(--red)">HR today module not available.</div>';
        }
      }
    }));
  }
};
