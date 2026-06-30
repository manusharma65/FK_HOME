// FK Home — Customer Service Agent Workspace (r3.0 — Premium Helpdesk)
// ----------------------------------------------------------------------------
// r3.0 notes:
//   • Rebuilt ticket-status handling from scratch. The previous revision had
//     four separate, conflicting status-creation code paths (some calling
//     undefined functions / missing DOM containers) which broke the module
//     on load. There is now exactly one status system: a single STATUSES
//     array drives the sidebar folders, the dropdown, row badges, and the
//     "create new status" flow, all reading/writing the same source of truth.
//   • Reply tab's thread is now a merged, Instagram/WhatsApp-style timeline:
//     customer messages, agent replies, team notes, assignment/status/match
//     system events all appear inline in one chronological feed. Personal
//     notes appear in that same feed but only for their author, marked
//     private. Composing still happens in the Reply box / Notes tab as before.
//   • Template manager: added duplicate, keyboard shortcuts (/, Esc, ↑↓ Enter
//     in slash menu, Cmd/Ctrl+K to open full-screen manager).
//   • Notes: admins (permissions.manageNotes) can delete any team note, not
//     just their own; personal notes remain author-only no matter what.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['cs'] = {
  title: 'Customer Service',
  noHero: true,
  // Panel widths persist for the lifetime of the page (in-memory only — reset on full reload).
  _panelWidths: { list: 380, side: 320 },

 render() {
    return `
<div id="cs-mod" class="fk-mod">
  <style>
    #cs-mod{flex:1;min-width:0;height:calc(100vh - 120px);min-height:520px;display:flex;font-family:var(--body,'Hanken Grotesk',-apple-system,sans-serif);color:#2B2017}
    #cs-mod h1,#cs-mod h2,#cs-mod h3,#cs-mod .cs-name{font-family:var(--disp,'Fraunces'),Georgia,serif;letter-spacing:-.01em}
    #cs-mod *{box-sizing:border-box}
    #cs-mod .cswrap{flex:1;min-height:0;display:grid;grid-template-columns:220px var(--list-w, 380px) 1fr;background:var(--canvas,#F4EFE7);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(36,31,27,.05)}
    @media(max-width:1100px){#cs-mod .cswrap{grid-template-columns:56px var(--list-w, 320px) 1fr}}

    /* ---------- nav ---------- */
    #cs-mod .cs-nav{background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:16px 12px;min-width:0;overflow-y:auto}
    #cs-mod .cs-nav-brand{font-family:var(--disp,'Fraunces'),serif;font-size:17px;font-weight:600;margin:0 8px 14px;color:#2B2017;display:flex;align-items:center;gap:8px}
    #cs-mod .cs-nav-brand .dot{width:8px;height:8px;border-radius:50%;background:#34B27B;box-shadow:0 0 0 3px rgba(52,178,123,.18);flex:none}
    #cs-mod .cs-nav-section{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#9b8e7d;padding:10px 12px 4px;margin-top:4px}
    #cs-mod .cs-nav-section:first-of-type{margin-top:0}
    #cs-mod .cs-nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;font-size:13.5px;font-weight:500;color:#5b5249;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:inherit;position:relative;border-left:3px solid transparent;transition:background .2s,border-left-color .2s}
    #cs-mod .cs-nav-item i{font-size:17px;color:var(--muted);flex:none}
    #cs-mod .cs-nav-item:hover{background:#EFE7D8}
    #cs-mod .cs-nav-item.on{background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;box-shadow:0 4px 12px rgba(232,114,43,.22)}
    #cs-mod .cs-nav-item.on i{color:#fff}
    #cs-mod .cs-nav-item .cnt{margin-left:auto;font-size:11px;font-weight:700;background:rgba(43,32,23,.08);padding:1px 7px;border-radius:999px;flex:none}
    #cs-mod .cs-nav-item.on .cnt{background:rgba(255,255,255,.25)}
    #cs-mod .cs-nav-item.status-item{padding:7px 12px 7px 12px;font-size:13px}
    #cs-mod .cs-nav-item.status-item i{font-size:14px}
    #cs-mod .cs-status-row{display:flex;align-items:center;gap:6px}
    #cs-mod .cs-status-row .cs-nav-item{flex:1;min-width:0}
    #cs-mod .cs-status-dot-sw{width:13px;height:13px;border-radius:50%;flex:none;border:2px solid #fff;outline:1px solid rgba(0,0,0,.08);cursor:pointer;padding:0;transition:transform .12s}
    #cs-mod .cs-status-dot-sw:hover{transform:scale(1.25)}
    #cs-mod .cs-nav-sp{flex:1}
    #cs-mod .cs-status-create{padding:6px 4px 2px}
    #cs-mod .cs-status-create-row{display:flex;gap:6px}
    #cs-mod .cs-status-create input{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-family:inherit;font-size:12.5px;outline:none;background:#fff}
    #cs-mod .cs-status-create input:focus{border-color:#E8722B}
    #cs-mod .cs-status-create button{flex:none;border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:0 10px;cursor:pointer;color:#5b5249}
    #cs-mod .cs-status-create button:hover{background:#fff;border-color:#ECCDBC;color:#9A4A2B}
    #cs-mod .cs-presence-mini{padding:10px 8px 2px;border-top:1px solid var(--line);margin-top:8px}
    #cs-mod .cs-presence-mini .ph{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);margin:0 0 8px 4px}
    #cs-mod .cs-presence-row{display:flex;align-items:center;gap:8px;padding:5px 4px;font-size:12.5px;color:#5b5249}
    #cs-mod .cs-presence-row .av{width:20px;height:20px;border-radius:50%;background:#EFE7D8;color:#9A4A2B;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}
    #cs-mod .cs-presence-row .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #cs-mod .cs-presence-dot{width:7px;height:7px;border-radius:50%;flex:none}
    #cs-mod .cs-presence-dot.online{background:#34B27B}
    #cs-mod .cs-presence-dot.viewing{background:#E8A23A}
    #cs-mod .cs-presence-dot.typing{background:#E8722B;animation:csPulse 1.2s ease-in-out infinite}
    @keyframes csPulse{0%,100%{opacity:1}50%{opacity:.35}}

    /* ---------- list ---------- */
    #cs-mod .cs-list{border-right:1px solid var(--line);display:flex;flex-direction:column;min-width:0;background:var(--canvas,#F4EFE7);position:relative}
    #cs-mod .cs-list-hd{padding:18px 16px 8px;background:var(--canvas,#F4EFE7);position:sticky;top:0;z-index:10;display:flex;align-items:flex-start;gap:10px}
    #cs-mod .cs-list-hd h2{font-size:22px;font-weight:600;margin:0 0 2px}
    #cs-mod .cs-list-sub{font-size:13px;color:var(--muted)}
    #cs-mod .cs-list-hd-sp{flex:1}
    #cs-mod .cs-live-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#0F6E56;background:#E1F5EE;padding:5px 10px;border-radius:999px;flex:none;margin-top:4px}
    #cs-mod .cs-live-pill .pip{width:6px;height:6px;border-radius:50%;background:#0F6E56;animation:csPulse 1.6s ease-in-out infinite}
    
    /* Sort dropdown wrapper & main layout scoping */
    #cs-mod .cs-sort-dropdown-wrap{position:relative;flex:none;margin-top:4px;z-index:99}
    #cs-mod .cs-sort-dd-btn{font-family:inherit;font-size:11px;font-weight:700;padding:5px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:#0F6E56;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background .15s,border-color .15s}
    #cs-mod .cs-sort-dd-btn:hover{background:#E1F5EE;border-color:#a8dfc8}
    #cs-mod .cs-sort-dd-btn .pip{width:6px;height:6px;border-radius:50%;background:#0F6E56;animation:csPulse 1.6s ease-in-out infinite;flex:none}
    #cs-mod .cs-sort-dd-btn.alt{color:#9A4A2B}
    #cs-mod .cs-sort-dd-btn.alt .pip{display:none}
    
    #cs-mod .cs-sort-dd-menu{display:none;position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px rgba(58,40,24,.13);padding:6px;min-width:170px;z-index:100;box-sizing:border-box}
    #cs-mod .cs-sort-dd-menu.show{display:block}
    #cs-mod .cs-sort-dd-item{font-family:inherit;font-size:12.5px;font-weight:600;padding:8px 12px;border-radius:8px;border:none;background:transparent;width:100%;text-align:left;cursor:pointer;color:#5b5249;display:flex;align-items:center;gap:8px;transition:background .12s;box-sizing:border-box}
    #cs-mod .cs-sort-dd-item i{font-size:14px;color:var(--muted);flex:none}
    #cs-mod .cs-sort-dd-item .pip{width:6px;height:6px;border-radius:50%;background:#0F6E56;animation:csPulse 1.6s ease-in-out infinite;flex:none}
    #cs-mod .cs-sort-dd-item:hover{background:#F4EFE7}
    #cs-mod .cs-sort-dd-item.on{background:#E1F5EE !important;color:#0F6E56 !important}
    #cs-mod .cs-sort-dd-item.on i{color:#0F6E56}
    #cs-mod .cs-sort-dd-sep{height:1px;background:var(--line);margin:5px 0}
    
    #cs-mod .cs-sort-subpanel{position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px rgba(58,40,24,.13);padding:8px;min-width:210px;z-index:101;max-height:280px;overflow-y:auto;box-sizing:border-box}
    #cs-mod .cs-sort-subpanel-search{width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-family:inherit;font-size:12px;outline:none;background:#F9F5EF;margin-bottom:6px;box-sizing:border-box}
    #cs-mod .cs-sort-subpanel-search:focus{border-color:#E8722B}
    #cs-mod .cs-sort-status-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:12.5px;color:#5b5249;cursor:pointer;transition:background .12s;box-sizing:border-box}
    #cs-mod .cs-sort-status-row:hover{background:#F4EFE7}
    #cs-mod .cs-sort-status-row.on{background:#F5E5DA;color:#9A4A2B}
    #cs-mod .cs-sort-status-dot{width:8px;height:8px;border-radius:50%;flex:none}
    #cs-mod .cs-sort-status-lbl{flex:1;font-weight:600}
    #cs-mod .cs-sort-status-cnt{font-size:11px;font-weight:700;background:rgba(43,32,23,.08);padding:1px 7px;border-radius:999px}
    #cs-mod .cs-emp-filter-btn{font-family:inherit;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:#5b5249;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
    #cs-mod .cs-emp-filter-btn.on{background:#F5E5DA;border-color:#ECCDBC;color:#9A4A2B}
    #cs-mod .cs-emp-item{display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;font-size:12.5px;color:#5b5249;cursor:pointer;transition:background .15s;box-sizing:border-box}
    #cs-mod .cs-emp-item:hover{background:#EFE7D8}
    #cs-mod .cs-emp-item .av{width:22px;height:22px;border-radius:50%;background:#EFE7D8;color:#9A4A2B;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none}
    #cs-mod .cs-emp-item .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #cs-mod .cs-emp-item .role{font-size:10px;opacity:.55;font-weight:700;letter-spacing:.02em}
    #cs-mod .cs-emp-item.on{background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff}
    #cs-mod .cs-emp-item.on .av{background:rgba(255,255,255,.25);color:#fff}
    #cs-mod .cs-emp-item.on .role{opacity:.75}
    #cs-mod .cs-emp-ticket-cnt{font-size:10.5px;font-weight:700;background:rgba(43,32,23,.1);padding:1px 7px;border-radius:999px;flex:none;margin-left:auto}
    #cs-mod .cs-emp-item.on .cs-emp-ticket-cnt{background:rgba(255,255,255,.28);color:#fff}
    #cs-mod .cs-chip-new-queue{border-style:dashed;color:#9A4A2B;border-color:#ECCDBC}
    #cs-mod .cs-chip-new-queue.on{background:#F5E5DA;border-color:#E8722B;border-style:solid}
    #cs-mod .cs-chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 16px 10px;background:var(--canvas,#F4EFE7);position:sticky;top:72px;z-index:5;border-bottom:1px solid var(--line)}
    #cs-mod .cs-chip{font-family:inherit;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:#5b5249;cursor:pointer}
    #cs-mod .cs-chip.on{background:#F5E5DA;border-color:#ECCDBC;color:#9A4A2B}
    #cs-mod .cs-rows{overflow:auto;flex:1;padding:8px 12px 16px}
    #cs-mod .cs-row{background:var(--surface);border:1px solid #F0E8DA;border-radius:12px;padding:12px 13px;margin-bottom:8px;cursor:pointer;box-shadow:0 1px 2px rgba(58,40,24,.04);transition:box-shadow .12s,transform .12s,background-color .3s,border-color .3s;position:relative;z-index:1}
    #cs-mod .cs-row:hover{transform:translateY(-1px);box-shadow:0 2px 8px rgba(58,40,24,.08)}
    #cs-mod .cs-row.on{box-shadow:0 0 0 2px var(--orange,#E8722B),0 8px 24px rgba(58,40,24,.08)}
    #cs-mod .cs-row.new{background:#FFF6EC;border-color:#F3CBA0}
    #cs-mod .cs-row.new::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,#F3992E,#E8722B)}
    #cs-mod .cs-row-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}
    #cs-mod .cs-name{font-size:15px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:7px}
    #cs-mod .cs-new-badge{font-family:var(--body,inherit);font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;padding:2px 7px;border-radius:5px;flex:none;box-shadow:0 2px 6px rgba(232,114,43,.3)}
    #cs-mod .cs-dl{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;flex:none;white-space:nowrap;transition:background-color .4s,color .4s}
    #cs-mod .cs-dl.ok{background:#E1F5EE;color:#0F6E56}
    #cs-mod .cs-dl.soon{background:#FBF3DD;color:#8A6A1E}
    #cs-mod .cs-dl.urgent{background:#FCEBEB;color:#A32D2D;animation:csUrgentPulse 1.4s ease-in-out infinite}
    #cs-mod .cs-dl.over{background:#ECECEA;color:#6B6B66}
    #cs-mod .cs-dl.off{background:#ECECEA;color:#9b8e7d}
    @keyframes csUrgentPulse{0%,100%{box-shadow:0 0 0 0 rgba(163,45,45,.25)}50%{box-shadow:0 0 0 4px rgba(163,45,45,0)}}
    #cs-mod .cs-subj{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
    #cs-mod .cs-snip{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #cs-mod .cs-row-foot{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
    #cs-mod .cs-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.03em}
    #cs-mod .cs-badge.amazon{background:#FFE8CC;color:#C26100}
    #cs-mod .cs-badge.ebay{background:#E8F0FE;color:#1A4FB5}
    #cs-mod .cs-badge.shopify{background:#E1F5EE;color:#0F6E56}
    #cs-mod .cs-badge.walmart{background:#E8F0FE;color:#0E5FC2}
    #cs-mod .cs-status{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:6px;background:#EFE7D8;color:#5b5249;display:inline-flex;align-items:center;gap:5px}
    #cs-mod .cs-status .sw{width:6px;height:6px;border-radius:50%;flex:none}
    #cs-mod .cs-status.dot-viewing{background:#FCEFE0;color:#9A6A1E}
    #cs-mod .cs-cat{font-size:11px;color:var(--soft);margin-left:auto}
    #cs-mod .cs-assignee{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#5b5249;background:#EFE7D8;padding:3px 8px 3px 3px;border-radius:999px;flex:none}
    #cs-mod .cs-assignee .av{width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none}
    #cs-mod .cs-assignee.unassigned{background:#F2EFE9;color:var(--soft);font-style:italic}
    #cs-mod .cs-assignee.unassigned .av{background:#DCD3C2;color:#7a6f5f}

    /* ---------- work pane ---------- */
    #cs-mod .cs-work{display:flex;flex-direction:column;min-width:0;background:var(--canvas,#F4EFE7);overflow:hidden}
    #cs-mod .cs-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:15px;padding:32px;text-align:center;flex-direction:column;gap:10px}
    #cs-mod .cs-empty i{font-size:34px;color:#D9CDB8}
    #cs-mod .cs-case{display:none;flex:1;flex-direction:column;min-height:0}
    #cs-mod .cs-case.show{display:flex;animation:csFadeIn .18s ease}
    @keyframes csFadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
    #cs-mod .cs-case-hd{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0;flex-wrap:wrap}
    #cs-mod .cs-case-hd h2{font-size:20px;font-weight:600;margin:0;flex:1;line-height:1.25;min-width:200px}
    #cs-mod .cs-case-meta{font-size:13px;color:var(--muted);margin-top:4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    #cs-mod .cs-case-sla{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;font-weight:700;padding:4px 10px;border-radius:7px;display:inline-flex;align-items:center;gap:6px;transition:background-color .4s,color .4s}
    #cs-mod .cs-case-sla::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
    #cs-mod .cs-case-sla.ok{background:#E1F5EE;color:#0F6E56}
    #cs-mod .cs-case-sla.soon{background:#FBF3DD;color:#8A6A1E}
    #cs-mod .cs-case-sla.urgent{background:#FCEBEB;color:#A32D2D;animation:csUrgentPulse 1.4s ease-in-out infinite}
    #cs-mod .cs-case-sla.over{background:#ECECEA;color:#6B6B66}
    #cs-mod .cs-case-sla.off{background:#ECECEA;color:#9b8e7d}
    #cs-mod .cs-case-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    #cs-mod .cs-case-hd-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none}

    /* ---------- order case indicator badges ---------- */
    #cs-mod .cs-case-badges{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;max-width:340px}
    #cs-mod .cs-case-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:4px 10px 4px 8px;border-radius:999px;white-space:nowrap;animation:csBadgeIn .25s ease}
    @keyframes csBadgeIn{from{opacity:0;transform:translateY(-3px) scale(.94)}to{opacity:1;transform:translateY(0) scale(1)}}
    #cs-mod .cs-case-badge .dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
    #cs-mod .cs-case-badge.return{background:#FCEBEB;color:#A32D2D}
    #cs-mod .cs-case-badge.inr{background:#FFF1E2;color:#B5630F}
    #cs-mod .cs-case-badge.a2z{background:#E8F0FE;color:#1A4FB5}
    #cs-mod .cs-case-badge.chargeback{background:#F1EAFB;color:#6B3FA0}
    #cs-mod .cs-case-badge.replacement{background:#E1F5EE;color:#157A55}
    #cs-mod .cs-case-badge.other{background:#ECECEA;color:#54504A}
    #cs-mod .cs-case-badge button{border:none;background:none;cursor:pointer;color:currentColor;opacity:.6;padding:0;margin-left:1px;display:inline-flex;font-size:13px;line-height:1}
    #cs-mod .cs-case-badge button:hover{opacity:1}
    #cs-mod .cs-row-case-dots{display:inline-flex;gap:3px;flex:none}
    #cs-mod .cs-row-case-dot{width:7px;height:7px;border-radius:50%;flex:none}
    #cs-mod .cs-row-case-dot.return{background:#A32D2D}
    #cs-mod .cs-row-case-dot.inr{background:#B5630F}
    #cs-mod .cs-row-case-dot.a2z{background:#1A4FB5}
    #cs-mod .cs-row-case-dot.chargeback{background:#6B3FA0}
    #cs-mod .cs-row-case-dot.replacement{background:#157A55}
    #cs-mod .cs-row-case-dot.other{background:#54504A}
    
    /* Status Selector (Dropdown) Enhancement */
    #cs-mod .cs-status-sel {
        letter-spacing: 0.05em;
        text-shadow: 0 1px 1px rgba(0,0,0,0.2);
        font-family: inherit;
        font-size: 14px;
        font-weight: 800;
        text-transform: uppercase;
        padding: 10px 20px;
        border-radius: 8px;
        border: none;
        background-color: var(--status-color, #5b5249);
        color: #ffffff;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 170px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.15);
    }
    #cs-mod .cs-status-sel:hover {
        filter: brightness(1.1);
        box-shadow: 0 6px 10px rgba(0,0,0,0.2);
    }
    #cs-mod .cs-reassign{font-family:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--surface);cursor:pointer;display:inline-flex;align-items:center;gap:6px;color:#5b5249}
    #cs-mod .cs-reassign:hover{background:#fff;border-color:#ECCDBC;color:#9A4A2B}
    #cs-mod .cs-reassign:disabled{opacity:.45;cursor:not-allowed}
    #cs-mod .cs-body{flex:1;display:grid;grid-template-columns:1fr 5px var(--side-w, 320px);min-height:0;overflow:hidden}
    @media(max-width:1200px){#cs-mod .cs-body{grid-template-columns:1fr}}
    #cs-mod .cs-thread-col{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line)}

    /* ---------- middle-panel tabs ---------- */
    #cs-mod .cs-mid-tabbar{display:flex;gap:4px;padding:10px 14px 0;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}
    #cs-mod .cs-mid-tab{font-family:inherit;font-size:13.5px;font-weight:600;padding:9px 14px;border:none;background:none;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;display:flex;align-items:center;gap:7px;position:relative;top:1px}
    #cs-mod .cs-mid-tab i{font-size:16px}
    #cs-mod .cs-mid-tab.on{color:#9A4A2B;border-bottom-color:#E8722B}
    #cs-mod .cs-mid-tab .badge{font-size:10px;font-weight:700;background:#EFE7D8;color:#5b5249;padding:1px 6px;border-radius:999px}
    #cs-mod .cs-mid-tab.on .badge{background:#F5E5DA;color:#9A4A2B}
    #cs-mod .cs-mid-pane{display:none;flex:1;flex-direction:column;min-height:0}
    #cs-mod .cs-mid-pane.show{display:flex}
    #cs-mod .cs-mid-notes{padding:16px;overflow:auto;gap:0}
    #cs-mod .cs-mid-notes .cs-note-list{max-height:none;flex:1;margin-bottom:12px}
    #cs-mod .cs-mid-notes .cs-note-compose{flex-shrink:0}

    /* ---------- resize handles ---------- */
    #cs-mod .cs-resize-handle{position:relative;cursor:col-resize;background:transparent;flex:none;z-index:5;touch-action:none}
    #cs-mod .cs-resize-handle::after{content:'';position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--line);transform:translateX(-50%);transition:background-color .12s,width .12s}
    #cs-mod .cs-resize-handle:hover::after,#cs-mod .cs-resize-handle.dragging::after{background:#E8722B;width:2px}
    #cs-mod .cswrap.resizing{cursor:col-resize;user-select:none}
    #cs-mod .cswrap.resizing *{user-select:none}
    #cs-mod .cs-list-resize{position:absolute;top:0;right:0;bottom:0;width:5px;cursor:col-resize;z-index:5;touch-action:none}
    #cs-mod .cs-list-resize::after{content:'';position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--line);transform:translateX(-50%);transition:background-color .12s,width .12s}
    #cs-mod .cs-list-resize:hover::after,#cs-mod .cs-list-resize.dragging::after{background:#E8722B;width:2px}

    #cs-mod .cs-panel h3 .badge{font-size:10px;font-weight:700;background:#EFE7D8;color:#5b5249;padding:1px 6px;border-radius:999px;margin-left:auto}

    /* ---------- merged timeline ---------- */
    #cs-mod .cs-thread{flex:1;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
    #cs-mod .cs-day-sep{align-self:center;font-size:11.5px;font-weight:700;color:var(--soft);background:var(--canvas);padding:3px 12px;border-radius:999px;margin:6px 0;text-transform:uppercase;letter-spacing:.04em}
    #cs-mod .cs-msg{max-width:92%;display:flex;flex-direction:column}
    #cs-mod .cs-msg.in{align-self:flex-start}
    #cs-mod .cs-msg.out{align-self:flex-end}
    #cs-mod .cs-msg-bubble{background:var(--surface);border:1px solid var(--line);border-radius:14px 14px 14px 4px;padding:11px 14px;font-size:14px;line-height:1.55;box-shadow:0 1px 2px rgba(58,40,24,.04);white-space:pre-wrap}
    #cs-mod .cs-msg.out .cs-msg-bubble{background:#FFF7F0;border-color:#F0CDB4;border-radius:14px 14px 4px 14px}
    #cs-mod .cs-msg.out .cs-msg-bubble.pending{opacity:.6;border-style:dashed}
    #cs-mod .cs-msg.in.cs-msg-newest .cs-msg-bubble{background:#EDF7FF;border-color:#93C8EC;box-shadow:0 0 0 2px rgba(26,79,181,.10),0 2px 8px rgba(26,79,181,.08)}
    #cs-mod .cs-msg.out.cs-msg-newest .cs-msg-bubble{background:linear-gradient(135deg,#FFF0E2,#FFE4CC);border-color:#E8722B;box-shadow:0 0 0 2px rgba(232,114,43,.18),0 2px 8px rgba(232,114,43,.12)}
    #cs-mod .cs-msg-newest-badge{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:999px;background:#E8722B;color:#fff;margin-left:6px;vertical-align:middle;flex:none}
    #cs-mod .cs-msg.in.cs-msg-newest .cs-msg-newest-badge{background:#1A4FB5}
    #cs-mod .cs-tl-note.cs-tl-note-newest{border-color:#D99A2B;background:#FFFBE8;box-shadow:0 0 0 2px rgba(217,154,43,.15)}
    #cs-mod .cs-msg-meta{font-size:11.5px;color:var(--soft);margin-bottom:4px;display:flex;gap:8px;align-items:center}
    #cs-mod .cs-msg.out .cs-msg-meta{justify-content:flex-end}
    #cs-mod .cs-msg-status{font-size:10.5px;font-weight:700;color:#34B27B;display:inline-flex;align-items:center;gap:3px}
    #cs-mod .cs-tl-note{align-self:flex-end;max-width:92%;background:#FFF6DE;border:1px solid #E8C778;border-right:3px solid #D99A2B;border-radius:14px 14px 4px 14px;padding:9px 12px;font-size:13.5px;box-shadow:0 1px 2px rgba(58,40,24,.04)}
    #cs-mod .cs-tl-note-head{display:flex;align-items:center;justify-content:flex-end;gap:6px;font-size:11.5px;font-weight:700;color:#8A6A1E;margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em}
    #cs-mod .cs-tl-note-body{white-space:pre-wrap;line-height:1.45;color:#3a2f22;text-align:left}
    #cs-mod .cs-tl-note-body .mention{color:#9A4A2B;font-weight:600;background:#F5E5DA;padding:1px 4px;border-radius:4px}
    #cs-mod .cs-tl-note-time{font-size:11px;color:var(--soft);margin-top:5px;text-align:right}
    #cs-mod .cs-tl-sys{align-self:center;display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);background:rgba(43,32,23,.05);padding:6px 14px;border-radius:999px;text-align:center;max-width:90%}
    #cs-mod .cs-tl-sys i{font-size:14px;color:#9b8e7d;flex:none}
    #cs-mod .cs-tl-sys b{color:#5b5249;font-weight:600}

    #cs-mod .cs-status-sel{font-family:inherit;font-size:13px;font-weight:700;padding:8px 12px;border-radius:10px;border:2px solid var(--status-color,var(--line));background:var(--status-bg,var(--surface));color:var(--status-color,#5b5249);cursor:pointer;transition:border-color .25s,background .25s,color .25s}

    /* ---------- compose tools ---------- */
    #cs-mod .cs-compose{border-top:1px solid var(--line);padding:12px 14px;background:var(--surface);flex-shrink:0;position:relative}
    #cs-mod .cs-compose-inner{display:flex;gap:10px;align-items:flex-start}
    #cs-mod .cs-compose-textarea-wrap{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
    #cs-mod .cs-compose textarea{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-family:inherit;font-size:14px;resize:vertical;min-height:72px;outline:none;background:#fff}
    #cs-mod .cs-compose textarea:focus{border-color:#E8722B}
    #cs-mod .cs-compose-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap}

    #cs-mod .cs-tpl-live-preview{width:220px;flex:none;background:#FFFAF5;border:1px solid #F0DCC8;border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.5;color:#5b5249;display:none;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto}
    #cs-mod .cs-tpl-live-preview.show{display:flex}
    #cs-mod .cs-tpl-live-preview .plv-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#E8722B;margin-bottom:2px}
    #cs-mod .cs-tpl-live-preview .plv-title{font-family:var(--disp,'Fraunces'),serif;font-size:13.5px;font-weight:600;color:#2B2017;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #cs-mod .cs-tpl-live-preview .plv-body{color:#6b5f52;font-size:12px;line-height:1.5;white-space:pre-wrap;flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical}
    #cs-mod .cs-tpl-live-preview .plv-insert{margin-top:4px;font-family:inherit;font-size:11.5px;font-weight:700;padding:5px 10px;border-radius:8px;border:none;background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;cursor:pointer;align-self:flex-start}

    #cs-mod .cs-msg-img-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    #cs-mod .cs-msg-thumb{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid rgba(0,0,0,.08);cursor:pointer;transition:transform .12s,box-shadow .12s;flex:none}
    #cs-mod .cs-msg-thumb:hover{transform:scale(1.06);box-shadow:0 4px 12px rgba(0,0,0,.15)}
    #cs-mod .cs-msg-file-list{display:flex;flex-direction:column;gap:5px;margin-top:8px}
    #cs-mod .cs-msg-file-chip{display:inline-flex;align-items:center;gap:8px;background:#EEF3FE;border:1px solid #C5D6F8;border-radius:8px;padding:6px 10px;text-decoration:none;color:#2B4BAF;font-size:12.5px;font-weight:600;max-width:280px;transition:background .15s}
    #cs-mod .cs-msg-file-chip:hover{background:#dce8fd}
    #cs-mod .cs-msg-file-ext{font-size:10px;font-weight:800;background:#2B4BAF;color:#fff;padding:2px 5px;border-radius:4px;letter-spacing:.03em;flex:none}
    #cs-mod .cs-msg-file-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    /* ---------- lightbox ---------- */
    #cs-mod .cs-lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out;animation:csFadeIn .15s ease}
    #cs-mod .cs-lightbox.show{display:flex}
    #cs-mod .cs-lightbox img{max-width:90vw;max-height:88vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);cursor:default}
    #cs-mod .cs-lightbox-close{position:absolute;top:18px;right:22px;background:rgba(255,255,255,.15);border:none;color:#fff;font-size:22px;border-radius:50%;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
    #cs-mod .cs-lightbox-close:hover{background:rgba(255,255,255,.3)}

    /* ---------- order table ---------- */
    #cs-mod .cs-order-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12.5px}
    #cs-mod .cs-order-table th{text-align:left;padding:5px 6px;background:#F4EFE7;color:#9b8e7d;font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line)}
    #cs-mod .cs-order-table td{padding:6px 6px;border-bottom:1px dashed #F0E8DA;vertical-align:top}
    #cs-mod .cs-order-table td:last-child{text-align:right;font-weight:600;white-space:nowrap}
    #cs-mod .cs-order-table tr:last-child td{border-bottom:none}
    #cs-mod .cs-order-table .cs-order-total-row td{padding-top:7px;font-weight:700;color:#2B2017;border-top:2px solid var(--line)}
    #cs-mod .cs-btn-ghost{font-family:inherit;font-size:13px;font-weight:600;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);cursor:pointer;color:#5b5249;display:inline-flex;align-items:center;gap:6px}
    #cs-mod .cs-btn-ghost:hover{background:#fff}
    #cs-mod .cs-btn-send{font-family:inherit;font-size:14px;font-weight:700;padding:10px 18px;border:none;border-radius:10px;background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;cursor:pointer;box-shadow:0 4px 12px rgba(232,114,43,.25)}
    #cs-mod .cs-btn-send:disabled{opacity:.5;cursor:not-allowed}
    #cs-mod .cs-conflict-banner{display:none;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:#9A4A2B;background:#FFF1E2;border:1px solid #F3CBA0;border-radius:10px;padding:8px 12px;margin-bottom:8px}
    #cs-mod .cs-conflict-banner.show{display:flex}
    #cs-mod .cs-conflict-banner i{font-size:16px}
    #cs-mod .cs-kbd-hint{font-size:11px;color:var(--soft);margin-top:5px}
    #cs-mod .cs-kbd-hint kbd{font-family:'JetBrains Mono',monospace;background:var(--canvas);border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:10.5px}

    /* ---------- undo send ---------- */
    #cs-mod .cs-undo-toast{position:absolute;left:14px;right:14px;bottom:calc(100% + 8px);background:#2B2017;color:#fff;border-radius:12px;padding:10px 14px;display:none;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(36,31,27,.25);z-index:8}
    #cs-mod .cs-undo-toast.show{display:flex;animation:csSlideUp .18s ease}
    @keyframes csSlideUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    #cs-mod .cs-undo-toast .msg{flex:1;font-size:13px}
    #cs-mod .cs-undo-toast .msg b{font-weight:700}
    #cs-mod .cs-undo-toast .ring{width:26px;height:26px;border-radius:50%;position:relative;flex:none;background:conic-gradient(#F3992E var(--p,0%),rgba(255,255,255,.15) 0);transition:background .3s}
    #cs-mod .cs-undo-toast .ring.cs-ring-late{background:conic-gradient(#E0453D var(--p,0%),rgba(255,255,255,.15) 0)}
    #cs-mod .cs-undo-toast .ring::after{content:attr(data-s);position:absolute;inset:2px;border-radius:50%;background:#2B2017;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff}
    #cs-mod .cs-undo-btn{font-family:inherit;font-size:12.5px;font-weight:700;background:none;border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 12px;border-radius:8px;cursor:pointer;flex:none}
    #cs-mod .cs-undo-btn:hover{background:rgba(255,255,255,.12)}

    /* ---------- template tools ---------- */
    /* ---------- compose tools ---------- */
    #cs-mod .cs-compose-tools{position:relative;margin-right:auto}

    /* reply toolbar (emoji / image / file buttons) */
    #cs-mod .cs-reply-toolbar{display:flex;align-items:center;gap:4px;margin-top:6px}
    #cs-mod .cs-reply-tool-btn{font-family:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:1px solid transparent;background:none;cursor:pointer;color:#9b8e7d;display:inline-flex;align-items:center;gap:5px;transition:background .15s,color .15s,border-color .15s}
    #cs-mod .cs-reply-tool-btn:hover{background:#EFE7D8;color:#5b5249;border-color:var(--line)}
    #cs-mod .cs-reply-tool-btn i{font-size:16px}

    /* pending reply attachments */
    #cs-mod .cs-reply-pending-atts{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0 2px}
    #cs-mod .cs-reply-att-chip{position:relative;display:inline-flex;align-items:center;gap:5px;background:#F4EFE7;border:1px solid #E0D4C0;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:600;color:#5b5249;max-width:180px}
    #cs-mod .cs-reply-att-chip img{width:36px;height:36px;object-fit:cover;border-radius:5px;flex:none}
    #cs-mod .cs-reply-att-chip .chip-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #cs-mod .cs-reply-att-chip .chip-rm{border:none;background:none;cursor:pointer;color:#9b8e7d;padding:0 0 0 4px;font-size:14px;display:inline-flex;align-items:center;flex:none}
    #cs-mod .cs-reply-att-chip .chip-rm:hover{color:#A32D2D}
    #cs-mod .cs-reply-att-chip.is-file{background:#EEF3FE;border-color:#C5D6F8}

    /* emoji picker popup */
    #cs-mod .cs-emoji-picker{position:absolute;bottom:calc(100% + 8px);left:0;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 32px rgba(58,40,24,.16);padding:10px;width:300px;z-index:50;display:none}
    #cs-mod .cs-emoji-picker.show{display:block;animation:csFadeIn .15s ease}
    #cs-mod .cs-emoji-picker-search{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-family:inherit;font-size:13px;outline:none;margin-bottom:8px}
    #cs-mod .cs-emoji-picker-search:focus{border-color:#E8722B}
    #cs-mod .cs-emoji-cat-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9b8e7d;margin:6px 2px 4px}
    #cs-mod .cs-emoji-grid{display:flex;flex-wrap:wrap;gap:2px;max-height:200px;overflow-y:auto}
    #cs-mod .cs-emoji-btn{border:none;background:none;cursor:pointer;font-size:20px;padding:4px 5px;border-radius:6px;line-height:1;transition:background .1s}
    #cs-mod .cs-emoji-btn:hover{background:#F4EFE7}

    #cs-mod .cs-tpl-menu{position:absolute;bottom:100%;left:0;margin-bottom:6px;background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:0 12px 30px rgba(58,40,24,.16);padding:8px;min-width:300px;max-height:320px;display:none;z-index:10;flex-direction:column}
    #cs-mod .cs-tpl-menu.show{display:flex}
    #cs-mod .cs-tpl-search{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-family:inherit;font-size:13px;margin-bottom:6px;outline:none;flex:none}
    #cs-mod .cs-tpl-search:focus{border-color:#E8722B}
    #cs-mod .cs-tpl-list{overflow:auto}
    #cs-mod .cs-tpl-menu button{display:block;width:100%;text-align:left;border:none;background:none;padding:9px 10px;border-radius:8px;font-family:inherit;cursor:pointer}
    #cs-mod .cs-tpl-menu button:hover,#cs-mod .cs-tpl-menu button.active{background:var(--canvas)}
    #cs-mod .cs-tpl-menu button .tt{font-size:13.5px;font-weight:600;color:#2B2017;display:flex;align-items:center;gap:6px}
    #cs-mod .cs-tpl-menu button .tt i.fav{color:#E8A23A;font-size:13px}
    #cs-mod .cs-tpl-menu button .tb{font-size:12px;color:var(--soft);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
    #cs-mod .cs-tpl-empty{padding:14px 10px;font-size:13px;color:var(--soft);text-align:center}

    /* ---------- note items ---------- */
    #cs-mod .cs-note-list{display:flex;flex-direction:column;gap:8px;max-height:280px;overflow:auto}
    #cs-mod .cs-note-item{background:#FFFDF7;border:1px solid #EDD9A6;border-radius:10px;padding:9px 11px;font-size:13px;max-width:100%}
    #cs-mod .cs-note-head{display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:11px;color:var(--muted)}
    #cs-mod .cs-note-head .who{font-weight:600;color:#5b5249}
    #cs-mod .cs-note-body{white-space:pre-wrap;line-height:1.4}
    #cs-mod .cs-note-body .mention{color:#9A4A2B;font-weight:600;background:#F5E5DA;padding:1px 4px;border-radius:4px}
    #cs-mod .cs-note-atts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    #cs-mod .cs-note-att img{max-width:110px;max-height:80px;border-radius:8px;border:1px solid var(--line);cursor:pointer;display:block}
    #cs-mod .cs-note-actions{margin-left:auto;display:flex;gap:4px}
    #cs-mod .cs-note-actions button{border:none;background:none;cursor:pointer;color:var(--soft);font-size:13px;padding:2px 4px}
    #cs-mod .cs-note-actions button:hover{color:#9A4A2B}
    #cs-mod .cs-note-locked{font-size:10px;color:var(--soft);font-style:italic}
    #cs-mod .cs-note-compose{position:relative;margin-top:10px}
    #cs-mod .cs-note-compose textarea{width:100%;box-sizing:border-box;border:1px solid #EDD9A6;border-radius:10px;padding:9px 10px;font-family:inherit;font-size:13px;min-height:60px;resize:vertical;background:#FFFDF7;outline:none}
    #cs-mod .cs-note-compose textarea:focus{border-color:#E8A23A}
    #cs-mod .cs-note-foot{display:flex;align-items:center;gap:6px;margin-top:7px;flex-wrap:wrap}
    #cs-mod .cs-mention-hint{font-size:10.5px;color:var(--soft);flex:1}
    #cs-mod .cs-note-pending-atts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    #cs-mod .cs-mention-menu{position:absolute;bottom:100%;left:0;margin-bottom:6px;background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:0 12px 30px rgba(58,40,24,.16);padding:6px;min-width:220px;max-height:200px;overflow:auto;display:none;z-index:10}
    #cs-mod .cs-mention-menu.show{display:block}
    #cs-mod .cs-mention-menu button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:none;padding:8px 9px;border-radius:8px;font-family:inherit;font-size:13.5px;cursor:pointer}
    #cs-mod .cs-mention-menu button:hover{background:var(--canvas)}
    #cs-mod .cs-mention-menu .av{width:20px;height:20px;border-radius:50%;background:#EFE7D8;color:#9A4A2B;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}

    /* ---------- personal notes ---------- */
    #cs-mod .cs-pnote-panel{display:flex;flex-direction:column}
    #cs-mod .cs-pnote-panel h3{margin-bottom:4px}
    #cs-mod .cs-pnote-sub{font-size:11.5px;color:#534AB7;display:flex;align-items:center;gap:6px;margin:0 0 12px;background:#EEEDFE;border:1px solid #AFA9EC;border-radius:8px;padding:6px 10px}
    #cs-mod .cs-pnote-sub i{font-size:13px;flex:none}
    #cs-mod .cs-pnote-sub.team{color:#8A6A1E;background:#FBF3DD;border-color:#E8D8A0}
    #cs-mod .cs-pnote-empty-cta{font-family:inherit;font-size:13px;font-weight:600;padding:9px 12px;border:1.5px dashed #D4C8F0;border-radius:10px;background:#F9F6FF;color:#534AB7;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:center;gap:6px}
    #cs-mod .cs-pnote-empty-cta:hover{border-color:#7F77DD;background:#F2EEFE}
    #cs-mod .cs-pnote-card{background:#F9F6FF;border:1px solid #D4C8F0;border-radius:12px;overflow:hidden}
    #cs-mod .cs-pnote-card-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #E4DBFA;background:#F2EEFE}
    #cs-mod .cs-pnote-card-hd .meta{flex:1;min-width:0}
    #cs-mod .cs-pnote-card-hd .ts{font-size:10.5px;color:#7B72C4;display:block;line-height:1.4}
    #cs-mod .cs-pnote-card-hd .ts b{font-weight:700;color:#534AB7}
    #cs-mod .cs-pnote-actions{display:flex;gap:2px;flex:none}
    #cs-mod .cs-pnote-actions button{border:none;background:none;cursor:pointer;color:#8077C2;font-size:14.5px;padding:4px 5px;border-radius:6px}
    #cs-mod .cs-pnote-actions button:hover{background:#E4DBFA;color:#534AB7}
    #cs-mod .cs-pnote-body-wrap{padding:10px 12px}
    #cs-mod .cs-pnote-card.collapsed .cs-pnote-body-wrap{display:none}
    #cs-mod .cs-pnote-rte-toolbar{display:flex;gap:2px;margin-bottom:6px;flex-wrap:wrap}
    #cs-mod .cs-pnote-rte-toolbar button{font-family:inherit;border:1px solid #D4C8F0;background:#fff;color:#534AB7;width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:12.5px;display:inline-flex;align-items:center;justify-content:center}
    #cs-mod .cs-pnote-rte-toolbar button:hover{background:#F2EEFE}
    #cs-mod .cs-pnote-rte-toolbar button.b{font-weight:800}
    #cs-mod .cs-pnote-rte-toolbar button.i{font-style:italic}
    #cs-mod .cs-pnote-rte-toolbar .sep{width:1px;background:#E4DBFA;margin:2px 3px}
    #cs-mod .cs-pnote-editable{min-height:90px;max-height:280px;overflow:auto;border:1px solid #D4C8F0;border-radius:8px;padding:9px 10px;font-family:inherit;font-size:13.5px;line-height:1.5;background:#fff;outline:none}
    #cs-mod .cs-pnote-editable:focus{border-color:#7F77DD}
    #cs-mod .cs-pnote-editable:empty::before{content:attr(data-placeholder);color:var(--soft)}
    #cs-mod .cs-pnote-editable img{max-width:100%;border-radius:6px;margin:4px 0;display:block}
    #cs-mod .cs-pnote-display{font-size:13.5px;line-height:1.5;color:#3a2f22}
    #cs-mod .cs-pnote-display img{max-width:100%;border-radius:6px;margin:4px 0;display:block}
    #cs-mod .cs-pnote-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
    #cs-mod .cs-pnote-savestate{font-size:11px;color:var(--soft);display:flex;align-items:center;gap:5px}
    #cs-mod .cs-pnote-savestate i{font-size:12px}
    #cs-mod .cs-pnote-savestate.saving{color:#B56D1D}
    #cs-mod .cs-pnote-savestate.saved{color:#0F6E56}
    #cs-mod .cs-pnote-attach-btn{font-family:inherit;font-size:11.5px;font-weight:600;border:1px solid #D4C8F0;background:#fff;color:#534AB7;padding:5px 9px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
    #cs-mod .cs-pnote-attach-btn:hover{background:#F2EEFE}

    /* ---------- side panel ---------- */
    #cs-mod .cs-side{overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px;background:#FBFAF7}
    #cs-mod .cs-panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 1px 2px rgba(58,40,24,.04)}
    #cs-mod .cs-panel h3{font-size:15px;font-weight:600;margin:0 0 10px;display:flex;align-items:center;gap:7px}
    #cs-mod .cs-panel h3 i{color:var(--orange,#E8722B);font-size:17px}
    #cs-mod .cs-kv{display:grid;grid-template-columns:110px 1fr;gap:6px 10px;font-size:13.5px;margin-bottom:4px}
    #cs-mod .cs-kv .k{color:var(--muted)}
    #cs-mod .cs-ohist-email{font-size:11.5px;color:var(--soft);margin-bottom:10px;display:flex;align-items:center;gap:5px}
    #cs-mod .cs-ohist-row{display:flex;flex-direction:column;gap:5px;padding:9px 0;border-bottom:1px solid var(--line)}
    #cs-mod .cs-ohist-row:last-child{border-bottom:none}
    #cs-mod .cs-ohist-row-top{display:flex;align-items:center;gap:8px}
    #cs-mod .cs-ohist-id{font-weight:600;color:#3a2f22;font-family:'JetBrains Mono',monospace;font-size:11.5px;margin-left:auto}
    #cs-mod .cs-ohist-row-bottom{display:flex;align-items:center;justify-content:space-between;font-size:11.5px}
    #cs-mod .cs-ohist-status{color:var(--muted)}
    #cs-mod .cs-ohist-date{color:var(--soft)}
    #cs-mod .cs-match-form{margin-top:10px;padding-top:10px;border-top:1px dashed #F0E8DA;display:flex;flex-direction:column;gap:6px}
    #cs-mod .cs-match-lbl{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--soft);margin-top:4px}
    #cs-mod .cs-match-sel,#cs-mod .cs-match-input{font-family:inherit;font-size:13.5px;padding:8px 10px;border-radius:9px;border:1px solid var(--line);background:#fff;color:#2B2017;outline:none}
    #cs-mod .cs-match-sel:focus,#cs-mod .cs-match-input:focus{border-color:#E8722B}
    #cs-mod .cs-match-btn{margin-top:6px;justify-content:center;background:#FFF7F0;border-color:#F0CDB4;color:#9A4A2B}
    #cs-mod .cs-match-btn:hover{background:#FFF1E2}
    #cs-mod .cs-audit-item{font-size:12.5px;padding:6px 0;border-bottom:1px dashed #F0E8DA;color:var(--muted)}
    #cs-mod .cs-audit-item:last-child{border-bottom:none}
    #cs-mod .cs-presence-panel-row{display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 0}
    #cs-mod .cs-presence-panel-row .av{width:22px;height:22px;border-radius:50%;background:#EFE7D8;color:#9A4A2B;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}
    #cs-mod .cs-presence-panel-row .lbl{font-size:11.5px;color:var(--soft);margin-left:auto}

    /* ---------- template manager ---------- */
    #cs-mod .cs-tpl-view{display:none;position:absolute;inset:0;z-index:50;background:var(--canvas,#F4EFE7);flex-direction:column}
    #cs-mod .cs-tpl-view.show{display:flex;animation:csFadeIn .2s ease}
    #cs-mod .cs-tpl-view-hd{padding:28px 40px;background:var(--surface);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:24px}
    #cs-mod .cs-tpl-view-hd h2{font-size:24px;font-weight:600;margin:0;flex:1;min-width:200px}
    #cs-mod .cs-tpl-view-hd p{font-size:13.5px;color:var(--muted);margin:4px 0 0}
    #cs-mod .cs-tpl-view-search{font-family:inherit;font-size:14px;padding:9px 14px;border:1px solid var(--line);border-radius:10px;outline:none;background:#fff;min-width:240px}
    #cs-mod .cs-tpl-view-search:focus{border-color:#E8722B}
    #cs-mod .cs-tpl-toolbar{padding:16px 40px 0;display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0}
    #cs-mod .cs-tpl-cat-chip{font-family:inherit;font-size:12.5px;font-weight:600;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:#5b5249;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
    #cs-mod .cs-tpl-cat-chip.on{background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff;border-color:transparent}
    #cs-mod .cs-tpl-cat-chip .cnt{font-size:10px;background:rgba(43,32,23,.08);padding:0 5px;border-radius:999px}
    #cs-mod .cs-tpl-cat-chip.on .cnt{background:rgba(255,255,255,.25)}

    #cs-mod .cs-tpl-main{flex:1;min-height:0;display:flex;overflow:hidden}
    #cs-mod .cs-tpl-body {
        width: 100%;
        min-height: 200px;
        resize: vertical;
        padding: 12px;
        border: 1px solid #E6DED0;
        border-radius: 8px;
        font-family: inherit;
        font-size: 14px;
        outline: none;
    }
    #cs-mod .cs-tpl-body-scroll{flex:1;min-width:0;padding:28px 32px;overflow-y:auto}
    #cs-mod .cs-tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;align-content:start}
    #cs-mod .cs-tpl-card {
        background: var(--surface);
        border: 1px solid #E6DED0;
        border-left: 5px solid var(--cat-a, #D9C8B0);
        border-radius: 12px;
        padding: 18px;
        box-shadow: 0 2px 5px rgba(58,40,24,.05);
        transition: box-shadow .2s, border-color .2s, transform .15s;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    #cs-mod .cs-tpl-card:not(.expanded):hover{transform:translateY(-2px);box-shadow:0 8px 18px rgba(58,40,24,.1)}
    .cs-attachment-preview img {
        cursor: pointer;
        transition: transform 0.2s;
        display: block;
    }
    .cs-attachment-preview img:hover {
        transform: scale(1.02);
    }
    
    /* Status Colors Mapping */
    .status-pill { padding: 4px 10px; border-radius: 15px; font-weight: 600; font-size: 11px; }
    .status-new_ticket { background: #E1F5FE; color: #0288D1; border: 1px solid #B3E5FC; }
    .status-awaiting_reply { background: #FFF3E0; color: #F57C00; border: 1px solid #FFE0B2; }
    .status-to_do { background: #E8EAF6; color: #3F51B5; border: 1px solid #C5CAE9; }
    .status-replacement { background: #F3E5F5; color: #7B1FA2; border: 1px solid #E1BEE7; }
    .status-refund { background: #FFEBEE; color: #D32F2F; border: 1px solid #FFCDD2; }
    .status-resolved { background: #E8F5E9; color: #2E7D32; border: 1px solid #C8E6C9; }
    
    #cs-mod .cs-tpl-card.expanded{height: auto !important; width: auto; min-height: 400px; min-width: 300px; display: flex; flex-direction: column; overflow: visible; grid-column:1/-1;padding:24px;background:linear-gradient(180deg,var(--cat-bg,#FFF7F0) 0%,var(--surface) 130px);cursor:default}
    #cs-mod .cs-tpl-card.selected{border-color:var(--cat-a,#E8722B);box-shadow:0 0 0 2px color-mix(in srgb, var(--cat-a,#E8722B) 22%, transparent),0 10px 26px rgba(58,40,24,.12)}
    #cs-mod .cs-tpl-card-hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    #cs-mod .cs-tpl-card.expanded .cs-tpl-card-hd{padding-bottom:12px;border-bottom:2px solid var(--cat-bg,#F0E5D4)}
    #cs-mod .cs-tpl-title { font-size: 16px; font-weight: 600; color: #2B2017; border: none; background: transparent; }
    #cs-mod .cs-tpl-cat-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 3px 8px; border-radius: 6px; background: #EFE7D8; color: #5b5249; }
    #cs-mod .cs-tpl-card input.cs-tpl-title{font-family:var(--disp,'Fraunces'),serif;font-size:15.5px;font-weight:600;border:none;background:transparent;color:#2B2017;outline:none;flex:1;padding:2px 4px;border-radius:5px;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
    #cs-mod .cs-tpl-card:not(.expanded) select.cs-tpl-cat-sel{max-width:84px;font-size:10.5px;padding:5px 8px}
    #cs-mod .cs-tpl-card.expanded input.cs-tpl-title{font-size:19px}
    #cs-mod .cs-tpl-card input.cs-tpl-title:focus{background:#FFF7F0;outline:1px solid #F0CDB4}
    #cs-mod .cs-tpl-card select.cs-tpl-cat-sel{font-family:inherit;font-size:11px;font-weight:700;border:none;border-radius:999px;padding:5px 11px;background:var(--cat-bg,var(--canvas));color:var(--cat-fg,#5b5249);flex:none;max-width:130px;cursor:pointer}
    #cs-mod .tpl-icon{border:none;background:var(--cat-bg,#EFE7D8);color:var(--cat-fg,#9b8e7d);width:32px;height:32px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;font-size:15px;transition:transform .12s}
    #cs-mod .tpl-icon:hover{transform:scale(1.08)}
    #cs-mod .tpl-icon.fav-on{background:linear-gradient(135deg,#F3992E,#E8722B);color:#fff}
    #cs-mod .tpl-color-sw-btn{border:2px solid #fff;outline:1px solid rgba(0,0,0,.1);width:22px;height:22px;border-radius:50%;cursor:pointer;flex:none;padding:0;transition:transform .12s}
    #cs-mod .tpl-color-sw-btn:hover{transform:scale(1.15)}
    #cs-mod .cs-tpl-body-preview{font-size:13px;line-height:1.5;color:#5b5249;background:var(--cat-bg,var(--canvas));border-radius:9px;padding:11px 12px;min-height:64px;max-height:120px;overflow:hidden;white-space:pre-wrap;flex:1}
    #cs-mod .cs-tpl-card textarea.cs-tpl-body {
        width: 100%;
        min-height: 200px;
        box-sizing: border-box;
        resize: none;
        overflow: hidden;
        flex: 1 1 auto;
        display: block;
        padding: 12px;
        border: 1px solid #E6DED0;
        border-radius: 8px;
        font-family: inherit;
        font-size: 14.5px;
        outline: none;
    }
    #cs-mod .cs-tpl-card textarea.cs-tpl-body:focus{border-color:var(--cat-a,#E8722B);box-shadow:0 0 0 3px color-mix(in srgb, var(--cat-a,#E8722B) 14%, transparent);background:#fff}
    #cs-mod .cs-tpl-body-lg{min-height:380px;font-size:15px;line-height:1.7;padding:18px 20px;border-radius:12px;flex:1}
    #cs-mod .cs-tpl-card-foot{display:flex;align-items:center;gap:8px;padding-top:12px;margin-top:auto;border-top:1px dashed #ECE2D2;flex-wrap:wrap}
    #cs-mod .cs-tpl-card-foot .cs-tpl-save{font-family:inherit;font-size:12px;font-weight:700;padding:7px 13px;border:none;border-radius:8px;background:linear-gradient(135deg,var(--cat-b,#F3992E),var(--cat-a,#E8722B));color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
    #cs-mod .cs-tpl-card-foot .cs-tpl-dup{font-family:inherit;font-size:12px;font-weight:600;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:none;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:4px}
    #cs-mod .cs-tpl-card-foot .cs-tpl-dup:hover{background:#fff;color:#5b5249}
    #cs-mod .cs-tpl-card-foot .cs-tpl-del{font-family:inherit;font-size:12px;font-weight:600;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:none;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:4px;margin-left:auto}
    #cs-mod .cs-tpl-card-foot .cs-tpl-del:hover{background:#FCEBEB;border-color:#F09595;color:#A32D2D}
    #cs-mod .cs-tpl-add{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:13.5px;font-weight:600;padding:10px 18px;border:1.5px dashed #D9C8B0;border-radius:12px;background:transparent;color:#9b8e7d;cursor:pointer;transition:border-color .12s,color .12s;margin-top:6px}
    #cs-mod .cs-tpl-add:hover{border-color:#E8722B;color:#9A4A2B}

    /* ---- live preview panel ---- */
    #cs-mod .cs-tpl-preview{width:var(--tpl-preview-w,320px);flex:none;border-left:1px solid var(--line);background:var(--surface);padding:24px 22px;overflow-y:auto;position:relative}
    #cs-mod .cs-tpl-preview-resize{position:absolute;top:0;left:0;bottom:0;width:5px;cursor:col-resize;z-index:5;touch-action:none}
    #cs-mod .cs-tpl-preview-resize::after{content:'';position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--line);transform:translateX(-50%);transition:background-color .12s,width .12s}
    #cs-mod .cs-tpl-preview-resize:hover::after,#cs-mod .cs-tpl-preview-resize.dragging::after{background:#E8722B;width:2px}
    @media(max-width:980px){#cs-mod .cs-tpl-preview{display:none}}
    #cs-mod .cs-tpl-preview-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--soft);font-size:13px;text-align:center}
    #cs-mod .cs-tpl-preview-empty i{font-size:28px;opacity:.5}
    #cs-mod .cs-tpl-preview-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
    #cs-mod .cs-tpl-preview-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--soft)}
    #cs-mod .cs-tpl-preview-hd i.fav{color:#E8A23A;font-size:14px}
    #cs-mod .cs-tpl-preview-title{font-family:var(--disp,'Fraunces'),serif;font-size:18px;font-weight:600;color:#2B2017;line-height:1.3}
    #cs-mod .cs-tpl-preview-cat{font-size:11.5px;color:var(--muted);margin:3px 0 14px}
    #cs-mod .cs-tpl-preview-body{background:#FFF6EC;border:1px solid #F3D9B8;border-radius:12px;padding:14px;font-size:13.5px;line-height:1.55;color:#3a2f22;white-space:pre-wrap;margin-bottom:16px;position:relative}
    #cs-mod .cs-tpl-preview-body::before{content:'Customer will see';position:absolute;top:-9px;left:10px;background:#FFF6EC;padding:0 6px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#B5790F}
    #cs-mod .cs-tpl-preview-placeholders{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    #cs-mod .cs-tpl-preview-placeholders .ph-lbl{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);width:100%;margin-bottom:2px}
    #cs-mod .cs-tpl-preview-placeholders code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;background:var(--canvas);border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:#9A4A2B}
    #cs-mod .cs-tpl-preview-placeholders .none{font-size:12px;color:var(--soft);font-style:italic}

    /* ---------- modal layouts ---------- */
    #cs-mod .cs-modal-bg{position:fixed;inset:0;background:rgba(43,32,23,.45);z-index:60;display:none;align-items:center;justify-content:center;padding:20px}
    #cs-mod .cs-modal-bg.show{display:flex}
    #cs-mod .cs-modal{background:var(--surface);border-radius:16px;padding:20px;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(36,31,27,.2)}
    #cs-mod .cs-modal h3{margin:0 0 12px;font-size:18px}
    #cs-mod .cs-modal select{width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;font-family:inherit;font-size:14px;margin-bottom:14px}
    #cs-mod .cs-modal-foot{display:flex;justify-content:flex-end;gap:8px}

    #cs-mod .cs-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2B2017;color:#fff;font-size:13.5px;padding:10px 16px;border-radius:10px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:80}
    #cs-mod .cs-toast.show{opacity:1}
    #cs-mod .cs-loading{padding:24px;text-align:center;color:var(--muted);font-size:14px}
    #cs-mod ::-webkit-scrollbar{width:9px;height:9px}
    #cs-mod ::-webkit-scrollbar-thumb{background:#E3D8C5;border-radius:6px}
    #cs-mod ::-webkit-scrollbar-track{background:transparent}
    
    .cs-panel-toggle {
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        user-select: none;
        padding-bottom: 5px;
    }
    .toggle-icon { transition: transform 0.3s; }
    .cs-panel-toggle.collapsed .toggle-icon { transform: rotate(-90deg); }

    /* ---------- popovers ---------- */
    .cs-color-pop{position:absolute;z-index:9999;background:#fff;border:1px solid #E6DED0;border-radius:12px;box-shadow:0 14px 34px rgba(58,40,24,.18);padding:12px;width:200px;font-family:inherit}
    .cs-color-pop-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}
    .cs-color-sw{width:18px;height:18px;border-radius:50%;border:1.5px solid rgba(0,0,0,.08);cursor:pointer;padding:0;position:relative;transition:transform .1s}
    .cs-color-sw:hover{transform:scale(1.18)}
    .cs-color-sw.on{box-shadow:0 0 0 2px #fff,0 0 0 3.5px #2B2017}
    .cs-color-pop-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid #F0E8DA}
    .cs-color-custom{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#5b5249;cursor:pointer}
    .cs-color-custom input[type="color"]{width:22px;height:22px;border:1.5px solid #E6DED0;border-radius:50%;padding:0;cursor:pointer;background:none}
    .cs-color-custom input[type="color"]::-webkit-color-swatch-wrapper{padding:0;border-radius:50%}
    .cs-color-custom input[type="color"]::-webkit-color-swatch{border:none;border-radius:50%}
    .cs-color-reset{font-family:inherit;font-size:11.5px;font-weight:600;color:var(--soft,#9b8e7d);border:none;background:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:2px}
    .cs-color-reset:hover{color:#9A4A2B}
  </style>

  <div class="cswrap">
    <nav class="cs-nav" id="csNav">
      <div class="cs-nav-brand"><span class="dot"></span>CS</div>

      <div class="cs-nav-section">Queue</div>
      <button type="button" class="cs-nav-item" data-view="all_tickets"><i class="ti ti-apps"></i> All Work <span class="cnt" id="csCntAll">0</span></button>
      <button type="button" class="cs-nav-item on" data-view="my-work"><i class="ti ti-inbox"></i> My Work <span class="cnt" id="csCntMine">0</span></button>
      <button type="button" class="cs-nav-item" data-view="unassigned"><i class="ti ti-inbox-off"></i> Unassigned <span class="cnt" id="csCntUnassigned">0</span></button>

      <div class="cs-nav-section" style="margin-top:10px">By status</div>
      <div id="csStatusNavList"></div>
      <div class="cs-status-create">
        <div class="cs-status-create-row">
          <input type="text" id="csNewStatusInput" placeholder="New status…">
          <button type="button" id="csNewStatusAdd" title="Create status"><i class="ti ti-plus"></i></button>
        </div>
      </div>

      <div class="cs-nav-section" style="margin-top:10px">Settings</div>
      <button type="button" class="cs-nav-item" data-view="templates" id="csNavTemplates" style="display:none"><i class="ti ti-template"></i> Templates</button>
      <button type="button" class="cs-nav-item" id="csNavEmployees"><i class="ti ti-users"></i> Employees</button>
      <button type="button" class="cs-nav-item" id="csNavQueueRouting" style="display:none"><i class="ti ti-route"></i> Queue Routing</button>
      <div id="csEmployeeSubPanel" style="display:none;padding:4px 0 8px">
        <div style="padding:0 8px 6px"><input type="text" id="csEmployeeSearch" placeholder="Filter employees…" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-family:inherit;font-size:12px;outline:none;background:#fff"></div>
        <div style="padding:0 4px 4px;display:flex;gap:4px;flex-wrap:wrap">
          <button type="button" class="cs-emp-filter-btn on" data-emp-filter="all">All</button>
          <button type="button" class="cs-emp-filter-btn" data-emp-filter="online">Online</button>
          <button type="button" class="cs-emp-filter-btn" data-emp-filter="offline">Offline</button>
        </div>
        <div id="csEmployeeList"></div>
      </div>

      <div class="cs-nav-sp"></div>
      <div class="cs-presence-mini" id="csPresenceMini">
        <p class="ph">Team members</p>
        <div id="csPresenceMiniList"></div>
      </div>
    </nav>

    <section class="cs-list" id="csListPane">
      <div class="cs-list-resize" id="csListResize" title="Drag to resize"></div>
      <div class="cs-list-hd">
        <div style="min-width:0">
          <h2 id="csListTitle">My Work</h2>
          <div class="cs-list-sub" id="csListSub">Your assigned cases</div>
        </div>
        <div class="cs-list-hd-sp"></div>
        <div class="cs-sort-dropdown-wrap" id="csSortDropdownWrap">
          <button type="button" class="cs-sort-dd-btn" id="csSortDdBtn">
            <span class="pip"></span><span id="csSortDdLabel">Live</span><i class="ti ti-chevron-down" style="font-size:12px;margin-left:2px"></i>
          </button>
          <div class="cs-sort-dd-menu" id="csSortDdMenu">
            <button type="button" class="cs-sort-dd-item on" data-sort="live"><span class="pip"></span>Live</button>
            <button type="button" class="cs-sort-dd-item" data-sort="newest"><i class="ti ti-arrow-up"></i>Newest</button>
            <button type="button" class="cs-sort-dd-item" data-sort="oldest"><i class="ti ti-arrow-down"></i>Oldest</button>
            <div class="cs-sort-dd-sep"></div>
            <button type="button" class="cs-sort-dd-item" data-sort="employee"><i class="ti ti-users"></i>Employee</button>
            <button type="button" class="cs-sort-dd-item" data-sort="status"><i class="ti ti-tag"></i>Status</button>
          </div>
          <div class="cs-sort-subpanel" id="csSortEmpPanel" style="display:none">
            <input type="text" id="csSortEmpSearch" class="cs-sort-subpanel-search" placeholder="Search employee…">
            <div id="csSortEmpList"></div>
          </div>
          <div class="cs-sort-subpanel" id="csSortStatusPanel" style="display:none">
            <div id="csSortStatusList"></div>
          </div>
        </div>
      </div>
      <div class="cs-chips" id="csChips">
        <button type="button" class="cs-chip on" data-filter="all">All</button>
        <button type="button" class="cs-chip" data-filter="returns">Returns</button>
        <button type="button" class="cs-chip" data-filter="item_not_received">Item not received</button>
        <button type="button" class="cs-chip" data-filter="claims">Claims</button>
        <button type="button" class="cs-chip" data-filter="unsorted">Unsorted</button>
        <button type="button" class="cs-chip cs-chip-new-queue" data-filter="new_queue" id="csNewQueueChip" title="Reassign miscategorised tickets to the correct queue"><i class="ti ti-arrow-fork" style="font-size:11px"></i> New Queue</button>
      </div>
      <div class="cs-rows" id="csRows"><div class="cs-loading">Loading queue…</div></div>
    </section>

    <section class="cs-work" id="csWorkPane">
      <div class="cs-empty" id="csEmpty"><i class="ti ti-headset"></i>Select a case from the queue to open the workspace.</div>
      <div class="cs-case" id="csCase">
        <header class="cs-case-hd">
          <div style="min-width:0;flex:1">
            <h2 id="csCaseTitle">—</h2>
            <div class="cs-case-meta">
              <span id="csCaseMeta"></span>
              <span id="csCaseAssignee"></span>
              <span class="cs-case-sla off" id="csCaseSla">SLA paused</span>
            </div>
          </div>
          <div class="cs-case-hd-right">
            <div class="cs-case-badges" id="csCaseBadges"></div>
            <div class="cs-case-actions">
              <select class="cs-status-sel" id="csStatusSel" title="Ticket status"></select>
              <button type="button" class="cs-reassign" id="csReassign" title="Requires assign permission"><i class="ti ti-user-share"></i> Reassign</button>
            </div>
          </div>
        </header>
        <div class="cs-body">
          <div class="cs-thread-col">
            <div class="cs-mid-tabbar" id="csMidTabbar">
              <button type="button" class="cs-mid-tab on" data-midtab="reply"><i class="ti ti-message"></i> Reply</button>
              <button type="button" class="cs-mid-tab" data-midtab="notes"><i class="ti ti-note"></i> Internal Notes <span class="badge" id="csNoteCountBadge">0</span></button>
            </div>

            <div class="cs-mid-pane show" id="csMidReply">
              <div class="cs-thread" id="csThread"></div>
              <form class="cs-compose" id="csCompose">
                <div class="cs-undo-toast" id="csUndoToast">
                  <div class="ring" id="csUndoRing" data-s="10"></div>
                  <div class="msg">Sending reply to <b id="csUndoName">customer</b>…</div>
                  <button type="button" class="cs-undo-btn" id="csUndoBtn">Undo</button>
                </div>
                <div class="cs-conflict-banner" id="csConflictBanner"><i class="ti ti-alert-triangle"></i><span id="csConflictText"></span></div>
                <div class="cs-tpl-menu" id="csSlashMenu" style="left:0;right:auto">
                  <div class="cs-tpl-list" id="csSlashList"></div>
                </div>
                <div class="cs-compose-inner">
                  <div class="cs-compose-textarea-wrap">
                    <textarea id="csReply" placeholder="Write your reply to the customer… (type / for templates)" rows="3"></textarea>
                    <div id="csReplyPendingAtts" class="cs-reply-pending-atts" style="display:none"></div>
                    <div class="cs-reply-toolbar" style="position:relative">
                      <button type="button" class="cs-reply-tool-btn" id="csReplyEmojiBtn" title="Insert emoji"><i class="ti ti-mood-smile"></i></button>
                      <button type="button" class="cs-reply-tool-btn" id="csReplyImageBtn" title="Attach image"><i class="ti ti-photo"></i></button>
                      <button type="button" class="cs-reply-tool-btn" id="csReplyFileBtn" title="Attach file"><i class="ti ti-paperclip"></i></button>
                      <div class="cs-emoji-picker" id="csEmojiPicker">
                        <input type="text" class="cs-emoji-picker-search" id="csEmojiSearch" placeholder="Search emoji…">
                        <div id="csEmojiGrid" class="cs-emoji-grid"></div>
                      </div>
                    </div>
                    <div class="cs-kbd-hint">Type <kbd>/</kbd> to search templates · <kbd>↑</kbd><kbd>↓</kbd> to navigate · <kbd>Enter</kbd> to insert</div>
                    <div class="cs-compose-foot">
                      <div class="cs-compose-tools">
                        <button type="button" class="cs-btn-ghost" id="csInsertTpl"><i class="ti ti-template"></i> Insert template</button>
                        <div class="cs-tpl-menu" id="csTplMenu">
                          <input type="text" class="cs-tpl-search" id="csTplSearch" placeholder="Search templates…">
                          <div class="cs-tpl-list" id="csTplList"></div>
                        </div>
                      </div>
                      <button type="submit" class="cs-btn-send" id="csSendBtn"><i class="ti ti-send"></i> Send reply</button>
                    </div>
                  </div>
                  <div class="cs-tpl-live-preview" id="csTplLivePreview">
                    <div class="plv-label">Template Preview</div>
                    <div class="plv-title" id="csTplLiveName"></div>
                    <div class="plv-body" id="csTplLiveBody"></div>
                    <button type="button" class="plv-insert" id="csTplLiveInsert"><i class="ti ti-corner-down-left"></i> Insert</button>
                  </div>
                </div>
              </form>
            </div>

            <div class="cs-mid-pane cs-mid-notes" id="csMidNotes">
              <div class="cs-pnote-sub team"><i class="ti ti-users"></i> Visible to your whole team — never shown to the customer.</div>
              <div class="cs-note-list" id="csTeamNoteList"></div>
              <div class="cs-note-compose" id="csNoteCompose">
                <div class="cs-mention-menu" id="csMentionMenu"></div>
                <textarea id="csNoteInput" placeholder="Add a team note… type @ to mention a teammate"></textarea>
                <div class="cs-note-pending-atts" id="csNotePendingAtts"></div>
                <div class="cs-note-foot">
                  <span class="cs-mention-hint" id="csMentionHint">Visible to all agents on this team</span>
                  <button type="button" class="cs-btn-ghost" id="csNoteAttach"><i class="ti ti-photo"></i></button>
                  <button type="button" class="cs-btn-ghost" id="csNoteSave">Add note</button>
                </div>
              </div>
            </div>
          </div>

          <div class="cs-resize-handle" id="csResizeRight" title="Drag to resize"></div>

          <aside class="cs-side" id="csSidePanel">
            <div class="cs-panel" id="csPresencePanel">
              <h3><i class="ti ti-eye"></i> On this ticket</h3>
              <div id="csPresencePanelBody"></div>
            </div>
            <div class="cs-panel">
              <h3 class="cs-panel-toggle">
                <i class="ti ti-info-circle"></i> Case details 
                <i class="ti ti-chevron-down toggle-icon"></i>
              </h3>
              <div class="cs-panel-content" id="csDetailsContent">
                <div id="csDetails"></div>
              </div>
            </div>

            <div class="cs-panel" id="csOrderPanel">
              <h3 class="cs-panel-toggle">
                <i class="ti ti-package"></i> Linnworks order 
                <i class="ti ti-chevron-down toggle-icon"></i>
              </h3>
              <div class="cs-panel-content" id="csOrderBody"></div>
            </div>
            <div class="cs-panel" id="csOrderHistoryPanel" style="display:none">
              <h3 class="cs-panel-toggle">
                <i class="ti ti-history"></i> Customer order history
                <i class="ti ti-chevron-down toggle-icon"></i>
              </h3>
              <div class="cs-panel-content" id="csOrderHistoryBody"></div>
            </div>
            <div class="cs-panel cs-pnote-panel" id="csPersonalNotePanel">
              <h3><i class="ti ti-lock"></i> Personal Note</h3>
              <div class="cs-pnote-sub"><i class="ti ti-eye-off"></i> Private — only you can see this note.</div>
              <div id="csPersonalNoteBody"></div>
            </div>
            
            <div class="cs-panel" id="csAuditPanel">
              <h3><i class="ti ti-history"></i> Assignment log</h3>
              <div id="csAuditLog"></div>
            </div>
          </aside>
        </div>
      </div>

      <div class="cs-tpl-view" id="csTplView">
        <div class="cs-tpl-view-hd">
          <div style="flex:1;min-width:200px">
            <h2>Response templates</h2>
            <p>Saved replies agents can insert when responding to customers. <kbd style="font-family:'JetBrains Mono',monospace;background:var(--canvas);border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:11px">Esc</kbd> to close.</p>
          </div>
          <input type="text" class="cs-tpl-view-search" id="csTplViewSearch" placeholder="Search by title or body…">
        </div>
        <div class="cs-tpl-toolbar" id="csTplCatBar"></div>
        <div class="cs-tpl-main">
          <div class="cs-tpl-body-scroll">
            <div class="cs-tpl-grid" id="csTplGrid"></div>
            <button type="button" class="cs-tpl-add" id="csTplAdd"><i class="ti ti-plus"></i> New template</button>
          </div>
          <aside class="cs-tpl-preview" id="csTplPreview"><div class="cs-tpl-preview-resize" id="csTplPreviewResize" title="Drag to resize"></div></aside>
        </div>
      </div>
    </section>
  </div>

  <div class="cs-modal-bg" id="csAssignModal">
    <div class="cs-modal">
      <h3>Assign ticket</h3>
      <p style="font-size:14px;color:var(--muted);margin:0 0 12px">Choose an agent to assign this ticket to.</p>
      <select id="csAssignSelect"></select>
      <div class="cs-modal-foot">
        <button type="button" class="cs-btn-ghost" id="csAssignCancel">Cancel</button>
        <button type="button" class="cs-btn-send" id="csAssignConfirm">Confirm</button>
      </div>
    </div>
  </div>
  <div class="cs-modal-bg" id="csRequeueModal">
    <div class="cs-modal">
      <h3>Move to New Queue</h3>
      <p style="font-size:14px;color:var(--muted);margin:0 0 12px">Reassign this ticket to the correct category if it was miscategorised.</p>
      <label style="font-size:13px;font-weight:600;margin-bottom:6px;display:block">New category</label>
      <select id="csRequeueSelect">
        <option value="returns">Returns</option>
        <option value="item_not_received">Item not received</option>
        <option value="claims">Claims</option>
        <option value="unsorted">Unsorted</option>
      </select>
      <div class="cs-modal-foot">
        <button type="button" class="cs-btn-ghost" id="csRequeueCancel">Cancel</button>
        <button type="button" class="cs-btn-send" id="csRequeueConfirm">Move ticket</button>
      </div>
    </div>
  </div>
  <!-- Queue Routing Modal (Team Lead only) -->
  <div class="cs-modal-bg" id="csQueueRoutingModal">
    <div class="cs-modal" style="min-width:420px;max-width:520px">
      <h3 style="display:flex;align-items:center;gap:8px"><i class="ti ti-route" style="font-size:18px;color:#E8722B"></i> Queue Routing Rules</h3>
      <p style="font-size:13px;color:var(--muted);margin:0 0 16px">New tickets in each queue will be automatically assigned to the selected agent. Existing tickets are not affected.</p>
      <div id="csQueueRoutingBody" style="display:flex;flex-direction:column;gap:10px"></div>
      <div class="cs-modal-foot" style="margin-top:18px">
        <button type="button" class="cs-btn-ghost" id="csQueueRoutingCancel">Cancel</button>
        <button type="button" class="cs-btn-send" id="csQueueRoutingSave">Save Rules</button>
      </div>
    </div>
  </div>
  <input type="file" id="csReplyImageFile" accept="image/*" multiple style="display:none">
  <input type="file" id="csReplyFileInput" multiple style="display:none">
  <input type="file" id="csNoteFile" accept="image/*" multiple style="display:none">
  <input type="file" id="csPersonalNoteFile" accept="image/*" style="display:none">
  <div class="cs-toast" id="csToast"></div>
  <div class="cs-lightbox" id="csLightbox">
    <button class="cs-lightbox-close" id="csLightboxClose" title="Close"><i class="ti ti-x"></i></button>
    <img id="csLightboxImg" src="" alt="Full size preview">
  </div>
</div>`;
  },

  async mount(el) {
    const mod = this;
    const $ = (s) => el.querySelector(s);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || ('status_' + Date.now());
    // -----------------------------------------------------------------
    // Single source of truth for ticket statuses. Sidebar folders, the
    // status dropdown, row badges, and "create new status" all read and
    // write this one array — there is exactly one code path for each.
    // -----------------------------------------------------------------
    
   
const panels = el.querySelectorAll('.cs-panel-toggle');
panels.forEach(header => {
  header.addEventListener('click', function() {
    const content = this.nextElementSibling;
    this.classList.toggle('collapsed');
    
    // Smooth display toggle transition
    if (this.classList.contains('collapsed')) {
      content.style.display = 'none';
    } else {
      content.style.display = 'block';
    }
  });
});
    const STATUS_COLOR_CYCLE = ['#0F6E56', '#B56D1D', '#1A4FB5', '#A32D2D', '#8A6A1E', '#6B6B66', '#9A4A2B', '#534AB7'];
    let STATUSES = [
      { key: 'new_ticket', label: 'New Ticket', color: '#E8722B', icon: 'ti-circle-dot' },
      { key: 'awaiting_reply', label: 'Awaiting Reply', color: '#B56D1D', icon: 'ti-clock-hour-4' },
      { key: 'to_do', label: 'To Do', color: '#1A4FB5', icon: 'ti-circle-check' },
      { key: 'replacement', label: 'Replacement', color: '#9A4A2B', icon: 'ti-package' },
      { key: 'refund', label: 'Refund', color: '#8A6A1E', icon: 'ti-receipt-refund' },
      { key: 'resolved', label: 'Resolved', color: '#34B27B', icon: 'ti-circle-check-filled' },
    ];
    function statusByKey(key) { return STATUSES.find((s) => s.key === key); }
    function statusLabel(key) { const s = statusByKey(key); return s ? s.label : key; }
    function statusColor(key) { const s = statusByKey(key); return s ? s.color : '#9b8e7d'; }
    function applyStatusColor(selector, key) {
      const el2 = typeof selector === 'string' ? el.querySelector(selector) : selector;
      if (!el2) return;
      if (!key || key === '__new__') return; // don't colour the placeholder option
      const color = statusColor(key); // Fetch color from STATUSES array
      el2.style.setProperty('background-color', color, 'important');
      el2.style.setProperty('color', '#ffffff', 'important');
      el2.style.setProperty('border', 'none', 'important');
    }

    const FILTER_LABELS = { returns: 'Returns', item_not_received: 'Item not received', claims: 'Claims', unsorted: 'Unsorted', new_queue: 'New Queue' };
    const PLATFORM_LABELS = { amazon: 'Amazon', ebay: 'eBay', shopify: 'Shopify', walmart: 'Walmart' };
    const SLA_SOON_MS = 4 * 3600000;
    const SLA_URGENT_MS = 3600000;

    let bootstrap = { user: { id: 0, name: 'You' }, permissions: { assign: false, templates: false, manageNotes: false }, agents: [] };
    let useApi = false;
    let queueView = 'my-work';   // 'my-work' | 'unassigned' | 'status:<key>'
    let queue = [];
    let filter = 'all';
    let sortOrder = 'live'; // 'live' | 'oldest' | 'newest'
    let selectedId = null;
    let templates = []; // { id, title, body, category, favorite }
    // Queue Routing: { returns: agentId|null, item_not_received: agentId|null, claims: agentId|null, unsorted: agentId|null }
    let queueRouting = { returns: null, item_not_received: null, claims: null, unsorted: null };
    let categories = ['General'];
    let tplCat = 'all'; // 'all' | 'favorites' | 'recent' | category name
    let selectedTplId = null; // template currently shown in the live preview pane
    let notePendingAttachments = [];
    let replyPendingAttachments = []; // files/images queued for the reply compose box
    let editingNoteId = null;
    let tickTimer = null;
    let slaTimer = null;
    let presenceTimer = null;
    let orderCaseTimer = null;
    let undoTimer = null;
    let undoInterval = null;
    let pendingReply = null;
    let localStore = {};
    let pendingOpenId = null;
    let unreadIds = new Set();
    let personalNoteSaveTimer = null;
    let personalNoteDirty = false;
    let recentTemplateIds = []; // most-recently-used template ids, newest first
    let lastCaseData = null;
    let slashActive = false;
    let slashStart = -1;
    let slashHighlight = 0;
    let currentStatusFilter = 'all'; // 'all' means no status restriction
let currentEmployeeFilter = 'all';      // Default 'all' ya specific employee id/name
let currentChipFilter = 'all';
    const hashMatch = (location.hash || '').replace(/^#/, '').match(/^cs\/(\d+)/);
    if (hashMatch) pendingOpenId = hashMatch[1];

    function hoursFromNow(h) { return new Date(Date.now() + h * 3600000).toISOString(); }

    // -----------------------------------------------------------------------
    // Order case indicators. Each entry describes one badge variant the
    // header can show. In a real deployment these would be detected by
    // listening for webhooks/events from Amazon, Lobby, the INR system,
    // chargeback feeds, etc. Here that detection is simulated by
    // orderCasesByTicket + a polling timer (see wireOrderCaseSimulation).
    // -----------------------------------------------------------------------
    const ORDER_CASE_TYPES = {
      return_request: { label: 'Return Request', cls: 'return', icon: 'ti-rotate-2' },
      inr: { label: 'INR Request', cls: 'inr', icon: 'ti-package-off' },
      a2z_claim: { label: 'A-to-Z Claim', cls: 'a2z', icon: 'ti-shield-exclamation' },
      chargeback: { label: 'Chargeback', cls: 'chargeback', icon: 'ti-credit-card-off' },
      replacement_request: { label: 'Replacement Request', cls: 'replacement', icon: 'ti-replace' },
    };
    function caseTypeInfo(key) { return ORDER_CASE_TYPES[key] || { label: key, cls: 'other', icon: 'ti-alert-circle' }; }

    // ticketId -> array of { id, type, openedAt } for cases still active (unresolved).
    let orderCasesByTicket = {};
   function filterAndRenderTickets(allTickets) {
    // Evaluate all three properties together (AND condition cross-filtering)
    const filteredTickets = allTickets.filter(ticket => {
        // 1. Status Filter Constraint Check
        let matchesStatus = true;
        if (currentStatusFilter !== 'all') {
            matchesStatus = (ticket.status === currentStatusFilter);
        }

        // 2. Employee Assignment Filter Constraint Check (Sanket ID or String value match)
        let matchesEmployee = true;
        if (currentEmployeeFilter !== 'all') {
            const ticketAssignee = String(ticket.assigneeId || ticket.assignee_id || '');
            matchesEmployee = (ticketAssignee === String(currentEmployeeFilter));
        }

        // 3. Category/Queue Filter Chip Check
        let matchesChip = true;
        if (currentChipFilter !== 'all') {
            matchesChip = (ticket.category === currentChipFilter);
        }

        // Only show ticket in the grid when all three filters are concurrently true
        return matchesStatus && matchesEmployee && matchesChip;
    });

    // Modified rows render block execution
    queue = filteredTickets;
    renderQueue();
}

    function seedOrderCases() {
      orderCasesByTicket = {
        '1': [{ id: 'oc-1', type: 'return_request', openedAt: new Date(Date.now() - 2 * 3600000).toISOString() }],
        '6': [{ id: 'oc-2', type: 'chargeback', openedAt: new Date(Date.now() - 5 * 3600000).toISOString() }],
      };
    }

    const SAMPLE_QUEUE = [
      { id: '1', customer: 'Emma Richardson', subject: 'Return label not received', snippet: "Hi, I requested a return 3 days ago but haven't got the label yet…", category: 'returns', platform: 'amazon', status: 'awaiting_reply', caseRef: 'AMZ-88421', matched: true, assigneeId: 1, slaDueAt: hoursFromNow(5.5), isNew: false },
      { id: '2', customer: "James O'Connor", subject: 'Parcel marked delivered — not here', snippet: 'Tracking says delivered yesterday but nothing on my doorstep.', category: 'item_not_received', platform: 'ebay', status: 'to_do', caseRef: 'EBY-55201', matched: true, assigneeId: 1, slaDueAt: hoursFromNow(1.2), isNew: true },
      { id: '3', customer: 'Priya Shah', subject: 'Damaged item — claim photos attached', snippet: 'The box was crushed and the product is unusable.', category: 'claims', platform: 'shopify', status: 'new_ticket', caseRef: 'SHP-33109', matched: true, assigneeId: 1, slaDueAt: hoursFromNow(18), isNew: false },
      { id: '4', customer: 'Michael Brooks', subject: 'Wrong size sent', snippet: 'Ordered medium, received large. Can I swap?', category: 'returns', platform: 'shopify', status: 'replacement', caseRef: 'SHP-33144', matched: true, assigneeId: 1, slaDueAt: null, isNew: false },
      { id: '5', customer: 'Unknown sender', subject: 'Question about order', snippet: 'Can someone call me about my order please?', category: 'unsorted', platform: 'amazon', status: 'new_ticket', caseRef: 'AMZ-88502', matched: false, assigneeId: null, slaDueAt: hoursFromNow(24), isNew: false },
      { id: '6', customer: 'Lisa Chen', subject: 'Refund status update', snippet: 'Return received at warehouse — when will refund hit?', category: 'claims', platform: 'ebay', status: 'refund', caseRef: 'EBY-55288', matched: true, assigneeId: 1, slaDueAt: hoursFromNow(3.8), isNew: false },
    ];

    const SAMPLE_TEAM = [
      { id: 2, name: 'Tasha Klein' },
      { id: 3, name: 'Marcus Idowu' },
      { id: 4, name: 'Sofia Reyes' },
    ];

    // -----------------------------------------------------------------------
    // Customer order history: when a customer's email has placed more than
    // one order — possibly across different sales channels — agents see a
    // panel listing every order so they don't have to leave the ticket to
    // check Amazon/Shopify/eBay/Walmart separately. This module has no real
    // order database wired in, so this is sample data; in production this
    // would come from an order-lookup endpoint keyed by customer email.
    // -----------------------------------------------------------------------
    const ORDER_HISTORY_BY_EMAIL = {
      'emma.richardson@example.com': [
        { orderId: 'AMZ-88421', channel: 'amazon', status: 'Dispatched', date: '2026-06-18' },
        { orderId: 'AMZ-81920', channel: 'amazon', status: 'Delivered', date: '2026-04-02' },
        { orderId: 'SHP-29104', channel: 'shopify', status: 'Delivered', date: '2026-01-22' },
        { orderId: 'WMT-40217', channel: 'walmart', status: 'Delivered', date: '2025-12-05' },
        { orderId: 'EBY-50213', channel: 'ebay', status: 'Refunded', date: '2025-11-09' },
      ],
    };
    async function fetchOrderHistory(email) {
      if (!email) return [];
      if (useApi) {
        try { const r = await api('/customers/' + encodeURIComponent(email) + '/orders'); return r.orders || []; }
        catch (e) { return []; }
      }
      return ORDER_HISTORY_BY_EMAIL[String(email).toLowerCase()] || [];
    }
    function orderHistoryRowHtml(o) {
      const plat = PLATFORM_LABELS[o.channel] || o.channel;
      return `<div class="cs-ohist-row">
        <div class="cs-ohist-row-top">
          <span class="cs-badge ${esc(o.channel)}">${esc(plat)}</span>
          <span class="cs-ohist-id">${esc(o.orderId)}</span>
        </div>
        <div class="cs-ohist-row-bottom">
          <span class="cs-ohist-status">${esc(o.status)}</span>
          <span class="cs-ohist-date">${esc(o.date)}</span>
        </div>
      </div>`;
    }
    async function renderOrderHistory(order) {
      const panel = $('#csOrderHistoryPanel');
      const body = $('#csOrderHistoryBody');
      if (!panel || !body) return;
      const email = order && order.email;
      const orders = await fetchOrderHistory(email);
      // Only show the panel when there's genuinely more than one order on
      // file for this email — a single order is just "the order", not history.
      if (!email || orders.length <= 1) { panel.style.display = 'none'; return; }
      panel.style.display = '';
      body.innerHTML = `<div class="cs-ohist-email"><i class="ti ti-mail"></i> ${esc(email)} · ${orders.length} orders</div>` + orders.map(orderHistoryRowHtml).join('');
    }

    // =========================================================================
  // 🎯 FIXED: NEW STATUS ADDITION (+) ENGINE (EXACT HTML ID MATCH)
  // =========================================================================
 // =========================================================================
  // 🎯 FIXED: LEFT SIDE SUB-SECTION PLUS ICONS DIRECT WIRETAP
  // =========================================================================
  function setupStatusControls() {
    const inputEl = $('#csNewStatusInput');
    const addBtn = $('#csNewStatusAdd'); // Main plus button below

    if (!inputEl) return;

    // A. Existing handler for the main button below
    if (addBtn) {
      const cleanBtn = addBtn.cloneNode(true);
      addBtn.replaceWith(cleanBtn);
      cleanBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleStatusAdditionWorkflow(inputEl);
      });
    }

    // B. INPUT BOX PAR ENTER KEY PRESS HANDLER
    const cleanInput = inputEl.cloneNode(true);
    inputEl.replaceWith(cleanInput);
    cleanInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        await handleStatusAdditionWorkflow(cleanInput);
      }
    });

    // 🟢 C. Wire '+' icons on left sidebar section headers for focus
    // This selector targets the plus icons next to the left sidebar headers
    const leftHeaderPlusIcons = el.querySelectorAll('.cs-nav-section i.ti-plus, .cs-nav-section + i, .cs-nav-section i[title*="Add"]');
    
    leftHeaderPlusIcons.forEach(icon => {
      // Apply pointer cursor to signal clickability
      icon.style.cursor = 'pointer';
      
      icon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Give the status input box below a visual highlight and focus
        const activeInput = document.getElementById('csNewStatusInput');
        if (activeInput) {
          activeInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          activeInput.focus();
          // Apply a temporary outline blink effect on the input field for user feedback
          activeInput.style.outline = '2px solid var(--orange, #E8722B)';
          setTimeout(() => { activeInput.style.outline = 'none'; }, 1200);
        }
      });
    });
  }

  // CORE LOGIC FLOW FOR ADDING AND SAVING THE NEW STATUS
  async function handleStatusAdditionWorkflow(inputElement) {
    const rawVal = (inputElement.value || '').trim();
    if (!rawVal) {
      inputElement.focus();
      return;
    }

    // Database safe uniform snake_case key banayein (e.g., "In Progress" -> "in_progress")
    const generatedKey = rawVal.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');

    if (!generatedKey) {
      showToast('Invalid character keys in status name.');
      return;
    }

    // Dynamic cache array duplicates check
    const exists = cache.statuses && cache.statuses.some(x => x.key === generatedKey);
    if (exists) {
      showToast('This status channel already exists.');
      inputElement.value = '';
      return;
    }

    try {
      // API request parameter push trigger
      const response = await fetch('/api/cs/statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: generatedKey, label: rawVal, color: '#9b8e7d' }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Server validation rejected.');
      }

      // Local runtime configuration array synchronize state update
      if (!cache.statuses) cache.statuses = [];
      cache.statuses.push({ key: generatedKey, label: rawVal, color: '#9b8e7d', count: 0 });

      // Clean stream UI elements feedback
      inputElement.value = '';
      
      // Sidebar "By status" list container refresh mapping execution
      if (typeof renderStatuses === 'function') {
        renderStatuses();
      }
      
      showToast(`Status "${rawVal}" added successfully!`);

    } catch (err) {
      console.error('[handleStatusAdditionWorkflow]', err);
      showToast('Error saving status: ' + err.message);
    }
  }
  function renderStatuses() {
    const container = $('#csStatusNavList');
    if (!container) return;

    // ❌ If statuses.slice().reverse().map(...) or an unshift loop is present, replace it with the standard approach:
    // 🟢 Render the array in its natural chronological insertion order:
    container.innerHTML = (cache.statuses || []).map(st => {
      const isCurrent = (cache.filterStatus === st.key);
      return `
        <div class="nav-item cs-filter-status ${isCurrent ? 'on' : ''}" data-status="${st.key}" style="cursor:pointer;">
          <span class="status-dot" style="background:${st.color || '#9b8e7d'}"></span>
          <span>${escapeHtml(st.label)}</span>
          <span class="navgrp-cnt">${st.count || 0}</span>
        </div>
      `;
    }).join('');
  }

    function seedLocalDetails() {
      seedOrderCases();
      localStore = {
        '1': {
          thread: [
            { id: 'm1', dir: 'in', who: 'Emma Richardson', at: 'Today 09:14', body: "Hi, I requested a return 3 days ago but haven't got the label yet." },
            { id: 'm2', dir: 'in', who: 'Emma Richardson', at: 'Today 11:05', body: 'Still nothing in my inbox. Can you resend?' },
          ],
          order: { ref: 'LW-992814', external: 'AMZ-88421', status: 'Dispatched', customer: 'Emma Richardson', email: 'emma.richardson@example.com', address: '14 Oak Lane, Leeds', items: [{ sku: 'FK-JER-M-BLU', name: 'FK Jersey M Blue', qty: 1, price: '£34.99' }], total: '£34.99' },
          details: { status: 'awaiting_reply', priority: 'Normal', opened: '18 Jun 2026', channel: 'Amazon', assignee: 'You', matched: true },
          notes: {
            team: [{ id: 1, authorId: 1, authorName: 'You', body: 'Customer prefers email. Label gen failed once.', attachments: [], canEdit: true, createdAt: new Date(Date.now() - 3600000).toISOString() }],
            personal: { '1': { authorId: 1, html: 'Check Linnworks label queue at EOD.', createdAt: new Date(Date.now() - 1800000).toISOString(), updatedAt: new Date(Date.now() - 1800000).toISOString(), collapsed: false } },
          },
          assignmentLog: [{ action: 'assign', actorName: 'System', toName: 'You', at: new Date(Date.now() - 4 * 3600000).toISOString() }],
        },
        '5': {
          thread: [{ id: 'm3', dir: 'in', who: 'Unknown sender', at: 'Today 07:55', body: "Can someone call me about my order please?" }],
          order: { ref: '—', external: 'AMZ-88502', status: 'Unknown', customer: '—', address: '—', items: [], total: '—' },
          details: { status: 'new_ticket', priority: 'Low', opened: '18 Jun 2026', channel: 'Amazon', assignee: 'Unassigned', matched: false },
          notes: { team: [], personal: {} },
          assignmentLog: [],
        },
      };
      categories = ['General', 'Returns', 'Shipping'];
      templates = [
        { id: 1, title: 'Return label follow-up', body: 'Hi {{customer}},\n\nSorry for the delay with your return label. I\'ve just resent it to the email on file — please check spam if it doesn\'t land in a few minutes.', category: 'Returns', favorite: true },
        { id: 2, title: 'Refund timeline', body: 'Hi {{customer}},\n\nYour return has been received at our warehouse and refunds typically process within 2 business days. We\'ll send confirmation once it\'s issued.', category: 'Returns', favorite: false },
        { id: 3, title: 'Item not received — investigating', body: 'Hi {{customer}},\n\nSorry to hear this hasn\'t arrived. I\'m raising this with the courier now and will update you within 24 hours.', category: 'Shipping', favorite: true },
        { id: 4, title: 'Wrong item apology + swap', body: 'Hi {{customer}},\n\nApologies for the mix-up — I\'ve arranged a replacement in the correct size, no need to send anything back.', category: 'General', favorite: false },
      ];
    }
    async function sendReply() {
  const body = $('#csReply').value;
  if (!body.trim()) return;

  const res = await api(`/cases/${selectedId}/reply`, 'POST', { 
    body,
    attachments: notePendingAttachments // Include pending attachments
  });

  if (res.ok) {
    $('#csReply').value = ''; // Clear box
    refreshCase(selectedId);   // Refresh the UI
  }
}

