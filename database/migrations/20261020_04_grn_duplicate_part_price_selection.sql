-- Migration: 20261020_04_grn_duplicate_part_price_selection.sql
-- Description: External Supplier Document JSON Ingestion Phase A/C:
--              Redefine recompute_wac_for_part with deterministic catalog retail-price selection
--              for duplicate-part rows on the same receipt (last eligible row in saved receipt order:
--              greatest grn_line_id with sale_price IS NOT NULL and quantity > return_quantity).
--              Preserves all existing WAC inventory arithmetic and single-source-of-truth invariants.

CREATE OR REPLACE FUNCTION public.recompute_wac_for_part(p_part_id integer)
RETURNS TABLE(old_wac_cost numeric, new_wac_cost numeric) AS $$
DECLARE
    t                 RECORD;
    balance           NUMERIC := 0;      -- stock on hand as at the row being replayed
    avg_cost          NUMERIC := 0;      -- the running weighted average
    prior             NUMERIC;           -- balance floored at zero, for weighting
    last_known_cost   NUMERIC := NULL;
    last_known_date   TIMESTAMP WITH TIME ZONE := NULL;
    v_old_wac         NUMERIC;
    sale_price_from_grn NUMERIC;
    sale_price_date   TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT wac_cost INTO v_old_wac FROM public.part WHERE part_id = p_part_id;

    -- EVERY transaction, in the order it happened. Sales, refunds, adjustments,
    -- cycle counts and reversals do not carry a cost, but they do change how much
    -- stock the next receipt is averaging against, which is the whole point.
    FOR t IN
        SELECT trans_type, quantity, unit_cost, transaction_date
        FROM public.inventory_transaction
        WHERE part_id = p_part_id
        ORDER BY transaction_date ASC, inv_trans_id ASC
    LOOP
        -- Only a receipt that knows what it cost can move the average. A StockIn with
        -- unit_cost IS NULL is stock whose cost was never captured: it changes the
        -- quantity, but says nothing about price, so the average carries forward. A
        -- StockIn at exactly 0.00 is free goods, and 0.00 is its real cost.
        IF t.trans_type = 'StockIn' AND t.unit_cost IS NOT NULL THEN
            -- Oversold stock cannot be weighted against: those units were sold without
            -- a recorded cost, so there is nothing to average. Treat the shelf as
            -- empty and let this receipt establish the cost.
            prior := GREATEST(balance, 0);

            IF (prior + t.quantity) > 0 THEN
                avg_cost := ((prior * avg_cost) + (t.quantity * t.unit_cost)) / (prior + t.quantity);
            ELSE
                avg_cost := t.unit_cost;
            END IF;

            last_known_cost := t.unit_cost;
            last_known_date := t.transaction_date;
        END IF;

        balance := balance + t.quantity;
    END LOOP;

    -- A part with no costed receipt in its history keeps whatever cost it already had.
    -- Five thousand parts were imported with a last_cost and no ledger behind it;
    -- replaying their empty history must not overwrite that with zero.
    IF last_known_cost IS NOT NULL THEN
        UPDATE public.part
           SET wac_cost       = ROUND(avg_cost::numeric, 2),
               last_cost      = last_known_cost,
               last_cost_date = last_known_date
         WHERE part_id = p_part_id;
    END IF;

    -- Retail price follows the most recent receipt that asked for its prices to reach
    -- the catalogue. Dated from that receipt, not from now: a backdated correction
    -- should not claim the shelf price was set today.
    -- For duplicate parts on the same receipt, choose the last eligible row in saved receipt order:
    -- greatest grn_line_id with sale_price IS NOT NULL and quantity > return_quantity.
    SELECT grl.sale_price, it.transaction_date
      INTO sale_price_from_grn, sale_price_date
      FROM public.inventory_transaction it
      JOIN public.goods_receipt gr ON gr.grn_number = it.reference_no
      JOIN public.goods_receipt_line grl ON grl.grn_id = gr.grn_id AND grl.part_id = it.part_id
     WHERE it.part_id = p_part_id
       AND it.trans_type = 'StockIn'
       AND it.reference_no LIKE 'GRN%'
       AND gr.sync_retail_prices
       AND (gr.status IS NULL OR gr.status <> 'Voided')
       AND (gr.workflow_status IS NULL OR gr.workflow_status <> 'Cancelled')
       AND grl.sale_price IS NOT NULL
       AND grl.quantity > grl.return_quantity
     ORDER BY it.transaction_date DESC, it.inv_trans_id DESC, grl.grn_line_id DESC
     LIMIT 1;

    IF sale_price_from_grn IS NOT NULL THEN
        UPDATE public.part
           SET last_sale_price      = sale_price_from_grn,
               last_sale_price_date = sale_price_date
         WHERE part_id = p_part_id;
    END IF;

    RETURN QUERY SELECT v_old_wac, ROUND(avg_cost::numeric, 2);
END;
$$ LANGUAGE plpgsql;
