-- Migration: Update WAC trigger to also update last_sale_price from GRN
-- Run safely on existing databases

CREATE OR REPLACE FUNCTION public.update_wac_on_inventory_transaction()
RETURNS TRIGGER AS $$
DECLARE
    prev_stock NUMERIC;
    current_wac NUMERIC;
    new_quantity NUMERIC := NEW.quantity;
    new_cost NUMERIC := COALESCE(NEW.unit_cost, 0);
    new_wac NUMERIC;
    sale_price_from_grn NUMERIC;
BEGIN
    -- Calculate previous stock excluding the newly inserted transaction
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

    -- Update WAC and last_cost
    UPDATE public.part
    SET
        wac_cost = new_wac,
        last_cost = new_cost,
        last_cost_date = CURRENT_TIMESTAMP
    WHERE part_id = NEW.part_id;

    -- If this is a StockIn transaction from GRN, also update last_sale_price
    IF NEW.trans_type = 'StockIn' AND NEW.reference_no LIKE 'GRN%' THEN
        -- Find the sale_price from goods_receipt_line for this part and GRN
        SELECT grl.sale_price
        INTO sale_price_from_grn
        FROM public.goods_receipt_line grl
        JOIN public.goods_receipt gr ON gr.grn_id = grl.grn_id
        WHERE gr.grn_number = NEW.reference_no
          AND grl.part_id = NEW.part_id
        LIMIT 1;

        -- Update last_sale_price if we found a sale_price
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
