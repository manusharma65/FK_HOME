# FK Home r0.73a — My Growth load fix

Branch: r10-test. One file: public/modules/my-growth.js.

## What was wrong
My Growth showed "This section failed to load." The page loader adds a hero banner
and then removes the in-module heading that duplicates the title — that heading was
`<h2 id="mgTitle">My Growth</h2>`. updateTitle() then wrote to that now-removed element
and threw, which the loader catches as "failed to load." It affected every user.

## Fix
updateTitle() is now null-safe and updates the hero heading itself (so viewing another
person still shows "<name>'s growth"). No change to scoring, conduct, or reviews logic.

## Verify
- My Growth opens for you and for a normal user.
- Level ladder / pillar bars show (or "No weekly score yet" before the first Monday).
- Conduct counts and My reviews still render.
