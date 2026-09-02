-- Migration: 20260902_01_restore_payment_status_values.sql
-- Description: Restore the payment_status values that a 2025-09-15 migration
--              dropped by accident, so voiding an invoice stops failing.
--
--   20250915_add_payment_status_to_invoice_payments.sql introduced the column with
--   six allowed values:
--
--       settled, pending, failed, voided, refunded, partially_refunded
--
--   Later the same day, 20250915_z_add_on_account_payment_status.sql needed to add
--   'on_account'. Rather than extending the list it dropped the constraint and
--   rewrote it from scratch as:
--
--       settled, pending, on_account
--
--   That silently revoked four values that were never meant to go away. The code
--   still uses one of them: voiding an invoice sets every payment on it to
--   'voided' (invoiceRoutes.js, the DELETE /invoices/:id handler) so the
--   amount_paid trigger -- which sums only 'settled' rows -- recomputes the
--   invoice down to zero paid. Against the narrowed constraint that UPDATE raises
--   23514 and the whole void transaction rolls back, so no invoice with a recorded
--   payment can be voided at all.
--
--   This restores the original six and keeps 'on_account', which is the union both
--   migrations intended. Nothing is being loosened here that was ever deliberately
--   tightened.
--
--   'voided' is deliberately NOT counted as paid anywhere: every trigger and report
--   filters on payment_status = 'settled' (see 20260709_fix_trigger_cartesian_product.sql
--   and 20250916_optimize_payment_terms_infrastructure.sql), so a voided payment row
--   is preserved as history while contributing nothing to the balance.

BEGIN;

-- Drop whatever payment_status check constraint is currently present, under any
-- name. Development databases have had this constraint dropped by hand, and the
-- 2025-09-15 pair left it named differently depending on replay order, so this
-- cannot key off a single expected name.
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.invoice_payments'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%payment_status%'
    LOOP
        EXECUTE format('ALTER TABLE public.invoice_payments DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE public.invoice_payments
    ADD CONSTRAINT chk_payment_status
    CHECK (payment_status IN (
        'settled',
        'pending',
        'on_account',
        'failed',
        'voided',
        'refunded',
        'partially_refunded'
    ));

COMMENT ON COLUMN public.invoice_payments.payment_status IS
    'Payment status: settled (funds received, the only value counted toward amount_paid), '
    'pending (awaiting settlement), on_account (AR charge), failed, voided (invoice voided; '
    'kept as history, not counted as paid), refunded, partially_refunded';

COMMIT;
