-- Migration: 20260911_02_exchange_credit_ledger_safety_net.sql
-- Description: Stop the invoice_payments ledger safety net from double-posting
-- the value an 'exchange_credit' tender carries.
--
-- Found live while smoke-testing exchangeRoutes.js (Phase 1 of
-- docs/plans/2026-09-11_pos-item-exchange-module.md): update_invoice_balance_after_payment()
-- (20260906_01_recompute_invoice_settlement.sql) posts a PAYMENT_SETTLED
-- ar_ledger entry for EVERY invoice_payments row that lands as 'settled',
-- unconditionally -- it has no way to know that an 'exchange_credit' row is
-- not new money. That value was already recorded once, as the
-- CREDIT_MEMO_APPLIED entry the credit note posts against the *original*
-- invoice (exchangeRoutes.js step 5). Left alone, the safety net posts a
-- second, unwanted PAYMENT_SETTLED entry against the *replacement* invoice for
-- the same value, understating the customer's A/R balance by exactly the
-- returned amount on every on-account exchange.
--
-- Fix mirrors how 20260830_03_withholding_tax.sql already taught this same
-- trigger to route 'withholding_tax' to its own entry type instead of the
-- default PAYMENT_SETTLED -- 'exchange_credit' instead skips the ledger write
-- entirely, since (unlike withholding) nothing needs recording a second time.
-- invoice.amount_paid/status still update as usual: recompute_invoice_settlement()
-- runs unconditionally at the top of the trigger, before this branch.

BEGIN;

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

            -- The traded-in value this tender represents was already ledgered
            -- once, on the original invoice's credit note. Nothing to record here.
            IF v_method_code IS DISTINCT FROM 'exchange_credit' THEN
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
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$fn$;

COMMENT ON FUNCTION public.update_invoice_balance_after_payment() IS
    'Recomputes invoice settlement on every invoice_payments/credit_note change and ledgers settled tenders as a safety net -- except exchange_credit, whose value is already ledgered via the exchange credit note''s CREDIT_MEMO_APPLIED entry.';

COMMIT;
