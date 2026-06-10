# FK Home r0.89b — Mail reading pane fix (the blank pane)

## Root cause (found by reproducing it in a headless browser, not by guessing)
The reading pane was rendering the email correctly into the page — but into a
zero-width column, so it was invisible.

In Mail the layout hid the FK sidebar with `display:none` and used a two-track
grid `0 1fr`. Removing the sidebar made the content auto-place into the FIRST
track (the `0`-width one), collapsing it. The fixed-width columns (rail / mail
column / list) still showed by overflowing, but the reading pane (`1fr`) ended up
zero-width — present in the DOM, but invisible. That's why the list looked fine
and only the email body "wasn't loading".

## Fix
One line: the Mail layout now uses a single-column grid (`1fr`) with a definite
`height:100vh`, so the content fills the full width and height. Reading pane gets
real width again.

Also kept: the reading pane now never goes silently blank — on any genuine error
it shows a clear message with a "Try again" button, and times out after 20s.

Files: public/index.html, public/modules/mail.js, server.js (VERSION r0.89b).
