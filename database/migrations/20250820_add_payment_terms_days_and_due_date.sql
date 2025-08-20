-- Migration: add payment_terms_days and due_date to invoice
BEGIN;

ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS payment_terms_days integer;

ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS due_date timestamp with time zone;

COMMIT;
