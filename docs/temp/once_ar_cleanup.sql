-- ============================================================================
-- FORSON BUSINESS SUITE - ONE-TIME A/R BALANCE RESET SCRIPT
-- ============================================================================
-- Saved under docs/temp/once_ar_cleanup.sql
--
-- Take a pg_dump backup of the database before running this. It is
-- irreversible once COMMIT runs.
--
-- GOAL: start a clean A/R ledger going forward WITHOUT losing any sales
-- history. Nothing in `invoice`, `invoice_line`, `invoice_payments`,
-- `invoice_payment_allocation`, `customer_payment`, `credit_note`,
-- `credit_note_line`, or `cheque_clearance_log` is deleted or truncated by
-- this script. Every past sale, payment, and credit note stays exactly where
-- it is, fully queryable, reprintable, and auditable.
--
-- What this script actually does:
--   1. Adds 'Written Off' as an allowed invoice status (one-time, inline --
--      not a tracked migration, since this is a one-off operational reset).
--   2. Marks every currently-open invoice (status Unpaid / Partially Paid)
--      as 'Written Off'. This does NOT touch amount_paid, so the true amount
--      actually collected on each invoice stays accurate for any future
--      cash-reconciliation reporting. It only removes them from the AR Aging
--      Report / Overdue list / per-customer invoice list, all of which
--      filter on `status IN ('Unpaid', 'Partially Paid')` in
--      packages/api/routes/arRoutes.js -- a 'Written Off' invoice no longer
--      matches that filter, so no application code changes are needed.
--   3. Truncates ar_ledger, customer_wallet, and customer_wallet_transaction
--      -- these are the only tables the live Statement of Account
--      (`/ar/customers/:id/soa/pdf`) and the AR balance summary
--      (`vw_customer_ar_balance`) read from. Truncating them means SOA and
--      the balance summary come out clean for any date range, with no need
--      to remember a "generate from cutover date" filter.
--   4. Resets customer.credit_hold / credit_hold_reason so no customer stays
--      blocked because of a balance that no longer exists.
--
-- Not touched at all: inventory_transaction, part.wac_cost (no FK/trigger
-- path from any AR table to either), and every AP-side table (ap_payment,
-- and the OUTBOUND_SUPPLIER rows in cheque_clearance_log).
-- ============================================================================

BEGIN;

-- 1. Allow 'Written Off' as an invoice status (one-time, inline).
ALTER TABLE invoice DROP CONSTRAINT check_invoice_status;

ALTER TABLE invoice ADD CONSTRAINT check_invoice_status
  CHECK (status IN (
    'Unpaid',
    'Paid',
    'Partially Paid',
    'Partially Refunded',
    'Fully Refunded',
    'Cancelled',
    'Written Off'
  ));

-- 2. Write off currently-open invoices. amount_paid is left untouched --
--    this is a visibility change (removes them from Aging/Overdue), not a
--    payment record change. `invoice` has no custom triggers (verified via
--    pg_trigger), so this UPDATE cannot re-post anything to ar_ledger.
UPDATE invoice
SET status = 'Written Off'
WHERE status IN ('Unpaid', 'Partially Paid');

-- 3. Reset the A/R balance-tracking layer. Both customer_wallet and
--    customer_wallet_transaction are listed together, so no CASCADE is
--    needed and no other table is affected. ar_ledger has no incoming FKs
--    (verified live) and its immutability trigger only guards UPDATE/DELETE,
--    not TRUNCATE, so this is not blocked by trg_ar_ledger_immutable.
TRUNCATE TABLE
  ar_ledger,
  customer_wallet_transaction,
  customer_wallet
RESTART IDENTITY;

-- 4. Reset customer credit hold flags.
UPDATE customer
SET credit_hold = false,
    credit_hold_reason = NULL;

-- 5. Verification diagnostics.
SELECT
  (SELECT COUNT(*) FROM ar_ledger) AS ar_ledger_rows,
  (SELECT COUNT(*) FROM customer_wallet) AS customer_wallets,
  (SELECT SUM(ledger_balance) FROM vw_customer_ar_balance) AS total_ar_balance,
  (SELECT COUNT(*) FROM invoice) AS invoice_count_untouched,
  (SELECT COUNT(*) FROM invoice_line) AS invoice_line_count_untouched,
  (SELECT COUNT(*) FROM invoice WHERE status = 'Written Off') AS invoices_written_off,
  (SELECT COUNT(*) FROM invoice_payments) AS invoice_payments_untouched,
  (SELECT COUNT(*) FROM customer_payment) AS customer_payment_untouched,
  (SELECT COUNT(*) FROM credit_note) AS credit_note_untouched,
  (SELECT COUNT(*) FROM cheque_clearance_log) AS cheque_clearance_log_untouched,
  (SELECT COUNT(*) FROM inventory_transaction) AS inventory_transaction_untouched;

-- Change to ROLLBACK; to test without saving
COMMIT;
