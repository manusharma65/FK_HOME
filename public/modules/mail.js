// FK Home — Mail module (r0.89, full personal inbox matching the mock)
// ----------------------------------------------------------------------------
// Full-bleed 4-column layout: dark icon rail | collapsible Mail column |
// conversation list (Focus-today + search + cards) | reading pane (labels,
// pinned note, AI summary, attachments, rich reply with bold/italic + AI draft
// + AI polish + attach + save draft). Labels & notes live in FK Home. AI is
// on-demand + cached, Haiku by default.
// ----------------------------------------------------------------------------

window.fkModules = window.fkModules || {};

window.fkModules['mail'] = {
  title: 'My Mail',
  noHero: true,

  render() {
    return `
<div id="mail-mod" class="fk-mod">
  <style>
    #mail-mod{flex:1;min-width:0;height:100%;display:flex;font-family:var(--body,'Hanken Grotesk',-apple-system,sans-serif);color:#2B2017}
    #mail-mod h1,#mail-mod h2,#mail-mod h3{font-family:var(--body,'Hanken Grotesk',sans-serif)!important;letter-spacing:-.01em}
    #mail-mod .mwrap{flex:1;min-height:0;display:grid;grid-template-columns:64px 230px 388px 1fr;background:var(--surface);position:relative;transition:grid-template-columns .22s ease}
    #mail-mod .mwrap.collapsed{grid-template-columns:64px 0px 388px 1fr}
    /* Icon rail */
    #mail-mod .rail{background:#2A2018;display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:4px;overflow:hidden}
    #mail-mod .rbrand{width:36px;height:36px;border-radius:10px;background:var(--orange,#E8722B);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;margin-bottom:10px;letter-spacing:-.02em}
    #mail-mod .ri{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#C9BBA8;font-size:21px;cursor:pointer}
    #mail-mod .ri:hover{background:rgba(255,255,255,.09);color:#fff} #mail-mod .ri.on{background:var(--orange,#E8722B);color:#fff}
    #mail-mod .rsp{flex:1}
    #mail-mod .rav{width:36px;height:36px;border-radius:50%;background:#5A4A38;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;cursor:pointer;margin-top:6px}
    /* Mail column */
    #mail-mod .mnav{background:var(--canvas,#F4EFE7);border-right:1px solid var(--line);overflow:auto;padding:15px 13px;min-width:0;display:flex;flex-direction:column}
    #mail-mod .mnav-hd{display:flex;align-items:center;gap:8px;padding:2px 6px 12px}
    #mail-mod .mnav-hd .t{font-size:21px;font-weight:700;flex:1}
    #mail-mod .collapse{width:31px;height:31px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--muted);display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;flex:none}
    #mail-mod .collapse:hover{background:#fff}
    #mail-mod .mboxsw{display:flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:9px 11px;margin-bottom:6px;box-shadow:0 1px 2px rgba(58,40,24,.05);cursor:pointer;position:relative}
    #mail-mod .mboxsw .d1{font-size:11px;color:var(--soft,#9b8e7d)} #mail-mod .mboxsw .d2{font-size:14.5px;font-weight:700}
    #mail-mod .mboxsw .pill{font-size:10.5px;font-weight:700;color:#9A4A2B;background:#F5E5DA;border:1px solid #ECCDBC;padding:1px 7px;border-radius:10px;margin-left:6px}
    #mail-mod .mboxsw .cv{margin-left:auto;color:var(--soft);font-size:17px}
    #mail-mod .swmenu{position:absolute;top:100%;left:0;right:0;margin-top:5px;background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:0 12px 30px rgba(58,40,24,.16);padding:6px;z-index:20;display:none} #mail-mod .swmenu.show{display:block}
    #mail-mod .swmenu .it{padding:9px 10px;border-radius:8px;font-size:14px;cursor:pointer} #mail-mod .swmenu .it:hover{background:var(--canvas)} #mail-mod .swmenu .it.dim{color:var(--soft);cursor:default} #mail-mod .swmenu .it .tag{font-size:11px;color:var(--soft);margin-left:6px}
    #mail-mod .msec{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--soft,#9b8e7d);font-weight:700;padding:14px 9px 5px;display:flex;align-items:center}
    #mail-mod .msec .add{margin-left:auto;cursor:pointer;font-size:15px;color:var(--muted)} #mail-mod .msec .add:hover{color:var(--orange)}
    #mail-mod .mni{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:9px;color:#3A322A;cursor:pointer;font-size:14.5px}
    #mail-mod .mni i.lead{font-size:18px;width:19px;text-align:center;color:var(--muted)}
    #mail-mod .mni .ct{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--soft)}
    #mail-mod .mni:hover{background:#EFE7D8} #mail-mod .mni.on{background:var(--orange,#E8722B);color:#fff;font-weight:600} #mail-mod .mni.on i.lead,#mail-mod .mni.on .ct{color:#fff}
    #mail-mod .mni .dot{width:10px;height:10px;border-radius:50%;flex:none}
    #mail-mod .mni .del{margin-left:auto;color:var(--soft);font-size:15px;opacity:0;cursor:pointer} #mail-mod .mni:hover .del{opacity:1} #mail-mod .mni.on .del{color:#fff}
    #mail-mod .newlab{margin:4px 4px 0;display:none;flex-direction:column;gap:7px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px} #mail-mod .newlab.show{display:flex}
    #mail-mod .newlab input{border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-family:inherit;font-size:13.5px;outline:none}
    #mail-mod .swatches{display:flex;gap:6px} #mail-mod .swatch{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid transparent} #mail-mod .swatch.on{border-color:#2B2017}
    #mail-mod .newlab .nb{display:flex;gap:6px} #mail-mod .newlab button{flex:1;font-family:inherit;font-size:13px;font-weight:600;border-radius:8px;padding:7px;cursor:pointer;border:1px solid var(--line);background:var(--surface)} #mail-mod .newlab .ok{background:var(--orange);color:#fff;border:none}
    /* List */
    #mail-mod .list{border-right:1px solid var(--line);overflow:auto;background:var(--canvas,#F4EFE7);display:flex;flex-direction:column}
    #mail-mod .lhd{display:flex;align-items:center;padding:15px 16px 6px;position:sticky;top:0;background:var(--canvas,#F4EFE7);z-index:4}
    #mail-mod .lhd h2{font-size:23px;font-weight:700;margin:0} #mail-mod .lhd .sub{font-size:13px;color:var(--muted);margin-top:1px}
    #mail-mod .expand{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--muted);display:none;align-items:center;justify-content:center;font-size:18px;cursor:pointer;flex:none;margin-right:10px}
    #mail-mod .mwrap.collapsed .expand{display:flex}
    #mail-mod .focus{margin:8px 16px 2px;background:#F1ECF8;border:1px solid #DED3EE;border-radius:12px;padding:11px 13px;display:flex;gap:10px;align-items:flex-start}
    #mail-mod .focus .fi{width:28px;height:28px;border-radius:8px;background:#6F57A0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
    #mail-mod .focus .ft{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#4A3A78} #mail-mod .focus .fx{font-size:13.5px;color:#39335A;margin-top:3px;line-height:1.45}
    #mail-mod .focus .fbtn{margin-top:5px;background:#6F57A0;color:#fff;border:none;border-radius:8px;padding:6px 11px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer} #mail-mod .focus .fbtn:disabled{opacity:.6}
    #mail-mod .srch{display:flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:9px 12px;margin:8px 16px 2px;box-shadow:0 1px 2px rgba(58,40,24,.05)}
    #mail-mod .srch i{color:var(--soft);font-size:17px} #mail-mod .srch input{border:none;background:none;font:inherit;font-size:14.5px;flex:1;outline:none;color:inherit}
    #mail-mod .mbar{display:flex;align-items:center;gap:10px;padding:8px 16px 6px}
    #mail-mod .selall{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);cursor:pointer;user-select:none} #mail-mod .selall input{width:17px;height:17px;accent-color:var(--orange);cursor:pointer}
    #mail-mod .barbtns{margin-left:auto;display:none;gap:8px} #mail-mod .barbtns.show{display:flex}
    #mail-mod .bb{font-family:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:#5b5249;cursor:pointer;display:inline-flex;align-items:center;gap:6px} #mail-mod .bb:hover{background:#fff} #mail-mod .bb.danger:hover{background:#FBECEC;color:#A32D2D;border-color:#E9C9C9}
    #mail-mod .scroll{overflow:auto;padding:4px 12px 16px}
    #mail-mod .mrow{display:flex;gap:11px;background:var(--surface,#fff);border:1px solid var(--line2,#F0E8DA);border-radius:12px;padding:11px 13px;margin-bottom:7px;cursor:pointer;box-shadow:0 1px 2px rgba(58,40,24,.04);transition:box-shadow .12s,transform .12s}
    #mail-mod .mrow:hover{transform:translateY(-1px);box-shadow:0 2px 8px rgba(58,40,24,.08),0 16px 36px rgba(58,40,24,.10)}
    #mail-mod .mrow.on{box-shadow:0 0 0 2px var(--orange,#E8722B),0 16px 36px rgba(58,40,24,.10)} #mail-mod .mrow.sel{background:#FFF7F0;border-color:#F0CDB4}
    #mail-mod .mcheck{width:18px;height:18px;margin-top:3px;accent-color:var(--orange);cursor:pointer;flex:none}
    #mail-mod .mc{min-width:0;flex:1}
    #mail-mod .mr1{display:flex;align-items:center;gap:8px} #mail-mod .mr1 .un{width:8px;height:8px;border-radius:50%;background:var(--orange);flex:none}
    #mail-mod .mr1 .who{font-size:15.5px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #mail-mod .mrow.unread .who{font-weight:700}
    #mail-mod .mr1 .tm{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--soft);flex:none}
    #mail-mod .msub{font-size:14px;font-weight:500;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .msnip{font-size:12.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mail-mod .rdots{display:flex;gap:5px;margin-top:7px;align-items:center} #mail-mod .rdots .ld{width:8px;height:8px;border-radius:50%}
    #mail-mod .clip{margin-left:5px;color:var(--soft);font-size:13px}
    #mail-mod .pn{display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-size:11.5px;font-weight:600;color:#8A6A1E;background:#FBF3DD;border:1px solid #EDD9A6;padding:3px 8px;border-radius:6px;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    /* Read */
    #mail-mod .mread{overflow:auto;background:var(--canvas,#F4EFE7);display:flex;flex-direction:column;min-width:0}
    #mail-mod .mr-empty{margin:auto;color:var(--muted);font-size:15px;text-align:center;padding:40px}
    #mail-mod #mailRead .mr-pad{padding:28px 44px 56px;max-width:920px!important;margin-left:auto!important;margin-right:auto!important;width:100%;box-sizing:border-box}
    #mail-mod .mr-top{display:flex;align-items:flex-start;gap:14px}
    #mail-mod .mr-h{font-size:24px;font-weight:700;line-height:1.25;flex:1}
    #mail-mod .mr-acts{display:flex;gap:7px;flex:none;position:relative}
    #mail-mod .ib{width:39px;height:39px;border-radius:11px;border:1px solid var(--line);background:var(--surface);color:#6A5C4E;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer} #mail-mod .ib:hover{background:#fff} #mail-mod .ib.danger:hover{background:#FBECEC;color:#A32D2D;border-color:#E9C9C9}
    #mail-mod .labmenu{position:absolute;top:46px;right:0;background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:0 12px 30px rgba(58,40,24,.16);padding:6px;z-index:20;display:none;min-width:190px} #mail-mod .labmenu.show{display:block}
    #mail-mod .labmenu .li{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;font-size:13.5px;cursor:pointer} #mail-mod .labmenu .li:hover{background:var(--canvas)} #mail-mod .labmenu .li .dot{width:10px;height:10px;border-radius:50%} #mail-mod .labmenu .li .tick{margin-left:auto;color:var(--orange);font-size:15px;visibility:hidden} #mail-mod .labmenu .li.on .tick{visibility:visible} #mail-mod .labmenu .none{padding:8px 9px;font-size:12.5px;color:var(--soft)}
    #mail-mod .chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px} #mail-mod .chip2{font-size:12px;font-weight:600;padding:4px 10px;border-radius:7px;display:inline-flex;align-items:center;gap:6px;color:#fff}
    #mail-mod .mr-from{display:flex;align-items:center;gap:12px;margin-top:18px}
    #mail-mod .mr-av{width:44px;height:44px;border-radius:50%;background:#EFE0D2;color:#9A4A2B;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:none}
    #mail-mod .mr-nm{font-size:15px;font-weight:600} #mail-mod .mr-em{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)} #mail-mod .mr-when{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--soft)}
    #mail-mod .aisum{margin:16px 0 4px;background:#F1ECF8;border:1px solid #DED3EE;border-radius:13px;padding:13px 15px;display:none;gap:11px} #mail-mod .aisum.show{display:flex}
    #mail-mod .aisum .ic{width:28px;height:28px;border-radius:8px;background:#6F57A0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
    #mail-mod .aisum .t{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#4A3A78} #mail-mod .aisum .x{font-size:14.5px;color:#39335A;margin-top:2px;line-height:1.5}
    #mail-mod .aisum .ai-sumbtn{margin-top:6px;background:#6F57A0;color:#fff;border:none;border-radius:8px;padding:7px 13px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer} #mail-mod .aisum .ai-sumbtn:hover{background:#4A3A78} #mail-mod .aisum .ai-sumbtn:disabled{opacity:.6}
    #mail-mod .atts{display:flex;flex-wrap:wrap;gap:9px;margin:16px 0 2px}
    #mail-mod .att{display:inline-flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:9px 12px;cursor:pointer;box-shadow:0 1px 2px rgba(58,40,24,.05)} #mail-mod .att:hover{background:#fff}
    #mail-mod .att .ai{width:30px;height:30px;border-radius:8px;background:#EDE4D6;color:#7A6A55;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
    #mail-mod .att .an{font-size:13.5px;font-weight:600;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #mail-mod .att .az{font-size:11.5px;color:var(--soft);font-family:'JetBrains Mono',monospace}
    #mail-mod .mailframe{width:100%;border:none;background:#fff;border-radius:12px;min-height:120px;margin:16px 0 6px;display:block}
    #mail-mod .mr-body{font-size:15px;line-height:1.74;margin:16px 0 6px;white-space:pre-wrap;word-wrap:break-word}
    #mail-mod .body-acts{display:flex;gap:10px;margin:18px 0 4px}
    #mail-mod .composer{margin:8px 0 0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface);display:none} #mail-mod .composer.show{display:block}
    #mail-mod .cm-top{padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted);background:var(--canvas,#F4EFE7)} #mail-mod .cm-top b{color:#2B2017;font-weight:600}
    #mail-mod .ai-row{display:flex;align-items:center;gap:9px;padding:11px 14px;background:#F1ECF8;border-bottom:1px solid #DED3EE} #mail-mod .ai-row.hide{display:none}
    #mail-mod .ai-draft{display:inline-flex;align-items:center;gap:7px;background:#6F57A0;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;flex:none} #mail-mod .ai-draft:hover{background:#4A3A78} #mail-mod .ai-draft:disabled{opacity:.6}
    #mail-mod .ai-instr{flex:1;border:1px solid #DED3EE;border-radius:9px;padding:9px 11px;font-family:inherit;font-size:13.5px;outline:none;background:#fff;color:inherit}
    #mail-mod .cm-to{width:calc(100% - 28px);margin:12px 14px 0;border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-family:inherit;font-size:13.5px;outline:none;display:none} #mail-mod .cm-to.show{display:block}
    #mail-mod .cm-body{min-height:140px;max-height:340px;overflow:auto;padding:14px 16px;font-family:inherit;font-size:15px;line-height:1.6;outline:none}
    #mail-mod .cm-body:empty:before{content:attr(data-ph);color:var(--soft)}
    #mail-mod .cm-atts{display:flex;flex-wrap:wrap;gap:7px;padding:0 14px} #mail-mod .cm-atts:not(:empty){padding:4px 14px 10px}
    #mail-mod .cm-att{display:inline-flex;align-items:center;gap:7px;background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:5px 9px;font-size:12.5px} #mail-mod .cm-att .x{cursor:pointer;color:var(--soft);font-size:14px} #mail-mod .cm-att .x:hover{color:#A32D2D}
    #mail-mod .cm-foot{display:flex;align-items:center;gap:9px;padding:11px 14px;border-top:1px solid var(--line);background:var(--canvas,#F4EFE7)}
    #mail-mod .tools{display:flex;gap:4px}
    #mail-mod .tool{width:34px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:#6A5C4E;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer} #mail-mod .tool:hover{background:#fff}
    #mail-mod .cm-note{margin:0 auto 0 6px;font-size:12.5px;color:var(--soft)}
    #mail-mod .polish{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid #DED3EE;color:#4A3A78;border-radius:9px;padding:8px 12px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer} #mail-mod .polish:hover{background:#F1ECF8} #mail-mod .polish:disabled{opacity:.6}
    #mail-mod .btn{font-family:inherit;font-size:14.5px;font-weight:700;padding:10px 18px;border:none;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
    #mail-mod .btn-ghost{background:var(--surface);border:1px solid var(--line);color:#5b5249} #mail-mod .btn-ghost:hover{background:#fff}
    #mail-mod .btn-send{background:var(--orange,#E8722B);color:#fff} #mail-mod .btn-send:disabled{opacity:.5}
    #mail-mod .pinnote{display:flex;align-items:flex-start;gap:11px;margin:14px 0 0;background:#FBF3DD;border:1px solid #EDD9A6;border-radius:14px;padding:13px 15px}
    #mail-mod .pinnote .pi{color:#8A6A1E;font-size:19px;flex:none;margin-top:1px} #mail-mod .pinnote .pl{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8A6A1E} #mail-mod .pinnote .pt{font-size:14.5px;color:#5c4a22;margin-top:2px;line-height:1.5;white-space:pre-wrap}
    #mail-mod .pinnote .pe{display:flex;gap:6px;margin-left:auto;flex:none} #mail-mod .pinnote .pb{width:30px;height:30px;border-radius:8px;border:1px solid #EDD9A6;background:#fff;color:#8A6A1E;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer}
    #mail-mod .noteedit{margin:14px 0 0;background:#FBF3DD;border:1px solid #EDD9A6;border-radius:14px;padding:12px 14px} #mail-mod .noteedit textarea{width:100%;border:1px solid #EDD9A6;border-radius:9px;padding:9px;font-family:inherit;font-size:14px;outline:none;resize:vertical;min-height:60px;background:#fff} #mail-mod .noteedit .nf{display:flex;gap:7px;justify-content:flex-end;margin-top:8px}
    #mail-mod .loading,#mail-mod .errbox{padding:30px;color:var(--muted);font-size:14.5px} #mail-mod .errbox{color:#A32D2D}
    #mail-mod .toast{position:absolute;left:50%;transform:translateX(-50%);bottom:18px;background:#2B2017;color:#fff;font-size:13.5px;padding:10px 16px;border-radius:10px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:30} #mail-mod .toast.show{opacity:1}
  </style>
  <div class="mwrap" id="mwrap">
    <nav class="rail">
      <div class="rbrand">FK</div>
      <div class="ri" data-go="#home" title="Home"><i class="ti ti-home"></i></div>
      <div class="ri" data-go="#hr/users" title="People"><i class="ti ti-users"></i></div>
      <div class="ri" data-go="#leaves-time" title="Leave & time"><i class="ti ti-calendar"></i></div>
      <div class="ri" data-go="#my-work" title="Tasks"><i class="ti ti-checklist"></i></div>
      <div class="ri on" title="Mail"><i class="ti ti-mail"></i></div>
      <div class="rsp"></div>
      <div class="ri" data-go="#system/settings" title="Settings"><i class="ti ti-settings"></i></div>
      <div class="rav" data-go="#my-growth" title="About me">ME</div>
    </nav>
    <aside class="mnav" id="mnav">
      <div class="mnav-hd"><span class="t">Mail</span><button class="collapse" id="collapseBtn" title="Collapse"><i class="ti ti-layout-sidebar-left-collapse"></i></button></div>
      <button class="composebtn" id="composeBtn"><i class="ti ti-pencil-plus"></i> Compose</button>
      <div class="mboxsw" id="mboxsw"><div><div class="d1">Mailbox</div><div class="d2">Personal <span class="pill">you</span></div></div><i class="ti ti-chevron-down cv"></i>
        <div class="swmenu" id="swmenu"><div class="it">Personal <span class="tag">you</span></div><div class="it dim">Customer Service <span class="tag">coming soon</span></div></div>
      </div>
      <div class="msec">Mailbox</div>
      <div class="mni on" data-box="inbox"><i class="ti ti-inbox lead"></i> Inbox <span class="ct" id="ctInbox"></span></div>
      <div class="mni" data-box="sent"><i class="ti ti-send lead"></i> Sent</div>
      <div class="mni" data-box="drafts"><i class="ti ti-file-text lead"></i> Drafts <span class="ct" id="ctDrafts"></span></div>
      <div class="mni" data-box="archive"><i class="ti ti-archive lead"></i> Archive</div>
      <div class="msec">My labels <i class="ti ti-plus add" id="addLabel" title="New label"></i></div>
      <div id="labelList"></div>
      <div class="newlab" id="newLab"><input id="newLabName" placeholder="Label name" maxlength="40"><div class="swatches" id="swatches"></div><div class="nb"><button id="newLabCancel">Cancel</button><button class="ok" id="newLabAdd">Add label</button></div></div>
      <div class="msig" id="sigBtn"><i class="ti ti-signature"></i> Email signature</div>
    </aside>
    <section class="list">
      <div class="lhd"><button class="expand" id="expandBtn" title="Show mailboxes"><i class="ti ti-layout-sidebar-left-expand"></i></button><div><h2 id="listTitle">Inbox</h2><div class="sub" id="mailSub">Loading…</div></div></div>
      <div class="focus" id="focusStrip" style="display:none"><div class="fi"><i class="ti ti-sparkles"></i></div><div style="flex:1"><div class="ft">Focus today</div><div id="focusBody"><button class="fbtn" id="focusBtn">What needs me today?</button></div></div></div>
      <div class="srch"><i class="ti ti-search"></i><input id="srch" placeholder="Search your mail"></div>
      <div class="mbar"><label class="selall"><input type="checkbox" id="selAll"> Select all</label><div class="barbtns" id="barBtns"><button class="bb" id="bArchive"><i class="ti ti-archive" style="font-size:15px"></i> Archive</button><button class="bb danger" id="bTrash"><i class="ti ti-trash" style="font-size:15px"></i> Delete</button></div></div>
      <div class="scroll" id="mailRows"><div class="loading">Loading your mail…</div></div>
    </section>
    <section class="mread" id="mailRead"><div class="mr-empty">Select a message to read it here.</div></section>
    <div class="toast" id="mailToast"></div>
    <input type="file" id="attInput" multiple style="display:none">
    <datalist id="mailContacts"></datalist>
    <div class="cwrap" id="cwrap">
      <div class="cwin">
        <div class="chead"><span id="cTitle">New message</span><button class="cx" id="cClose" title="Close"><i class="ti ti-x"></i></button></div>
        <div class="caibar">
          <div class="caitop"><i class="ti ti-sparkles"></i><input id="cAiInstr" class="caiinstr" placeholder="Tell AI what to write\u2026 e.g. ask Kemballs for an updated freight quote"><button class="caibtn" id="cAiWrite"><i class="ti ti-sparkles" style="font-size:14px"></i> Write</button></div>
          <div class="caichips">
            <span class="cailbl">Improve</span>
            <button class="caichip" id="cAiPolish">Polish</button>
            <button class="caichip" id="cAiFix">Fix grammar</button>
            <button class="caichip" id="cAiFormal">More formal</button>
            <button class="caichip" id="cAiFriendly">Friendlier</button>
            <button class="caichip" id="cAiFirmer">Firmer</button>
            <button class="caichip" id="cAiShorter">Shorten</button>
            <button class="caichip" id="cAiExpand">Expand</button>
            <button class="caichip" id="cAiSubject">Suggest subject</button>
          </div>
          <div class="caictx" id="cAiCtx"></div>
          <div class="caierr" id="cAiErr"></div>
        </div>
        <div class="cbody">
          <div class="crow"><input id="cTo" class="cfield" placeholder="To" list="mailContacts" autocomplete="off"><button class="cccbtn" id="cCcBtn">Cc</button><button class="cccbtn" id="cBccBtn">Bcc</button></div>
          <input id="cCc" class="cfield" placeholder="Cc" list="mailContacts" autocomplete="off" style="display:none">
          <input id="cBcc" class="cfield" placeholder="Bcc" list="mailContacts" autocomplete="off" style="display:none">
          <input id="cSubj" class="cfield" placeholder="Subject">
          <div id="cBody" class="cedit" contenteditable="true" data-ph="Write your message…"></div>
          <div id="cAtts" class="cm-atts"></div>
        </div>
        <div class="cfoot">
          <div class="tools"><button class="tool" id="cBold" title="Bold"><i class="ti ti-bold"></i></button><button class="tool" id="cItalic" title="Italic"><i class="ti ti-italic"></i></button><button class="tool" id="cClip" title="Attach a file"><i class="ti ti-paperclip"></i></button></div>
          <span class="cm-note" id="cNote"></span>
          <button class="btn btn-ghost" id="cDraft">Save draft</button>
          <button class="btn btn-send" id="cSend"><i class="ti ti-send" style="font-size:15px"></i> Send</button>
        </div>
      </div>
    </div>
    <div class="sigwrap" id="sigwrap">
      <div class="sigbox">
        <div class="sighd">Email signature</div>
        <div class="sigsub">Added to the bottom of new emails, replies and forwards.</div>
        <textarea id="sigText" placeholder="e.g.&#10;Bobby&#10;FK Sports UK"></textarea>
        <div class="sigf"><button class="btn btn-ghost" id="sigCancel">Cancel</button><button class="btn btn-send" id="sigSave">Save signature</button></div>
      </div>
    </div>
    <style>
      #mail-mod .composebtn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin:0 0 12px;padding:12px;border:none;border-radius:12px;background:var(--orange,#E8722B);color:#fff;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 2px 8px rgba(232,114,43,.28)}
      #mail-mod .composebtn:hover{filter:brightness(1.05)} #mail-mod .composebtn i{font-size:18px}
      #mail-mod .msig{display:flex;align-items:center;gap:9px;margin-top:auto;padding:10px;border-radius:9px;color:var(--muted);cursor:pointer;font-size:13.5px} #mail-mod .msig:hover{background:#EFE7D8;color:#3A322A} #mail-mod .msig i{font-size:16px}
      #mail-mod .cwrap{position:absolute;inset:0;z-index:60;display:none;align-items:flex-start;justify-content:center;background:rgba(40,28,18,.46);padding:38px 18px;overflow:auto} #mail-mod .cwrap.show{display:flex}
      #mail-mod .cwin{width:800px;max-width:100%;margin:auto;background:var(--surface,#fff);border:1px solid var(--line);border-radius:16px;box-shadow:0 30px 80px rgba(58,40,24,.34);overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 76px)}
      #mail-mod .caibar{background:linear-gradient(180deg,#F2EFFA,#FBFAFE);border-bottom:1px solid #E7E0F3;padding:12px 18px}
      #mail-mod .caitop{display:flex;gap:9px;align-items:center}
      #mail-mod .caitop>.ti-sparkles{color:#6F57A0;font-size:19px;flex:none}
      #mail-mod .caiinstr{flex:1;border:1px solid #DED3EE;border-radius:9px;padding:10px 12px;font:inherit;font-size:14px;outline:none;background:#fff;color:inherit}
      #mail-mod .caiinstr:focus{border-color:#6F57A0}
      #mail-mod .caibtn{border:none;border-radius:9px;padding:10px 16px;font:inherit;font-weight:700;font-size:13.5px;cursor:pointer;background:#6F57A0;color:#fff;white-space:nowrap;display:inline-flex;align-items:center;gap:6px} #mail-mod .caibtn:hover{background:#4A3A78}
      #mail-mod .caibtn:disabled{opacity:.55;cursor:default}
      #mail-mod .caichips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}
      #mail-mod .cailbl{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8678A8;margin-right:3px}
      #mail-mod .caichip{border:1px solid #DED3EE;background:#fff;border-radius:99px;padding:5px 12px;font:inherit;font-size:12.5px;font-weight:600;color:#5b5249;cursor:pointer}
      #mail-mod .caichip:hover{border-color:#6F57A0;color:#6F57A0;background:#F4F1FB}
      #mail-mod .caichip:disabled{opacity:.5;cursor:default}
      #mail-mod .caictx{font-size:12px;color:#7d7184;margin-top:9px}
      #mail-mod .caierr{font-size:12.5px;color:#A32D2D;margin-top:8px}
      #mail-mod .chead{display:flex;align-items:center;background:#2A2018;color:#fff;padding:11px 15px;font-size:14.5px;font-weight:600} #mail-mod .chead span{flex:1}
      #mail-mod .cx{background:none;border:none;color:#C9BBA8;font-size:18px;cursor:pointer;display:flex} #mail-mod .cx:hover{color:#fff}
      #mail-mod .cbody{padding:4px 15px 8px;overflow:auto;display:flex;flex-direction:column}
      #mail-mod .crow{display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--line2,#F0E8DA)}
      #mail-mod .cfield{border:none;border-bottom:1px solid var(--line2,#F0E8DA);padding:11px 2px;font:inherit;font-size:14.5px;outline:none;background:none;width:100%;color:inherit}
      #mail-mod .crow .cfield{flex:1;border-bottom:none}
      #mail-mod .cccbtn{background:none;border:none;color:var(--soft);font:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:4px 6px} #mail-mod .cccbtn:hover{color:var(--orange)}
      #mail-mod .cedit{min-height:250px;padding:14px 2px;font-size:15px;line-height:1.6;outline:none;overflow:auto;white-space:pre-wrap} #mail-mod .cedit:empty:before{content:attr(data-ph);color:var(--soft)}
      #mail-mod .cfoot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--line2,#F0E8DA);flex-wrap:wrap}
      #mail-mod .cfoot .tools{display:flex;gap:4px} #mail-mod .cfoot .cm-note{flex:1;font-size:12px;color:var(--muted)}
      #mail-mod .sigwrap{position:absolute;inset:0;background:rgba(40,28,18,.42);z-index:70;display:none;align-items:center;justify-content:center} #mail-mod .sigwrap.show{display:flex}
      #mail-mod .sigbox{width:460px;max-width:calc(100vw - 40px);background:var(--surface,#fff);border-radius:16px;padding:22px;box-shadow:0 24px 60px rgba(58,40,24,.3)}
      #mail-mod .sighd{font-size:19px;font-weight:700} #mail-mod .sigsub{font-size:13px;color:var(--muted);margin:3px 0 12px}
      #mail-mod .sigbox textarea{width:100%;min-height:120px;border:1px solid var(--line);border-radius:11px;padding:12px;font:inherit;font-size:14.5px;outline:none;resize:vertical;box-sizing:border-box}
      #mail-mod .sigf{display:flex;justify-content:flex-end;gap:9px;margin-top:14px}
      #mail-mod .cm-cc{display:none} #mail-mod .cm-cc.show{display:block}
      #mail-mod .loadmore{display:block;width:100%;margin:6px 0 12px;padding:11px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:#5b5249;font:inherit;font-weight:600;font-size:13.5px;cursor:pointer} #mail-mod .loadmore:hover{background:#fff} #mail-mod .loadmore:disabled{opacity:.6;cursor:default}
      #mail-mod .thct{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#E5DAC8;color:#6b5d49;font-size:11px;font-weight:700;margin:0 7px;flex:none} #mail-mod .mrow.unread .thct{background:#D8C8AE}
      #mail-mod #thwrap{margin:8px 0 2px}
      #mail-mod .thtoggle{display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 13px;font-family:inherit;font-size:13.5px;font-weight:600;color:#5b5249;cursor:pointer} #mail-mod .thtoggle:hover{background:#fff} #mail-mod .thtoggle.on{background:#F1ECF8;border-color:#DED3EE;color:#4A3A78} #mail-mod .thtoggle i{font-size:16px} #mail-mod .thtoggle:disabled{opacity:.7}
      #mail-mod .thlist{display:none;margin-top:11px} #mail-mod .thlist.show{display:block}
      #mail-mod .thmsg{background:var(--surface);border:1px solid var(--line2,#F0E8DA);border-left:3px solid #DED3EE;border-radius:10px;padding:11px 14px;margin-bottom:9px}
      #mail-mod .thm-h{display:flex;align-items:center;gap:10px;margin-bottom:5px} #mail-mod .thm-nm{font-weight:700;font-size:13.5px} #mail-mod .thm-dt{font-size:11.5px;color:var(--soft);margin-left:auto}
      #mail-mod .thm-b{font-size:15px;line-height:1.74;color:#2B2017;max-height:320px;overflow:auto}
    </style>
  </div>
</div>`;
  },

  async mount(root) {
    const $ = (s) => root.querySelector(s);
    const rowsEl = $('#mailRows'), subEl = $('#mailSub'), listTitle = $('#listTitle');
    const readEl = $('#mailRead'), mwrap = $('#mwrap'), toastEl = $('#mailToast');
    const selAll = $('#selAll'), barBtns = $('#barBtns'), srchEl = $('#srch'), attInput = $('#attInput');
    let messages = [], box = 'inbox', selectedId = null, sel = new Set(), summaryCache = {}, focusCache = {};
    let labels = [], labelMap = {}, notesMap = {}, labelFilter = null, query = '';
    let pendingAtts = [], attTarget = null;
    let nextPageTok = null, contacts = [], signature = '', composeAtts = [], composeCfg = null, searchTimer = null;
    const SWATCHES = ['#6F57A0', '#2D6FB0', '#2E8C6F', '#9A4E8A', '#C2613B', '#B0892D'];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // Gmail snippets arrive HTML-entity-encoded (e.g. I&#39;m). Decode, then escape only the unsafe chars so it shows as clean text.
    const deEntity = (s) => String(s == null ? '' : s)
      .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch (e) { return _; } })
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch (e) { return _; } })
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    const escSnip = (s) => deEntity(s).replace(/[<>"]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const parseFrom = (from) => { const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); return m ? { name: m[1].trim() || m[2], email: m[2].trim() } : { name: from || '', email: (from || '').trim() }; };
    const shortDate = (d) => { try { return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d || ''; } };
    const fmtSize = (b) => !b ? '' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
    const toast = (m) => { toastEl.textContent = m; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), 2200); };
    const labelById = (id) => labels.find(l => l.id === id);
    const j = (url, opts) => fetch(url, Object.assign({ credentials: 'include' }, opts)).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || ('Request failed (' + r.status + ').')); e.code = d.code; throw e; } return d; });
    const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const readFileB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
    function downloadB64url(b64u, filename, mime) {
      const s = String(b64u).replace(/-/g, '+').replace(/_/g, '/'); const pad = s.length % 4 ? '='.repeat(4 - s.length % 4) : '';
      const bin = atob(s + pad); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = filename || 'attachment'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    // Full-bleed: slim away the FK sidebar while in Mail; restore on leaving.
    const appEl = document.querySelector('.app');
    if (appEl) {
      appEl.classList.add('mail-focus');
      if (window.__fkMailFocusOff) window.removeEventListener('hashchange', window.__fkMailFocusOff);
      window.__fkMailFocusOff = function () { if ((location.hash || '').indexOf('mail') === -1) { appEl.classList.remove('mail-focus'); window.removeEventListener('hashchange', window.__fkMailFocusOff); window.__fkMailFocusOff = null; } };
      window.addEventListener('hashchange', window.__fkMailFocusOff);
    }
    root.querySelectorAll('.rail [data-go]').forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.go; }));

    // Mail column
    root.querySelectorAll('.mni[data-box]').forEach(el => el.addEventListener('click', () => { root.querySelectorAll('.mni').forEach(n => n.classList.remove('on')); el.classList.add('on'); box = el.dataset.box; labelFilter = null; loadBox(); }));
    $('#collapseBtn').addEventListener('click', () => mwrap.classList.add('collapsed'));
    $('#expandBtn').addEventListener('click', () => mwrap.classList.remove('collapsed'));
    $('#mboxsw').addEventListener('click', (e) => { e.stopPropagation(); $('#swmenu').classList.toggle('show'); });
    document.addEventListener('click', () => { const s = $('#swmenu'); if (s) s.classList.remove('show'); });

    // Labels
    function renderLabels() {
      const counts = {}; Object.values(labelMap).forEach(ids => ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
      $('#labelList').innerHTML = labels.map(l => '<div class="mni' + (labelFilter === l.id ? ' on' : '') + '" data-label="' + l.id + '"><span class="dot" style="background:' + esc(l.colour) + '"></span>' + esc(l.name) + (counts[l.id] ? '<span class="ct">' + counts[l.id] + '</span>' : '') + '<i class="ti ti-x del" data-del="' + l.id + '" title="Delete label"></i></div>').join('') || '<div style="font-size:13px;color:var(--soft);padding:4px 10px">No labels yet.</div>';
      $('#labelList').querySelectorAll('[data-label]').forEach(el => el.addEventListener('click', (ev) => {
        if (ev.target.dataset.del) return; const id = parseInt(el.dataset.label, 10); labelFilter = labelFilter === id ? null : id;
        root.querySelectorAll('.mni').forEach(n => n.classList.remove('on')); if (labelFilter) el.classList.add('on'); else root.querySelector('.mni[data-box="' + box + '"]').classList.add('on'); renderRows();
      }));
      $('#labelList').querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', async (ev) => { ev.stopPropagation(); if (!confirm('Delete this label? It will be removed from all emails.')) return; try { await j('/api/mail/labels/' + el.dataset.del, { method: 'DELETE' }); await refreshLabels(); if (selectedId) openMessage(selectedId); toast('Label deleted'); } catch (e) { toast(e.message); } }));
    }
    async function refreshLabels() { const [a, b] = await Promise.all([j('/api/mail/labels'), j('/api/mail/labelmap')]); labels = a.labels || []; labelMap = b.map || {}; renderLabels(); }
    let pickColour = SWATCHES[0];
    $('#swatches').innerHTML = SWATCHES.map((c, i) => '<span class="swatch' + (i === 0 ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></span>').join('');
    $('#swatches').querySelectorAll('.swatch').forEach(s => s.addEventListener('click', () => { pickColour = s.dataset.c; $('#swatches').querySelectorAll('.swatch').forEach(x => x.classList.remove('on')); s.classList.add('on'); }));
    $('#addLabel').addEventListener('click', () => { $('#newLab').classList.add('show'); $('#newLabName').focus(); });
    $('#newLabCancel').addEventListener('click', () => { $('#newLab').classList.remove('show'); $('#newLabName').value = ''; });
    $('#newLabAdd').addEventListener('click', async () => { const name = $('#newLabName').value.trim(); if (!name) return; try { await post('/api/mail/labels', { name, colour: pickColour }); $('#newLab').classList.remove('show'); $('#newLabName').value = ''; await refreshLabels(); toast('Label added'); } catch (e) { toast(e.message); } });

    // Focus today (on demand)
    async function runFocus() {
      const btn = $('#focusBody .fbtn'); if (btn) { btn.disabled = true; btn.textContent = 'Reading your inbox…'; }
      try { const out = await post('/api/mail/ai/focus', { items: messages.slice(0, 40).map(m => ({ from: parseFrom(m.from).name, subject: m.subject, snippet: m.snippet })) }); focusCache.inbox = out.focus || ''; $('#focusBody').innerHTML = '<div class="fx">' + esc(out.focus || 'Nothing urgent.') + '</div>'; }
      catch (e) { $('#focusBody').innerHTML = '<div class="fx" style="color:#A32D2D">' + esc(e.code === 'NO_KEY' ? 'AI needs a one-time key set up first.' : e.message) + '</div>'; }
    }

    // List
    async function loadBox(append) {
      if (!append) {
        sel.clear(); selAll.checked = false; updateBar(); nextPageTok = null;
        listTitle.textContent = box === 'sent' ? 'Sent' : box === 'archive' ? 'Archive' : box === 'drafts' ? 'Drafts' : 'Inbox';
        $('#focusStrip').style.display = box === 'inbox' ? 'flex' : 'none';
        if (box === 'inbox') { $('#focusBody').innerHTML = focusCache.inbox ? '<div class="fx">' + esc(focusCache.inbox) + '</div>' : '<button class="fbtn">What needs me today?</button>'; const fb = $('#focusBody .fbtn'); if (fb) fb.addEventListener('click', runFocus); }
        rowsEl.innerHTML = '<div class="loading">Loading…</div>';
      }
      try {
        const url = '/api/mail/inbox?box=' + box + (query ? '&q=' + encodeURIComponent(query) : '') + (append && nextPageTok ? '&pageToken=' + encodeURIComponent(nextPageTok) : '');
        const data = await j(url);
        const incoming = data.messages || [];
        messages = append ? messages.concat(incoming) : incoming;
        nextPageTok = data.nextPageToken || null;
        if (box === 'inbox' && !query) $('#ctInbox').textContent = messages.length ? (messages.length + (nextPageTok ? '+' : '')) : '';
        renderRows();
        if (!append) {
          if (box === 'drafts') { selectedId = null; readEl.innerHTML = '<div class="mr-empty">' + (visible().length ? 'Select a draft to continue editing.' : 'No drafts.') + '</div>'; }
          else { const vis = visible(); if (vis.length) openMessage(vis[0].id); else { selectedId = null; readEl.innerHTML = '<div class="mr-empty">' + (query ? 'No matches for &ldquo;' + esc(query) + '&rdquo;.' : 'Nothing here.') + '</div>'; } }
        }
      } catch (e) { if (!append) { rowsEl.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>'; subEl.textContent = ''; } else { toast(e.message); } }
    }
    function visible() { let ms = messages; if (labelFilter) ms = ms.filter(m => (labelMap[m.id] || []).includes(labelFilter)); return ms; }
    function renderRows() {
      const ms = visible(); const unread = ms.filter(m => m.unread).length;
      const noun = box === 'drafts' ? 'draft' : 'message';
      subEl.textContent = ms.length + ' ' + noun + (ms.length === 1 ? '' : 's') + (box === 'inbox' && unread ? ' · ' + unread + ' unread' : '') + (nextPageTok ? '+' : '');
      if (!ms.length) { rowsEl.innerHTML = '<div class="loading">' + (query ? 'No matching messages.' : 'Nothing here.') + '</div>'; return; }
      const recipBox = (box === 'sent' || box === 'drafts');
      rowsEl.innerHTML = ms.map(m => {
        const f = parseFrom(m.from); const note = notesMap[m.id]; const lids = labelMap[m.id] || [];
        let who = recipBox ? (parseFrom(m.to).name || '(no recipient)') : f.name;
        if (box === 'sent') who = 'To: ' + who; else if (box === 'drafts') who = 'Draft · ' + who;
        const dots = lids.length ? '<div class="rdots">' + lids.map(id => { const l = labelById(id); return l ? '<span class="ld" style="background:' + esc(l.colour) + '"></span>' : ''; }).join('') + '</div>' : '';
        const pn = note ? '<div class="pn"><i class="ti ti-note" style="font-size:12px"></i> ' + esc(note) + '</div>' : '';
        return '<div class="mrow' + (m.unread ? ' unread' : '') + (m.id === selectedId ? ' on' : '') + (sel.has(m.id) ? ' sel' : '') + '" data-id="' + m.id + '"><input type="checkbox" class="mcheck"' + (sel.has(m.id) ? ' checked' : '') + ' data-id="' + m.id + '"><div class="mc"><div class="mr1">' + (m.unread ? '<span class="un"></span>' : '') + '<span class="who">' + esc(who) + '</span>' + (m.count > 1 ? '<span class="thct" title="' + m.count + ' messages">' + m.count + '</span>' : '') + '<span class="tm">' + esc(shortDate(m.date)) + '</span></div><div class="msub">' + esc(m.subject) + '</div><div class="msnip">' + escSnip(m.snippet) + '</div>' + dots + pn + '</div></div>';
      }).join('') + (nextPageTok ? '<button class="loadmore" id="loadMore">Load older ' + noun + 's</button>' : '');
      rowsEl.querySelectorAll('.mrow').forEach(el => el.addEventListener('click', (ev) => { if (ev.target.classList.contains('mcheck')) return; if (box === 'drafts') openDraft(el.dataset.id); else openMessage(el.dataset.id); }));
      rowsEl.querySelectorAll('.mcheck').forEach(cb => cb.addEventListener('click', (ev) => { ev.stopPropagation(); const id = cb.dataset.id; if (cb.checked) sel.add(id); else sel.delete(id); cb.closest('.mrow').classList.toggle('sel', cb.checked); selAll.checked = sel.size === visible().length && visible().length > 0; updateBar(); }));
      const lm = rowsEl.querySelector('#loadMore'); if (lm) lm.addEventListener('click', () => { lm.disabled = true; lm.textContent = 'Loading…'; loadBox(true); });
    }
    function updateBar() { barBtns.classList.toggle('show', sel.size > 0); }
    selAll.addEventListener('change', () => { sel.clear(); if (selAll.checked) visible().forEach(m => sel.add(m.id)); renderRows(); updateBar(); });
    srchEl.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { const q = srchEl.value.trim(); if (q === query) return; query = q; loadBox(false); }, 380); });

    async function act(url, ids, verb) {
      try {
        await post(url, { ids });
        const idx = messages.findIndex(m => m.id === selectedId);
        const wasOpen = ids.includes(selectedId);
        messages = messages.filter(m => !ids.includes(m.id));
        ids.forEach(id => sel.delete(id)); selAll.checked = false;
        renderRows(); updateBar();
        if (wasOpen) {
          const vis = visible();
          const next = vis.length ? vis[Math.min(Math.max(idx, 0), vis.length - 1)] : null;
          if (next) openMessage(next.id); else { selectedId = null; readEl.innerHTML = '<div class="mr-empty">Select a message to read it here.</div>'; }
        }
        toast(ids.length + ' ' + verb);
      } catch (e) { toast(e.message); }
    }
    function expandIds() { const out = []; sel.forEach(rid => { const r = messages.find(x => x.id === rid); ((r && r.msgIds && r.msgIds.length) ? r.msgIds : [rid]).forEach(x => out.push(x)); }); return out; }
    $('#bArchive').addEventListener('click', () => { if (sel.size) act('/api/mail/archive', expandIds(), 'archived'); });
    $('#bTrash').addEventListener('click', () => { if (sel.size) act('/api/mail/trash', expandIds(), 'deleted'); });

    // Compose attachments (shared picker)
    attInput.addEventListener('change', async () => {
      for (const file of attInput.files) { if (file.size > 20 * 1048576) { toast(file.name + ' is over 20MB'); continue; } try { pendingAtts.push({ filename: file.name, mimeType: file.type || 'application/octet-stream', dataB64: await readFileB64(file) }); } catch (e) {} }
      attInput.value = ''; if (attTarget) attTarget();
    });

    // Reading pane
    async function openMessage(id) {
      selectedId = id; renderRows();
      readEl.innerHTML = '<div class="loading">Opening…</div>';
      try {
        const m = await Promise.race([
          j('/api/mail/message/' + encodeURIComponent(id)),
          new Promise((_, rej) => setTimeout(() => rej(new Error('The server did not respond in 20 seconds.')), 20000))
        ]);
        console.log('[mail] opened', id, '→', m && m.subject, '| attachments:', (m && m.attachments || []).length);
        if (messages.find(x => x.id === id)) messages.find(x => x.id === id).unread = false;
        const f = parseFrom(m.from);
        const plain = m.text || String(m.html || '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
        const hasHtml = !!(m.html && m.html.trim());
        const bodyHtml = hasHtml ? '<iframe class="mailframe" id="mailFrame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Email"></iframe>' : '<div class="mr-body">' + esc(m.text || '(no content)') + '</div>';
        const initials = (() => { const src = String(f.name || f.email || '').trim(); const parts = src.split(/\s+/).filter(Boolean); return (parts.length >= 2 ? (parts[0][0] + parts[1][0]) : src.slice(0, 2)).toUpperCase(); })();
        const atts = m.attachments || [];
        const attsHtml = atts.length ? '<div class="atts">' + atts.map((a, i) => '<div class="att" data-att="' + i + '"><div class="ai"><i class="ti ti-paperclip"></i></div><div><div class="an">' + esc(a.filename) + '</div><div class="az">' + esc(fmtSize(a.size)) + '</div></div></div>').join('') + '</div>' : '';
        readEl.innerHTML =
          '<div class="mr-pad"><div class="mr-top"><div class="mr-h">' + esc(m.subject) + '</div>' +
            '<div class="mr-acts"><button class="ib" id="aTag" title="Labels"><i class="ti ti-tag"></i></button><button class="ib" id="aArch" title="Archive"><i class="ti ti-archive"></i></button><button class="ib danger" id="aDel" title="Delete"><i class="ti ti-trash"></i></button><div class="labmenu" id="labMenu"></div></div></div>' +
            '<div class="chips" id="chips"></div>' +
            '<div class="mr-from"><div class="mr-av">' + esc(initials) + '</div><div><div class="mr-nm">' + esc(f.name) + '</div><div class="mr-em">' + esc(f.email) + '</div></div><div class="mr-when">' + esc(shortDate(m.date)) + '</div></div>' +
            '<div id="thwrap"></div>' +
            '<div class="aisum" id="aiSum"></div>' + attsHtml + bodyHtml +
            '<div id="noteSlot"></div>' +
            '<div class="body-acts"><button class="btn btn-send" id="bReply"><i class="ti ti-arrow-back-up" style="font-size:16px"></i> Reply</button><button class="btn btn-ghost" id="bReplyAll"><i class="ti ti-arrow-back-up-double" style="font-size:16px"></i> Reply all</button><button class="btn btn-ghost" id="bFwd"><i class="ti ti-arrow-forward-up" style="font-size:16px"></i> Forward</button><button class="btn btn-ghost" id="bNote"><i class="ti ti-note" style="font-size:16px"></i> Note</button></div>' +
            '</div>';

        renderChips(id); renderNote(id);

        // Conversation: surface earlier messages in the thread, on demand.
        const row = messages.find(x => x.id === id) || {};
        const thId = m.threadId || row.threadId; const thCount = row.count || 1;
        if (thCount > 1 && thId) {
          const tw = $('#thwrap');
          tw.innerHTML = '<button class="thtoggle" id="thToggle"><i class="ti ti-messages"></i> Show ' + (thCount - 1) + ' earlier message' + (thCount - 1 === 1 ? '' : 's') + ' in this conversation</button><div class="thlist" id="thList"></div>';
          let loaded = false;
          $('#thToggle').addEventListener('click', async () => {
            const tl = $('#thList'), btn = $('#thToggle');
            if (loaded) { const open = tl.classList.toggle('show'); btn.classList.toggle('on', open); return; }
            btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Loading conversation…';
            try {
              const data = await j('/api/mail/thread/' + encodeURIComponent(thId));
              const older = (data.messages || []).filter(mm => mm.id !== id);
              tl.innerHTML = older.map(mm => {
                const ff = parseFrom(mm.from);
                const pl = (mm.text || String(mm.html || '').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
                return '<div class="thmsg"><div class="thm-h"><span class="thm-nm">' + esc(ff.name) + '</span><span class="thm-dt">' + esc(shortDate(mm.date)) + '</span></div><div class="thm-b">' + esc(pl).replace(/\n/g, '<br>') + '</div></div>';
              }).join('') || '<div class="thmsg"><div class="thm-b" style="color:var(--muted)">No earlier messages.</div></div>';
              loaded = true; tl.classList.add('show'); btn.classList.add('on');
            } catch (e) { tl.innerHTML = '<div class="thmsg"><div class="thm-b" style="color:#A32D2D">Could not load the conversation.</div></div>'; loaded = true; tl.classList.add('show'); }
            btn.disabled = false; btn.innerHTML = '<i class="ti ti-messages"></i> Earlier messages in this conversation';
          });
        }

        // attachments: download incoming
        readEl.querySelectorAll('.att[data-att]').forEach(el => el.addEventListener('click', async () => {
          const a = atts[parseInt(el.dataset.att, 10)]; if (!a) return; toast('Downloading ' + a.filename + '…');
          try { const out = await j('/api/mail/message/' + id + '/attachment/' + a.attachmentId); downloadB64url(out.data, a.filename, a.mimeType); } catch (e) { toast('Could not download.'); }
        }));

        // HTML email render
        if (hasHtml) { const fr = $('#mailFrame'); if (fr) { const safe = String(m.html || '').replace(/<script[\s\S]*?<\/script>/gi, ''); fr.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:6px 10px 14px;font-family:\'Hanken Grotesk\',-apple-system,system-ui,sans-serif;color:#2B2017;font-size:15px;line-height:1.74;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#9A4A2B}table{max-width:100%}</style></head><body>' + safe + '</body></html>'; const fit = () => { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 12) + 'px'; } catch (e) {} }; fr.addEventListener('load', () => { fit(); setTimeout(fit, 400); setTimeout(fit, 1200); }); } }

        // labels menu
        const labMenu = $('#labMenu');
        $('#aTag').addEventListener('click', (e) => {
          e.stopPropagation(); const mine = labelMap[id] || [];
          labMenu.innerHTML = labels.length ? labels.map(l => '<div class="li' + (mine.includes(l.id) ? ' on' : '') + '" data-l="' + l.id + '"><span class="dot" style="background:' + esc(l.colour) + '"></span>' + esc(l.name) + '<i class="ti ti-check tick"></i></div>').join('') : '<div class="none">No labels yet — add one in the Mail menu.</div>';
          labMenu.classList.toggle('show');
          labMenu.querySelectorAll('[data-l]').forEach(it => it.addEventListener('click', async (ev) => { ev.stopPropagation(); const lid = parseInt(it.dataset.l, 10); const on = !it.classList.contains('on'); try { await post('/api/mail/message/' + id + '/label', { labelId: lid, on }); labelMap[id] = labelMap[id] || []; if (on) labelMap[id].push(lid); else labelMap[id] = labelMap[id].filter(x => x !== lid); it.classList.toggle('on', on); renderChips(id); renderLabels(); } catch (e2) { toast(e2.message); } }));
        });
        document.addEventListener('click', () => labMenu.classList.remove('show'));
        const thIds = (row.msgIds && row.msgIds.length) ? row.msgIds : [id];
        $('#aArch').addEventListener('click', () => act('/api/mail/archive', thIds, 'archived'));
        $('#aDel').addEventListener('click', () => act('/api/mail/trash', thIds, 'deleted'));

        // Reply / reply-all / forward open the centered composer (full AI) with context.
        const sigBlock = signature ? ('\n\n' + signature) : '';
        const myEmail = ((window.fkUser && window.fkUser.email) || '').toLowerCase();
        const splitAddrs = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
        const emailOf = (a) => { const mm = String(a).match(/<([^>]+)>/); return (mm ? mm[1] : a).trim().toLowerCase(); };
        const reSubj = /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject;
        const fwdSubj = /^fwd:/i.test(m.subject) ? m.subject : 'Fwd: ' + m.subject;
        $('#bReply').addEventListener('click', () => openCompose({ mode: 'reply', title: 'Reply', to: f.email, subject: reSubj, body: sigBlock, original: plain, inReplyTo: m.messageId, references: m.messageId, threadId: m.threadId }));
        $('#bReplyAll').addEventListener('click', () => {
          const seen = {}; const toUniq = [m.from].concat(splitAddrs(m.to)).filter(a => { const e = emailOf(a); if (!e || e === myEmail || seen[e]) return false; seen[e] = 1; return true; });
          const ccList = splitAddrs(m.cc).filter(a => { const e = emailOf(a); return e && e !== myEmail && !seen[e]; });
          openCompose({ mode: 'replyall', title: 'Reply all', to: toUniq.join(', '), cc: ccList.join(', '), subject: reSubj, body: sigBlock, original: plain, inReplyTo: m.messageId, references: m.messageId, threadId: m.threadId });
        });
        $('#bFwd').addEventListener('click', () => openCompose({ mode: 'forward', title: 'Forward', to: '', subject: fwdSubj, body: sigBlock + '\n\n---------- Forwarded message ----------\nFrom: ' + (m.from || '') + '\nDate: ' + (m.date || '') + '\nSubject: ' + (m.subject || '') + '\n\n' + plain, original: plain }));
        $('#bNote').addEventListener('click', () => editNote(id, notesMap[id] || ''));

        // AI summary on demand
        const sumEl = $('#aiSum'); const sumIcon = '<div class="ic"><i class="ti ti-sparkles"></i></div>';
        const paintSummary = (t) => { sumEl.className = 'aisum show'; sumEl.innerHTML = sumIcon + '<div style="flex:1"><div class="t">AI summary</div><div class="x">' + esc(t) + '</div></div>'; };
        function paintButton() { sumEl.className = 'aisum show'; sumEl.innerHTML = sumIcon + '<div style="flex:1"><div class="t">AI summary</div><button class="ai-sumbtn" id="aiSumBtn">Summarise this email</button></div>'; $('#aiSumBtn').addEventListener('click', runSummary); }
        async function runSummary() { const btn = $('#aiSumBtn'); if (btn) { btn.textContent = 'Summarising…'; btn.disabled = true; } try { const out = await post('/api/mail/ai/summary', { text: plain }); summaryCache[id] = out.summary || ''; if (summaryCache[id]) paintSummary(summaryCache[id]); else sumEl.innerHTML = sumIcon + '<div style="flex:1"><div class="t">AI summary</div><div class="x">Nothing much to summarise.</div></div>'; } catch (e) { sumEl.innerHTML = sumIcon + '<div style="flex:1"><div class="t">AI summary</div><div class="x" style="color:#A32D2D">' + esc(e.code === 'NO_KEY' ? 'AI needs a one-time key set up first.' : e.message) + '</div></div>'; } }
        if (summaryCache[id]) paintSummary(summaryCache[id]); else if (plain.length > 120) paintButton();
      } catch (e) {
        console.error('[mail] openMessage failed for', id, e);
        const msg = (e && e.message) ? e.message : (String(e) || 'Unknown error');
        readEl.innerHTML = '<div class="errbox"><b>Couldn\u2019t open this email.</b><br><span style="color:var(--muted)">' + esc(msg) + '</span><br><br><button class="btn btn-ghost" id="retryOpen"><i class="ti ti-refresh" style="font-size:15px"></i> Try again</button></div>';
        const rb = root.querySelector('#retryOpen'); if (rb) rb.addEventListener('click', () => openMessage(id));
      }
    }

    function renderChips(id) { const el = root.querySelector('#chips'); if (!el) return; const lids = labelMap[id] || []; el.innerHTML = lids.map(lid => { const l = labelById(lid); return l ? '<span class="chip2" style="background:' + esc(l.colour) + '">' + esc(l.name) + '</span>' : ''; }).join(''); }
    function renderNote(id) {
      const slot = root.querySelector('#noteSlot'); if (!slot) return; const note = notesMap[id];
      if (note) { slot.innerHTML = '<div class="pinnote"><i class="ti ti-note pi"></i><div style="flex:1"><div class="pl">Your note · private</div><div class="pt">' + esc(note) + '</div></div><div class="pe"><button class="pb" id="noteEdit" title="Edit"><i class="ti ti-pencil"></i></button><button class="pb" id="noteDel" title="Delete"><i class="ti ti-trash"></i></button></div></div>'; root.querySelector('#noteEdit').addEventListener('click', () => editNote(id, note)); root.querySelector('#noteDel').addEventListener('click', async () => { try { await j('/api/mail/note/' + id, { method: 'DELETE' }); delete notesMap[id]; renderNote(id); renderRows(); toast('Note deleted'); } catch (e) { toast(e.message); } }); }
      else slot.innerHTML = '';
    }
    function editNote(id, current) {
      const slot = root.querySelector('#noteSlot'); slot.innerHTML = '<div class="noteedit"><textarea id="noteBody" placeholder="Private note — only you can see this">' + esc(current) + '</textarea><div class="nf"><button class="btn btn-ghost" id="noteCancel">Cancel</button><button class="btn btn-send" id="noteSave">Save note</button></div></div>';
      const ta = root.querySelector('#noteBody'); ta.focus();
      root.querySelector('#noteCancel').addEventListener('click', () => renderNote(id));
      root.querySelector('#noteSave').addEventListener('click', async () => { const body = ta.value.trim(); try { const out = await j('/api/mail/note/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }); if (out.body) notesMap[id] = out.body; else delete notesMap[id]; renderNote(id); renderRows(); toast('Note saved'); } catch (e) { toast(e.message); } });
    }

    // ---- Contacts (autocomplete) ----
    function fillContacts() { const dl = $('#mailContacts'); if (!dl) return; dl.innerHTML = contacts.map(c => { const v = (c.name && c.name.trim()) ? (c.name + ' <' + c.email + '>') : c.email; return '<option value="' + esc(v) + '">' + esc(c.email) + '</option>'; }).join(''); }

    // ---- Floating composer (new email + continue draft) ----
    const cwrap = $('#cwrap'), cTo = $('#cTo'), cCc = $('#cCc'), cBcc = $('#cBcc'), cCcBtn = $('#cCcBtn'), cBccBtn = $('#cBccBtn'), cSubj = $('#cSubj'), cBody = $('#cBody'), cAtts = $('#cAtts'), cNote = $('#cNote'), cSend = $('#cSend'), cDraftBtn = $('#cDraft'), cAiErr = $('#cAiErr');
    const renderComposeAtts = () => { cAtts.innerHTML = composeAtts.map((a, i) => '<span class="cm-att"><i class="ti ti-paperclip" style="font-size:13px"></i> ' + esc(a.filename) + ' <i class="ti ti-x x" data-i="' + i + '"></i></span>').join(''); cAtts.querySelectorAll('.x').forEach(x => x.addEventListener('click', () => { composeAtts.splice(parseInt(x.dataset.i, 10), 1); renderComposeAtts(); })); };
    function closeCompose() { cwrap.classList.remove('show'); composeCfg = null; composeAtts = []; renderComposeAtts(); cNote.textContent = ''; }
    function openCompose(cfg) {
      composeCfg = cfg || { mode: 'new' }; composeAtts = (cfg && cfg.attachments) || []; renderComposeAtts();
      $('#cTitle').textContent = (cfg && cfg.title) || 'New message';
      cTo.value = (cfg && cfg.to) || ''; cCc.value = (cfg && cfg.cc) || ''; cBcc.value = ''; cSubj.value = (cfg && cfg.subject) || '';
      cCc.style.display = (cfg && cfg.cc) ? 'block' : 'none'; cBcc.style.display = 'none';
      if (cfg && cfg.bodyHtml != null) cBody.innerHTML = cfg.bodyHtml;
      else cBody.innerText = (cfg && cfg.body != null) ? cfg.body : (signature ? ('\n\n' + signature) : '');
      cNote.textContent = ''; cAiErr.textContent = ''; $('#cAiInstr').value = '';
      $('#cAiCtx').textContent = (cfg && cfg.original) ? 'AI can see the message you\u2019re replying to, so Write and the tone tools stay on topic.' : '';
      cwrap.classList.add('show'); setTimeout(() => (cTo.value ? cBody : cTo).focus(), 60);
    }
    async function openDraft(id) {
      const meta = messages.find(x => x.id === id); toast('Opening draft…');
      try {
        const m = await j('/api/mail/message/' + encodeURIComponent(id));
        const hasHtml = !!(m.html && m.html.trim());
        openCompose({ mode: 'draft', title: 'Draft', to: m.to || '', cc: m.cc || '', subject: (m.subject && m.subject !== '(no subject)') ? m.subject : '', bodyHtml: hasHtml ? m.html : null, body: hasHtml ? null : (m.text || ''), draftId: meta && meta.draftId });
      } catch (e) { toast('Could not open draft.'); }
    }
    cCcBtn.addEventListener('click', () => { const show = cCc.style.display === 'none'; cCc.style.display = show ? 'block' : 'none'; if (show) cCc.focus(); });
    cBccBtn.addEventListener('click', () => { const show = cBcc.style.display === 'none'; cBcc.style.display = show ? 'block' : 'none'; if (show) cBcc.focus(); });
    $('#cClose').addEventListener('click', closeCompose);
    $('#cBold').addEventListener('click', () => { cBody.focus(); document.execCommand('bold'); });
    $('#cItalic').addEventListener('click', () => { cBody.focus(); document.execCommand('italic'); });
    $('#cClip').addEventListener('click', () => { attTarget = renderComposeAtts; pendingAtts = composeAtts; attInput.click(); });

    // ---- Compose AI ----
    const aiErrMsg = (e) => (e && e.code === 'NO_KEY') ? 'AI isn\u2019t switched on yet \u2014 add the API key in Railway.' : ((e && e.message) || 'AI failed, try again.');
    async function aiWrite() {
      const btn = $('#cAiWrite'); const instr = $('#cAiInstr').value.trim();
      cAiErr.textContent = ''; btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader-2"></i> Writing…';
      try { const out = await post('/api/mail/ai/compose', { mode: 'write', instruction: instr, original: (composeCfg && composeCfg.original) || '' }); if (out.result) cBody.innerText = out.result; }
      catch (e) { cAiErr.textContent = aiErrMsg(e); }
      btn.disabled = false; btn.innerHTML = old;
    }
    async function aiAction(mode, btn) {
      cAiErr.textContent = '';
      if (mode !== 'write' && !cBody.innerText.trim()) { cAiErr.textContent = 'Write something first, then I can ' + mode + ' it.'; return; }
      const chips = cwrap.querySelectorAll('.caichip, .caibtn'); chips.forEach(c => c.disabled = true);
      const old = btn.textContent; btn.textContent = '…';
      try {
        const out = await post('/api/mail/ai/compose', { mode, text: cBody.innerText, original: (composeCfg && composeCfg.original) || '' });
        if (mode === 'subject') { if (out.result) cSubj.value = out.result.trim().replace(/^["']|["']$/g, ''); }
        else if (out.result) cBody.innerText = out.result;
      } catch (e) { cAiErr.textContent = aiErrMsg(e); }
      chips.forEach(c => c.disabled = false); btn.textContent = old;
    }
    $('#cAiWrite').addEventListener('click', aiWrite);
    [['cAiPolish', 'polish'], ['cAiFix', 'fix'], ['cAiFormal', 'formal'], ['cAiFriendly', 'friendly'], ['cAiFirmer', 'firmer'], ['cAiShorter', 'shorter'], ['cAiExpand', 'expand'], ['cAiSubject', 'subject']].forEach(([id, mode]) => { const b = $('#' + id); if (b) b.addEventListener('click', () => aiAction(mode, b)); });

    async function composeSend(asDraft) {
      const to = cTo.value.trim();
      const cc = cCc.style.display !== 'none' ? cCc.value.trim() : '';
      const bcc = cBcc.style.display !== 'none' ? cBcc.value.trim() : '';
      const text = cBody.innerText.trim(); const html = cBody.innerHTML;
      if (!asDraft && !to) { cNote.textContent = 'Enter at least one recipient.'; return; }
      if (!asDraft && !text) { cNote.textContent = 'Write a message first.'; return; }
      cSend.disabled = true; cDraftBtn.disabled = true; cNote.textContent = asDraft ? 'Saving…' : 'Sending…';
      try {
        const body = { to, cc, bcc, subject: cSubj.value.trim() || '(no subject)', text, html, attachments: composeAtts, draft: !!asDraft };
        if (composeCfg) {
          if (composeCfg.draftId && !asDraft) body.draftId = composeCfg.draftId;
          if (composeCfg.inReplyTo) { body.inReplyTo = composeCfg.inReplyTo; body.references = composeCfg.references; body.threadId = composeCfg.threadId; }
        }
        await post('/api/mail/send', body);
        toast(asDraft ? 'Draft saved' : 'Sent'); closeCompose();
        if (box === 'drafts' || (box === 'sent' && !asDraft)) loadBox(false);
      } catch (e) { cNote.textContent = e.message; }
      cSend.disabled = false; cDraftBtn.disabled = false;
    }
    cSend.addEventListener('click', () => composeSend(false));
    cDraftBtn.addEventListener('click', () => composeSend(true));
    $('#composeBtn').addEventListener('click', () => openCompose({ mode: 'new' }));

    // ---- Signature editor ----
    const sigwrap = $('#sigwrap');
    $('#sigBtn').addEventListener('click', () => { $('#sigText').value = signature || ''; sigwrap.classList.add('show'); setTimeout(() => $('#sigText').focus(), 50); });
    $('#sigCancel').addEventListener('click', () => sigwrap.classList.remove('show'));
    $('#sigSave').addEventListener('click', async () => { const v = $('#sigText').value; try { const out = await j('/api/mail/signature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: v }) }); signature = (out && out.signature != null) ? out.signature : v; sigwrap.classList.remove('show'); toast('Signature saved'); } catch (e) { toast(e.message); } });

    // Boot
    try { await refreshLabels(); } catch (e) {}
    try { notesMap = (await j('/api/mail/notes')).map || {}; } catch (e) {}
    try { const cd = await j('/api/mail/contacts'); contacts = cd.contacts || []; fillContacts(); } catch (e) {}
    try { const sg = await j('/api/mail/signature'); signature = (sg && sg.signature) || ''; } catch (e) {}
    await loadBox();
  }
};
