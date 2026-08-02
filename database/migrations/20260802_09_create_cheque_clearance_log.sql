-- Migration: 20260802_09_create_cheque_clearance_log.sql
-- Description: Create unified cheque_clearance_log table for tracking cheque lifecycle, bounce history, and re-deposit attempts across AR and AP.

CREATE TABLE IF NOT EXISTS cheque_clearance_log (
    log_id          bigserial       PRIMARY KEY,
    cheque_type     varchar(30)     NOT NULL DEFAULT 'INBOUND_CUSTOMER' CHECK (cheque_type IN ('INBOUND_CUSTOMER', 'OUTBOUND_SUPPLIER')),
    payment_id      integer         REFERENCES invoice_payments(payment_id) ON DELETE SET NULL,
    cheque_record_id integer        REFERENCES cheque_records(id) ON DELETE SET NULL,
    customer_id     integer         REFERENCES customer(customer_id) ON DELETE SET NULL,
    supplier_id     integer         REFERENCES supplier(supplier_id) ON DELETE SET NULL,
    action          varchar(30)     NOT NULL CHECK (action IN ('RECEIVED', 'DEPOSITED', 'BOUNCED', 'REDEPOSITED', 'CLEARED')),
    attempt_number  integer         NOT NULL DEFAULT 1,
    bounce_reason   text,
    bounce_fee      numeric(12,2)   DEFAULT 0.00,
    notes           text,
    created_at      timestamptz     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      integer
);

CREATE INDEX IF NOT EXISTS idx_cheque_clearance_log_payment ON cheque_clearance_log(payment_id);
CREATE INDEX IF NOT EXISTS idx_cheque_clearance_log_customer ON cheque_clearance_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_cheque_clearance_log_supplier ON cheque_clearance_log(supplier_id);
