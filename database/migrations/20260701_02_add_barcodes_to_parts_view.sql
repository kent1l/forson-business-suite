-- Migration: Add barcodes array to parts_view
-- Date: 2026-07-01

DROP VIEW IF EXISTS public.parts_view;

CREATE OR REPLACE VIEW public.parts_view AS
SELECT 
    p.part_id,
    p.internal_sku,
    p.detail,
    p.brand_id,
    p.group_id,
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
    ) AS display_name,

    (SELECT ARRAY_AGG(barcode) FROM part_barcode pb WHERE pb.part_id = p.part_id) as barcodes

FROM public.part p
LEFT JOIN public.brand b ON p.brand_id = b.brand_id
LEFT JOIN public."group" g ON p.group_id = g.group_id
LEFT JOIN LATERAL (
    SELECT STRING_AGG(pn.part_number, ', ' ORDER BY COALESCE(pn.display_order, 1) ASC) AS part_numbers
    FROM public.part_number pn
    WHERE pn.part_id = p.part_id 
      AND pn.deleted_at IS NULL
) apn ON true;
