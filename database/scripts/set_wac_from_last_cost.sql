-- set_wac_from_last_cost.sql
-- For parts that have stock_on_hand > 0 but wac_cost = 0, set wac_cost = last_cost
-- This helps surface a reasonable WAC when historical StockIn rows are missing.

BEGIN;

UPDATE public.part p
SET wac_cost = COALESCE(p.last_cost, 0)
FROM (
    SELECT p2.part_id, COALESCE(SUM(it.quantity),0) AS stock_on_hand
    FROM public.part p2
    LEFT JOIN public.inventory_transaction it ON it.part_id = p2.part_id
    GROUP BY p2.part_id
) s
WHERE p.part_id = s.part_id
  AND s.stock_on_hand > 0
  AND (p.wac_cost IS NULL OR p.wac_cost = 0)
  AND COALESCE(p.last_cost,0) > 0;

COMMIT;
