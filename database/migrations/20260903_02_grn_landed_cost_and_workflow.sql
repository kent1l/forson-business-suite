-- Migration: 20260903_02_grn_landed_cost_and_workflow.sql
-- Description: Landed cost, freight-in, multi-level discounts, a draft/approval
--              workflow and returns on the goods receipt document.
--
--   Until now a receipt recorded only what the encoder typed into cost_price, and
--   posted that straight to inventory_transaction.unit_cost — which is what feeds
--   weighted average cost. Freight paid to get the shipment to the store was invisible
--   to costing, so unit cost was understated by the delivery charge and every retail
--   price derived from it was too low. Heavy items (brake drums, batteries, leaf
--   springs, bumpers) distort this badly, because a value-based split charges them the
--   same share as a box of clips that cost the same but weighs nothing.
--
--   The columns below let a receipt carry the whole commercial picture:
--
--     - freight_amount + freight_allocation_method spread the delivery charge across
--       lines, with goods_receipt_line.override_freight_amount reserving a flat amount
--       for heavy items before the rest is pro-rated over what remains.
--     - line and header discounts, each expressible as a percentage OR an amount but
--       never both (the same XOR rule as invoice discounts, see
--       20260830_01_add_discount_amount_check_constraints.sql).
--     - landed_unit_cost is the result of all of that, and is what actually posts to
--       inventory. allocated_freight_amount is persisted alongside it so a posted
--       receipt can always explain how its cost was arrived at, without re-deriving.
--
--   workflow_status is deliberately a SEPARATE column from status. status
--   ('Active'/'Voided', see 20260820_02_add_goods_receipt_void_support.sql) records
--   whether a posted receipt was later reversed; workflow_status records how far the
--   document has travelled toward being posted at all. They are orthogonal — a
--   receipt can be Posted and Voided — and a great deal of existing code filters on
--   status = 'Active', which would silently change meaning if the values were merged.
--
--   It defaults to 'Posted' so every existing row, and the unchanged one-shot
--   POST /goods-receipts path, are correct with no backfill: those documents did go
--   straight to posted, and there was never a draft stage to record.
--
--   Draft and Submitted receipts have NO financial effect whatsoever — no stock, no
--   WAC recalculation, no supplier bill, no ap_ledger entry, no purchase order
--   movement. That is enforced in the API by keeping all of those writes inside the
--   posting service, which only the post transition reaches.

BEGIN;

-- ────────────────────────────────────────────
-- 1. Header: workflow, freight, discounts, audit
-- ────────────────────────────────────────────
ALTER TABLE public.goods_receipt
    ADD COLUMN IF NOT EXISTS workflow_status varchar(20) NOT NULL DEFAULT 'Posted',
    ADD COLUMN IF NOT EXISTS freight_amount numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS freight_allocation_method varchar(10) NOT NULL DEFAULT 'METHOD_A',
    ADD COLUMN IF NOT EXISTS freight_supplier_id integer REFERENCES public.supplier(supplier_id),
    ADD COLUMN IF NOT EXISTS freight_bill_id integer REFERENCES public.supplier_bill(bill_id),
    ADD COLUMN IF NOT EXISTS overall_discount_percent numeric(5,2),
    ADD COLUMN IF NOT EXISTS overall_discount_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS sync_retail_prices boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_by integer REFERENCES public.employee(employee_id),
    ADD COLUMN IF NOT EXISTS submitted_by integer REFERENCES public.employee(employee_id),
    ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
    ADD COLUMN IF NOT EXISTS posted_by integer REFERENCES public.employee(employee_id),
    ADD COLUMN IF NOT EXISTS posted_at timestamptz,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.goods_receipt DROP CONSTRAINT IF EXISTS goods_receipt_workflow_status_check;
ALTER TABLE public.goods_receipt ADD CONSTRAINT goods_receipt_workflow_status_check
    CHECK (workflow_status IN ('Draft', 'Submitted', 'Posted', 'Cancelled'));

-- METHOD_A is pro-rata by net invoice value and is the only method implemented today.
-- METHOD_B (weight/volume) is reserved: the catalogue carries no weight or dimension
-- data yet, so there is nothing for it to allocate on. The value is accepted by the
-- constraint so adding it later needs no migration.
ALTER TABLE public.goods_receipt DROP CONSTRAINT IF EXISTS goods_receipt_freight_method_check;
ALTER TABLE public.goods_receipt ADD CONSTRAINT goods_receipt_freight_method_check
    CHECK (freight_allocation_method IN ('METHOD_A', 'METHOD_B'));

