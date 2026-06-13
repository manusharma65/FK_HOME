-- 42-fix-pattern-anchor.sql
-- r1.25 — The working-pattern anchor in the live DB had drifted one week out of
-- phase, so alternate Saturdays were misclassified (a working Saturday showed as
-- "off (pattern)" and everyone read as Off / worked-anyway). The original seed
-- (05-hr-attendance.sql) used ON CONFLICT (id) DO NOTHING, so a wrong live value
-- could never be corrected. Force it to the correct Monday of a 6-day week.
-- 2026-05-25 is a Monday; with it, Sat 13 Jun works, Sat 20 Jun is off, alternating.
UPDATE pattern_anchor SET anchor_monday = '2026-05-25' WHERE id = 1;
INSERT INTO pattern_anchor (id, anchor_monday)
VALUES (1, '2026-05-25')
ON CONFLICT (id) DO NOTHING;
