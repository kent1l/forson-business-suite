-- Migration: 20260820_02_add_goods_receipt_void_support.sql
-- Description: Adds the ability to void a posted goods receipt (GRN) from
--              Goods Receipt History. Voiding never deletes the GRN or its
--              lines — it's an accounting-style reversal that keeps full
--              history while simulating "this never happened":
--                - goods_receipt gains a status/void audit trail (mirrors the
--                  invoice 'Cancelled' pattern, see invoiceRoutes.js DELETE
--                  /invoices/:id).
--                - goods_receipt gains po_id, persisted at creation time, so
--                  a later void can accurately roll back the specific PO's
--                  quantity_received instead of guessing from supplier_bill.
--                  Backfilled best-effort for existing rows via the bill they
--                  auto-created (see 20260813_05_add_goods_receipt_bill_link.sql).
--                - supplier_bill.status gains 'Void' so a bill whose only GRN
--                  gets voided can be marked accordingly without violating its
--                  CHECK constraint (20260812_02_create_supplier_bill_and_ap_payment.sql).

BEGIN;

ALTER TABLE goods_receipt
    ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'Active'
        CHECK (status IN ('Active', 'Voided')),
    ADD COLUMN IF NOT EXISTS voided_at timestamptz,
    ADD COLUMN IF NOT EXISTS voided_by integer REFERENCES employee(employee_id),
    ADD COLUMN IF NOT EXISTS void_reason text,
    ADD COLUMN IF NOT EXISTS po_id integer REFERENCES purchase_order(po_id);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_status ON goods_receipt(status) WHERE status = 'Voided';

-- Best-effort backfill: only recoverable for receipts that auto-created their own
-- bill (supplier_bill.grn_id = this GRN), since that's the only place po_id was
-- ever recorded prior to this migration. Receipts that attached to a pre-existing
-- manually-created bill have no recoverable po_id and are left NULL.
UPDATE goods_receipt gr
SET po_id = sb.po_id
FROM supplier_bill sb
WHERE sb.grn_id = gr.grn_id
  AND sb.po_id IS NOT NULL
  AND gr.po_id IS NULL;

ALTER TABLE supplier_bill DROP CONSTRAINT IF EXISTS supplier_bill_status_check;
ALTER TABLE supplier_bill ADD CONSTRAINT supplier_bill_status_check
    CHECK (status IN ('Unpaid', 'Partially Paid', 'Paid', 'Void'));

-- Voided bills carry no AP liability, so the existing "open bills" index
-- (status != 'Paid') would otherwise keep scanning them; extend the predicate.
DROP INDEX IF EXISTS idx_supplier_bill_status;
CREATE INDEX IF NOT EXISTS idx_supplier_bill_status ON supplier_bill(status) WHERE status NOT IN ('Paid', 'Void');

INSERT INTO public.permission (permission_key, description, category) VALUES
    ('goods_receipt:void', 'Void Goods Receipts', 'Inventory & Purchasing')
ON CONFLICT (permission_key) DO NOTHING;

-- Voiding reverses stock and AP liability, so keep it more restricted than
-- goods_receipt:edit — Admin and Manager only, matching invoice:delete's
-- precedent of scoping destructive/reversal actions tighter than edits.
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM public.permission_level pl
CROSS JOIN public.permission p
WHERE p.permission_key = 'goods_receipt:void'
  AND pl.level_name IN ('Admin', 'Manager')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permission rp
    WHERE rp.permission_level_id = pl.permission_level_id
      AND rp.permission_id = p.permission_id
  )
ON CONFLICT DO NOTHING;

COMMIT;