ALTER TABLE public.goods_receipt DROP CONSTRAINT IF EXISTS goods_receipt_overall_discount_check;
ALTER TABLE public.goods_receipt ADD CONSTRAINT goods_receipt_overall_discount_check
    CHECK (overall_discount_percent IS NULL OR overall_discount_amount IS NULL);

ALTER TABLE public.goods_receipt DROP CONSTRAINT IF EXISTS goods_receipt_overall_discount_range_check;
ALTER TABLE public.goods_receipt ADD CONSTRAINT goods_receipt_overall_discount_range_check
    CHECK ((overall_discount_percent IS NULL OR (overall_discount_percent >= 0 AND overall_discount_percent <= 100))
       AND (overall_discount_amount IS NULL OR overall_discount_amount >= 0));

ALTER TABLE public.goods_receipt DROP CONSTRAINT IF EXISTS goods_receipt_freight_amount_check;
ALTER TABLE public.goods_receipt ADD CONSTRAINT goods_receipt_freight_amount_check
    CHECK (freight_amount >= 0);

COMMENT ON COLUMN public.goods_receipt.workflow_status IS
    'How far this document has travelled toward posting: Draft, Submitted, Posted or Cancelled. Orthogonal to status, which records whether a posted receipt was later voided. Draft and Submitted receipts have no inventory, WAC, bill or ledger effect.';
COMMENT ON COLUMN public.goods_receipt.freight_amount IS
    'Total delivery charge for this shipment, capitalised into inventory via each line''s landed_unit_cost rather than expensed.';
COMMENT ON COLUMN public.goods_receipt.freight_supplier_id IS
    'The carrier the freight is owed to. Freight is billed separately from the goods, so it posts its own supplier_bill against this supplier rather than inflating the goods bill.';
COMMENT ON COLUMN public.goods_receipt.freight_bill_id IS
    'The supplier_bill created for this receipt''s freight, if any. The goods bill is goods_receipt.bill_id.';
COMMENT ON COLUMN public.goods_receipt.sync_retail_prices IS
    'When true, posting this receipt pushes each line''s sale_price to part.last_sale_price. Cleared when a receipt should update cost but leave shelf prices alone.';

