# r0.97 — Mail reading column hardened + module cache-bust

Branch: r10-test (FK Home). Two files.

## What changed
1. public/modules/mail.js
   - .mr-pad 920px column cap was being overridden by a shell-global style.
     Raised specificity to `#mail-mod #mailRead .mr-pad` + `!important` on
     max-width and centring margins so nothing in the shell can override it.
   - .mread now has `min-width:0` (grid item) so a wide HTML email can't blow
     out the 1fr track / force a sideways scrollbar.
2. server.js
   - VERSION r0.96 -> r0.97.
   - serveShell(): serves index.html with `?v=<VERSION>` stamped onto every
     /modules/*.js URL. Registered for `/` and `/index.html` (before static)
     and used as the SPA fallback. Each ship bumps VERSION => new module URLs
     => browsers always fetch fresh. Ends the "deployed but shows old" loop.

## After deploy
- Reload the FK Home tab ONCE (normal Cmd+R is enough now). Reading pane is a
  centred 920px column. From now on new ships propagate on a normal reload.
- VERSION check: /healthz should report r0.97.
