// FK Home — Team review (r0.81)
// ----------------------------------------------------------------------------
// Owner-only combined view: the live "Today" scan (HR today) and the 30-day
// "To review" queue (Reports) in one page with tabs, so the owner doesn't flip
// between two nav entries. It REUSES the existing hr/today and hr/reports
// modules wholesale — their render()+mount() do the real work — so there is no
// duplicated logic to drift. Managers keep their own Reports page unchanged.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['hr/team-review'] = {
  title: 'Team review',

  render() {
    return '' +
      '<div id="tr-mod" class="fk-mod">' +
        '<style>' +
          '#tr-mod .tr-tabs{display:flex;gap:8px;margin:0 0 18px;border-bottom:1px solid var(--line,#e7dfd2)}' +
          '#tr-mod .tr-tab{font-family:inherit;font-size:14.5px;font-weight:600;color:var(--muted,#8a8078);' +
            'background:none;border:none;padding:10px 4px;margin-right:18px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}' +
          '#tr-mod .tr-tab.on{color:var(--ink,#2a241e);border-bottom-color:var(--orange,#E8722B)}' +
          '#tr-mod .tr-panel{display:none}' +
          '#tr-mod .tr-panel.on{display:block}' +
        '</style>' +
        '<div class="tr-tabs">' +
          '<button class="tr-tab on" data-tab="today">Today</button>' +
          '<button class="tr-tab" data-tab="review">To review</button>' +
        '</div>' +
        '<div class="tr-panel on" id="tr-today"></div>' +
        '<div class="tr-panel" id="tr-review"></div>' +
      '</div>';
  },

  async mount(el) {
    const today = el.querySelector('#tr-today');
    const review = el.querySelector('#tr-review');
    const mToday = window.fkModules['hr/today'];
    const mReview = window.fkModules['hr/reports'];

    const mounted = { today: false, review: false };

    // Inject a sub-module's render() HTML and run its mount() once, lazily.
    async function ensure(key, host, mod) {
      if (mounted[key] || !mod) return;
      try {
        host.innerHTML = (typeof mod.render === 'function') ? mod.render() : '';
        if (typeof mod.mount === 'function') await mod.mount(host);
        mounted[key] = true;
      } catch (e) {
        host.innerHTML = '<div class="empty">Could not load this view.</div>';
      }
    }

    // First tab eagerly
    await ensure('today', today, mToday);

    el.querySelectorAll('.tr-tab').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tab = btn.dataset.tab;
        el.querySelectorAll('.tr-tab').forEach(b => b.classList.toggle('on', b === btn));
        el.querySelectorAll('.tr-panel').forEach(p => p.classList.remove('on'));
        el.querySelector('#tr-' + tab).classList.add('on');
        if (tab === 'today') await ensure('today', today, mToday);
        else await ensure('review', review, mReview);
      });
    });
  },
};
