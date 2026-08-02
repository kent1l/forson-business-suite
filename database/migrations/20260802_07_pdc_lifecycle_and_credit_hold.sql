-- Migration: 20260805_pdc_lifecycle_and_credit_hold.sql
-- Description: Add pdc_status enum tracking to invoice_payments and credit hold columns to customer

ALTER TABLE invoice_payments
ADD COLUMN IF NOT EXISTS pdc_status VARCHAR(20) DEFAULT 'CLEARED'
CHECK (pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'CLEARED', 'BOUNCED'));

ALTER TABLE customer
ADD COLUMN IF NOT EXISTS credit_hold BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS credit_hold_reason TEXT;
