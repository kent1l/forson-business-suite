-- Migration: add sale_price to goods_receipt_line (idempotent)
-- Run safely on existing databases
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'goods_receipt_line' 
          AND column_name = 'sale_price'
    ) THEN
        ALTER TABLE public.goods_receipt_line
        ADD COLUMN sale_price numeric(12,2);
    END IF;
END$$;
