-- ---------------------------------------------------------------------------
-- Idempotency for staged sales
-- ---------------------------------------------------------------------------
-- POST /sales/staging has no natural key: two genuine walk-in cash sales for
-- the same amount, seconds apart, are indistinguishable and both legitimate. So
-- there is nothing the server can dedupe on by itself.
--
-- That is fine while the client is online and reports failures immediately, but
-- the mobile app now queues writes and retries them. A retry whose original
-- request actually succeeded -- the reply was lost, not the write -- would stage
-- the sale a second time, and a cashier would find a duplicate waiting in the
-- approval desk.
--
-- A client-generated reference solves it: the same queued sale carries the same
-- id however many times it is flushed, and the second insert is a no-op.

BEGIN;

ALTER TABLE public.staged_sale
    ADD COLUMN IF NOT EXISTS client_ref UUID;

-- Partial, so sales staged from the web -- which has no queue and generates no
-- reference -- are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staged_sale_client_ref
    ON public.staged_sale (client_ref) WHERE client_ref IS NOT NULL;

COMMIT;
