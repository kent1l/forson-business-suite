-- Migration: 20260813_01_add_supplier_payment_terms_and_bill_indexes.sql
-- Description: Adds supplier.payment_terms_days (mirrors invoice.payment_terms_days)
--              so bill due dates can be computed from agreed terms, plus aging/due-date
--              indexes on supplier_bill to support the new AP monitoring queries.

BEGIN;

ALTER TABLE supplier ADD COLUMN IF NOT EXISTS payment_terms_days integer;

CREATE INDEX IF NOT EXISTS idx_supplier_bill_due_date ON supplier_bill(due_date) WHERE status != 'Paid';
CREATE INDEX IF NOT EXISTS idx_supplier_bill_bill_date ON supplier_bill(bill_date);

COMMIT;
