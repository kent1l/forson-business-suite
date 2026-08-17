-- Migration: make ad-hoc cycle count submissions replay-safe.
-- Date: 2026-08-17 (Asia/Manila)
--
-- POST /inventory/cycle-count/unassigned-find inserts a new cycle_count_line
-- row -- and, when the variance auto-approves, an inventory_transaction
-- adjustment -- on every call, with nothing to recognise a retry by. That is
-- exactly the shape 20260817_05 fixed for /inventory/adjust, and it is why
-- the mobile outbox never queued ad-hoc counts at all: a retried submission
-- would double the count line and double the stock adjustment.
--
-- Same shape as uq_time_punch_client_id (20260814_04), uq_staged_sale_client_ref
-- (20260814_05), and uq_inventory_transaction_client_ref (20260817_05).

BEGIN;

ALTER TABLE public.cycle_count_line
    ADD COLUMN IF NOT EXISTS client_ref uuid;

COMMENT ON COLUMN public.cycle_count_line.client_ref IS
    'Client-generated idempotency key for ad-hoc counts queued offline. NULL for assigned-batch lines and server-originated rows.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cycle_count_line_client_ref
    ON public.cycle_count_line (client_ref) WHERE client_ref IS NOT NULL;

COMMIT;
