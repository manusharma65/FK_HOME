-- FK Home — add a 4th title tier: Senior Executive (role='senior').
-- Permissions come from GROUPS, not this per-department role; this role only
-- affects approver/reviewer routing (filters check 'manager'/'lead'), so 'senior'
-- behaves as base access (like 'agent') — just a distinct, more senior title.
-- Display ladder: Executive(agent) -> Senior Executive(senior) -> Team Lead(lead) -> Manager(manager).
ALTER TABLE user_department_memberships DROP CONSTRAINT IF EXISTS user_department_memberships_role_check;
ALTER TABLE user_department_memberships
  ADD CONSTRAINT user_department_memberships_role_check
  CHECK (role IN ('agent','senior','lead','manager'));
