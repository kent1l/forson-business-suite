-- Migration: 20260903_04_ap_enable_cheque_payment_method.sql
-- Date: 2026-09-03 (Asia/Manila)
-- Description: Let "Cheque" be picked as a payment method when recording a
--              supplier payment.
--
-- 20260820_02_ap_direct_payment_methods.sql deliberately left cheque
-- ap_enabled = false, because the only settlement path at the time
-- (apPaymentService.recordDirectPayment) writes an ap_payment born 'CLEARED'
-- with no instrument behind it — wrong for a cheque, which still has to be
-- deposited and can clear, bounce, go stale, or be replaced.
--
-- The reason for that exclusion was the settlement path, not the method. The
-- method list is now also the menu shown by Record Supplier Payment, and a
-- cheque selected there is routed to apPdcService.issueOutboundCheque — the
-- exact code the Treasury desk's Issue Outbound Cheque form calls — so a
-- cheque_records row is still created and the instrument lifecycle still
-- applies. recordDirectPayment refuses cheque methods outright, so the
-- CLEARED-with-no-instrument row this flag once guarded against remains
-- impossible.

BEGIN;

UPDATE public.payment_methods
SET ap_enabled = true
WHERE code IN ('cheque', 'pdc');

COMMENT ON COLUMN public.payment_methods.ap_enabled IS
    'Whether this method may be used to settle an Accounts Payable liability (outbound disbursement). Independent of "enabled", which governs inbound POS/AR collection. Cheque methods are included, but are settled through the outbound cheque issuance path (a cheque_records row + PDC lifecycle), never as an immediately-cleared direct payment.';

COMMIT;
