-- Migration: 20260810_01_add_physical_receipt_no_to_customer_payment.sql
-- Description: Add physical_receipt_no column to customer_payment table for AR SOA and printed receipt reference tracking.

ALTER TABLE public.customer_payment
    ADD COLUMN IF NOT EXISTS physical_receipt_no VARCHAR(50);
