BEGIN;

-- Create the due_date_log table to track all invoice due date changes
CREATE TABLE IF NOT EXISTS public.due_date_log (
    log_id serial PRIMARY KEY,
    invoice_id integer NOT NULL REFERENCES public.invoice(invoice_id) ON DELETE CASCADE,
    old_due_date timestamp with time zone,
    new_due_date timestamp with time zone NOT NULL,
    days_adjustment integer, -- positive for extension, negative for reduction
    edited_by integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    edited_on timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    reason text, -- optional reason for the change
    ip_address inet, -- track IP address for audit trail
    user_agent text, -- track user agent for audit trail
    system_generated boolean DEFAULT false -- track if change was system-generated vs manual
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_due_date_log_invoice_id ON public.due_date_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_due_date_log_edited_by ON public.due_date_log(edited_by);
CREATE INDEX IF NOT EXISTS idx_due_date_log_edited_on ON public.due_date_log(edited_on);

-- Add comment to the table
COMMENT ON TABLE public.due_date_log IS 'Audit log for all invoice due date changes with comprehensive tracking';
COMMENT ON COLUMN public.due_date_log.days_adjustment IS 'Number of days adjusted: positive for extension, negative for reduction';
COMMENT ON COLUMN public.due_date_log.system_generated IS 'Flag to distinguish between manual edits and system-generated changes';

COMMIT;