-- Migration: 20260813_15_hr_statutory_version_guard.sql
-- Description: HR phase 4b — make statutory schedules editable safely.
--
-- Phase 4 shipped the versioned statutory tables with the STATED rule that a
-- version consumed by a real payroll run becomes immutable, but nothing
-- enforced it. This adds that enforcement, so opening up the write endpoints
-- cannot retroactively change what a historical payslip was computed from.
--
-- "In use" means referenced by a payroll_run that is not Draft and not Voided.
-- A Draft run has produced no payslips, and a Voided run's payslips are already
-- superseded, so neither pins the schedule.
--
-- Correcting an in-use schedule is done by SUPERSEDING it: close the old
-- version's effective_to and insert a new version from the next day. The
-- exclusion constraint added in phase 4 keeps the two from overlapping.

BEGIN;

CREATE OR REPLACE FUNCTION statutory_version_is_in_use(target_version INTEGER)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM payroll_run r
        WHERE r.status NOT IN ('Draft', 'Voided')
          AND target_version IN (r.sss_version_id, r.philhealth_version_id,
                                 r.pagibig_version_id, r.bir_version_id)
    );
$$ LANGUAGE sql STABLE;

-- Guard for the bracket/config child tables. The version is read from the row
-- being changed.
CREATE OR REPLACE FUNCTION statutory_bracket_guard() RETURNS TRIGGER AS $$
DECLARE
    target_version INTEGER;
BEGIN
    target_version := COALESCE(NEW.version_id, OLD.version_id);
    IF statutory_version_is_in_use(target_version) THEN
        RAISE EXCEPTION
            'Statutory version % has already been used by a payroll run and cannot be edited. Supersede it with a new version instead.',
            target_version
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sss_bracket_guard ON sss_contribution_bracket;
CREATE TRIGGER trg_sss_bracket_guard
    BEFORE INSERT OR UPDATE OR DELETE ON sss_contribution_bracket
    FOR EACH ROW EXECUTE FUNCTION statutory_bracket_guard();

DROP TRIGGER IF EXISTS trg_philhealth_config_guard ON philhealth_config;
CREATE TRIGGER trg_philhealth_config_guard
    BEFORE INSERT OR UPDATE OR DELETE ON philhealth_config
    FOR EACH ROW EXECUTE FUNCTION statutory_bracket_guard();

DROP TRIGGER IF EXISTS trg_pagibig_config_guard ON pagibig_config;
CREATE TRIGGER trg_pagibig_config_guard
    BEFORE INSERT OR UPDATE OR DELETE ON pagibig_config
    FOR EACH ROW EXECUTE FUNCTION statutory_bracket_guard();

DROP TRIGGER IF EXISTS trg_bir_bracket_guard ON bir_withholding_bracket;
CREATE TRIGGER trg_bir_bracket_guard
    BEFORE INSERT OR UPDATE OR DELETE ON bir_withholding_bracket
    FOR EACH ROW EXECUTE FUNCTION statutory_bracket_guard();

-- The version header itself: the effective dates and the active flag change
-- what a recompute would resolve, so they are frozen too. Closing effective_to
-- is the one exception — that is exactly what superseding does.
CREATE OR REPLACE FUNCTION statutory_version_guard() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF statutory_version_is_in_use(OLD.version_id) THEN
            RAISE EXCEPTION 'Statutory version % is in use by a payroll run and cannot be deleted.', OLD.version_id
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF statutory_version_is_in_use(OLD.version_id) THEN
        -- Permit only the supersede move: setting an end date on a schedule
        -- that previously ran open-ended.
        IF NEW.agency IS DISTINCT FROM OLD.agency
           OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
           OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION
                'Statutory version % is in use by a payroll run. Only its end date may be changed (to supersede it).',
                OLD.version_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_statutory_version_guard ON statutory_table_version;
CREATE TRIGGER trg_statutory_version_guard
    BEFORE UPDATE OR DELETE ON statutory_table_version
    FOR EACH ROW EXECUTE FUNCTION statutory_version_guard();

COMMIT;
