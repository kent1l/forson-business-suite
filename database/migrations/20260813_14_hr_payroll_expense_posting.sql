-- Migration: 20260813_14_hr_payroll_expense_posting.sql
-- Description: HR phase 4, part 3 — wires payroll into the expense module via
--              the `expense.payroll_run_id` column that has been reserved and
--              unused since the expense module was built.
--
-- POSTING SHAPE: two expense rows per run, not one per employee.
--   `expense.payee` is free text with a LOWER(payee) index feeding the expense
--   AI lexicon and the payee typeahead. Thirty per-employee rows per cutoff
--   would spray variants through that lexicon and make the expense list
--   unusable as a cash-flow view — while adding nothing, since the payslip is
--   already the per-employee record of truth.
--
-- WHAT IS EXPENSED: gross pay plus the employer share.
--   Employee statutory deductions are withheld liabilities the company remits
--   later, not company expense. Expensing gross + employer share means the
--   expense module reflects true employer cost. The remittance itself must NOT
--   be expensed again — double-counting there is the single most likely user
--   error, so the posted rows say so in their notes.

BEGIN;

-- A dedicated category for the employer share, so it does not distort the
-- "Salaries & Wages" figure people read as take-home cost.
INSERT INTO expense_category (category_name, description, sort_order)
VALUES ('Employer Statutory Contributions',
        'Employer share of SSS, PhilHealth and Pag-IBIG from payroll runs', 11)
ON CONFLICT (category_name) DO NOTHING;

-- Now that payroll_run exists, the reserved column can become a real FK.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_expense_payroll_run') THEN
        ALTER TABLE expense ADD CONSTRAINT fk_expense_payroll_run
            FOREIGN KEY (payroll_run_id) REFERENCES payroll_run(run_id);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_expense_payroll_run
    ON expense (payroll_run_id) WHERE payroll_run_id IS NOT NULL;

-- Idempotency guarantee: a double-clicked "Post" cannot create duplicate rows.
-- Voided rows drop out of the index, so re-posting after a void still works.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_payroll_posting
    ON expense (payroll_run_id, category_id)
    WHERE payroll_run_id IS NOT NULL AND is_void = false;

-- Which categories payroll posts into. Stored as settings so a company that
-- renames or reorganises its categories does not need a code change.
INSERT INTO settings (setting_key, setting_value, description)
SELECT 'PAYROLL_EXPENSE_CATEGORY_SALARIES',
       (SELECT category_id::text FROM expense_category WHERE category_name = 'Salaries & Wages'),
       'Expense category that payroll gross pay posts into'
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO settings (setting_key, setting_value, description)
SELECT 'PAYROLL_EXPENSE_CATEGORY_EMPLOYER',
       (SELECT category_id::text FROM expense_category WHERE category_name = 'Employer Statutory Contributions'),
       'Expense category that the employer statutory share posts into'
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('PAYROLL_DEFAULT_PAYMENT_METHOD', 'Cash', 'Payment method recorded on payroll expense postings')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
