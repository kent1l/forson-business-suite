-- Migration: 20260812_03_generalize_cheque_records.sql
-- Description: Turn cheque_records from a print-only record into the real outbound
--              cheque register — bank account, physical cheque number, lifecycle
--              status, purpose (not every outbound cheque is a supplier payment —
--              loans, rent, and other disbursements also apply), and a void/replace
--              chain so spoiled or failed cheques stay fully auditable instead of
--              leaving unexplained gaps in the cheque-number sequence.

BEGIN;

ALTER TABLE cheque_records
    ADD COLUMN IF NOT EXISTS bank_account_id      integer REFERENCES bank_account(bank_account_id),
    ADD COLUMN IF NOT EXISTS cheque_number         varchar(30),
    ADD COLUMN IF NOT EXISTS status                varchar(20) NOT NULL DEFAULT 'ISSUED'
        CHECK (status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'VOID', 'STALE', 'REPLACED')),
    ADD COLUMN IF NOT EXISTS purpose_type          varchar(20) NOT NULL DEFAULT 'SUPPLIER_PAYMENT'
        CHECK (purpose_type IN ('SUPPLIER_PAYMENT', 'LOAN_PAYMENT', 'RENT', 'OTHER_EXPENSE')),
    ADD COLUMN IF NOT EXISTS ap_payment_id         integer REFERENCES ap_payment(payment_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS expense_id            bigint REFERENCES expense(expense_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS replaces_cheque_id    integer REFERENCES cheque_records(id),
    ADD COLUMN IF NOT EXISTS replaced_by_cheque_id integer REFERENCES cheque_records(id),
    ADD COLUMN IF NOT EXISTS is_void               boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS voided_by             integer REFERENCES employee(employee_id),
    ADD COLUMN IF NOT EXISTS voided_at             timestamptz,
    ADD COLUMN IF NOT EXISTS void_reason           text;

-- A physical cheque number can never be recorded twice against the same bank
-- account, voided or not — a voided number stays permanently retired.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cheque_records_bank_number
    ON cheque_records(bank_account_id, cheque_number)
    WHERE cheque_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cheque_records_status ON cheque_records(status);
CREATE INDEX IF NOT EXISTS idx_cheque_records_purpose ON cheque_records(purpose_type);
CREATE INDEX IF NOT EXISTS idx_cheque_records_bank_account ON cheque_records(bank_account_id);

COMMIT;
