-- Migration: 20260812_05_extend_cheque_clearance_log_and_supplier_hold.sql
-- Description: Wire cheque_clearance_log up to ap_payment and bank_account, add
--              VOID/REPLACED as loggable actions (a skipped cheque number must
--              always show up here rather than as a silent gap), and add a
--              payment-hold flag to supplier — the outbound-side equivalent of
--              customer.credit_hold, advisory for now since there is no "new
--              purchase" enforcement point yet in AP.

BEGIN;

ALTER TABLE cheque_clearance_log
    ADD COLUMN IF NOT EXISTS ap_payment_id  integer REFERENCES ap_payment(payment_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS bank_account_id integer REFERENCES bank_account(bank_account_id);

CREATE INDEX IF NOT EXISTS idx_cheque_clearance_log_ap_payment
    ON cheque_clearance_log(ap_payment_id)
    WHERE ap_payment_id IS NOT NULL;

ALTER TABLE cheque_clearance_log DROP CONSTRAINT IF EXISTS cheque_clearance_log_action_check;
ALTER TABLE cheque_clearance_log ADD CONSTRAINT cheque_clearance_log_action_check
    CHECK (action IN ('RECEIVED', 'DEPOSITED', 'BOUNCED', 'REDEPOSITED', 'CLEARED', 'VOID', 'REPLACED'));

ALTER TABLE supplier
    ADD COLUMN IF NOT EXISTS payment_hold boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS payment_hold_reason text;

COMMIT;
