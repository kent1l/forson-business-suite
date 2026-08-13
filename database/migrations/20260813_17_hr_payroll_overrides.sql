-- Migration: 20260813_17_hr_payroll_overrides.sql
-- Description: HR phase 5b — manual overrides of computed amounts.
--
-- TWO TABLES, because they answer different questions:
--
--   employee_statutory_override — standing. "This employee always contributes
--     600 to Pag-IBIG, not the mandatory 200." Effective-dated, applies to every
--     run in range.
--
--   payroll_run_adjustment — one-off. "On this cutoff only, adjust her SSS."
--
-- WHY ADJUSTMENTS CANNOT LIVE ON THE PAYSLIP:
--   Recompute is modelled as delete-then-regenerate (that is what
--   Computed -> Draft -> Computed does). Anything stored on the payslip is
--   destroyed by a recompute. Adjustments are therefore INPUTS the engine
--   reads, keyed by run + employee + component, and they survive any number of
--   recomputes.
--
-- COMPLIANCE POSTURE:
--   Overriding a statutory contribution or the withholding tax is materially
--   different from overriding a meal allowance, so `reason` is mandatory on
--   both tables, the actor is recorded, and adjustments freeze the moment the
--   run leaves Computed — the same boundary that freezes payslips.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Standing per-employee statutory overrides
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_statutory_override (
    override_id     BIGSERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    -- Restricted to the statutory employee-side codes; overriding an arbitrary
    -- component is what employee_pay_component is for.
    component_code  VARCHAR(40) NOT NULL REFERENCES pay_component(component_code)
        CHECK (component_code IN ('SSS_EE', 'SSS_MPF_EE', 'PHIC_EE', 'HDMF_EE', 'WTAX')),
    -- A MONTHLY figure, matching how the statutory tables are expressed. The
    -- engine prorates it onto the cutoff exactly like a computed contribution.
    override_amount NUMERIC(12,2) NOT NULL CHECK (override_amount >= 0),
    reason          TEXT NOT NULL,
    effective_from  DATE NOT NULL,
    effective_to    DATE,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      INTEGER NOT NULL REFERENCES employee(employee_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by     INTEGER REFERENCES employee(employee_id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT statutory_override_range_chk CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT statutory_override_reason_chk CHECK (LENGTH(TRIM(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_statutory_override_lookup
    ON employee_statutory_override (employee_id, effective_from DESC) WHERE is_active;

CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_override_no_overlap') THEN
        ALTER TABLE employee_statutory_override ADD CONSTRAINT statutory_override_no_overlap
            EXCLUDE USING gist (
                employee_id WITH =,
                component_code WITH =,
                daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
            ) WHERE (is_active);
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. One-off adjustments scoped to a single run
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_run_adjustment (
    adjustment_id   BIGSERIAL PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES payroll_run(run_id) ON DELETE CASCADE,
    employee_id     INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    component_code  VARCHAR(40) NOT NULL REFERENCES pay_component(component_code),
    -- OVERRIDE replaces whatever the engine computed for that component.
    -- ADD contributes an extra line (a bonus, a one-time deduction).
    adjustment_type VARCHAR(20) NOT NULL DEFAULT 'ADD'
        CHECK (adjustment_type IN ('OVERRIDE', 'ADD')),
    amount          NUMERIC(12,2) NOT NULL,
    reason          TEXT NOT NULL,
    created_by      INTEGER NOT NULL REFERENCES employee(employee_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT run_adjustment_reason_chk CHECK (LENGTH(TRIM(reason)) > 0),
    -- One override per component per employee per run; ADDs may repeat, so the
    -- uniqueness is scoped to OVERRIDE only.
    CONSTRAINT uq_run_adjustment_override UNIQUE (run_id, employee_id, component_code, adjustment_type)
);

CREATE INDEX IF NOT EXISTS idx_run_adjustment_run ON payroll_run_adjustment (run_id, employee_id);

-- Adjustments are inputs to the computation, so they may only be added or
-- changed while the run can still be recomputed. After approval the payslips
-- are frozen and an adjustment would be a claim the payslip does not reflect.
CREATE OR REPLACE FUNCTION run_adjustment_guard() RETURNS TRIGGER AS $$
DECLARE
    run_status TEXT;
    target_run BIGINT;
BEGIN
    target_run := COALESCE(NEW.run_id, OLD.run_id);
    SELECT status INTO run_status FROM payroll_run WHERE run_id = target_run;

    -- Run already deleted (cascade); nothing to protect.
    IF run_status IS NULL THEN
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF run_status NOT IN ('Draft', 'Computed') THEN
        RAISE EXCEPTION
            'Payroll run is %; adjustments can only be made while it is Draft or Computed.', run_status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_run_adjustment_guard ON payroll_run_adjustment;
CREATE TRIGGER trg_run_adjustment_guard
    BEFORE INSERT OR UPDATE OR DELETE ON payroll_run_adjustment
    FOR EACH ROW EXECUTE FUNCTION run_adjustment_guard();

-- ---------------------------------------------------------------------------
-- 3. Permissions
-- ---------------------------------------------------------------------------
-- Overriding statutory figures is compliance-sensitive, so it gets its own
-- Admin-only key rather than riding on payroll:compute.
INSERT INTO permission (permission_key, description, category) VALUES
    ('payroll:override', 'Override computed payroll amounts and statutory contributions', 'Payroll')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Super Admin')
  AND p.permission_key IN ('payroll:override')
ON CONFLICT DO NOTHING;

COMMIT;
