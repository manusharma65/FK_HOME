# R0.70 — ONE ship: all 4 bespoke pages themed (colour + text) + everything since r0.64

Cumulative. One push lands the whole outstanding board.

## A. 4 bespoke pages -> warm "Insights" theme
COLOUR: My Work modal header + Recruitment candidate header (were blue #185FA5) ->
warm dark->orange hero; offboarding/exit slate banner -> warm hero; chat amber -> orange;
all stray blue link/icon accents -> orange.
TEXT: titles in display font (Fraunces) — My Work modal title, exit/chat headings (h2) and
candidate cards already covered; **this build also Fraunces-es the recruitment candidate
NAME (.rec-chead .nm) + sub-head (.rec-sec-h2)** which the earlier global missed. Body text
was already enlarged (r0.63). So both colour AND text now match the theme.

## B. Carried since r0.64
- r0.65 nav system font; r0.66 nav items 17.5/600; r0.67 group labels 15.5 + idle free-text
  reason (migration 33); r0.68 leaver payslip proration + auto leave-encashment;
  r0.69 profile.html -> redirect stub.

## Files
public/index.html, public/profile.html,
public/modules/{my-work,recruitment,chat,offboarding-tracker,profile}.js,
server/modules/{attendance,payroll}.js, server/schema/33-idle-reason.sql

## Validation
All HTML parses; node --check clean on all 7 JS files.
