-- Migration: 20260812_12_ap_ledger_production_hardening.sql
-- Description: Closes the AP-side gap flagged after the AR hardening pass
-- (20260812_10_ar_ledger_production_hardening.sql): unlike invoice_payments,
-- supplier_bill.amount_paid/status has NEVER had a DB trigger — it is
-- recomputed by hand in apPdcService.js (verifyOutboundPayment,
-- processBouncedOutboundCheque) every time a cheque clears or bounces, in
-- JS, in more than one place. Since ap_ledger already requires the exact same
-- discipline as ar_ledger did (an explicit appendEntry() call alongside every
-- balance-changing UPDATE), this is the same fragile pattern that already
-- caused three AR incidents, just not yet caught here because the AP ledger
-- is brand new (created earlier today, 20260812_04).
--
-- This migration gives supplier_bill a self-healing recompute trigger,
-- structurally identical to invoice's update_invoice_balance_after_payment():
--
--   1. update_supplier_bill_balance_after_payment() recomputes a bill's
--      amount_paid/status from scratch — SUM(ap_payment_allocation.amount_allocated)
--      for allocations whose ap_payment.pdc_status = 'CLEARED' — every time it
--      fires. Idempotent by construction, like the AR equivalent.
--   2. It is attached to BOTH tables that can change a bill's paid amount:
--        - ap_payment_allocation (AFTER INSERT/UPDATE/DELETE) — a new/changed/
--          removed allocation directly changes what's attributed to a bill.
--        - ap_payment (AFTER UPDATE) — a pdc_status transition (e.g. CLEARED
--          or BOUNCED) changes which of a payment's existing allocations count
--          toward the SUM, without touching ap_payment_allocation itself.
--   3. On an ap_payment transition into pdc_status = 'CLEARED', it also posts
--      the matching PAYMENT_SETTLED ap_ledger entry automatically — the AP
--      mirror of the AR safety net — guarded by a new partial unique index
--      making it idempotent alongside the existing explicit appendEntry()
--      call in apPdcService.js verifyOutboundPayment().
--
-- This only changes behavior for records going forward; it does not touch or
-- correct any pre-existing supplier_bill/ap_ledger data.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. Idempotency: at most one PAYMENT_SETTLED entry per ap_payment.
--    (ap_payment.payment_id has no cross-source collision risk like AR's
--    invoice_payments/customer_payment split, so no extra discriminator needed.)
-- ────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_ledger_payment_settled
    ON ap_ledger (payment_id, entry_type)
    WHERE payment_id IS NOT NULL AND entry_type = 'PAYMENT_SETTLED';

-- ────────────────────────────────────────────────────────────────
-- 2. append_ap_ledger_entry(): idempotent short-circuit (advisory lock and
--    FOR UPDATE locking already added in 20260812_10).
-- ────────────────────────────────────────────────────────────────
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
         amount, balance_after, payment_channel, reference_no, notes, created_by)
    VALUES
        (p_supplier_id, p_bill_id, p_payment_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by)
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 3. update_supplier_bill_balance_after_payment(): self-healing recompute +
--    ledger safety net, mirroring update_invoice_balance_after_payment().
--    Shared by triggers on ap_payment_allocation and ap_payment, so any block
--    that reads fields specific to one table is nested inside a
--    TG_TABLE_NAME guard, exactly like the AR version.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_supplier_bill_balance_after_payment() RETURNS trigger AS $$
DECLARE
    v_bill_ids     integer[];
    v_bill_id      integer;
    bill_total     numeric(12,2);
    total_settled  numeric(12,2);
    v_method_code  varchar(50);
BEGIN
    IF TG_TABLE_NAME = 'ap_payment_allocation' THEN
        v_bill_ids := ARRAY[COALESCE(NEW.bill_id, OLD.bill_id)];
    ELSIF TG_TABLE_NAME = 'ap_payment' THEN
        SELECT COALESCE(array_agg(DISTINCT bill_id), ARRAY[]::integer[]) INTO v_bill_ids
        FROM ap_payment_allocation
        WHERE payment_id = COALESCE(NEW.payment_id, OLD.payment_id);
    END IF;

    IF v_bill_ids IS NOT NULL THEN
        FOREACH v_bill_id IN ARRAY v_bill_ids LOOP
            SELECT total_amount INTO bill_total FROM supplier_bill WHERE bill_id = v_bill_id;
            IF bill_total IS NULL THEN
                CONTINUE;
            END IF;

            -- Only allocations belonging to a CLEARED payment count as settled;
            -- ISSUED/BOUNCED/etc. leave the bill's liability outstanding.
            SELECT COALESCE(SUM(apa.amount_allocated), 0) INTO total_settled
              FROM ap_payment_allocation apa
              JOIN ap_payment ap ON ap.payment_id = apa.payment_id
             WHERE apa.bill_id = v_bill_id AND ap.pdc_status = 'CLEARED';

            UPDATE supplier_bill
            SET amount_paid = total_settled,
                status = CASE
                    WHEN total_settled >= bill_total THEN 'Paid'
                    WHEN total_settled > 0             THEN 'Partially Paid'
                    ELSE 'Unpaid'
                END
            WHERE bill_id = v_bill_id;
        END LOOP;
    END IF;

    -- Ledger safety net: guarantee a PAYMENT_SETTLED ap_ledger entry exists
    -- whenever an ap_payment row transitions into pdc_status = 'CLEARED', no
    -- matter which application code path caused it. Idempotent (see function
    -- above), so this is a harmless no-op when the caller already wrote it.
    IF TG_TABLE_NAME = 'ap_payment' THEN
        IF TG_OP = 'UPDATE'
           AND NEW.pdc_status = 'CLEARED'
           AND OLD.pdc_status IS DISTINCT FROM 'CLEARED' THEN

            SELECT code INTO v_method_code FROM payment_methods WHERE method_id = NEW.method_id;

            PERFORM append_ap_ledger_entry(
                NEW.supplier_id, NULL, NEW.payment_id,
                'PAYMENT_SETTLED'::ap_ledger_entry_type, -NEW.amount,
                COALESCE(v_method_code, 'cheque'), NEW.reference_number,
                'Auto-recorded by supplier bill balance trigger (ledger safety net)',
                NEW.created_by
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ap_payment_allocation_update_balance_insert ON public.ap_payment_allocation;
CREATE TRIGGER ap_payment_allocation_update_balance_insert
    AFTER INSERT ON public.ap_payment_allocation
    FOR EACH ROW EXECUTE FUNCTION update_supplier_bill_balance_after_payment();

DROP TRIGGER IF EXISTS ap_payment_allocation_update_balance_update ON public.ap_payment_allocation;
CREATE TRIGGER ap_payment_allocation_update_balance_update
    AFTER UPDATE ON public.ap_payment_allocation
    FOR EACH ROW EXECUTE FUNCTION update_supplier_bill_balance_after_payment();

DROP TRIGGER IF EXISTS ap_payment_allocation_update_balance_delete ON public.ap_payment_allocation;
CREATE TRIGGER ap_payment_allocation_update_balance_delete
    AFTER DELETE ON public.ap_payment_allocation
    FOR EACH ROW EXECUTE FUNCTION update_supplier_bill_balance_after_payment();

DROP TRIGGER IF EXISTS ap_payment_update_balance_update ON public.ap_payment;
CREATE TRIGGER ap_payment_update_balance_update
    AFTER UPDATE ON public.ap_payment
    FOR EACH ROW EXECUTE FUNCTION update_supplier_bill_balance_after_payment();

COMMIT;
