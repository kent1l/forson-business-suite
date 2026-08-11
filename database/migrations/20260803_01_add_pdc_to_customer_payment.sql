-- Migration: 20260803_01_add_pdc_to_customer_payment.sql
-- Description: Add PDC lifecycle tracking to customer_payment so that a single
--              cheque covering multiple invoices appears as ONE row in the
--              PDC & Clearance Desk, instead of one row per invoice_payment.
--              Also wires cheque_clearance_log to customer_payment.

-- 1. PDC lifecycle on customer_payment
ALTER TABLE customer_payment
    ADD COLUMN IF NOT EXISTS pdc_status VARCHAR(20) DEFAULT 'CLEARED'
        CHECK (pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'CLEARED', 'BOUNCED')),
    ADD COLUMN IF NOT EXISTS cheque_date DATE;

CREATE INDEX IF NOT EXISTS idx_customer_payment_pdc_status
    ON customer_payment(pdc_status)
    WHERE pdc_status != 'CLEARED';

-- 2. Allow cheque_clearance_log to reference customer_payment rows
--    (existing rows reference invoice_payments; both FKs coexist)
ALTER TABLE cheque_clearance_log
    ADD COLUMN IF NOT EXISTS customer_payment_id INTEGER
        REFERENCES customer_payment(payment_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cheque_clearance_log_cp
    ON cheque_clearance_log(customer_payment_id)
    WHERE customer_payment_id IS NOT NULL;
