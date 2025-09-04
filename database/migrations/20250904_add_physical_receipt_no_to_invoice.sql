-- Add physical_receipt_no column to invoice and enforce uniqueness when present
ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS physical_receipt_no VARCHAR(50);

-- Case-insensitive uniqueness, only when non-null and non-empty after trim
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_physical_receipt_no_unique
ON public.invoice (LOWER(physical_receipt_no))
WHERE physical_receipt_no IS NOT NULL AND LENGTH(TRIM(physical_receipt_no)) > 0;
