-- Migration: 20260902_02_withholding_ar_payment_link.sql
-- Description: Let a withholding line point at an AR collection, not just a POS payment.
--
--   withholding_tax_line.payment_id references invoice_payments, which only covers
--   tax withheld at the moment of sale. That is the exception, not the rule.
--
--   The customers who withhold -- government agencies above all -- are precisely the
--   ones who never pay at the counter. They take the invoice on account, process it
--   through their own voucher system, and pay weeks later net of tax. That collection
--   is recorded in customer_payment via POST /payments, a different table entirely, so
--   a withholding line raised there had nowhere to point and would have been orphaned.
--
--   Rather than overload payment_id with values from two unrelated sequences -- which
--   would silently join to the wrong payment -- this adds a second, explicitly typed
--   column and a constraint that at most one of them is ever set.
--
--   Both may be null: a line recorded when the invoice is raised, before anyone has
--   paid anything, is a legitimate state (it is the expected withholding, awaiting
--   collection).

BEGIN;

ALTER TABLE public.withholding_tax_line
    ADD COLUMN IF NOT EXISTS customer_payment_id INTEGER
        REFERENCES public.customer_payment(payment_id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.withholding_tax_line'::regclass
          AND conname = 'chk_wt_line_single_payment_source'
    ) THEN
        ALTER TABLE public.withholding_tax_line
            ADD CONSTRAINT chk_wt_line_single_payment_source
            CHECK (payment_id IS NULL OR customer_payment_id IS NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wt_line_customer_payment
    ON public.withholding_tax_line(customer_payment_id)
    WHERE customer_payment_id IS NOT NULL;

COMMENT ON COLUMN public.withholding_tax_line.payment_id IS
    'Set when the tax was withheld at the point of sale (invoice_payments row). Mutually exclusive with customer_payment_id.';
COMMENT ON COLUMN public.withholding_tax_line.customer_payment_id IS
    'Set when the tax was withheld on a later AR collection (customer_payment row). Mutually exclusive with payment_id.';

COMMIT;
