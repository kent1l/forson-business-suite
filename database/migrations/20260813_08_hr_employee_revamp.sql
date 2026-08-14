-- Migration: 20260813_08_hr_employee_revamp.sql
-- Description: HR module phase 1 foundation.
--              (a) Relax the auth columns on `employee` so payroll-only staff
--                  (drivers, mechanics, helpers) can exist as HR records without
--                  ever holding system credentials.
--              (b) Add `department`, and extend `employee` with the personal,
--                  contact, emergency and employment-lifecycle fields a real HR
--                  record needs.
--              (c) Add `employee_government_id` (SSS/TIN/PhilHealth/Pag-IBIG and
--                  bank details) as a separate table so it can be gated behind
--                  its own permission.
--              (d) Add `employee_compensation` as an effective-dated history so a
--                  payroll run for a past period resolves the rate that was in
--                  force then, not today's rate.
--              (e) Seed the hr:* permission keys.
--
-- NOTE: `is_active` keeps its existing meaning ("can log in / shows in active
--       lists") and is still read by the login query. The new
--       `employment_status` carries the HR meaning. They are deliberately
--       not merged.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Allow employees without system access
-- ---------------------------------------------------------------------------
-- SQL `=` never matches NULL, so `WHERE username = $1` in the login handler
-- cannot reach a login-less row. Postgres UNIQUE also permits multiple NULLs,
-- so the existing unique constraint on username stays valid.
ALTER TABLE public.employee ALTER COLUMN username DROP NOT NULL;
ALTER TABLE public.employee ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE public.employee ALTER COLUMN password_salt DROP NOT NULL;
ALTER TABLE public.employee ALTER COLUMN permission_level_id DROP NOT NULL;

-- ...but never allow a half-provisioned account. Credentials are all-or-nothing:
-- either the employee has a full login, or none of the four columns are set.
-- This is what actually protects the login path — a row can never carry a
-- username with a NULL hash.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'employee_login_complete_chk'
    ) THEN
        ALTER TABLE public.employee ADD CONSTRAINT employee_login_complete_chk
            CHECK (
                (username IS NULL AND password_hash IS NULL
                 AND password_salt IS NULL AND permission_level_id IS NULL)
                OR
                (username IS NOT NULL AND password_hash IS NOT NULL
                 AND password_salt IS NOT NULL AND permission_level_id IS NOT NULL)
            );
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- (b) Departments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department (
    department_id    SERIAL PRIMARY KEY,
    department_name  VARCHAR(100) NOT NULL UNIQUE,
    description      TEXT,
    cost_center_code VARCHAR(30),
    head_employee_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_by       INTEGER REFERENCES employee(employee_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by      INTEGER REFERENCES employee(employee_id),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_department_name_lower
    ON department (LOWER(department_name));
CREATE INDEX IF NOT EXISTS idx_department_sort
    ON department (is_active, sort_order, department_name);

INSERT INTO department (department_name, description, sort_order)
VALUES
    ('Administration', 'Management and office administration', 1),
    ('Sales',          'Counter sales and customer accounts',  2),
    ('Warehouse',      'Stockroom, receiving and delivery',    3),
    ('Service',        'Shop floor and field service',         4),
    ('Accounting',     'Bookkeeping, treasury and payroll',    5)
ON CONFLICT (department_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (b cont.) Extend employee
-- ---------------------------------------------------------------------------
-- Personal
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS middle_name   VARCHAR(100);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS suffix        VARCHAR(20);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS birth_date    DATE;
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS gender        VARCHAR(20);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS civil_status  VARCHAR(20);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS photo_url     TEXT;

-- Contact
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS mobile_no      VARCHAR(30);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS personal_email VARCHAR(150);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS address_line   TEXT;
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS barangay       VARCHAR(100);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS city           VARCHAR(100);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS province       VARCHAR(100);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS postal_code    VARCHAR(10);

-- Emergency contact
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS emergency_contact_name     VARCHAR(150);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS emergency_contact_relation VARCHAR(50);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS emergency_contact_phone    VARCHAR(30);

-- Employment lifecycle
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS department_id       INTEGER REFERENCES department(department_id) ON DELETE SET NULL;
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS manager_employee_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL;
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS employment_type     VARCHAR(30);
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS employment_status   VARCHAR(30) NOT NULL DEFAULT 'Active';
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS date_regularized    DATE;
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS date_separated      DATE;
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS separation_reason   TEXT;
-- Lets HR exclude consultants and non-paid records from payroll runs (phase 4)
-- without deactivating them.
ALTER TABLE public.employee ADD COLUMN IF NOT EXISTS is_payroll_eligible BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_employment_type_chk') THEN
        ALTER TABLE public.employee ADD CONSTRAINT employee_employment_type_chk
            CHECK (employment_type IS NULL OR employment_type IN
                ('Regular', 'Probationary', 'Contractual', 'Project-based', 'Part-time', 'Casual'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_employment_status_chk') THEN
        ALTER TABLE public.employee ADD CONSTRAINT employee_employment_status_chk
            CHECK (employment_status IN
                ('Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated', 'Retired'));
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_employee_department        ON employee (department_id);
CREATE INDEX IF NOT EXISTS idx_employee_manager           ON employee (manager_employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_employment_status ON employee (employment_status);

-- ---------------------------------------------------------------------------
-- (c) Government IDs and bank details (sensitive - own permission)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_government_id (
    employee_id       INTEGER PRIMARY KEY REFERENCES employee(employee_id) ON DELETE CASCADE,
    sss_no            VARCHAR(30),
    tin               VARCHAR(30),
    philhealth_no     VARCHAR(30),
    pagibig_mid_no    VARCHAR(30),
    bank_name         VARCHAR(100),
    bank_account_name VARCHAR(150),
    bank_account_no   VARCHAR(50),
    created_by        INTEGER REFERENCES employee(employee_id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by       INTEGER REFERENCES employee(employee_id),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Government IDs are unique per person, but blank during onboarding, so the
-- uniqueness is enforced only over non-null values.
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_gov_sss
    ON employee_government_id (sss_no)         WHERE sss_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_gov_tin
    ON employee_government_id (tin)            WHERE tin IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_gov_philhealth
    ON employee_government_id (philhealth_no)  WHERE philhealth_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_gov_pagibig
    ON employee_government_id (pagibig_mid_no) WHERE pagibig_mid_no IS NOT NULL;

-- Append-only record of who looked at whose government IDs and bank details.
-- This is a Data Privacy Act (RA 10173) concern as much as a security one:
-- a permission check answers "may they?", this answers "who did, and when?".
CREATE TABLE IF NOT EXISTS employee_sensitive_access_log (
    log_id      BIGSERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    accessed_by INTEGER NOT NULL REFERENCES employee(employee_id),
    action      VARCHAR(20) NOT NULL CHECK (action IN ('VIEW', 'UPDATE')),
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_sensitive_access_employee
    ON employee_sensitive_access_log (employee_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_emp_sensitive_access_actor
    ON employee_sensitive_access_log (accessed_by, accessed_at DESC);

-- ---------------------------------------------------------------------------
-- (d) Effective-dated compensation history
-- ---------------------------------------------------------------------------
-- Resolution is always "the latest row with effective_date <= :as_of", so a
-- payroll run for a closed period stays reproducible after a raise.
CREATE TABLE IF NOT EXISTS employee_compensation (
    compensation_id BIGSERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
    effective_date  DATE NOT NULL,
    pay_basis       VARCHAR(20) NOT NULL DEFAULT 'daily',
    base_rate       NUMERIC(12,2) NOT NULL CHECK (base_rate >= 0),
    days_per_year   INTEGER NOT NULL DEFAULT 313,
    -- Statutory contributions are looked up on a *monthly* basis, which for a
    -- daily-rated employee is normally derived (daily_rate * days_per_year / 12).
    -- These two let HR override that derivation for irregular earners without
    -- distorting the actual pay rate. Consumed by the phase 4 payroll engine.
    declared_monthly_basic NUMERIC(12,2),
    sss_msc_override       NUMERIC(12,2),
    reason          TEXT,
    notes           TEXT,
    created_by      INTEGER REFERENCES employee(employee_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by     INTEGER REFERENCES employee(employee_id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT employee_compensation_pay_basis_chk
        CHECK (pay_basis IN ('daily', 'monthly', 'hourly', 'commission')),
    CONSTRAINT uq_employee_compensation_effective
        UNIQUE (employee_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_compensation_lookup
    ON employee_compensation (employee_id, effective_date DESC);

-- ---------------------------------------------------------------------------
-- (e) Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permission (permission_key, description, category)
VALUES
    ('hr:view',                'View HR records, departments and employee profiles', 'Human Resources'),
    ('hr:manage_employees',    'Create and edit employee HR records',                'Human Resources'),
    ('hr:manage_departments',  'Create and edit departments',                        'Human Resources'),
    ('hr:view_sensitive',      'View and edit government IDs and bank details',       'Human Resources'),
    ('hr:manage_compensation', 'View and edit employee pay rates',                    'Human Resources')
ON CONFLICT (permission_key) DO NOTHING;

-- Broad HR access for Admin and Manager.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key IN ('hr:view', 'hr:manage_employees', 'hr:manage_departments')
ON CONFLICT DO NOTHING;

-- Government IDs, bank details and pay rates are the genuinely confidential
-- slices: Admin only.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Super Admin')
  AND p.permission_key IN ('hr:view_sensitive', 'hr:manage_compensation')
ON CONFLICT DO NOTHING;

COMMIT;
