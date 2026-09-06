-- Migration: 20260906_01_recompute_invoice_settlement.sql
-- Description: One definition of "how much has this invoice been settled for".
--
-- invoice.amount_paid and invoice.status were being computed in four places, and
-- two of them disagreed about the denominator:
--
--   1. update_invoice_balance_after_payment()  -> SUM(invoice_payments settled)
--   2. invoiceRoutes.js POST /invoices         -> the tenders posted at creation
--   3. paymentRoutes.js POST /payments         -> SUM(invoice_payment_allocation)
--   4. pdcService.js bounce path               -> SUM(invoice_payment_allocation)
--
-- Those two denominators are not competing views of the same thing. A POS tender
-- lands in invoice_payments; an A/R collection lands in customer_payment plus
-- invoice_payment_allocation. Both are real, and neither computation counts the
-- other, so an invoice settled through both paths has one of them silently
-- erased -- whichever wrote last wins, and the next write flips it back.
--
-- Confirmed live before this migration was written: INV-TXNDATE-FIXTURE holds
-- 300.00 in settled invoice_payments and 400.00 in allocations, and reports
-- amount_paid = 300.00. The 400.00 A/R receipt is invisible on the invoice.
--
-- This replaces all four with recompute_invoice_settlement(), which adds the two
-- paths together instead of picking one. Behaviour is otherwise deliberately
-- unchanged -- this is a consolidation, not a policy change:
--
--   * Allocations still count regardless of pdc_status. The invoice reflects
--     committed payments; the cash-basis ar_ledger is what waits for a cheque to
--     clear (see the comment at paymentRoutes.js step 4).
--   * invoice_payments still count only at payment_status = 'settled'.
--   * 'Partially Refunded' stays retired -- 20260802_01_fix_ar_trigger_status.sql
--     removed it because A/R queries filter status IN ('Unpaid','Partially Paid')
--     and it hid invoices from the aging report.
--
-- One behaviour IS added, and it is a fix: 'Cancelled' and 'Written Off' are now
-- terminal. The old trigger recomputed status unconditionally, so touching any
-- payment row on one of the 301 invoices marked 'Written Off' at the A/R cutover
-- (docs/temp/once_ar_cleanup_preserve_sales.sql, applied outside the migration
-- history) would revive it into the aging report as Unpaid.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 0. Bring check_invoice_status into the tracked schema.
--    'Written Off' was added inline by the cutover script, so it exists in the
--    live database but in no migration -- a database rebuilt from migrations
--    alone would reject the 301 rows that carry it, and reject this function's
--    output. Stated here so the two can no longer disagree.
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS check_invoice_status;
ALTER TABLE public.invoice ADD CONSTRAINT check_invoice_status
    CHECK (status IN (
        'Unpaid',
        'Paid',
        'Partially Paid',
        'Partially Refunded',
        'Fully Refunded',
        'Cancelled',
        'Written Off'
    ));

-- ────────────────────────────────────────────────────────────────
-- 1. The single definition.
--    Safe to call more than once for the same invoice in one transaction:
--    it derives everything from scratch and holds no state.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_invoice_settlement(p_invoice_id integer)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
    v_total     numeric(12,2);
    v_status    varchar(20);
    v_settled   numeric(12,2);
    v_refunded  numeric(12,2);
    v_net       numeric(12,2);