// Call this function when a template is expanded
    function setupTextareaAutoResize(el2) {
      el2.style.height = 'auto';
      el2.style.height = (el2.scrollHeight) + 'px';
      el2.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
      });
    }

function updateStatusUI(status) {
  const sel = $('#csStatusSel');
  // Remove all previous status classes
  Object.values(STATUS_COLORS).forEach(cls => sel.classList.remove(cls));
  
  // Add the new status class
  const newClass = STATUS_COLORS[status] || '';
  if (newClass) sel.classList.add('status-pill', newClass);
}

// Trigger the file input
function handleFileAttachment(event) {
  const file = event.target.files[0];
  const reader = new FileReader();
  
  reader.onload = (e) => {
    notePendingAttachments.push({
      name: file.name,
      mime: file.type,
      data: e.target.result // Base64 string
    });
    renderPendingAtts(); // Show attachment preview
  };
  reader.readAsDataURL(file);
}
const STATUS_COLORS = {
  'new_ticket': 'status-new_ticket',
  'awaiting_reply': 'status-awaiting_reply',
  'to_do': 'status-to_do',
  'replacement': 'status-replacement',
  'refund': 'status-refund',
  'resolved': 'status-resolved'
};
// cs.js mein
async function saveNote() {
  const body = $('#csNoteInput').value;
  const payload = {
    body: body,
    attachments: notePendingAttachments // Images ka array
  };
  
  const res = await api(`/cases/${selectedId}/notes`, 'POST', payload);
  if (res.ok) {
    $('#csNoteInput').value = '';
    notePendingAttachments = []; // Clear attachments
    renderPendingAtts();
    refreshCase(selectedId);
  }
}
    async function api(path, opts) {
      const r = await fetch('/api/cs' + path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Request failed');
      return j;
    }

    async function initBootstrap() {
      try {
        bootstrap = await api('/bootstrap');
        if (bootstrap && bootstrap.agents) {
          useApi = true; 
        }
        if (Array.isArray(bootstrap.statuses) && bootstrap.statuses.length) {
          STATUSES = bootstrap.statuses;
        }
        const tpl = await api('/templates');
        templates = tpl.templates || [];
        categories = (tpl.categories && tpl.categories.length) ? tpl.categories : ['General'];
        
        // 🟢 INITIALIZE MASTER CACHE PIPELINE ON LOAD
        if (useApi) {
          const data = await api('/queue?view=all_tickets&filter=all');
          queue = data.cases || [];
          if (data.allCasesReferencePool) {
            window._csMasterTicketCache = data.allCasesReferencePool;
          } else {
            window._csMasterTicketCache = queue;
          }
        }
      } catch (e) {
        console.error("API Error - falling back to local simulation paths:", e);
        useApi = false;
        seedLocalDetails();
        bootstrap = { 
          user: { id: 1, name: 'You', role: 'Team Lead' }, 
          permissions: { assign: true, templates: true, manageNotes: true }, 
          agents: SAMPLE_TEAM 
        };
      }

      if (useApi && bootstrap.user) {
        const csDept = bootstrap.user.departments?.find(d => Number(d.department_id) === 3);
        const rawRole = csDept ? csDept.role : bootstrap.user.role;
        bootstrap.user.role = rawRole;
        const allowedRoles = ['lead', 'senior', 'manager', 'Team Lead', 'Senior Executive', 'Manager'];
        bootstrap.permissions.assign = allowedRoles.includes(rawRole);
      }

      if (bootstrap.permissions.templates) $('#csNavTemplates').style.display = '';
      $('#csReassign').disabled = !bootstrap.permissions.assign;
      // Queue Routing: visible to Team Leads only
      if (bootstrap.permissions.assign) {
        const routingBtn = $('#csNavQueueRouting');
        if (routingBtn) routingBtn.style.display = '';
        // Load saved routing rules (from API or localStorage)
        try {
          if (useApi) {
            const r = await api('/queue-routing');
            if (r && r.routing) queueRouting = { ...queueRouting, ...r.routing };
          } else {
            const saved = localStorage.getItem('cs_queue_routing');
            if (saved) queueRouting = { ...queueRouting, ...JSON.parse(saved) };
          }
        } catch (e) { /* Routing rules not found, keeping defaults */ }
      }
      
      renderStatusNav();
      populateStatusSelect();

      if (typeof renderEmployeeList === 'function') renderEmployeeList();
      if (typeof renderTeamMembersSidebar === 'function') renderTeamMembersSidebar();

      // RUN REAL-TIME METRIC COMPILATION
      updateNavCounts();
    }

    // ---- Status nav (sidebar folders) ----
    function renderStatusNav() {
      $('#csStatusNavList').innerHTML = STATUSES.map((s) => `
        <div class="cs-status-row">
          <button type="button" class="cs-nav-item status-item" data-view="status:${esc(s.key)}">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.label)}</span>
            <span class="cnt" data-status-cnt="${esc(s.key)}">0</span>
          </button>
          <button type="button" class="cs-status-dot-sw" data-status-color="${esc(s.key)}" style="background:${esc(s.color)}" title="Set colour for ${esc(s.label)}"></button>
        </div>`).join('');
      wireNavClicks();
      wireStatusColorSwatches();
    }

    function wireStatusColorSwatches() {
      $('#csStatusNavList').querySelectorAll('[data-status-color]').forEach((dot) => {
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = dot.dataset.statusColor;
          const s = statusByKey(key);
          if (!s) return;
          openColorPopover(dot, s.color, async (hex) => {
            s.color = hex || STATUS_COLOR_CYCLE[STATUSES.indexOf(s) % STATUS_COLOR_CYCLE.length];
            try { if (useApi) await api('/statuses/' + encodeURIComponent(key), { method: 'PATCH', body: JSON.stringify({ color: s.color }) }); } catch (err) {}
            renderStatusNav();
            populateStatusSelect();
            if (selectedId) applyStatusColor('#csStatusSel', $('#csStatusSel').value);
          });
        });
      });
    }

    // ---- Status dropdown (ticket header) ----
    function populateStatusSelect() {
      const sel = $('#csStatusSel');
      const current = sel.value;
      sel.innerHTML = STATUSES.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('')
        + `<option value="__new__">+ Create new status…</option>`;
      if (current && statusByKey(current)) sel.value = current;
    }

    // ---- Create a status: the one and only path that does this ----
   function createStatus(label) {
      if (!label || !label.trim()) return null;
      const key = label.toLowerCase().trim().replace(/\s+/g, '_');
      
      // Prevent duplicating keys
      if (STATUSES.some((s) => s.key === key)) {
        toast('Status already exists');
        return null;
      }

      const colors = ['#f28b82', '#fbbc04', '#4285f4', '#34a853', '#109618', '#990099'];
      const randomColor = colors[STATUSES.length % colors.length];
      
      const newStatusObj = { 
        key, 
        label, 
        color: randomColor, 
        icon: 'ti-circle-dot' 
      };

      // 🟢 FIXED 1: Instantly append the item to the frontend memory stream
      STATUSES.push(newStatusObj);

      if (useApi) {
        // Post asynchronously to your permanent database repository
        api('/statuses', { 
          method: 'POST', 
          body: JSON.stringify(newStatusObj) 
        }).catch(e => console.error('Failed to sync new status to server:', e));
      }

      // 🟢 FIXED 2: Re-run drawing functions to display the newly added status immediately
      renderStatusNav();
      populateStatusSelect();
      
      return newStatusObj;
    }

    function refreshStatusCounts() {
      // Count from SAMPLE_QUEUE (full dataset) merged with any in-memory mutations on
      // queue items — so status changes and new statuses both show correct counts.
      const source = useApi ? queue : SAMPLE_QUEUE;
      const counts = {};
      source.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
      el.querySelectorAll('[data-status-cnt]').forEach((badge) => {
        const key = badge.getAttribute('data-status-cnt');
        badge.textContent = String(counts[key] || 0);
      });
    }

    function toast(msg) {
      const t = $('#csToast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2400);
    }

    function formatDuration(ms) {
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    }

    function slaInfo(iso) {
      if (!iso) return { text: 'SLA paused', cls: 'off', ms: null };
      const ms = new Date(iso).getTime() - Date.now();
      const part = formatDuration(Math.abs(ms));
      if (ms <= 0) return { text: `${part} overdue`, cls: 'over', ms };
      if (ms < SLA_URGENT_MS) return { text: `${part} left`, cls: 'urgent', ms };
      if (ms < SLA_SOON_MS) return { text: `${part} left`, cls: 'soon', ms };
      return { text: `${part} left`, cls: 'ok', ms };
    }

    function highlightMentions(text) {
      return esc(text).replace(/@([\w][\w .'-]{0,40})/g, '<span class="mention">@$1</span>');
    }

    function filteredQueue() {
      let rows = queue;
      if (filter !== 'all') rows = rows.filter((c) => c.category === filter);
      if (sortOrder === 'oldest') {
        rows = [...rows].sort((a, b) => {
          const ta = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity;
          const tb = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity;
          return ta - tb;
        });
      } else if (sortOrder === 'newest') {
        rows = [...rows].sort((a, b) => {
          const ta = a.slaDueAt ? new Date(a.slaDueAt).getTime() : -Infinity;
          const tb = b.slaDueAt ? new Date(b.slaDueAt).getTime() : -Infinity;
          return tb - ta;
        });
      }
      return rows;
    }

    // ---------------------------------------------------------------------
    // Simulated presence/typing (no websocket backend available). Teammates
    // randomly drift between online / viewing a ticket / typing a reply or
    // note. A real implementation would replace this with a socket
    // subscription keyed by case id.
    // ---------------------------------------------------------------------
    const presenceState = {};
    function initPresence() {
      const team = (bootstrap.agents && bootstrap.agents.length ? bootstrap.agents : SAMPLE_TEAM);
      team.forEach((a) => { presenceState[a.id] = { name: a.name, status: 'online', caseId: null, kind: null }; });
    }
    function tickPresenceSimulation() {
      const team = Object.keys(presenceState);
      if (!team.length || !queue.length) return;
      team.forEach((id) => {
        const p = presenceState[id];
        const roll = Math.random();
        if (roll < 0.12) { const c = queue[Math.floor(Math.random() * queue.length)]; p.status = 'viewing'; p.caseId = c ? c.id : null; }
        else if (roll < 0.2 && p.caseId) { p.status = 'typing'; p.kind = Math.random() < 0.5 ? 'reply' : 'note'; }
        else if (roll < 0.32) { p.status = 'online'; p.caseId = null; p.kind = null; }
      });
      renderPresenceMini();
      if (selectedId) renderPresencePanel();
      renderQueue();
      updateConflictBanner();
    }
    function renderPresenceMini() {
      const list = Object.values(presenceState);
      $('#csPresenceMiniList').innerHTML = list.map((p) => `
        <div class="cs-presence-row" title="${esc(p.name)} — ${esc(p.status)}">
          <span class="av">${esc(initialsOf(p.name))}</span>
          <span class="nm">${esc(p.name)}</span>
          <span class="cs-presence-dot ${esc(p.status)}"></span>
        </div>`).join('');
    }
    function renderPresencePanel() {
      const here = Object.values(presenceState).filter((p) => p.caseId === selectedId);
      const body = $('#csPresencePanelBody');
      if (!here.length) { body.innerHTML = '<div style="font-size:13px;color:var(--soft)">Just you, right now.</div>'; return; }
      body.innerHTML = here.map((p) => {
        const lbl = p.status === 'typing' ? `Typing a ${p.kind === 'note' ? 'note' : 'reply'}…` : 'Viewing this ticket';
        return `<div class="cs-presence-panel-row"><span class="av">${esc(initialsOf(p.name))}</span><span>${esc(p.name)}</span><span class="lbl">${esc(lbl)}</span></div>`;
      }).join('');
    }
    function updateConflictBanner() {
      if (!selectedId) return;
      const typer = Object.values(presenceState).find((p) => p.caseId === selectedId && p.status === 'typing' && p.kind === 'reply');
      const banner = $('#csConflictBanner');
      if (typer) { $('#csConflictText').textContent = `${typer.name} is also typing a reply on this ticket — coordinate to avoid double-replying.`; banner.classList.add('show'); }
      else banner.classList.remove('show');
    }
    function rowPresenceLabel(caseId) {
      const p = Object.values(presenceState).find((x) => x.caseId === caseId);
      if (!p) return '';
      return p.status === 'typing' ? `${p.name} typing…` : `${p.name} viewing`;
    }
    function renderTeamMembersSidebar() {
      const teamListEl = $('#csTeamMembersList');
      if (!teamListEl) return;

      const team = bootstrap.agents || [];
      const currentUserId = bootstrap.user?.id;
      
      const fullTeamList = [];
      if (bootstrap.user) {
        fullTeamList.push({ id: bootstrap.user.id, name: bootstrap.user.name || 'You', is_active: true, role: 'manager' });
      }
      team.forEach(a => {
        if (String(a.id) !== String(currentUserId)) {
          fullTeamList.push(a);
        }
      });

      teamListEl.innerHTML = fullTeamList.map((agent) => {
        const agentName = agent.name || 'Unknown Agent';
        
        // Dynamic row counts evaluation
        const agentTicketCount = Array.isArray(queue) 
          ? queue.filter(c => String(c.assignee_id || c.assigneeId) === String(agent.id)).length 
          : 0;
          
        const isCurrentViewActive = queueView === `agent:${agent.id}`;
        const initials = String(agentName).trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
        
        // Presence rules mapping from PostgreSQL rows
        const isOnline = agent.is_active || agent.is_active === true;
        const avatarBg = isOnline ? '#E1F5EE' : '#ECECEA'; 
        const avatarText = isOnline ? '#0F6E56' : '#6B6B66';
        const dotColor = isOnline ? '#34B27B' : '#9b8e7d'; 
        
        // Evaluate role validation badge from new database values
        const displayRole = agent.role ? agent.role.toUpperCase() : 'AGENT';

        return `
          <button type="button" class="cs-nav-item ${isCurrentViewActive ? 'on' : ''}" data-view="agent:${agent.id}" title="Role: ${displayRole}">
            <span class="av" style="width:22px; height:22px; border-radius:50%; background:${avatarBg}; color:${avatarText}; font-size:10px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; margin-right:6px; flex:none; transition: all 0.2s ease;">
              ${esc(initials)}
            </span>
            <div style="flex:1; min-width:0; display:flex; flex-direction:column; text-align:left;">
              <span style="font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; ${!isOnline ? 'opacity: 0.6;' : ''}">${esc(agentName)}</span>
              <span style="font-size:9.5px; opacity:0.55; font-weight:700; letter-spacing:0.02em;">${displayRole}</span>
            </div>
            <span class="cnt" style="${!isOnline ? 'background: rgba(0,0,0,0.04);' : ''}">${agentTicketCount}</span>
            <span class="cs-presence-dot" style="width:6px; height:6px; border-radius:50%; background:${dotColor}; margin-left:6px; flex:none;"></span>
          </button>
        `;
      }).join('');

      // Click handles execution parameters
      teamListEl.querySelectorAll('[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          queueView = btn.dataset.view;
          el.querySelectorAll('.cs-nav-item').forEach((b) => b.classList.remove('on'));
          btn.classList.add('on');

          const agentId = queueView.split(':')[1];
          const targetedAgent = fullTeamList.find(a => String(a.id) === String(agentId));
          
          $('#csListTitle').textContent = targetedAgent ? (targetedAgent.name || 'Agent') : 'Team members';
          $('#csListSub').textContent = `Assigned active queue workspace`;
          
          loadQueue();
        });
      });
    }

    function rowCaseDotsHtml(ticketId) {
      const cases = orderCasesByTicket[ticketId] || [];
      if (!cases.length) return '';
      const seen = new Set();
      const dots = cases.filter((c) => { if (seen.has(c.type)) return false; seen.add(c.type); return true; })
        .map((c) => { const info = caseTypeInfo(c.type); return `<span class="cs-row-case-dot ${info.cls}" title="${esc(info.label)}"></span>`; }).join('');
      return `<span class="cs-row-case-dots">${dots}</span>`;
    }

    // -----------------------------------------------------------------------
    // Assignee lookup: every agent should be able to see who currently owns
    // a ticket, even if it isn't theirs (e.g. browsing "All" or another
    // agent's folder, or just glancing at the unassigned queue).
    // -----------------------------------------------------------------------
    function agentById(id) {
      if (id == null) return null;
      if (String(id) === String(bootstrap.user.id)) return bootstrap.user;
      const team = (bootstrap.agents && bootstrap.agents.length) ? bootstrap.agents : SAMPLE_TEAM;
      return team.find((a) => String(a.id) === String(id)) || null;
    }
    function initialsOf(name) {
      return String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    }
    function assigneeBadgeHtml(assigneeId) {
      const agent = agentById(assigneeId);
      if (!agent) return `<span class="cs-assignee unassigned" title="Unassigned"><span class="av"><i class="ti ti-user-question"></i></span>Unassigned</span>`;
      return `<span class="cs-assignee" title="Assigned to ${esc(agent.name)}"><span class="av">${esc(initialsOf(agent.name))}</span>${esc(agent.name)}</span>`;
    }

    function rowHtml(c) {
      const sla = slaInfo(c.slaDueAt);
      const plat = PLATFORM_LABELS[c.platform] || c.platform;
      const isNew = unreadIds.has(c.id);
      const presenceLbl = rowPresenceLabel(c.id);
      const stColor = statusColor(c.status);
      return `<article class="cs-row${selectedId === c.id ? ' on' : ''}${isNew ? ' new' : ''}" data-id="${esc(c.id)}">
        <div class="cs-row-top">
          <div class="cs-name">${esc(c.customer)}${isNew ? '<span class="cs-new-badge">New</span>' : ''}${rowCaseDotsHtml(c.id)}</div>
          <span class="cs-dl ${sla.cls}">${esc(sla.text)}</span>
        </div>
        <div class="cs-subj">${esc(c.subject)}</div>
        <div class="cs-snip">${esc(c.snippet)}</div>
        <div class="cs-row-foot">
          <span class="cs-badge ${esc(c.platform)}">${esc(plat)}</span>
          ${presenceLbl ? `<span class="cs-status dot-viewing">${esc(presenceLbl)}</span>` : `<span class="cs-status"><span class="sw" style="background:${esc(stColor)}"></span>${esc(statusLabel(c.status))}</span>`}
          <span class="cs-cat">${esc(FILTER_LABELS[c.category] || c.category)}</span>
          ${assigneeBadgeHtml(c.assigneeId)}
        </div>
      </article>`;
    }

function updateNavCounts() {
      const masterSource = (useApi && window._csMasterTicketCache) ? window._csMasterTicketCache : (useApi ? queue : SAMPLE_QUEUE);
      
      const allWorkEl = $('#csCntAll');
      if (allWorkEl) {
        allWorkEl.textContent = String(masterSource.length);
      }
      
      if (queueView === 'my-work') $('#csCntMine').textContent = String(queue.length);
      
      // 🟢 FIXED: Check both camelCase and snake_case, handling null parameters perfectly
      const unassignedEl = $('#csCntUnassigned');
      if (unassignedEl) {
        const unassignedCount = masterSource.filter(c => {
          const empId = c.assigneeId !== undefined ? c.assigneeId : c.assignee_id;
          return empId === null || empId === undefined || empId === '';
        }).length;
        
        unassignedEl.textContent = String(unassignedCount);
      }
      
      refreshStatusCounts();
    }

    function refreshStatusCounts() {
      const masterSource = (useApi && window._csMasterTicketCache) ? window._csMasterTicketCache : (useApi ? queue : SAMPLE_QUEUE);
      const counts = {};
      
      masterSource.forEach((c) => { 
        counts[c.status] = (counts[c.status] || 0) + 1; 
      });
      
      el.querySelectorAll('[data-status-cnt]').forEach((badge) => {
        const key = badge.getAttribute('data-status-cnt');
        badge.textContent = String(counts[key] || 0);
      });
    }
    function renderQueue() {
      const rows = filteredQueue();
      $('#csListSub').textContent = rows.length + ' case' + (rows.length === 1 ? '' : 's') + ' in queue';
      if (!rows.length) { $('#csRows').innerHTML = '<div class="cs-loading">No cases in this filter.</div>'; return; }
      $('#csRows').innerHTML = rows.map(rowHtml).join('');
      $('#csRows').querySelectorAll('.cs-row').forEach((row) => {
        row.addEventListener('click', () => openCase(row.dataset.id));
      });
    }

    function sortQueueBySla() { queue.sort((a, b) => { const da = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity; const db = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity; return da - db; }); }

async function loadQueue() {
      $('#csRows').innerHTML = '<div class="cs-loading">Loading queue…</div>';
      try {
        if (useApi) {
          const params = new URLSearchParams({ view: queueView, filter });
          const data = await api('/queue?' + params.toString());
          queue = data.cases || [];
          
          // 🟢 LIVE COUNTER CACHE RE-TICK
          if (data.allCasesReferencePool) {
            window._csMasterTicketCache = data.allCasesReferencePool;
          }
        } else {
          const statusAgentMatch = /^status_agent:(.+):([^:]+)$/.exec(queueView);
          const statusKey = !statusAgentMatch && queueView.startsWith('status:') ? queueView.slice(7) : null;
          const agentKey = !statusAgentMatch && queueView.startsWith('agent:') ? queueView.slice(6) : null;
          queue = SAMPLE_QUEUE.filter((c) => {
            if (queueView === 'all_tickets') return true;
            if (statusAgentMatch) return c.status === statusAgentMatch[1] && String(c.assigneeId) === String(statusAgentMatch[2]);
            if (statusKey) return c.status === statusKey;
            if (queueView === 'unassigned') return !c.matched || c.assigneeId == null;
            if (agentKey) return String(c.assigneeId) === String(agentKey);
            return c.matched && String(c.assigneeId) === String(bootstrap.user.id);
          });
        }
        queue.forEach((c) => { if (c.isNew) unreadIds.add(c.id); });

        // ── Queue Routing: auto-assign unassigned new tickets based on routing rules ──
        if (bootstrap.permissions.assign) {
          const unassignedNew = queue.filter(c => (!c.assigneeId && !c.assignee_id) && c.category && queueRouting[c.category]);
          for (const ticket of unassignedNew) {
            const targetAgentId = queueRouting[ticket.category];
            if (!targetAgentId) continue;
            try {
              if (useApi) {
                await api('/cases/' + ticket.id + '/assign', { method: 'POST', body: JSON.stringify({ agentId: targetAgentId, user_id: targetAgentId }) });
              }
              ticket.assigneeId = targetAgentId;
              ticket.assignee_id = targetAgentId;
            } catch (e) { /* Silent — if routing fails, ticket remains unassigned */ }
          }
        }

        sortQueueBySla();
        renderQueue();
        updateNavCounts();
      } catch (e) {
        $('#csRows').innerHTML = '<div class="cs-loading" style="color:var(--red)">Failed to load queue.</div>';
      }
    }
    // -----------------------------------------------------------------------
    // Order case indicators: small color-coded badges in the top-right of
    // the ticket header showing any active Return/INR/A-to-Z/Chargeback/
    // Replacement cases tied to this order. Stay visible until resolved.
    // -----------------------------------------------------------------------
    async function fetchOrderCases(ticketId) {
      if (useApi) {
        try { const r = await api('/cases/' + encodeURIComponent(ticketId) + '/order-cases'); return r.cases || []; }
        catch (e) { return []; }
      }
      return orderCasesByTicket[ticketId] || [];
    }

    function caseBadgeHtml(c) {
      const info = caseTypeInfo(c.type);
      const canResolve = bootstrap.permissions.assign || bootstrap.permissions.manageNotes || true; // any agent can mark a case handled from here
      return `<span class="cs-case-badge ${info.cls}" data-case-id="${esc(c.id)}" title="${esc(info.label)} opened ${esc(noteTimeLabel(c.openedAt))}">
        <span class="dot"></span>${esc(info.label)}${canResolve ? `<button type="button" data-resolve-case="${esc(c.id)}" title="Mark resolved"><i class="ti ti-x"></i></button>` : ''}
      </span>`;
    }

    function renderCaseBadges(cases) {
      const host = $('#csCaseBadges');
      if (!host) return;
      const list = cases || [];
      host.innerHTML = list.map(caseBadgeHtml).join('');
      host.querySelectorAll('[data-resolve-case]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const caseId = btn.dataset.resolveCase;
          await resolveOrderCase(selectedId, caseId);
        });
      });
    }

    async function resolveOrderCase(ticketId, caseId) {
      try {
        if (useApi) await api('/cases/' + encodeURIComponent(ticketId) + '/order-cases/' + encodeURIComponent(caseId), { method: 'DELETE' });
        else if (orderCasesByTicket[ticketId]) orderCasesByTicket[ticketId] = orderCasesByTicket[ticketId].filter((c) => c.id !== caseId);
        if (selectedId === ticketId) renderCaseBadges(await fetchOrderCases(ticketId));
        renderQueue();
        toast('Case marked resolved');
      } catch (e) { toast(e.message || 'Could not resolve case'); }
    }

    // Simulates an external system (Amazon / Lobby / INR / chargeback feed)
    // opening a new case on an order the agent already has open, and the
    // header updating live — no refresh, no new conversation, no manual
    // check of another system required.
    function wireOrderCaseSimulation() {
      orderCaseTimer = setInterval(async () => {
        if (document.hidden || useApi) return; // only simulate in the local/demo data path
        const openIds = queue.map((c) => c.id);
        if (!openIds.length) return;
        const candidates = openIds.filter((id) => (orderCasesByTicket[id] || []).length === 0);
        if (!candidates.length) return;
        const targetId = candidates[Math.floor(Math.random() * candidates.length)];
        const types = Object.keys(ORDER_CASE_TYPES);
        const type = types[Math.floor(Math.random() * types.length)];
        const newCase = { id: 'oc-' + Date.now(), type, openedAt: new Date().toISOString() };
        orderCasesByTicket[targetId] = [...(orderCasesByTicket[targetId] || []), newCase];
        const item = queue.find((c) => c.id === targetId) || SAMPLE_QUEUE.find((c) => c.id === targetId);
        const info = caseTypeInfo(type);
        toast(`${info.label} opened for ${item ? item.customer : 'a customer'} — ticket updated`);
        if (selectedId === targetId) renderCaseBadges(await fetchOrderCases(targetId));
        renderQueue();
      }, 45000);
      mod._orderCaseTimer = orderCaseTimer;
    }

    function renderOrder(order) {
      if (!order) return '<div class="cs-kv"><span class="k">Status</span><span class="v">No order linked</span></div>';
      let itemsTable = '';
      if (order.items && order.items.length) {
        const rows = order.items.map((it) =>
          `<tr><td>${esc(it.qty)}×</td><td>${esc(it.name)}</td><td>${esc(it.sku || '')}</td><td>${esc(it.price)}</td></tr>`
        ).join('');
        itemsTable = `<table class="cs-order-table">
          <thead><tr><th>Qty</th><th>Item</th><th>SKU</th><th>Price</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="cs-order-total-row"><td colspan="3">Total</td><td>${esc(order.total)}</td></tr></tfoot>
        </table>`;
      }
      return `<div class="cs-kv"><span class="k">Linnworks</span><span class="v">${esc(order.ref)}</span></div>
        <div class="cs-kv"><span class="k">External</span><span class="v">${esc(order.external)}</span></div>
        <div class="cs-kv"><span class="k">Status</span><span class="v">${esc(order.status)}</span></div>
        <div class="cs-kv"><span class="k">Customer</span><span class="v">${esc(order.customer)}</span></div>
        <div class="cs-kv"><span class="k">Ship to</span><span class="v">${esc(order.address)}</span></div>
        ${itemsTable}`;
    }

    function renderDetails(d, c) {
      if (!d) return '';
      const guessedPlatform = (c && c.platform) || 'amazon';
      const matchedRow = d.matched
        ? `<div class="cs-kv"><span class="k">Matched</span><span class="v">Yes</span></div>`
        : `<div class="cs-kv"><span class="k">Matched</span><span class="v">No — stays in Unassigned</span></div>
           <div class="cs-match-form" id="csMatchForm">
             <label class="cs-match-lbl" for="csMatchPlatform">Platform</label>
             <select id="csMatchPlatform" class="cs-match-sel">
               <option value="amazon"${guessedPlatform === 'amazon' ? ' selected' : ''}>Amazon</option>
               <option value="ebay"${guessedPlatform === 'ebay' ? ' selected' : ''}>eBay</option>
               <option value="shopify"${guessedPlatform === 'shopify' ? ' selected' : ''}>Shopify</option>
             </select>
             <label class="cs-match-lbl" for="csMatchOrderRef">Order / case reference</label>
             <input type="text" id="csMatchOrderRef" class="cs-match-input" placeholder="e.g. AMZ-88502 or order email">
             <button type="button" class="cs-btn-ghost cs-match-btn" id="csMatchConfirm"><i class="ti ti-link"></i> Match ticket</button>
           </div>`;
      return `<div class="cs-kv"><span class="k">Status</span><span class="v">${esc(statusLabel(d.status))}</span></div>
        <div class="cs-kv"><span class="k">Priority</span><span class="v">${esc(d.priority)}</span></div>
        <div class="cs-kv"><span class="k">Opened</span><span class="v">${esc(d.opened)}</span></div>
        <div class="cs-kv"><span class="k">Channel</span><span class="v">${esc(d.channel)}</span></div>
        <div class="cs-kv"><span class="k">Assignee</span><span class="v">${esc(d.assignee)}</span></div>
        ${matchedRow}`;
    }

    function dayLabel(atStr) {
      const m = String(atStr || '').match(/^([A-Za-z]+ ?\d*[A-Za-z]*)/);
      return m ? m[1].trim() : '';
    }

    function timeOf(ev) {
      if (ev.createdAt) return new Date(ev.createdAt).getTime();
      if (ev.at && /^\d{4}-/.test(ev.at)) return new Date(ev.at).getTime();
      return 0;
    }

    function noteTimeLabel(iso) {
      return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
    }

    // ---------------------------------------------------------------------
    // Merged timeline: customer messages, agent replies, team notes, and
    // system events (assignment, status change, match) all rendered inline,
    // chronologically — a single Instagram/WhatsApp-style conversation
    // history. The Personal Note is private to its author and is never
    // part of this shared feed — it lives only in the dedicated side panel.
    // ---------------------------------------------------------------------
    function buildTimeline(data) {
      const events = [];
      (data.thread || []).forEach((m) => events.push({ kind: 'message', sortKey: timeOf(m), data: m }));
      (data.notes?.team || []).forEach((n) => events.push({ kind: 'team-note', sortKey: timeOf(n), data: n }));
      (data.assignmentLog || []).forEach((l) => events.push({ kind: 'system', sortKey: timeOf(l), data: { ...l, sysType: l.action } }));
      (data.statusLog || []).forEach((l) => events.push({ kind: 'system', sortKey: timeOf(l), data: l }));
      events.sort((a, b) => a.sortKey - b.sortKey); // oldest first — chat style, newest near compose box
      return events;
    }

    function systemEventText(d) {
      if (d.sysType === 'assign') return `<i class="ti ti-user-plus"></i> Assigned to <b>${esc(d.toName || 'agent')}</b>`;
      if (d.sysType === 'reassign') return `<i class="ti ti-user-share"></i> Reassigned from <b>${esc(d.fromName || '—')}</b> to <b>${esc(d.toName || '—')}</b>`;
      if (d.sysType === 'unassign') return `<i class="ti ti-user-minus"></i> Unassigned`;
      if (d.sysType === 'status') return `<i class="ti ti-arrows-right-left"></i> Status changed: <b>${esc(statusLabel(d.fromStatus) || d.fromStatus || '—')}</b> → <b>${esc(statusLabel(d.toStatus) || d.toStatus)}</b>`;
      if (d.sysType === 'match') return `<i class="ti ti-link"></i> Matched to <b>${esc(d.platform || 'order')}</b>`;
      return `<i class="ti ti-info-circle"></i> ${esc(d.actorName || 'System')} updated this ticket`;
    }

    // Attachment renderer helper — thumbnails (72×72) with data-lightbox for click-to-expand
