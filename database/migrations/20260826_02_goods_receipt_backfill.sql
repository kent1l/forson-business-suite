-- Migration: 20260826_02_goods_receipt_backfill.sql
-- Description: Historical receipt backfill on the goods receipt document.
--
--   Most negative stock in this system was caused by deliveries that were never
--   recorded. Entering those receipts from the supplier's own paperwork fixes the
--   quantity and the cost basis in one action, because weighted average cost is
--   replayed from the StockIn history — so backfilling documents is the cheapest and
--   most accurate way to clean up cost data, and it shrinks what a physical count
--   later has to explain.
--
--   A backfill uses the same document shape as a receipt (one supplier and date,
--   many part lines) because that is the shape of the paper being copied. It differs
--   from a live receipt in two ways that must be enforced, not left to discipline:
--
--     - It must not create a supplier bill. Historical goods were already paid for
--       through some other route; auto-posting a payable would inflate what the
--       business appears to owe.
--     - It must not advance a purchase order's received quantity. A years-old
--       delivery has nothing to do with today's open orders.
--
--   The real hazard of this workflow is entering the same invoice twice, which would
--   double the stock and corrupt the average in the opposite direction. Nothing could
--   detect that before, because the table recorded only the internal grn_number and
--   never the supplier's own document number. supplier_invoice_no closes that hole and
--   is enforced unique per supplier.

BEGIN;

ALTER TABLE public.goods_receipt
    ADD COLUMN IF NOT EXISTS is_backfill BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS supplier_invoice_no VARCHAR(100);

COMMENT ON COLUMN public.goods_receipt.is_backfill IS
    'True when this document records a historical delivery entered after the fact. Such receipts create no supplier bill and do not advance purchase order quantities.';
COMMENT ON COLUMN public.goods_receipt.supplier_invoice_no IS
    'The supplier''s own invoice or delivery receipt number. Unique per supplier so the same document cannot be entered twice.';

-- Voided receipts are excluded so a document entered in error can be voided and
-- re-entered correctly under the same invoice number.
CREATE UNIQUE INDEX IF NOT EXISTS uq_goods_receipt_supplier_invoice
    ON public.goods_receipt (supplier_id, supplier_invoice_no)
    WHERE supplier_invoice_no IS NOT NULL AND status <> 'Voided';

CREATE INDEX IF NOT EXISTS idx_goods_receipt_backfill
    ON public.goods_receipt (is_backfill) WHERE is_backfill;

COMMIT;
