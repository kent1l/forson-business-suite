-- Migration: 20260903_07_fix_pos_cheque_pdc_status.sql
-- Description: Fix cheques taken at POS / Invoicing that were recorded as already
--              cleared.
--
--              invoice_payments.pdc_status defaults to 'CLEARED', and the invoice
--              creation route never set it, so every cheque rung up through the
--              split payment modal landed in the PDC & Clearance Desk showing
--              CLEARED — with no Verify / Bounce actions — even though the money
--              had not been banked and the payment itself was still 'pending'.
--              The route now sets 'RECEIVED' explicitly; this backfills the rows
--              already recorded that way.
--
--              Deliberately scoped to rows that are still pending: a cheque whose
--              payment_status is 'settled' really was cleared through the desk and
--              must keep pdc_status = 'CLEARED'.

UPDATE invoice_payments ip
SET pdc_status = 'RECEIVED'
FROM payment_methods pm
WHERE pm.method_id = ip.method_id
  AND ip.payment_status = 'pending'
  AND ip.pdc_status = 'CLEARED'
  AND (pm.code IN ('cheque', 'pdc') OR pm.type = 'cheque' OR LOWER(pm.name) LIKE '%cheque%');
