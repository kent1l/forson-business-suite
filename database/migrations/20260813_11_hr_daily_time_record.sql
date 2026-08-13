-- Migration: 20260813_11_hr_daily_time_record.sql
-- Description: HR phase 2, part 2 — the daily time record.
--
-- One row per employee per date. The record is day-level today: what matters is
-- whether the day was worked in full, in half, or not at all. The punch columns
-- (time_in / time_out) exist from the start and are auto-filled from the
-- employee's schedule, so introducing biometric or app-based punches later
-- changes only how those columns are populated — no migration required.
--
-- A row is frozen once a payroll run consumes it (locked_by_run_id), enforced
-- by a trigger in the same spirit as ar_ledger_immutability_guard.

BEGIN;

CREATE TABLE IF NOT EXISTS daily_time_record (
    dtr_id             BIGSERIAL PRIMARY KEY,
    employee_id        INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    work_date          DATE NOT NULL,

    day_type           VARCHAR(30) NOT NULL DEFAULT 'Present'
        CHECK (day_type IN (
            'Present',            -- full day worked
            'Half Day',           -- half day worked
            'Absent',             -- scheduled to work, did not
            'On Leave',           -- covered by an approved leave request
            'Rest Day',           -- not scheduled to work
            'Rest Day Worked',
            'Holiday',            -- holiday, not worked
            'Holiday Worked',
            'Suspended'           -- work suspension (typhoon, etc.)
        )),
    -- Days the payroll engine will pay for: 1.000, 0.500, or 0. Kept as a plain
    -- column rather than derived in SQL so payroll's "days paid" is one SUM.
    day_fraction       NUMERIC(4,3) NOT NULL DEFAULT 1.000
        CHECK (day_fraction >= 0 AND day_fraction <= 1),

    is_rest_day        BOOLEAN NOT NULL DEFAULT false,
    holiday_id         INTEGER REFERENCES holiday(holiday_id) ON DELETE SET NULL,
    leave_id           BIGINT REFERENCES leave_request(leave_id) ON DELETE SET NULL,

    -- What the schedule said, snapshotted so later schedule edits don't rewrite
    -- history.
    scheduled_time_in  TIME,
    scheduled_time_out TIME,
    -- What actually happened. Auto-filled from the schedule today; replaced by
    -- real punches once time capture exists.
    time_in            TIME,
    time_out           TIME,
    break_minutes      SMALLINT NOT NULL DEFAULT 60 CHECK (break_minutes >= 0),

    hours_worked       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
    overtime_hours     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
    night_diff_hours   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (night_diff_hours >= 0),
    late_minutes       INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
    undertime_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (undertime_minutes >= 0),

    source             VARCHAR(20) NOT NULL DEFAULT 'Auto Schedule'
        CHECK (source IN ('Auto Schedule', 'Manual', 'Import', 'Device', 'Mobile')),
    remarks            TEXT,

    -- Set when a payroll run consumes this day. No FK yet: payroll_run arrives
    -- in phase 4, which adds the constraint.
    locked_by_run_id   BIGINT,

    created_by         INTEGER REFERENCES employee(employee_id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by        INTEGER REFERENCES employee(employee_id),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_dtr_employee_date UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_dtr_employee_date ON daily_time_record (employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_dtr_date          ON daily_time_record (work_date);
CREATE INDEX IF NOT EXISTS idx_dtr_locked        ON daily_time_record (locked_by_run_id)
    WHERE locked_by_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dtr_leave         ON daily_time_record (leave_id)
    WHERE leave_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Lock guard
-- ---------------------------------------------------------------------------
-- Once payroll has consumed a day, correcting it in place would silently
-- desynchronise a payslip from its source. The only sanctioned way to reopen a
-- locked period is voiding the payroll run, which sets app.payroll_unlock for
-- the duration of that transaction.
CREATE OR REPLACE FUNCTION dtr_lock_guard() RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('app.payroll_unlock', true) = 'on' THEN
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF OLD.locked_by_run_id IS NOT NULL THEN
        RAISE EXCEPTION
            'Daily time record % (employee %, %) is locked by payroll run % and cannot be modified.',
            OLD.dtr_id, OLD.employee_id, OLD.work_date, OLD.locked_by_run_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dtr_lock_guard ON daily_time_record;
CREATE TRIGGER trg_dtr_lock_guard
    BEFORE UPDATE OR DELETE ON daily_time_record
    FOR EACH ROW EXECUTE FUNCTION dtr_lock_guard();

-- ---------------------------------------------------------------------------
-- Change log
-- ---------------------------------------------------------------------------
-- HR keys these records by hand, so "who marked him present?" must have an
-- answer. Append-only; written by the service on every field change.
CREATE TABLE IF NOT EXISTS dtr_change_log (
    log_id      BIGSERIAL PRIMARY KEY,
    dtr_id      BIGINT REFERENCES daily_time_record(dtr_id) ON DELETE SET NULL,
    employee_id INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    work_date   DATE NOT NULL,
    field_name  VARCHAR(50) NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    reason      TEXT,
    changed_by  INTEGER NOT NULL REFERENCES employee(employee_id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dtr_change_log_dtr
    ON dtr_change_log (employee_id, work_date DESC);

-- ---------------------------------------------------------------------------
-- Permissions and settings
-- ---------------------------------------------------------------------------
INSERT INTO permission (permission_key, description, category) VALUES
    ('dtr:view',     'View daily time records',                    'Human Resources'),
    ('dtr:edit',     'Enter and correct daily time records',       'Human Resources'),
    ('dtr:generate', 'Generate daily time records from schedules', 'Human Resources')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key IN ('dtr:view', 'dtr:edit', 'dtr:generate')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Secretary')
  AND p.permission_key IN ('dtr:view')
ON CONFLICT DO NOTHING;

-- PUT /api/settings only UPDATEs, so new keys must be INSERTed here first.
INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('DTR_DEFAULT_BREAK_MINUTES', '60',  'Default unpaid break in minutes applied to generated DTR days'),
    ('DTR_AUTOGEN_LOOKAHEAD_DAYS', '31', 'How many days ahead DTR generation may create rows')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
