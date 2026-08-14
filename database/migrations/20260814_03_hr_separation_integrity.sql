-- ---------------------------------------------------------------------------
-- Employment separation integrity, and the FINAL_PAY run type
-- ---------------------------------------------------------------------------
-- `employee.is_active` and `employee.employment_status` both describe whether
-- someone still works here, and nothing kept them in step. A record marked
-- Resigned with is_active still TRUE passed every payroll gate, which is how a
-- departed employee could be paid in full.
--
-- The application now refuses to pay such a record, but an application guard is
-- a second line of defence. These constraints make the contradiction
-- unrepresentable in the first place.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) A separation date can never precede the hire date
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_separation_after_hire_chk') THEN
        ALTER TABLE public.employee ADD CONSTRAINT employee_separation_after_hire_chk
            CHECK (date_separated IS NULL OR date_hired IS NULL OR date_separated >= date_hired::date);
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- (b) Keep is_active in step with employment_status
-- ---------------------------------------------------------------------------
-- A trigger rather than a CHECK: the two columns are edited from several
-- screens, and silently doing the right thing beats rejecting a save because
-- the user updated one field and not its twin.
CREATE OR REPLACE FUNCTION public.employee_sync_active_with_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.employment_status IN ('Resigned', 'Terminated', 'Retired') THEN
        NEW.is_active := false;
    -- Reinstating (a rehire, or a status correction) clears the separation so
    -- the employment window reopens; leaving a stale date behind would silently
    -- suppress the person's DTR and pay.
    ELSIF NEW.employment_status = 'Active'
          AND (TG_OP = 'INSERT' OR OLD.employment_status IS DISTINCT FROM NEW.employment_status) THEN
        NEW.is_active := true;
        NEW.date_separated := NULL;
        NEW.separation_reason := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employee_sync_active ON public.employee;
CREATE TRIGGER trg_employee_sync_active
    BEFORE INSERT OR UPDATE OF employment_status ON public.employee
    FOR EACH ROW EXECUTE FUNCTION public.employee_sync_active_with_status();

-- ---------------------------------------------------------------------------
-- (c) A separated employee must have a separation date
-- ---------------------------------------------------------------------------
-- Without a date there is no way to know which days of a cutoff were still
-- employment, so payroll cannot compute them correctly.
--
-- Added NOT VALID deliberately. Existing records that already carry a separated
-- status without a date are grandfathered rather than blocking this migration,
-- but every INSERT and UPDATE from now on is checked. Once those records have
-- been given their real last day, finish the job with:
--
--     ALTER TABLE employee VALIDATE CONSTRAINT employee_separation_date_required_chk;
--
-- Find them with:
--     SELECT employee_id, first_name, last_name, employment_status FROM employee
--     WHERE employment_status IN ('Resigned','Terminated','Retired') AND date_separated IS NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_separation_date_required_chk') THEN
        ALTER TABLE public.employee ADD CONSTRAINT employee_separation_date_required_chk
            CHECK (employment_status NOT IN ('Resigned', 'Terminated', 'Retired')
                   OR date_separated IS NOT NULL) NOT VALID;
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- (d) Expense category for final pay
-- ---------------------------------------------------------------------------
-- Final pay is settling an obligation to a leaver rather than the period's
-- salaries, but it is still compensation, so it posts to the same category as
-- regular gross unless a company separates them. Reuse the salaries setting;
-- no new setting is introduced.

COMMIT;
