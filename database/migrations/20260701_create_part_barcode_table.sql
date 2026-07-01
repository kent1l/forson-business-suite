-- Migration: Create part_barcode table and drop barcode column from part
-- Date: 2026-07-01

-- 1. Create the new table
CREATE TABLE IF NOT EXISTS public.part_barcode (
    barcode_id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,
    barcode VARCHAR(100) NOT NULL UNIQUE
);

-- 2. Migrate existing barcodes (ignoring nulls and empty strings)
INSERT INTO public.part_barcode (part_id, barcode)
SELECT part_id, barcode 
FROM public.part 
WHERE barcode IS NOT NULL AND barcode != '';

-- 3. Update the parts_view to accommodate the removal of the column.
-- We will replace the single `barcode` column with a `barcodes` array or a comma-separated string if it's easier.
-- Since the view currently exposes `barcode`, let's expose `barcodes` as a string or array.
-- Dropping the view first to change column types/names if needed.
DROP VIEW IF EXISTS public.parts_view;

CREATE OR REPLACE VIEW public.parts_view AS
SELECT 
    p.part_id,
    p.internal_sku,
    p.detail,
    p.brand_id,
    p.group_id,
    -- Removed p.barcode
    p.is_active,
    p.last_cost,
    p.wac_cost,
    p.last_sale_price,
    p.merged_into_part_id,
    p.date_created,
    p.date_modified,
    b.brand_name,
    g.group_name,
    
    CONCAT_WS(' | ',
        NULLIF(
            CASE 
                WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN g.group_name || ' (' || b.brand_name || ')'
                WHEN g.group_name IS NOT NULL THEN g.group_name
                WHEN b.brand_name IS NOT NULL THEN b.brand_name
                ELSE NULL
            END, 
        ''),
        NULLIF(
            CASE 
                WHEN LENGTH(apn.part_numbers) > 80 THEN LEFT(apn.part_numbers, 77) || '...'
                ELSE apn.part_numbers
            END, 
        ''),
        NULLIF(p.detail, '')
    ) AS display_name

FROM public.part p
LEFT JOIN public.brand b ON p.brand_id = b.brand_id
LEFT JOIN public."group" g ON p.group_id = g.group_id
LEFT JOIN LATERAL (
    SELECT STRING_AGG(pn.part_number, ', ' ORDER BY COALESCE(pn.display_order, 1) ASC) AS part_numbers
    FROM public.part_number pn
    WHERE pn.part_id = p.part_id 
      AND pn.deleted_at IS NULL
) apn ON true;

-- 4. Drop the constraint and column from `part`
ALTER TABLE public.part DROP CONSTRAINT IF EXISTS parts_barcode_key;
ALTER TABLE public.part DROP COLUMN IF EXISTS barcode;
