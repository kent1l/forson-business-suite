-- Migration: Expose part.is_universal through parts_view (Vehicle Fitment Phase 0)
-- PartForm.jsx and the various getPartDataForMeili() queries read part fields
-- through parts_view (pv.*), so the new is_universal flag needs to be added to
-- the view or it will silently always read as undefined on the frontend.
-- 2026-09-09

BEGIN;

CREATE OR REPLACE VIEW public.parts_view AS
 SELECT p.part_id,
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
    concat_ws(' | '::text, NULLIF(
        CASE
            WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN ((g.group_name::text || ' ('::text) || b.brand_name::text) || ')'::text
            WHEN g.group_name IS NOT NULL THEN g.group_name::text
            WHEN b.brand_name IS NOT NULL THEN b.brand_name::text
            ELSE NULL::text
        END, ''::text), NULLIF(
        CASE
            WHEN length(apn.part_numbers) > 80 THEN "left"(apn.part_numbers, 77) || '...'::text
            ELSE apn.part_numbers
        END, ''::text), NULLIF(p.detail, ''::text)) AS display_name,
    ( SELECT array_agg(pb.barcode) AS array_agg
           FROM part_barcode pb
          WHERE pb.part_id = p.part_id) AS barcodes,
    p.is_universal
   FROM part p
     LEFT JOIN brand b ON p.brand_id = b.brand_id
     LEFT JOIN "group" g ON p.group_id = g.group_id
     LEFT JOIN LATERAL ( SELECT string_agg(pn.part_number::text, ', '::text ORDER BY (COALESCE(pn.display_order, 1))) AS part_numbers
           FROM part_number pn
          WHERE pn.part_id = p.part_id AND pn.deleted_at IS NULL) apn ON true;

COMMIT;
