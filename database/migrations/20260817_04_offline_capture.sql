-- Migration: record when an offline mobile write was actually captured.
-- Date: 2026-08-17 (Asia/Manila)
--
-- The shop has no power backup for the server, so a blackout takes the API and
-- every desktop terminal down while the phones keep working. Sales rung up
-- during that window are queued on the device and flushed when the server
-- returns, which can be hours later.
--
-- `staged_date` answers "when did the server learn of this sale". That is a
-- real and useful fact -- it is what the approval queue is ordered by today --
-- but it is not when the customer paid. Overwriting it with the capture time
-- would destroy the record of sync latency and silently reorder the approval
-- queue, so capture time gets its own column instead and both facts are kept.

BEGIN;

ALTER TABLE public.staged_sale
    ADD COLUMN IF NOT EXISTS captured_at timestamptz;

-- No backfill: a NULL correctly means "captured at the moment it was received",
-- which is true of every sale staged before this migration.
COMMENT ON COLUMN public.staged_sale.captured_at IS
    'When the sale was rung up on the device. NULL means it was captured at receipt time (all web-staged sales).';

ALTER TABLE public.staged_sale
    ADD COLUMN IF NOT EXISTS source varchar(20);

-- staged_sale has never had a `source` column, so unlike time_punch there is no
-- pre-existing inline CHECK to find and replace -- a plainly named one is added.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.staged_sale'::regclass AND conname = 'staged_sale_source_chk'
    ) THEN
        ALTER TABLE public.staged_sale ADD CONSTRAINT staged_sale_source_chk
            CHECK (source IS NULL OR source IN ('Web', 'Mobile', 'Mobile-Offline'));
    END IF;
END$$;

COMMENT ON COLUMN public.staged_sale.source IS
    'Where the sale was staged from. Mobile-Offline means it sat queued on a device before reaching the server.';

-- One window governs every offline mobile write rather than a key per route:
-- "how stale may a queued write be before a human should look at it" is a
-- single business question, and three separately-drifting answers to it would
-- be harder to reason about than one.
--
-- Deliberately <= 24h. A backdated capture time now drives invoice_date, so a
-- longer window would let a queued sale land in an already-closed month or tax
-- period. Raising it past a day needs a period-lock check first.
INSERT INTO settings (setting_key, setting_value, description)
VALUES (
    'MOBILE_OFFLINE_MAX_BACKDATE_MINUTES',
    '720',
    'How far back a mobile write captured offline may be dated before the server rejects it. Keep at or below 1440 (24h): capture time drives invoice_date, so a longer window can post into a closed accounting period.'
)
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
