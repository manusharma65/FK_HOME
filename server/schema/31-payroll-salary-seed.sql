-- FK Home — Payroll r0.47: seed the salary drawer from existing figures
-- ----------------------------------------------------------------------------
-- salary_structures (the audited salary table the payslip reads) was empty, so
-- every payslip flagged "No salary on file". The staff records already carry a
-- monthly_salary figure (what the business has been using). Copy those into the
-- drawer ONCE so payroll works immediately and HR can refine each (deductions,
-- effective date, history) from the salary drawer going forward.
--
-- Idempotent: only inserts for active India employees who have a positive
-- monthly_salary and do NOT already have a drawer row. Re-running does nothing.
-- ----------------------------------------------------------------------------

INSERT INTO salary_structures (user_id, monthly_ctc, currency, effective_from)
SELECT u.id,
       u.monthly_salary,
       COALESCE(u.salary_currency, 'INR'),
       COALESCE(u.hire_date, CURRENT_DATE)
  FROM users u
 WHERE u.deleted_at IS NULL
   AND u.employment_status = 'active'
   AND COALESCE(u.salary_currency, 'INR') = 'INR'
   AND u.monthly_salary IS NOT NULL
   AND u.monthly_salary > 0
   AND NOT EXISTS (SELECT 1 FROM salary_structures s WHERE s.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;
