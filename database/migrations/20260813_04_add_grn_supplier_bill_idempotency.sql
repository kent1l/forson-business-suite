-- Migration: 20260813_04_add_grn_supplier_bill_idempotency.sql
-- Description: One auto-generated bill per goods receipt — a partial unique index
--              on supplier_bill.grn_id so the GRN finalization flow can safely
--              be re-triggered (e.g. retries) without ever double-billing a supplier.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_bill_grn_id
    ON supplier_bill(grn_id)
    WHERE grn_id IS NOT NULL;

COMMIT;
