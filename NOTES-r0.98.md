# r0.98 — Mail reading width: fill the pane (Gmail-like)

Branch: r10-test (FK Home). Two files. Supersedes r0.97 (includes its cache-bust).

## What changed vs r0.97
- public/modules/mail.js — reading column max-width 920px -> 1500px. The 920 cap
  was too narrow and left big empty side margins. Now the content (subject, AI
  summary, body) fills the pane like Gmail. Kept the override-proof selector
  (#mail-mod #mailRead .mr-pad + !important) and min-width:0 on .mread.
  Side padding 44px -> 48px.
- server.js — VERSION r0.97 -> r0.98. Same serveShell cache-bust: index.html is
  served with ?v=r0.98 stamped on every /modules/*.js URL, so this lands on a
  normal reload (no hard-refresh needed) and future ships propagate the same way.

## After deploy
- Reload the FK Home tab once. Reading pane fills the width; no empty side strips.
- /healthz reports r0.98.
- Width is a single number (1500px) — say tighter/wider and it's a one-line tweak.
