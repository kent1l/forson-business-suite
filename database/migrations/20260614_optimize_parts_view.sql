-- Migration: Optimize parts_view for UI stability, performance, and formatting
-- Date: 2026-06-14

CREATE OR REPLACE VIEW public.parts_view AS
SELECT 
    p.part_id,
    p.internal_sku,
    p.detail,
    p.brand_id,
    p.group_id,
    p.barcode,
    p.is_active,
    p.last_cost,
    p.wac_cost,
    p.last_sale_price,
    p.merged_into_part_id,
    p.date_created,
    p.date_modified,
    b.brand_name,
    g.group_name,
    
    -- New display_name construction using CONCAT_WS for clean formatting without hanging delimiters
    CONCAT_WS(' | ',
        -- Prefix logic: Handles missing Brands or Groups gracefully
        NULLIF(
            CASE 
                WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN g.group_name || ' (' || b.brand_name || ')'
                WHEN g.group_name IS NOT NULL THEN g.group_name
                WHEN b.brand_name IS NOT NULL THEN b.brand_name
                ELSE NULL
            END, 
        ''),
        
        -- Cap the part numbers string to keep the UI clean (max 80 chars)
        NULLIF(
            CASE 
                WHEN LENGTH(apn.part_numbers) > 80 THEN LEFT(apn.part_numbers, 77) || '...'
                ELSE apn.part_numbers
            END, 
        ''),
        
        -- Detail
        NULLIF(p.detail, '')
    ) AS display_name

FROM public.part p
LEFT JOIN public.brand b ON p.brand_id = b.brand_id
LEFT JOIN public."group" g ON p.group_id = g.group_id
-- LATERAL join avoids full table scans of the part_number table by executing per row
LEFT JOIN LATERAL (
    SELECT STRING_AGG(pn.part_number, ', ' ORDER BY COALESCE(pn.display_order, 1) ASC) AS part_numbers
    FROM public.part_number pn
    WHERE pn.part_id = p.part_id 
      AND pn.deleted_at IS NULL
) apn ON true;
