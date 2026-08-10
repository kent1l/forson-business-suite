-- ============================================================================
-- FORSON BUSINESS SUITE - ONE-TIME CONSOLIDATED A/R CLEANUP & RESET SCRIPT
-- ============================================================================
-- Saved under docs/temp/once_ar_cleanup.sql
-- ============================================================================

BEGIN;

-- 1. Disable all triggers on target tables to prevent recursive updates
ALTER TABLE ar_ledger DISABLE TRIGGER ALL;
ALTER TABLE customer_wallet DISABLE TRIGGER ALL;
ALTER TABLE customer_wallet_transaction DISABLE TRIGGER ALL;
ALTER TABLE invoice_payments DISABLE TRIGGER ALL;
ALTER TABLE customer_payment DISABLE TRIGGER ALL;
ALTER TABLE invoice_payment_allocation DISABLE TRIGGER ALL;
ALTER TABLE credit_note DISABLE TRIGGER ALL;
ALTER TABLE credit_note_line DISABLE TRIGGER ALL;
ALTER TABLE invoice DISABLE TRIGGER ALL;
ALTER TABLE invoice_line DISABLE TRIGGER ALL;
ALTER TABLE customer DISABLE TRIGGER ALL;

-- 2. Truncate A/R tables and invoice history cleanly
-- RESTART IDENTITY resets sequence counters.
-- CASCADE cascades deletions to child tables (invoice_line, due_date_log, tax breakdowns).
-- Safe for inventory: does NOT touch inventory_transaction.
TRUNCATE TABLE 
  ar_ledger,
  customer_wallet_transaction,
  customer_wallet,
  invoice_payments,
  customer_payment,
  invoice_payment_allocation,
  credit_note_line,
  credit_note,
  invoice
RESTART IDENTITY CASCADE;

-- 3. Reset customer credit hold flags
UPDATE customer
SET credit_hold = false,
    credit_hold_reason = NULL;

-- 4. Re-enable all triggers
ALTER TABLE ar_ledger ENABLE TRIGGER ALL;
ALTER TABLE customer_wallet ENABLE TRIGGER ALL;
ALTER TABLE customer_wallet_transaction ENABLE TRIGGER ALL;
ALTER TABLE invoice_payments ENABLE TRIGGER ALL;
ALTER TABLE customer_payment ENABLE TRIGGER ALL;
ALTER TABLE invoice_payment_allocation ENABLE TRIGGER ALL;
ALTER TABLE credit_note ENABLE TRIGGER ALL;
ALTER TABLE credit_note_line ENABLE TRIGGER ALL;
ALTER TABLE invoice ENABLE TRIGGER ALL;
ALTER TABLE invoice_line ENABLE TRIGGER ALL;
ALTER TABLE customer ENABLE TRIGGER ALL;

-- 5. Verification Diagnostics
SELECT 
  (SELECT COUNT(*) FROM ar_ledger) AS ar_ledger_rows,
  (SELECT COUNT(*) FROM customer_wallet) AS customer_wallets,
  (SELECT COUNT(*) FROM customer_payment) AS customer_payments,
  (SELECT COUNT(*) FROM invoice_payments) AS invoice_payments,
  (SELECT COUNT(*) FROM credit_note) AS credit_notes,
  (SELECT COUNT(*) FROM invoice) AS invoice_count,
  (SELECT COUNT(*) FROM invoice_line) AS invoice_line_count,
  (SELECT COUNT(*) FROM inventory_transaction) AS inventory_transaction_count,
  (SELECT SUM(ledger_balance) FROM vw_customer_ar_balance) AS total_ar_balance;

-- Change to ROLLBACK; to test without saving
COMMIT;
