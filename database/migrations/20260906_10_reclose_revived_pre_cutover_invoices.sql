-- Migration: 20260906_10_reclose_revived_pre_cutover_invoices.sql
-- Description: Re-mark pre-cutover (before 2026-08-19) invoices accidentally
--              revived by migration 20260903_07 back to 'Written Off'.
--
-- Safety Guarantees:
-- 1. Strict date barrier: only affects rows with invoice_date < '2026-08-19'.
-- 2. Strict sequence barrier: invoice_id < 100000 (post-cutover rows are 100000+).
-- 3. Only targets open statuses: status IN ('Unpaid', 'Partially Paid').
-- 4. Does not alter ar_ledger, payments, customer balances, or post-cutover sales.
-- 5. Terminal guard in recompute_invoice_settlement() ensures permanence.

BEGIN;

UPDATE public.invoice
   SET status = 'Written Off'
 WHERE invoice_date < '2026-08-19'
   AND invoice_id < 100000
   AND status IN ('Unpaid', 'Partially Paid');

COMMIT;
