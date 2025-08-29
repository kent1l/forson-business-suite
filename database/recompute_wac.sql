-- recompute_wac.sql
-- Recomputes the WAC (weighted average cost) for all parts by replaying
-- inventory_transaction rows with trans_type = 'StockIn' in chronological order.
--
-- Usage (psql):
-- psql -h <host> -U <user> -d <db> -f database/recompute_wac.sql
--
-- This script defines a function and then calls it. It is idempotent and
-- safe to run multiple times.

BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_all_wac()
RETURNS void AS $$
DECLARE
    p RECORD;
    t RECORD;
    prev_stock NUMERIC;
    current_wac NUMERIC;
    last_unit_cost NUMERIC;
    last_date TIMESTAMP WITH TIME ZONE;
BEGIN
    FOR p IN SELECT part_id FROM public.part LOOP
        prev_stock := 0;
        current_wac := 0;
        last_unit_cost := NULL;
        last_date := NULL;

        FOR t IN
            SELECT quantity, COALESCE(unit_cost, 0) AS unit_cost, transaction_date
            FROM public.inventory_transaction
            WHERE part_id = p.part_id
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

        -- Update part with computed values. If there were no StockIn rows, leave values as-is.
        IF last_unit_cost IS NOT NULL THEN
            UPDATE public.part
            SET wac_cost = ROUND(current_wac::numeric, 2),
                last_cost = last_unit_cost,
                last_cost_date = last_date
            WHERE part_id = p.part_id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run the recompute function
SELECT public.recompute_all_wac();

COMMIT;

-- After running this script, reindex parts in Meilisearch so the frontend's search index contains the updated wac_cost values.
-- You can run the existing reindex script in the api package:
--
-- cd packages/api
-- node scripts/reindexParts.js
--
-- Or run the app's Data Utils "Sync Parts to MeiliSearch" from the web UI.
