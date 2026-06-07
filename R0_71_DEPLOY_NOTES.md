# R0.71 — Person names in the display font (Fraunces)

The headers/titles were Fraunces but the person/entity NAMES (.nm in People, Approvals,
Groups, Leaves; .tw-pname in Team attendance) were still plain bold body text, so names
didn't carry the theme. Now names render in Fraunces (weight 600) to match.

## File
public/index.html (one scoped global rule)

## Validation
index.html parses clean.

## Check after deploy (hard refresh)
- People / Team attendance / Approvals / Groups: each person's NAME is now in the serif
  display font, matching the page headers.
