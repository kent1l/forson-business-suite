-- Migration: 20260906_07_reversal_allocations_not_settlement.sql
-- Description: A reversal's allocations document what was reopened; they do not
--              settle anything.
--
-- 20260906_05 counted every POSTED adjustment's allocations as settlement. A
-- reversal is itself a POSTED adjustment carrying mirrored allocations for the
-- same invoices and the same amounts -- so reversing a concession removed the
-- original from the sum and added the reversal back in its place, and the
-- invoice stayed closed. The customer balance moved (the ledger got its
-- ADJUSTMENT_REVERSAL entry) while the invoice did not, which is the precise
-- split-brain this whole consolidation exists to end.
--
-- The reversal keeps its allocations: they are what lets a statement or an audit
-- say which invoices a reversal reopened, and they satisfy the "every peso lands
-- on a named invoice" constraint. They simply are not settlement. What reopens
-- the balance is the original flipping to REVERSED and dropping out of the sum.
--
-- Hence: count POSTED adjustments that are not reversals.

BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_invoice_settlement(p_invoice_id integer)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
    v_total     numeric(12,2);
    v_status    varchar(20);
    v_settled   numeric(12,2);
    v_refunded  numeric(12,2);
    v_net       numeric(12,2);
BEGIN
    SELECT total_amount, status
      INTO v_total, v_status
      FROM public.invoice
     WHERE invoice_id = p_invoice_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT COALESCE((SELECT SUM(amount_paid)
                       FROM public.invoice_payments
                      WHERE invoice_id = p_invoice_id
                        AND payment_status = 'settled'), 0)
         + COALESCE((SELECT SUM(ipa.amount_allocated)
                       FROM public.invoice_payment_allocation ipa
                       JOIN public.customer_payment cp ON cp.payment_id = ipa.payment_id
                      WHERE ipa.invoice_id = p_invoice_id
                        AND cp.pdc_status IS DISTINCT FROM 'BOUNCED'), 0)
         + COALESCE((SELECT SUM(aa.amount)
                       FROM public.ar_adjustment_allocation aa
                       JOIN public.ar_adjustment adj ON adj.adjustment_id = aa.adjustment_id
                      WHERE aa.invoice_id = p_invoice_id
                        AND adj.status = 'POSTED'
                        AND adj.reverses_adjustment_id IS NULL), 0)
      INTO v_settled;

    SELECT COALESCE(SUM(total_amount), 0)
      INTO v_refunded
      FROM public.credit_note
     WHERE invoice_id = p_invoice_id;

    v_net := GREATEST(v_total - v_refunded, 0);

    UPDATE public.invoice
       SET amount_paid = v_settled,
           status = CASE
               WHEN v_status IN ('Cancelled', 'Written Off')  THEN v_status
               WHEN v_refunded >= v_total                     THEN 'Fully Refunded'
               WHEN v_net > 0 AND v_settled >= v_net          THEN 'Paid'
               WHEN v_settled > 0                             THEN 'Partially Paid'
               ELSE 'Unpaid'
           END
     WHERE invoice_id = p_invoice_id;
END;
$fn$;

COMMIT;
