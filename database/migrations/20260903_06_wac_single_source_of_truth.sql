-- Migration: 20260903_06_wac_single_source_of_truth.sql
-- Description: Make the chronological replay the only definition of weighted average
--              cost, reduce the insert trigger to a caller of it, and repair the
--              history both of them got wrong.
--
--   WAC had two independent implementations that were free to disagree, and did:
--
--     - trg_update_wac took prior stock as SUM(quantity) over every transaction.
--     - recompute_wac_for_part() replayed StockIn rows ONLY, so every sale, refund and
--       adjustment that had depleted the stock was invisible to it.
--
--   Fourteen parts already hold a WAC one produced and the other contradicts. Another
--   thirty-four would have flipped the next time anything called a recompute -- a cost
--   correction, a WAC estimate, a backdated receipt -- with gaps up to 2,161. The
--   defect is not the arithmetic in either one; it is that there were two. So this
--   migration keeps one, and the trigger becomes a caller.
--
--   Two correctness fixes ride along, both of which the old pair shared:
--
--   NEGATIVE STOCK INFLATED THE AVERAGE. Prior stock entered the weighting raw, so a
--   part that had been oversold weighted the average with a negative quantity. Part
--   6365 sold five units it never had, then received six at 370, and the books recorded
--   its cost as 2,220 -- six times what it cost -- because (-5 x 0 + 6 x 370) / (-5 + 6)
--   divides the whole receipt by one unit. Sixty-one parts are wrong this way, and in
--   the worst shape the formula can return a NEGATIVE cost. Stock that was sold before
--   it was received carries no cost information to average against, so prior stock is
--   floored at zero and the receipt simply sets the average.
--
--   BACKDATED RECEIPTS WERE APPLIED OUT OF ORDER. The trigger read the balance as it
--   stood at the moment of INSERT, not as it stood on the receipt's own date, so a
--   backfilled delivery averaged against stock that arrived after it. Replaying in
--   (transaction_date, inv_trans_id) order is what makes a backdated receipt land where
--   it belongs.
--
--   Replaying every row rather than only receipts also retires the limitation recorded
--   at goodsReceiptRoutes.js:788, that a voided receipt kept contributing to the
--   average. It no longer needs special handling: the void's reversing StockOut brings
--   the balance back down, and a balance of zero carries none of the old average's
--   weight into the next receipt.
--
--   Depends on 20260903_05, which established that unit_cost IS NULL means the cost was
--   never recorded and 0.00 means the stock was genuinely free.

BEGIN;

-- ────────────────────────────────────────────
-- 1. The definition of weighted average cost
-- ────────────────────────────────────────────
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
    SELECT grl.sale_price, it.transaction_date
      INTO sale_price_from_grn, sale_price_date
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
           SET last_sale_price      = sale_price_from_grn,
               last_sale_price_date = sale_price_date
         WHERE part_id = p_part_id;
    END IF;

    RETURN QUERY SELECT v_old_wac, ROUND(avg_cost::numeric, 2);
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────
-- 2. The trigger becomes a caller, not a second implementation
-- ────────────────────────────────────────────
-- This is the structural fix. There is now one body of arithmetic, so the live path and
-- the replay path cannot drift apart again no matter which is changed next.
--
-- The cost is a full replay per receipt line instead of two aggregate queries. That is
-- affordable: the trigger fires only on StockIn -- 3,320 rows across the whole history
-- -- and a part's ledger is a handful of rows, read on idx_inv_tx_part_date.
CREATE OR REPLACE FUNCTION public.update_wac_on_inventory_transaction()
RETURNS trigger AS $$
BEGIN
    PERFORM public.recompute_wac_for_part(NEW.part_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────
-- 3. The repair, and its receipt
-- ────────────────────────────────────────────
-- Restating a cost restates inventory value, so every part this moves is recorded with
-- what it held before. Follows stock_reconciliation_log (20260826_04): a correction
-- applied automatically must still be reviewable afterwards.
CREATE TABLE IF NOT EXISTS public.wac_repair_log (
    repair_id           SERIAL PRIMARY KEY,
    part_id             INTEGER NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,

    old_wac_cost        NUMERIC(12,2),
    new_wac_cost        NUMERIC(12,2),
    old_last_cost       NUMERIC(12,2),
    new_last_cost       NUMERIC(12,2),
    old_last_cost_date  TIMESTAMP WITH TIME ZONE,
    new_last_cost_date  TIMESTAMP WITH TIME ZONE,

    -- Stock on hand at repair time, so the valuation effect can be recomputed later
    -- without replaying the ledger as it stood today.
    stock_on_hand       NUMERIC(12,4),
    valuation_delta     NUMERIC(14,2),

    reason              TEXT NOT NULL,
    repaired_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wac_repair_log_part ON public.wac_repair_log (part_id);

COMMENT ON TABLE public.wac_repair_log IS
    'One row per part whose cost basis was restated by 20260903_06, which replaced two disagreeing WAC implementations with one. Retained as the audit trail for the inventory revaluation that migration performed.';

DO $$
DECLARE
    p         RECORD;
    before    RECORD;
    soh       NUMERIC;
BEGIN
    FOR p IN
        SELECT DISTINCT part_id
        FROM public.inventory_transaction
        WHERE trans_type = 'StockIn'
        ORDER BY part_id
    LOOP
        SELECT wac_cost, last_cost, last_cost_date
          INTO before
          FROM public.part WHERE part_id = p.part_id;

        PERFORM public.recompute_wac_for_part(p.part_id);

        SELECT COALESCE(SUM(quantity), 0) INTO soh
          FROM public.inventory_transaction WHERE part_id = p.part_id;

        INSERT INTO public.wac_repair_log (
            part_id, old_wac_cost, new_wac_cost, old_last_cost, new_last_cost,
            old_last_cost_date, new_last_cost_date, stock_on_hand, valuation_delta, reason
        )
        SELECT p.part_id, before.wac_cost, np.wac_cost, before.last_cost, np.last_cost,
               before.last_cost_date, np.last_cost_date, soh,
               ROUND(GREATEST(soh, 0) * (COALESCE(np.wac_cost, 0) - COALESCE(before.wac_cost, 0)), 2),
               'Rebuilt on the chronological replay: prior stock floored at zero, uncosted receipts skipped, transactions applied in date order.'
          FROM public.part np
         WHERE np.part_id = p.part_id
           AND (COALESCE(np.wac_cost, -1)  IS DISTINCT FROM COALESCE(before.wac_cost, -1)
             OR COALESCE(np.last_cost, -1) IS DISTINCT FROM COALESCE(before.last_cost, -1)
             OR np.last_cost_date          IS DISTINCT FROM before.last_cost_date);
    END LOOP;
END $$;

COMMIT;
