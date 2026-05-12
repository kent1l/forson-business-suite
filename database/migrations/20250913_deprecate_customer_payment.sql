-- Migration: Deprecate customer_payment table in favor of payments_unified view
-- Date: 2025-09-13
-- Description: 
-- This migration marks the customer_payment table as deprecated.
-- All application code has been migrated to use the payments_unified view
-- which aggregates both customer_payment (legacy) and invoice_payments (new split payments).

BEGIN;

-- Add a comment to mark the table as deprecated
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_payment') THEN
        EXECUTE 'COMMENT ON TABLE public.customer_payment IS ''DEPRECATED: This table is deprecated as of 2025-09-13. Use the payments_unified view instead. This table is maintained for legacy single-payment invoices only.''';
        EXECUTE 'COMMENT ON COLUMN public.customer_payment.payment_id IS ''DEPRECATED: Use payments_unified.payment_id instead''';
        EXECUTE 'COMMENT ON COLUMN public.customer_payment.amount IS ''DEPRECATED: Use payments_unified.amount_paid instead''';
        EXECUTE 'COMMENT ON COLUMN public.customer_payment.payment_method IS ''DEPRECATED: Use payments_unified.method_name instead''';
    END IF;
END$$;

-- Create a read-only function to discourage direct inserts (optional enforcement)
CREATE OR REPLACE FUNCTION prevent_customer_payment_direct_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow inserts only from legacy invoice creation (single payments)
    -- This is identified by having a reference_number that matches invoice pattern
    IF NEW.reference_number IS NULL OR NOT (NEW.reference_number ~ '^INV-\d{6}-\d+$') THEN
        RAISE WARNING 'Direct inserts into customer_payment are deprecated. Use invoice_payments for new payments and payments_unified for queries.';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to warn on direct inserts (but still allow them for compatibility)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_payment') THEN
        DROP TRIGGER IF EXISTS customer_payment_deprecation_warning ON public.customer_payment;
        CREATE TRIGGER customer_payment_deprecation_warning
            BEFORE INSERT ON public.customer_payment
            FOR EACH ROW
            EXECUTE FUNCTION prevent_customer_payment_direct_insert();
    END IF;
END$$;

-- Log the deprecation
DO $$
BEGIN
    RAISE NOTICE 'customer_payment table has been marked as DEPRECATED';
    RAISE NOTICE 'All queries should use payments_unified view instead';
    RAISE NOTICE 'New split payments go to invoice_payments table';
    RAISE NOTICE 'Legacy single payments still use customer_payment for compatibility';
END $$;

COMMIT;
