-- Migration: 20260812_01_create_bank_account.sql
-- Description: Business's own bank accounts (as opposed to customer/supplier banking
--              details). Foundation for multi-account cheque issuance and treasury
--              cash-flow reporting.

BEGIN;

CREATE TABLE IF NOT EXISTS bank_account (
    bank_account_id serial          PRIMARY KEY,
    account_name    varchar(100)    NOT NULL,
    bank_name       varchar(100)    NOT NULL,
    account_number  varchar(50),
    currency        varchar(10)     NOT NULL DEFAULT 'PHP',
    opening_balance numeric(14,2)   NOT NULL DEFAULT 0,
    is_active       boolean         NOT NULL DEFAULT true,
    notes           text,
    created_by      integer         REFERENCES employee(employee_id),
    created_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_account_active ON bank_account(is_active);

-- Link cheque print templates to a real bank account instead of only a free-text bank name.
ALTER TABLE cheque_templates
    ADD COLUMN IF NOT EXISTS bank_account_id integer REFERENCES bank_account(bank_account_id);

COMMIT;
