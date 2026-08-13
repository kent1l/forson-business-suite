-- Migration: 20260813_10_hr_leave_module.sql
-- Description: HR phase 3 — leave types, per-year balances, and leave requests.
--
-- Leave is created before the DTR table because an approved leave request is
-- what stamps 'On Leave' onto the affected DTR days, so daily_time_record
-- carries an FK to leave_request.
--
-- Balances are tracked per employee per leave type per calendar year rather
-- than as a single running number, so an entitlement change or a year-end
-- carry-over never rewrites history.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Leave types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_type (
    leave_type_id         SERIAL PRIMARY KEY,
    leave_code            VARCHAR(20) NOT NULL UNIQUE,
    leave_name            VARCHAR(100) NOT NULL,
    description           TEXT,
    -- Paid leave still pays the day; unpaid leave zeroes it. The payroll engine
    -- reads this to decide whether the DTR day counts toward days paid.
    is_paid               BOOLEAN NOT NULL DEFAULT true,
    default_days_per_year NUMERIC(5,2),
    requires_approval     BOOLEAN NOT NULL DEFAULT true,
    is_active             BOOLEAN NOT NULL DEFAULT true,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_by            INTEGER REFERENCES employee(employee_id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by           INTEGER REFERENCES employee(employee_id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Philippine statutory and common company leave types. SIL (Service Incentive
-- Leave) is the Labor Code minimum of 5 days after one year of service.
INSERT INTO leave_type (leave_code, leave_name, description, is_paid, default_days_per_year, sort_order) VALUES
    ('SIL',  'Service Incentive Leave', 'Labor Code Art. 95 — 5 days after one year of service', true,  5,   1),
    ('VL',   'Vacation Leave',          'Company-granted vacation leave',                        true,  NULL, 2),
    ('SL',   'Sick Leave',              'Company-granted sick leave',                            true,  NULL, 3),
    ('MAT',  'Maternity Leave',         'RA 11210 — 105 days expanded maternity leave',          true,  105, 4),
    ('PAT',  'Paternity Leave',         'RA 8187 — 7 days for married male employees',           true,  7,   5),
    ('SPL',  'Solo Parent Leave',       'RA 8972 — 7 days for qualified solo parents',           true,  7,   6),
    ('SPLW', 'Special Leave for Women', 'RA 9710 — up to 60 days for gynecological disorders',   true,  60,  7),
    ('BEREV','Bereavement Leave',       'Company-granted bereavement leave',                     true,  NULL, 8),
    ('LWOP', 'Leave Without Pay',       'Approved absence with no pay',                          false, NULL, 99)
ON CONFLICT (leave_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Per-year balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_leave_balance (
    balance_id      BIGSERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    leave_type_id   INTEGER NOT NULL REFERENCES leave_type(leave_type_id) ON DELETE CASCADE,
    year            SMALLINT NOT NULL,
    entitled_days   NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (entitled_days >= 0),
    carried_over_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (carried_over_days >= 0),
    -- Maintained by trigger from approved leave requests, never written by hand.
    used_days       NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
    notes           TEXT,
    created_by      INTEGER REFERENCES employee(employee_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by     INTEGER REFERENCES employee(employee_id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_employee_leave_balance UNIQUE (employee_id, leave_type_id, year)
);

CREATE INDEX IF NOT EXISTS idx_employee_leave_balance_lookup
    ON employee_leave_balance (employee_id, year);

-- ---------------------------------------------------------------------------
-- 3. Leave requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_request (
    leave_id      BIGSERIAL PRIMARY KEY,
    employee_id   INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    leave_type_id INTEGER NOT NULL REFERENCES leave_type(leave_type_id),
    date_from     DATE NOT NULL,
    date_to       DATE NOT NULL,
    -- 0.5 marks a half-day leave; the DTR day it produces inherits this.
    day_fraction  NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (day_fraction > 0 AND day_fraction <= 1),
    -- Working days actually consumed, resolved against the employee's schedule
    -- and the holiday calendar at approval time (weekends/holidays don't count).
    total_days    NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (total_days >= 0),
    status        VARCHAR(20) NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
    reason        TEXT,
    approved_by   INTEGER REFERENCES employee(employee_id),
    approved_at   TIMESTAMPTZ,
    decision_note TEXT,
    created_by    INTEGER REFERENCES employee(employee_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by   INTEGER REFERENCES employee(employee_id),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT leave_request_range_chk CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_leave_request_employee
    ON leave_request (employee_id, date_from DESC);
CREATE INDEX IF NOT EXISTS idx_leave_request_status
    ON leave_request (status) WHERE status = 'Pending';
CREATE INDEX IF NOT EXISTS idx_leave_request_range
    ON leave_request (date_from, date_to);

-- One live request per employee per overlapping date range. Cancelled and
-- rejected rows drop out, so a corrected re-request is always possible.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_request_no_overlap') THEN
        ALTER TABLE leave_request ADD CONSTRAINT leave_request_no_overlap
            EXCLUDE USING gist (
                employee_id WITH =,
                daterange(date_from, date_to, '[]') WITH &&
            ) WHERE (status IN ('Pending', 'Approved'));
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 4. Keep used_days in step with approved leave
-- ---------------------------------------------------------------------------
-- Recomputing from the source rows (rather than incrementing) means an approve,
-- a later cancel, and a re-approve can never drift the balance.
CREATE OR REPLACE FUNCTION recalc_leave_balance() RETURNS TRIGGER AS $$
DECLARE
    target_employee INTEGER;
    target_type     INTEGER;
    target_year     SMALLINT;
BEGIN
    target_employee := COALESCE(NEW.employee_id, OLD.employee_id);
    target_type     := COALESCE(NEW.leave_type_id, OLD.leave_type_id);
    target_year     := EXTRACT(YEAR FROM COALESCE(NEW.date_from, OLD.date_from))::SMALLINT;

    UPDATE employee_leave_balance b
    SET used_days = COALESCE((
            SELECT SUM(lr.total_days) FROM leave_request lr
            WHERE lr.employee_id = target_employee
              AND lr.leave_type_id = target_type
              AND lr.status = 'Approved'
              AND EXTRACT(YEAR FROM lr.date_from) = target_year
        ), 0),
        updated_at = now()
    WHERE b.employee_id = target_employee
      AND b.leave_type_id = target_type
      AND b.year = target_year;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leave_request_balance ON leave_request;
CREATE TRIGGER trg_leave_request_balance
    AFTER INSERT OR UPDATE OR DELETE ON leave_request
    FOR EACH ROW EXECUTE FUNCTION recalc_leave_balance();

-- ---------------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permission (permission_key, description, category) VALUES
    ('leave:view',    'View leave requests and balances',        'Human Resources'),
    ('leave:request', 'File leave requests',                     'Human Resources'),
    ('leave:approve', 'Approve or reject leave requests',        'Human Resources'),
    ('leave:manage',  'Manage leave types and employee balances', 'Human Resources')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key IN ('leave:view', 'leave:request', 'leave:approve', 'leave:manage')
ON CONFLICT DO NOTHING;

-- Secretaries file and track leave but do not approve it.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Secretary')
  AND p.permission_key IN ('leave:view', 'leave:request')
ON CONFLICT DO NOTHING;

COMMIT;
