-- ---------------------------------------------------------------------------
-- Job-order / contract-of-service workers
-- ---------------------------------------------------------------------------
-- The payroll module has until now modelled exactly one kind of paid person: an
-- employee. Every payroll-eligible person had SSS, PhilHealth, Pag-IBIG and
-- compensation withholding computed unconditionally.
--
-- A job-order (contract-of-service) worker is not an employee. There is no
-- employer contribution obligation, no employee contribution, and — per company
-- policy — no withholding: they are paid gross and settle their own taxes.
--
-- Two axes are introduced, deliberately kept separate:
--
--   employee.worker_class                 - WHO this person is. Decides which
--                                           payroll run they belong to.
--   employee_compensation.statutory_coverage - WHAT is deducted. Effective-dated
--                                           alongside the rate, so a worker
--                                           converting to regular employment is
--                                           a dated change and closed payroll
--                                           stays reproducible.
--
-- worker_class is NOT folded into employment_type. That column is HR taxonomy
-- for employees (Regular, Probationary, Contractual, Casual...), and a
-- *Contractual* employee is still fully covered by SSS. Overloading it would
-- invite exactly that misreading, with legal consequences.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Worker class
-- ---------------------------------------------------------------------------
ALTER TABLE public.employee
    ADD COLUMN IF NOT EXISTS worker_class VARCHAR(20) NOT NULL DEFAULT 'EMPLOYEE';

COMMENT ON COLUMN public.employee.worker_class IS
    'EMPLOYEE = covered employee. JOB_ORDER = contract-of-service worker, paid through a separate JOB_ORDER payroll run and excluded from statutory and BIR reports.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_worker_class_chk') THEN
        ALTER TABLE public.employee ADD CONSTRAINT employee_worker_class_chk
            CHECK (worker_class IN ('EMPLOYEE', 'JOB_ORDER'));
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_employee_worker_class ON public.employee (worker_class);

-- ---------------------------------------------------------------------------
-- (b) Statutory coverage on the effective-dated compensation record
-- ---------------------------------------------------------------------------
ALTER TABLE public.employee_compensation
    ADD COLUMN IF NOT EXISTS statutory_coverage VARCHAR(20) NOT NULL DEFAULT 'COVERED';

COMMENT ON COLUMN public.employee_compensation.statutory_coverage IS
    'COVERED = SSS/PhilHealth/Pag-IBIG and withholding tax apply. EXEMPT = none apply, neither employee nor employer share. Independent of pay_basis and of worker_class.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_compensation_coverage_chk') THEN
        ALTER TABLE public.employee_compensation ADD CONSTRAINT employee_compensation_coverage_chk
            CHECK (statutory_coverage IN ('COVERED', 'EXEMPT'));
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- (c) JOB_ORDER run type
-- ---------------------------------------------------------------------------
-- The CHECK was created inline, so Postgres named it payroll_run_run_type_check.
-- Replace it rather than adding a second one, so there is a single source of
-- truth for the allowed values.
ALTER TABLE public.payroll_run DROP CONSTRAINT IF EXISTS payroll_run_run_type_check;
ALTER TABLE public.payroll_run ADD CONSTRAINT payroll_run_run_type_check
    CHECK (run_type IN ('REGULAR', 'THIRTEENTH_MONTH', 'FINAL_PAY', 'SPECIAL', 'JOB_ORDER'));

-- uq_payroll_run_live_period is already keyed on (pay_period_id, run_type,
-- COALESCE(department_id, 0)), so one REGULAR and one JOB_ORDER run can coexist
-- for the same cutoff without any index change.

-- ---------------------------------------------------------------------------
-- (d) Payslip snapshot columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_payslip
    ADD COLUMN IF NOT EXISTS worker_class VARCHAR(20) NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE public.payroll_payslip
    ADD COLUMN IF NOT EXISTS statutory_coverage VARCHAR(20) NOT NULL DEFAULT 'COVERED';

-- ---------------------------------------------------------------------------
-- (e) Expense category for contracted services
-- ---------------------------------------------------------------------------
-- Job-order fees are contracted services, not salaries. Posting them into
-- 'Salaries & Wages' would overstate the compensation figure that payroll and
-- BIR reporting are reconciled against.
INSERT INTO expense_category (category_name, description, sort_order)
VALUES ('Contracted Services', 'Fees paid to job-order and contract-of-service workers', 35)
ON CONFLICT (category_name) DO NOTHING;

INSERT INTO settings (setting_key, setting_value, description)
SELECT 'PAYROLL_EXPENSE_CATEGORY_JOB_ORDER',
       (SELECT category_id::text FROM expense_category WHERE category_name = 'Contracted Services'),
       'Expense category that job-order payroll runs post into'
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
