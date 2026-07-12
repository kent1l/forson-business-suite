BEGIN;

-- 1. Create Staging Tables
CREATE TABLE IF NOT EXISTS public.staged_sale (
    staged_sale_id serial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    employee_id integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    staged_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    total_amount numeric(12,2) NOT NULL,
    tax_rate_id integer REFERENCES public.tax_rate(tax_rate_id) ON DELETE SET NULL,
    physical_receipt_no character varying(50),
    status character varying(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    payment_method_id integer REFERENCES public.payment_methods(method_id) ON DELETE RESTRICT,
    tendered_amount numeric(12,2),
    approved_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    approved_at timestamp with time zone,
    rejected_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    rejected_at timestamp with time zone,
    rejection_reason text
);

CREATE TABLE IF NOT EXISTS public.staged_sale_line (
    staged_line_id serial PRIMARY KEY,
    staged_sale_id integer NOT NULL REFERENCES public.staged_sale(staged_sale_id) ON DELETE CASCADE,
    part_id integer NOT NULL REFERENCES public.part(part_id) ON DELETE RESTRICT,
    quantity numeric(12,4) NOT NULL,
    sale_price numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0.00
);

-- 2. Extend Invoice Table with Submission/Approval Metadata
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS approved_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS submitted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP;

-- 3. Populate existing invoices to keep history consistent
UPDATE public.invoice 
SET submitted_at = invoice_date, 
    approved_at = invoice_date, 
    approved_by = employee_id 
WHERE approved_by IS NULL;

COMMIT;
