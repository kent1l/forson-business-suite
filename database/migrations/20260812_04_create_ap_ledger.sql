-- Migration: 20260812_04_create_ap_ledger.sql
-- Description: Immutable event-driven Accounts Payable ledger, structural mirror of
--              ar_ledger (20260802_03_create_ar_ledger.sql). Sign convention:
--              positive = liability increases (we owe more), negative = liability
--              decreases (we paid it down).

BEGIN;

DO $$ BEGIN
  CREATE TYPE ap_ledger_entry_type AS ENUM (
    'BILL_POSTED',
    'PAYMENT_SETTLED',
    'PDC_BOUNCED_REVERSAL',
    'BOUNCE_FEE_PENALTY',
    'DEBIT_ADJUSTMENT',
    'CREDIT_ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ap_ledger (
    ledger_id       bigserial               PRIMARY KEY,
    supplier_id     integer                 NOT NULL REFERENCES supplier(supplier_id),
    bill_id         integer                 REFERENCES supplier_bill(bill_id),
    payment_id      integer                 REFERENCES ap_payment(payment_id),
    entry_type      ap_ledger_entry_type    NOT NULL,
    amount          numeric(12,2)           NOT NULL,
    balance_after   numeric(12,2)           NOT NULL,
    payment_channel varchar(50),
    reference_no    varchar(100),
    notes           text,
    created_at      timestamptz             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      integer                 REFERENCES employee(employee_id)
);

CREATE INDEX IF NOT EXISTS idx_ap_ledger_supplier ON ap_ledger(supplier_id, ledger_id DESC);
CREATE INDEX IF NOT EXISTS idx_ap_ledger_bill    ON ap_ledger(bill_id)    WHERE bill_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ap_ledger_payment ON ap_ledger(payment_id) WHERE payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ap_ledger_immutability_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ap_ledger rows are immutable — UPDATE/DELETE not permitted';
END;
$$;

DROP TRIGGER IF EXISTS trg_ap_ledger_immutable ON ap_ledger;
CREATE TRIGGER trg_ap_ledger_immutable
    BEFORE UPDATE OR DELETE ON ap_ledger
    FOR EACH ROW EXECUTE FUNCTION ap_ledger_immutability_guard();

CREATE OR REPLACE FUNCTION append_ap_ledger_entry(
    p_supplier_id     integer,
    p_bill_id         integer,
    p_payment_id      integer,
    p_entry_type      ap_ledger_entry_type,
    p_amount          numeric(12,2),
    p_payment_channel varchar(50),
    p_reference_no    varchar(100),
    p_notes           text,
    p_created_by      integer
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    SELECT balance_after INTO v_prev_balance
      FROM ap_ledger
     WHERE supplier_id = p_supplier_id
     ORDER BY ledger_id DESC
     LIMIT 1
       FOR UPDATE;

    v_prev_balance := COALESCE(v_prev_balance, 0);

    INSERT INTO ap_ledger
        (supplier_id, bill_id, payment_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by)
    VALUES
        (p_supplier_id, p_bill_id, p_payment_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by)
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

CREATE OR REPLACE VIEW vw_supplier_ap_balance AS
SELECT
    supplier_id,
    COALESCE(SUM(amount), 0)  AS ledger_balance,
    COUNT(*)                   AS entry_count,
    MAX(created_at)            AS last_activity_at
FROM ap_ledger
GROUP BY supplier_id;

COMMIT;
