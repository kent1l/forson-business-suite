-- 2025-10-10: Create parts_view (extracted from backup). Safe, idempotent migration.
BEGIN;

-- Ensure pg_trgm is available for similarity() if not already installed
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create or replace the view so the migration can be re-run safely
CREATE OR REPLACE VIEW public.parts_view AS
 SELECT p.part_id,
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
    string_agg((pn.part_number)::text, '; '::text ORDER BY pn.display_order) AS part_numbers,
    concat_ws(' | '::text,
        CASE
            WHEN ((g.group_name IS NOT NULL) OR (b.brand_name IS NOT NULL)) THEN TRIM(BOTH FROM replace(((((g.group_name)::text || ' ('::text) || (b.brand_name)::text) || ')'::text), '()'::text, ''::text))
            ELSE NULL::text
        END, string_agg((pn.part_number)::text, '; '::text ORDER BY pn.display_order), p.detail) AS display_name,
    p.date_created AS created_at,
    p.date_modified AS modified_at,
    ''::text AS tags
   FROM (((public.part p
     LEFT JOIN public.brand b ON ((p.brand_id = b.brand_id)))
     LEFT JOIN public."group" g ON ((p.group_id = g.group_id)))
     LEFT JOIN public.part_number pn ON (((p.part_id = pn.part_id) AND (pn.deleted_at IS NULL))))
  GROUP BY p.part_id, p.internal_sku, p.detail, p.brand_id, p.group_id, p.barcode, p.is_active, p.last_cost, p.wac_cost, p.last_sale_price, p.merged_into_part_id, p.date_created, p.date_modified, b.brand_name, g.group_name;

ALTER TABLE public.parts_view OWNER TO postgres;

COMMIT;

-- Note: prefer adding an entry to schema_migrations if your migration tooling requires it.
