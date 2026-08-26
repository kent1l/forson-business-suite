-- Migration: 20260826_04_stock_reconciliation_log.sql
-- Description: Record and surface automatic reconciliations of backfilled receipts.
--
--   A cycle count records physical reality without knowing why it differs from the
--   books: it posts one catch-all adjustment for whatever it found. If a receipt for
--   that same stock is backfilled afterwards but dated before the count, the quantity
--   is counted twice -- once by the count's adjustment, once by the receipt -- because
--   nothing links the two.
--
--   The fix is to give such a receipt its cost effect but no net quantity effect: the
--   count already established the current stock level, so a receipt predating it is
--   documentation, not new inventory. A compensating adjustment of exactly the
--   backfilled quantity is posted alongside it.
--
--   Deliberately NOT "set stock back to the counted quantity": sales made after the
--   count are real and must survive. Reconciling to the counted figure would silently
--   undo them.
--
--   This table exists because that correction must not be silent. It happens
--   automatically -- an encoder should not have to reason about count dates while
--   copying an invoice -- but every occurrence is recorded with the timeline that
--   produced it, for a manager to review.
--
--   unexplained_shortfall is the reason this is worth reviewing rather than just
--   logging. The count's own variance is how much stock it found that the books could
--   not explain. When a backfill documents MORE than that variance, the surplus is
--   stock that provably arrived and was never found -- sold unrecorded, miscounted, or
--   lost. That number is a genuine finding, not bookkeeping noise.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_reconciliation_log (
    recon_id                SERIAL PRIMARY KEY,
    part_id                 INTEGER NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,

    -- The backfilled receipt that triggered this.
    grn_id                  INTEGER REFERENCES public.goods_receipt(grn_id) ON DELETE SET NULL,
    grn_number              VARCHAR(50),
    supplier_invoice_no     VARCHAR(100),
    receipt_date            TIMESTAMP WITH TIME ZONE NOT NULL,
    backfill_qty            NUMERIC(12,4) NOT NULL,

    -- The compensating adjustment actually posted (negative of backfill_qty).
    reconcile_qty           NUMERIC(12,4) NOT NULL,

    -- The count that made this necessary.
    cycle_count_line_id     INTEGER REFERENCES public.cycle_count_line(line_id) ON DELETE SET NULL,
    counted_qty             NUMERIC(12,4),
    counted_at              TIMESTAMP WITH TIME ZONE,
    count_variance_qty      NUMERIC(12,4),

    -- Stock the documents prove arrived but the count never found. Positive values
    -- deserve a look; zero or negative means the count fully accounts for the receipt.
    unexplained_shortfall   NUMERIC(12,4),

    stock_before            NUMERIC(12,4),
    stock_after             NUMERIC(12,4),
    wac_before              NUMERIC(12,4),
    wac_after               NUMERIC(12,4),

    status                  VARCHAR(20) NOT NULL DEFAULT 'OPEN',  -- OPEN | REVIEWED
    reviewed_by             INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    reviewed_at             TIMESTAMP WITH TIME ZONE,
    review_notes            TEXT,

    created_by              INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_recon_status  ON public.stock_reconciliation_log(status) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_stock_recon_part    ON public.stock_reconciliation_log(part_id);
CREATE INDEX IF NOT EXISTS idx_stock_recon_created ON public.stock_reconciliation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_recon_short   ON public.stock_reconciliation_log(unexplained_shortfall DESC)
    WHERE unexplained_shortfall > 0;

INSERT INTO permission (permission_key, description, category) VALUES
    ('stock_reconciliation:manage', 'Review automatic stock reconciliations and investigate unexplained shortfalls', 'Inventory')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT lvl, p.permission_id
FROM permission p
CROSS JOIN (VALUES (7), (10)) AS t(lvl)
WHERE p.permission_key = 'stock_reconciliation:manage'
ON CONFLICT (permission_level_id, permission_id) DO NOTHING;

COMMIT;