BEGIN
    -- Serialize concurrent settlement of the same invoice (two collectors, or a
    -- POS tender racing an A/R receipt).
    SELECT total_amount, status
      INTO v_total, v_status
      FROM public.invoice
     WHERE invoice_id = p_invoice_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- The two settlement paths, added rather than chosen between.
    SELECT COALESCE((SELECT SUM(amount_paid)
                       FROM public.invoice_payments
                      WHERE invoice_id = p_invoice_id
                        AND payment_status = 'settled'), 0)
         + COALESCE((SELECT SUM(amount_allocated)
                       FROM public.invoice_payment_allocation
                      WHERE invoice_id = p_invoice_id), 0)
      INTO v_settled;

    SELECT COALESCE(SUM(total_amount), 0)
      INTO v_refunded
      FROM public.credit_note
     WHERE invoice_id = p_invoice_id;

    v_net := GREATEST(v_total - v_refunded, 0);

    UPDATE public.invoice
       SET amount_paid = v_settled,
           status = CASE
               -- Terminal. A cancelled or written-off invoice is a decision that
               -- was made about it, not a function of what has been collected.
               WHEN v_status IN ('Cancelled', 'Written Off')  THEN v_status
               WHEN v_refunded >= v_total                     THEN 'Fully Refunded'
               WHEN v_net > 0 AND v_settled >= v_net          THEN 'Paid'
               WHEN v_settled > 0                             THEN 'Partially Paid'
               ELSE 'Unpaid'
           END
     WHERE invoice_id = p_invoice_id;
END;
$fn$;

COMMENT ON FUNCTION public.recompute_invoice_settlement(integer) IS
    'The only definition of invoice.amount_paid and invoice.status. Sums both settlement paths (settled invoice_payments + invoice_payment_allocation) net of credit notes. Call it instead of writing either column directly.';

-- ────────────────────────────────────────────────────────────────
-- 2. The existing invoice_payments / credit_note trigger delegates to it.
--    The ledger safety net below is carried over verbatim from
--    20260902_04_withholding_ledger_entry_type.sql -- it is what guarantees a
--    settled payment always has its ar_ledger entry no matter which code path
--    created it, and must not be lost in this refactor.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_invoice_balance_after_payment()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
    v_invoice_id  integer;
    v_customer_id integer;
    v_method_code varchar(50);
    v_entry_type  ar_ledger_entry_type;
BEGIN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

    PERFORM public.recompute_invoice_settlement(v_invoice_id);

    IF TG_TABLE_NAME = 'invoice_payments' THEN
        IF TG_OP IN ('INSERT', 'UPDATE')
           AND NEW.payment_status = 'settled'
           AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'settled') THEN

            SELECT customer_id INTO v_customer_id FROM public.invoice WHERE invoice_id = v_invoice_id;
            SELECT code INTO v_method_code FROM public.payment_methods WHERE method_id = NEW.method_id;

            v_entry_type := CASE
                WHEN v_method_code = 'withholding_tax' THEN 'WITHHOLDING_TAX_CREDIT'
                ELSE 'PAYMENT_SETTLED'
            END::ar_ledger_entry_type;

            PERFORM append_ar_ledger_entry(
                v_customer_id, NEW.invoice_id, NEW.payment_id, NULL,
                v_entry_type, -NEW.amount_paid,
                v_method_code, NEW.reference,
                'Auto-recorded by invoice balance trigger (ledger safety net)',
                NEW.created_by, 'invoice_payments'
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- ────────────────────────────────────────────────────────────────
-- 3. invoice_payment_allocation gets the same safety net.
--    Until now nothing recomputed the invoice when an allocation changed --
--    paymentRoutes.js and pdcService.js each did it inline in JavaScript, which
--    is precisely the "every writer must remember" shape that produced three
--    silent-drift incidents on ar_ledger before 20260812_10 made the database
--    responsible instead.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoice_allocation_recompute()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    -- Branch on TG_OP rather than COALESCE(NEW.., OLD..): NEW is unassigned in a
    -- DELETE trigger, and reading a field off it is an error, not a NULL.
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recompute_invoice_settlement(OLD.invoice_id);
        RETURN OLD;
    END IF;

    -- An allocation that was moved to a different invoice leaves the old one
    -- overstated unless both are recomputed.
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
        PERFORM public.recompute_invoice_settlement(OLD.invoice_id);
    END IF;

    PERFORM public.recompute_invoice_settlement(NEW.invoice_id);
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_invoice_allocation_recompute ON public.invoice_payment_allocation;
CREATE TRIGGER trg_invoice_allocation_recompute
    AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payment_allocation
    FOR EACH ROW EXECUTE FUNCTION public.invoice_allocation_recompute();

COMMIT;