-- ────────────────────────────────────────────
-- 2. Lines: discounts, freight share, landed cost, returns
-- ────────────────────────────────────────────
ALTER TABLE public.goods_receipt_line
    ADD COLUMN IF NOT EXISTS line_discount_percent numeric(5,2),
    ADD COLUMN IF NOT EXISTS line_discount_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS override_freight_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS allocated_freight_amount numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS landed_unit_cost numeric(12,4),
    ADD COLUMN IF NOT EXISTS effective_markup_percent numeric(6,2) NOT NULL DEFAULT 70.00,
    ADD COLUMN IF NOT EXISTS return_quantity numeric(12,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rejection_reason varchar(100),
    ADD COLUMN IF NOT EXISTS returned_at timestamptz,
    ADD COLUMN IF NOT EXISTS returned_by integer REFERENCES public.employee(employee_id);

ALTER TABLE public.goods_receipt_line DROP CONSTRAINT IF EXISTS goods_receipt_line_discount_check;
ALTER TABLE public.goods_receipt_line ADD CONSTRAINT goods_receipt_line_discount_check
    CHECK (line_discount_percent IS NULL OR line_discount_amount IS NULL);

ALTER TABLE public.goods_receipt_line DROP CONSTRAINT IF EXISTS goods_receipt_line_discount_range_check;
ALTER TABLE public.goods_receipt_line ADD CONSTRAINT goods_receipt_line_discount_range_check
    CHECK ((line_discount_percent IS NULL OR (line_discount_percent >= 0 AND line_discount_percent <= 100))
       AND (line_discount_amount IS NULL OR line_discount_amount >= 0));

-- A return can take back at most what was delivered. Enforced here rather than only in
-- the API because a return that exceeds the receipt would drive stock and the payable
-- in the wrong direction, and nothing downstream re-checks it.
ALTER TABLE public.goods_receipt_line DROP CONSTRAINT IF EXISTS goods_receipt_line_return_qty_check;
ALTER TABLE public.goods_receipt_line ADD CONSTRAINT goods_receipt_line_return_qty_check
    CHECK (return_quantity >= 0 AND return_quantity <= quantity);

ALTER TABLE public.goods_receipt_line DROP CONSTRAINT IF EXISTS goods_receipt_line_override_freight_check;
ALTER TABLE public.goods_receipt_line ADD CONSTRAINT goods_receipt_line_override_freight_check
    CHECK (override_freight_amount IS NULL OR override_freight_amount >= 0);

COMMENT ON COLUMN public.goods_receipt_line.override_freight_amount IS
    'Flat freight charged to this line ahead of any pro-rata split, for heavy items whose delivery cost bears no relation to their invoice value.';
COMMENT ON COLUMN public.goods_receipt_line.allocated_freight_amount IS
    'This line''s final share of the shipment freight, override included. Persisted so a posted receipt can explain its own landed cost.';
COMMENT ON COLUMN public.goods_receipt_line.landed_unit_cost IS
    'Unit cost after line discount, freight share and the pro-rated header discount. This, not cost_price, is what posts to inventory_transaction.unit_cost and therefore drives weighted average cost.';
COMMENT ON COLUMN public.goods_receipt_line.effective_markup_percent IS
    'Markup applied to landed_unit_cost to reach sale_price. Defaults to 70; recalculated backwards when a user types a price directly.';
COMMENT ON COLUMN public.goods_receipt_line.return_quantity IS
    'Units rejected at the dock or returned afterwards. On a draft this simply reduces what is received; on a posted receipt it reverses stock and credits the payable.';

-- ────────────────────────────────────────────
-- 3. Indexes
-- ────────────────────────────────────────────
-- Partial: the overwhelming majority of receipts are Posted, and the only query that
-- filters on this column is the pending-review queue.
CREATE INDEX IF NOT EXISTS idx_goods_receipt_workflow_status
    ON public.goods_receipt (workflow_status) WHERE workflow_status <> 'Posted';

CREATE INDEX IF NOT EXISTS idx_goods_receipt_created_by
    ON public.goods_receipt (created_by);

-- Rebuild the supplier-invoice uniqueness guard so an abandoned draft does not
-- permanently reserve that invoice number. A live draft still blocks a duplicate —
-- that is exactly what the constraint is for — but a cancelled one releases it, the
-- same way a voided receipt already does.
DROP INDEX IF EXISTS uq_goods_receipt_supplier_invoice;
CREATE UNIQUE INDEX IF NOT EXISTS uq_goods_receipt_supplier_invoice
    ON public.goods_receipt (supplier_id, supplier_invoice_no)
    WHERE supplier_invoice_no IS NOT NULL
      AND status <> 'Voided'
      AND workflow_status <> 'Cancelled';

-- ────────────────────────────────────────────
-- 4. Permissions
-- ────────────────────────────────────────────
INSERT INTO public.permission (permission_key, description, category) VALUES
    ('goods_receipt:submit',     'Submit Goods Receipts for Review',        'Inventory & Purchasing'),
    ('goods_receipt:post',       'Post (Approve) Goods Receipts',           'Inventory & Purchasing'),
    ('goods_receipt:return',     'Record Goods Receipt Returns/Rejections', 'Inventory & Purchasing'),
    ('goods_receipt:price_sync', 'Sync Goods Receipt Prices to Catalogue',  'Inventory & Purchasing')
ON CONFLICT (permission_key) DO NOTHING;

-- Anyone who can create a receipt can send it up for review.
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT rp.permission_level_id, p.permission_id
FROM public.role_permission rp
JOIN public.permission src ON src.permission_id = rp.permission_id AND src.permission_key = 'goods_receipt:create'
CROSS JOIN public.permission p
WHERE p.permission_key = 'goods_receipt:submit'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permission x
    WHERE x.permission_level_id = rp.permission_level_id AND x.permission_id = p.permission_id
  )
ON CONFLICT DO NOTHING;

-- Posting commits stock and a payable, and returning reverses them; both stay tighter
-- than :create, following the precedent set for goods_receipt:void.
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM public.permission_level pl
CROSS JOIN public.permission p
WHERE p.permission_key IN ('goods_receipt:post', 'goods_receipt:price_sync')
  AND pl.level_name IN ('Admin', 'Manager')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permission x
    WHERE x.permission_level_id = pl.permission_level_id AND x.permission_id = p.permission_id
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM public.permission_level pl
CROSS JOIN public.permission p
WHERE p.permission_key = 'goods_receipt:return'
  AND pl.level_name IN ('Admin', 'Manager', 'Purchaser')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permission x
    WHERE x.permission_level_id = pl.permission_level_id AND x.permission_id = p.permission_id
  )
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────
-- 5. Backfill landed cost for existing receipts
-- ────────────────────────────────────────────
-- Historical receipts carried no freight and no discounts, so their landed cost is
-- simply what was already posted. Filling it in means every read path can rely on
-- landed_unit_cost rather than branching on whether the column is null.
UPDATE public.goods_receipt_line
SET landed_unit_cost = cost_price
WHERE landed_unit_cost IS NULL;

COMMIT;
