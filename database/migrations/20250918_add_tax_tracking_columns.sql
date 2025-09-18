-- Migration: Add tax tracking columns and tables
-- Created: 2025-09-18
-- Purpose: Add comprehensive tax tracking to invoices and invoice lines

-- Add tax tracking columns to invoice table
ALTER TABLE public.invoice 
ADD COLUMN IF NOT EXISTS subtotal_ex_tax numeric(14,2),
ADD COLUMN IF NOT EXISTS tax_total numeric(14,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS tax_calculation_version text DEFAULT 'v1.0';

-- Add tax tracking columns to invoice_line table
ALTER TABLE public.invoice_line
ADD COLUMN IF NOT EXISTS tax_rate_id integer REFERENCES public.tax_rate(tax_rate_id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS tax_rate_snapshot numeric(8,6),
ADD COLUMN IF NOT EXISTS tax_base numeric(14,4),
ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS is_tax_inclusive boolean DEFAULT false;

-- Create invoice_tax_breakdown table for aggregated tax reporting
CREATE TABLE IF NOT EXISTS public.invoice_tax_breakdown (
    breakdown_id serial PRIMARY KEY,
    invoice_id integer NOT NULL REFERENCES public.invoice(invoice_id) ON DELETE CASCADE,
    tax_rate_id integer REFERENCES public.tax_rate(tax_rate_id) ON DELETE SET NULL,
    rate_name character varying(50),
    rate_percentage numeric(8,6) NOT NULL,
    tax_base numeric(14,2) NOT NULL,
    tax_amount numeric(14,2) NOT NULL,
    line_count integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(invoice_id, tax_rate_id)
);

-- Create tax_backfill_log table for audit trail during backfill operations
CREATE TABLE IF NOT EXISTS public.tax_backfill_log (
    log_id serial PRIMARY KEY,
    invoice_id integer NOT NULL REFERENCES public.invoice(invoice_id) ON DELETE CASCADE,
    backfill_run_id uuid DEFAULT gen_random_uuid(),
    is_estimated boolean DEFAULT true,
    original_total numeric(14,2),
    computed_subtotal numeric(14,2),
    computed_tax numeric(14,2),
    computation_method text,
    backfilled_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    backfilled_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoice_line_tax_rate_id ON public.invoice_line(tax_rate_id);
CREATE INDEX IF NOT EXISTS idx_invoice_tax_breakdown_invoice_id ON public.invoice_tax_breakdown(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_tax_breakdown_tax_rate_id ON public.invoice_tax_breakdown(tax_rate_id);
CREATE INDEX IF NOT EXISTS idx_invoice_tax_breakdown_rate_percentage ON public.invoice_tax_breakdown(rate_percentage);
CREATE INDEX IF NOT EXISTS idx_tax_backfill_log_invoice_id ON public.tax_backfill_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_tax_backfill_log_run_id ON public.tax_backfill_log(backfill_run_id);

-- Add constraints
ALTER TABLE public.invoice_line
ADD CONSTRAINT chk_tax_amount_non_negative CHECK (tax_amount >= 0),
ADD CONSTRAINT chk_tax_base_non_negative CHECK (tax_base >= 0);

ALTER TABLE public.invoice_tax_breakdown
ADD CONSTRAINT chk_breakdown_tax_amount_non_negative CHECK (tax_amount >= 0),
ADD CONSTRAINT chk_breakdown_tax_base_non_negative CHECK (tax_base >= 0),
ADD CONSTRAINT chk_breakdown_line_count_positive CHECK (line_count > 0);

-- Add comments for documentation
COMMENT ON COLUMN public.invoice.subtotal_ex_tax IS 'Invoice subtotal excluding tax (sum of line tax_base amounts)';
COMMENT ON COLUMN public.invoice.tax_total IS 'Total tax amount for invoice (sum of line tax_amount)';
COMMENT ON COLUMN public.invoice.tax_calculation_version IS 'Version of tax calculation algorithm used';

COMMENT ON COLUMN public.invoice_line.tax_rate_id IS 'Tax rate applied to this line (snapshot reference)';
COMMENT ON COLUMN public.invoice_line.tax_rate_snapshot IS 'Tax rate percentage at time of sale';
COMMENT ON COLUMN public.invoice_line.tax_base IS 'Base amount for tax calculation (quantity * price - discount)';
COMMENT ON COLUMN public.invoice_line.tax_amount IS 'Tax amount calculated for this line';
COMMENT ON COLUMN public.invoice_line.is_tax_inclusive IS 'Whether the sale_price included tax';

COMMENT ON TABLE public.invoice_tax_breakdown IS 'Aggregated tax breakdown per invoice per tax rate for reporting';
COMMENT ON TABLE public.tax_backfill_log IS 'Audit log for tax backfill operations on historical invoices';