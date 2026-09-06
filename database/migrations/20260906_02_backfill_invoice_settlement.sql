-- Migration: 20260906_02_backfill_invoice_settlement.sql
-- Description: Bring every existing invoice into line with the single settlement
--              definition introduced by 20260906_01.
--
-- 20260906_01 only changed how future writes are computed. Invoices settled
-- through both payment paths before it are still carrying whichever figure
-- happened to be written last, so this replays the definition over the whole
-- table once.
--
-- On the development database this moved 10 of 6,067 invoices, all accounted for:
--
--   * 4 invoices marked 'Written Off' at the A/R cutover had amount_paid = 0
--     while holding real invoice_payment_allocation rows. The cutover script
--     said it was leaving amount_paid alone, and it did -- the old trigger had
--     already zeroed them, because it only ever counted invoice_payments. Their
--     true collected amount is restored; the 'Written Off' status is terminal
--     and is not disturbed.
--   * 5 INV-TEST-* fixtures had amount_paid written directly with no payment
--     rows behind it. They correctly fall to 0 / 'Unpaid'.
--   * 1 invoice settled through both paths (300.00 of POS tender, 400.00 of A/R
--     receipt) reported 300.00 and now reports 700.00.
--
-- Idempotent: recompute_invoice_settlement() derives everything from source
-- rows, so re-running this is a no-op.

BEGIN;

DO $$
DECLARE
    v_invoice_id integer;
    v_count      integer := 0;
BEGIN
    FOR v_invoice_id IN SELECT invoice_id FROM public.invoice ORDER BY invoice_id LOOP
        PERFORM public.recompute_invoice_settlement(v_invoice_id);
        v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'recompute_invoice_settlement replayed over % invoices', v_count;
END $$;

COMMIT;
