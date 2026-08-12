-- Migration: 20260813_06_backfill_goods_receipt_bill_id.sql
-- Description: Backfills goods_receipt.bill_id for receipts whose auto-created
--              supplier_bill already links back via supplier_bill.grn_id. Without
--              this, GET /ap/supplier-bills/:billId/items finds nothing for bills
--              created before goodsReceiptRoutes.js started setting bill_id itself,
--              even though the stock-in already happened.

BEGIN;

UPDATE goods_receipt gr
SET bill_id = sb.bill_id
FROM supplier_bill sb
WHERE sb.grn_id = gr.grn_id
  AND gr.bill_id IS NULL;

COMMIT;
