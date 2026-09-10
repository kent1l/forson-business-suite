-- Migration: 20260910_01_goods_receipt_multiple_freight.sql
-- Description: Support multiple freight-in charges, receipt/waybill tracking numbers,
--              and optional immediate A/P payment settlement on Goods Receipt.

BEGIN;

CREATE TABLE IF NOT EXISTS public.goods_receipt_freight (
    grn_freight_id      serial PRIMARY KEY,
    grn_id              integer NOT NULL REFERENCES public.goods_receipt(grn_id) ON DELETE CASCADE,
    supplier_id         integer REFERENCES public.supplier(supplier_id) ON DELETE SET NULL,
    amount              numeric(12,2) NOT NULL CHECK (amount >= 0),
    receipt_number      varchar(100),
    notes               text,
    is_paid             boolean NOT NULL DEFAULT false,
    payment_method_id   integer REFERENCES public.payment_methods(method_id) ON DELETE SET NULL,
    bill_id             integer REFERENCES public.supplier_bill(bill_id) ON DELETE SET NULL,
    payment_id          integer REFERENCES public.ap_payment(payment_id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_grn_freight_grn_id ON public.goods_receipt_freight(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_freight_supplier_id ON public.goods_receipt_freight(supplier_id);
CREATE INDEX IF NOT EXISTS idx_grn_freight_bill_id ON public.goods_receipt_freight(bill_id);
CREATE INDEX IF NOT EXISTS idx_grn_freight_payment_id ON public.goods_receipt_freight(payment_id);

COMMENT ON TABLE public.goods_receipt_freight IS
    'Itemized freight charges associated with a goods receipt (multiple couriers, travel expense, gas/tolls for direct warehouse pickup).';
COMMENT ON COLUMN public.goods_receipt_freight.receipt_number IS
    'Carrier receipt number, waybill number, tracking number, or travel expense OR.';
COMMENT ON COLUMN public.goods_receipt_freight.is_paid IS
    'When true, posting this receipt automatically settles this carrier bill in Accounts Payable immediately.';

-- Backfill from existing goods_receipt records that have freight_amount > 0
INSERT INTO public.goods_receipt_freight (grn_id, supplier_id, amount, bill_id)
SELECT grn_id, freight_supplier_id, freight_amount, freight_bill_id
FROM public.goods_receipt
WHERE freight_amount > 0
  AND NOT EXISTS (
      SELECT 1 FROM public.goods_receipt_freight grf WHERE grf.grn_id = goods_receipt.grn_id
  );

COMMIT;
