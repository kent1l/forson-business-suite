-- Migration: enable non-PDC (direct) supplier payment settlement.
-- Date: 2026-08-20 (Asia/Manila)
--
-- Until now the only way to pay a supplier was to issue an outbound cheque via
-- the Treasury desk (apPdcService.issueOutboundCheque). Cash, bank transfer and
-- e-wallet disbursements had nowhere to be recorded, so those payments never hit
-- ap_ledger and the supplier balance stayed overstated.
--
-- payment_methods is shared with POS/AR, where it lists ways money comes IN.
-- Several of those rows are meaningless as outbound disbursements (on_account
-- and store_wallet are customer credit constructs; credit/debit card are card
-- acquiring, not payables). Rather than filter by hardcoded code lists in the
-- API, mark AP applicability explicitly so it stays configurable from Settings.
--
-- 'cheque' is deliberately NOT ap_enabled: outbound cheques carry a whole
-- instrument lifecycle (issue -> deposit -> clear/bounce -> replace) and must go
-- through the Treasury desk so a cheque_records row is created. Allowing them in
-- the direct-settlement form would create ap_payment rows with no physical
-- instrument backing them.

BEGIN;

ALTER TABLE public.payment_methods
    ADD COLUMN IF NOT EXISTS ap_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payment_methods.ap_enabled IS
    'Whether this method may be used to settle an Accounts Payable liability (outbound disbursement). Independent of "enabled", which governs inbound POS/AR collection.';

CREATE INDEX IF NOT EXISTS idx_payment_methods_ap_enabled
    ON public.payment_methods (ap_enabled, sort_order) WHERE ap_enabled;

UPDATE public.payment_methods
SET ap_enabled = true
WHERE code IN ('cash', 'bank_transfer', 'gcash', 'paymaya');

COMMIT;
