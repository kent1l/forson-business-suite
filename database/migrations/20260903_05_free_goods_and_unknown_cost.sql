-- Migration: 20260903_05_free_goods_and_unknown_cost.sql
-- Description: Separate "this stock was genuinely free" from "nobody recorded what this
--              stock cost", and stop invoice reversals masquerading as receipts.
--
--   Both problems come from the same place: inventory_transaction.unit_cost = 0.00 has
--   been made to mean two irreconcilable things, and weighted average cost believes it.
--
--   1,546 goods receipt lines carry cost_price = 0. Seventy-four of the receipts they
--   belong to also contain properly priced lines, which is the signature of an encoder
--   skipping a cost rather than a supplier giving stock away. Each of those lines posted
--   0.00 into the cost average and dragged the part's WAC toward zero -- 1,235 parts are
--   affected. But free goods are real in this trade (supplier freebies, warranty
--   replacements), and a system that cannot record them forces staff to invent a price.
--
--   So the two cases are separated explicitly:
--
--     - goods_receipt_line.is_free_goods marks stock that really did arrive at no
--       charge. It posts unit_cost = 0.00 and DOES enter the average: ten free units on
--       top of ten held at 100 makes the average 50, because 1,000 was paid for twenty
--       units. That is what the figure is for.
--
--     - A zero cost with no such mark is an unknown cost. It posts unit_cost = NULL,
--       adds its quantity to stock, and is skipped by the average entirely -- the
--       running average carries forward instead. NULL is not a new convention here: the
--       1,260 adjustment and cycle-count rows already use it to mean exactly this.
--
--   Nothing is blocked. A receipt with a cost nobody knows is still a receipt, and
--   refusing it would only push the encoder into typing a number they are guessing at,
--   which is worse than an honest gap. The API warns instead.
--
--   Separately: voiding a sales invoice returns stock to the shelf, and invoiceRoutes
--   did that by inserting trans_type = 'StockIn' at the line's cost_at_sale. That fires
--   trg_update_wac, so undoing a sale rewrote part.last_cost with a sale-side figure and
--   moved the average. A sale never changed WAC; undoing one must not either. Those rows
--   are retyped to 'Reversal', a type no trigger watches. 426 parts currently carry a
--   last_cost that came from a void this way, 356 of them zero.
--
--   This migration only reshapes the data. 20260903_06 rewrites the derivation that
--   reads it, and must run after this one.

BEGIN;

-- ────────────────────────────────────────────
-- 1. Free goods, as a property of the receipt line
-- ────────────────────────────────────────────
ALTER TABLE public.goods_receipt_line
    ADD COLUMN IF NOT EXISTS is_free_goods boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.goods_receipt_line.is_free_goods IS
    'This line arrived at no charge (supplier freebie, warranty replacement). It posts unit_cost 0.00 and lowers the weighted average, which is correct: the units are real and they cost nothing. A zero cost WITHOUT this mark means nobody recorded the cost, posts NULL, and is skipped by the average instead.';

-- A free line still costs money to ship, so it may carry freight and its landed cost is
-- that freight share. What it must not have is a positive goods cost, which would make
-- the mark a lie.
ALTER TABLE public.goods_receipt_line DROP CONSTRAINT IF EXISTS goods_receipt_line_free_goods_check;
ALTER TABLE public.goods_receipt_line ADD CONSTRAINT goods_receipt_line_free_goods_check
    CHECK (NOT is_free_goods OR COALESCE(cost_price, 0) = 0);

-- ────────────────────────────────────────────
-- 2. Existing zero costs are unknown costs, not free goods
-- ────────────────────────────────────────────
-- There was no way to record free goods before this migration, so every zero-cost
-- StockIn in history is a cost that was never captured. Dated rows keep their dates;
-- only the cost claim is withdrawn.
UPDATE public.inventory_transaction
   SET unit_cost = NULL
 WHERE trans_type = 'StockIn'
   AND unit_cost = 0;

-- ────────────────────────────────────────────
-- 3. Invoice reversals are not receipts
-- ────────────────────────────────────────────
-- Matched on the note the reversal writes rather than on reference_no, because an
-- invoice number prefix is a formatting convention and this is a statement about what
-- the row means. 'Invoice deleted' is a legacy path no longer present in the code;
-- 'Invoice voided' is the one still reachable today.
UPDATE public.inventory_transaction
   SET trans_type = 'Reversal',
       unit_cost  = NULL
 WHERE trans_type = 'StockIn'
   AND notes IN ('SYSTEM REVERSAL: Invoice voided', 'SYSTEM REVERSAL: Invoice deleted');

-- Stock on hand is a running SUM over quantity and is untouched by both updates above:
-- neither changes a quantity, only what the row claims about cost.

COMMIT;
