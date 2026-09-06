-- Migration: 20260906_09_uncap_rounding_reason.sql
-- Description: Remove the 1.00 cap on the ROUNDING concession reason.
--
-- 20260906_05 seeded ar_adjustment_reason.ROUNDING with max_amount = 1.00, on the
-- reasoning that a "centavo adjustment" bucket left uncapped could quietly absorb
-- a real concession.
--
-- That cap was set too tight for how the counter actually works. Rounding a
-- settlement down to a whole peso, or to the nearest five, is ordinary practice
-- here, and a 1.00 ceiling refuses the everyday case it was written to serve --
-- a clerk closing 12,847.35 at 12,845.00 is doing exactly what this reason is
-- for. A control that refuses the ordinary case does not get followed; it gets
-- worked around by picking a different reason code, which is worse than no cap
-- at all because it also corrupts the reason data the summary report is built on.
--
-- NULL means uncapped, the same as every other seeded reason bar this one. The
-- concession is still bounded by what is actually outstanding on the invoice
-- (arAdjustmentService.createAdjustment), still requires a named invoice for
-- every peso, still names who granted it and who authorized them, and still
-- appears in GET /ar/adjustments/summary under its own reason code -- so an
-- amount that is not really a rounding remains visible as one, rather than being
-- blocked from ever being recorded honestly.
--
-- max_amount stays an editable column: the owner can set a ceiling from
-- Settings > A/R Adjustments at any time without another migration.

BEGIN;

UPDATE public.ar_adjustment_reason
   SET max_amount = NULL
 WHERE reason_code = 'ROUNDING';

COMMIT;
