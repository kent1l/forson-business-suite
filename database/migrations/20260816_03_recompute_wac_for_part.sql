-- Migration: 20260816_03_recompute_wac_for_part.sql
-- Description: Extracts the per-part body of recompute_all_wac()
--              (database/scripts/recompute_wac.sql) into a standalone
--              recompute_wac_for_part(part_id) function, so a single part's
--              WAC can be recomputed inline inside the transaction-date-change
--              transaction without replaying every part in the system.
--              recompute_all_wac() is rewritten to loop over the new function
--              — same math, same ordering, no behavior change on a clean DB.
--
--              Also fixes update_wac_on_inventory_transaction() (the live
--              AFTER INSERT trigger on inventory_transaction) to stamp
--              last_cost_date from NEW.transaction_date instead of
--              CURRENT_TIMESTAMP, so a backdated StockIn doesn't leave
--              last_cost_date pointing at today.

BEGIN;

-- ────────────────────────────────────────────
-- 1. recompute_wac_for_part(part_id) — single-part replay, extracted verbatim
--    from recompute_all_wac()'s inner loop (database/scripts/recompute_wac.sql).
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

    RETURN QUERY SELECT v_old_wac, ROUND(current_wac::numeric, 2);
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────
-- 2. recompute_all_wac() now just loops over recompute_wac_for_part().
--    Behaviorally identical to the original inline version.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_all_wac()
RETURNS void AS $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT part_id FROM public.part LOOP
        PERFORM public.recompute_wac_for_part(p.part_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────
-- 3. Fix the live insert trigger to stamp last_cost_date from the
--    transaction's own date, not "now". Matches recompute_wac_for_part's
--    semantics so the two never diverge for the newest StockIn.
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_wac_on_inventory_transaction()
RETURNS trigger AS $$
DECLARE
    prev_stock NUMERIC;
    current_wac NUMERIC;
    new_quantity NUMERIC := NEW.quantity;
    new_cost NUMERIC := COALESCE(NEW.unit_cost, 0);
    new_wac NUMERIC;
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

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