function renderAttachments(attachments) {
  if (!attachments || attachments.length === 0) return '';
  const list = typeof attachments === 'string' ? JSON.parse(attachments) : attachments;
  if (!list.length) return '';
  
  const imgs = [], files = [];
  list.forEach(a => {
    const mime = a.mime || a.type || '';
    // 🎯 FIX: Agar backend se sirf raw data aa raha hai bina proper prefix ke, toh yahan treat karein
    let src  = a.data || a.url || '';
    const name = a.name || 'attachment';

    // Safe check: Agar base64 data hai par usme data:image prefix missing hai toh add karein
    if (src.startsWith('data:') === false && (mime.startsWith('image/') || src.length > 500)) {
      src = `data:${mime || 'image/jpeg'};base64,${src}`;
    }

    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) {
      imgs.push({ src, name });
    } else {
      files.push({ src, name, mime });
    }
  });

  let html = '';
  if (imgs.length) {
    html += '<div class="cs-msg-img-grid" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">' +
      imgs.map(i => `
        <img class="cs-msg-thumb" 
             src="${i.src}" 
             alt="${esc(i.name)}" 
             title="${esc(i.name)}" 
             data-lightbox="${i.src}" 
             style="width: 120px; height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); cursor: pointer;"
             onerror="this.onerror=null; console.error('Image load failed:', this.src); this.style.border='2px solid red';" />
      `).join('') +
    '</div>';
  }
  if (files.length) {
    html += '<div class="cs-msg-file-list">' +
      files.map(f => {
        const ext = (f.name.split('.').pop() || 'file').toUpperCase().slice(0, 6);
        const dlAttr = f.src ? `href="${esc(f.src)}"` : '';
        return `<a class="cs-msg-file-chip" ${dlAttr} download="${esc(f.name)}" target="_blank" rel="noopener"><span class="cs-msg-file-ext">${esc(ext)}</span><span class="cs-msg-file-name">${esc(f.name)}</span></a>`;
      }).join('') +
    '</div>';
  }
  return html;
}
function renderTimeline(data) {
  const events = buildTimeline(data);
  if (!events.length) return '<div class="cs-loading">No activity yet.</div>';
  let out = '';
  let prevDay = null;

  events.forEach((ev, idx) => {
    const isNewest = idx === events.length - 1; // Last element in array = newest
    
    // 1. CUSTOMER MESSAGES OR AGENT REPLIES CHANNEL
    if (ev.kind === 'message') {
      const m = ev.data;
      const d = dayLabel(m.at);
      if (d && d !== prevDay) { out += `<div class="cs-day-sep">${esc(d)}</div>`; prevDay = d; }
      
      const pendingCls = m.pending ? ' pending' : '';
      const isReply = m.dir === 'out';
      const newestCls = isNewest ? ' cs-msg-newest' : '';
      const statusTag = isReply && !m.pending ? '<span class="cs-msg-status"><i class="ti ti-check"></i> Sent</span>' : '';
      const newestBadge = isNewest ? `<span class="cs-msg-newest-badge">${isReply ? 'Latest Reply' : 'Latest Message'}</span>` : '';
      const msgAtts = m.attachments ? renderAttachments(m.attachments) : '';

      // 🎯 FIXED: Agar outbound reply hai toh sender name dynamic "You" ya database creator name aayega, warna customer name.
      const displayName = isReply ? (m.who || (bootstrap.user && bootstrap.user.name) || 'You') : (m.who || 'Customer');

      out += `<div class="cs-msg ${esc(m.dir)}${newestCls}">
                <div class="cs-msg-meta">
                  <span class="who" style="font-weight:700; color:#2B2017;">${esc(displayName)}</span>
                  <span>${esc(m.at || 'Just now')}</span>
                  ${statusTag}${newestBadge}
                </div>
                <div class="cs-msg-bubble${pendingCls}">${esc(m.body)}${msgAtts}</div>
              </div>`;
    } 
    // 2. INTERNAL TEAM NOTES CHANNEL
    else if (ev.kind === 'team-note') {
      const n = ev.data;
      const newestCls = isNewest ? ' cs-tl-note-newest' : '';
      const noteAtts = n.attachments ? renderAttachments(n.attachments) : '';
      
      // 🎯 FIXED: Note jis individual system agent ne submit kiya hai (`authorName`), exact usi ka profile label display hoga.
      const noteAuthor = n.authorName || (String(n.authorId) === String(bootstrap.user?.id) ? ((bootstrap.user && bootstrap.user.name) || 'You') : 'Team Member');

      out += `<div class="cs-tl-note${newestCls}">
                <div class="cs-tl-note-head" style="color:#8A6A1E; font-weight:700;">
                  <i class="ti ti-note"></i> Internal note · ${esc(noteAuthor)}
                </div>
                <div class="cs-tl-note-body">${highlightMentions(n.body)}${noteAtts}</div>
                <div class="cs-tl-note-time">${esc(noteTimeLabel(n.createdAt))}</div>
              </div>`;
    } 
    // 3. SYSTEM LIFECYCLE EVENTS OVERVIEW CHANNEL
    else if (ev.kind === 'system') {
      out += `<div class="cs-tl-sys">${systemEventText(ev.data)} <span style="color:var(--soft)">· ${esc(noteTimeLabel(ev.data.at))}</span></div>`;
    }
  });
  return out;
}

    function noteItemHtml(n) {
      const atts = (n.attachments || []).map((a) => `<span class="cs-note-att"><img src="${esc(a.data || a.url || '')}" alt="${esc(a.name || 'image')}" title="${esc(a.name || '')}"></span>`).join('');
      // Author can always edit; delete is allowed for the author OR an admin with manageNotes permission.
      const isAuthor = String(n.authorId) === String(bootstrap.user.id);
      const canDelete = isAuthor || bootstrap.permissions.manageNotes;
      const canEditBody = isAuthor; // editing the text stays author-only even for admins
      let actions = '';
      if (canEditBody || canDelete) {
        actions = '<div class="cs-note-actions">'
          + (canEditBody ? `<button type="button" data-edit-note="${n.id}" title="Edit"><i class="ti ti-pencil"></i></button>` : '')
          + (canDelete ? `<button type="button" data-del-note="${n.id}" title="${isAuthor ? 'Delete' : 'Delete (admin)'}"><i class="ti ti-trash"></i></button>` : '')
          + '</div>';
      } else {
        actions = `<span class="cs-note-locked">locked</span>`;
      }
      return `<div class="cs-note-item" data-note-id="${n.id}"><div class="cs-note-head"><span class="who">${esc(n.authorName)}</span><span>${esc(noteTimeLabel(n.createdAt))}</span>${actions}</div><div class="cs-note-body">${highlightMentions(n.body)}</div>${atts ? '<div class="cs-note-atts">' + atts + '</div>' : ''}</div>`;
    }

    function renderNotes(notes) {
      const teamNotes = (notes && notes.team) ? notes.team : (Array.isArray(notes) ? notes : []);
      $('#csNoteCountBadge').textContent = String(teamNotes.length);

      const teamEl = $('#csTeamNoteList');
      teamEl.innerHTML = teamNotes.length
        ? teamNotes.map((n) => noteItemHtml(n)).join('')
        : '<div style="padding:14px 2px;font-size:13px;color:var(--soft);font-style:italic">No team notes yet. Notes are visible to your whole team, not to the customer.</div>';
    }

    function renderAudit(log) {
      if (!log || !log.length) return '<div style="font-size:13px;color:var(--soft)">No assignment changes yet.</div>';
      return log.map((l) => {
        const when = noteTimeLabel(l.at);
        let txt = esc(l.actorName || 'System') + ' ';
        if (l.action === 'assign') txt += 'assigned to ' + esc(l.toName || 'agent');
        else if (l.action === 'reassign') txt += 'reassigned from ' + esc(l.fromName || '—') + ' to ' + esc(l.toName || '—');
        else txt += 'unassigned';
        return `<div class="cs-audit-item">${txt}<br><span style="font-size:11px;color:var(--soft)">${esc(when)}</span></div>`;
      }).join('');
    }

    // -----------------------------------------------------------------------
    // Personal Note — one private note per agent per ticket, shown in its
    // own right-side panel. Never sent to teammates, never shown in the
    // shared timeline. Auto-saves while typing; supports basic rich text
    // (bold/italic/lists) and inline image attachments; tracks created /
    // updated timestamps; collapsible and deletable by its author only.
    // -----------------------------------------------------------------------
    function personalNoteOf(personalMap) {
      const map = personalMap || {};
      return map[String(bootstrap.user.id)] || null;
    }

    function personalNoteComposerHtml(existingHtml) {
      return `<div class="cs-pnote-card" id="csPNoteCard">
        <div class="cs-pnote-rte-toolbar">
          <button type="button" class="b" data-cmd="bold" title="Bold"><i class="ti ti-bold"></i></button>
          <button type="button" class="i" data-cmd="italic" title="Italic"><i class="ti ti-italic"></i></button>
          <button type="button" data-cmd="insertUnorderedList" title="Bullet list"><i class="ti ti-list"></i></button>
          <span class="sep"></span>
          <button type="button" id="csPNoteAttachBtn" title="Attach image"><i class="ti ti-photo"></i></button>
        </div>
        <div class="cs-pnote-editable" id="csPNoteEditable" contenteditable="true" data-placeholder="Write a private note… only you can see this">${existingHtml || ''}</div>
        <div class="cs-pnote-foot">
          <span class="cs-pnote-savestate" id="csPNoteSaveState"></span>
        </div>
      </div>`;
    }

    function personalNoteCardHtml(note) {
      const created = noteTimeLabel(note.createdAt);
      const updated = note.updatedAt && note.updatedAt !== note.createdAt ? noteTimeLabel(note.updatedAt) : null;
      const collapsedCls = note.collapsed ? ' collapsed' : '';
      return `<div class="cs-pnote-card${collapsedCls}" id="csPNoteCard" data-note-state="view">
        <div class="cs-pnote-card-hd">
          <div class="meta">
            <span class="ts"><b>Created</b> ${esc(created)}${updated ? `<br><b>Updated</b> ${esc(updated)}` : ''}</span>
          </div>
          <div class="cs-pnote-actions">
            <button type="button" id="csPNoteToggle" title="${note.collapsed ? 'Expand' : 'Collapse'}"><i class="ti ti-chevron-${note.collapsed ? 'down' : 'up'}"></i></button>
            <button type="button" id="csPNoteEdit" title="Edit"><i class="ti ti-pencil"></i></button>
            <button type="button" id="csPNoteDelete" title="Delete"><i class="ti ti-trash"></i></button>
          </div>
        </div>
        <div class="cs-pnote-body-wrap">
          <div class="cs-pnote-display" id="csPNoteDisplay">${note.html || ''}</div>
        </div>
      </div>`;
    }

    function renderPersonalNotePanel(personalMap) {
      const host = $('#csPersonalNoteBody');
      if (!host) return;
      const note = personalNoteOf(personalMap);
      if (!note) {
        host.innerHTML = `<button type="button" class="cs-pnote-empty-cta" id="csPNoteCreate"><i class="ti ti-plus"></i> Write a personal note</button>`;
        const btn = $('#csPNoteCreate');
        if (btn) btn.addEventListener('click', () => { host.innerHTML = personalNoteComposerHtml(''); wirePersonalNoteComposer(); $('#csPNoteEditable').focus(); });
        return;
      }
      host.innerHTML = personalNoteCardHtml(note);
      wirePersonalNoteActions();
    }

    function currentPersonalNoteStoreRef() {
      // Returns {get, set} helpers bound to the right place — API or localStore — for the
      // current ticket's single personal note belonging to the signed-in agent.
      const uid = String(bootstrap.user.id);
      return {
        async save(html, opts) {
          const isNew = !!(opts && opts.isNew);
          const now = new Date().toISOString();
          if (useApi) {
            return api('/cases/' + selectedId + '/notes/personal', { method: 'PUT', body: JSON.stringify({ html }) });
          }
          const d = localStore[selectedId] || (localStore[selectedId] = { thread: [], notes: { team: [], personal: {} }, assignmentLog: [] });
          if (!d.notes) d.notes = { team: [], personal: {} };
          if (!d.notes.personal || Array.isArray(d.notes.personal)) d.notes.personal = {};
          const existing = d.notes.personal[uid];
          d.notes.personal[uid] = {
            authorId: bootstrap.user.id,
            html,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
            collapsed: existing ? existing.collapsed : false,
          };
          return d.notes.personal[uid];
        },
        async remove() {
          if (useApi) return api('/cases/' + selectedId + '/notes/personal', { method: 'DELETE' });
          const d = localStore[selectedId];
          if (d && d.notes && d.notes.personal) delete d.notes.personal[uid];
        },
        async toggleCollapsed(val) {
          if (useApi) return api('/cases/' + selectedId + '/notes/personal', { method: 'PATCH', body: JSON.stringify({ collapsed: val }) });
          const d = localStore[selectedId];
          if (d && d.notes && d.notes.personal && d.notes.personal[uid]) d.notes.personal[uid].collapsed = val;
        },
      };
    }

    function setPersonalNoteSaveState(state) {
      const el2 = $('#csPNoteSaveState');
      if (!el2) return;
      if (state === 'saving') { el2.className = 'cs-pnote-savestate saving'; el2.innerHTML = '<i class="ti ti-loader-2"></i> Saving…'; }
      else if (state === 'saved') { el2.className = 'cs-pnote-savestate saved'; el2.innerHTML = '<i class="ti ti-check"></i> Saved'; }
      else { el2.className = 'cs-pnote-savestate'; el2.innerHTML = ''; }
    }

    function schedulePersonalNoteAutosave() {
      personalNoteDirty = true;
      setPersonalNoteSaveState('saving');
      if (personalNoteSaveTimer) clearTimeout(personalNoteSaveTimer);
      personalNoteSaveTimer = setTimeout(async () => {
        const editable = $('#csPNoteEditable');
        if (!editable) return;
        try {
          await currentPersonalNoteStoreRef().save(editable.innerHTML);
          personalNoteDirty = false;
          setPersonalNoteSaveState('saved');
          if (lastCaseData) {
            const fresh = await fetchCase(selectedId);
            lastCaseData.notes = fresh.notes;
          }
        } catch (e) { toast(e.message || 'Could not save personal note'); }
      }, 600);
    }

    function wirePersonalNoteComposer() {
      const editable = $('#csPNoteEditable');
      if (!editable) return;
      editable.addEventListener('input', schedulePersonalNoteAutosave);
      editable.addEventListener('blur', async () => {
        // Flush immediately on blur so leaving the panel never loses the latest keystrokes.
        if (personalNoteSaveTimer) clearTimeout(personalNoteSaveTimer);
        try {
          await currentPersonalNoteStoreRef().save(editable.innerHTML);
          setPersonalNoteSaveState('saved');
        } catch (e) {}
      });
      $('#csPNoteCard').querySelectorAll('[data-cmd]').forEach((btn) => {
        btn.addEventListener('click', () => {
          editable.focus();
          document.execCommand(btn.dataset.cmd, false, null);
          schedulePersonalNoteAutosave();
        });
      });
      const attachBtn = $('#csPNoteAttachBtn');
      if (attachBtn) attachBtn.addEventListener('click', () => $('#csPersonalNoteFile').click());
    }
    async function handleTeamNoteSubmit() {
  const body = $('#csNoteInput').value.trim();
  if (!body || !selectedId) return;

  try {
    if (useApi) {
      const endpoint = '/cases/' + selectedId + '/notes';
      if (editingNoteId) {
        await api(endpoint + '/' + editingNoteId, { 
          method: 'PATCH', 
          body: JSON.stringify({ body, attachments: notePendingAttachments, kind: 'team' }) 
        });
      } else {
        await api(endpoint, { 
          method: 'POST', 
          body: JSON.stringify({ body, attachments: notePendingAttachments, kind: 'team' }) 
        });
      }
    } else {
      // Local development simulation stream mutation
      const d = localStore[selectedId] || (localStore[selectedId] = { thread: [], notes: { team: [], personal: {} }, assignmentLog: [] });
      if (!d.notes || Array.isArray(d.notes)) d.notes = { team: [], personal: {} };
      
      if (editingNoteId) {
        const n = d.notes.team.find((x) => x.id === editingNoteId);
        if (n) { n.body = body; n.attachments = notePendingAttachments.slice(); }
      } else {
        d.notes.team.push({ 
          id: Date.now(), 
          authorId: bootstrap.user.id || 1, 
          authorName: bootstrap.user.name || 'You', 
          body, 
          attachments: notePendingAttachments.slice(), // 👈 Captures files+images
          canEdit: true, 
          createdAt: new Date().toISOString() 
        });
      }
    }

    // Resetting inputs fields state channels cleanly
    $('#csNoteInput').value = '';
    notePendingAttachments = [];
    editingNoteId = null;
    $('#csNoteSave').textContent = 'Add note';
    renderPendingAtts();
    
    toast('Team note saved successfully');
    refreshCase(selectedId, { resetDrafts: false });
  } catch (e) { 
    toast(e.message); 
  }
}

    function wirePersonalNoteActions() {
      const toggleBtn = $('#csPNoteToggle');
      if (toggleBtn) toggleBtn.addEventListener('click', async () => {
        const card = $('#csPNoteCard');
        const collapsed = !card.classList.contains('collapsed');
        card.classList.toggle('collapsed', collapsed);
        toggleBtn.innerHTML = `<i class="ti ti-chevron-${collapsed ? 'down' : 'up'}"></i>`;
        toggleBtn.title = collapsed ? 'Expand' : 'Collapse';
        try { await currentPersonalNoteStoreRef().toggleCollapsed(collapsed); } catch (e) {}
      });
      const editBtn = $('#csPNoteEdit');
      if (editBtn) editBtn.addEventListener('click', async () => {
        const data = lastCaseData || await fetchCase(selectedId);
        const note = personalNoteOf(data.notes?.personal);
        const host = $('#csPersonalNoteBody');
        host.innerHTML = personalNoteComposerHtml(note ? note.html : '');
        wirePersonalNoteComposer();
        const editable = $('#csPNoteEditable');
        editable.focus();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
      const delBtn = $('#csPNoteDelete');
      if (delBtn) delBtn.addEventListener('click', async () => {
        if (!confirm('Delete your personal note? This cannot be undone.')) return;
        try {
          await currentPersonalNoteStoreRef().remove();
          toast('Personal note deleted');
          refreshCase(selectedId, { resetDrafts: false });
        } catch (e) { toast(e.message || 'Could not delete personal note'); }
      });
    }


    // Triggered on #csCompose submission or direct click
async function handleCustomerReplySubmit() {
  if (slashActive) return;
  const text = $('#csReply').value.trim();
  if (!text || !selectedId) return;
  if (pendingReply) { toast('Already sending a reply — wait or undo first'); return; }

  const item = queue.find((c) => c.id === selectedId);
  $('#csReply').value = '';

  // 🟢 Snapshot capture handles both files & images safely
  const replyAttsSnapshot = replyPendingAttachments.slice();
  replyPendingAttachments = [];
  renderReplyPendingAtts();

  // Local state preview simulation mapping
  const msgId = 'pending-' + Date.now();
  const d = localStore[selectedId] || (localStore[selectedId] = { thread: [], notes: { team: [], personal: [] }, assignmentLog: [] });
  
  d.thread.push({ 
    id: msgId, 
    dir: 'out', 
    who: 'You', 
    at: 'Just now', 
    createdAt: new Date().toISOString(), 
    body: text, 
    attachments: replyAttsSnapshot, // 👈 Pushed inside local UI layer instantly
    pending: true 
  });

  if (selectedId) refreshCase(selectedId, { resetDrafts: false });

  // Start back-end API persistence call sequence
  try {
    if (useApi) {
      await api('/cases/' + selectedId + '/reply', { 
        method: 'POST', 
        body: JSON.stringify({ body: text, attachments: replyAttsSnapshot }) 
      });
    }
    toast('Reply sent successfully ✓');
    await loadQueue();
  } catch (err) {
    toast('Error: ' + err.message);
  }
}

    async function fetchCase(id) {
      if (useApi) return api('/cases/' + encodeURIComponent(id));
      const item = queue.find((c) => c.id === id) || SAMPLE_QUEUE.find((c) => c.id === id);
      const detail = localStore[id] || { thread: [], order: {}, details: { status: item?.status, priority: 'Normal', opened: '—', channel: '—', assignee: 'You', matched: item?.matched }, notes: { team: [], personal: {} }, assignmentLog: [], statusLog: [] };
      if (Array.isArray(detail.notes)) detail.notes = { team: detail.notes, personal: {} };
      if (Array.isArray(detail.notes.personal)) {
        // Migrate legacy array-of-personal-notes shape to one-note-per-author.
        const map = {};
        detail.notes.personal.forEach((n) => { map[String(n.authorId)] = n; });
        detail.notes.personal = map;
      }
      if (!detail.notes.personal) detail.notes.personal = {};
      return { case: item, ...detail };
    }

    async function openCase(id) {
      if (personalNoteSaveTimer) {
        clearTimeout(personalNoteSaveTimer);
        const prevEditable = $('#csPNoteEditable');
        if (prevEditable && personalNoteDirty && selectedId) {
          try { await currentPersonalNoteStoreRef().save(prevEditable.innerHTML); } catch (e) {}
        }
        personalNoteDirty = false;
      }
      selectedId = id;
      unreadIds.delete(id);
      renderQueue();
      showWorkView('case');
      setMidTab('reply');
      await refreshCase(id, { resetDrafts: true });
    }

    async function refreshCase(id, opts) {
      const resetDrafts = !!(opts && opts.resetDrafts);
      try {
        const data = await fetchCase(id);
        lastCaseData = data;
        const item = data.case || queue.find((c) => c.id === id);
        if (!item) { toast('Could not load case.'); return; }
        $('#csCaseTitle').textContent = item.subject;
        $('#csCaseMeta').textContent = item.customer + ' · ' + (PLATFORM_LABELS[item.platform] || item.platform) + ' · ' + item.caseRef;
        $('#csCaseAssignee').innerHTML = assigneeBadgeHtml(item.assigneeId);
        const sla = slaInfo(item.slaDueAt);
        $('#csCaseSla').textContent = sla.text;
        $('#csCaseSla').className = 'cs-case-sla ' + sla.cls;
        const status = item.status || data.details?.status || 'new_ticket';
        $('#csStatusSel').value = status;
        applyStatusColor('#csStatusSel', status);
        const matched = data.details ? !!data.details.matched : !!item.matched;
        const reassignBtn = $('#csReassign');
        const isUnassigned = item.assigneeId == null;
        const isTeamLead = !!bootstrap.permissions.assign;
        // Any agent can assign/claim any ticket regardless of matched status.
        // Reassigning an already-assigned ticket is restricted to Team Leaders.
        const canActOnAssignment = isUnassigned || isTeamLead;
        reassignBtn.disabled = !canActOnAssignment;
        reassignBtn.textContent = '';
        reassignBtn.innerHTML = `<i class="ti ti-user-share"></i> ${isUnassigned ? 'Assign' : 'Reassign'}`;
        reassignBtn.title = canActOnAssignment
          ? (isUnassigned ? 'Assign this ticket to an agent' : 'Reassign ticket')
          : 'Only Team Leaders can reassign an already-assigned ticket';
        $('#csThread').innerHTML = renderTimeline(data);
        // Remove "Latest" badge once the newest message is seen — small delay so badge is visible briefly
        (function watchNewest() {
          const threadEl = $('#csThread');
          const newestEl = threadEl && threadEl.querySelector('.cs-msg-newest, .cs-tl-note-newest');
          if (!newestEl) return;
          // Start observing after a short grace period so badge is visible on open
          setTimeout(() => {
            const obs = new IntersectionObserver((entries) => {
              entries.forEach(entry => {
                if (entry.isIntersecting) {
                  obs.disconnect();
                  newestEl.classList.remove('cs-msg-newest', 'cs-tl-note-newest');
                  const badge = newestEl.querySelector('.cs-msg-newest-badge');
                  if (badge) {
                    badge.style.transition = 'opacity .3s';
                    badge.style.opacity = '0';
                    setTimeout(() => badge.remove(), 300);
                  }
                }
              });
            }, { root: threadEl, threshold: 0.6 });
            obs.observe(newestEl);
          }, 1500); // 1.5s grace so agent sees the badge on ticket open
        })();
        $('#csOrderBody').innerHTML = renderOrder(data.order);
        await renderOrderHistory(data.order);
        $('#csDetails').innerHTML = renderDetails(data.details, item);
        renderCaseBadges(await fetchOrderCases(id));
        renderNotes(data.notes);
        renderPersonalNotePanel(data.notes?.personal);
        $('#csAuditLog').innerHTML = renderAudit(data.assignmentLog);
        renderPresencePanel();
        updateConflictBanner();
        wireNoteActions();
        wireMatchForm(id);
        if (resetDrafts) {
          $('#csReply').value = '';
          $('#csNoteInput').value = '';
          notePendingAttachments = [];
          renderPendingAtts();
          editingNoteId = null;
          $('#csNoteSave').textContent = 'Add note';
        }
        const th = $('#csThread');
        th.scrollTop = th.scrollHeight; // scroll to bottom — newest message near compose box
      } catch (e) {
        toast(e.message || 'Failed to load case');
      }
    }

    function wireNoteActions() {
      const listEl = $('#csTeamNoteList');
      if (listEl) {
        listEl.querySelectorAll('[data-edit-note]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const nid = parseInt(btn.dataset.editNote, 10);
            const data = lastCaseData || await fetchCase(selectedId);
            const notesList = (data.notes && data.notes.team) ? data.notes.team : [];
            const note = notesList.find((n) => n.id === nid);
            if (!note) return;
            editingNoteId = nid;
            $('#csNoteInput').value = note.body;
            notePendingAttachments = (note.attachments || []).slice();
            renderPendingAtts();
            $('#csNoteSave').textContent = 'Save note';
            $('#csNoteInput').focus();
          });
        });
        listEl.querySelectorAll('[data-del-note]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('Delete this note?')) return;
            const nid = btn.dataset.delNote;
            try {
              if (useApi) await api('/cases/' + selectedId + '/notes/' + nid + '?kind=team', { method: 'DELETE' });
              else {
                const d = localStore[selectedId];
                if (d && d.notes && d.notes.team) d.notes.team = d.notes.team.filter((n) => String(n.id) !== String(nid));
              }
              refreshCase(selectedId, { resetDrafts: false });
              toast('Note deleted');
            } catch (e) { toast(e.message); }
          });
        });
      }
    }

    function wireMatchForm(caseId) {
      const btn = $('#csMatchConfirm');
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const platform = $('#csMatchPlatform').value;
        const ref = $('#csMatchOrderRef').value.trim();
        if (!ref) { toast('Enter an order or case reference first'); return; }
        btn.disabled = true;
        try {
          if (useApi) {
            await api('/cases/' + caseId + '/match', { method: 'POST', body: JSON.stringify({ platform, order_ref: ref }) });
          } else {
            const queueItem = queue.find((c) => c.id === caseId) || SAMPLE_QUEUE.find((c) => c.id === caseId);
            if (queueItem) { queueItem.matched = true; queueItem.platform = platform; queueItem.caseRef = ref; }
            const d = localStore[caseId];
            if (d) {
              d.details.matched = true;
              d.details.channel = PLATFORM_LABELS[platform] || platform;
              d.order = d.order || {};
              d.order.external = ref;
              d.statusLog = d.statusLog || [];
              d.statusLog.push({ at: new Date().toISOString(), actorName: bootstrap.user.name, sysType: 'match', platform: PLATFORM_LABELS[platform] || platform });
            }
          }
          toast('Ticket matched — now assignable');
          await loadQueue();
          refreshCase(caseId, { resetDrafts: false });
        } catch (e) {
          toast(e.message || 'Failed to match ticket');
          btn.disabled = false;
        }
      });
    }

    function showWorkView(which) {
      $('#csEmpty').style.display = which === 'case' ? 'none' : '';
      $('#csCase').classList.toggle('show', which === 'case');
      $('#csTplView').classList.toggle('show', which === 'templates');
    }

    // ---------------------------------------------------------------------
    // Templates: insert menu (button + slash command) + full-screen manager
    // with categories, favorites, search, duplicate, keyboard shortcuts.
    // ---------------------------------------------------------------------
    function tplMatches(t, q) {
      if (!q) return true;
      q = q.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
    }

    // ---------------------------------------------------------------------
    // Dynamic placeholders. {{customer}} is kept as a legacy alias for
    // {{customer_name}} so existing saved templates keep working.
    // ---------------------------------------------------------------------
    function resolvePlaceholders(body) {
      const item = queue.find((c) => c.id === selectedId) || SAMPLE_QUEUE.find((c) => c.id === selectedId);
      const order = (lastCaseData && lastCaseData.order) || {};
      const values = {
        customer_name: item?.customer || 'there',
        order_number: order.external || order.ref || '—',
        tracking_number: order.tracking || order.trackingNumber || '—',
        agent_name: (bootstrap.user && bootstrap.user.name) || 'You',
      };
      return body
        .replace(/\{\{\s*customer\s*\}\}/g, values.customer_name)
        .replace(/\{\{\s*customer_name\s*\}\}/g, values.customer_name)
        .replace(/\{\{\s*order_number\s*\}\}/g, values.order_number)
        .replace(/\{\{\s*tracking_number\s*\}\}/g, values.tracking_number)
        .replace(/\{\{\s*agent_name\s*\}\}/g, values.agent_name);
    }

    function trackRecentlyUsedTemplate(tplId) {
      recentTemplateIds = [tplId, ...recentTemplateIds.filter((id) => String(id) !== String(tplId))].slice(0, 12);
      try {
        if (useApi) api('/templates/' + tplId + '/touch', { method: 'POST' }).catch(() => {});
      } catch (e) {}
    }

   function insertTemplateIntoReply(tpl, replaceRange) {
    // 1. Apply string filter after placeholders are resolved
    let body = resolvePlaceholders(tpl.body);
    
    // 🟢 Convert literal '\n' strings into real line-breaks (newlines)
    body = body.replace(/\\n/g, '\n');

    const ta = $('#csReply');
    if (!ta) return; // Fail-safe fallback

    if (replaceRange) {
      const before = ta.value.slice(0, replaceRange.start);
      const after = ta.value.slice(replaceRange.end);
      ta.value = before + body + after;
      const caret = before.length + body.length;
      ta.setSelectionRange(caret, caret);
    } else {
      ta.value = ta.value ? ta.value + '\n\n' + body : body;
    }
    
    ta.focus();
    trackRecentlyUsedTemplate(tpl.id);
  }
    function renderTplMenu(query) {
      const list = $('#csTplList');
      const filtered = templates.filter((t) => tplMatches(t, query));
      if (!filtered.length) { list.innerHTML = `<div class="cs-tpl-empty">No templates match${query ? ` "${esc(query)}"` : ''}.</div>`; return; }
      list.innerHTML = filtered.map((t) => `<button type="button" data-tpl-id="${t.id}"><span class="tt">${t.favorite ? '<i class="ti ti-star-filled fav"></i>' : ''}${esc(t.title)}</span><span class="tb">${esc(t.body)}</span></button>`).join('');
      list.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tpl = templates.find((t) => String(t.id) === btn.dataset.tplId);
          if (!tpl) return;
          insertTemplateIntoReply(tpl, null);
          $('#csTplMenu').classList.remove('show');
          $('#csTplSearch').value = '';
        });
      });
    }

    // ---- Slash commands ----
    function closeSlashMenu() { slashActive = false; slashStart = -1; $('#csSlashMenu').classList.remove('show'); }

    function renderSlashList(query) {
      const list = $('#csSlashList');
      const filtered = templates.filter((t) => tplMatches(t, query));
      if (!filtered.length) { list.innerHTML = `<div class="cs-tpl-empty">No templates match "${esc(query)}"</div>`; slashHighlight = -1; return; }
      slashHighlight = Math.max(0, Math.min(slashHighlight, filtered.length - 1));
      list.innerHTML = filtered.map((t, i) => `<button type="button" class="${i === slashHighlight ? 'active' : ''}" data-tpl-id="${t.id}"><span class="tt">${t.favorite ? '<i class="ti ti-star-filled fav"></i>' : ''}${esc(t.title)}</span><span class="tb">${esc(t.body)}</span></button>`).join('');
      list.querySelectorAll('button').forEach((btn, i) => {
        btn.addEventListener('mouseenter', () => { slashHighlight = i; renderSlashList(query); });
        btn.addEventListener('click', () => commitSlashSelection(filtered[i]));
      });
    }

    function commitSlashSelection(tpl) {
      if (!tpl) return;
      const ta = $('#csReply');
      insertTemplateIntoReply(tpl, { start: slashStart, end: ta.selectionStart });
      closeSlashMenu();
    }

    function checkSlashTrigger() {
      const ta = $('#csReply');
      const val = ta.value;
      const pos = ta.selectionStart;
      const upTo = val.slice(0, pos);
      const m = upTo.match(/(?:^|\s)\/([^\s/]{0,40})$/);
      if (!m) { if (slashActive) closeSlashMenu(); return; }
      slashActive = true;
      slashStart = pos - m[0].length + (m[0][0] === '/' ? 0 : 1);
      slashHighlight = 0;
      renderSlashList(m[1]);
      $('#csSlashMenu').classList.add('show');
    }

    // ---- Full-screen template manager ----
    function templateCounts() {
      const counts = {};
      categories.forEach((c) => { counts[c] = 0; });
      let fav = 0;
      templates.forEach((t) => { counts[t.category] = (counts[t.category] || 0) + 1; if (t.favorite) fav++; });
      return { byCat: counts, fav, total: templates.length };
    }

    function renderTplCatBar() {
      const counts = templateCounts();
      const recentCount = recentTemplateIds.filter((id) => templates.some((t) => String(t.id) === String(id))).length;
      const chips = [
        { key: 'all', label: 'All', cnt: counts.total, icon: 'ti-apps' },
        { key: 'favorites', label: 'Favorites', cnt: counts.fav, icon: 'ti-star-filled' },
        { key: 'recent', label: 'Recently Used', cnt: recentCount, icon: 'ti-clock' },
        ...categories.map((c) => ({ key: c, label: c, cnt: counts.byCat[c] || 0, color: categoryColor(c) })),
      ];
      $('#csTplCatBar').innerHTML = chips.map((c) => {
        const isOn = tplCat === c.key;
        let style = '';
        if (c.color) {
          style = isOn
            ? `background:linear-gradient(135deg,${c.color.b},${c.color.a});`
            : `border-color:${c.color.a};color:${c.color.fg};background:${c.color.bg}`;
        }
        return `<button type="button" class="cs-tpl-cat-chip${isOn ? ' on' : ''}" data-cat="${esc(c.key)}" style="${style}">${c.icon ? `<i class="ti ${c.icon}"></i> ` : ''}${esc(c.label)} <span class="cnt">${c.cnt}</span></button>`;
      }).join('');
      $('#csTplCatBar').querySelectorAll('.cs-tpl-cat-chip').forEach((btn) => {
        btn.addEventListener('click', () => { tplCat = btn.dataset.cat; renderTplCatBar(); renderTplGrid($('#csTplViewSearch').value.trim()); });
      });
    }
    
    // A fixed, vivid palette cycled deterministically by category name so every
    // category — including ones agents create later — gets its own colour,
    // and the same category always renders the same colour everywhere
    // (card border, icon chip, category select, filter chips). Agents can
    // override this per-template with their own pick (see colorSetFromHex).
    const TPL_PALETTE = [
      { a: '#E8722B', b: '#F3992E', bg: '#FFF1E2', fg: '#B5630F' },  // amber/orange
      { a: '#1A4FB5', b: '#3E7BFF', bg: '#E8F0FE', fg: '#1A4FB5' },  // blue
      { a: '#A32D2D', b: '#D5564F', bg: '#FCEBEB', fg: '#A32D2D' },  // red
      { a: '#157A55', b: '#2BAE7E', bg: '#E1F5EE', fg: '#157A55' },  // green
      { a: '#6B3FA0', b: '#9466CE', bg: '#F1EAFB', fg: '#6B3FA0' },  // purple
      { a: '#0F8A8A', b: '#2BC2C2', bg: '#E2F7F7', fg: '#0F7A7A' },  // teal
      { a: '#B5630F', b: '#E0922F', bg: '#FBF0DD', fg: '#8A6A1E' },  // gold
      { a: '#C23B6E', b: '#E06B97', bg: '#FCEAF1', fg: '#A8316A' },  // pink
    ];
    function categoryColor(name) {
      const s = String(name || 'General');
      let hash = 0;
      for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
      return TPL_PALETTE[hash % TPL_PALETTE.length];
    }
    // Derives the same {a,b,bg,fg} shape the rest of the UI expects (border/
    // gradient-start/light-bg-tint/readable-text) from a single hex an agent
    // picked, so a custom colour drops into every existing card/chip style
    // without needing separate CSS paths.
    function hexToRgb(hex) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
      if (!m) return { r: 232, g: 114, b: 43 };
      return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
    }
    function shadeHex(hex, percent) {
      const { r, g, b } = hexToRgb(hex);
      const t = percent < 0 ? 0 : 255;
      const p = Math.abs(percent);
      const f = (c) => Math.round((t - c) * p) + c;
      return '#' + [f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
    }
    function relativeLuminance(hex) {
      const { r, g, b } = hexToRgb(hex);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    function colorSetFromHex(hex) {
      const a = hex;
      const b = shadeHex(hex, 0.22);   // lighter, for gradient highlight
      const bg = shadeHex(hex, 0.88);  // very light tint for chip/card backgrounds
      // Text needs to stay readable on the light tint background, so keep fg
      // close to the picked hue but darken it if the raw colour is too pale.
      const fg = relativeLuminance(hex) > 0.7 ? shadeHex(hex, -0.35) : hex;
      return { a, b, bg, fg };
    }
    // Per-template colour override. Falls back to the deterministic
    // category colour when the agent hasn't picked one for this template.
    function templateColor(t) {
      if (t && t.color) return colorSetFromHex(t.color);
      return categoryColor(t ? t.category : null);
    }

    // -----------------------------------------------------------------------
    // Shared Gmail-label-style colour picker: a small popover with a grid of
    // preset swatches plus a native colour input for anything custom. Used
    // by both per-template colours and per-status colours so the picking
    // experience is identical everywhere in the app.
    // -----------------------------------------------------------------------
    const COLOR_SWATCH_PRESETS = [
      '#E8722B', '#F3992E', '#B5630F', '#A32D2D', '#D5564F', '#C23B6E',
      '#6B3FA0', '#534AB7', '#1A4FB5', '#3E7BFF', '#0F8A8A', '#2BAE7E',
      '#157A55', '#34B27B', '#8A6A1E', '#6B6B66',
    ];
    let activeColorPopover = null;
    function closeColorPopover() {
      if (activeColorPopover) { activeColorPopover.remove(); activeColorPopover = null; }
      document.removeEventListener('mousedown', onColorPopoverOutsideClick, true);
    }
    function onColorPopoverOutsideClick(e) {
      if (activeColorPopover && !activeColorPopover.contains(e.target)) closeColorPopover();
    }
    // anchorEl: element the popover hangs off; currentHex: pre-selected swatch;
    // onPick(hex|null): called with a hex string when chosen, or null for "reset to default".
    function openColorPopover(anchorEl, currentHex, onPick) {
      closeColorPopover();
      const pop = document.createElement('div');
      pop.className = 'cs-color-pop';
      pop.innerHTML = `
        <div class="cs-color-pop-grid">
          ${COLOR_SWATCH_PRESETS.map((hex) => `<button type="button" class="cs-color-sw${String(currentHex || '').toLowerCase() === hex.toLowerCase() ? ' on' : ''}" style="background:${hex}" data-hex="${hex}" title="${hex}"></button>`).join('')}
        </div>
        <div class="cs-color-pop-foot">
          <label class="cs-color-custom"><input type="color" value="${esc(currentHex || '#E8722B')}"><span>Custom</span></label>
          <button type="button" class="cs-color-reset"><i class="ti ti-restore"></i> Reset</button>
        </div>`;
      document.body.appendChild(pop);
      const rect = anchorEl.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      let top = rect.bottom + 6;
      let left = rect.left;
      if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
      if (top + popRect.height > window.innerHeight - 8) top = rect.top - popRect.height - 6;
      pop.style.top = top + window.scrollY + 'px';
      pop.style.left = left + window.scrollX + 'px';
      pop.querySelectorAll('.cs-color-sw').forEach((sw) => {
        sw.addEventListener('click', () => { onPick(sw.dataset.hex); closeColorPopover(); });
      });
      pop.querySelector('.cs-color-custom input').addEventListener('input', (e) => { onPick(e.target.value); });
      pop.querySelector('.cs-color-reset').addEventListener('click', () => { onPick(null); closeColorPopover(); });
      activeColorPopover = pop;
      document.addEventListener('mousedown', onColorPopoverOutsideClick, true);
    }

    function categorySelectOptions(selected) {
      return categories.map((c) => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c)}</option>`).join('');
    }

    function renderTplGrid(query) {
      if (!bootstrap.permissions.templates) { $('#csTplGrid').innerHTML = '<div class="cs-loading">You don\'t have permission to manage templates.</div>'; return; }
      let rows = templates;
      if (tplCat === 'favorites') rows = rows.filter((t) => t.favorite);
      else if (tplCat === 'recent') {
        rows = recentTemplateIds.map((id) => templates.find((t) => String(t.id) === String(id))).filter(Boolean);
      } else if (tplCat !== 'all') rows = rows.filter((t) => t.category === tplCat);
      if (query) rows = rows.filter((t) => tplMatches(t, query));

      if (!rows.length) {
        $('#csTplGrid').innerHTML = tplCat === 'recent'
          ? '<div class="cs-loading">No templates used yet this session.</div>'
          : '<div class="cs-loading">No templates here yet.</div>';
        renderTplPreview(null);
        return;
      }
      if (!rows.some((t) => String(t.id) === String(selectedTplId))) selectedTplId = rows[0].id;
      const ordered = [...rows].sort((a, b) => (String(a.id) === String(selectedTplId) ? -1 : String(b.id) === String(selectedTplId) ? 1 : 0));
      $('#csTplGrid').innerHTML = ordered.map((t) => {
        const col = templateColor(t);
        const isSel = String(t.id) === String(selectedTplId);
        const bodyPreview = (t.body || '').slice(0, 220);
        return `
        <div class="cs-tpl-card${isSel ? ' selected expanded' : ''}" data-tpl-id="${t.id}" style="--cat-a:${col.a};--cat-b:${col.b};--cat-bg:${col.bg};--cat-fg:${col.fg}">
          <div class="cs-tpl-card-hd">
            <button type="button" class="tpl-icon${t.favorite ? ' fav-on' : ''}" data-fav-toggle title="Favorite"><i class="ti ti-star${t.favorite ? '-filled' : ''}" aria-hidden="true"></i></button>
            <button type="button" class="tpl-color-sw-btn" data-color-toggle title="Set colour" style="background:${esc(col.a)}"></button>
            <input class="cs-tpl-title" value="${esc(t.title)}" placeholder="Template title" aria-label="Template title">
            <select class="cs-tpl-cat-sel">${categorySelectOptions(t.category || categories[0])}</select>
          </div>
          ${isSel
            ? `<textarea class="cs-tpl-body cs-tpl-body-lg" placeholder="Write the full template body here…" aria-label="Template body">${esc(t.body)}</textarea>`
            : `<div class="cs-tpl-body-preview" data-expand-card>${esc(bodyPreview)}${(t.body || '').length > 220 ? '…' : ''}</div>`}
          <div class="cs-tpl-card-foot">
            ${isSel ? `<button type="button" class="cs-tpl-save"><i class="ti ti-device-floppy"></i> Save</button>` : `<button type="button" class="cs-tpl-view" data-expand-card><i class="ti ti-eye"></i> View / Edit</button>`}
            <button type="button" class="cs-tpl-dup"><i class="ti ti-copy"></i> Duplicate</button>
            <button type="button" class="cs-tpl-del"><i class="ti ti-trash"></i> Delete</button>
          </div>
        </div>`;
      }).join('');

      $('#csTplGrid').querySelectorAll('.cs-tpl-card').forEach((card) => {
        const id = card.dataset.tplId;
        function expandThisCard() {
          if (String(selectedTplId) === id) { scrollCardIntoView(id); return; }
          selectedTplId = id;
          renderTplGrid(query);
          scrollCardIntoView(id);
        }
        card.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea')) return;
          expandThisCard();
        });
        const bodyTextarea = card.querySelector('.cs-tpl-body');
        if (bodyTextarea) {
          setupTextareaAutoResize(bodyTextarea);
          bodyTextarea.addEventListener('input', (e) => {
            renderTplPreview({ ...templates.find((t) => String(t.id) === id), body: e.target.value });
          });
        }
        card.querySelectorAll('[data-expand-card]').forEach((trigger) => trigger.addEventListener('click', expandThisCard));
        card.querySelector('[data-fav-toggle]').addEventListener('click', async (e) => {
          e.stopPropagation();
          const t = templates.find((x) => String(x.id) === id);
          if (!t) return;
          t.favorite = !t.favorite;
          try { if (useApi) await api('/templates/' + id, { method: 'PATCH', body: JSON.stringify({ favorite: t.favorite }) }); } catch (e) {}
          renderTplCatBar();
          renderTplGrid($('#csTplViewSearch').value.trim());
        });
        const colorBtn = card.querySelector('[data-color-toggle]');
        if (colorBtn) colorBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const t = templates.find((x) => String(x.id) === id);
          if (!t) return;
          openColorPopover(colorBtn, t.color || null, async (hex) => {
            t.color = hex || null;
            try { if (useApi) await api('/templates/' + id, { method: 'PATCH', body: JSON.stringify({ color: t.color }) }); } catch (err) {}
            renderTplGrid($('#csTplViewSearch').value.trim());
          });
        });
        const saveBtn = card.querySelector('.cs-tpl-save');
        if (saveBtn) saveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const title = card.querySelector('.cs-tpl-title').value.trim();
          const bodyEl = card.querySelector('.cs-tpl-body');
          const t = templates.find((x) => String(x.id) === id);
          const body = bodyEl ? bodyEl.value : (t ? t.body : '');
          const category = card.querySelector('.cs-tpl-cat-sel').value;
          try {
            if (useApi) await api('/templates/' + id, { method: 'PATCH', body: JSON.stringify({ title, body, category }) });
            else { if (t) { t.title = title; t.body = body; t.category = category; } }
            toast('Template saved');
            if (useApi) templates = (await api('/templates')).templates;
            renderTplCatBar();
            renderTplGrid($('#csTplViewSearch').value.trim());
            renderTplMenu($('#csTplSearch').value.trim());
          } catch (e) { toast(e.message); }
        });
        card.querySelector('.cs-tpl-dup').addEventListener('click', async (e) => {
          e.stopPropagation();
          const t = templates.find((x) => String(x.id) === id);
          if (!t) return;
          const copy = { ...t, id: Date.now(), title: t.title + ' (copy)', favorite: false };
          try {
            if (useApi) { await api('/templates', { method: 'POST', body: JSON.stringify(copy) }); templates = (await api('/templates')).templates; }
            else templates.push(copy);
            toast('Template duplicated');
            selectedTplId = copy.id;
            renderTplCatBar();
            renderTplGrid($('#csTplViewSearch').value.trim());
            renderTplMenu($('#csTplSearch').value.trim());
            scrollCardIntoView(copy.id);
          } catch (e) { toast(e.message); }
        });
        card.querySelector('.cs-tpl-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this template?')) return;
          try {
            if (useApi) await api('/templates/' + id, { method: 'DELETE' });
            else templates = templates.filter((x) => String(x.id) !== id);
            recentTemplateIds = recentTemplateIds.filter((rid) => String(rid) !== id);
            toast('Template deleted');
            if (useApi) templates = (await api('/templates')).templates;
            renderTplCatBar();
            renderTplGrid($('#csTplViewSearch').value.trim());
            renderTplMenu($('#csTplSearch').value.trim());
          } catch (e) { toast(e.message); }
        });
      });
      renderTplPreview(templates.find((t) => String(t.id) === String(selectedTplId)));
    }

    function renderTplPreview(tpl) {
      const host = $('#csTplPreview');
      if (!host) return;
      if (!tpl) { host.innerHTML = '<div class="cs-tpl-preview-empty"><i class="ti ti-template"></i> Select a template to preview it</div>'; return; }
      const resolved = resolvePlaceholders(tpl.body || '');
      host.innerHTML = `
        <div class="cs-tpl-preview-hd">
          <span class="cs-tpl-preview-label">Live preview</span>
          ${tpl.favorite ? '<i class="ti ti-star-filled fav" title="Favorite"></i>' : ''}
        </div>
        <div class="cs-tpl-preview-title">${esc(tpl.title || 'Untitled template')}</div>
        <div class="cs-tpl-preview-cat">${esc(tpl.category || '')}</div>
        <div class="cs-tpl-preview-body">${esc(resolved)}</div>
        <div class="cs-tpl-preview-placeholders">
          <span class="ph-lbl">Placeholders used</span>
          ${placeholdersIn(tpl.body || '').map((p) => `<code>{{${esc(p)}}}</code>`).join('') || '<span class="none">None</span>'}
        </div>`;
    }

    function placeholdersIn(body) {
      const found = new Set();
      const re = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
      let m;
      while ((m = re.exec(body))) found.add(m[1] === 'customer' ? 'customer_name' : m[1]);
      return Array.from(found);
    }

    function openTplManager() {
      tplCat = 'all';
      selectedTplId = null;
      $('#csListPane').style.display = 'none';
      showWorkView('templates');
      renderTplCatBar();
      renderTplGrid($('#csTplViewSearch').value.trim());
      setTimeout(() => $('#csTplViewSearch').focus(), 0);
    }

    function renderReplyPendingAtts() {
      const strip = $('#csReplyPendingAtts');
      if (!strip) return;
      strip.style.display = replyPendingAttachments.length ? '' : 'none';
      strip.innerHTML = replyPendingAttachments.map((a, i) => {
        const isImg = a.mime && a.mime.startsWith('image/');
        const thumb = isImg ? `<img src="${esc(a.data)}" alt="">` : `<i class="ti ti-file" style="font-size:18px;color:#4A7AC8"></i>`;
        return `<span class="cs-reply-att-chip${isImg ? '' : ' is-file'}">${thumb}<span class="chip-name">${esc(a.name)}</span><button type="button" class="chip-rm" data-reply-rm="${i}" title="Remove">\xc3\x97</button></span>`;
      }).join('');
      strip.querySelectorAll('[data-reply-rm]').forEach(btn => {
        btn.addEventListener('click', () => { replyPendingAttachments.splice(parseInt(btn.dataset.replyRm, 10), 1); renderReplyPendingAtts(); });
      });
    }

    function renderPendingAtts() {
      $('#csNotePendingAtts').innerHTML = notePendingAttachments.map((a, i) =>
        `<span class="cs-note-att"><img src="${esc(a.data)}" alt=""><button type="button" data-rm-att="${i}" style="border:none;background:none;cursor:pointer;color:#A32D2D;font-size:12px">×</button></span>`
      ).join('');
      $('#csNotePendingAtts').querySelectorAll('[data-rm-att]').forEach((btn) => {
        btn.addEventListener('click', () => { notePendingAttachments.splice(parseInt(btn.dataset.rmAtt, 10), 1); renderPendingAtts(); });
      });
    }

    function teamForMentions() { return (bootstrap.agents && bootstrap.agents.length ? bootstrap.agents : SAMPLE_TEAM); }

    function checkMentionTrigger() {
      const ta = $('#csNoteInput');
      const val = ta.value;
      const pos = ta.selectionStart;
      const upTo = val.slice(0, pos);
      const m = upTo.match(/@([\w .'-]{0,40})$/);
      const menu = $('#csMentionMenu');
      if (!m) { menu.classList.remove('show'); return; }
      const q = m[1].toLowerCase();
      const matches = teamForMentions().filter((a) => a.name.toLowerCase().includes(q));
      if (!matches.length) { menu.classList.remove('show'); return; }
      menu.innerHTML = matches.map((a) => `<button type="button" data-mention-id="${a.id}" data-mention-name="${esc(a.name)}"><span class="av">${esc(initialsOf(a.name))}</span>${esc(a.name)}</button>`).join('');
      menu.classList.add('show');
      menu.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.mentionName;
          const before = upTo.slice(0, upTo.length - m[0].length);
          const after = val.slice(pos);
          ta.value = before + '@' + name + ' ' + after;
          menu.classList.remove('show');
          ta.focus();
          toast(name + ' will be notified');
        });
      });
    }

    // ---------------------------------------------------------------------
    // Undo Send
    // ---------------------------------------------------------------------
    function cancelPendingReply(silent) {
      if (!pendingReply) return;
      clearTimeout(undoTimer);
      clearInterval(undoInterval);
      const restoredText = pendingReply.text;
      const restoredAtts = pendingReply.attachments || [];
      const d = localStore[pendingReply.caseId];
      if (d) d.thread = d.thread.filter((m) => m.id !== pendingReply.msgId);
      if (pendingReply.caseId === selectedId) refreshCase(selectedId, { resetDrafts: false });
      $('#csUndoToast').classList.remove('show');
      pendingReply = null;
      // Restore the reply text and attachments
      const replyEl = $('#csReply');
      if (replyEl && restoredText) { replyEl.value = restoredText; replyEl.focus(); }
      if (restoredAtts.length) { replyPendingAttachments = restoredAtts; renderReplyPendingAtts(); }
      if (!silent) toast('Reply canceled — text restored');
    }

async function commitPendingReply() {
  if (!pendingReply) return;
  const { caseId, text, msgId, attachments: replyAtts } = pendingReply;
  pendingReply = null;
  $('#csUndoToast').classList.remove('show');
  
  try {
    if (useApi) {
      await api('/cases/' + caseId + '/reply', { 
        method: 'POST', 
        body: JSON.stringify({ body: text, attachments: replyAtts || [] }) 
      });
    } else {
      // 🟢 FIX: Local/Simulation storage mein attachments permanently link karein
      const d = localStore[caseId];
      if (d) { 
        const msg = d.thread.find((m) => m.id === msgId); 
        if (msg) {
          msg.pending = false; 
          msg.attachments = replyAtts; // 👈 Ye line lagana zaroori hai!
        }
      }
      const item = (queue.find((c) => c.id === caseId)) || SAMPLE_QUEUE.find((c) => c.id === caseId);
      if (item) item.snippet = text; // Sidebar snippet update karne ke liye
    }
    
    toast('Reply sent successfully ✓');
    await loadQueue();
    if (caseId === selectedId) refreshCase(caseId, { resetDrafts: false });
  } catch (err) { 
    toast(err.message || 'Failed to send reply'); 
  }
}

    function startUndoCountdown(caseId, text, customerName) {
      const msgId = 'pending-' + Date.now();
      const d = localStore[caseId] || (localStore[caseId] = { thread: [], notes: { team: [], personal: [] }, assignmentLog: [] });
      d.thread.push({ id: msgId, dir: 'out', who: 'You', at: 'Just now', createdAt: new Date().toISOString(), body: text, pending: true });
      const replyAttsSnapshot = replyPendingAttachments.slice();
      replyPendingAttachments = [];
      renderReplyPendingAtts();
      pendingReply = { caseId, text, msgId, attachments: replyAttsSnapshot, secondsLeft: 10 };
      if (caseId === selectedId) refreshCase(caseId, { resetDrafts: false });
      $('#csUndoName').textContent = customerName || 'customer';
      const ring = $('#csUndoRing');
      const toastEl = $('#csUndoToast');
      toastEl.classList.add('show');
      function paint() {
        const pct = Math.round(((10 - pendingReply.secondsLeft) / 10) * 100);
        ring.style.setProperty('--p', pct + '%');
        ring.setAttribute('data-s', String(pendingReply.secondsLeft));
        ring.classList.toggle('cs-ring-late', pendingReply.secondsLeft <= 3);
      }
      paint();
      undoInterval = setInterval(() => {
        if (!pendingReply) { clearInterval(undoInterval); return; }
        pendingReply.secondsLeft -= 1;
        paint();
        if (pendingReply.secondsLeft <= 0) clearInterval(undoInterval);
      }, 1000);
      undoTimer = setTimeout(() => { commitPendingReply(); }, 10000);
    }

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------
 function wireNavClicks() {
      el.querySelectorAll('.cs-nav-item[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const view = btn.dataset.view;
          if (!view) return;
          el.querySelectorAll('.cs-nav-item').forEach((b) => b.classList.toggle('on', b === btn));
          if (view === 'templates') { openTplManager(); return; }
          $('#csListPane').style.display = '';
          queueView = view;
          const isStatus = view.startsWith('status:');
          const statusKey = isStatus ? view.slice(7) : null;
          
          // 🟢 ADDED: Structural verification for the 'All Work' view panel
          if (view === 'all_tickets') {
            $('#csListTitle').textContent = 'All Work';
            $('#csListSub').textContent = 'All open cases across the company';
          } else if (isStatus) {
            $('#csListTitle').textContent = statusLabel(statusKey);
            $('#csListSub').textContent = 'All cases with this status';
          } else {
            $('#csListTitle').textContent = view === 'unassigned' ? 'Unassigned' : 'My Work';
            $('#csListSub').textContent = view === 'unassigned' ? 'Unmatched or unassigned tickets' : 'Your assigned cases';
          }
          showWorkView(selectedId ? 'case' : 'none');
          if (!selectedId) { $('#csEmpty').style.display = ''; $('#csCase').classList.remove('show'); }
          loadQueue();
        });
      });
    }
    wireNavClicks();

    // ---- Employees panel ----
    let empFilter = 'all';
    let empSearch = '';
    function renderEmployeeList() {
      const panel = $('#csEmployeeList');
      if (!panel) return;
      const team = (bootstrap.agents && bootstrap.agents.length ? bootstrap.agents : SAMPLE_TEAM);
      const fullList = [];
      if (bootstrap.user) fullList.push({ id: bootstrap.user.id, name: bootstrap.user.name || 'You', is_active: true, role: 'manager' });
      team.forEach(a => { if (String(a.id) !== String(bootstrap.user?.id)) fullList.push(a); });
      const q = empSearch.toLowerCase();
      const filtered = fullList.filter(a => {
        if (q && !(a.name || '').toLowerCase().includes(q)) return false;
        if (empFilter === 'online') return a.is_active !== false;
        if (empFilter === 'offline') return a.is_active === false;
        return true;
      });
      const allTickets = (SAMPLE_QUEUE.length ? SAMPLE_QUEUE : queue);
      panel.innerHTML = filtered.length ? filtered.map(a => {
        const initials = String(a.name || '?').trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
        const isOnline = a.is_active !== false;
        const dotColor = isOnline ? '#34B27B' : '#9b8e7d';
        const role = (a.role || 'Agent').toUpperCase();
        const ticketCount = allTickets.filter(c => String(c.assigneeId) === String(a.id)).length;
        const isActive = queueView === `agent:${a.id}` || (queueView === 'my-work' && String(a.id) === String(bootstrap.user?.id));
        return `<div class="cs-emp-item${isActive ? ' on' : ''}" data-agent-id="${esc(String(a.id))}" data-agent-name="${esc(a.name || 'Agent')}" title="View ${esc(a.name || 'Agent')}'s tickets">
          <span class="av" style="${isOnline ? '' : 'background:#ECECEA;color:#6B6B66'}">${esc(initials)}</span>
          <span class="nm">${esc(a.name || 'Unknown')}</span>
          <span class="role">${esc(role)}</span>
          ${ticketCount > 0 ? `<span class="cs-emp-ticket-cnt">${ticketCount}</span>` : ''}
          <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex:none"></span>
        </div>`;
      }).join('') : '<div style="padding:6px 12px;font-size:12px;color:var(--soft)">No employees found.</div>';

      // Wire click: clicking an employee loads their assigned tickets in the queue
      panel.querySelectorAll('.cs-emp-item[data-agent-id]').forEach(item => {
        item.addEventListener('click', () => {
          const agentId = item.dataset.agentId;
          const agentName = item.dataset.agentName;
          const isSelf = String(agentId) === String(bootstrap.user?.id);
          queueView = isSelf ? 'my-work' : `agent:${agentId}`;
          // Update list header
          $('#csListTitle').textContent = isSelf ? 'My Work' : agentName;
          $('#csListSub').textContent = isSelf ? 'Your assigned cases' : `Tickets assigned to ${agentName}`;
          // Deactivate nav highlights, show list pane
          el.querySelectorAll('.cs-nav-item').forEach(b => b.classList.remove('on'));
          $('#csListPane').style.display = '';
          showWorkView(selectedId ? 'case' : 'none');
          if (!selectedId) { $('#csEmpty').style.display = ''; $('#csCase').classList.remove('show'); }
          loadQueue();
          renderEmployeeList(); // refresh active state
        });
      });
    }
    $('#csNavEmployees').addEventListener('click', () => {
      const sub = $('#csEmployeeSubPanel');
      const isOpen = sub.style.display !== 'none';
      sub.style.display = isOpen ? 'none' : '';
      $('#csNavEmployees').classList.toggle('on', !isOpen);
      if (!isOpen) { renderEmployeeList(); setTimeout(() => $('#csEmployeeSearch').focus(), 0); }
    });

    // ── Queue Routing Modal ──
    const QUEUE_ROUTING_QUEUES = [
      { key: 'returns',          label: 'Returns' },
      { key: 'item_not_received', label: 'Item not received' },
      { key: 'claims',           label: 'Claims' },
      { key: 'unsorted',         label: 'Unsorted' },
    ];
    function openQueueRoutingModal() {
      const team = (bootstrap.agents && bootstrap.agents.length) ? bootstrap.agents : SAMPLE_TEAM;
      const allAgents = [bootstrap.user, ...team.filter(a => String(a.id) !== String(bootstrap.user?.id))];
      const optionsHtml = '<option value="">— Unassigned (koi nahi) —</option>' +
        allAgents.map(a => `<option value="${a.id}">${esc(a.name)}${String(a.id) === String(bootstrap.user?.id) ? ' (you)' : ''}</option>`).join('');
      $('#csQueueRoutingBody').innerHTML = QUEUE_ROUTING_QUEUES.map(q => `
        <div style="display:flex;align-items:center;gap:10px">
          <label style="font-size:13px;font-weight:600;width:150px;flex:none;color:#5b5249">${esc(q.label)}</label>
          <select data-routing-queue="${q.key}" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-family:inherit;font-size:13px;outline:none;background:#fff">
            ${optionsHtml.replace(`value="${queueRouting[q.key] || ''}"`, `value="${queueRouting[q.key] || ''}" selected`)}
          </select>
        </div>`).join('');
      // Pre-select current values
      QUEUE_ROUTING_QUEUES.forEach(q => {
        const sel = $('#csQueueRoutingBody').querySelector(`[data-routing-queue="${q.key}"]`);
        if (sel) sel.value = queueRouting[q.key] || '';
      });
      $('#csQueueRoutingModal').classList.add('show');
    }
    const routingNavBtn = $('#csNavQueueRouting');
    if (routingNavBtn) {
      routingNavBtn.addEventListener('click', () => {
        if (!bootstrap.permissions.assign) { toast('Only Team Leads can configure queue routing'); return; }
        openQueueRoutingModal();
      });
    }
    $('#csQueueRoutingCancel').addEventListener('click', () => $('#csQueueRoutingModal').classList.remove('show'));
    $('#csQueueRoutingSave').addEventListener('click', async () => {
      const newRouting = {};
      QUEUE_ROUTING_QUEUES.forEach(q => {
        const sel = $('#csQueueRoutingBody').querySelector(`[data-routing-queue="${q.key}"]`);
        newRouting[q.key] = sel && sel.value ? parseInt(sel.value, 10) : null;
      });
      queueRouting = newRouting;
      try {
        if (useApi) {
          await api('/queue-routing', { method: 'POST', body: JSON.stringify({ routing: queueRouting }) });
        } else {
          localStorage.setItem('cs_queue_routing', JSON.stringify(queueRouting));
        }
        toast('Queue routing rules saved ✓');
        $('#csQueueRoutingModal').classList.remove('show');
      } catch (e) { toast('Save failed: ' + e.message); }
    });
    $('#csEmployeeSearch').addEventListener('input', (e) => { empSearch = e.target.value.trim(); renderEmployeeList(); });
    $('#csEmployeeSubPanel').querySelectorAll('.cs-emp-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        empFilter = btn.dataset.empFilter;
        $('#csEmployeeSubPanel').querySelectorAll('.cs-emp-filter-btn').forEach(b => b.classList.toggle('on', b === btn));
        renderEmployeeList();
      });
    });
    $('#csNewStatusInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createStatusFromInput(e.target); } });
    function createStatusFromInput(inputEl) {
      const val = inputEl.value.trim();
      if (!val) return;
      const created = createStatus(val);
      inputEl.value = '';
      if (created) toast('Status "' + created.label + '" created');
    }

// =========================================================================
    // HORIZONTAL QUEUE CHIPS FILTER & REAL-TIME MOVE QUEUE MODAL WIRETAP
    // =========================================================================
    $('#csChips').querySelectorAll('.cs-chip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const filterType = chip.dataset.filter;

        // A. AGAR "NEW QUEUE" CHIP PAR CLICK HUA HAIN (OPEN TRANSFER MODAL)
        if (filterType === 'new_queue' || chip.id === 'csNewQueueChip') {
          if (selectedId) {
            const currentTicket = queue.find(c => c.id === selectedId) || SAMPLE_QUEUE.find(c => c.id === selectedId);
            if (currentTicket) {
              const requeueSelect = $('#csRequeueSelect');
              if (requeueSelect) {
                const optionsArray = Array.from(requeueSelect.options);
                const fallbackOption = optionsArray.find(o => o.value !== currentTicket.category);
                if (fallbackOption) requeueSelect.value = fallbackOption.value;
              }
            }
            if ($('#csRequeueModal')) $('#csRequeueModal').classList.add('show');
            return;
          }
          toast('Please open or select a ticket first from the list.');
          return;
        }

        // B. AGAR NORMAL CATEGORY FILTER CHIPS PAR CLICK HUA HAIN (ALL, RETURNS, ETC.)
        filter = filterType;
        $('#csChips').querySelectorAll('.cs-chip').forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');

        await loadQueue();
        updateNavCounts();
      });
    });

    // C. DYNAMIC ELEMENT SELECTOR FOR ORANGE "MOVE TICKET" SUBMIT BUTTON
    const orangeMoveBtn = $('#csRequeueConfirm') 
                        || el.querySelector('.modal-footer .btn-primary') 
                        || el.querySelector('button.btn-primary')
                        || Array.from(el.querySelectorAll('button')).find(b => b.textContent.includes('Move ticket'));

    if (orangeMoveBtn) {
      // Inline replacement to flush old duplicate event bindings preventing "Not Found" toasts
      const freshMoveBtn = orangeMoveBtn.cloneNode(true);
      orangeMoveBtn.replaceWith(freshMoveBtn);

      freshMoveBtn.addEventListener('click', async () => {
        if (!selectedId) {
          toast('No active ticket context selected.');
          return;
        }

        // Capture the correct drop-down value per image/markup standard
        const queueSelectElement = $('#csRequeueSelect') 
                                 || el.querySelector('#csRequeueModal select') 
                                 || el.querySelector('.modal-body select');

        if (!queueSelectElement) {
          toast('Category selector input dropdown element not found.');
          return;
        }

        const targetCategory = queueSelectElement.value; // E.g., 'returns', 'claims'

        try {
          if (useApi) {
            // This patch call will hit our new Node.js backend integration route mapping
            const responseData = await api(`/cases/${selectedId}/category`, {
              method: 'PATCH',
              body: JSON.stringify({ category: targetCategory })
            });

            // Refresh local master ticket stream pools directly 
            if (responseData && responseData.allCasesReferencePool) {
              window._csMasterTicketCache = responseData.allCasesReferencePool;
            }
          } else {
            // Local fallback simulation sync mode
            const activeItem = SAMPLE_QUEUE.find(c => c.id === selectedId);
            if (activeItem) activeItem.category = targetCategory;

            const liveQueueItem = queue.find(c => c.id === selectedId);
            if (liveQueueItem) liveQueueItem.category = targetCategory;
          }

          toast(`Ticket transferred to ${FILTER_LABELS[targetCategory] || targetCategory} successfully!`);
          
          // Hide window container smoothly
          const activeModalContainer = $('#csRequeueModal') 
                                     || el.querySelector('.modal.show') 
                                     || freshMoveBtn.closest('.modal');
          if (activeModalContainer) activeModalContainer.classList.remove('show');

          // 🔥 Real-Time UI Re-render execution parameters
          await loadQueue();
          updateNavCounts();
          if (selectedId) refreshCase(selectedId, { resetDrafts: false });

        } catch (error) {
          console.error("Queue Transfer Crash Exception: ", error);
          toast(error.message || 'Error updating category channel profile');
        }
      });
    }
    // ---- Sort dropdown ----
    const SORT_LABELS = { live: 'Live', newest: 'Newest', oldest: 'Oldest', employee: 'Employee', status: 'Status' };
    function setSortLabel(sort) {
      const btn = $('#csSortDdBtn');
      $('#csSortDdLabel').textContent = SORT_LABELS[sort] || sort;
      btn.classList.toggle('alt', sort !== 'live');
    }
    function closeSortDropdown() {
      $('#csSortDdMenu').classList.remove('show');
      $('#csSortEmpPanel').style.display = 'none';
      $('#csSortStatusPanel').style.display = 'none';
    }
    function showSortEmpPanel() {
      $('#csSortEmpPanel').style.display = '';
      $('#csSortStatusPanel').style.display = 'none';
      renderSortEmpList('');
      setTimeout(() => $('#csSortEmpSearch').focus(), 0);
    }
    function showSortStatusPanel() {
      $('#csSortStatusPanel').style.display = '';
      $('#csSortEmpPanel').style.display = 'none';
      renderSortStatusList();
    }
    function renderSortEmpList(q) {
      const team = (bootstrap.agents && bootstrap.agents.length ? bootstrap.agents : SAMPLE_TEAM);
      const fullList = [];
      if (bootstrap.user) fullList.push({ id: bootstrap.user.id, name: bootstrap.user.name || 'You', is_active: true, role: 'manager' });
      team.forEach(a => { if (String(a.id) !== String(bootstrap.user?.id)) fullList.push(a); });
      const allTickets = SAMPLE_QUEUE.length ? SAMPLE_QUEUE : queue;
      const filtered = q ? fullList.filter(a => (a.name || '').toLowerCase().includes(q.toLowerCase())) : fullList;
      const host = $('#csSortEmpList');
      host.innerHTML = filtered.map(a => {
        const initials = String(a.name || '?').trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
        const isOnline = a.is_active !== false;
        const cnt = allTickets.filter(c => String(c.assigneeId) === String(a.id)).length;
        const isActive = queueView === `agent:${a.id}` || (queueView === 'my-work' && String(a.id) === String(bootstrap.user?.id));
        return `<div class="cs-emp-item${isActive ? ' on' : ''}" data-agent-id="${esc(String(a.id))}" data-agent-name="${esc(a.name || 'Agent')}">
          <span class="av" style="${isOnline ? '' : 'background:#ECECEA;color:#6B6B66'}">${esc(initials)}</span>
          <span class="nm">${esc(a.name || 'Unknown')}</span>
          ${cnt > 0 ? `<span class="cs-emp-ticket-cnt">${cnt}</span>` : ''}
          <span style="width:7px;height:7px;border-radius:50%;background:${isOnline ? '#34B27B' : '#9b8e7d'};flex:none"></span>
        </div>`;
      }).join('') || '<div style="padding:6px 8px;font-size:12px;color:var(--soft)">No employees found.</div>';
      host.querySelectorAll('.cs-emp-item[data-agent-id]').forEach(item => {
        item.addEventListener('click', () => {
          const agentId = item.dataset.agentId;
          const agentName = item.dataset.agentName;
          const isSelf = String(agentId) === String(bootstrap.user?.id);
          queueView = isSelf ? 'my-work' : `agent:${agentId}`;
          $('#csListTitle').textContent = isSelf ? 'My Work' : agentName;
          $('#csListSub').textContent = isSelf ? 'Your assigned cases' : `Tickets assigned to ${agentName}`;
          el.querySelectorAll('.cs-nav-item').forEach(b => b.classList.remove('on'));
          $('#csListPane').style.display = '';
          showWorkView(selectedId ? 'case' : 'none');
          if (!selectedId) { $('#csEmpty').style.display = ''; $('#csCase').classList.remove('show'); }
          closeSortDropdown();
          loadQueue();
        });
      });
    }
    function renderSortStatusList() {
      const host = $('#csSortStatusList');
      const allTickets = SAMPLE_QUEUE.length ? SAMPLE_QUEUE : queue;
      const counts = {};
      allTickets.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
      host.innerHTML = STATUSES.map(s => {
        const cnt = counts[s.key] || 0;
        const isActive = queueView === `status:${s.key}`;
        return `<div class="cs-sort-status-row${isActive ? ' on' : ''}" data-status-key="${esc(s.key)}">
          <span class="cs-sort-status-dot" style="background:${esc(s.color)}"></span>
          <span class="cs-sort-status-lbl">${esc(s.label)}</span>
          <span class="cs-sort-status-cnt">${cnt}</span>
        </div>`;
      }).join('');
      host.querySelectorAll('.cs-sort-status-row[data-status-key]').forEach(row => {
        row.addEventListener('click', () => {
          const key = row.dataset.statusKey;
          queueView = `status:${key}`;
          $('#csListTitle').textContent = statusLabel(key);
          $('#csListSub').textContent = 'All cases with this status';
          el.querySelectorAll('.cs-nav-item').forEach(b => b.classList.remove('on'));
          $('#csListPane').style.display = '';
          showWorkView(selectedId ? 'case' : 'none');
          if (!selectedId) { $('#csEmpty').style.display = ''; $('#csCase').classList.remove('show'); }
          closeSortDropdown();
          loadQueue();
        });
      });
    }
    $('#csSortDdBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('#csSortDdMenu');
      const isOpen = menu.classList.contains('show');
      closeSortDropdown();
      if (!isOpen) menu.classList.add('show');
    });
    $('#csSortDdMenu').querySelectorAll('.cs-sort-dd-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const sort = item.dataset.sort;
        $('#csSortDdMenu').querySelectorAll('.cs-sort-dd-item').forEach(i => i.classList.toggle('on', i === item));
        if (sort === 'employee') { showSortEmpPanel(); setSortLabel('employee'); return; }
        if (sort === 'status') { showSortStatusPanel(); setSortLabel('status'); return; }
        sortOrder = sort;
        setSortLabel(sort);
        closeSortDropdown();
        renderQueue();
      });
    });
    $('#csSortEmpSearch').addEventListener('input', e => renderSortEmpList(e.target.value.trim()));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#csSortDropdownWrap')) closeSortDropdown();
    });

    function setMidTab(tab) {
      $('#csMidReply').classList.toggle('show', tab === 'reply');
      $('#csMidNotes').classList.toggle('show', tab === 'notes');
      el.querySelectorAll('.cs-mid-tab').forEach((b) => b.classList.toggle('on', b.dataset.midtab === tab));
    }
    el.querySelectorAll('.cs-mid-tab').forEach((btn) => { btn.addEventListener('click', () => setMidTab(btn.dataset.midtab)); });

    $('#csCompose').addEventListener('submit', (e) => {
      e.preventDefault();
      if (slashActive) return;
      const text = $('#csReply').value.trim();
      if (!text || !selectedId) return;
      if (pendingReply) { toast('Already sending a reply — wait or undo first'); return; }
      const item = queue.find((c) => c.id === selectedId);
      $('#csReply').value = '';
      startUndoCountdown(selectedId, text, item?.customer);
    });

    $('#csUndoBtn').addEventListener('click', () => cancelPendingReply(false));

    $('#csInsertTpl').addEventListener('click', () => {
      const willShow = !$('#csTplMenu').classList.contains('show');
      renderTplMenu('');
      $('#csTplMenu').classList.toggle('show', willShow);
      if (willShow) { $('#csTplSearch').value = ''; $('#csTplSearch').focus(); }
    });
    $('#csTplSearch').addEventListener('input', () => renderTplMenu($('#csTplSearch').value.trim()));
    $('#csTplViewSearch').addEventListener('input', () => renderTplGrid($('#csTplViewSearch').value.trim()));

    // Slash command keyboard handling: live filter, ↑/↓ navigate, Enter/Tab insert, Esc dismiss
    $('#csReply').addEventListener('input', checkSlashTrigger);
    $('#csReply').addEventListener('keydown', (e) => {
      if (!slashActive) return;
      const query = $('#csReply').value.slice(slashStart + 1, $('#csReply').selectionStart);
      const list = templates.filter((t) => tplMatches(t, query));
      if (e.key === 'ArrowDown') { e.preventDefault(); slashHighlight = Math.min(slashHighlight + 1, list.length - 1); renderSlashList(query); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); slashHighlight = Math.max(slashHighlight - 1, 0); renderSlashList(query); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitSlashSelection(list[slashHighlight]); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSlashMenu(); }
    });

    // Global keyboard shortcuts: Cmd/Ctrl+K opens the full-screen template manager, Esc closes it
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openTplManager();
      } else if (e.key === 'Escape' && $('#csTplView').classList.contains('show')) {
        $('#csListPane').style.display = '';
        showWorkView(selectedId ? 'case' : 'none');
        if (!selectedId) { $('#csEmpty').style.display = ''; }
      }
    });

  $('#csStatusSel').addEventListener('change', async () => {
      if (!selectedId) return;
      let status = $('#csStatusSel').value;
      applyStatusColor('#csStatusSel', status);
      
      if (status === '__new__') {
        const label = prompt('Name for the new status:');
        const created = createStatus(label);
        const fallback = (queue.find((c) => c.id === selectedId) || {}).status || 'new_ticket';
        status = created ? created.key : fallback;
        $('#csStatusSel').value = status;
        if (!created) return;
      }
      
      const item = queue.find((c) => c.id === selectedId) || SAMPLE_QUEUE.find((c) => c.id === selectedId);
      const fromStatus = item ? item.status : null;
      
      try {
        if (useApi) {
          // 1. Send status update request to the backend API
          const res = await api('/cases/' + selectedId + '/status', { 
            method: 'PATCH', 
            body: JSON.stringify({ status }) 
          });
          
          // 🟢 FIXED: Instantly refresh the global count cache with the new server reference pool
          if (res && res.allCasesReferencePool) {
            window._csMasterTicketCache = res.allCasesReferencePool;
          }
        } else if (item) {
          item.status = status;
        }
        
        const d = localStore[selectedId];
        if (d) {
          d.details = d.details || {};
          d.details.status = status;
          d.statusLog = d.statusLog || [];
          d.statusLog.push({ at: new Date().toISOString(), actorName: bootstrap.user.name, sysType: 'status', fromStatus, toStatus: status });
        }
        
        toast('Moved to ' + statusLabel(status));
        
        // 2. Reload the active view queue list
        await loadQueue();
        
        // 🟢 FIXED: Explicitly force sidebar badge recalculations immediately
        updateNavCounts();
        
        if (queueView.startsWith('status:') && queueView !== 'status:' + status && !queue.find((c) => c.id === selectedId)) {
          selectedId = null;
          showWorkView('none');
          $('#csEmpty').style.display = '';
          $('#csCase').classList.remove('show');
        } else {
          refreshCase(selectedId, { resetDrafts: false });
        }
      } catch (e) { toast(e.message); }
    });

    $('#csReassign').addEventListener('click', () => {
      if (!selectedId) return;
      const item = queue.find((c) => c.id === selectedId) || SAMPLE_QUEUE.find((c) => c.id === selectedId);
      const isUnassigned = item ? item.assigneeId == null : true;
      if (!isUnassigned && !bootstrap.permissions.assign) { toast('Only Team Leaders can reassign an already-assigned ticket'); return; }
      const sel = $('#csAssignSelect');
      const team = (bootstrap.agents && bootstrap.agents.length) ? bootstrap.agents : SAMPLE_TEAM;
      const allAgents = [bootstrap.user, ...team];
      sel.innerHTML = '<option value="">— Unassign —</option>' + allAgents.map((a) => `<option value="${a.id}"${item && String(item.assigneeId) === String(a.id) ? ' selected' : ''}>${esc(a.name)}${String(a.id) === String(bootstrap.user.id) ? ' (you)' : ''}</option>`).join('');
      $('#csAssignModal').classList.add('show');
    });

    $('#csAssignCancel').addEventListener('click', () => $('#csAssignModal').classList.remove('show'));
 $('#csAssignConfirm').addEventListener('click', async () => {
      const val = $('#csAssignSelect').value;
      const userId = val ? parseInt(val, 10) : null;
      const sel = $('#csAssignSelect');
      // 🟢 ADD THIS BLOCK TO WIRE UP YOUR HTML MODAL:
    const csRequeueBtn = $('#csRequeueConfirm');
    if (csRequeueBtn) {
      csRequeueBtn.addEventListener('click', async () => {
        if (!selectedId) {
          toast('No ticket selected');
          return;
        }

        // Extracts the selected value directly from your <select id="csRequeueSelect">
        const requeueSelect = $('#csRequeueSelect');
        const newCategory = requeueSelect ? requeueSelect.value : 'unsorted'; 

        try {
          if (useApi) {
            // Hit your backend category patching route
            const res = await api(`/cases/${selectedId}/category`, {
              method: 'PATCH',
              body: JSON.stringify({ category: newCategory })
            });

            // Update our live counting cache pool metrics dynamically
            if (res && res.allCasesReferencePool) {
              window._csMasterTicketCache = res.allCasesReferencePool;
            }
          } else {
            // Local fallback simulation mode editing
            const item = SAMPLE_QUEUE.find(c => c.id === selectedId);
            if (item) item.category = newCategory;
          }

          toast('Ticket moved successfully');
          
          // Hide your modal cleanly
          const requeueModal = $('#csRequeueModal');
          if (requeueModal) requeueModal.classList.remove('show');

          await loadQueue();
          updateNavCounts();
        } catch (e) {
          toast(e.message || 'Error updating category');
        }
      });
    }
      

      const toName = userId ? sel.options[sel.selectedIndex].textContent.replace(' (you)', '') : null;
      
      try {
        if (useApi) {
          // Send explicit parameters so the validator doesn't drop the context structure
          await api('/cases/' + selectedId + '/assign', { 
            method: 'POST', 
            body: JSON.stringify({ 
              agentId: userId,
              user_id: userId // Backward compatibility fallback safeguard
            }) 
          });
          toast(toName ? `Assigned to ${toName}` : 'Ticket unassigned');
        } else {
          const item = SAMPLE_QUEUE.find((c) => c.id === selectedId);
          if (item) item.assigneeId = userId;
          toast(toName ? `Assigned to ${toName}` : 'Ticket unassigned');
        }

        const d = localStore[selectedId];
        if (d) {
          d.assignmentLog = d.assignmentLog || [];
          d.assignmentLog.push({ action: toName ? 'assign' : 'unassign', actorName: bootstrap.user.name, toName, at: new Date().toISOString() });
          if (d.details) d.details.assignee = toName || 'Unassigned';
        }
        $('#csAssignModal').classList.remove('show');
        await loadQueue();
        // Stay on the current ticket — just refresh it to show the new assignee
        if (selectedId) {
          refreshCase(selectedId, { resetDrafts: false });
        } else {
          showWorkView('none');
          $('#csEmpty').style.display = '';
          $('#csCase').classList.remove('show');
        }
      } catch (e) { toast(e.message); }
    });
    // 🟢 ADD THIS BLOCK FOR THE MOVE QUEUE MODAL:
    const csMoveBtn = $('#csMoveTicketConfirm') || el.querySelector('.modal-footer .btn-primary') || el.querySelector('button[class*="Move ticket"]');
    
    if (csMoveBtn) {
      csMoveBtn.addEventListener('click', async () => {
        if (!selectedId) {
          toast('No ticket selected');
          return;
        }

        // Find your category dropdown selector (adjust ID if yours is named differently)
        const catSelect = $('#csCategorySelect') || el.querySelector('.modal-body select');
        if (!catSelect) {
          toast('Category selector not found');
          return;
        }
        
        const newCategory = catSelect.value; 

        try {
          if (useApi) {
            // Hit the backend patch endpoint to change the category
            const res = await api(`/cases/${selectedId}/category`, {
              method: 'PATCH',
              body: JSON.stringify({ category: newCategory })
            });

            // Update our live counter pool matrix cache dynamically
            if (res && res.allCasesReferencePool) {
              window._csMasterTicketCache = res.allCasesReferencePool;
            }
          } else {
            // Local fallback simulation mode editing
            const item = SAMPLE_QUEUE.find(c => c.id === selectedId);
            if (item) item.category = newCategory;
          }

          toast('Ticket moved successfully');
          
          // Hide the modal (looks for your active popup modal wrapper class)
          const moveModal = $('#csMoveQueueModal') || el.querySelector('.modal.show') || csMoveBtn.closest('.modal');
          if (moveModal) moveModal.classList.remove('show');

          await loadQueue();
          updateNavCounts();
        } catch (e) {
          toast(e.message || 'Error updating category');
        }
      });
    }

// ---- Requeue (New Queue) modal ----
    $('#csRequeueCancel').addEventListener('click', () => $('#csRequeueModal').classList.remove('show'));
   
    $('#csNoteInput').addEventListener('input', checkMentionTrigger);
    $('#csNoteInput').addEventListener('keyup', (e) => { if (e.key === 'Escape') $('#csMentionMenu').classList.remove('show'); });

    // Reply compose: emoji, image, file
    const EMOJI_DATA = {
      Smileys: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😍','😘','😚','😔','😌','😶','🥱','😬','😑','😐'],
      Gestures: ['👍','👎','👏','🙌','🤝','👋','✋','🖐','✌','🤞','👌','🤟','🤘','💪','✍'],
      Objects: ['❤','💫','💬','📝','📧','📦','📋','📁','📎','✂','🔧','💻','📱','📸','🔍','🔒','🔓'],
      Symbols: ['✅','❌','⚠','ℹ','💯','⭐','➡','✔','💰','💸','💹'],
    };
    function renderEmojiGrid(query) {
      const grid = $('#csEmojiGrid');
      if (!grid) return;
      let html = '';
      Object.entries(EMOJI_DATA).forEach(([cat, emojis]) => {
        html += '<div class="cs-emoji-cat-label">' + esc(cat) + '</div><div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px">' +
          emojis.map(e => '<button type="button" class="cs-emoji-btn" data-emoji="' + e + '">' + e + '</button>').join('') + '</div>';
      });
      grid.innerHTML = html;
      grid.querySelectorAll('.cs-emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const ta = $('#csReply');
          if (!ta) return;
          const s = ta.selectionStart, en = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + btn.dataset.emoji + ta.value.slice(en);
          ta.selectionStart = ta.selectionEnd = s + btn.dataset.emoji.length;
          ta.focus();
        });
      });
    }
    const emojiPickerEl = $('#csEmojiPicker');
    const emojiBtnEl = $('#csReplyEmojiBtn');
    if (emojiBtnEl && emojiPickerEl) {
      emojiBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const willShow = !emojiPickerEl.classList.contains('show');
        emojiPickerEl.classList.toggle('show', willShow);
        if (willShow) { renderEmojiGrid(''); const es = $('#csEmojiSearch'); if (es) { es.value = ''; es.focus(); } }
      });
      const emojiSearchEl = $('#csEmojiSearch');
      if (emojiSearchEl) emojiSearchEl.addEventListener('input', (e) => renderEmojiGrid(e.target.value.trim()));
      document.addEventListener('click', (e) => {
        if (emojiPickerEl.classList.contains('show') && !emojiPickerEl.contains(e.target) && e.target !== emojiBtnEl) {
          emojiPickerEl.classList.remove('show');
        }
      });
    }
    function addReplyAttachment(file) {
      const reader = new FileReader();
      reader.onload = () => {
        replyPendingAttachments.push({ name: file.name, mime: file.type, data: reader.result });
        renderReplyPendingAtts();
      };
      reader.readAsDataURL(file);
    }
    const replyImgFileEl = $('#csReplyImageFile');
    const replyAnyFileEl = $('#csReplyFileInput');
    if (replyImgFileEl) {
      $('#csReplyImageBtn').addEventListener('click', () => replyImgFileEl.click());
      replyImgFileEl.addEventListener('change', () => { Array.from(replyImgFileEl.files || []).forEach(f => { if (f.type.startsWith('image/')) addReplyAttachment(f); }); replyImgFileEl.value = ''; });
    }
    if (replyAnyFileEl) {
      $('#csReplyFileBtn').addEventListener('click', () => replyAnyFileEl.click());
      replyAnyFileEl.addEventListener('change', () => { Array.from(replyAnyFileEl.files || []).forEach(f => addReplyAttachment(f)); replyAnyFileEl.value = ''; });
    }
    const replyTaEl = $('#csReply');
    if (replyTaEl) {
      replyTaEl.addEventListener('dragover', e => { e.preventDefault(); replyTaEl.style.borderColor = '#E8722B'; });
      replyTaEl.addEventListener('dragleave', () => { replyTaEl.style.borderColor = ''; });
      replyTaEl.addEventListener('drop', e => { e.preventDefault(); replyTaEl.style.borderColor = ''; Array.from(e.dataTransfer.files || []).forEach(f => addReplyAttachment(f)); });
    }

    $('#csNoteAttach').addEventListener('click', () => $('#csNoteFile').click());
    $('#csNoteFile').addEventListener('change', () => {
      Array.from($('#csNoteFile').files || []).forEach((file) => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => { notePendingAttachments.push({ name: file.name, mime: file.type, data: reader.result }); renderPendingAtts(); };
        reader.readAsDataURL(file);
      });
      $('#csNoteFile').value = '';
    });

    $('#csPersonalNoteFile').addEventListener('change', () => {
      const file = ($('#csPersonalNoteFile').files || [])[0];
      $('#csPersonalNoteFile').value = '';
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const editable = $('#csPNoteEditable');
        if (!editable) return;
        editable.focus();
        const img = document.createElement('img');
        img.src = reader.result;
        img.alt = file.name;
        const sel = window.getSelection();
        if (sel && sel.rangeCount && editable.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.collapse(false);
          range.insertNode(img);
          range.setStartAfter(img);
          range.setEndAfter(img);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          editable.appendChild(img);
        }
        schedulePersonalNoteAutosave();
      };
      reader.readAsDataURL(file);
    });

    $('#csNoteSave').addEventListener('click', async () => {
      const body = $('#csNoteInput').value.trim();
      if (!body || !selectedId) return;
      try {
        if (useApi) {
          const endpoint = '/cases/' + selectedId + '/notes';
          if (editingNoteId) await api(endpoint + '/' + editingNoteId, { method: 'PATCH', body: JSON.stringify({ body, attachments: notePendingAttachments, kind: 'team' }) });
          else await api(endpoint, { method: 'POST', body: JSON.stringify({ body, attachments: notePendingAttachments, kind: 'team' }) });
        } else {
          const d = localStore[selectedId] || (localStore[selectedId] = { thread: [], notes: { team: [], personal: {} }, assignmentLog: [] });
          if (!d.notes || Array.isArray(d.notes)) d.notes = { team: Array.isArray(d.notes) ? d.notes : [], personal: {} };
          if (editingNoteId) {
            const n = d.notes.team.find((x) => x.id === editingNoteId);
            if (n) { n.body = body; n.attachments = notePendingAttachments.slice(); }
          } else {
            d.notes.team.push({ id: Date.now(), authorId: bootstrap.user.id || 1, authorName: bootstrap.user.name || 'You', body, attachments: notePendingAttachments.slice(), canEdit: true, createdAt: new Date().toISOString() });
          }
        }
        $('#csNoteInput').value = '';
        notePendingAttachments = [];
        editingNoteId = null;
        $('#csNoteSave').textContent = 'Add note';
        renderPendingAtts();
        toast('Team note saved');
        refreshCase(selectedId, { resetDrafts: false });
      } catch (e) { toast(e.message); }
    });

    function scrollTplGridToTop() {
      const scroller = $('.cs-tpl-body-scroll');
      if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Scrolls the freshly-expanded card itself into view at the top of the
    // scroll container — more reliable than scrolling to (0,0) since the
    // expanded card is reordered first but the container may have padding,
    // or (on a future change) the card might not always sort to position 0.
    function scrollCardIntoView(tplId) {
      requestAnimationFrame(() => {
        const card = $(`.cs-tpl-card[data-tpl-id="${tplId}"]`);
        const scroller = $('.cs-tpl-body-scroll');
        if (card && scroller) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else scrollTplGridToTop();
      });
    }

    $('#csTplAdd').addEventListener('click', async () => {
      const category = (tplCat !== 'all' && tplCat !== 'favorites' && tplCat !== 'recent') ? tplCat : (categories[0] || 'General');
      const newId = Date.now();
      try {
        if (useApi) {
          const created = await api('/templates', { method: 'POST', body: JSON.stringify({ title: 'New template', body: '', category }) });
          templates = (await api('/templates')).templates;
          selectedTplId = (created && created.id) ? created.id : newId;
        } else {
          templates.push({ id: newId, title: 'New template', body: '', category, favorite: false });
          selectedTplId = newId;
        }
        // Make sure the new template's own category/filter is active so it isn't
        // filtered out of view right after creating it.
        if (tplCat !== 'all' && tplCat !== category) tplCat = category;
        renderTplCatBar();
        renderTplGrid($('#csTplViewSearch').value.trim());
        renderTplMenu('');
        scrollCardIntoView(selectedTplId);
        const titleInput = el.querySelector(`.cs-tpl-card[data-tpl-id="${selectedTplId}"] .cs-tpl-title`);
        if (titleInput) { titleInput.focus(); titleInput.select(); }
      } catch (e) { toast(e.message); }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#csInsertTpl') && !e.target.closest('#csTplMenu')) {
        $('#csTplMenu').classList.remove('show');
        // Hide live preview when template menu closes
        $('#csTplLivePreview').classList.remove('show');
      }
      if (!e.target.closest('#csReply') && !e.target.closest('#csSlashMenu')) closeSlashMenu();
      if (!e.target.closest('#csNoteInput') && !e.target.closest('#csMentionMenu')) $('#csMentionMenu').classList.remove('show');
    });

    // ---- Lightbox: open on any [data-lightbox] image ----
    el.addEventListener('click', (e) => {
      const thumb = e.target.closest('[data-lightbox]');
      if (thumb) {
        $('#csLightboxImg').src = thumb.dataset.lightbox;
        $('#csLightbox').classList.add('show');
      }
    });
    $('#csLightbox').addEventListener('click', (e) => {
      if (!e.target.closest('#csLightboxImg')) { $('#csLightbox').classList.remove('show'); $('#csLightboxImg').src = ''; }
    });
    $('#csLightboxClose').addEventListener('click', () => { $('#csLightbox').classList.remove('show'); $('#csLightboxImg').src = ''; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#csLightbox').classList.contains('show')) { $('#csLightbox').classList.remove('show'); $('#csLightboxImg').src = ''; }
    });

    
    

    // ---- Template live preview (right panel of compose) ----
    function showTplLivePreview(tpl) {
      if (!tpl) { $('#csTplLivePreview').classList.remove('show'); return; }
      const resolved = resolvePlaceholders(tpl.body || '');
      $('#csTplLiveName').textContent = tpl.title || 'Untitled';
      $('#csTplLiveBody').textContent = resolved;
      $('#csTplLivePreview').classList.add('show');
      $('#csTplLiveInsert').onclick = () => {
        insertTemplateIntoReply(tpl, null);
        $('#csTplMenu').classList.remove('show');
        $('#csTplLivePreview').classList.remove('show');
        $('#csTplSearch').value = '';
      };
    }

    // Hook into template list hover to trigger live preview
    const origRenderTplMenu = renderTplMenu;
    function renderTplMenuWithPreview(query) {
      origRenderTplMenu(query);
      // Re-wire mouseenter after list re-renders
      const listEl = $('#csTplList');
      listEl.querySelectorAll('button[data-tpl-id]').forEach((btn) => {
        btn.addEventListener('mouseenter', () => {
          const tpl = templates.find((t) => String(t.id) === btn.dataset.tplId);
          showTplLivePreview(tpl || null);
        });
      });
      // Show first template in preview if menu is visible
      const first = listEl.querySelector('button[data-tpl-id]');
      if (first) {
        const tpl = templates.find((t) => String(t.id) === first.dataset.tplId);
        showTplLivePreview(tpl || null);
      }
    }

    // Override the original template menu rendering with our enhanced version
    $('#csInsertTpl').addEventListener('mouseenter', () => {});
    // Patch renderTplMenu calls from search input to also update live preview
    $('#csTplSearch').addEventListener('input', () => {
      setTimeout(() => {
        const listEl = $('#csTplList');
        listEl.querySelectorAll('button[data-tpl-id]').forEach((btn) => {
          btn.addEventListener('mouseenter', () => {
            const tpl = templates.find((t) => String(t.id) === btn.dataset.tplId);
            showTplLivePreview(tpl || null);
          });
        });
        const first = listEl.querySelector('button[data-tpl-id]');
        if (first) showTplLivePreview(templates.find((t) => String(t.id) === first.dataset.tplId) || null);
      }, 0);
    });

    // Patch the Insert template button to also setup hover bindings after open
    const origInsertTplClick = $('#csInsertTpl').onclick;
    $('#csInsertTpl').addEventListener('click', () => {
      setTimeout(() => {
        if (!$('#csTplMenu').classList.contains('show')) { $('#csTplLivePreview').classList.remove('show'); return; }
        const listEl = $('#csTplList');
        listEl.querySelectorAll('button[data-tpl-id]').forEach((btn) => {
          btn.addEventListener('mouseenter', () => {
            const tpl = templates.find((t) => String(t.id) === btn.dataset.tplId);
            showTplLivePreview(tpl || null);
          });
        });
        const first = listEl.querySelector('button[data-tpl-id]');
        if (first) showTplLivePreview(templates.find((t) => String(t.id) === first.dataset.tplId) || null);
      }, 0);
    });

    function tickSlaDisplays() {
      if (document.hidden) return;
      el.querySelectorAll('#csRows .cs-row[data-id]').forEach((row) => {
        const c = queue.find((x) => x.id === row.dataset.id);
        if (!c) return;
        const sla = slaInfo(c.slaDueAt);
        const badge = row.querySelector('.cs-dl');
        if (badge) { badge.textContent = sla.text; badge.className = 'cs-dl ' + sla.cls; }
      });
      if (selectedId) {
        const item = queue.find((c) => c.id === selectedId) || SAMPLE_QUEUE.find((c) => c.id === selectedId);
        if (item) {
          const sla = slaInfo(item.slaDueAt);
          $('#csCaseSla').textContent = sla.text;
          $('#csCaseSla').className = 'cs-case-sla ' + sla.cls;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Resizable workspace: drag the queue-list/side-panel edges. Widths are
    // clamped to sensible min/max and stored on the module object itself so
    // they're remembered for the rest of this page session.
    // -----------------------------------------------------------------------
    const PANEL_LIMITS = { list: { min: 280, max: 560 }, side: { min: 240, max: 520 } };

    function clamp(v, lim) { return Math.max(lim.min, Math.min(lim.max, v)); }

    function applyPanelWidths() {
      const w = mod._panelWidths;
      el.style.setProperty('--list-w', clamp(w.list, PANEL_LIMITS.list) + 'px');
      el.style.setProperty('--side-w', clamp(w.side, PANEL_LIMITS.side) + 'px');
    }

    function wireResizeHandle(handleEl, key) {
      if (!handleEl) return;
      let startX = 0;
      let startW = 0;
      let dragging = false;
      const wrap = $('.cswrap');

      function onMove(e) {
        if (!dragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const delta = key === 'side' ? startX - clientX : clientX - startX; // side panel grows when dragging left
        const next = clamp(startW + delta, PANEL_LIMITS[key]);
        mod._panelWidths[key] = next;
        applyPanelWidths();
      }


      
      function onUp() {
        if (!dragging) return;
        dragging = false;
        handleEl.classList.remove('dragging');
        if (wrap) wrap.classList.remove('resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      }
      function onDown(e) {
        dragging = true;
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        startW = mod._panelWidths[key];
        handleEl.classList.add('dragging');
        if (wrap) wrap.classList.add('resizing');
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        e.preventDefault();
      }
      handleEl.addEventListener('mousedown', onDown);
      handleEl.addEventListener('touchstart', onDown, { passive: false });
      handleEl.addEventListener('dblclick', () => {
        // Double-click resets that panel to its default width.
        mod._panelWidths[key] = key === 'list' ? 380 : 320;
        applyPanelWidths();
      });
    }

    applyPanelWidths();
    wireResizeHandle($('#csListResize'), 'list');
    wireResizeHandle($('#csResizeRight'), 'side');

    // Template preview panel resize
    (function wireTplPreviewResize() {
      const handle = $('#csTplPreviewResize');
      const preview = $('#csTplPreview');
      if (!handle || !preview) return;
      const TPL_PREVIEW_LIMITS = { min: 200, max: 560 };
      let dragging = false, startX = 0, startW = 0;
      function onMove(e) {
        if (!dragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const delta = startX - clientX; // grows when dragging left
        const next = Math.max(TPL_PREVIEW_LIMITS.min, Math.min(TPL_PREVIEW_LIMITS.max, startW + delta));
        preview.style.setProperty('--tpl-preview-w', next + 'px');
      }
      function onUp() {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      }
      function onDown(e) {
        dragging = true;
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        startW = preview.offsetWidth || 320;
        handle.classList.add('dragging');
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        e.preventDefault();
      }
      handle.addEventListener('mousedown', onDown);
      handle.addEventListener('touchstart', onDown, { passive: false });
      handle.addEventListener('dblclick', () => el.style.setProperty('--tpl-preview-w', '320px'));
    })();

    tickTimer = setInterval(() => {
      if (document.hidden) return;
      if (!$('#csTplView').classList.contains('show')) { sortQueueBySla(); renderQueue(); }
    }, 15000);
    mod._tickTimer = tickTimer;

    slaTimer = setInterval(tickSlaDisplays, 1000);
    mod._slaTimer = slaTimer;

    presenceTimer = setInterval(tickPresenceSimulation, 4000);
    mod._presenceTimer = presenceTimer;

    await initBootstrap();
    initPresence();
    renderPresenceMini();
    renderTplMenu('');
    refreshStatusCounts();
    await loadQueue();
    wireOrderCaseSimulation();
    if (pendingOpenId) await openCase(pendingOpenId);
  },

  unmount() {
    if (this._tickTimer) clearInterval(this._tickTimer);
    if (this._slaTimer) clearInterval(this._slaTimer);
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    if (this._orderCaseTimer) clearInterval(this._orderCaseTimer);
    if (this._personalNoteSaveTimer) clearTimeout(this._personalNoteSaveTimer);
    const stalePopover = document.querySelector('.cs-color-pop');
    if (stalePopover) stalePopover.remove();
  },
};