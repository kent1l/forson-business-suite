-- ============================================================================
-- FORSON BUSINESS SUITE - ONE-TIME CONSOLIDATED A/R CLEANUP & RESET SCRIPT
-- ============================================================================
-- Saved under docs/temp/once_ar_cleanup.sql
--
-- Take a pg_dump backup of the database before running this. It is
-- irreversible once COMMIT runs.
--
-- Scope: wipes A/R history (invoices, invoice lines, payments, allocations,
-- credit notes, ar_ledger, customer wallets) and resets credit_hold flags,
-- so the next "on account" sale starts a clean ledger. Customers, parts,
-- inventory, and WAC are untouched (verified: inventory_transaction and
-- part.wac_cost have no FK/trigger path to any of these tables).
--
-- IMPORTANT vs. a plain TRUNCATE ... CASCADE: cheque_clearance_log is a
-- table SHARED between AR (INBOUND_CUSTOMER cheques, linked via
-- invoice_payments/customer_payment) and AP (OUTBOUND_SUPPLIER cheques,
-- linked via ap_payment). Because it has foreign keys into invoice_payments
-- and customer_payment, a bare TRUNCATE ... CASCADE on those tables would
-- silently wipe the ENTIRE table, including unrelated AP cheque bounce
-- history. This script instead drops just those two FKs, nulls out the
-- AR-side linkage columns (the rows themselves, and all AP rows, are kept),
-- truncates the AR tables, then restores the FKs.
-- ============================================================================

BEGIN;

-- 1. Disable triggers on target tables to prevent recursive updates during
--    the reset (harmless no-op for TRUNCATE itself, but keeps step 3's
--    UPDATE from firing anything unexpected).
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

-- 2. Detach cheque_clearance_log from the AR tables so it is NOT swept up
--    by TRUNCATE ... CASCADE below (it also holds unrelated AP cheque
--    history for OUTBOUND_SUPPLIER cheques, which must survive).
ALTER TABLE cheque_clearance_log DROP CONSTRAINT cheque_clearance_log_payment_id_fkey;
ALTER TABLE cheque_clearance_log DROP CONSTRAINT cheque_clearance_log_customer_payment_id_fkey;

UPDATE cheque_clearance_log
SET payment_id = NULL,
    customer_payment_id = NULL
WHERE payment_id IS NOT NULL
   OR customer_payment_id IS NOT NULL;

-- 3. Truncate A/R tables and invoice history cleanly.
-- RESTART IDENTITY resets sequence counters.
-- CASCADE cascades to the remaining AR-only child tables: invoice_line,
-- due_date_log, invoice_tax_breakdown, tax_backfill_log,
-- credit_note_tax_breakdown. (cheque_clearance_log is no longer linked,
-- per step 2, so it is untouched.)
-- Safe for inventory: does NOT touch inventory_transaction or part.wac_cost.
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

-- 4. Reset customer credit hold flags
UPDATE customer
SET credit_hold = false,
    credit_hold_reason = NULL;

-- 5. Re-attach cheque_clearance_log to the (now-empty) AR tables so future
--    inbound-customer cheques link correctly again.
ALTER TABLE cheque_clearance_log
  ADD CONSTRAINT cheque_clearance_log_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES invoice_payments(payment_id) ON DELETE SET NULL;

ALTER TABLE cheque_clearance_log
  ADD CONSTRAINT cheque_clearance_log_customer_payment_id_fkey
  FOREIGN KEY (customer_payment_id) REFERENCES customer_payment(payment_id) ON DELETE SET NULL;

-- 6. Re-enable all triggers
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

-- 7. Verification Diagnostics
SELECT
  (SELECT COUNT(*) FROM ar_ledger) AS ar_ledger_rows,
  (SELECT COUNT(*) FROM customer_wallet) AS customer_wallets,
  (SELECT COUNT(*) FROM customer_payment) AS customer_payments,
  (SELECT COUNT(*) FROM invoice_payments) AS invoice_payments,
  (SELECT COUNT(*) FROM credit_note) AS credit_notes,
  (SELECT COUNT(*) FROM invoice) AS invoice_count,
  (SELECT COUNT(*) FROM invoice_line) AS invoice_line_count,
  (SELECT COUNT(*) FROM inventory_transaction) AS inventory_transaction_count,
  (SELECT SUM(ledger_balance) FROM vw_customer_ar_balance) AS total_ar_balance,
  (SELECT COUNT(*) FROM cheque_clearance_log) AS cheque_clearance_log_total_rows,
  (SELECT COUNT(*) FROM cheque_clearance_log WHERE cheque_type = 'OUTBOUND_SUPPLIER') AS cheque_clearance_log_ap_rows_untouched;

-- Change to ROLLBACK; to test without saving
COMMIT;
