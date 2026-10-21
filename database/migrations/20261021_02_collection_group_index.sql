-- Migration: 20261021_02_collection_group_index.sql
-- Description: Adjust customer_payment physical_receipt_no unique index to allow grouped payments sharing a collection receipt.

DROP INDEX IF EXISTS public.idx_customer_payment_physical_receipt_no_unique;

CREATE UNIQUE INDEX idx_customer_payment_physical_receipt_no_unique
    ON public.customer_payment (LOWER(TRIM(physical_receipt_no)))
    WHERE collection_group_id IS NULL AND physical_receipt_no IS NOT NULL AND LENGTH(TRIM(physical_receipt_no)) > 0;
