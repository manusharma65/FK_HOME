# R0.65 — Nav font reverted to the pre-r0.55 system font

The nav switched to Hanken Grotesk as a side-effect of r0.55 (body font change for the
theme). This pins the sidebar/nav back to the original system font
(-apple-system / San Francisco), while page content keeps Hanken Grotesk as designed.
One scoped rule, no other change.

## Check after deploy
- Sidebar/nav text looks as it did before the theme rollout.
- Page content (Insights, People, etc.) unchanged.
