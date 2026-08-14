-- Migration: 20260813_19_hr_time_capture.sql
-- Description: HR phase 7 — real time capture.
--
-- Phase 2 deliberately built daily_time_record with time_in/time_out columns and
-- a `source` discriminator even though the DTR was day-level, precisely so this
-- phase would be a behaviour change rather than a migration. That holds: the
-- only schema this needs is a device identifier to map imported rows back to
-- employees, and a log of raw punches.
--
-- Punches are recorded separately from the DTR rather than written straight
-- into it. A biometric terminal produces several taps a day (in, lunch out,
-- lunch in, out) and occasionally duplicates; the DTR row is the DERIVED daily
-- summary. Keeping the raw taps means a disputed day can always be re-derived.

BEGIN;

-- Biometric terminals identify staff by their own enrolment number, which is
-- rarely the employee_id.
ALTER TABLE public.employee
    ADD COLUMN IF NOT EXISTS biometric_id VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_biometric_id
    ON employee (biometric_id) WHERE biometric_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS time_punch (
    punch_id     BIGSERIAL PRIMARY KEY,
    employee_id  INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    punch_at     TIMESTAMPTZ NOT NULL,
    punch_date   DATE NOT NULL,
    direction    VARCHAR(10) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    source       VARCHAR(20) NOT NULL DEFAULT 'Device'
        CHECK (source IN ('Device', 'Web', 'Mobile', 'Import', 'Manual')),
    device_id    VARCHAR(50),
    -- Captured for web and mobile punches so a disputed entry has context.
    ip_address   VARCHAR(45),
    latitude     NUMERIC(9,6),
    longitude    NUMERIC(9,6),
    notes        TEXT,
    created_by   INTEGER REFERENCES employee(employee_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The same tap imported twice (a re-uploaded CSV) must not double-count.
    CONSTRAINT uq_time_punch_dedupe UNIQUE (employee_id, punch_at, direction)
);

CREATE INDEX IF NOT EXISTS idx_time_punch_employee_date
    ON time_punch (employee_id, punch_date DESC);
CREATE INDEX IF NOT EXISTS idx_time_punch_date ON time_punch (punch_date);

INSERT INTO permission (permission_key, description, category) VALUES
    ('dtr:punch',  'Clock in and out from the app',              'Human Resources'),
    ('dtr:import', 'Import time punches from a biometric device', 'Human Resources')
ON CONFLICT (permission_key) DO NOTHING;

-- Everyone may punch for themselves; importing is an HR action.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE p.permission_key = 'dtr:punch'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key = 'dtr:import'
ON CONFLICT DO NOTHING;

INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('DTR_PUNCH_GRACE_MINUTES', '15', 'Minutes after the scheduled start before a punch counts as late'),
    ('DTR_PUNCH_MIN_HALF_DAY_HOURS', '4', 'Hours worked below which a day is treated as a half day')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
