-- Add credit_limit to customer table
ALTER TABLE public.customer ADD COLUMN IF NOT EXISTS credit_limit numeric(12,2) DEFAULT 5000.00;
