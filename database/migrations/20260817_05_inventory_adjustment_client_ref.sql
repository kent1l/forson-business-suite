-- Migration: make stock adjustments replay-safe.
-- Date: 2026-08-17 (Asia/Manila)
--
-- POST /inventory/adjust appends a signed delta to inventory_transaction, and
-- stock on hand is derived as SUM(quantity) over that table. Until now the
-- table carried no unique constraint of any kind beyond its surrogate key, so
-- a retried request inserted a second row with the same delta and moved stock
-- by twice the intended amount -- leaving two individually plausible audit
-- rows and no way to tell which was the duplicate.
--
-- That is why the mobile outbox refused to queue adjustments at all. The fix
-- is an anchor: a client-generated id the server can recognise on a replay.
-- Same shape as uq_time_punch_client_id (20260814_04) and
-- uq_staged_sale_client_ref (20260814_05); nothing new is invented here.
--
-- The index is global on client_ref rather than (part_id, client_ref): a client
-- UUID is unique per intent, so scoping it to a part would let the same id be
-- reused against a different part, which is strictly weaker.

BEGIN;

ALTER TABLE public.inventory_transaction
    ADD COLUMN IF NOT EXISTS client_ref uuid;

ALTER TABLE public.inventory_transaction
    ADD COLUMN IF NOT EXISTS captured_at timestamptz;

COMMENT ON COLUMN public.inventory_transaction.client_ref IS
    'Client-generated idempotency key for writes queued offline. NULL for server-originated rows (sales, receipts, web adjustments).';

COMMENT ON COLUMN public.inventory_transaction.captured_at IS
    'When an offline adjustment was made on the device. Audit only -- transaction_date stays at receipt time so stock history is never rewritten.';

-- Partial, so every existing row and every server-originated write stays
-- exempt. The predicate also keeps the index empty on day one.
--
-- Built without CONCURRENTLY on purpose: this table is the busiest in the
-- system, but at ~13.7k rows the scan is sub-second, and a plain build keeps
-- this migration transactional and consistent with the rest of the directory.
-- If this table ever grows into the millions, a future index here must use
-- CONCURRENTLY and therefore must not be wrapped in BEGIN/COMMIT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_transaction_client_ref
    ON public.inventory_transaction (client_ref) WHERE client_ref IS NOT NULL;

COMMIT;
