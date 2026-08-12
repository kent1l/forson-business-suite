-- Migration: 20260812_02_create_supplier_bill_and_ap_payment.sql
-- Description: Minimal Accounts Payable core — header-only supplier bills and a
--              supplier payment table mirroring customer_payment's PDC lifecycle,
--              needed before outbound PDC logic can attach to anything real.

BEGIN;

-- 1. supplier_bill (header-only; line-item detail is out of scope for PDC/ledger needs)
CREATE TABLE IF NOT EXISTS supplier_bill (
    bill_id         serial          PRIMARY KEY,
    supplier_id     integer         NOT NULL REFERENCES supplier(supplier_id),
    po_id           integer         REFERENCES purchase_order(po_id),
    grn_id          integer         REFERENCES goods_receipt(grn_id),
    bill_number     varchar(50)     UNIQUE,
    bill_date       date            NOT NULL DEFAULT CURRENT_DATE,
    due_date        date,
    total_amount    numeric(12,2)   NOT NULL,
    amount_paid     numeric(12,2)   NOT NULL DEFAULT 0,
    status          varchar(20)     NOT NULL DEFAULT 'Unpaid'
                        CHECK (status IN ('Unpaid', 'Partially Paid', 'Paid')),
    notes           text,
    created_by      integer         REFERENCES employee(employee_id),
    created_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_bill_supplier ON supplier_bill(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_status ON supplier_bill(status) WHERE status != 'Paid';

-- 2. ap_payment — one row per physical payment instrument issued to a supplier,
--    mirroring customer_payment's pdc_status lifecycle but with outbound-flavored labels.
CREATE TABLE IF NOT EXISTS ap_payment (
    payment_id       serial          PRIMARY KEY,
    supplier_id      integer         NOT NULL REFERENCES supplier(supplier_id),
    employee_id      integer         REFERENCES employee(employee_id),
    payment_date     timestamptz     NOT NULL DEFAULT now(),
    amount           numeric(12,2)   NOT NULL,
    method_id        integer         REFERENCES payment_methods(method_id),
    reference_number varchar(100),
    notes            text,
    pdc_status       varchar(20)     NOT NULL DEFAULT 'CLEARED'
                        CHECK (pdc_status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'REPLACED')),
    cheque_date      date,
    bank_account_id  integer         REFERENCES bank_account(bank_account_id),
    cheque_record_id integer         REFERENCES cheque_records(id) ON DELETE SET NULL,
    created_by       integer         REFERENCES employee(employee_id),
    created_at       timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ap_payment_supplier ON ap_payment(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ap_payment_pdc_status ON ap_payment(pdc_status) WHERE pdc_status != 'CLEARED';

-- 3. ap_payment_allocation — mirrors invoice_payment_allocation
CREATE TABLE IF NOT EXISTS ap_payment_allocation (
    allocation_id    serial          PRIMARY KEY,
    payment_id       integer         NOT NULL REFERENCES ap_payment(payment_id) ON DELETE CASCADE,
    bill_id          integer         NOT NULL REFERENCES supplier_bill(bill_id),
    amount_allocated numeric(12,2)   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ap_payment_allocation_payment ON ap_payment_allocation(payment_id);
CREATE INDEX IF NOT EXISTS idx_ap_payment_allocation_bill ON ap_payment_allocation(bill_id);

COMMIT;
