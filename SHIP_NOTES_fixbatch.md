# FK Home — fix batch: manager-assign, editable Employee IDs, sidebar identity, Academy copy

Builds on the deployed onboarding/Academy ship. No server.js, no schema. Suite 28/28 + targeted tests green.

#6 MANAGER ASSIGN (server/modules/profile.js, public/modules/profile.js)
   - PUT /:userId/manager accepts profile.edit.any OR admin.users.edit OR admin.users.create
     (assigning a manager is part of onboarding). viewer.can_assign_manager gates the
     "Assign/Change manager" button on a profile for the same three perms.

#2b EDITABLE EMPLOYEE IDs (server/modules/admin.js, public/modules/users.js)
   - GET /admin/users now returns emp_id.
   - PATCH /admin/users/:id accepts emp_id (validated FK###, unique excluding self).
   - People page: new "Fix Employee IDs" button opens a single screen listing everyone with
     their ID editable in a row; "Save all changes" PATCHes only the changed ones, shows
     per-row Saved / Already used / Bad format. Use this to correct the wrong IDs in one go.

SIDEBAR IDENTITY — Spotlight (public/index.html, CSS only)
   - The user pill (your name + designation, top-left, every screen) restyled to the Spotlight
     look you liked: cream card, terracotta spine, big rounded-square avatar with Fraunces
     initials, name in Fraunces 19px, designation in uppercase terracotta. .avatar is used only
     by this pill, so nothing else is affected.

#8 ACADEMY COPY (public/modules/learning.js)
   - Nav + buttons stay visible to everyone (unchanged). Empty states reworded:
     Available -> "No courses have been added to your department yet" (+ "Coming soon …").
     Knowledge Base -> "Coming soon" / "No reference material … for your department yet."

FILES: server/modules/{admin,profile}.js, public/modules/{users,profile,learning}.js, public/index.html
