BEGIN;

-- 1. Table: expense_category
CREATE TABLE IF NOT EXISTS expense_category (
    category_id     SERIAL PRIMARY KEY,
    category_name   VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      INTEGER REFERENCES employee(employee_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by     INTEGER REFERENCES employee(employee_id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_category_name_lower
    ON expense_category (LOWER(category_name));

CREATE INDEX IF NOT EXISTS idx_expense_category_sort
    ON expense_category (is_active, sort_order, category_name);

-- 2. Table: expense
CREATE TABLE IF NOT EXISTS expense (
    expense_id          BIGSERIAL PRIMARY KEY,
    expense_date        DATE NOT NULL,
    category_id         INTEGER NOT NULL REFERENCES expense_category(category_id),
    amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payee               VARCHAR(200),
    payment_method_id   INTEGER REFERENCES payment_methods(method_id),
    payment_method_text VARCHAR(50) NOT NULL DEFAULT 'Cash',
    reference_no        VARCHAR(100),
    notes               TEXT,
    is_void             BOOLEAN NOT NULL DEFAULT false,
    voided_by           INTEGER REFERENCES employee(employee_id),
    voided_at           TIMESTAMPTZ,
    void_reason         TEXT,
    created_by          INTEGER NOT NULL REFERENCES employee(employee_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by         INTEGER REFERENCES employee(employee_id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    payroll_run_id      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_expense_date ON expense (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expense_category ON expense (category_id);
CREATE INDEX IF NOT EXISTS idx_expense_payment_method ON expense (payment_method_id);
CREATE INDEX IF NOT EXISTS idx_expense_payee ON expense (LOWER(payee));
CREATE INDEX IF NOT EXISTS idx_expense_void ON expense (is_void);
CREATE INDEX IF NOT EXISTS idx_expense_created_by ON expense (created_by);

-- 3. Table: expense_ai_correction
CREATE TABLE IF NOT EXISTS expense_ai_correction (
    correction_id       BIGSERIAL PRIMARY KEY,
    expense_id          BIGINT NOT NULL REFERENCES expense(expense_id),
    field_name          VARCHAR(50) NOT NULL,
    ai_suggestion       TEXT,
    user_correction     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_ai_correction_expense
    ON expense_ai_correction (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_ai_correction_field
    ON expense_ai_correction (field_name);

-- 4. Seed default categories
INSERT INTO expense_category (category_name, description, sort_order, created_by)
VALUES
    ('Rent',                       'Store and warehouse rental',                    1,  NULL),
    ('Utilities',                  'Electricity, water, internet, phone',          2,  NULL),
    ('Salaries & Wages',           'Regular pay, overtime, holiday pay, 13th month', 3, NULL),
    ('Transportation & Delivery',  'Freight, courier, fuel for delivery vehicle',  4,  NULL),
    ('Repairs & Maintenance',      'Store fixtures, equipment, vehicle maintenance', 5, NULL),
    ('Office Supplies',            'Paper, printer ink, miscellaneous supplies',   6,  NULL),
    ('Permits, Licenses & Taxes',  'Business permit, BIR filings, local taxes',    7,  NULL),
    ('Bank Charges & Fees',        'Bank fees, transaction charges, withdrawal fees', 8, NULL),
    ('Marketing & Advertising',    'Signage, flyers, online ads',                   9,  NULL),
    ('Professional Fees',          'Accountant, lawyer, consultant',              10,  NULL),
    ('Insurance',                  'Store, vehicle, inventory insurance',          11,  NULL),
    ('Miscellaneous',              'One-off expenses that do not fit other categories', 99, NULL)
ON CONFLICT DO NOTHING;

-- 5. Seed permissions
INSERT INTO permission (permission_key, description, category) VALUES
    ('expenses:view',              'View expense records',             'Finance'),
    ('expenses:create',            'Create expense records',           'Finance'),
    ('expenses:edit',              'Edit expense records',             'Finance'),
    ('expenses:void',              'Void expense records',             'Finance'),
    ('expenses:manage_categories', 'Manage expense categories',       'Finance')
ON CONFLICT (permission_key) DO NOTHING;

-- Assign permissions to Admin (10)
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT 10, permission_id FROM permission WHERE permission_key IN (
    'expenses:view', 'expenses:create', 'expenses:edit', 'expenses:void', 'expenses:manage_categories'
)
ON CONFLICT DO NOTHING;

-- Assign permissions to Manager (7)
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT 7, permission_id FROM permission WHERE permission_key IN (
    'expenses:view', 'expenses:create', 'expenses:edit', 'expenses:void'
)
ON CONFLICT DO NOTHING;

-- Assign permissions to Secretary (5)
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT 5, permission_id FROM permission WHERE permission_key IN (
    'expenses:view', 'expenses:create'
)
ON CONFLICT DO NOTHING;

COMMIT;
