-- Migration: 20260813_02_create_supplier_bill_due_date_log.sql
-- Description: Audit trail for supplier_bill due date edits, mirroring the AR
--              due_date_log table so AP due-date changes are traceable the same way.

BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_bill_due_date_log (
    log_id serial PRIMARY KEY,
    bill_id integer NOT NULL REFERENCES public.supplier_bill(bill_id) ON DELETE CASCADE,
    old_due_date date,
    new_due_date date NOT NULL,
    days_adjustment integer,
    edited_by integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    edited_on timestamptz DEFAULT CURRENT_TIMESTAMP,
    reason text
);

CREATE INDEX IF NOT EXISTS idx_supplier_bill_due_date_log_bill_id ON public.supplier_bill_due_date_log(bill_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_due_date_log_edited_by ON public.supplier_bill_due_date_log(edited_by);

COMMENT ON TABLE public.supplier_bill_due_date_log IS 'Audit log for all supplier_bill due date changes';
COMMENT ON COLUMN public.supplier_bill_due_date_log.days_adjustment IS 'Number of days adjusted: positive for extension, negative for reduction';

COMMIT;
