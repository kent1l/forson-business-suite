-- Migration: Give tax_rate the integrity constraints it was relying on the app for
-- Date: 2026-08-30 (Asia/Manila)
--
-- tax_rate stores rate_percentage as a decimal fraction (0.12 = 12%), but until now
-- that convention lived only in the API routes and the settings form. Three gaps
-- followed from that:
--
-- 1. No range check. A rate stored as 12 (meaning 12%) rather than 0.12 was accepted
--    by the database, and the calculation service used to silently divide anything
--    above 1 by 100 to compensate. That guess is unsafe at the boundary: a rate of 1
--    entered as "1%" would have been read as 100%. With the range enforced here, the
--    service now clamps and logs instead of guessing.
-- 2. No unique rate_name, even though taxRateRoutes.js already handles a 23505 unique
--    violation on create and update -- error handling for a constraint that did not
--    exist, so duplicate names were accepted silently.
-- 3. Nothing enforcing a single default. The set-default endpoint clears every
--    is_default then sets one, inside a transaction; with no constraint behind it,
--    two concurrent requests could interleave and leave zero or two defaults. The
--    partial unique index makes the loser of that race fail cleanly, which the route
--    now reports as a 409.
--
-- Existing data was checked for all three violations before writing this migration
-- and came back clean, so these are added validated rather than NOT VALID.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tax_rate_percentage_range') THEN
        ALTER TABLE public.tax_rate
            ADD CONSTRAINT chk_tax_rate_percentage_range
            CHECK (rate_percentage >= 0 AND rate_percentage <= 1);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_tax_rate_rate_name') THEN
        ALTER TABLE public.tax_rate
            ADD CONSTRAINT uq_tax_rate_rate_name UNIQUE (rate_name);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_rate_single_default
    ON public.tax_rate (is_default)
    WHERE is_default = true;

COMMIT;
