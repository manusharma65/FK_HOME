// FK Home — Profile module (r0.16)
// ----------------------------------------------------------------------------
// Replaces profile.html in the shell context. Same backend endpoints, same
// drawer structure. NEW in r0.16:
//   - File row in every drawer: View / Replace / Download (locked for non-HR)
//   - Reviews drawer: Monday-style cards (stage chip + outcome chip + ⋯)
//   - Attendance drawer (NEW) — month calendar + 4-tile payslip roll-up
//
// Routes: #profile/me  (current user)
//         #profile/<userId> (specific user)
//
// profile.html stays on disk (production team still uses it). Both work.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['profile'] = {
  title: 'Profile',

  render() {
    return '' +
      '<style>' +
        '#prof-mod{max-width:1120px;margin:0 auto}' +
        '#prof-mod .header-card{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:20px 22px;display:flex;gap:18px;align-items:center;margin-bottom:18px}' +
        '#prof-mod .avatar-lg{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:var(--ink);flex-shrink:0}' +
        '#prof-mod .header-info{flex:1;min-width:0}' +
        '#prof-mod .header-info h1{font-size:22px;font-weight:500;margin:0 0 4px;letter-spacing:-0.3px}' +
        '#prof-mod .header-meta{font-size:14px;color:var(--muted);display:flex;gap:12px;flex-wrap:wrap}' +
        '#prof-mod .header-meta span{display:flex;align-items:center;gap:5px}' +
        '#prof-mod .pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:500;background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .pill.off{background:var(--red-soft);color:var(--red)}' +
        '#prof-mod .pill.idle{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .pill.probation{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .pill.on-track{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .header-actions{display:flex;gap:8px;align-items:center}' +
        '#prof-mod .header-action-btn{padding:6px 12px;border:0.5px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-size:13px;color:var(--muted);display:inline-flex;align-items:center;gap:5px}' +
        '#prof-mod .header-action-btn:hover{color:var(--ink);background:var(--bg)}' +
        '#prof-mod .profile-grid{display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:start}' +
        '@media (max-width:760px){#prof-mod .profile-grid{grid-template-columns:1fr}}' +
        '#prof-mod .drawer-nav{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:10px 8px;position:sticky;top:16px}' +
        '#prof-mod .drawer-tab{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;color:var(--muted);font-size:14px;transition:background 0.1s}' +
        '#prof-mod .drawer-tab:hover{background:rgba(20,22,27,0.04);color:var(--ink)}' +
        '#prof-mod .drawer-tab.on{background:var(--amber-soft);color:var(--amber-deep);font-weight:500}' +
        '#prof-mod .drawer-tab i{font-size:16px}' +
        '#prof-mod .drawer-tab .count{margin-left:auto;background:var(--line);color:var(--muted);font-size:11px;padding:1px 6px;border-radius:99px;min-width:20px;text-align:center}' +
        '#prof-mod .drawer-tab.on .count{background:var(--amber);color:white}' +
        '#prof-mod .panel{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:22px 24px}' +
        '#prof-mod .panel h2{font-size:18px;font-weight:500;margin:0 0 4px}' +
        '#prof-mod .panel .sub{font-size:13px;color:var(--muted);margin:0 0 18px}' +
        '#prof-mod .info-block{background:var(--bg);border:0.5px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}' +
        '#prof-mod .info-block-title{font-size:13px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}' +
        '#prof-mod .info-row{font-size:14px;margin-bottom:8px;color:var(--ink)}' +
        '#prof-mod .info-row:last-child{margin-bottom:0}' +
        '#prof-mod .info-label{color:var(--muted);display:inline-block;min-width:120px}' +
        '#prof-mod .file-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--line)}' +
        '#prof-mod .file-row:last-child{border-bottom:none}' +
        '#prof-mod .file-row .ti-file{font-size:22px;color:var(--ink-soft,#888780)}' +
        '#prof-mod .file-row .file-meta{flex:1;min-width:0}' +
        '#prof-mod .file-row .file-name{font-size:14px;font-weight:500;word-break:break-word}' +
        '#prof-mod .file-row .file-sub{font-size:12px;color:var(--muted);margin-top:2px}' +
        '#prof-mod .file-row button{font-size:12px;padding:5px 9px;border:0.5px solid var(--line);background:var(--surface);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;color:var(--ink)}' +
        '#prof-mod .file-row button:hover{background:var(--bg)}' +
        '#prof-mod .file-row button:disabled{opacity:0.4;cursor:not-allowed}' +
        '#prof-mod .file-row .btn-danger{color:var(--red);border-color:var(--red-soft)}' +
        '#prof-mod .upload-area{margin-top:14px;padding:14px;border:1.5px dashed var(--line);border-radius:10px;text-align:center}' +
        '#prof-mod .upload-area input[type=file]{display:none}' +
        '#prof-mod .upload-area label{cursor:pointer;color:var(--amber-deep);font-weight:500}' +
        '#prof-mod .review-card{background:var(--surface);border:0.5px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:10px;transition:opacity 0.15s}' +
        '#prof-mod .review-card.scheduled{border-style:dashed}' +
        '#prof-mod .review-card.cancelled{opacity:0.55}' +
        '#prof-mod .review-card.cancelled .stage-chip,#prof-mod .review-card.cancelled .review-date,#prof-mod .review-card.cancelled .review-notes{text-decoration:line-through}' +
        '#prof-mod .review-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap}' +
        '#prof-mod .stage-chip{font-size:12px;padding:3px 10px;border-radius:99px;background:var(--amber-soft);color:var(--amber-deep);font-weight:500}' +
        '#prof-mod .outcome-chip{font-size:12px;padding:3px 10px;border-radius:99px;font-weight:500;display:inline-flex;align-items:center;gap:4px}' +
        '#prof-mod .outcome-chip.outcome-passed{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .outcome-chip.outcome-excellent{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .outcome-chip.outcome-needs_improvement{background:var(--red-soft);color:var(--red)}' +
        '#prof-mod .outcome-chip.outcome-salary_reviewed{background:rgba(40,90,180,0.10);color:#2D5BAF}' +
        '#prof-mod .outcome-chip.outcome-in_process{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .outcome-chip.outcome-scheduled,#prof-mod .outcome-chip.outcome-cancelled{background:var(--line);color:var(--muted)}' +
        '#prof-mod .review-date{font-size:13px;color:var(--muted)}' +
        '#prof-mod .review-notes{font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:8px;white-space:pre-wrap}' +
        '#prof-mod .doc-chip{font-size:12px;padding:3px 8px;background:var(--bg);border-radius:6px;display:inline-flex;align-items:center;gap:4px;color:var(--ink)}' +
        '#prof-mod .more-btn{font-size:13px;padding:4px 8px;border:0.5px solid var(--line);background:transparent;border-radius:6px;cursor:pointer}' +
        '#prof-mod .more-menu{position:absolute;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.08);z-index:50;min-width:140px}' +
        '#prof-mod .more-menu button{display:block;width:100%;text-align:left;padding:7px 10px;background:transparent;border:none;cursor:pointer;border-radius:5px;font-size:13px}' +
        '#prof-mod .more-menu button:hover{background:var(--bg)}' +
        '#prof-mod .more-menu button.danger{color:var(--red)}' +
        // Attendance calendar
        '#prof-mod .att-cal{background:var(--surface);border:0.5px solid var(--line);border-radius:12px;padding:14px 16px}' +
        '#prof-mod .att-cal-head{display:flex;align-items:center;justify-content:center;margin-bottom:14px}' +
        '#prof-mod .att-cal-nav{display:inline-flex;align-items:center;gap:8px}' +
        '#prof-mod .att-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}' +
        '#prof-mod .att-cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-size:11px;color:var(--muted);margin-bottom:6px;text-align:center}' +
        '#prof-mod .att-day{aspect-ratio:1;border-radius:6px;padding:4px;font-size:11px;position:relative;display:flex;align-items:flex-start;justify-content:flex-end}' +
        '#prof-mod .att-day .att-flag{position:absolute;bottom:4px;left:4px;font-size:9px;font-weight:500}' +
        '#prof-mod .att-day.att-empty{background:var(--bg);color:var(--muted)}' +
        '#prof-mod .att-day.att-worked{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .att-day.att-late{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .att-day.att-wfh{background:rgba(13,148,136,0.12);color:#0F766E}' +
        '#prof-mod .att-day.att-sick{background:var(--red-soft);color:var(--red)}' +
        '#prof-mod .att-day.att-leave{background:rgba(40,90,180,0.10);color:#2D5BAF}' +
        '#prof-mod .att-day.att-holiday{background:var(--bg);color:var(--muted)}' +
        '#prof-mod .att-day.att-future{background:transparent;border:0.5px dashed var(--line);color:var(--muted)}' +
        '#prof-mod .att-day.att-today{outline:2px solid var(--amber);background:var(--amber);color:#412402}' +
        '#prof-mod .att-legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;font-size:11px}' +
        '#prof-mod .att-legend span{display:flex;align-items:center;gap:4px}' +
        '#prof-mod .att-legend .swatch{display:inline-block;width:10px;height:10px;border-radius:2px}' +
        '#prof-mod .att-rollup{margin-top:14px;padding-top:14px;border-top:0.5px solid var(--line);display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}' +
        '#prof-mod .att-tile{background:var(--bg);border-radius:8px;padding:10px 12px}' +
        '#prof-mod .att-tile .num{font-size:18px;font-weight:500}' +
        '#prof-mod .att-tile .lbl{font-size:11px;color:var(--muted);margin-top:2px}' +
        // Profile photo control
        '#prof-mod .prof-photo-wrap{position:relative;width:64px;height:64px;flex:none}' +
        '#prof-mod .prof-photo-wrap .avatar-lg{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;overflow:hidden;background-size:cover;background-position:center}' +
        '#prof-mod .prof-photo-btn{position:absolute;right:-2px;bottom:-2px;width:24px;height:24px;border-radius:50%;border:1.5px solid var(--surface);background:var(--amber);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}' +
        '#prof-mod .prof-photo-btn i{font-size:13px}' +
        // Header tiles
        '#prof-mod .prof-tiles{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}' +
        '#prof-mod .prof-tile{background:var(--bg);border:0.5px solid var(--line);border-radius:10px;padding:10px 14px;min-width:120px}' +
        '#prof-mod .prof-tile .t-lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px}' +
        '#prof-mod .prof-tile .t-val{font-size:17px;font-weight:500;margin-top:3px;display:flex;align-items:center;gap:7px}' +
        '#prof-mod .prof-bar{height:6px;border-radius:99px;background:var(--line);margin-top:7px;overflow:hidden}' +
        '#prof-mod .prof-bar > i{display:block;height:100%;background:var(--amber);border-radius:99px}' +
        // Detail edit forms — full-size fields + buttons (no tiny inline controls)
        '#prof-mod .det-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}' +
        '#prof-mod .det-field{display:flex;flex-direction:column;gap:5px}' +
        '#prof-mod .det-field.full{grid-column:1/-1}' +
        '#prof-mod .det-field label{font-size:12px;color:var(--muted);font-weight:500}' +
        '#prof-mod .det-field input,#prof-mod .det-field select,#prof-mod .det-field textarea{width:100%;padding:10px 12px;border:0.5px solid var(--line);border-radius:8px;background:var(--surface);font-size:14px;color:var(--ink);font-family:inherit}' +
        '#prof-mod .det-field input:disabled{background:var(--bg);color:var(--muted)}' +
        '#prof-mod .det-actions{display:flex;gap:10px;margin-top:14px}' +
        '#prof-mod .det-btn{padding:10px 16px;border-radius:8px;border:0.5px solid var(--line);background:var(--surface);font-size:14px;cursor:pointer;color:var(--ink);font-weight:500}' +
        '#prof-mod .det-btn.primary{background:var(--amber);color:#fff;border-color:var(--amber)}' +
        '#prof-mod .det-btn:hover{filter:brightness(0.97)}' +
        '#prof-mod .det-pending{background:var(--amber-soft);color:var(--amber-deep);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px;display:flex;align-items:center;gap:8px}' +
        '#prof-mod .complete-item{display:flex;align-items:center;gap:10px;padding:9px 0;font-size:14px;border-bottom:0.5px solid var(--line)}' +
        '#prof-mod .complete-item:last-child{border-bottom:0}' +
        '#prof-mod .complete-item i.ok{color:var(--green)}' +
        '#prof-mod .complete-item i.no{color:var(--muted)}' +
        '#prof-mod .complete-item .go{margin-left:auto;color:var(--amber-deep);cursor:pointer;font-size:13px}' +
        '#prof-mod .header-card{padding:26px 28px;gap:24px;border-radius:14px}' +
        '#prof-mod .prof-photo-wrap{width:84px;height:84px}' +
        '#prof-mod .prof-photo-wrap .avatar-lg{width:84px;height:84px;font-size:32px;font-weight:600}' +
        '#prof-mod .prof-photo-btn{width:30px;height:30px}' +
        '#prof-mod .prof-photo-btn i{font-size:16px}' +
        '#prof-mod .header-info h1{font-size:30px;font-weight:600;letter-spacing:-0.4px}' +
        '#prof-mod .header-meta{font-size:16px;gap:16px}' +
        '#prof-mod .header-meta i{font-size:18px}' +
        '#prof-mod .prof-tiles{gap:14px;margin-top:18px}' +
        '#prof-mod .prof-tile{padding:14px 18px;min-width:175px;border-radius:12px}' +
        '#prof-mod .prof-tile .t-lbl{font-size:13px;font-weight:600;letter-spacing:0.6px}' +
        '#prof-mod .prof-tile .t-val{font-size:28px;font-weight:600;margin-top:6px}' +
        '#prof-mod .prof-bar{height:8px;margin-top:10px}' +
        '#prof-mod .pill{font-size:15px;padding:5px 14px}' +
        '#prof-mod .sectabs{display:flex;gap:4px;border-bottom:0.5px solid var(--line);margin:0 4px 24px;flex-wrap:wrap}' +
        '#prof-mod .sectab{display:flex;align-items:center;gap:10px;padding:15px 22px;font-size:16px;font-weight:500;color:var(--muted);border:none;background:none;border-bottom:2.5px solid transparent;cursor:pointer;font-family:inherit}' +
        '#prof-mod .sectab i{font-size:20px}' +
        '#prof-mod .sectab.on{color:var(--amber-deep);border-bottom-color:var(--amber)}' +
        '#prof-mod .sectab:hover{color:var(--ink)}' +
        '#prof-mod .sectab .count{margin-left:2px;background:var(--amber-soft);color:var(--amber-deep);font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px}' +
        '#prof-mod .sec-title,#prof-mod #profPanelTitle{font-size:24px;font-weight:600;margin:0 0 4px}' +
        '#prof-mod .sec-sub,#prof-mod #profPanelSub{font-size:16px;color:var(--muted);margin:0 0 22px}' +
        '#prof-mod .two-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:20px}' +
        '#prof-mod .card{background:var(--surface);border:0.5px solid var(--line);border-radius:14px;padding:22px 24px}' +
        '#prof-mod .card-title{font-size:17px;font-weight:600;color:var(--ink);margin-bottom:18px;display:flex;align-items:center}' +
        '#prof-mod .complete-head{font-size:34px;font-weight:600;margin-bottom:4px}' +
        '#prof-mod .complete-sub{font-size:15px;color:var(--muted);margin-bottom:16px}' +
        '#prof-mod .complete-item{display:flex;align-items:center;gap:13px;padding:14px 0;font-size:17px;border-bottom:0.5px solid var(--line)}' +
        '#prof-mod .complete-item:last-child{border-bottom:0}' +
        '#prof-mod .complete-item i{font-size:22px}' +
        '#prof-mod .complete-item i.ok{color:var(--green)}' +
        '#prof-mod .complete-item i.no{color:var(--muted)}' +
        '#prof-mod .add-btn{margin-left:auto;padding:9px 18px;border-radius:9px;border:0.5px solid var(--amber);background:var(--surface);color:var(--amber-deep);font-size:15px;font-weight:500;cursor:pointer}' +
        '#prof-mod .field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px 30px}' +
        '#prof-mod .fld .fl{font-size:14px;color:var(--muted);margin-bottom:5px}' +
        '#prof-mod .fld .fv{font-size:18px;color:var(--ink);word-break:break-word}' +
        '#prof-mod .fld .fv.empty{color:var(--muted)}' +
        '#prof-mod .edit-link{margin-left:auto;padding:9px 18px;border-radius:9px;border:0.5px solid var(--line);background:var(--surface);color:var(--ink);font-size:15px;font-weight:500;cursor:pointer}' +
        '#prof-mod .det-field{display:flex;flex-direction:column;gap:6px}' +
        '#prof-mod .det-field label{font-size:14px;color:var(--muted);font-weight:500}' +
        '#prof-mod .det-field input,#prof-mod .det-field select,#prof-mod .det-field textarea{width:100%;padding:12px 14px;border:0.5px solid var(--line);border-radius:9px;background:var(--surface);font-size:16px;color:var(--ink);font-family:inherit}' +
        '#prof-mod .det-field input:disabled{background:var(--bg);color:var(--muted)}' +
        '#prof-mod .det-actions{display:flex;gap:12px;margin-top:18px}' +
        '#prof-mod .det-btn{padding:12px 22px;border-radius:9px;border:0.5px solid var(--line);background:var(--surface);font-size:16px;font-weight:500;cursor:pointer;color:var(--ink)}' +
        '#prof-mod .det-btn.primary{background:var(--amber);color:#fff;border-color:var(--amber)}' +
        '#prof-mod .det-pending{background:var(--amber-soft);color:var(--amber-deep);border-radius:10px;padding:14px 18px;font-size:16px;margin-bottom:18px;display:flex;align-items:center;gap:10px}' +
        '#prof-mod .hint{font-size:14px;color:var(--muted);margin-top:14px}' +
        '#prof-mod .stack{display:flex;flex-direction:column;gap:18px}' +
        '#prof-mod .info-block{background:var(--surface);border:0.5px solid var(--line);border-radius:14px;padding:22px 24px;margin-bottom:18px}' +
        '#prof-mod .info-block-title{font-size:17px;font-weight:600;color:var(--ink);margin-bottom:16px;text-transform:none;letter-spacing:0}' +
        '#prof-mod .info-row{font-size:16px;margin-bottom:10px}' +
        '#prof-mod .info-label{font-size:16px;min-width:160px}' +
        '#prof-mod .file-name{font-size:16px}' +
        '#prof-mod .pill.probation{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .pill.on-track{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .pill.off{background:rgba(20,22,27,0.06);color:var(--muted)}' +
        '#prof-mod .ob-welcome{background:linear-gradient(180deg,var(--amber-soft),var(--surface));border:0.5px solid var(--line);border-radius:14px;padding:22px 24px;margin-bottom:14px}' +
        '#prof-mod .ob-welcome h3{margin:0 0 4px;font-size:20px;font-weight:600}' +
        '#prof-mod .ob-welcome p{margin:0 0 16px;font-size:15px;color:var(--muted)}' +
        '#prof-mod .ob-pcount{display:flex;justify-content:space-between;font-size:14px;color:var(--muted);margin-bottom:8px}' +
        '#prof-mod .ob-pbar{height:10px;border-radius:99px;background:rgba(20,22,27,0.10);overflow:hidden}' +
        '#prof-mod .ob-pbar>i{display:block;height:100%;background:var(--amber);border-radius:99px}' +
        '#prof-mod .ob-privacy{display:flex;align-items:center;gap:9px;font-size:14px;color:var(--muted);background:var(--surface);border:0.5px solid var(--line);border-radius:10px;padding:12px 16px;margin-bottom:22px}' +
        '#prof-mod .ob-privacy i{font-size:18px;color:var(--green)}' +
        '#prof-mod .ob-grp{background:var(--surface);border:0.5px solid var(--line);border-radius:14px;padding:8px 22px 12px;margin-bottom:18px}' +
        '#prof-mod .ob-grp-head{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:600;padding:16px 0 6px}' +
        '#prof-mod .ob-grp-head .n{width:26px;height:26px;border-radius:7px;background:var(--amber-soft);color:var(--amber-deep);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}' +
        '#prof-mod .ob-item{display:flex;align-items:flex-start;gap:14px;padding:16px 0;border-top:0.5px solid var(--line)}' +
        '#prof-mod .ob-item:first-of-type{border-top:none}' +
        '#prof-mod .ob-ico{width:30px;height:30px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:16px;margin-top:1px}' +
        '#prof-mod .ob-ico.todo{border:2px solid var(--line);color:var(--muted)}' +
        '#prof-mod .ob-ico.sub{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .ob-ico.ver{background:var(--green);color:#fff}' +
        '#prof-mod .ob-ico.redo{background:var(--red-soft);color:var(--red)}' +
        '#prof-mod .ob-ico.na{background:rgba(20,22,27,0.06);color:var(--muted)}' +
        '#prof-mod .ob-mid{flex:1;min-width:0}' +
        '#prof-mod .ob-title{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
        '#prof-mod .ob-req{font-size:11px;font-weight:700;letter-spacing:.4px;color:var(--amber-deep);background:var(--amber-soft);padding:2px 7px;border-radius:5px}' +
        '#prof-mod .ob-opt{font-size:11px;font-weight:600;color:var(--muted);background:rgba(20,22,27,0.06);padding:2px 7px;border-radius:5px}' +
        '#prof-mod .ob-why{font-size:14px;color:var(--muted);margin-top:3px;line-height:1.45}' +
        '#prof-mod .ob-redo-msg{font-size:13px;color:var(--red);background:var(--red-soft);border-radius:8px;padding:8px 11px;margin-top:8px}' +
        '#prof-mod .ob-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none}' +
        '#prof-mod .ob-chip{font-size:12px;font-weight:600;padding:4px 11px;border-radius:99px;white-space:nowrap}' +
        '#prof-mod .ob-chip.todo{background:rgba(20,22,27,0.06);color:var(--muted)}' +
        '#prof-mod .ob-chip.sub{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#prof-mod .ob-chip.ver{background:var(--green-soft);color:var(--green)}' +
        '#prof-mod .ob-chip.redo{background:var(--red-soft);color:var(--red)}' +
        '#prof-mod .ob-chip.na{background:rgba(20,22,27,0.06);color:var(--muted)}' +
        '#prof-mod .ob-btn{padding:9px 16px;border-radius:9px;font-size:14px;font-weight:500;cursor:pointer;border:0.5px solid var(--line);background:var(--surface);color:var(--ink);white-space:nowrap}' +
        '#prof-mod .ob-btn.primary{background:var(--amber);color:#fff;border-color:var(--amber)}' +
        '#prof-mod .ob-btn.ghost{border:none;background:none;color:var(--muted);padding:6px 4px;font-size:13px}' +
        '#prof-mod .ob-filechip{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink);background:var(--bg);border:0.5px solid var(--line);border-radius:7px;padding:5px 9px;margin-top:8px;text-decoration:none}' +
        '#prof-mod .ob-filechip i{font-size:15px;color:var(--muted)}' +
        '#prof-mod .ob-del{margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;padding:4px}' +
        '#prof-mod .ob-del:hover{color:var(--red)}' +
        '#prof-mod .ob-add{background:var(--surface);border:0.5px dashed var(--line);border-radius:14px;padding:18px 22px;margin-bottom:18px}' +
        '#prof-mod .ob-add h3{font-size:16px;font-weight:600;margin:0 0 12px}' +
        '#prof-mod .ob-add label{font-size:14px;color:var(--muted);display:block;margin-top:10px}' +
        '#prof-mod .ob-add input,#prof-mod .ob-add textarea{width:100%;padding:11px 13px;border:0.5px solid var(--line);border-radius:9px;font-size:15px;font-family:inherit;margin-top:6px;color:var(--ink);background:var(--surface)}' +
        '#profSetup .welcome-banner{position:relative;border-radius:16px;padding:24px 26px;margin-bottom:14px;color:#fff;overflow:hidden;background:linear-gradient(120deg,#C5612A,#EF9F27)}' +
        '#profSetup .welcome-banner .deco{position:absolute;right:-30px;top:-30px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.12)}' +
        '#profSetup .welcome-banner .deco2{position:absolute;right:60px;bottom:-50px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.10)}' +
        '#profSetup .welcome-banner h2{margin:0 0 8px;font-size:24px;font-weight:700;position:relative}' +
        '#profSetup .welcome-banner p{margin:0;font-size:15px;line-height:1.55;max-width:680px;position:relative;opacity:.96}' +
        '#profSetup .welcome-banner .sig{margin-top:12px;font-size:14px;opacity:.9;position:relative}' +
        '#profSetup .setup{background:var(--surface);border:0.5px solid var(--line);border-radius:14px;padding:20px 24px;margin-bottom:14px}' +
        '#profSetup .setup-top{display:flex;align-items:center;gap:12px;margin-bottom:14px}' +
        '#profSetup .setup-top .ic{width:40px;height:40px;border-radius:11px;background:var(--amber-soft);color:var(--amber-deep);display:flex;align-items:center;justify-content:center;font-size:22px;flex:none}' +
        '#profSetup .setup-top h3{margin:0;font-size:18px;font-weight:600}' +
        '#profSetup .setup-top .sub{font-size:14px;color:var(--muted);margin-top:2px}' +
        '#profSetup .setup-top .count{margin-left:auto;font-size:14px;color:var(--muted);font-weight:500;white-space:nowrap}' +
        '#profSetup .setup-toggle{margin-left:14px;width:34px;height:34px;border-radius:9px;border:0.5px solid var(--line);background:var(--surface);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}' +
        '#profSetup .setup-toggle:hover{color:var(--ink);background:var(--bg)}' +
        '#profSetup .setup-toggle i{font-size:18px}' +
        '#profSetup .setup .ob-pbar{margin-bottom:6px}' +
        '#profSetup .setup .ob-grp-head{border-top:0.5px solid var(--line);margin-top:8px;padding-top:14px}' +
        '#profSetup .setup .ob-grp-head.first{border-top:none;margin-top:4px;padding-top:8px}' +
        '#profSetup .setup-done{display:flex;align-items:center;gap:12px;background:var(--green-soft);border:0.5px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:14px}' +
        '#profSetup .setup-done i{font-size:22px;color:var(--green)}' +
        '#profSetup .setup-done .txt{font-weight:600;color:var(--green)}' +
        '#profSetup .setup-done .vd{margin-left:auto;font-size:14px;color:var(--green);font-weight:600;cursor:pointer}' +
        // ----- Offboarding: HR tracker + leaver panel -----
        '#profSetup .exit-head{position:relative;border-radius:16px;padding:22px 24px;margin-bottom:14px;color:#fff;overflow:hidden;background:linear-gradient(120deg,#3A4250,#5A6473)}' +
        '#profSetup .exit-head .deco{position:absolute;right:-30px;top:-40px;width:170px;height:170px;border-radius:50%;background:rgba(255,255,255,0.07)}' +
        '#profSetup .exit-head h2{margin:0;font-size:21px;font-weight:700;position:relative;display:flex;align-items:center;gap:9px}' +
        '#profSetup .exit-head .emeta{position:relative;display:flex;gap:18px;flex-wrap:wrap;font-size:14px;opacity:.95;margin-top:8px}' +
        '#profSetup .exit-head .emeta b{font-weight:600}' +
        '#profSetup .fnf-badge{position:relative;display:inline-flex;align-items:center;gap:7px;margin-top:14px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:99px;padding:6px 13px;font-size:13px;font-weight:500}' +
        '#profSetup .setup-top .ic.slate{background:var(--slate-soft,#EEF1F5);color:var(--slate,#475569)}' +
        '#profSetup .own{font-size:11px;font-weight:700;letter-spacing:.3px;padding:2px 7px;border-radius:5px}' +
        '#profSetup .own.it{background:rgba(40,90,180,0.10);color:#2D5BAF}' +
        '#profSetup .own.finance{background:var(--amber-soft);color:var(--amber-deep)}' +
        '#profSetup .own.manager{background:#EEF1F5;color:#475569}' +
        '#profSetup .own.hr{background:var(--green-soft);color:var(--green)}' +
        '#profSetup .own.leaver{background:rgba(20,22,27,0.06);color:var(--muted)}' +
        '#profSetup .fnf-card{background:var(--bg);border:0.5px solid var(--line);border-radius:10px;padding:12px 16px;margin:4px 0 12px}' +
        '#profSetup .fnf-line{display:flex;justify-content:space-between;font-size:14px;padding:7px 0;border-bottom:0.5px solid var(--line)}' +
        '#profSetup .fnf-line:last-child{border-bottom:none}#profSetup .fnf-line .v{font-weight:600}' +
        '#profSetup .flag{font-size:12px;padding:2px 8px;border-radius:5px;font-weight:600;background:var(--amber-soft);color:var(--amber-deep)}' +
        '#profSetup .flag.ok{background:var(--green-soft);color:var(--green)}' +
        '#profSetup .lv-head{position:relative;border-radius:16px;padding:24px 26px;margin-bottom:14px;color:#fff;overflow:hidden;background:linear-gradient(120deg,#3B6D11,#5E8B2A)}' +
        '#profSetup .lv-head .deco{position:absolute;right:-30px;top:-30px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.10)}' +
        '#profSetup .lv-head h2{margin:0 0 8px;font-size:22px;font-weight:700;position:relative}' +
        '#profSetup .lv-head p{margin:0;font-size:15px;line-height:1.55;max-width:640px;position:relative;opacity:.96}' +
        '#profSetup .lv-card{background:var(--surface);border:0.5px solid var(--line);border-radius:14px;padding:20px 24px;margin-bottom:14px}' +
        '#profSetup .lv-card h3{margin:0 0 12px;font-size:17px;font-weight:600;display:flex;align-items:center;gap:9px}' +
        '#profSetup .lv-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:0.5px solid var(--line)}' +
        '#profSetup .lv-item:first-of-type{border-top:none}' +
        '#profSetup .doc{display:flex;align-items:center;gap:12px;padding:13px 0;border-top:0.5px solid var(--line)}' +
        '#profSetup .doc:first-of-type{border-top:none}#profSetup .doc i.f{font-size:22px;color:var(--slate,#475569)}' +
        '#profSetup .doc .dn{flex:1}#profSetup .doc .dn .t{font-size:15px;font-weight:600}#profSetup .doc .dn .s{font-size:13px;color:var(--muted)}' +
        '#profSetup .doc .dl{padding:8px 15px;border-radius:9px;font-size:14px;font-weight:500;border:0.5px solid var(--line);background:var(--surface);cursor:pointer;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:6px}' +
        '#profSetup .doc .dl.ready{background:var(--green);color:#fff;border-color:var(--green)}' +
        '#profSetup .doc .dl.wait{color:var(--muted);cursor:default}' +
        '#profSetup .exit-note{font-size:13px;color:var(--muted);background:var(--bg);border:0.5px solid var(--line);border-radius:10px;padding:12px 15px;display:flex;gap:9px;align-items:flex-start}' +
        '#profSetup .exit-note i{color:var(--slate,#475569);font-size:17px;margin-top:1px}' +
      '</style>' +
      '<div id="prof-mod">' +
        '<div class="header-card" id="profHeader">' +
          '<div class="prof-photo-wrap" id="profPhotoWrap">' +
            '<div class="avatar-lg" id="profAvatar">—</div>' +
            '<button class="prof-photo-btn" id="profPhotoBtn" title="Change photo" style="display:none"><i class="ti ti-camera"></i></button>' +
            '<input type="file" id="profPhotoInput" accept="image/png,image/jpeg,image/webp" style="display:none">' +
          '</div>' +
          '<div class="header-info">' +
            '<h1 id="profName">Loading…</h1>' +
            '<div class="header-meta" id="profMeta"></div>' +
            '<div class="prof-tiles" id="profTiles"></div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;align-items:flex-end">' +
            '<div id="profStatusPill"></div>' +
            '<div class="header-actions" id="profActions"></div>' +
          '</div>' +
        '</div>' +
        '<div id="profSetup"></div>' +
        '<div class="sectabs" id="profSecTabs"></div>' +
        '<h2 class="sec-title" id="profPanelTitle">—</h2>' +
        '<p class="sec-sub" id="profPanelSub">—</p>' +
        '<div id="profPanelBody">Loading…</div>' +
      '</div>';
  },

  async mount(rootEl, ctx) {
    // ctx.params is something like { userId: 'me' } or { userId: '42' }
    // From the route #profile/me or #profile/42
    // r0.16 — also supports { userId, drawer } to pre-select a drawer.
    const meId = (window.fkUser && window.fkUser.id) || (window.cpUser && window.cpUser.id);
    const raw = ctx && ctx.params && ctx.params.userId;
    const initialDrawer = (ctx && ctx.params && ctx.params.drawer) || null;
    const profileUserId = (!raw || raw === 'me') ? meId : parseInt(raw, 10);
    if (!Number.isFinite(profileUserId)) {
      document.getElementById('profPanelBody').innerHTML =
        '<div style="color:var(--red)">Bad profile id</div>';
      return;
    }

    // --- Helpers --------------------------------------------------------
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const escAttr = esc;
    const fmtDate = (iso) => {
      if (!iso) return '';
      const s = String(iso);
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[3] + '/' + m[2] + '/' + m[1];
      const d = new Date(s);
      return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB');
    };
    const fmtSize = (b) => {
      if (b == null) return '';
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
      return (b / 1024 / 1024).toFixed(1) + ' MB';
    };

    let overview = null;
    let viewer = null;
    let currentDrawer = null;

    // --- Overview fetch ------------------------------------------------
    async function loadOverview() {
      const r = await fetch('/api/profile/' + profileUserId + '/overview', { credentials: 'include' });
      if (!r.ok) {
        document.getElementById('profPanelBody').innerHTML =
          '<div style="color:var(--red)">' + (r.status === 403 ? 'Permission denied' : 'Failed to load') + '</div>';
        return false;
      }
      overview = await r.json();
      viewer = overview.viewer;
      renderHeader();
      renderDrawerNav();
      refreshSetup();
      return true;
    }

    function tenureText(hireIso) {
      if (!hireIso) return '—';
      const h = new Date(hireIso);
      if (isNaN(h.getTime())) return '—';
      const now = new Date();
      let months = (now.getFullYear() - h.getFullYear()) * 12 + (now.getMonth() - h.getMonth());
      if (now.getDate() < h.getDate()) months--;
      if (months < 0) months = 0;
      const y = Math.floor(months / 12), m = months % 12;
      if (y === 0) return m + (m === 1 ? ' month' : ' months');
      if (m === 0) return y + (y === 1 ? ' year' : ' years');
      return y + 'y ' + m + 'm';
    }

    function renderHeader() {
      const u = overview.user;
      const colour = u.avatar_colour || '#888780';
      const avatar = document.getElementById('profAvatar');
      if (u.has_photo) {
        avatar.style.background = "var(--bg) url('/api/profile/" + profileUserId + "/photo?t=" + Date.now() + "') center/cover";
        avatar.textContent = '';
      } else {
        avatar.style.background = colour;
        avatar.style.color = '#FFFFFF';
        avatar.textContent = u.initials || (u.full_name || '?')[0];
      }
      document.getElementById('profName').textContent = u.display_name || u.full_name || '—';

      const metaParts = [];
      if (u.emp_id) metaParts.push('<i class="ti ti-id"></i> ' + esc(u.emp_id));
      if (u.departments && u.departments.length) {
        metaParts.push('<i class="ti ti-building"></i> ' + u.departments.map(d => esc(d.name)).join(', '));
      }
      if (u.employment_status === 'active' && u.hire_date) {
        metaParts.push('<i class="ti ti-calendar"></i> Joined ' + fmtDate(u.hire_date));
      } else if (u.employment_status !== 'active') {
        metaParts.push('<span style="color:var(--red)">No longer at FK Sports</span>');
      }
      document.getElementById('profMeta').innerHTML = metaParts.map(p => '<span>' + p + '</span>').join('');

      // Tiles: Tenure · Profile completeness · Status
      const c = overview.completeness || { percent: 0 };
      const statusLabel = u.status === 'active' ? 'Active' : u.status === 'idle' ? 'Idle' : u.status === 'offline' ? 'Offline' : '—';
      const statusColour = u.status === 'active' ? 'var(--green)' : u.status === 'idle' ? 'var(--amber-deep)' : 'var(--muted)';
      document.getElementById('profTiles').innerHTML =
        '<div class="prof-tile"><div class="t-lbl">Tenure</div><div class="t-val">' + tenureText(u.hire_date) + '</div></div>' +
        '<div class="prof-tile" id="profTileComplete"><div class="t-lbl">Profile complete</div><div class="t-val">' + (c.percent || 0) + '%</div>' +
          '<div class="prof-bar"><i style="width:' + (c.percent || 0) + '%"></i></div></div>' +
        '<div class="prof-tile"><div class="t-lbl">Status</div><div class="t-val" style="color:' + statusColour + '">' + statusLabel + '</div></div>';

      // Status pill (kept, top-right) — probation state first, then presence.
      const sp = document.getElementById('profStatusPill');
      let probationPill = '';
      if (u.probation_status === 'in_probation') probationPill = '<span class="pill probation"><i class="ti ti-clock"></i> Probation</span>';
      else if (u.probation_status === 'probation_pass_expected') probationPill = '<span class="pill on-track"><i class="ti ti-circle-check"></i> On track</span>';
      else if (u.probation_status === 'extended') probationPill = '<span class="pill probation"><i class="ti ti-alert-triangle"></i> Probation extended</span>';
      else if (u.probation_status === 'failed') probationPill = '<span class="pill off"><i class="ti ti-x"></i> Probation failed</span>';
      let presence = '';
      if (u.status === 'active') presence = '<span class="pill">Active</span>';
      else if (u.status === 'idle') presence = '<span class="pill idle">Idle</span>';
      else if (u.status === 'offline') presence = '<span class="pill off">Offline</span>';
      sp.innerHTML = probationPill + (probationPill && presence ? ' ' : '') + presence;

      // Manage probation (HR) — visible while probation is in progress.
      const acts = document.getElementById('profActions');
      if (acts) {
        const inProg = ['in_probation', 'probation_pass_expected', 'extended'].includes(u.probation_status);
        let btns = '';
        if (viewer.can_manage_probation && inProg) {
          btns += '<button class="det-btn" id="profManageProb"><i class="ti ti-user-check"></i> Manage probation</button>';
        }
        // Start offboarding (HR) — anyone not already leaving/left.
        if (viewer.can_edit_any && u.employment_status !== 'left' && !u.last_working_day) {
          btns += '<button class="det-btn" id="profStartExit"><i class="ti ti-door-exit"></i> Start offboarding</button>';
        }
        acts.innerHTML = btns;
        const mp = document.getElementById('profManageProb');
        if (mp) mp.addEventListener('click', manageProbation);
        const se = document.getElementById('profStartExit');
        if (se) se.addEventListener('click', startOffboarding);
      }

      // Photo upload (self or HR)
      const canEditPhoto = viewer.is_self || viewer.can_edit_any;
      const pBtn = document.getElementById('profPhotoBtn');
      const pInput = document.getElementById('profPhotoInput');
      if (canEditPhoto && pBtn && !pBtn.dataset.wired) {
        pBtn.style.display = 'flex';
        pBtn.dataset.wired = '1';
        pBtn.addEventListener('click', () => pInput.click());
        pInput.addEventListener('change', async () => {
          const f = pInput.files && pInput.files[0];
          if (!f) return;
          const fd = new FormData();
          fd.append('file', f);
          pBtn.disabled = true;
          try {
            const r = await fetch('/api/profile/' + profileUserId + '/photo', { method: 'POST', credentials: 'include', body: fd });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { alert(d.error || 'Upload failed'); }
            else { await loadOverview(); }
          } catch (e) { alert('Upload failed'); }
          pBtn.disabled = false;
          pInput.value = '';
        });
      }
    }

    // Map legacy drawer keys (used by notification deep-links) → new sections.
    function mapLegacySection(key) {
      const m = { personal: 'details', salary: 'pay', payroll: 'pay', insurance: 'pay',
                  reviews: 'about', attendance: 'time', employment: 'employment',
                  onboarding: 'onboarding', about: 'about', details: 'details', pay: 'pay', time: 'time' };
      return m[key] || null;
    }

    function renderDrawerNav() {
      const nav = document.getElementById('profSecTabs');
      const counts = overview.counts || {};
      const dset = new Set(overview.drawers || []);
      const hasEmployment = dset.has('employment');
      const hasPay = dset.has('salary') || dset.has('payroll') || dset.has('insurance') || viewer.can_view_salary;
      const hasOnboarding = dset.has('onboarding');
      const payCount = (counts.salary || 0) + (counts.payroll || 0) + (counts.insurance || 0);

      // Fixed order. Onboarding is NOT a tab — it lives in the setup strip above.
      const SECTIONS = [
        { key: 'about',      icon: 'ti-user-circle', label: 'About me',   show: true },
        { key: 'details',    icon: 'ti-id',          label: 'My details', show: true },
        { key: 'employment', icon: 'ti-briefcase',   label: 'Employment', show: hasEmployment, count: counts.employment },
        { key: 'pay',        icon: 'ti-coin',        label: 'Pay',        show: hasPay, count: payCount },
        { key: 'time',       icon: 'ti-calendar',    label: 'Time',       show: true },
      ].filter(s => s.show);

      nav.innerHTML = SECTIONS.map(s => {
        let countHtml = '';
        if (s.count != null && s.count > 0) countHtml = '<span class="count">' + s.count + '</span>';
        return '<button class="sectab" data-drawer="' + s.key + '">' +
          '<i class="ti ' + s.icon + '"></i><span>' + s.label + '</span>' + countHtml + '</button>';
      }).join('');
      nav.querySelectorAll('.sectab').forEach(el => {
        el.addEventListener('click', () => loadDrawer(el.dataset.drawer));
      });

      const keys = SECTIONS.map(s => s.key);
      const wanted = initialDrawer ? mapLegacySection(initialDrawer) : null;
      // Deep-link to onboarding → expand the setup strip rather than a tab.
      if (initialDrawer === 'onboarding' || wanted === 'onboarding') {
        loadDrawer('about');
        setupExpanded = true;
        setTimeout(() => { const s = document.getElementById('profSetup'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150);
      } else if (wanted && keys.includes(wanted)) loadDrawer(wanted);
      else loadDrawer('about');
    }

    // --- Drawer load + render -----------------------------------------
    async function loadDrawer(drawer) {
      currentDrawer = drawer;
      // Mark active tab
      document.querySelectorAll('#profSecTabs .sectab').forEach(el => {
        el.classList.toggle('on', el.dataset.drawer === drawer);
      });
      const titleEl = document.getElementById('profPanelTitle');
      const subEl = document.getElementById('profPanelSub');
      const body = document.getElementById('profPanelBody');
      body.innerHTML = '<div style="color:var(--muted);padding:20px 0">Loading…</div>';

      const TITLES = {
        about: ['About me', 'Your snapshot and what is left to complete.'],
        details: ['My details', 'Contact, emergency, pay and tax details.'],
        employment: ['Employment', 'Contract and role documents.'],
        pay: ['Pay', 'Salary, payslips and where you are paid.'],
        time: ['Time', 'Monthly attendance calendar.'],
        onboarding: ['Onboarding', 'Joining checklist and signed docs.'],
      };
      titleEl.textContent = (TITLES[drawer] || [drawer])[0];
      subEl.textContent = (TITLES[drawer] || ['', ''])[1];

      try {
        if (drawer === 'about') { renderAboutSection(); return; }
        if (drawer === 'details') { renderMyDetails(); return; }
        if (drawer === 'time') { await renderAttendanceDrawer(); return; }
        if (drawer === 'pay') { await renderPaySection(); return; }
        // employment = file drawer
        const r = await fetch('/api/profile/' + profileUserId + '/drawer/' + drawer, { credentials: 'include' });
        if (!r.ok) {
          body.innerHTML = '<div style="color:var(--red)">Failed to load</div>';
          return;
        }
        const data = await r.json();
        renderGenericDrawer(data, drawer);
      } catch (e) {
        console.error('[profile loadDrawer]', e);
        body.innerHTML = '<div style="color:var(--red)">Failed to load</div>';
      }
    }

    // --- File row component (r0.16 NEW) -------------------------------
    // r0.16.3 — fileRowHtml takes drawer explicitly. Backend doesn't return
    // file.user_id or file.drawer (those are implicit at the query level).
    // All files in `data.files` belong to profileUserId and to `drawer`.
    function fileRowHtml(file, drawer) {
      const isOwnFile = profileUserId === viewer.user_id;
      const canDownload = viewer.can_view_salary || isOwnFile;
      const canDelete = viewer.can_delete_any || (isOwnFile && drawer === 'personal');
      const canReplace = viewer.can_upload_any || (isOwnFile && drawer === 'personal');
      const downloadBtn = canDownload
        ? '<button class="file-download" data-id="' + file.id + '"><i class="ti ti-download"></i>Download</button>'
        : '<button disabled title="Download restricted to Owner + HR"><i class="ti ti-lock"></i>Download</button>';
      const replaceBtn = canReplace
        ? '<button class="file-replace" data-id="' + file.id + '"><i class="ti ti-refresh"></i>Replace</button>'
        : '';
      const deleteBtn = canDelete
        ? '<button class="file-delete btn-danger" data-id="' + file.id + '" aria-label="Delete"><i class="ti ti-trash"></i></button>'
        : '';
      const icon = file.mime_type === 'application/pdf' ? 'ti-file-type-pdf' :
                   (file.mime_type || '').startsWith('image/') ? 'ti-photo' : 'ti-file';
      return '<div class="file-row">' +
        '<i class="ti ' + icon + '"></i>' +
        '<div class="file-meta">' +
          '<div class="file-name">' + esc(file.filename) + '</div>' +
          '<div class="file-sub">Uploaded ' + fmtDate(file.uploaded_at) + ' · ' + fmtSize(file.size_bytes) + '</div>' +
        '</div>' +
        '<button class="file-view" data-id="' + file.id + '"><i class="ti ti-eye"></i>View</button>' +
        replaceBtn +
        downloadBtn +
        deleteBtn +
      '</div>';
    }

    function wireFileRowHandlers() {
      const body = document.getElementById('profPanelBody');
      body.querySelectorAll('.file-view').forEach(b => {
        b.addEventListener('click', () => {
          window.open('/api/files/' + b.dataset.id, '_blank', 'noopener');
        });
      });
      body.querySelectorAll('.file-download').forEach(b => {
        b.addEventListener('click', () => {
          // ?download=1 triggers attachment + permission check
          window.location.href = '/api/files/' + b.dataset.id + '?download=1';
        });
      });
      body.querySelectorAll('.file-delete').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('Delete this file? This cannot be undone.')) return;
          const r = await fetch('/api/files/' + b.dataset.id, { method: 'DELETE', credentials: 'include' });
          if (!r.ok) { alert('Delete failed'); return; }
          loadDrawer(currentDrawer);
        });
      });
      body.querySelectorAll('.file-replace').forEach(b => {
        b.addEventListener('click', () => {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = '.pdf,.png,application/pdf,image/png';
          inp.style.display = 'none';
          inp.addEventListener('change', async () => {
            if (!inp.files.length) return;
            const fd = new FormData();
            fd.append('file', inp.files[0]);
            const r = await fetch('/api/files/' + b.dataset.id + '/replace', {
              method: 'POST', credentials: 'include', body: fd
            });
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              alert('Replace failed: ' + (err.error || r.status));
              return;
            }
            loadDrawer(currentDrawer);
          });
          document.body.appendChild(inp);
          inp.click();
          setTimeout(() => inp.remove(), 1000);
        });
      });
    }

    // --- Upload area ---------------------------------------------------
    function uploadAreaHtml(drawer) {
      const canUpload = viewer.can_upload_any || (viewer.is_self && drawer === 'personal' && viewer.can_upload_own);
      if (!canUpload) return '';
      // Salary drawer extra-gate
      if (drawer === 'salary' && !viewer.can_edit_salary) return '';
      return '<div class="upload-area">' +
        '<input type="file" id="profUpload" accept=".pdf,.png,application/pdf,image/png" />' +
        '<label for="profUpload"><i class="ti ti-upload"></i> Upload a file (PDF or PNG)</label>' +
      '</div>';
    }
    function wireUploadHandler(drawer) {
      const inp = document.getElementById('profUpload');
      if (!inp) return;
      inp.addEventListener('change', async () => {
        if (!inp.files.length) return;
        const fd = new FormData();
        fd.append('file', inp.files[0]);
        fd.append('user_id', String(profileUserId));
        fd.append('drawer', drawer);
        const r = await fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert('Upload failed: ' + (err.error || r.status));
          return;
        }
        loadDrawer(currentDrawer);
      });
    }

    // --- Generic drawer (files + onboarding items + salary structure) ----
    function renderGenericDrawer(data, drawer) {
      const body = document.getElementById('profPanelBody');
      const files = data.files || [];
      let html = '';

      // Onboarding: render checklist items first
      if (drawer === 'onboarding' && Array.isArray(data.notes) && data.notes.length > 0) {
        html += '<div style="margin-bottom:14px">';
        for (const it of data.notes) {
          const done = !!it.is_completed;
          html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--line)">' +
            '<i class="ti ' + (done ? 'ti-circle-check' : 'ti-circle') + '" style="font-size:18px;color:' + (done ? 'var(--green)' : 'var(--muted)') + '"></i>' +
            '<div style="flex:1"><div style="font-size:14px;' + (done ? 'text-decoration:line-through;color:var(--muted)' : '') + '">' + esc(it.title) + '</div>' +
              (it.body ? '<div style="font-size:12px;color:var(--muted);margin-top:2px;white-space:pre-wrap">' + esc(it.body) + '</div>' : '') +
            '</div>' +
          '</div>';
        }
        html += '</div>';
      }

      // Salary: render the salary card if present
      if (drawer === 'salary' && data.salary) {
        const s = data.salary;
        const curr = s.currency || '£';
        html += '<div class="info-block">' +
          '<div class="info-block-title">Current salary</div>' +
          '<div class="info-row"><span class="info-label">Monthly CTC</span> ' + esc(curr) + ' ' + (s.monthly_ctc != null ? Number(s.monthly_ctc).toLocaleString('en-GB') : '—') + '</div>' +
          (s.effective_from ? '<div class="info-row"><span class="info-label">Effective from</span> ' + fmtDate(s.effective_from) + '</div>' : '') +
          (s.notes ? '<div class="info-row" style="white-space:pre-wrap"><span class="info-label">Notes</span> ' + esc(s.notes) + '</div>' : '') +
        '</div>';
      }

      // Personal: contact + emergency + DOB + address read-only
      if (drawer === 'personal' && overview && overview.user) {
        const u = overview.user;
        const dobStr = u.date_of_birth ? fmtDate(u.date_of_birth) : '';
        if (u.phone || u.email) {
          html += '<div class="info-block">' +
            '<div class="info-block-title">Contact</div>' +
            (u.phone ? '<div class="info-row"><span class="info-label">Phone</span> ' + esc(u.phone) + '</div>' : '') +
            (u.email ? '<div class="info-row"><span class="info-label">Email</span> ' + esc(u.email) + '</div>' : '') +
          '</div>';
        }
        if (dobStr || u.personal_address) {
          html += '<div class="info-block">' +
            '<div class="info-block-title">Personal</div>' +
            (dobStr ? '<div class="info-row"><span class="info-label">Date of birth</span> ' + fmtDate(dobStr) + '</div>' : '') +
            (u.personal_address ? '<div class="info-row" style="white-space:pre-wrap"><span class="info-label">Home address</span> ' + esc(u.personal_address) + '</div>' : '') +
          '</div>';
        }
        if (u.emergency_contact) {
          html += '<div class="info-block">' +
            '<div class="info-block-title">Emergency contact</div>' +
            '<div class="info-row" style="white-space:pre-wrap">' + esc(u.emergency_contact) + '</div>' +
          '</div>';
        }
        // Note: editing personal info stays on profile.html for r0.16. The module
        // is read-only for personal info; we'll add edit forms in a later ship.
        if (viewer && viewer.is_self) {
          html += '<div style="font-size:12px;color:var(--muted);margin:8px 0 14px">To edit personal details, use the legacy profile page for now.</div>';
        }
      }

      // Employment drawer: read-only employment info
      if (drawer === 'employment' && overview && overview.user) {
        const u = overview.user;
        const parts = [];
        if (u.employment_type) parts.push(['Employment type', u.employment_type.replace(/_/g, ' ')]);
        if (u.work_pattern) parts.push(['Work pattern', u.work_pattern.replace(/_/g, ' ')]);
        if (u.hire_date) parts.push(['Hire date', fmtDate(u.hire_date)]);
        if (u.probation_end_date) parts.push(['Probation ends', fmtDate(u.probation_end_date)]);
        if (u.probation_status) parts.push(['Probation status', u.probation_status.replace(/_/g, ' ')]);
        if (u.notice_period_days) parts.push(['Notice period', u.notice_period_days + ' days']);
        if (parts.length) {
          html += '<div class="info-block">' +
            '<div class="info-block-title">Employment</div>' +
            parts.map(p => '<div class="info-row"><span class="info-label">' + p[0] + '</span> ' + esc(p[1]) + '</div>').join('') +
          '</div>';
        }
      }

      // Files
      html += '<div style="margin-top:4px"><div class="info-block-title" style="margin-bottom:8px">Files</div>';
      if (files.length === 0) {
        html += '<div style="color:var(--muted);padding:10px 0">No files in this drawer yet.</div>';
      } else {
        html += files.map(f => fileRowHtml(f, drawer)).join('');
      }
      html += '</div>';

      html += uploadAreaHtml(drawer);
      body.innerHTML = html;
      wireFileRowHandlers();
      wireUploadHandler(drawer);
    }

    // --- Reviews drawer (Monday-style cards, r0.16 NEW) ---------------
    function reviewStageLabel(rt) {
      const map = {
        '1_month': '1 month review',
        '3_month': '3 month review',
        '4_month': '4 month review',
        '6_month': '6 month review',
        '8_month': '8 month review',
        'annual': 'Annual review',
        'ad_hoc': 'Ad-hoc review',
      };
      return map[rt] || (rt + ' review');
    }
    function outcomeLabel(s) {
      const map = {
        scheduled: 'Scheduled',
        cancelled: 'Cancelled',
        needs_improvement: 'Needs improvement',
        passed: 'Passed',
        excellent: 'Excellent',
        salary_reviewed: 'Salary reviewed',
        in_process: 'In process',
        // legacy
        pass: 'Passed', extend: 'Needs improvement', fail: 'Failed',
        satisfactory: 'Satisfactory', good: 'Good',
      };
      return map[s] || s;
    }
    function outcomeClass(s) {
      if (['pass'].includes(s)) return 'outcome-passed';
      if (['extend'].includes(s)) return 'outcome-needs_improvement';
      return 'outcome-' + (s || 'scheduled');
    }
    function reviewCardHtml(rv) {
      const isCancelled = !!rv.cancelled_at;
      const isFuture = (rv.status === 'scheduled' || (!rv.status && !rv.is_completed)) && !isCancelled;
      const docs = rv.attached_files || [];
      const status = isCancelled ? 'cancelled' : (rv.status || 'scheduled');
      return '<div class="review-card ' + (isCancelled ? 'cancelled' : (isFuture ? 'scheduled' : '')) + '" data-rid="' + rv.id + '">' +
        '<div class="review-card-head">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span class="stage-chip">' + esc(reviewStageLabel(rv.review_type)) + '</span>' +
            (rv.review_date ? '<span class="review-date"><i class="ti ti-calendar" style="font-size:13px;vertical-align:-2px"></i> ' + fmtDate(rv.review_date) + '</span>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span class="outcome-chip ' + outcomeClass(status) + '">' + esc(outcomeLabel(status)) + '</span>' +
            (!isCancelled ? '<button class="more-btn rv-more" data-rid="' + rv.id + '" aria-label="More">⋯</button>' : '') +
          '</div>' +
        '</div>' +
        (rv.body ? '<div class="review-notes">' + esc(rv.body) + '</div>' : '') +
        (docs.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px">' + docs.map(f => '<span class="doc-chip rv-doc" data-fid="' + f.id + '"><i class="ti ti-paperclip" style="font-size:13px"></i>' + esc(f.filename) + '</span>').join('') + '</div>' : '') +
      '</div>';
    }
    function renderReviewsDrawer(data) {
      const body = document.getElementById('profPanelBody');
      // Backend already filters by kind='review' in SQL — no need to re-filter client-side.
      // (The kind column isn't even selected in the response.)
      const reviews = data.notes || [];
      const files = data.files || [];
      const canEdit = viewer.can_edit_any || viewer.can_edit_dept;

      // Sort: scheduled future first, then by date desc; cancelled goes last
      reviews.sort((a, b) => {
        if (!!a.cancelled_at !== !!b.cancelled_at) return a.cancelled_at ? 1 : -1;
        return (b.review_date || '').localeCompare(a.review_date || '');
      });

      let html = '';
      if (reviews.length === 0) {
        html = '<div style="color:var(--muted);padding:20px 0;text-align:center">No reviews yet.</div>';
      } else {
        html = reviews.map(reviewCardHtml).join('');
      }
      if (canEdit) {
        html += '<button class="header-action-btn" id="rvAddBtn" style="margin-top:14px"><i class="ti ti-plus"></i>Add review</button>';
      }
      body.innerHTML = html;

      // Wire doc-chip clicks (open file inline)
      body.querySelectorAll('.rv-doc').forEach(el => {
        el.addEventListener('click', () => window.open('/api/files/' + el.dataset.fid, '_blank', 'noopener'));
      });
      // Wire ⋯ menus
      body.querySelectorAll('.rv-more').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          showReviewMoreMenu(btn);
        });
      });
      // Wire Add button
      const addBtn = document.getElementById('rvAddBtn');
      if (addBtn) addBtn.addEventListener('click', () => openAddReviewForm());
    }

    // r0.16.4 — Menus are appended to document.body (so they're not scoped to
    // #prof-mod). Clean them + the outside-click listener via one helper so
    // unmount can fully tear down. window.__fkProfMenuCloser holds the live
    // listener ref so it can be removed if the user navigates with a menu open.
    function closeProfMenus() {
      document.querySelectorAll('.more-menu').forEach(m => m.remove());
      if (window.__fkProfMenuCloser) {
        document.removeEventListener('click', window.__fkProfMenuCloser);
        window.__fkProfMenuCloser = null;
      }
    }

    function showReviewMoreMenu(btn) {
      // close any existing
      closeProfMenus();
      const rid = btn.dataset.rid;
      const menu = document.createElement('div');
      menu.className = 'more-menu';
      menu.innerHTML =
        '<button data-act="reschedule">Reschedule</button>' +
        '<button data-act="cancel" class="danger">Cancel review</button>';
      document.body.appendChild(menu);
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
      menu.style.left = (rect.right + window.scrollX - menu.offsetWidth) + 'px';
      menu.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', async () => {
          closeProfMenus();
          if (b.dataset.act === 'cancel') {
            const reason = prompt('Reason for cancelling this review? (optional)');
            if (reason === null) return;
            const r = await fetch('/api/profile/' + profileUserId + '/notes/' + rid + '/cancel',
              { method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason }) });
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              alert('Cancel failed: ' + (err.error || r.status));
              return;
            }
            loadDrawer('reviews');
          } else if (b.dataset.act === 'reschedule') {
            openDateModal({
              title: 'Reschedule review', dateLabel: 'New review date', saveLabel: 'Reschedule',
              onSave: async (iso) => {
                const r = await fetch('/api/profile/' + profileUserId + '/notes/' + rid,
                  { method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ review_date: iso }) });
                if (!r.ok) { alert('Reschedule failed'); return false; }
                loadDrawer('reviews'); return true;
              } });
          }
        });
      });
      // Close on outside click — stash the ref so unmount can remove it if the
      // user navigates away with the menu still open.
      setTimeout(() => {
        const closer = function () { closeProfMenus(); };
        window.__fkProfMenuCloser = closer;
        document.addEventListener('click', closer, { once: true });
      }, 0);
    }

    function openAddReviewForm() {
      const body = document.getElementById('profPanelBody');
      body.insertAdjacentHTML('beforeend',
        '<div class="info-block" id="rvAddBox" style="margin-top:14px">' +
          '<div class="info-block-title">Add review</div>' +
          '<div style="display:grid;gap:10px;grid-template-columns:1fr 1fr">' +
            '<div><label style="font-size:12px;color:var(--muted)">Type</label>' +
              '<select id="rvType" style="width:100%;padding:7px;border:0.5px solid var(--line);border-radius:6px">' +
                '<option value="1_month">1 month</option>' +
                '<option value="3_month">3 month</option>' +
                '<option value="4_month">4 month</option>' +
                '<option value="6_month">6 month</option>' +
                '<option value="8_month">8 month</option>' +
                '<option value="annual">Annual</option>' +
                '<option value="ad_hoc">Ad-hoc</option>' +
              '</select></div>' +
            '<div><label style="font-size:12px;color:var(--muted)">Date</label>' +
              '<input id="rvDate" type="date" style="width:100%;padding:7px;border:0.5px solid var(--line);border-radius:6px" /></div>' +
            '<div style="grid-column:span 2"><label style="font-size:12px;color:var(--muted)">Notes (optional)</label>' +
              '<textarea id="rvNotes" style="width:100%;padding:7px;border:0.5px solid var(--line);border-radius:6px;min-height:60px"></textarea></div>' +
          '</div>' +
          '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end">' +
            '<button class="header-action-btn" id="rvCancel">Cancel</button>' +
            '<button class="header-action-btn" id="rvSave" style="color:var(--amber-deep)">Save</button>' +
          '</div>' +
        '</div>'
      );
      document.getElementById('rvCancel').addEventListener('click', () => {
        document.getElementById('rvAddBox').remove();
      });
      document.getElementById('rvSave').addEventListener('click', async () => {
        const review_type = document.getElementById('rvType').value;
        const review_date = document.getElementById('rvDate').value;
        const body_txt = document.getElementById('rvNotes').value;
        if (!review_date) { alert('Date required'); return; }
        const r = await fetch('/api/profile/' + profileUserId + '/notes',
          { method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'review', review_type, review_date, body: body_txt, title: reviewStageLabel(review_type) }) });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert('Save failed: ' + (err.error || r.status));
          return;
        }
        loadDrawer('reviews');
      });
    }

    // --- Attendance drawer (r0.16 NEW) --------------------------------
    let attYear = new Date().getFullYear();
    let attMonth = new Date().getMonth() + 1;

    async function renderAttendanceDrawer() {
      const body = document.getElementById('profPanelBody');
      // r0.16.4 — Gate the scaffold build on the LIVE panel body, not a
      // document-wide lookup. A stale #attMonthLabel left elsewhere in the DOM
      // used to make this skip the build, so #attGrid was never created and
      // loadAttendanceMonth crashed on a null grid. loadDrawer always clears
      // `body` first, so this rebuilds the scaffold on every open.
      if (!body.querySelector('#attMonthLabel')) {
        body.innerHTML =
        '<div class="att-cal">' +
          '<div class="att-cal-head">' +
            '<div class="att-cal-nav">' +
              '<button class="header-action-btn" id="attPrev"><i class="ti ti-chevron-left"></i></button>' +
              '<div id="attMonthLabel" style="font-weight:500;min-width:140px;text-align:center">—</div>' +
              '<button class="header-action-btn" id="attNext"><i class="ti ti-chevron-right"></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="att-cal-dow"><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div></div>' +
          '<div class="att-cal-grid" id="attGrid"></div>' +
          '<div class="att-legend">' +
            '<span><span class="swatch" style="background:var(--green-soft)"></span>Worked (W)</span>' +
            '<span><span class="swatch" style="background:var(--amber-soft)"></span>Late (L)</span>' +
            '<span><span class="swatch" style="background:rgba(13,148,136,0.12)"></span>WFH</span>' +
            '<span><span class="swatch" style="background:var(--red-soft)"></span>Sick (S)</span>' +
            '<span><span class="swatch" style="background:rgba(40,90,180,0.10)"></span>Leave (A.L.)</span>' +
            '<span><span class="swatch" style="background:var(--bg)"></span>Off (H)</span>' +
          '</div>' +
          '<div class="att-rollup" id="attRollup"></div>' +
        '</div>';
        body.querySelector('#attPrev').addEventListener('click', () => {
          attMonth--; if (attMonth < 1) { attMonth = 12; attYear--; } loadAttendanceMonth();
        });
        body.querySelector('#attNext').addEventListener('click', () => {
          attMonth++; if (attMonth > 12) { attMonth = 1; attYear++; } loadAttendanceMonth();
        });
      }
      await loadAttendanceMonth();
    }

    async function loadAttendanceMonth() {
      const label = new Date(Date.UTC(attYear, attMonth - 1, 1))
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      // r0.16.5 — Scope ALL lookups to the live panel body. index.html's home
      // dashboard has its own #attMonthLabel (line ~874), so a document-wide
      // getElementById grabbed THAT one and wrote the month into the hidden home
      // card, leaving the profile label stuck on "—". Querying within the panel
      // makes a duplicate id elsewhere in the shell impossible to bind.
      const panel = document.getElementById('profPanelBody');
      const labelEl = panel && panel.querySelector('#attMonthLabel');
      const grid = panel && panel.querySelector('#attGrid');
      const rollup = panel && panel.querySelector('#attRollup');
      // Grab all three together and guard before any write — a null element
      // must degrade locally, never escape and wipe the panel.
      if (!labelEl || !grid || !rollup) return; // scaffold not in DOM — skip silently
      labelEl.textContent = label;
      grid.innerHTML = '<div style="grid-column:span 7;color:var(--muted);text-align:center;padding:14px">Loading…</div>';
      rollup.innerHTML = '';

      try {
        // r0.16 — Use /api/profile/:id/attendance-days which is gated on profile
        // view (own + dept + any), so agents see their own calendar. Payroll
        // endpoint is salary-gated and not used here.
        let days = [];
        const r = await fetch('/api/profile/' + profileUserId + '/attendance-days?year=' + attYear + '&month=' + attMonth, { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          days = d.days || [];
        }
        const canSeeRollup = viewer.can_view_salary || viewer.is_self;
        // Build calendar grid: prepend blanks for days before the 1st (Mon-start)
        const first = new Date(Date.UTC(attYear, attMonth - 1, 1));
        const firstDow = first.getUTCDay(); // 0=Sun
        const leading = firstDow === 0 ? 6 : (firstDow - 1);
        const daysInMonth = new Date(Date.UTC(attYear, attMonth, 0)).getUTCDate();
        const today = new Date();
        const todayIso = today.getFullYear() + '-' +
          String(today.getMonth() + 1).padStart(2, '0') + '-' +
          String(today.getDate()).padStart(2, '0');

        // Index days by date for quick lookup
        const byDate = {};
        for (const d of days) {
          const k = String(d.for_date).slice(0, 10);
          byDate[k] = d;
        }

        let html = '';
        for (let i = 0; i < leading; i++) html += '<div class="att-day att-empty"></div>';
        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = attYear + '-' + String(attMonth).padStart(2, '0') + '-' + String(day).padStart(2, '0');
          const rec = byDate[dateStr];
          const status = rec ? rec.status : null;
          let cls = 'att-day';
          let flag = '';
          // r0.16 — Compare ISO date strings: 'YYYY-MM-DD' lexicographic compare
          // is equivalent to date compare. No fragile triple-tier math.
          if (dateStr > todayIso) {
            cls += ' att-future';
          } else if (dateStr === todayIso) {
            cls += ' att-today'; flag = 'Today';
          } else if (status === 'on_time' || status === 'worked_voluntary') { cls += ' att-worked'; flag = 'W'; }
          else if (status === 'late' || status === 'very_late') { cls += ' att-late'; flag = 'L'; }
          else if (status === 'on_leave') { cls += ' att-leave'; flag = 'A.L.'; }
          else if (status === 'off_sick') { cls += ' att-sick'; flag = 'S'; }
          else if (status === 'off_holiday') { cls += ' att-holiday'; flag = 'H'; }
          else if (status && status.startsWith('off_')) { cls += ' att-empty'; }
          else { cls += ' att-empty'; }
          // WFH special-case if there's a wfh marker — could refine later
          html += '<div class="' + cls + '">' + day +
            (flag ? '<div class="att-flag">' + flag + '</div>' : '') +
            '</div>';
        }
        grid.innerHTML = html;

        // Roll-up tiles
        let worked = 0, late = 0, al = 0, sick = 0;
        for (const d of days) {
          if (d.status === 'on_time' || d.status === 'worked_voluntary') worked++;
          if (d.status === 'late' || d.status === 'very_late') { worked++; late++; }
          if (d.status === 'on_leave') al++;
          if (d.status === 'off_sick') sick++;
        }
        rollup.innerHTML =
          '<div class="att-tile"><div class="num" style="color:var(--green)">' + worked + '</div><div class="lbl">Days worked</div></div>' +
          '<div class="att-tile"><div class="num" style="color:var(--amber-deep)">' + late + '</div><div class="lbl">Late</div></div>' +
          '<div class="att-tile"><div class="num" style="color:#2D5BAF">' + al + '</div><div class="lbl">Annual leave</div></div>' +
          '<div class="att-tile"><div class="num" style="color:var(--red)">' + sick + '</div><div class="lbl">Sick</div></div>';

        if (!canSeeRollup) {
          rollup.innerHTML = '<div style="color:var(--muted);font-size:12px;grid-column:1/-1">Payroll roll-up only visible to HR/Owner.</div>';
        }
      } catch (e) {
        console.error('[attendance]', e);
        grid.innerHTML = '<div style="grid-column:span 7;color:var(--red);text-align:center;padding:14px">Failed to load</div>';
      }
    }

    // ====================================================================
    // r0.33 — redesigned sections: About me, My details, Pay
    // ====================================================================
    const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    let detailsEditing = null; // which group is currently in edit mode
    let setupExpanded = false; // setup strip: expanded record view when complete
    let setupOpen = true;      // setup strip: checklist open/collapsed (incomplete state)

    function canEditThis() { return viewer.is_self || viewer.can_edit_any; }
    function canSeePrivate() { return viewer.is_self || viewer.can_view_salary || viewer.can_edit_any; }

    // Re-fetch overview (for tiles/completeness/values) without leaving the section.
    async function refreshHeaderAndDetails() {
      try {
        const r = await fetch('/api/profile/' + profileUserId + '/overview', { credentials: 'include' });
        if (r.ok) { overview = await r.json(); viewer = overview.viewer; renderHeader(); }
      } catch (e) { /* keep showing what we have */ }
      renderMyDetails();
    }

    // ---- About me -------------------------------------------------------
    // ---- About me -------------------------------------------------------
    function renderAboutSection() {
      const body = document.getElementById('profPanelBody');
      const u = overview.user;
      const c = overview.completeness || {};
      const dept = (u.departments && u.departments.length) ? u.departments.map(d => d.name).join(', ') : '';
      const dob = (canSeePrivate() && u.date_of_birth) ? fmtDate(u.date_of_birth) : '';

      let completeCard = '';
      if (canSeePrivate()) {
        const items = [
          { ok: c.has_photo, label: 'Profile photo', go: 'photo' },
          { ok: c.has_bank, label: 'Bank details', go: 'details' },
          { ok: c.has_pan, label: 'PAN', go: 'details' },
          { ok: c.has_emergency, label: 'Emergency contact', go: 'details' },
        ];
        const left = items.filter(i => !i.ok).length;
        completeCard = '<div class="card">' +
          '<div class="card-title">Profile completeness</div>' +
          '<div class="complete-head">' + (c.percent || 0) + '%</div>' +
          '<div class="complete-sub">' + (left === 0 ? 'All set. Nothing left to add.' : left + ' thing' + (left === 1 ? '' : 's') + ' left to add.') + '</div>' +
          '<div class="prof-bar" style="margin-bottom:6px"><i style="width:' + (c.percent || 0) + '%"></i></div>' +
          items.map(i => '<div class="complete-item">' +
            '<i class="ti ' + (i.ok ? 'ti-circle-check ok' : 'ti-circle no') + '"></i><span>' + i.label + '</span>' +
            (!i.ok && canEditThis() ? '<button class="add-btn" data-go="' + i.go + '">Add</button>' : '') +
          '</div>').join('') +
        '</div>';
      }

      const snap = [
        ['Emp ID', u.emp_id], ['Work email', u.email], ['Personal email', u.personal_email],
        ['Phone', u.phone], ['Department', dept], ['Manager', u.manager_name],
        ['Joined', u.hire_date ? fmtDate(u.hire_date) : ''],
        ['Date of birth', dob], ['Blood group', u.blood_group],
      ];
      const snapCard = '<div class="card"><div class="card-title">Snapshot</div><div class="field-grid">' +
        snap.map(p => '<div class="fld"><div class="fl">' + p[0] + '</div><div class="fv' + (p[1] ? '' : ' empty') + '">' + (p[1] ? esc(p[1]) : 'Not set') + '</div></div>').join('') +
        '</div>' +
        (viewer.can_edit_any ? '<div style="margin-top:16px"><button class="edit-link" data-assign-mgr="1">' + (u.manager_user_id ? 'Change manager' : 'Assign manager') + '</button></div>' : '') +
        '</div>';

      body.innerHTML = '<div class="two-col">' + completeCard + snapCard + '</div>';
      body.querySelectorAll('.add-btn[data-go]').forEach(el => {
        el.addEventListener('click', () => {
          if (el.dataset.go === 'photo') { const b = document.getElementById('profPhotoBtn'); if (b) b.click(); }
          else loadDrawer('details');
        });
      });
      const amb = body.querySelector('[data-assign-mgr]');
      if (amb) amb.addEventListener('click', openManagerPicker);
    }

    // ---- My details -----------------------------------------------------
    function fieldRead(label, val) {
      return '<div class="fld"><div class="fl">' + label + '</div><div class="fv' + (val ? '' : ' empty') + '">' + (val ? esc(val) : 'Not set') + '</div></div>';
    }
    function inputHtml(f, val) {
      const v = val == null ? '' : String(val);
      if (f.type === 'textarea') return '<textarea rows="2" data-k="' + f.k + '">' + esc(v) + '</textarea>';
      if (f.type === 'select') {
        return '<select data-k="' + f.k + '"><option value="">—</option>' +
          f.options.map(o => '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
      }
      return '<input type="' + (f.type || 'text') + '" data-k="' + f.k + '" value="' + escAttr(v) + '"' + (f.ro ? ' disabled' : '') + '>';
    }
    function groupBlock(key, title, fields, sensitive) {
      const u = overview.user;
      const editing = detailsEditing === key;
      const editable = canEditThis();
      let inner;
      if (editing) {
        inner = '<div class="field-grid">' +
          fields.map(f => '<div class="det-field' + (f.full ? '" style="grid-column:1/-1' : '') + '">' +
            '<label>' + f.label + (f.ro ? ' (read-only)' : '') + '</label>' + inputHtml(f, u[f.k]) + '</div>').join('') +
          '</div>' +
          '<div class="det-actions">' +
            '<button class="det-btn primary" data-save="' + key + '"' + (sensitive ? ' data-sensitive="1"' : '') + '>' + (sensitive ? 'Request change' : 'Save') + '</button>' +
            '<button class="det-btn" data-cancel="1">Cancel</button>' +
          '</div>' +
          (sensitive ? '<div class="hint">For your protection, bank and tax changes are checked by HR before they take effect.</div>' : '');
      } else {
        inner = '<div class="field-grid">' + fields.map(f => {
          let v = u[f.k];
          if (f.type === 'date' && v) v = fmtDate(v);
          return fieldRead(f.label, v);
        }).join('') + '</div>';
      }
      return '<div class="card">' +
        '<div class="card-title">' + title +
          (editable && !editing ? '<button class="edit-link" data-edit="' + key + '">Edit</button>' : '') +
        '</div>' + inner + '</div>';
    }

    function renderMyDetails() {
      const body = document.getElementById('profPanelBody');
      const showPriv = canSeePrivate();

      const contactFields = [
        { k: 'email', label: 'Work email', ro: true },
        { k: 'personal_email', label: 'Personal email', type: 'email' },
        { k: 'phone', label: 'Phone' },
        { k: 'personal_address', label: 'Home address', type: 'textarea', full: true },
      ];
      const personalFields = [];
      if (showPriv) personalFields.push({ k: 'date_of_birth', label: 'Date of birth', type: 'date' });
      personalFields.push({ k: 'blood_group', label: 'Blood group', type: 'select', options: BLOOD_GROUPS });
      const emergencyFields = [{ k: 'emergency_contact', label: 'Name, relationship and phone', type: 'textarea', full: true }];
      const payFields = [
        { k: 'bank_account_holder', label: 'Account holder name' },
        { k: 'bank_name', label: 'Bank name' },
        { k: 'bank_account_number', label: 'Account number' },
        { k: 'bank_ifsc', label: 'IFSC code' },
        { k: 'pan', label: 'PAN' },
      ];

      let html = '';
      const pend = overview.pending_changes || [];
      if (pend.length && showPriv) {
        html += '<div class="det-pending"><i class="ti ti-clock"></i> A bank/tax change is waiting for HR approval. It will not take effect until approved.</div>';
      }
      html += '<div class="stack">';
      html += groupBlock('contact', 'Contact', contactFields, false);
      html += groupBlock('personal', 'Personal', personalFields, false);
      html += groupBlock('emergency', 'Emergency contact', emergencyFields, false);
      if (showPriv) html += groupBlock('paytax', 'Pay &amp; tax', payFields, true);
      html += '</div>';

      body.innerHTML = html;
      body.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => { detailsEditing = el.dataset.edit; renderMyDetails(); }));
      body.querySelectorAll('[data-cancel]').forEach(el => el.addEventListener('click', () => { detailsEditing = null; renderMyDetails(); }));
      body.querySelectorAll('[data-save]').forEach(el => el.addEventListener('click', () => saveGroup(el.dataset.save, el.dataset.sensitive === '1', el)));
    }

    function collectGroupValues() {
      const body = document.getElementById('profPanelBody');
      const out = {};
      body.querySelectorAll('[data-k]').forEach(inp => { if (!inp.disabled) out[inp.dataset.k] = inp.value; });
      return out;
    }

    async function saveGroup(key, sensitive, btn) {
      const vals = collectGroupValues();
      btn.disabled = true;
      try {
        if (sensitive) {
          const changes = {};
          for (const k of Object.keys(vals)) {
            const curr = overview.user[k] == null ? '' : String(overview.user[k]);
            if (vals[k] !== curr) changes[k] = vals[k];
          }
          if (Object.keys(changes).length === 0) { detailsEditing = null; renderMyDetails(); return; }
          const r = await fetch('/api/profile/' + profileUserId + '/detail-change', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { alert(d.error || 'Could not submit'); btn.disabled = false; return; }
          detailsEditing = null;
          await refreshHeaderAndDetails();
        } else {
          const r = await fetch('/api/profile/' + profileUserId + '/personal', {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vals),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { alert(d.error || 'Could not save'); btn.disabled = false; return; }
          detailsEditing = null;
          await refreshHeaderAndDetails();
        }
      } catch (e) {
        alert('Could not save');
        btn.disabled = false;
      }
    }

    // ---- Pay ------------------------------------------------------------
    function maskBank(num) {
      if (!num) return '';
      const s = String(num);
      return s.length <= 4 ? s : '•••• ' + s.slice(-4);
    }
    function payFileGroupHtml(title, drawerKey, files) {
      const canUpload = viewer.can_upload_any;
      let h = '<div class="card"><div class="card-title">' + title + '</div>';
      if (files && files.length) h += files.map(f => fileRowHtml(f, drawerKey)).join('');
      else h += '<div class="fld"><div class="fv empty">No documents.</div></div>';
      if (canUpload) {
        h += '<div class="upload-area" style="margin-top:12px">' +
          '<input type="file" id="payUp_' + drawerKey + '" accept=".pdf,.png,application/pdf,image/png" />' +
          '<label for="payUp_' + drawerKey + '"><i class="ti ti-upload"></i> Upload (PDF or PNG)</label></div>';
      }
      return h + '</div>';
    }
    function wirePayUpload(drawerKey) {
      const inp = document.getElementById('payUp_' + drawerKey);
      if (!inp) return;
      inp.addEventListener('change', async () => {
        if (!inp.files.length) return;
        const fd = new FormData();
        fd.append('file', inp.files[0]);
        fd.append('user_id', String(profileUserId));
        fd.append('drawer', drawerKey);
        const r = await fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) { const e = await r.json().catch(() => ({})); alert('Upload failed: ' + (e.error || r.status)); return; }
        loadDrawer('pay');
      });
    }

    async function renderPaySection() {
      const body = document.getElementById('profPanelBody');
      const u = overview.user;
      const wants = ['payroll', 'insurance'];
      if (viewer.can_view_salary) wants.unshift('salary');
      let data = {};
      try {
        const results = await Promise.all(wants.map(d =>
          fetch('/api/profile/' + profileUserId + '/drawer/' + d, { credentials: 'include' })
            .then(r => r.ok ? r.json() : {}).catch(() => ({}))
        ));
        wants.forEach((d, i) => { data[d] = results[i] || {}; });
      } catch (e) { data = {}; }

      let html = '<div class="stack">';
      if (viewer.can_view_salary && data.salary && data.salary.salary) {
        const s = data.salary.salary;
        const curr = s.currency || '£';
        html += '<div class="card"><div class="card-title">Current salary</div><div class="field-grid">' +
          fieldRead('Monthly CTC', esc(curr) + ' ' + (s.monthly_ctc != null ? Number(s.monthly_ctc).toLocaleString('en-GB') : '—')) +
          (s.effective_from ? fieldRead('Effective from', fmtDate(s.effective_from)) : '') +
        '</div></div>';
      }
      if (canSeePrivate()) {
        const anyBank = u.bank_account_number || u.bank_ifsc || u.bank_name || u.bank_account_holder;
        html += '<div class="card"><div class="card-title">Where you are paid' +
          '<button class="edit-link" data-go-details="1">Edit in My details</button></div>' +
          (anyBank ?
            '<div class="field-grid">' +
              fieldRead('Account holder', u.bank_account_holder) +
              fieldRead('Bank', u.bank_name) +
              fieldRead('Account number', maskBank(u.bank_account_number)) +
              fieldRead('IFSC', u.bank_ifsc) +
            '</div>'
            : '<div class="fld"><div class="fv empty">No bank details yet. Add them in My details.</div></div>') +
        '</div>';
      }
      html += payFileGroupHtml('Payslips and tax', 'payroll', (data.payroll && data.payroll.files) || []);
      html += payFileGroupHtml('Insurance', 'insurance', (data.insurance && data.insurance.files) || []);
      html += '</div>';

      body.innerHTML = html;
      wireFileRowHandlers();
      wirePayUpload('payroll');
      wirePayUpload('insurance');
      const goD = body.querySelector('[data-go-details]');
      if (goD) goD.addEventListener('click', () => loadDrawer('details'));
    }

    // ---- Probation management (HR) -------------------------------------
    async function manageProbation() {
      const choice = prompt('Set probation status:\n  c = Confirmed (passed)\n  e = Extended\n  f = Failed\n  o = On track (pass expected)\n\nEnter c, e, f or o:');
      if (!choice) return;
      const map = { c: 'confirmed', e: 'extended', f: 'failed', o: 'probation_pass_expected' };
      const status = map[choice.trim().toLowerCase()];
      if (!status) { alert('Invalid choice'); return; }
      try {
        const r = await fetch('/api/profile/' + profileUserId + '/probation', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ status }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        await loadOverview();
      } catch (e) { alert('Failed'); }
    }

    // ---- Date picker modal (UK display via native input; ISO value) ----
    function openDateModal(opts) {
      const o = opts || {};
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:200';
      ov.innerHTML = '<div style="background:var(--surface);border-radius:14px;padding:22px 24px;width:400px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,0.2)">' +
        '<h3 style="margin:0 0 6px;font-size:18px;font-weight:600">' + esc(o.title || 'Pick a date') + '</h3>' +
        (o.intro ? '<p style="margin:0 0 14px;font-size:14px;color:var(--muted)">' + esc(o.intro) + '</p>' : '<div style="height:8px"></div>') +
        '<label style="font-size:13px;color:var(--muted)">' + esc(o.dateLabel || 'Date') + '</label>' +
        '<input id="dmDate" type="date" lang="en-GB" style="width:100%;padding:11px 13px;border:0.5px solid var(--line);border-radius:9px;font-size:15px;background:var(--surface);color:var(--ink);font-family:inherit;margin-top:5px" />' +
        (o.withReason ? '<label style="font-size:13px;color:var(--muted);display:block;margin-top:14px">' + esc(o.reasonLabel || 'Reason (optional)') + '</label>' +
          '<textarea id="dmReason" rows="3" style="width:100%;padding:11px 13px;border:0.5px solid var(--line);border-radius:9px;font-size:15px;background:var(--surface);color:var(--ink);font-family:inherit;margin-top:5px;resize:vertical"></textarea>' : '') +
        '<div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">' +
          '<button class="det-btn" id="dmCancel">Cancel</button>' +
          '<button class="det-btn primary" id="dmSave">' + esc(o.saveLabel || 'Save') + '</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', e => { if (e.target === ov) close(); });
      ov.querySelector('#dmCancel').addEventListener('click', close);
      ov.querySelector('#dmSave').addEventListener('click', async () => {
        const iso = ov.querySelector('#dmDate').value;
        if (!iso) { alert('Please pick a date.'); return; }
        const reason = o.withReason ? (ov.querySelector('#dmReason').value || '') : '';
        const ok = await o.onSave(iso, reason);
        if (ok !== false) close();
      });
    }

    // ---- Manager assignment (HR) ---------------------------------------
    async function openManagerPicker() {
      let people = [];
      try { const r = await fetch('/api/profile/people', { credentials: 'include' }); if (r.ok) people = (await r.json()).people || []; } catch (e) { /* ignore */ }
      const cur = overview.user.manager_user_id;
      const opts = ['<option value="">\u2014 No manager \u2014</option>'].concat(
        people.filter(p => p.id !== profileUserId).map(p =>
          '<option value="' + p.id + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + (p.emp_id ? ' (' + esc(p.emp_id) + ')' : '') + '</option>')
      ).join('');
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:200';
      ov.innerHTML = '<div style="background:var(--surface);border-radius:14px;padding:22px 24px;width:400px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,0.2)">' +
        '<h3 style="margin:0 0 6px;font-size:18px;font-weight:600">Assign manager</h3>' +
        '<p style="margin:0 0 14px;font-size:14px;color:var(--muted)">Who does ' + esc(overview.user.display_name || overview.user.full_name || 'this person') + ' report to?</p>' +
        '<select id="mgrSel" style="width:100%;padding:12px 14px;border:0.5px solid var(--line);border-radius:9px;font-size:15px;background:var(--surface);color:var(--ink);font-family:inherit">' + opts + '</select>' +
        '<div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">' +
          '<button class="det-btn" id="mgrCancel">Cancel</button>' +
          '<button class="det-btn primary" id="mgrSave">Save</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      const close = () => ov.remove();
      ov.addEventListener('click', e => { if (e.target === ov) close(); });
      ov.querySelector('#mgrCancel').addEventListener('click', close);
      ov.querySelector('#mgrSave').addEventListener('click', async () => {
        const val = ov.querySelector('#mgrSel').value;
        try {
          const r = await fetch('/api/profile/' + profileUserId + '/manager', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ manager_user_id: val || null }),
          });
          if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
          close();
          await loadOverview();
        } catch (e) { alert('Failed'); }
      });
    }

    // ---- Onboarding (interactive, India template) -----------------------
    function obFirstName() {
      const n = overview.user.display_name || overview.user.full_name || '';
      return n.split(' ')[0] || n;
    }

    async function doObAction(id, action, reason) {
      try {
        const r = await fetch('/api/profile/' + profileUserId + '/onboarding/' + id + '/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ action, reason: reason || null }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        refreshSetup();
      } catch (e) { alert('Failed'); }
    }

    async function uploadOnboardingFile(id) {
      const inp = document.getElementById('obFile_' + id);
      if (!inp || !inp.files || !inp.files.length) return;
      const f = inp.files[0];
      if (f.size > 15 * 1024 * 1024) { alert('File too large (max 15 MB).'); inp.value = ''; return; }
      const fd = new FormData();
      fd.append('file', f);
      fd.append('user_id', String(profileUserId));
      fd.append('drawer', 'onboarding');
      fd.append('profile_note_id', String(id));
      try {
        const r = await fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Upload failed'); return; }
        await doObAction(id, 'submit');
      } catch (e) { alert('Upload failed'); }
    }

    async function addOnboardingItem() {
      const title = (document.getElementById('obNewTitle').value || '').trim();
      const body = (document.getElementById('obNewBody').value || '').trim();
      if (!title) { alert('Title required'); return; }
      try {
        const r = await fetch('/api/profile/' + profileUserId + '/notes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ kind: 'onboarding', title, body: body || null }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        refreshSetup();
      } catch (e) { alert('Failed'); }
    }

    async function deleteOnboardingItem(id) {
      if (!confirm('Remove this onboarding item?')) return;
      try {
        const r = await fetch('/api/profile/' + profileUserId + '/notes/' + id, { method: 'DELETE', credentials: 'include' });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        refreshSetup();
      } catch (e) { alert('Failed'); }
    }

    function obIcon(status) {
      if (status === 'verified') return '<div class="ob-ico ver"><i class="ti ti-check"></i></div>';
      if (status === 'submitted') return '<div class="ob-ico sub"><i class="ti ti-clock"></i></div>';
      if (status === 'needs_redo') return '<div class="ob-ico redo"><i class="ti ti-rotate"></i></div>';
      if (status === 'na') return '<div class="ob-ico na"><i class="ti ti-minus"></i></div>';
      return '<div class="ob-ico todo"></div>';
    }

    function daysSince(iso) {
      if (!iso) return null;
      const d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return Math.floor((Date.now() - d.getTime()) / 86400000);
    }

    async function refreshSetup() {
      const b = document.getElementById('profSetup');
      if (!b) return;
      const u = overview && overview.user;
      try {
        // Offboarding (active, or a record after they've left) supersedes onboarding.
        if (u && u.last_working_day) {
          const r = await fetch('/api/profile/' + profileUserId + '/drawer/offboarding', { credentials: 'include' });
          const data = r.ok ? await r.json() : { notes: [] };
          renderExitStrip(data);
          return;
        }
        const r = await fetch('/api/profile/' + profileUserId + '/drawer/onboarding', { credentials: 'include' });
        const data = r.ok ? await r.json() : { notes: [] };
        renderSetupStrip(data);
      } catch (e) { b.innerHTML = ''; }
    }

    function renderSetupStrip(data) {
      const body = document.getElementById('profSetup');
      if (!body) return;
      const isSelf = viewer.is_self;
      const isHr = viewer.can_edit_any || viewer.can_edit_dept;
      const canAct = isSelf || isHr;
      const tile = document.getElementById('profTileComplete');

      // Onboarding / setup is private — only the person and HR see it.
      if (!canAct) { body.innerHTML = ''; if (tile) tile.style.display = ''; return; }

      const notes = (data.notes || []).slice().sort((a, b) => ((a.ob_sort || 9999) - (b.ob_sort || 9999)) || (a.id - b.id));
      if (notes.length === 0) { body.innerHTML = ''; if (tile) tile.style.display = ''; return; }

      const obStatusOf = (n) => n.ob_status || (n.is_completed ? 'verified' : 'to_do');
      const isDone = (n) => { const s = obStatusOf(n); return s === 'verified' || s === 'na'; };
      const total = notes.length;
      const done = notes.filter(isDone).length;
      const pct = total ? Math.round(done * 100 / total) : 0;

      // Completion is gated on REQUIRED items (optional left over won't block).
      const reqNotes = notes.filter(n => n.ob_required === true);
      const allRequiredDone = reqNotes.length > 0 ? reqNotes.every(isDone) : (done === total);

      // Tile hides while the checklist is on screen (incomplete, or expanded record).
      const showingChecklist = !allRequiredDone || setupExpanded;
      if (tile) tile.style.display = showingChecklist ? 'none' : '';

      // Complete → slim collapsed bar (unless the user expanded the record).
      if (allRequiredDone && !setupExpanded) {
        body.innerHTML = '<div class="setup-done"><i class="ti ti-circle-check"></i>' +
          '<span class="txt">Setup complete</span>' +
          '<span class="vd" id="setupView">View joining documents \u2192</span></div>';
        const v = document.getElementById('setupView');
        if (v) v.addEventListener('click', () => { setupExpanded = true; refreshSetup(); });
        return;
      }

      let html = '';

      // Welcome banner — self only, first 3 days.
      if (isSelf && !allRequiredDone) {
        const d = daysSince(overview.user.hire_date);
        if (d != null && d <= 2) {
          html += '<div class="welcome-banner"><div class="deco"></div><div class="deco2"></div>' +
            '<h2>Welcome aboard, ' + esc(obFirstName()) + '! \uD83C\uDF89</h2>' +
            '<p>We\u2019re genuinely glad to have you on the FK Sports team. Take your time finding your feet over the first few days \u2014 your manager and HR are here for anything you need, so never hesitate to ask.</p>' +
            '<div class="sig">\u2014 The FK Sports team</div></div>';
        }
      }

      const headTitle = allRequiredDone ? 'Your joining documents' : (isSelf ? 'Let\u2019s get you set up' : esc(overview.user.display_name || overview.user.full_name || 'Onboarding'));
      const headSub = allRequiredDone ? 'Your onboarding record.' : 'About 10 minutes \u2014 finish these and you\u2019re fully on the system and on payroll.';
      const collapseLink = (allRequiredDone && setupExpanded) ? ' <span class="vd" id="setupCollapse" style="cursor:pointer;color:var(--amber-deep);margin-left:10px">Hide</span>' : '';
      // Collapsible chevron — only while actively onboarding (incomplete).
      const chevron = !allRequiredDone
        ? '<button class="setup-toggle" id="setupToggle" title="' + (setupOpen ? 'Collapse' : 'Expand') + '"><i class="ti ti-chevron-' + (setupOpen ? 'up' : 'down') + '"></i></button>'
        : '';

      html += '<div class="setup">' +
        '<div class="setup-top"><div class="ic"><i class="ti ti-rocket"></i></div>' +
          '<div><h3>' + headTitle + '</h3><div class="sub">' + headSub + '</div></div>' +
          '<div class="count">' + done + ' of ' + total + ' done \u00b7 ' + pct + '%' + collapseLink + '</div>' + chevron + '</div>' +
        '<div class="ob-pbar"><i style="width:' + pct + '%"></i></div>';

      const showChecklist = allRequiredDone || setupOpen; // when complete+expanded, always show the record
      if (isSelf && !allRequiredDone && setupOpen) {
        html += '<div class="ob-privacy"><i class="ti ti-lock"></i> Your documents are private \u2014 only HR can see them. Stuck on anything? Message HR and we\u2019ll help.</div>';
      }

      // Groups (headers + items inside the one card) — hidden when collapsed.
      if (showChecklist) {
      const groups = [];
      const byGroup = {};
      for (const n of notes) {
        const g = n.ob_group || 'More items';
        if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
        byGroup[g].push(n);
      }
      groups.forEach((g, gi) => {
        html += '<div class="ob-grp-head' + (gi === 0 ? ' first' : '') + '"><span class="n">' + (gi + 1) + '</span> ' + esc(g) + '</div>';
        for (const n of byGroup[g]) {
          const s = obStatusOf(n);
          const linked = !!n.ob_field;
          let chip = '', actions = '';

          if (s === 'verified') {
            chip = '<span class="ob-chip ver">Verified</span>';
            if (isHr) actions = '<button class="ob-btn" data-ob-act="needs_redo" data-id="' + n.id + '">Needs redo\u2026</button>';
          } else if (s === 'submitted') {
            chip = '<span class="ob-chip sub">With HR to check</span>';
            if (isHr) actions = '<button class="ob-btn primary" data-ob-act="verify" data-id="' + n.id + '"><i class="ti ti-check"></i> Verify</button>' +
                                '<button class="ob-btn" data-ob-act="needs_redo" data-id="' + n.id + '">Needs redo\u2026</button>';
          } else if (s === 'na') {
            chip = '<span class="ob-chip na">Not applicable</span>';
            if (canAct) actions = '<button class="ob-btn ghost" data-ob-act="reopen" data-id="' + n.id + '">Undo</button>';
          } else if (s === 'needs_redo') {
            chip = '<span class="ob-chip redo">Needs redo</span>';
            if (canAct) {
              actions = linked
                ? '<button class="ob-btn primary" data-ob-go="' + (n.ob_field === 'photo' ? 'photo' : 'details') + '">' + (n.ob_field === 'photo' ? 'Add photo' : 'Update in My details') + '</button>'
                : '<button class="ob-btn primary" data-ob-upload="' + n.id + '">Re-upload</button>';
            }
          } else { // to_do
            chip = '<span class="ob-chip todo">To do</span>';
            if (canAct) {
              if (linked) {
                actions = '<button class="ob-btn primary" data-ob-go="' + (n.ob_field === 'photo' ? 'photo' : 'details') + '">' + (n.ob_field === 'photo' ? 'Add photo' : 'Add') + '</button>' +
                          '<button class="ob-btn ghost" data-ob-upload="' + n.id + '">Attach file</button>';
              } else {
                actions = '<button class="ob-btn primary" data-ob-upload="' + n.id + '">Upload</button>';
              }
              if (!n.ob_required) actions += '<button class="ob-btn ghost" data-ob-act="na" data-id="' + n.id + '">Mark N/A</button>';
            }
          }

          let files = '';
          if (n.attached_files && n.attached_files.length) {
            files = n.attached_files.map(f => '<a class="ob-filechip" href="/api/files/' + f.id + '" target="_blank"><i class="ti ti-file-text"></i> ' + esc(f.filename) + '</a>').join(' ');
          }
          const tag = n.ob_required ? '<span class="ob-req">REQUIRED</span>' : (n.ob_required === false ? '<span class="ob-opt">OPTIONAL</span>' : '');
          html += '<div class="ob-item">' +
            obIcon(s) +
            '<div class="ob-mid">' +
              '<div class="ob-title">' + esc(n.title) + tag +
                (isHr ? '<button class="ob-del" data-ob-del="' + n.id + '" title="Remove"><i class="ti ti-trash"></i></button>' : '') +
              '</div>' +
              (n.body ? '<div class="ob-why">' + esc(n.body) + '</div>' : '') +
              (s === 'needs_redo' && n.ob_redo_reason ? '<div class="ob-redo-msg"><b>HR asked you to redo this:</b> ' + esc(n.ob_redo_reason) + '</div>' : '') +
              (files ? '<div>' + files + '</div>' : '') +
              '<input type="file" id="obFile_' + n.id + '" data-ob-file="' + n.id + '" style="display:none" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx">' +
            '</div>' +
            '<div class="ob-right">' + chip + actions + '</div>' +
          '</div>';
        }
      });

      if (isHr) {
        html += '<div class="ob-add"><h3>Add an onboarding item</h3>' +
          '<label>Title</label><input type="text" id="obNewTitle" placeholder="e.g. Sign IT security policy">' +
          '<label>Details (the why) \u2014 optional</label><textarea id="obNewBody" rows="2"></textarea>' +
          '<div style="margin-top:14px"><button class="ob-btn primary" data-ob-additem>Add item</button></div></div>';
      }
      } // showChecklist

      html += '</div>'; // .setup
      body.innerHTML = html;

      const cb = document.getElementById('setupCollapse');
      if (cb) cb.addEventListener('click', () => { setupExpanded = false; refreshSetup(); });
      const st = document.getElementById('setupToggle');
      if (st) st.addEventListener('click', () => { setupOpen = !setupOpen; refreshSetup(); });

      body.querySelectorAll('[data-ob-go]').forEach(el => el.addEventListener('click', () => {
        if (el.dataset.obGo === 'photo') { const b = document.getElementById('profPhotoBtn'); if (b) b.click(); }
        else loadDrawer('details');
      }));
      body.querySelectorAll('[data-ob-upload]').forEach(el => el.addEventListener('click', () => {
        const inp = document.getElementById('obFile_' + el.dataset.obUpload); if (inp) inp.click();
      }));
      body.querySelectorAll('[data-ob-file]').forEach(el => el.addEventListener('change', () => uploadOnboardingFile(el.dataset.obFile)));
      body.querySelectorAll('[data-ob-act]').forEach(el => el.addEventListener('click', () => {
        const id = el.dataset.id, act = el.dataset.obAct;
        if (act === 'needs_redo') {
          const reason = prompt('What needs redoing? This is sent to the employee:');
          if (reason === null) return;
          doObAction(id, 'needs_redo', reason);
        } else doObAction(id, act);
      }));
      body.querySelectorAll('[data-ob-del]').forEach(el => el.addEventListener('click', () => deleteOnboardingItem(el.dataset.obDel)));
      const addBtn = body.querySelector('[data-ob-additem]');
      if (addBtn) addBtn.addEventListener('click', addOnboardingItem);
    }

    // ---- Offboarding (exit) -------------------------------------------
    function exitGratuity(hireIso, lastIso) {
      if (!hireIso) return { eligible: false, text: 'Tenure unknown' };
      const h = new Date(hireIso); const l = lastIso ? new Date(lastIso) : new Date();
      if (isNaN(h.getTime())) return { eligible: false, text: 'Tenure unknown' };
      const years = (l.getTime() - h.getTime()) / (365.25 * 86400000);
      return years >= 5
        ? { eligible: true, text: 'Eligible (5+ years)' }
        : { eligible: false, text: 'Not yet \u2014 needs 5 years' };
    }
    function ownerChipHtml(owner) {
      const map = { it: 'IT', finance: 'FINANCE', manager: 'MANAGER', hr: 'HR', leaver: 'YOU' };
      if (!owner) return '';
      return '<span class="own ' + owner + '">' + (map[owner] || owner.toUpperCase()) + '</span>';
    }

    function startOffboarding() {
      openDateModal({
        title: 'Start offboarding',
        intro: 'Set their last working day. This creates the exit clearances and notifies HR and the employee.',
        dateLabel: 'Last working day',
        withReason: true,
        reasonLabel: 'Reason for leaving (optional — internal)',
        saveLabel: 'Start offboarding',
        onSave: async (iso, reason) => {
          try {
            const r = await fetch('/api/profile/' + profileUserId + '/offboarding/start', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
              body: JSON.stringify({ last_working_day: iso, reason }),
            });
            if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return false; }
            await loadOverview();
            return true;
          } catch (e) { alert('Failed'); return false; }
        },
      });
    }

    async function addExitNote(id, txt) {
      try {
        const r = await fetch('/api/profile/' + profileUserId + '/notes/' + id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ body: txt }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        refreshSetup();
      } catch (e) { alert('Failed'); }
    }

    async function doExitAction(id, action) {
      try {
        const r = await fetch('/api/profile/' + profileUserId + '/offboarding/' + id + '/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ action }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed'); return; }
        if (action === 'mark_left') await loadOverview(); else refreshSetup();
      } catch (e) { alert('Failed'); }
    }

    async function uploadExitFile(id, autoDone) {
      const inp = document.getElementById('exFile_' + id);
      if (!inp || !inp.files || !inp.files.length) return;
      const f = inp.files[0];
      if (f.size > 15 * 1024 * 1024) { alert('File too large (max 15 MB).'); inp.value = ''; return; }
      const fd = new FormData();
      fd.append('file', f); fd.append('user_id', String(profileUserId));
      fd.append('drawer', 'offboarding'); fd.append('profile_note_id', String(id));
      try {
        const r = await fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Upload failed'); return; }
        if (autoDone) await doExitAction(id, 'done'); else refreshSetup();
      } catch (e) { alert('Upload failed'); }
    }

    function renderExitStrip(data) {
      const body = document.getElementById('profSetup');
      if (!body) return;
      const u = overview.user;
      const isSelf = viewer.is_self;
      const isHr = viewer.can_edit_any || viewer.can_edit_dept;
      if (!isSelf && !isHr) { body.innerHTML = ''; return; }
      const tile = document.getElementById('profTileComplete');
      if (tile) tile.style.display = 'none';

      const notes = (data.notes || []).slice().sort((a, b) => ((a.ob_sort || 9999) - (b.ob_sort || 9999)) || (a.id - b.id));
      const isDone = (n) => n.ob_status === 'verified' || n.is_completed;
      const filesOf = (n) => (n.attached_files && n.attached_files.length) ? n.attached_files : [];
      const exitBodies = {};

      // ===== LEAVER PANEL (the person, when they're not HR) =====
      if (isSelf && !isHr) {
        let h = '<div class="lv-head"><div class="deco"></div>' +
          '<h2>Your last working day is ' + esc(fmtDate(u.last_working_day)) + '</h2>' +
          '<p>Thank you for everything you\u2019ve put into FK Sports, ' + esc(obFirstName()) + '. Here\u2019s what\u2019s left to wrap up, and your documents will appear below as they\u2019re ready. We wish you all the best for what\u2019s next.</p></div>';

        const wrap = notes.filter(n => n.ob_leaver && n.ob_group !== 'Documents to issue');
        if (wrap.length) {
          h += '<div class="lv-card"><h3><i class="ti ti-checklist" style="color:var(--slate,#475569)"></i> A few things to wrap up</h3>';
          for (const n of wrap) {
            const done = isDone(n);
            h += '<div class="lv-item"><i class="ti ' + (done ? 'ti-circle-check' : 'ti-circle') + '" style="font-size:20px;color:' + (done ? 'var(--green)' : 'var(--muted)') + '"></i>' +
              '<div style="flex:1"><div style="font-weight:600">' + esc(n.title) + '</div>' +
              (n.body ? '<div style="font-size:13px;color:var(--muted)">' + esc(n.body) + '</div>' : '') + '</div></div>';
          }
          h += '</div>';
        }

        const docs = notes.filter(n => n.ob_leaver && n.ob_group === 'Documents to issue');
        const fnfNote = notes.find(n => n.ob_group === 'Full & Final settlement');
        if (fnfNote && filesOf(fnfNote).length) docs.push(fnfNote); // share FnF statement once uploaded
        h += '<div class="lv-card"><h3><i class="ti ti-file-certificate" style="color:var(--slate,#475569)"></i> Your documents</h3>';
        if (docs.length === 0) h += '<div style="color:var(--muted);font-size:14px;padding:6px 0">Your documents will appear here once HR issues them.</div>';
        for (const n of docs) {
          const fs = filesOf(n);
          if (fs.length) {
            h += '<div class="doc"><i class="ti ti-file-type-pdf f"></i><div class="dn"><div class="t">' + esc(n.title) + '</div><div class="s">Ready to download</div></div>' +
              '<a class="dl ready" href="/api/files/' + fs[0].id + '?download=1"><i class="ti ti-download"></i> Download</a></div>';
          } else {
            h += '<div class="doc"><i class="ti ti-file-type-pdf f"></i><div class="dn"><div class="t">' + esc(n.title) + '</div><div class="s">Available once issued by HR</div></div>' +
              '<span class="dl wait">Not ready</span></div>';
          }
        }
        h += '</div>';
        h += '<div class="exit-note"><i class="ti ti-info-circle"></i> Your documents stay here during your notice period, and HR will also email copies once your full &amp; final settlement is done.</div>';
        body.innerHTML = h;
        return;
      }

      // ===== HR / MANAGER TRACKER =====
      const total = notes.length;
      const done = notes.filter(isDone).length;
      const pct = total ? Math.round(done * 100 / total) : 0;
      const dept = (u.departments && u.departments.length) ? u.departments.map(d => d.name).join(', ') : '';
      const left = u.employment_status === 'left';

      let html = '<div class="exit-head"><div class="deco"></div>' +
        '<h2><i class="ti ti-door-exit"></i> Offboarding \u2014 ' + esc(u.display_name || u.full_name || '') + '</h2>' +
        '<div class="emeta">' +
          (u.emp_id ? '<span>' + esc(u.emp_id) + (dept ? ' \u00b7 ' + esc(dept) : '') + '</span>' : (dept ? '<span>' + esc(dept) + '</span>' : '')) +
          (u.notice_date ? '<span>Notice given <b>' + esc(fmtDate(u.notice_date)) + '</b></span>' : '') +
          '<span>Last working day <b>' + esc(fmtDate(u.last_working_day)) + '</b></span>' +
          '<span>Tenure <b>' + tenureText(u.hire_date) + '</b></span>' +
        '</div>' +
        (left ? '<div class="fnf-badge"><i class="ti ti-check"></i> Employee has left</div>'
              : '<div class="fnf-badge"><i class="ti ti-alert-triangle"></i> Full &amp; Final due within <b>2 working days</b> of the last day</div>') +
        '</div>';

      html += '<div class="setup"><div class="setup-top"><div class="ic slate"><i class="ti ti-clipboard-list"></i></div>' +
        '<div><h3>Exit clearances</h3><div class="sub">Run these in parallel so Full &amp; Final lands inside the 2-day window.</div></div>' +
        '<div class="count">' + done + ' of ' + total + ' done \u00b7 ' + pct + '%</div></div>' +
        '<div class="ob-pbar"><i style="width:' + pct + '%"></i></div>';

      const groups = []; const byGroup = {};
      for (const n of notes) { const g = n.ob_group || 'Other'; if (!byGroup[g]) { byGroup[g] = []; groups.push(g); } byGroup[g].push(n); }

      groups.forEach((g, gi) => {
        html += '<div class="ob-grp-head' + (gi === 0 ? ' first' : '') + '"><span class="n">' + (gi + 1) + '</span> ' + esc(g) + '</div>';

        // Full & Final group: surfacing card first
        if (g === 'Full & Final settlement') {
          const grat = exitGratuity(u.hire_date, u.last_working_day);
          const lb = data.leave_balance;
          const encash = (lb && lb.remaining != null)
            ? (Number(lb.remaining) % 1 ? Number(lb.remaining).toFixed(1) : Number(lb.remaining)) + ' days'
            : 'see Leaves';
          html += '<div class="fnf-card">' +
            '<div class="fnf-line"><span>Tenure</span><span class="v">' + tenureText(u.hire_date) + '</span></div>' +
            '<div class="fnf-line"><span>Gratuity eligibility</span><span class="v"><span class="flag' + (grat.eligible ? ' ok' : '') + '">' + grat.text + '</span></span></div>' +
            '<div class="fnf-line"><span>Leave balance to encash</span><span class="v">' + encash + '</span></div>' +
          '</div>';
        }

        for (const n of byGroup[g]) {
          const done2 = isDone(n);
          const isDoc = g === 'Documents to issue';
          const isFnf = g === 'Full & Final settlement';
          const isLeftBtn = n.ob_sort === 120 || /mark as left/i.test(n.title);
          const ico = done2 ? '<div class="ob-ico ver"><i class="ti ti-check"></i></div>' : '<div class="ob-ico todo"></div>';
          const chip = done2 ? '<span class="ob-chip ver">Done</span>' : '<span class="ob-chip todo">To do</span>';

          let actions = '';
          if (done2) {
            actions = '<button class="ob-btn" data-ex-act="reopen" data-id="' + n.id + '">Reopen</button>';
          } else if (isLeftBtn) {
            actions = '<button class="ob-btn primary" data-ex-act="mark_left" data-id="' + n.id + '">Mark left</button>';
          } else if (isDoc) {
            actions = '<button class="ob-btn primary" data-ex-upload="' + n.id + '" data-auto="1">Upload</button>';
          } else if (isFnf) {
            actions = '<button class="ob-btn" data-ex-upload="' + n.id + '" data-auto="0">Upload doc</button>' +
                      '<button class="ob-btn primary" data-ex-act="done" data-id="' + n.id + '">Mark done</button>';
          } else {
            actions = '<button class="ob-btn primary" data-ex-act="done" data-id="' + n.id + '">Mark done</button>';
          }

          const fs = filesOf(n);
          const isInterview = /exit interview/i.test(n.title);
          if (isInterview) {
            exitBodies[n.id] = n.body || '';
            const hasNotes = n.body && !/internal to hr/i.test(n.body);
            actions += '<button class="ob-btn" data-ex-note="' + n.id + '">' + (hasNotes ? 'Edit notes' : 'Add notes') + '</button>';
          }
          const fileChips = fs.length ? '<div>' + fs.map(f => '<a class="ob-filechip" href="/api/files/' + f.id + '" target="_blank"><i class="ti ti-file-text"></i> ' + esc(f.filename) + '</a>').join(' ') + '</div>' : '';

          html += '<div class="ob-item">' + ico +
            '<div class="ob-mid"><div class="ob-title">' + esc(n.title) + ' ' + ownerChipHtml(n.ob_owner) +
              (n.ob_leaver ? ' <span class="own leaver" title="Visible to the leaver">SHARED</span>' : '') + '</div>' +
              (n.body ? '<div class="ob-why">' + esc(n.body) + '</div>' : '') + fileChips +
              '<input type="file" id="exFile_' + n.id + '" data-ex-file="' + n.id + '" style="display:none" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx">' +
            '</div>' +
            '<div class="ob-right">' + chip + actions + '</div></div>';
        }
      });

      html += '</div>'; // .setup
      body.innerHTML = html;

      body.querySelectorAll('[data-ex-act]').forEach(el => el.addEventListener('click', () => {
        const act = el.dataset.exAct, id = el.dataset.id;
        if (act === 'mark_left' && !confirm('Mark this employee as left? This revokes their place on the team and cancels open tasks.')) return;
        doExitAction(id, act);
      }));
      body.querySelectorAll('[data-ex-upload]').forEach(el => el.addEventListener('click', () => {
        const inp = document.getElementById('exFile_' + el.dataset.exUpload); if (inp) { inp.dataset.auto = el.dataset.auto; inp.click(); }
      }));
      body.querySelectorAll('[data-ex-file]').forEach(el => el.addEventListener('change', () => uploadExitFile(el.dataset.exFile, el.dataset.auto === '1')));
      body.querySelectorAll('[data-ex-note]').forEach(el => el.addEventListener('click', () => {
        const id = el.dataset.exNote;
        const cur = /internal to hr/i.test(exitBodies[id] || '') ? '' : (exitBodies[id] || '');
        const txt = prompt('Exit interview notes (internal — not shown to the leaver):', cur);
        if (txt === null) return;
        addExitNote(id, txt);
      }));
    }

    // --- Kick off ------------------------------------------------------
    await loadOverview();
  },

  unmount() {
    // r0.16.4 — Menus live on document.body, and the outside-click listener is
    // on document, so neither dies when the loader clears #moduleView. Remove
    // both explicitly. (.more-menu is body-level, not under #prof-mod.)
    document.querySelectorAll('.more-menu').forEach(m => m.remove());
    if (window.__fkProfMenuCloser) {
      document.removeEventListener('click', window.__fkProfMenuCloser);
      window.__fkProfMenuCloser = null;
    }
  }
};
