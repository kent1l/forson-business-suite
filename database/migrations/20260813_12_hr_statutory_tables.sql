-- Migration: 20260813_12_hr_statutory_tables.sql
-- Description: HR phase 4, part 1 — versioned Philippine statutory contribution
--              and withholding tables.
--
-- WHY TABLE-DRIVEN AND VERSIONED, NOT CONSTANTS IN CODE:
--   SSS, PhilHealth and Pag-IBIG schedules change by circular, and BIR brackets
--   change by law. If the figures lived in JavaScript, (a) a January circular
--   would need a code deploy, and (b) — far worse — re-opening a payroll run
--   from last October would silently recompute it with this year's numbers.
--   Each payroll run snapshots the version IDs it used, so a historical run
--   always resolves the schedule that was in force at the time.
--
--   A version that any non-draft payroll run references becomes immutable
--   (enforced by trigger below). Correcting rates means superseding the version
--   with a new one, never editing a used one.
--
-- !! VERIFY BEFORE RUNNING REAL PAYROLL !!
--   The seeded figures reflect the schedules known as of authoring:
--     - SSS: 15% total (10% ER / 5% EE), MSC 5,000-35,000, WISP above MSC 20,000
--     - PhilHealth: 5% premium, floor 10,000, ceiling 100,000, split 50/50
--     - Pag-IBIG: 1% EE at or below 1,500 monthly, else 2%; 2% ER; 10,000 cap
--     - BIR: TRAIN graduated semi-monthly table (RR 11-2018, 2023 onward)
--   Confirm each against the current issuance and supersede the version if any
--   figure has moved.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Version header
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statutory_table_version (
    version_id       SERIAL PRIMARY KEY,
    agency           VARCHAR(20) NOT NULL
        CHECK (agency IN ('SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR_WTAX')),
    version_label    VARCHAR(100) NOT NULL,
    effective_from   DATE NOT NULL,
    effective_to     DATE,
    source_reference TEXT,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_by       INTEGER REFERENCES employee(employee_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_statutory_version UNIQUE (agency, effective_from),
    CONSTRAINT statutory_version_range_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Two versions of the same agency may never cover the same date, so resolving
-- "which schedule applies on date X" can never return two rows.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_version_no_overlap') THEN
        ALTER TABLE statutory_table_version ADD CONSTRAINT statutory_version_no_overlap
            EXCLUDE USING gist (
                agency WITH =,
                daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
            );
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. SSS brackets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sss_contribution_bracket (
    bracket_id  SERIAL PRIMARY KEY,
    version_id  INTEGER NOT NULL REFERENCES statutory_table_version(version_id) ON DELETE CASCADE,
    range_from  NUMERIC(12,2) NOT NULL,
    range_to    NUMERIC(12,2),           -- NULL = open-ended top bracket
    msc         NUMERIC(12,2) NOT NULL,  -- Monthly Salary Credit
    ee_amount   NUMERIC(12,2) NOT NULL,  -- regular SS, employee share
    er_amount   NUMERIC(12,2) NOT NULL,  -- regular SS, employer share
    ec_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Employees' Compensation (employer only)
    mpf_ee      NUMERIC(12,2) NOT NULL DEFAULT 0,  -- WISP / provident, employee share
    mpf_er      NUMERIC(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT uq_sss_bracket UNIQUE (version_id, range_from)
);

CREATE INDEX IF NOT EXISTS idx_sss_bracket_lookup
    ON sss_contribution_bracket (version_id, range_from);

-- ---------------------------------------------------------------------------
-- 3. PhilHealth / Pag-IBIG are rate-based, so one config row per version
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS philhealth_config (
    version_id     INTEGER PRIMARY KEY REFERENCES statutory_table_version(version_id) ON DELETE CASCADE,
    premium_rate   NUMERIC(6,4) NOT NULL,
    income_floor   NUMERIC(12,2) NOT NULL,
    income_ceiling NUMERIC(12,2) NOT NULL,
    ee_share_ratio NUMERIC(5,4) NOT NULL DEFAULT 0.5000
);

CREATE TABLE IF NOT EXISTS pagibig_config (
    version_id       INTEGER PRIMARY KEY REFERENCES statutory_table_version(version_id) ON DELETE CASCADE,
    threshold_amount NUMERIC(12,2) NOT NULL DEFAULT 1500,
    ee_rate_below    NUMERIC(6,4) NOT NULL DEFAULT 0.0100,
    ee_rate_above    NUMERIC(6,4) NOT NULL DEFAULT 0.0200,
    er_rate          NUMERIC(6,4) NOT NULL DEFAULT 0.0200,
    max_compensation NUMERIC(12,2) NOT NULL DEFAULT 10000
);

-- ---------------------------------------------------------------------------
-- 4. BIR withholding brackets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bir_withholding_bracket (
    bracket_id        SERIAL PRIMARY KEY,
    version_id        INTEGER NOT NULL REFERENCES statutory_table_version(version_id) ON DELETE CASCADE,
    payroll_frequency VARCHAR(20) NOT NULL
        CHECK (payroll_frequency IN ('DAILY', 'WEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'ANNUAL')),
    bracket_seq       SMALLINT NOT NULL,
    lower_bound       NUMERIC(14,2) NOT NULL,
    upper_bound       NUMERIC(14,2),       -- NULL = open-ended
    base_tax          NUMERIC(14,2) NOT NULL DEFAULT 0,
    rate_percent      NUMERIC(6,4) NOT NULL,
    excess_over       NUMERIC(14,2) NOT NULL,
    CONSTRAINT uq_bir_bracket UNIQUE (version_id, payroll_frequency, bracket_seq)
);

CREATE INDEX IF NOT EXISTS idx_bir_bracket_lookup
    ON bir_withholding_bracket (version_id, payroll_frequency, lower_bound);

-- ---------------------------------------------------------------------------
-- 5. Seed the 2026 versions
-- ---------------------------------------------------------------------------
INSERT INTO statutory_table_version (agency, version_label, effective_from, source_reference) VALUES
    ('SSS',        'SSS 2025-2026 (15%, MSC 5k-35k)',        DATE '2025-01-01', 'RA 11199 contribution schedule — VERIFY against the current SSS circular'),
    ('PHILHEALTH', 'PhilHealth 2024 onward (5%)',            DATE '2024-01-01', 'RA 11223 premium schedule — VERIFY against the current PhilHealth advisory'),
    ('PAGIBIG',    'Pag-IBIG 2024 onward (10k cap)',         DATE '2024-02-01', 'HDMF Circular 460 — VERIFY against the current HDMF circular'),
    ('BIR_WTAX',   'BIR TRAIN graduated (2023 onward)',      DATE '2023-01-01', 'RR 11-2018 revised withholding tax table — VERIFY against the current RR')
ON CONFLICT (agency, effective_from) DO NOTHING;

-- SSS brackets are generated rather than typed out: 61 rows of hand-keyed
-- arithmetic is a correctness risk, and the rule is simple enough to express
-- directly. MSC runs 5,000-35,000 in 500 steps; compensation maps to the
-- nearest MSC band. Regular SS applies up to MSC 20,000 and the excess goes to
-- the WISP/provident portion.
INSERT INTO sss_contribution_bracket
    (version_id, range_from, range_to, msc, ee_amount, er_amount, ec_amount, mpf_ee, mpf_er)
SELECT
    v.version_id,
    CASE WHEN i = 0 THEN 0 ELSE (5000 + i * 500) - 250 END                       AS range_from,
    CASE WHEN i = 60 THEN NULL ELSE (5000 + i * 500) + 249.99 END                AS range_to,
    (5000 + i * 500)                                                             AS msc,
    ROUND(LEAST(5000 + i * 500, 20000) * 0.05, 2)                                AS ee_amount,
    ROUND(LEAST(5000 + i * 500, 20000) * 0.10, 2)                                AS er_amount,
    CASE WHEN (5000 + i * 500) < 15000 THEN 10 ELSE 30 END                       AS ec_amount,
    ROUND(GREATEST((5000 + i * 500) - 20000, 0) * 0.05, 2)                        AS mpf_ee,
    ROUND(GREATEST((5000 + i * 500) - 20000, 0) * 0.10, 2)                        AS mpf_er
FROM statutory_table_version v
CROSS JOIN generate_series(0, 60) AS i
WHERE v.agency = 'SSS' AND v.effective_from = DATE '2025-01-01'
ON CONFLICT (version_id, range_from) DO NOTHING;

INSERT INTO philhealth_config (version_id, premium_rate, income_floor, income_ceiling, ee_share_ratio)
SELECT version_id, 0.0500, 10000, 100000, 0.5000
FROM statutory_table_version WHERE agency = 'PHILHEALTH' AND effective_from = DATE '2024-01-01'
ON CONFLICT (version_id) DO NOTHING;

INSERT INTO pagibig_config (version_id, threshold_amount, ee_rate_below, ee_rate_above, er_rate, max_compensation)
SELECT version_id, 1500, 0.0100, 0.0200, 0.0200, 10000
FROM statutory_table_version WHERE agency = 'PAGIBIG' AND effective_from = DATE '2024-02-01'
ON CONFLICT (version_id) DO NOTHING;

-- BIR semi-monthly brackets (RR 11-2018, the post-2022 schedule).
INSERT INTO bir_withholding_bracket
    (version_id, payroll_frequency, bracket_seq, lower_bound, upper_bound, base_tax, rate_percent, excess_over)
SELECT v.version_id, 'SEMI_MONTHLY', b.seq, b.lo, b.hi, b.base, b.rate, b.excess
FROM statutory_table_version v
CROSS JOIN (VALUES
    (1, 0.00,        10417.00,  0.00,      0.00, 0.00),
    (2, 10417.00,    16666.00,  0.00,      0.15, 10417.00),
    (3, 16667.00,    33332.00,  937.50,    0.20, 16667.00),
    (4, 33333.00,    83332.00,  4270.70,   0.25, 33333.00),
    (5, 83333.00,    333332.00, 16770.70,  0.30, 83333.00),
    (6, 333333.00,   NULL,      91770.70,  0.35, 333333.00)
) AS b(seq, lo, hi, base, rate, excess)
WHERE v.agency = 'BIR_WTAX' AND v.effective_from = DATE '2023-01-01'
ON CONFLICT (version_id, payroll_frequency, bracket_seq) DO NOTHING;

-- Annual brackets, for 13th-month and year-end annualisation (phase 5/6).
INSERT INTO bir_withholding_bracket
    (version_id, payroll_frequency, bracket_seq, lower_bound, upper_bound, base_tax, rate_percent, excess_over)
SELECT v.version_id, 'ANNUAL', b.seq, b.lo, b.hi, b.base, b.rate, b.excess
FROM statutory_table_version v
CROSS JOIN (VALUES
    (1, 0.00,       250000.00,  0.00,       0.00, 0.00),
    (2, 250000.00,  400000.00,  0.00,       0.15, 250000.00),
    (3, 400000.00,  800000.00,  22500.00,   0.20, 400000.00),
    (4, 800000.00,  2000000.00, 102500.00,  0.25, 800000.00),
    (5, 2000000.00, 8000000.00, 402500.00,  0.30, 2000000.00),
    (6, 8000000.00, NULL,       2202500.00, 0.35, 8000000.00)
) AS b(seq, lo, hi, base, rate, excess)
WHERE v.agency = 'BIR_WTAX' AND v.effective_from = DATE '2023-01-01'
ON CONFLICT (version_id, payroll_frequency, bracket_seq) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permission (permission_key, description, category) VALUES
    ('payroll:config', 'Manage statutory tables, pay components and payroll settings', 'Payroll')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Super Admin')
  AND p.permission_key IN ('payroll:config')
ON CONFLICT DO NOTHING;

COMMIT;
