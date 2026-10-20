-- Preserve generic supplier paperwork independently of confirmed invoice/delivery roles.
-- Existing references retain their historical meaning and uniqueness constraints.
ALTER TABLE goods_receipt
  ADD COLUMN IF NOT EXISTS supplier_document_no varchar(255),
  ADD COLUMN IF NOT EXISTS supplier_document_type varchar(50),
  ADD COLUMN IF NOT EXISTS another_delivery_confirmed boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_goods_receipt_supplier_document
  ON goods_receipt (supplier_id, supplier_bill_match_key(supplier_document_no))
  WHERE supplier_document_no IS NOT NULL;
