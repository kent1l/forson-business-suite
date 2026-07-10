-- Migration: Modernize refunds schema with line-level links and payment methods
-- Created: 2026-07-10

BEGIN;

-- 1. Add invoice_line_id to credit_note_line
ALTER TABLE public.credit_note_line 
    ADD COLUMN IF NOT EXISTS invoice_line_id integer REFERENCES public.invoice_line(invoice_line_id) ON DELETE RESTRICT;

-- Populate existing credit_note_line records using part_id and invoice_id mapping
UPDATE public.credit_note_line cnl
SET invoice_line_id = (
    SELECT il.invoice_line_id 
    FROM public.invoice_line il
    JOIN public.credit_note cn ON cn.invoice_id = il.invoice_id
    WHERE cn.cn_id = cnl.cn_id AND il.part_id = cnl.part_id
    LIMIT 1
)
WHERE cnl.invoice_line_id IS NULL;

-- 2. Add refund_payment_method to credit_note
ALTER TABLE public.credit_note 
    ADD COLUMN IF NOT EXISTS refund_payment_method character varying(50) DEFAULT 'Cash';

COMMIT;
