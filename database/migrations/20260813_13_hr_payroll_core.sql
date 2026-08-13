-- Migration: 20260813_13_hr_payroll_core.sql
-- Description: HR phase 4, part 2 — pay periods, pay components, payroll runs,
--              payslips and loans.
--
-- The central design commitment: a payslip is a SNAPSHOT, not a view. Every
-- input (rate, days, statutory version) and every output (each contribution,
-- the tax, the net) is stored on the payslip row. A payslip must reprint
-- identically in five years even after rates change, employees are renamed, and
-- schedules are rewritten.
--
-- Immutability is scoped by lifecycle rather than absolute: a DRAFT/COMPUTED run
-- genuinely needs to be recomputable, so payslips are freely replaceable there.
-- From APPROVED onward they are frozen, and the only way back is voiding the run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Pay periods
-- ---------------------------------------------------------------------------
-- Materialised rather than derived: payroll runs need a stable period identity
-- to point at, and month-end edge cases (Feb 16-28/29, Dec 16-31) should be
-- computed once, not by every caller.
CREATE TABLE IF NOT EXISTS pay_period (
    pay_period_id SERIAL PRIMARY KEY,
    period_type   VARCHAR(20) NOT NULL DEFAULT 'SEMI_MONTHLY'
        CHECK (period_type IN ('SEMI_MONTHLY', 'MONTHLY', 'WEEKLY')),
    period_year   SMALLINT NOT NULL,
    period_month  SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_seq    SMALLINT NOT NULL CHECK (period_seq IN (1, 2)),  -- 1 = 1st-15th, 2 = 16th-EOM
    period_start  DATE NOT NULL,
    period_end    DATE NOT NULL,
    pay_date      DATE NOT NULL,
    is_closed     BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT uq_pay_period UNIQUE (period_type, period_start, period_end),
    CONSTRAINT pay_period_range_chk CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_pay_period_lookup ON pay_period (period_year, period_month, period_seq);

-- Generate semi-monthly periods for 2026-2028. Pay date is set to the period
-- end; adjust per company practice.
INSERT INTO pay_period (period_type, period_year, period_month, period_seq, period_start, period_end, pay_date)
SELECT 'SEMI_MONTHLY', y, m, s,
       CASE WHEN s = 1 THEN MAKE_DATE(y, m, 1) ELSE MAKE_DATE(y, m, 16) END,
       CASE WHEN s = 1 THEN MAKE_DATE(y, m, 15)
            ELSE (MAKE_DATE(y, m, 1) + INTERVAL '1 month - 1 day')::date END,
       CASE WHEN s = 1 THEN MAKE_DATE(y, m, 15)
            ELSE (MAKE_DATE(y, m, 1) + INTERVAL '1 month - 1 day')::date END
FROM generate_series(2026, 2028) AS y
CROSS JOIN generate_series(1, 12) AS m
CROSS JOIN generate_series(1, 2) AS s
ON CONFLICT (period_type, period_start, period_end) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Pay component catalog
-- ---------------------------------------------------------------------------
-- Payslip lines reference these codes, so adding a new allowance or deduction
-- later is a data change rather than a schema change.
CREATE TABLE IF NOT EXISTS pay_component (
    component_code VARCHAR(40) PRIMARY KEY,
    component_name VARCHAR(100) NOT NULL,
    component_type VARCHAR(30) NOT NULL
        CHECK (component_type IN ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'INFO')),
    is_taxable     BOOLEAN NOT NULL DEFAULT true,
    is_statutory   BOOLEAN NOT NULL DEFAULT false,
    is_system      BOOLEAN NOT NULL DEFAULT false,  -- system codes cannot be deleted
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO pay_component (component_code, component_name, component_type, is_taxable, is_statutory, is_system, sort_order) VALUES
    ('BASIC',            'Basic Pay',                     'EARNING',               true,  false, true, 1),
    ('OT_REG',           'Overtime Pay',                  'EARNING',               true,  false, true, 2),
    ('OT_REST',          'Rest Day Overtime',             'EARNING',               true,  false, true, 3),
    ('HOLIDAY_REG',      'Regular Holiday Pay',           'EARNING',               true,  false, true, 4),
    ('HOLIDAY_SPECIAL',  'Special Holiday Pay',           'EARNING',               true,  false, true, 5),
    ('NIGHT_DIFF',       'Night Differential',            'EARNING',               true,  false, true, 6),
    ('LEAVE_PAY',        'Paid Leave',                    'EARNING',               true,  false, true, 7),
    ('THIRTEENTH_MONTH', '13th Month Pay',                'EARNING',               false, false, true, 8),
    ('ALLOWANCE_COLA',   'Cost of Living Allowance',      'EARNING',               true,  false, true, 10),
    ('ALLOWANCE_MEAL',   'Meal Allowance',                'EARNING',               false, false, true, 11),
    ('ALLOWANCE_TRANSPO','Transportation Allowance',      'EARNING',               false, false, true, 12),
    ('ABSENCE',          'Absences',                      'DEDUCTION',             false, false, true, 20),
    ('LATE',             'Tardiness',                     'DEDUCTION',             false, false, true, 21),
    ('UNDERTIME',        'Undertime',                     'DEDUCTION',             false, false, true, 22),
    ('SSS_EE',           'SSS Contribution',              'DEDUCTION',             false, true,  true, 30),
    ('SSS_MPF_EE',       'SSS WISP (Provident)',          'DEDUCTION',             false, true,  true, 31),
    ('PHIC_EE',          'PhilHealth Contribution',       'DEDUCTION',             false, true,  true, 32),
    ('HDMF_EE',          'Pag-IBIG Contribution',         'DEDUCTION',             false, true,  true, 33),
    ('WTAX',             'Withholding Tax',               'DEDUCTION',             false, true,  true, 34),
    ('SSS_LOAN',         'SSS Loan',                      'DEDUCTION',             false, false, true, 40),
    ('HDMF_LOAN',        'Pag-IBIG Loan',                 'DEDUCTION',             false, false, true, 41),
    ('CASH_ADVANCE',     'Cash Advance',                  'DEDUCTION',             false, false, true, 42),
    ('SSS_ER',           'SSS Employer Share',            'EMPLOYER_CONTRIBUTION', false, true,  true, 50),
    ('SSS_MPF_ER',       'SSS WISP Employer Share',       'EMPLOYER_CONTRIBUTION', false, true,  true, 51),
    ('SSS_EC',           'Employees Compensation',        'EMPLOYER_CONTRIBUTION', false, true,  true, 52),
    ('PHIC_ER',          'PhilHealth Employer Share',     'EMPLOYER_CONTRIBUTION', false, true,  true, 53),
    ('HDMF_ER',          'Pag-IBIG Employer Share',       'EMPLOYER_CONTRIBUTION', false, true,  true, 54)
ON CONFLICT (component_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Payroll run
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_run (
    run_id        BIGSERIAL PRIMARY KEY,
    run_no        VARCHAR(30) NOT NULL UNIQUE,
    run_type      VARCHAR(30) NOT NULL DEFAULT 'REGULAR'
        CHECK (run_type IN ('REGULAR', 'THIRTEENTH_MONTH', 'FINAL_PAY', 'SPECIAL')),
    pay_period_id INTEGER REFERENCES pay_period(pay_period_id),
    period_start  DATE NOT NULL,
    period_end    DATE NOT NULL,
    pay_date      DATE NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft', 'Computed', 'Approved', 'Paid', 'Posted', 'Voided')),
    department_id INTEGER REFERENCES department(department_id),  -- NULL = all departments

    -- Which statutory schedules this run resolved. Snapshotting the version ids
    -- is what makes a recompute reproducible.
    sss_version_id        INTEGER REFERENCES statutory_table_version(version_id),
    philhealth_version_id INTEGER REFERENCES statutory_table_version(version_id),
    pagibig_version_id    INTEGER REFERENCES statutory_table_version(version_id),
    bir_version_id        INTEGER REFERENCES statutory_table_version(version_id),
    -- All PAYROLL_* settings as they stood at compute time, so a later settings
    -- change never alters a historical run.
    policy_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,

    employee_count         INTEGER NOT NULL DEFAULT 0,
    total_gross            NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_deductions       NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_net              NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_employer_contrib NUMERIC(14,2) NOT NULL DEFAULT 0,

    notes         TEXT,
    created_by    INTEGER NOT NULL REFERENCES employee(employee_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    computed_by   INTEGER REFERENCES employee(employee_id),
    computed_at   TIMESTAMPTZ,
    approved_by   INTEGER REFERENCES employee(employee_id),
    approved_at   TIMESTAMPTZ,
    paid_by       INTEGER REFERENCES employee(employee_id),
    paid_at       TIMESTAMPTZ,
    posted_by     INTEGER REFERENCES employee(employee_id),
    posted_at     TIMESTAMPTZ,
    voided_by     INTEGER REFERENCES employee(employee_id),
    voided_at     TIMESTAMPTZ,
    void_reason   TEXT,
    CONSTRAINT payroll_run_range_chk CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_period ON payroll_run (period_start DESC, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_run_status ON payroll_run (status);

-- One live run per period per scope. Voided runs drop out, so re-running a
-- period after a void is always possible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_run_live_period
    ON payroll_run (pay_period_id, run_type, COALESCE(department_id, 0))
    WHERE status <> 'Voided';

-- The state machine is enforced in the database, not only in the service, so no
-- code path can move a run somewhere it should not go.
CREATE OR REPLACE FUNCTION payroll_run_transition_guard() RETURNS TRIGGER AS $$
DECLARE
    allowed TEXT[];
BEGIN
    IF NEW.status = OLD.status THEN RETURN NEW; END IF;

    allowed := CASE OLD.status
        WHEN 'Draft'    THEN ARRAY['Computed', 'Voided']
        WHEN 'Computed' THEN ARRAY['Draft', 'Approved', 'Voided']
        WHEN 'Approved' THEN ARRAY['Paid', 'Voided']
        WHEN 'Paid'     THEN ARRAY['Posted', 'Voided']
        WHEN 'Posted'   THEN ARRAY['Voided']
        WHEN 'Voided'   THEN ARRAY[]::TEXT[]   -- terminal
        ELSE ARRAY[]::TEXT[]
    END;

    IF NOT (NEW.status = ANY(allowed)) THEN
        RAISE EXCEPTION 'Payroll run % cannot move from % to %.', OLD.run_no, OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_run_transition ON payroll_run;
CREATE TRIGGER trg_payroll_run_transition
    BEFORE UPDATE OF status ON payroll_run
    FOR EACH ROW EXECUTE FUNCTION payroll_run_transition_guard();

-- ---------------------------------------------------------------------------
-- 4. Payslip — the snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_payslip (
    payslip_id      BIGSERIAL PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES payroll_run(run_id) ON DELETE CASCADE,
    employee_id     INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
    payslip_no      VARCHAR(40) NOT NULL UNIQUE,

    -- Identity snapshot: the payslip must reprint correctly even if the
    -- employee is later renamed or moved between departments.
    employee_code   VARCHAR(20),
    employee_name   VARCHAR(250) NOT NULL,
    position_title  VARCHAR(100),
    department_name VARCHAR(100),

    pay_basis       VARCHAR(20) NOT NULL DEFAULT 'daily',
    daily_rate      NUMERIC(12,2) NOT NULL DEFAULT 0,
    monthly_basis   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- basis used for statutory lookups
    compensation_id BIGINT REFERENCES employee_compensation(compensation_id),

    -- DTR summary
    days_worked     NUMERIC(6,3) NOT NULL DEFAULT 0,
    days_paid       NUMERIC(6,3) NOT NULL DEFAULT 0,
    days_absent     NUMERIC(6,3) NOT NULL DEFAULT 0,
    days_on_leave   NUMERIC(6,3) NOT NULL DEFAULT 0,
    overtime_hours  NUMERIC(7,2) NOT NULL DEFAULT 0,

    -- Earnings
    basic_pay              NUMERIC(12,2) NOT NULL DEFAULT 0,
    overtime_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
    holiday_pay            NUMERIC(12,2) NOT NULL DEFAULT 0,
    night_diff_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
    allowances_taxable     NUMERIC(12,2) NOT NULL DEFAULT 0,
    allowances_nontaxable  NUMERIC(12,2) NOT NULL DEFAULT 0,
    other_earnings         NUMERIC(12,2) NOT NULL DEFAULT 0,
    gross_pay              NUMERIC(12,2) NOT NULL DEFAULT 0,

    -- Employee deductions
    sss_ee            NUMERIC(12,2) NOT NULL DEFAULT 0,
    sss_mpf_ee        NUMERIC(12,2) NOT NULL DEFAULT 0,
    philhealth_ee     NUMERIC(12,2) NOT NULL DEFAULT 0,
    pagibig_ee        NUMERIC(12,2) NOT NULL DEFAULT 0,
    withholding_tax   NUMERIC(12,2) NOT NULL DEFAULT 0,
    loans_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
    other_deductions  NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_deductions  NUMERIC(12,2) NOT NULL DEFAULT 0,
    taxable_income    NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,

    -- Employer share (cost, not withheld from the employee)
    sss_er                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    sss_mpf_er             NUMERIC(12,2) NOT NULL DEFAULT 0,
    sss_ec                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    philhealth_er          NUMERIC(12,2) NOT NULL DEFAULT 0,
    pagibig_er             NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_employer_contrib NUMERIC(12,2) NOT NULL DEFAULT 0,

    -- Every intermediate value, so "why is my pay this?" has an auditable answer.
    computation_trace JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_payslip_run_employee UNIQUE (run_id, employee_id),
    CONSTRAINT payslip_net_chk CHECK (net_pay = gross_pay - total_deductions)
);

CREATE INDEX IF NOT EXISTS idx_payslip_employee ON payroll_payslip (employee_id, run_id DESC);
CREATE INDEX IF NOT EXISTS idx_payslip_run ON payroll_payslip (run_id);

CREATE TABLE IF NOT EXISTS payroll_payslip_line (
    line_id        BIGSERIAL PRIMARY KEY,
    payslip_id     BIGINT NOT NULL REFERENCES payroll_payslip(payslip_id) ON DELETE CASCADE,
    line_type      VARCHAR(30) NOT NULL
        CHECK (line_type IN ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'INFO')),
    component_code VARCHAR(40) NOT NULL REFERENCES pay_component(component_code),
    description    VARCHAR(200) NOT NULL,
    quantity       NUMERIC(10,3),
    rate           NUMERIC(12,4),
    amount         NUMERIC(12,2) NOT NULL,
    is_taxable     BOOLEAN NOT NULL DEFAULT true,
    sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_payslip_line_payslip ON payroll_payslip_line (payslip_id, sort_order);

-- Payslips are freely replaceable while the run is Draft/Computed (that is what
-- "recompute" means) and frozen from Approved onward. ON DELETE CASCADE above
-- is safe precisely because deletion is only reachable in those two states.
CREATE OR REPLACE FUNCTION payslip_immutability_guard() RETURNS TRIGGER AS $$
DECLARE
    run_status TEXT;
    target_run BIGINT;
BEGIN
    target_run := COALESCE(NEW.run_id, OLD.run_id);
    SELECT status INTO run_status FROM payroll_run WHERE run_id = target_run;

    -- The run row is already gone when a run is hard-deleted; nothing to guard.
    IF run_status IS NULL THEN
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF run_status NOT IN ('Draft', 'Computed') THEN
        RAISE EXCEPTION 'Payslips for a % payroll run are immutable. Void the run to make changes.', run_status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payslip_immutable ON payroll_payslip;
CREATE TRIGGER trg_payslip_immutable
    BEFORE UPDATE OR DELETE ON payroll_payslip
    FOR EACH ROW EXECUTE FUNCTION payslip_immutability_guard();

-- ---------------------------------------------------------------------------
-- 5. Loans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_loan (
    loan_id             BIGSERIAL PRIMARY KEY,
    employee_id         INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    loan_type           VARCHAR(30) NOT NULL
        CHECK (loan_type IN ('SSS_SALARY', 'SSS_CALAMITY', 'HDMF_MPL', 'HDMF_CALAMITY', 'CASH_ADVANCE', 'OTHER')),
    component_code      VARCHAR(40) NOT NULL REFERENCES pay_component(component_code),
    reference_no        VARCHAR(50),
    principal_amount    NUMERIC(12,2) NOT NULL CHECK (principal_amount > 0),
    amortization_amount NUMERIC(12,2) NOT NULL CHECK (amortization_amount > 0),
    total_installments  SMALLINT,
    -- Maintained by trigger from employee_loan_payment so a voided run restores
    -- the balance automatically.
    amount_paid         NUMERIC(12,2) NOT NULL DEFAULT 0,
    start_date          DATE NOT NULL,
    deduct_on_cutoff    SMALLINT NOT NULL DEFAULT 2 CHECK (deduct_on_cutoff IN (1, 2)),
    status              VARCHAR(20) NOT NULL DEFAULT 'Active'
        CHECK (status IN ('Active', 'Completed', 'Cancelled', 'On Hold')),
    notes               TEXT,
    created_by          INTEGER REFERENCES employee(employee_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by         INTEGER REFERENCES employee(employee_id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_loan_active
    ON employee_loan (employee_id) WHERE status = 'Active';

CREATE TABLE IF NOT EXISTS employee_loan_payment (
    payment_id BIGSERIAL PRIMARY KEY,
    loan_id    BIGINT NOT NULL REFERENCES employee_loan(loan_id) ON DELETE CASCADE,
    payslip_id BIGINT REFERENCES payroll_payslip(payslip_id) ON DELETE CASCADE,
    amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_loan_payment_payslip UNIQUE (loan_id, payslip_id)
);

-- Recomputed from source rows rather than incremented, so an approve/void/
-- re-approve cycle can never drift the outstanding balance.
CREATE OR REPLACE FUNCTION recalc_loan_balance() RETURNS TRIGGER AS $$
DECLARE
    target_loan BIGINT;
BEGIN
    target_loan := COALESCE(NEW.loan_id, OLD.loan_id);
    UPDATE employee_loan l
    SET amount_paid = COALESCE((
            SELECT SUM(p.amount) FROM employee_loan_payment p WHERE p.loan_id = target_loan
        ), 0),
        status = CASE
            WHEN l.status = 'Active' AND COALESCE((
                SELECT SUM(p.amount) FROM employee_loan_payment p WHERE p.loan_id = target_loan
            ), 0) >= l.principal_amount THEN 'Completed'
            WHEN l.status = 'Completed' AND COALESCE((
                SELECT SUM(p.amount) FROM employee_loan_payment p WHERE p.loan_id = target_loan
            ), 0) < l.principal_amount THEN 'Active'
            ELSE l.status
        END,
        updated_at = now()
    WHERE l.loan_id = target_loan;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_loan_payment_balance ON employee_loan_payment;
CREATE TRIGGER trg_loan_payment_balance
    AFTER INSERT OR UPDATE OR DELETE ON employee_loan_payment
    FOR EACH ROW EXECUTE FUNCTION recalc_loan_balance();

-- ---------------------------------------------------------------------------
-- 6. Permissions and policy settings
-- ---------------------------------------------------------------------------
INSERT INTO permission (permission_key, description, category) VALUES
    ('payroll:view',    'View payroll runs and payslips',            'Payroll'),
    ('payroll:compute', 'Create and compute payroll runs',           'Payroll'),
    ('payroll:approve', 'Approve computed payroll runs',             'Payroll'),
    ('payroll:post',    'Mark payroll paid and post it to expenses', 'Payroll'),
    ('payroll:void',    'Void payroll runs',                         'Payroll'),
    ('payslip:view_own','View your own payslips',                    'Payroll')
ON CONFLICT (permission_key) DO NOTHING;

-- Approving, posting and voting money out are Admin-only; Managers may prepare.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Super Admin')
  AND p.permission_key IN ('payroll:view', 'payroll:compute', 'payroll:approve', 'payroll:post', 'payroll:void')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Manager')
  AND p.permission_key IN ('payroll:view', 'payroll:compute')
ON CONFLICT DO NOTHING;

-- Everyone may see their own payslip.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE p.permission_key = 'payslip:view_own'
ON CONFLICT DO NOTHING;

INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('PAYROLL_PERIOD_TYPE',            'SEMI_MONTHLY', 'Payroll cycle'),
    ('PAYROLL_STATUTORY_SCHEDULE',     'SPLIT_HALF',   'How monthly statutory contributions are split across cutoffs: SPLIT_HALF or SECOND_CUTOFF'),
    ('PAYROLL_WORKING_DAYS_PER_YEAR',  '313',          'Divisor converting a daily rate to a monthly basis for statutory lookups'),
    ('PAYROLL_OT_RATE_ORDINARY',       '1.25',         'Overtime multiplier on an ordinary day'),
    ('PAYROLL_OT_RATE_REST_DAY',       '1.69',         'Overtime multiplier on a rest day'),
    ('PAYROLL_REST_DAY_RATE',          '1.30',         'Premium for work performed on a rest day'),
    ('PAYROLL_REGULAR_HOLIDAY_RATE',   '2.00',         'Pay multiplier for work on a regular holiday'),
    ('PAYROLL_REGULAR_HOLIDAY_UNWORKED','1.00',        'Pay multiplier for an unworked regular holiday'),
    ('PAYROLL_SPECIAL_HOLIDAY_RATE',   '1.30',         'Pay multiplier for work on a special non-working day'),
    ('PAYROLL_NIGHT_DIFF_RATE',        '0.10',         'Night differential premium'),
    ('PAYROLL_ROUNDING_MODE',          'HALF_UP',      'Monetary rounding mode'),
    ('PAYROLL_13TH_MONTH_TAX_EXEMPT_CAP','90000',      'Tax-exempt ceiling for 13th month pay and other benefits')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
