-- Migration: 20260817_02_fix_append_ap_ledger_entry_idempotency.sql
-- Description: append_ap_ledger_entry() lost its PAYMENT_SETTLED dedup guard
--              when it was redefined by 20260816_01_add_entry_date_to_ledgers.sql
--              to add the p_entry_date parameter — its AR sibling,
--              append_ar_ledger_entry(), kept the equivalent guard in the same
--              migration, but the AP version did not. Without it, clearing an
--              outbound cheque tied to a supplier bill hits this exact
--              sequence every time: UPDATE ap_payment SET pdc_status='CLEARED'
--              fires trigger ap_payment_update_balance_update (from
--              20260812_12_ap_ledger_production_hardening.sql), which calls
--              append_ap_ledger_entry() to post a PAYMENT_SETTLED row; then
--              apPdcService.js's verifyOutboundPayment() makes its own
--              explicit call to the same function for the same payment_id —
--              which, lacking the dedup short-circuit, tries to insert a
--              second PAYMENT_SETTLED row and collides with the partial
--              unique index uq_ap_ledger_payment_settled(payment_id,
--              entry_type). This restores the missing guard so the second
--              call is a no-op read instead of a duplicate insert.

BEGIN;

CREATE OR REPLACE FUNCTION append_ap_ledger_entry(
    p_supplier_id     integer,
    p_bill_id         integer,
    p_payment_id      integer,
    p_entry_type      ap_ledger_entry_type,
    p_amount          numeric(12,2),
    p_payment_channel varchar(50),
    p_reference_no    varchar(100),
    p_notes           text,
    p_created_by      integer,
    p_entry_date      timestamptz DEFAULT CURRENT_TIMESTAMP
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('ap_ledger:' || p_supplier_id::text));

    IF p_payment_id IS NOT NULL AND p_entry_type = 'PAYMENT_SETTLED' THEN
        SELECT ledger_id INTO v_ledger_id
          FROM ap_ledger
         WHERE payment_id = p_payment_id
           AND entry_type = 'PAYMENT_SETTLED';
        IF FOUND THEN
            RETURN v_ledger_id;
        END IF;
    END IF;

    SELECT balance_after INTO v_prev_balance
      FROM ap_ledger
     WHERE supplier_id = p_supplier_id
     ORDER BY ledger_id DESC
     LIMIT 1
       FOR UPDATE;

    v_prev_balance := COALESCE(v_prev_balance, 0);

    INSERT INTO ap_ledger
        (supplier_id, bill_id, payment_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by,
         entry_date)
    VALUES
        (p_supplier_id, p_bill_id, p_payment_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by,
         COALESCE(p_entry_date, CURRENT_TIMESTAMP))
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

COMMIT;
