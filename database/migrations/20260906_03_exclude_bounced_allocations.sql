-- Migration: 20260906_03_exclude_bounced_allocations.sql
-- Description: A bounced cheque's allocation must not count as settlement.
--
-- 20260906_01 consolidated invoice settlement on the rule "allocations count
-- regardless of pdc_status", taken from the comment at paymentRoutes.js step 3.
-- That rule is right for a cheque in hand, deposited, or cleared: the invoice
-- reflects committed payments, and the cash-basis ar_ledger is what waits for
-- clearance. It is wrong for exactly one status.
--
-- pdcService.js failPayment() already knew this. It recomputed each affected
-- invoice from *other* allocations, deliberately excluding the bounced payment,
-- and left the allocation row itself in place as the audit record. Consolidating
-- without carrying that exclusion across would have made a bounced cheque keep
-- its invoice closed.
--
-- Putting the exclusion in the definition rather than in the caller means no
-- future code path has to remember it -- the same reasoning that moved the
-- ar_ledger settlement entry into a database trigger in 20260812_10.
--
-- Note the two-sided lookup: an allocation belongs to a customer_payment, but a
-- cheque taken at the POS is an invoice_payments row instead, and both carry
-- their own pdc_status. Only the customer_payment side can own an allocation,
-- so that is the one joined here; invoice_payments bounces are already handled
-- by the payment_status = 'settled' filter.

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

-- A bounce flips customer_payment.pdc_status, which no trigger watches. Without
-- this the invoice would keep the bounced allocation until something else
-- happened to touch it.
CREATE OR REPLACE FUNCTION public.customer_payment_pdc_recompute()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
    v_invoice_id integer;
BEGIN
    IF OLD.pdc_status IS NOT DISTINCT FROM NEW.pdc_status THEN
        RETURN NEW;
    END IF;

    -- Only a transition into or out of BOUNCED changes what counts as settled.
    IF OLD.pdc_status = 'BOUNCED' OR NEW.pdc_status = 'BOUNCED' THEN
        FOR v_invoice_id IN
            SELECT invoice_id FROM public.invoice_payment_allocation WHERE payment_id = NEW.payment_id
        LOOP
            PERFORM public.recompute_invoice_settlement(v_invoice_id);
        END LOOP;
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_customer_payment_pdc_recompute ON public.customer_payment;
CREATE TRIGGER trg_customer_payment_pdc_recompute
    AFTER UPDATE OF pdc_status ON public.customer_payment
    FOR EACH ROW EXECUTE FUNCTION public.customer_payment_pdc_recompute();

-- Replay once so any invoice already holding a bounced allocation is corrected.
DO $$
DECLARE
    v_invoice_id integer;
BEGIN
    FOR v_invoice_id IN
        SELECT DISTINCT ipa.invoice_id
          FROM public.invoice_payment_allocation ipa
          JOIN public.customer_payment cp ON cp.payment_id = ipa.payment_id
         WHERE cp.pdc_status = 'BOUNCED'
    LOOP
        PERFORM public.recompute_invoice_settlement(v_invoice_id);
    END LOOP;
END $$;

COMMIT;
