-- Migration: 20260813_05_add_goods_receipt_bill_link.sql
-- Description: Optional link from goods_receipt to a pre-existing supplier_bill,
--              so items can be "attached" (with real stock-in) to a manually-created
--              payable after the fact, instead of only via the automatic
--              GRN-posts-a-bill flow (which uses supplier_bill.grn_id, a single-bill
--              link, and stays untouched). Unlike that single-link column, one manual
--              bill can accumulate items from multiple goods receipts over time, so
--              this is a plain FK on goods_receipt rather than a unique constraint.

BEGIN;

ALTER TABLE goods_receipt ADD COLUMN IF NOT EXISTS bill_id integer REFERENCES supplier_bill(bill_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_bill_id ON goods_receipt(bill_id) WHERE bill_id IS NOT NULL;

COMMIT;
