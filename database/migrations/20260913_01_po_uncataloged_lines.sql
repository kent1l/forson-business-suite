-- Smart PO entry: permit purchase-order lines that will be cataloged at receiving.
BEGIN;

ALTER TABLE public.purchase_order_line
    ALTER COLUMN part_id DROP NOT NULL;

ALTER TABLE public.purchase_order_line
    ADD COLUMN IF NOT EXISTS custom_item_name varchar(255),
    ADD COLUMN IF NOT EXISTS unit varchar(50),
    ADD COLUMN IF NOT EXISTS draft_part_data jsonb;

ALTER TABLE public.purchase_order_line
    DROP CONSTRAINT IF EXISTS chk_pol_has_item;

ALTER TABLE public.purchase_order_line
    ADD CONSTRAINT chk_pol_has_item
    CHECK (part_id IS NOT NULL OR NULLIF(BTRIM(custom_item_name), '') IS NOT NULL);

COMMIT;
