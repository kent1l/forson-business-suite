-- Migration: 20260813_09_hr_work_schedules_and_holidays.sql
-- Description: HR phase 2, part 1 — the calendar inputs the DTR is generated from.
--
--   1. work_schedule / work_schedule_day — the weekly pattern an employee is
--      expected to work. Seeded with the company's standard: Mon-Sat 07:00-17:00
--      and Sunday 07:00-15:00, each with a 60-minute break.
--   2. holiday — the Philippine holiday calendar. Only the calendar lives here;
--      the pay multipliers live in `settings` so a rate-policy change never
--      requires rewriting the calendar.
--   3. employee.work_schedule_id — every existing employee is backfilled onto
--      the default schedule.
--
-- The schedule carries time_in/time_out from day one even though the DTR is
-- day-level today. Generated DTR rows snapshot these times, so introducing real
-- biometric punches later is a behaviour change, not a migration.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Work schedules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_schedule (
    schedule_id   SERIAL PRIMARY KEY,
    schedule_name VARCHAR(100) NOT NULL UNIQUE,
    description   TEXT,
    is_default    BOOLEAN NOT NULL DEFAULT false,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_by    INTEGER REFERENCES employee(employee_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by   INTEGER REFERENCES employee(employee_id),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one default, enforced by the database rather than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_schedule_default
    ON work_schedule (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS work_schedule_day (
    schedule_day_id SERIAL PRIMARY KEY,
    schedule_id     INTEGER NOT NULL REFERENCES work_schedule(schedule_id) ON DELETE CASCADE,
    -- 0 = Sunday, matching Postgres EXTRACT(DOW) so date -> row is a direct lookup.
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    is_rest_day     BOOLEAN NOT NULL DEFAULT false,
    time_in         TIME,
    time_out        TIME,
    break_minutes   SMALLINT NOT NULL DEFAULT 60 CHECK (break_minutes >= 0),
    expected_hours  NUMERIC(4,2) NOT NULL DEFAULT 8.00 CHECK (expected_hours >= 0),
    CONSTRAINT uq_work_schedule_day UNIQUE (schedule_id, day_of_week),
    -- A working day needs both ends of the shift; a rest day needs neither.
    CONSTRAINT work_schedule_day_times_chk CHECK (
        is_rest_day OR (time_in IS NOT NULL AND time_out IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_work_schedule_day_schedule
    ON work_schedule_day (schedule_id, day_of_week);

-- Seed the company standard.
INSERT INTO work_schedule (schedule_name, description, is_default)
VALUES ('Standard (Mon-Sat 7-5, Sun 7-3)',
        'Default company schedule: Monday to Saturday 07:00-17:00, Sunday 07:00-15:00, 60-minute break.',
        true)
ON CONFLICT (schedule_name) DO NOTHING;

-- Mon-Sat 07:00-17:00 => 10 hours less a 60-minute break = 9.00 expected hours.
INSERT INTO work_schedule_day (schedule_id, day_of_week, is_rest_day, time_in, time_out, break_minutes, expected_hours)
SELECT ws.schedule_id, d.dow, false, TIME '07:00', TIME '17:00', 60, 9.00
FROM work_schedule ws
CROSS JOIN (VALUES (1), (2), (3), (4), (5), (6)) AS d(dow)
WHERE ws.schedule_name = 'Standard (Mon-Sat 7-5, Sun 7-3)'
ON CONFLICT (schedule_id, day_of_week) DO NOTHING;

-- Sunday 07:00-15:00 => 8 hours less a 60-minute break = 7.00 expected hours.
INSERT INTO work_schedule_day (schedule_id, day_of_week, is_rest_day, time_in, time_out, break_minutes, expected_hours)
SELECT ws.schedule_id, 0, false, TIME '07:00', TIME '15:00', 60, 7.00
FROM work_schedule ws
WHERE ws.schedule_name = 'Standard (Mon-Sat 7-5, Sun 7-3)'
ON CONFLICT (schedule_id, day_of_week) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Holiday calendar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holiday (
    holiday_id   SERIAL PRIMARY KEY,
    holiday_date DATE NOT NULL,
    holiday_name VARCHAR(150) NOT NULL,
    -- 'Regular' and 'Special Non-Working' carry different DOLE pay rules;
    -- 'Special Working' is paid as an ordinary day.
    holiday_type VARCHAR(30) NOT NULL
        CHECK (holiday_type IN ('Regular', 'Special Non-Working', 'Special Working', 'Local')),
    is_nationwide BOOLEAN NOT NULL DEFAULT true,
    locality     VARCHAR(100),
    notes        TEXT,
    created_by   INTEGER REFERENCES employee(employee_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_holiday_date_name UNIQUE (holiday_date, holiday_name)
);

CREATE INDEX IF NOT EXISTS idx_holiday_date ON holiday (holiday_date);

-- Philippine holidays for 2026. Fixed-date entries are stable law; the movable
-- ones (Holy Week, National Heroes Day) are computed for 2026 and every year
-- still requires the annual Presidential Proclamation to confirm dates and add
-- any extra special days.
INSERT INTO holiday (holiday_date, holiday_name, holiday_type) VALUES
    (DATE '2026-01-01', 'New Year''s Day',                  'Regular'),
    (DATE '2026-04-02', 'Maundy Thursday',                  'Regular'),
    (DATE '2026-04-03', 'Good Friday',                      'Regular'),
    (DATE '2026-04-04', 'Black Saturday',                   'Special Non-Working'),
    (DATE '2026-04-09', 'Araw ng Kagitingan',               'Regular'),
    (DATE '2026-05-01', 'Labor Day',                        'Regular'),
    (DATE '2026-06-12', 'Independence Day',                 'Regular'),
    (DATE '2026-08-21', 'Ninoy Aquino Day',                 'Special Non-Working'),
    (DATE '2026-08-31', 'National Heroes Day',              'Regular'),
    (DATE '2026-11-01', 'All Saints'' Day',                  'Special Non-Working'),
    (DATE '2026-11-30', 'Bonifacio Day',                    'Regular'),
    (DATE '2026-12-08', 'Feast of the Immaculate Conception','Special Non-Working'),
    (DATE '2026-12-25', 'Christmas Day',                    'Regular'),
    (DATE '2026-12-30', 'Rizal Day',                        'Regular'),
    (DATE '2026-12-31', 'Last Day of the Year',             'Special Non-Working')
ON CONFLICT (holiday_date, holiday_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Attach employees to a schedule
-- ---------------------------------------------------------------------------
ALTER TABLE public.employee
    ADD COLUMN IF NOT EXISTS work_schedule_id INTEGER REFERENCES work_schedule(schedule_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employee_work_schedule ON employee (work_schedule_id);

UPDATE employee
SET work_schedule_id = (SELECT schedule_id FROM work_schedule WHERE is_default LIMIT 1)
WHERE work_schedule_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permission (permission_key, description, category) VALUES
    ('hr:manage_schedules', 'Create and edit work schedules and the holiday calendar', 'Human Resources')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key IN ('hr:manage_schedules')
ON CONFLICT DO NOTHING;

COMMIT;
