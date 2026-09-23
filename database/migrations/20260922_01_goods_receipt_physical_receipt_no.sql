-- Store the supplier's printed receipt independently from the supplier invoice/DR.
ALTER TABLE public.goods_receipt
    ADD COLUMN IF NOT EXISTS physical_receipt_no VARCHAR(100);

COMMENT ON COLUMN public.goods_receipt.physical_receipt_no IS
    'Supplier delivery document number. Normalized by the API and unique per active supplier receipt.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_goods_receipt_supplier_physical_receipt
    ON public.goods_receipt (supplier_id, physical_receipt_no)
    WHERE physical_receipt_no IS NOT NULL
      AND LENGTH(TRIM(physical_receipt_no)) > 0
      AND status <> 'Voided';
