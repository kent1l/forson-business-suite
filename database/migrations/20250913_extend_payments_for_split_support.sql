-- Extend payments functionality for split payments support
-- This migration adds invoice-specific payments table and enhances existing customer_payment

-- Create new invoice_payments table for split payments on invoices
CREATE TABLE IF NOT EXISTS public.invoice_payments (
    payment_id serial PRIMARY KEY,
    invoice_id integer NOT NULL REFERENCES public.invoice(invoice_id) ON DELETE CASCADE,
    method_id integer NOT NULL REFERENCES public.payment_methods(method_id) ON DELETE RESTRICT,
    amount_paid numeric(12,2) NOT NULL CHECK (amount_paid > 0),
    tendered_amount numeric(12,2) CHECK (tendered_amount IS NULL OR tendered_amount >= amount_paid),
    change_amount numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (change_amount >= 0),
    reference character varying(200),
    metadata jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    
    -- Computed change should match tendered - amount when tendered is provided
    CONSTRAINT chk_change_calculation CHECK (
        (tendered_amount IS NULL AND change_amount = 0) OR
        (tendered_amount IS NOT NULL AND change_amount = tendered_amount - amount_paid)
    )
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id ON public.invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_method_id ON public.invoice_payments(method_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_created_at ON public.invoice_payments(created_at);

-- Extend customer_payment table to support method_id (backward compatible)
ALTER TABLE public.customer_payment 
ADD COLUMN IF NOT EXISTS method_id integer REFERENCES public.payment_methods(method_id) ON DELETE SET NULL;

-- Add index for the new column
CREATE INDEX IF NOT EXISTS idx_customer_payment_method_id ON public.customer_payment(method_id);

-- Create a view for unified payment reporting across both tables
CREATE OR REPLACE VIEW public.payments_unified AS
SELECT 
    'customer_payment' as source_table,
    cp.payment_id,
    NULL as invoice_id,
    cp.customer_id,
    cp.employee_id,
    cp.payment_date as created_at,
    cp.amount as amount_paid,
    cp.tendered_amount,
    COALESCE(cp.tendered_amount - cp.amount, 0) as change_amount,
    cp.payment_method as legacy_method,
    cp.method_id,
    pm.code as method_code,
    pm.name as method_name,
    pm.type as method_type,
    pm.config as method_config,
    cp.reference_number as reference,
    jsonb_build_object('notes', cp.notes) as metadata
FROM public.customer_payment cp
LEFT JOIN public.payment_methods pm ON cp.method_id = pm.method_id

UNION ALL

SELECT 
    'invoice_payments' as source_table,
    ip.payment_id,
    ip.invoice_id,
    i.customer_id,
    ip.created_by as employee_id,
    ip.created_at,
    ip.amount_paid,
    ip.tendered_amount,
    ip.change_amount,
    NULL as legacy_method,
    ip.method_id,
    pm.code as method_code,
    pm.name as method_name,
    pm.type as method_type,
    pm.config as method_config,
    ip.reference,
    ip.metadata
FROM public.invoice_payments ip
JOIN public.invoice i ON ip.invoice_id = i.invoice_id
JOIN public.payment_methods pm ON ip.method_id = pm.method_id;

-- Function to validate payment method constraints
CREATE OR REPLACE FUNCTION validate_payment_constraints(
    p_method_id integer,
    p_reference text,
    p_tendered_amount numeric,
    p_amount_paid numeric
) RETURNS boolean AS $$
DECLARE
    method_config jsonb;
    requires_ref boolean;
    change_allowed boolean;
BEGIN
    -- Get method configuration
    SELECT config INTO method_config 
    FROM payment_methods 
    WHERE method_id = p_method_id AND enabled = true;
    
    IF method_config IS NULL THEN
        RAISE EXCEPTION 'Invalid or disabled payment method: %', p_method_id;
    END IF;
    
    -- Check reference requirement
    requires_ref := COALESCE((method_config->>'requires_reference')::boolean, false);
    IF requires_ref AND (p_reference IS NULL OR trim(p_reference) = '') THEN
        RAISE EXCEPTION 'Reference is required for this payment method';
    END IF;
    
    -- Check change allowance
    change_allowed := COALESCE((method_config->>'change_allowed')::boolean, true);
    IF NOT change_allowed AND p_tendered_amount > p_amount_paid THEN
        RAISE EXCEPTION 'Change is not allowed for this payment method';
    END IF;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate invoice_payments constraints
CREATE OR REPLACE FUNCTION validate_invoice_payment_trigger() RETURNS trigger AS $$
BEGIN
    PERFORM validate_payment_constraints(
        NEW.method_id,
        NEW.reference,
        NEW.tendered_amount,
        NEW.amount_paid
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_payments_validate
    BEFORE INSERT OR UPDATE ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION validate_invoice_payment_trigger();

-- Function to update invoice balance after payment changes
CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_paid numeric(12,2);
    invoice_total numeric(12,2);
BEGIN
    -- Get the invoice total and current payments
    SELECT 
        i.total_amount,
        COALESCE(SUM(ip.amount_paid), 0)
    INTO invoice_total, total_paid
    FROM invoice i
    LEFT JOIN invoice_payments ip ON i.invoice_id = ip.invoice_id
    WHERE i.invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    GROUP BY i.invoice_id, i.total_amount;
    
    -- Update the invoice (balance_due is computed, not stored)
    UPDATE invoice 
    SET 
        amount_paid = total_paid,
        status = CASE 
            WHEN total_paid >= invoice_total THEN 'Paid'
            WHEN total_paid > 0 THEN 'Partially Paid'
            ELSE 'Unpaid'
        END
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic balance updates
CREATE TRIGGER invoice_payments_update_balance_insert
    AFTER INSERT ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

CREATE TRIGGER invoice_payments_update_balance_update
    AFTER UPDATE ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

CREATE TRIGGER invoice_payments_update_balance_delete
    AFTER DELETE ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();
