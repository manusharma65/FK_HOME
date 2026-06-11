# r1.09 — CLEAN consolidated attendance feature (login verified)

One consistent build = r1.04 base + the full attendance work, applied together.
Replaces the half-applied r1.05–r1.08 deploys (r1.07 never landed; live was a mix).

VERIFIED before shipping: full HTTP login -> dashboard cycle holds in BOTH dev and
PRODUCTION mode (secure cookie). Login does not bounce.

Session safety (the r1.05 incident, fixed):
- SESSION_TTL_HOURS = 14 days (no mid-day expiry).
- auto clock-out stamps attendance only; it NEVER deletes the login session.

Consistency (fixes the frankenstein):
- login route + recordLogin both use isOffice (office device) — they agree.

Feature: trusted-device clock-in, office/WFH stamping, selfie capture modal,
Trust-this-device (owner + Head of Ops), HR exceptions queue with approve/flag,
nudge + 90-day selfie purge. Migrations 38 + 39 (already applied in prod; idempotent).
