-- Migration: 20260813_16_hr_employee_pay_components.sql
-- Description: HR phase 5a — assign recurring earnings and deductions to
--              individual employees (allowances, HMO, uniform deduction, etc.).
--
-- The `pay_component` catalog has existed since phase 4 but nothing connected
-- it to people, so payroll could only ever produce basic pay, overtime and the
-- statutory lines. This is the join that makes "which benefits and deductions
-- apply to this employee" answerable.
--
-- Effective-dated for the same reason compensation is: a benefit that starts in
-- March must not retroactively appear on February's payslip, and ending a
-- benefit must not erase the months it was paid.
--
-- Taxability is NOT stored here — it comes from pay_component.is_taxable, so a
-- reclassification is one row, not one row per employee.

BEGIN;

CREATE TABLE IF NOT EXISTS employee_pay_component (
    epc_id         BIGSERIAL PRIMARY KEY,
    employee_id    INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    component_code VARCHAR(40) NOT NULL REFERENCES pay_component(component_code),

    -- A component is either a fixed peso amount or a percentage of basic pay,
    -- never both and never neither.
    amount         NUMERIC(12,2) CHECK (amount IS NULL OR amount >= 0),
    rate_percent   NUMERIC(6,4)  CHECK (rate_percent IS NULL OR rate_percent >= 0),

    -- Monthly amounts are split across the two semi-monthly cutoffs the same way
    -- statutory contributions are; the *_CUTOFF options land wholly on one.
    frequency      VARCHAR(20) NOT NULL DEFAULT 'EVERY_CUTOFF'
        CHECK (frequency IN ('EVERY_CUTOFF', 'FIRST_CUTOFF', 'SECOND_CUTOFF', 'MONTHLY')),

    effective_from DATE NOT NULL,
    effective_to   DATE,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    notes          TEXT,
    created_by     INTEGER REFERENCES employee(employee_id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by    INTEGER REFERENCES employee(employee_id),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT epc_amount_xor_rate CHECK (
        (amount IS NOT NULL AND rate_percent IS NULL)
        OR (amount IS NULL AND rate_percent IS NOT NULL)
    ),
    CONSTRAINT epc_range_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_epc_employee
    ON employee_pay_component (employee_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_epc_active
    ON employee_pay_component (employee_id) WHERE is_active;

-- The same component may not overlap itself for one employee: two live "Meal
-- Allowance" rows would silently pay twice.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'epc_no_overlap') THEN
        ALTER TABLE employee_pay_component ADD CONSTRAINT epc_no_overlap
            EXCLUDE USING gist (
                employee_id WITH =,
                component_code WITH =,
                daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
            ) WHERE (is_active);
    END IF;
END$$;

-- A few non-system components companies commonly add, so the catalog is not
-- limited to what payroll itself generates.
INSERT INTO pay_component (component_code, component_name, component_type, is_taxable, is_statutory, is_system, sort_order) VALUES
    ('ALLOWANCE_RICE',  'Rice Allowance',        'EARNING',   false, false, false, 13),
    ('ALLOWANCE_COMMS', 'Communication Allowance','EARNING',  false, false, false, 14),
    ('HMO_EE',          'HMO Premium Share',     'DEDUCTION', false, false, false, 43),
    ('UNIFORM',         'Uniform Deduction',     'DEDUCTION', false, false, false, 44),
    ('UNION_DUES',      'Union Dues',            'DEDUCTION', false, false, false, 45),
    ('OTHER_DEDUCTION', 'Other Deduction',       'DEDUCTION', false, false, false, 46),
    ('OTHER_EARNING',   'Other Earning',         'EARNING',   true,  false, false, 15)
ON CONFLICT (component_code) DO NOTHING;

-- Assigning benefits and deductions is a compensation decision, so it reuses
-- the Admin-only hr:manage_compensation permission rather than inventing a new
-- key with different holders.

COMMIT;
