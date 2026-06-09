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
    (p.internal_sku || ' - ' || p.detail) AS display_name
   FROM part p
     LEFT JOIN brand b ON p.brand_id = b.brand_id
     LEFT JOIN "group" g ON p.group_id = g.group_id;