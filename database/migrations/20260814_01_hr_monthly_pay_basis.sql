-- ---------------------------------------------------------------------------
-- Monthly pay basis for fixed-salaried and exempt staff
-- ---------------------------------------------------------------------------
-- Until now the payroll engine only implemented `pay_basis = 'daily'`, so a
-- salaried employee had to be onboarded with a fabricated daily rate
-- (Monthly * 12 / 313). That makes gross pay fluctuate every cutoff, because a
-- semi-monthly cutoff contains a varying number of working days.
--
-- This migration adds the columns the engine needs to pay a contractual monthly
-- salary directly, in two flavours:
--
--   GUARANTEED  - attendance is irrelevant. Admin, executives and owners are
--                 paid exactly half their monthly salary each cutoff. Only an
--                 approved leave-without-pay reduces it.
--   ATTENDANCE  - a salaried rank-and-file earner: the same half-month
--                 entitlement, less unpaid absences.
--
-- Overtime and tardiness exemption are deliberately NOT derived from pay_basis.
-- A monthly-paid rank-and-file worker is still legally entitled to overtime, and
-- a daily-rated field manager may be exempt, so the two are independent and
-- effective-dated alongside the rate.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Compensation: salary model and exemption flags
-- ---------------------------------------------------------------------------
ALTER TABLE public.employee_compensation
    ADD COLUMN IF NOT EXISTS salary_model VARCHAR(20);
ALTER TABLE public.employee_compensation
    ADD COLUMN IF NOT EXISTS is_overtime_exempt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.employee_compensation
    ADD COLUMN IF NOT EXISTS is_tardiness_exempt BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.employee_compensation.salary_model IS
    'For pay_basis = ''monthly'' only. GUARANTEED = attendance never reduces pay; ATTENDANCE = unpaid absences deduct.';
COMMENT ON COLUMN public.employee_compensation.is_overtime_exempt IS
    'Suppresses overtime and night-differential earnings. Independent of pay_basis.';
COMMENT ON COLUMN public.employee_compensation.is_tardiness_exempt IS
    'Suppresses tardiness and undertime deductions. Independent of pay_basis.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'employee_compensation_salary_model_chk') THEN
        ALTER TABLE public.employee_compensation
            ADD CONSTRAINT employee_compensation_salary_model_chk
            CHECK (salary_model IS NULL OR salary_model IN ('GUARANTEED', 'ATTENDANCE'));
    END IF;

    -- A monthly row must name its model; anything else must not carry one.
    -- Written as an equivalence so both directions are enforced by one check.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'employee_compensation_model_requires_monthly_chk') THEN
        ALTER TABLE public.employee_compensation
            ADD CONSTRAINT employee_compensation_model_requires_monthly_chk
            CHECK ((pay_basis = 'monthly') = (salary_model IS NOT NULL));
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- (b) Payslip: snapshot the model, so a closed payslip stays self-explaining
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_payslip
    ADD COLUMN IF NOT EXISTS salary_model VARCHAR(20);
ALTER TABLE public.payroll_payslip
    ADD COLUMN IF NOT EXISTS is_overtime_exempt BOOLEAN NOT NULL DEFAULT false;

-- payroll_payslip.pay_basis never got the check its employee_compensation
-- counterpart has. Every existing row is 'daily', so it validates cleanly.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payroll_payslip_pay_basis_chk') THEN
        ALTER TABLE public.payroll_payslip
            ADD CONSTRAINT payroll_payslip_pay_basis_chk
            CHECK (pay_basis IN ('daily', 'monthly', 'hourly', 'commission'));
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- (c) Leave-without-pay component
-- ---------------------------------------------------------------------------
-- LWOP is an EARNING carrying a NEGATIVE amount, not a DEDUCTION. A monthly
-- employee's entitlement is the contractual half-month; unpaid leave reduces
-- what was actually earned. Modelling it as a DEDUCTION would leave gross pay
-- overstated and would tax the employee on income they never received.
INSERT INTO pay_component (component_code, component_name, component_type, is_taxable, is_statutory, is_system, sort_order) VALUES
    ('LWOP', 'Leave Without Pay', 'EARNING', true, false, true, 9)
ON CONFLICT (component_code) DO NOTHING;

-- Engine-generated, so it must never appear in the manual assignment picker.
UPDATE pay_component SET is_assignable = false WHERE component_code = 'LWOP';

-- ---------------------------------------------------------------------------
-- (d) Divisor policy
-- ---------------------------------------------------------------------------
-- PERIOD_WORKING_DAYS is the default because it is the only mode that closes
-- exactly at both ends: a fully-absent cutoff pays 0.00, and a clean month pays
-- the full salary. MONTH_WORKING_DAYS gives every day an equal value across the
-- month but leaves a positive residue on a fully-absent cutoff; ANNUAL_FACTOR
-- (Monthly * 12 / days_per_year) matches the old manual workaround but never
-- closes at all.
INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('PAYROLL_MONTHLY_DIVISOR_MODE', 'PERIOD_WORKING_DAYS',
     'Daily value used to deduct unpaid days from a monthly salary: PERIOD_WORKING_DAYS, MONTH_WORKING_DAYS or ANNUAL_FACTOR')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
