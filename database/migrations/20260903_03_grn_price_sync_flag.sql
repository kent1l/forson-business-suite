-- Migration: 20260903_03_grn_price_sync_flag.sql
-- Description: Make the goods-receipt → catalogue retail price push conditional on
--              goods_receipt.sync_retail_prices.
--
--   Receiving stock has always rewritten part.last_sale_price from the receipt line's
--   sale_price, silently and unconditionally, inside the WAC trigger (see
--   20260821_01_restore_wac_trigger_sale_price.sql). That is right for a normal
--   restock, where the receipt is where a new shelf price is decided. It is wrong for
--   a correction, a backfill of an old delivery, or any receipt entered purely to fix
--   cost — in those cases the receipt should move cost and leave the price on the
--   shelf alone, and there was previously no way to say so.
--
--   20260903_02 added goods_receipt.sync_retail_prices, defaulting to true so existing
--   behaviour is unchanged. This migration is what actually honours it.
--
--   Both function bodies are restated in full: PL/pgSQL has no partial edit, so
--   CREATE OR REPLACE must carry the whole body. Everything here is copied verbatim
--   from 20260821_01 except the two sale_price lookups, which gain the flag check.
--   The original explanatory comments are kept so the lineage stays traceable.

BEGIN;

-- ────────────────────────────────────────────
-- 1. Live insert trigger.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_wac_on_inventory_transaction()
RETURNS trigger AS $$
DECLARE
    prev_stock NUMERIC;
    current_wac NUMERIC;
    new_quantity NUMERIC := NEW.quantity;
    new_cost NUMERIC := COALESCE(NEW.unit_cost, 0);
    new_wac NUMERIC;
    sale_price_from_grn NUMERIC;
BEGIN
    SELECT COALESCE(SUM(quantity), 0)
    INTO prev_stock
    FROM public.inventory_transaction
    WHERE part_id = NEW.part_id
      AND inv_trans_id <> NEW.inv_trans_id;

    SELECT COALESCE(wac_cost, 0)
    INTO current_wac
    FROM public.part p
    WHERE p.part_id = NEW.part_id;

    IF (prev_stock + new_quantity) > 0 THEN
        new_wac := ((prev_stock * current_wac) + (new_quantity * new_cost)) / (prev_stock + new_quantity);
    ELSE
        new_wac := new_cost;
    END IF;

    UPDATE public.part
    SET
        wac_cost = new_wac,
        last_cost = new_cost,
        last_cost_date = COALESCE(NEW.transaction_date, CURRENT_TIMESTAMP)
    WHERE part_id = NEW.part_id;

    -- If this is a StockIn transaction from a GRN, also update last_sale_price —
    -- but only when that receipt asked for its prices to reach the catalogue.
    IF NEW.trans_type = 'StockIn' AND NEW.reference_no LIKE 'GRN%' THEN
        SELECT grl.sale_price
        INTO sale_price_from_grn
        FROM public.goods_receipt_line grl
        JOIN public.goods_receipt gr ON gr.grn_id = grl.grn_id
        WHERE gr.grn_number = NEW.reference_no
          AND grl.part_id = NEW.part_id
          AND gr.sync_retail_prices
        LIMIT 1;

        IF sale_price_from_grn IS NOT NULL THEN
            UPDATE public.part
            SET
                last_sale_price = sale_price_from_grn,
                last_sale_price_date = CURRENT_TIMESTAMP
            WHERE part_id = NEW.part_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────
-- 2. recompute_wac_for_part(part_id) — after replaying WAC, also re-resolve
--    last_sale_price from the most recent qualifying GRN StockIn transaction,
--    so a backdated/corrected receipt date keeps sale price consistent. A receipt
--    that opted out of price sync is not a qualifying source.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_wac_for_part(p_part_id integer)
RETURNS TABLE(old_wac_cost numeric, new_wac_cost numeric) AS $$
DECLARE
    t RECORD;
    prev_stock NUMERIC := 0;
    current_wac NUMERIC := 0;
    last_unit_cost NUMERIC := NULL;
    last_date TIMESTAMP WITH TIME ZONE := NULL;
    v_old_wac NUMERIC;
    sale_price_from_grn NUMERIC;
BEGIN
    SELECT wac_cost INTO v_old_wac FROM public.part WHERE part_id = p_part_id;

    FOR t IN
        SELECT quantity, COALESCE(unit_cost, 0) AS unit_cost, transaction_date
        FROM public.inventory_transaction
        WHERE part_id = p_part_id
          AND trans_type = 'StockIn'
        ORDER BY transaction_date ASC, inv_trans_id ASC
    LOOP
        IF (prev_stock + t.quantity) > 0 THEN
            current_wac := ((prev_stock * current_wac) + (t.quantity * t.unit_cost)) / (prev_stock + t.quantity);
        ELSE
            current_wac := t.unit_cost;
        END IF;

        prev_stock := prev_stock + t.quantity;
        last_unit_cost := t.unit_cost;
        last_date := t.transaction_date;
    END LOOP;

    IF last_unit_cost IS NOT NULL THEN
        UPDATE public.part
        SET wac_cost = ROUND(current_wac::numeric, 2),
            last_cost = last_unit_cost,
            last_cost_date = last_date
        WHERE part_id = p_part_id;
    END IF;

    -- Re-resolve last_sale_price from the most recent price-syncing GRN StockIn for
    -- this part, so date corrections don't leave sale price out of sync.
    SELECT grl.sale_price
    INTO sale_price_from_grn
    FROM public.inventory_transaction it
    JOIN public.goods_receipt gr ON gr.grn_number = it.reference_no
    JOIN public.goods_receipt_line grl ON grl.grn_id = gr.grn_id AND grl.part_id = it.part_id
    WHERE it.part_id = p_part_id
      AND it.trans_type = 'StockIn'
      AND it.reference_no LIKE 'GRN%'
      AND gr.sync_retail_prices
    ORDER BY it.transaction_date DESC, it.inv_trans_id DESC
    LIMIT 1;

    IF sale_price_from_grn IS NOT NULL THEN
        UPDATE public.part
        SET last_sale_price = sale_price_from_grn,
            last_sale_price_date = CURRENT_TIMESTAMP
        WHERE part_id = p_part_id;
    END IF;

    RETURN QUERY SELECT v_old_wac, ROUND(current_wac::numeric, 2);
END;
$$ LANGUAGE plpgsql;

COMMIT;
