-- Performance and safety indexes for parts cleanup merge feature
CREATE INDEX IF NOT EXISTS idx_part_internal_sku_active ON part (internal_sku) WHERE merged_into_part_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_part_brand_group_active ON part (brand_id, group_id) WHERE merged_into_part_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_part_number_part_id_active ON part_number (part_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_part_number_norm_active ON part_number ((upper(regexp_replace(part_number, '[^A-Za-z0-9]', '', 'g')))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_transaction_part_id ON inventory_transaction (part_id);
CREATE INDEX IF NOT EXISTS idx_gr_line_part_id ON goods_receipt_line (part_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_part_id ON invoice_line (part_id);
CREATE INDEX IF NOT EXISTS idx_po_line_part_id ON purchase_order_line (part_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_line_part_id ON credit_note_line (part_id);
