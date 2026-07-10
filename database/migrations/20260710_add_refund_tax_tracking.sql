-- Migration: Add refund tax tracking columns and tables
-- Created: 2026-07-10
-- Purpose: Extend tax tracking to credit notes and credit note lines

-- Add tax tracking columns to credit_note table
ALTER TABLE public.credit_note 
ADD COLUMN IF NOT EXISTS subtotal_ex_tax numeric(14,2),
ADD COLUMN IF NOT EXISTS tax_total numeric(14,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS tax_calculation_version text DEFAULT 'v1.0';

-- Add tax tracking columns to credit_note_line table
ALTER TABLE public.credit_note_line
ADD COLUMN IF NOT EXISTS tax_rate_id integer REFERENCES public.tax_rate(tax_rate_id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS tax_rate_snapshot numeric(8,6),
ADD COLUMN IF NOT EXISTS tax_base numeric(14,4),
ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS is_tax_inclusive boolean DEFAULT false;

-- Create credit_note_tax_breakdown table for aggregated tax reporting on refunds
CREATE TABLE IF NOT EXISTS public.credit_note_tax_breakdown (
    breakdown_id serial PRIMARY KEY,
    cn_id integer NOT NULL REFERENCES public.credit_note(cn_id) ON DELETE CASCADE,
    tax_rate_id integer REFERENCES public.tax_rate(tax_rate_id) ON DELETE SET NULL,
    rate_name character varying(50),
    rate_percentage numeric(8,6) NOT NULL,
    tax_base numeric(14,2) NOT NULL,
    tax_amount numeric(14,2) NOT NULL,
    line_count integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cn_id, tax_rate_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_cn_line_tax_rate_id ON public.credit_note_line(tax_rate_id);
CREATE INDEX IF NOT EXISTS idx_cn_tax_breakdown_cn_id ON public.credit_note_tax_breakdown(cn_id);
CREATE INDEX IF NOT EXISTS idx_cn_tax_breakdown_tax_rate_id ON public.credit_note_tax_breakdown(tax_rate_id);

-- Add constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_cn_tax_amount_non_negative'
  ) THEN
    ALTER TABLE public.credit_note_line
      ADD CONSTRAINT chk_cn_tax_amount_non_negative
      CHECK (tax_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_cn_tax_base_non_negative'
  ) THEN
    ALTER TABLE public.credit_note_line
      ADD CONSTRAINT chk_cn_tax_base_non_negative
      CHECK (tax_base >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_cn_breakdown_tax_amount_non_negative'
  ) THEN
    ALTER TABLE public.credit_note_tax_breakdown
      ADD CONSTRAINT chk_cn_breakdown_tax_amount_non_negative
      CHECK (tax_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_cn_breakdown_tax_base_non_negative'
  ) THEN
    ALTER TABLE public.credit_note_tax_breakdown
      ADD CONSTRAINT chk_cn_breakdown_tax_base_non_negative
      CHECK (tax_base >= 0);
  END IF;
END $$;
