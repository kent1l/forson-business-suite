-- Migration: 20260810_02_enforce_physical_receipt_uniqueness.sql
-- Description: Cleanup duplicate physical receipt numbers in invoice_payments, add unique index on customer_payment physical_receipt_no, and add cross-table uniqueness helper function.

-- 1. Cleanup duplicate physical receipt numbers stored in invoice_payments.reference
UPDATE public.invoice_payments ip
SET reference = NULL
FROM public.invoice i
WHERE ip.invoice_id = i.invoice_id
  AND ip.reference IS NOT NULL
  AND (
    LOWER(TRIM(ip.reference)) = LOWER(TRIM(i.physical_receipt_no))
    OR LOWER(TRIM(ip.reference)) = LOWER(TRIM(i.invoice_number))
  );

-- 2. Partial unique index on customer_payment physical_receipt_no
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payment_physical_receipt_no_unique
    ON public.customer_payment (LOWER(TRIM(physical_receipt_no)))
    WHERE physical_receipt_no IS NOT NULL AND LENGTH(TRIM(physical_receipt_no)) > 0;

-- 3. Cross-table uniqueness checker function
CREATE OR REPLACE FUNCTION public.is_physical_receipt_no_taken(
    p_receipt_no TEXT,
    p_ignore_invoice_id INT DEFAULT NULL,
    p_ignore_payment_id INT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_clean TEXT := LOWER(TRIM(p_receipt_no));
    v_count INT := 0;
BEGIN
    IF v_clean IS NULL OR v_clean = '' THEN
        RETURN FALSE;
    END IF;

    SELECT COUNT(*) INTO v_count FROM (
        SELECT invoice_id FROM public.invoice
        WHERE LOWER(TRIM(physical_receipt_no)) = v_clean
          AND (p_ignore_invoice_id IS NULL OR invoice_id != p_ignore_invoice_id)
        UNION ALL
        SELECT payment_id FROM public.customer_payment
        WHERE LOWER(TRIM(physical_receipt_no)) = v_clean
          AND (p_ignore_payment_id IS NULL OR payment_id != p_ignore_payment_id)
        UNION ALL
        SELECT staged_sale_id FROM public.staged_sale
        WHERE LOWER(TRIM(physical_receipt_no)) = v_clean
          AND status NOT IN ('REJECTED', 'CANCELLED')
    ) t;

    RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql STABLE;
