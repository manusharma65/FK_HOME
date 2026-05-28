// FK Home — Module loader (r0.14, Ship 2)
// ----------------------------------------------------------------------------
// Turns the shell's <main class="content"> into a dynamically-swappable area.
//
// A "module" is a plain object registered on window.fkModules under its route
// key (e.g. 'hr/insights'), exporting:
//     title            string shown in the topbar
//     render()         -> HTML string for the module body
//     async mount(el)  attach listeners / fetch data (el = the module root)
//     unmount()        clean up timers / listeners (optional)
//
// The home page is special: it is NOT re-rendered. We keep the existing
// #homeView markup in the DOM and just show/hide it, so all the working home
// cards and their wiring are never touched. Other modules render into
// #moduleView.
//
// Routing: index.html's fkRoute() calls fkLoadRoute(hash). This file owns the
// dispatch. Deep links (#hr/insights) and the browser back button both work,
// because we drive everything off location.hash + the hashchange event.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

(function () {
  let current = null; // { key, mod } currently mounted (null = home)

  function homeView()   { return document.getElementById('homeView'); }
  function moduleView() { return document.getElementById('moduleView'); }
  function topbarTitle(){ return document.getElementById('topbarTitle'); }

  // Normalise a raw hash into a route key.
  //   '' / '#home' / '#'         -> 'home'
  //   '#hr/insights'             -> 'hr/insights'
  function routeKey(rawHash) {
    let h = (rawHash || '').replace(/^#/, '').trim();
    if (!h || h === 'home') return 'home';
    return h;
  }

  function showHome() {
    if (current && current.mod && typeof current.mod.unmount === 'function') {
      try { current.mod.unmount(); } catch (e) { console.error('[module unmount]', e); }
    }
    current = null;
    const mv = moduleView();
    if (mv) { mv.style.display = 'none'; mv.innerHTML = ''; }
    const hv = homeView();
    if (hv) hv.style.display = '';
    const tt = topbarTitle();
    if (tt) tt.textContent = 'Home';
  }

  async function showModule(key) {
    const mod = window.fkModules[key];
    if (!mod) {
      // Unknown module — fall back to home so the user never gets a blank shell.
      console.warn('[loader] no module registered for', key, '— falling back to home');
      location.hash = '#home';
      showHome();
      return;
    }

    // Unmount whatever was there.
    if (current && current.mod && typeof current.mod.unmount === 'function') {
      try { current.mod.unmount(); } catch (e) { console.error('[module unmount]', e); }
    }

    const hv = homeView();
    if (hv) hv.style.display = 'none';
    const mv = moduleView();
    if (!mv) { console.error('[loader] #moduleView missing'); return; }

    mv.style.display = '';
    mv.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">Loading…</div>';

    const tt = topbarTitle();
    if (tt) tt.textContent = mod.title || 'FK Home';

    try {
      const html = (typeof mod.render === 'function') ? mod.render() : '';
      mv.innerHTML = html || '';
      current = { key, mod };
      if (typeof mod.mount === 'function') {
        await mod.mount(mv);
      }
    } catch (e) {
      console.error('[loader] module failed:', key, e);
      mv.innerHTML =
        '<div class="card" style="padding:24px;text-align:center">' +
        '<div style="color:var(--red);font-weight:500;margin-bottom:6px">This section failed to load.</div>' +
        '<div style="color:var(--muted);font-size:14px">Please refresh, or go back to Home.</div>' +
        '<button class="btn" style="margin-top:14px" onclick="location.hash=\'#home\'">Back to Home</button>' +
        '</div>';
      current = { key, mod: null };
    }
  }

  // Public entry — called by fkRoute() in index.html on boot + hashchange.
  window.fkLoadRoute = function (rawHash) {
    const key = routeKey(rawHash || location.hash);
    if (key === 'home') { showHome(); return; }
    // Department stubs (amazon/google/logistics) keep their existing "soon"
    // toast behaviour and are NOT modules yet — let index.html handle them.
    if (key === 'amazon' || key === 'google' || key === 'logistics') {
      showHome(); // their click handler shows the toast; content stays home
      return;
    }
    showModule(key);
  };
})();
