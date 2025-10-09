-- Migration: Add refund payment method tracking to credit notes
-- Date: 2025-10-09
-- Description: Add method_id and reference fields to credit_note table to track how refunds were disbursed

BEGIN;

-- Add method_id column to credit_note table
ALTER TABLE public.credit_note
ADD COLUMN method_id integer REFERENCES public.payment_methods(method_id) ON DELETE RESTRICT;

-- Add reference column for payment references (optional)
ALTER TABLE public.credit_note
ADD COLUMN reference character varying(200);

-- Add index for efficient queries on refund payment methods
CREATE INDEX IF NOT EXISTS idx_credit_note_method_id ON public.credit_note(method_id);

-- Add index for refund reference searches
CREATE INDEX IF NOT EXISTS idx_credit_note_reference ON public.credit_note(reference);

-- Add comments for documentation
COMMENT ON COLUMN public.credit_note.method_id IS 'Payment method used for refund disbursement';
COMMENT ON COLUMN public.credit_note.reference IS 'Reference number for refund payment (e.g., check number, transaction ID)';

COMMIT;