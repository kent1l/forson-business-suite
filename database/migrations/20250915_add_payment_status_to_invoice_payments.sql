-- Add payment status tracking to invoice_payments table
-- This enables proper settlement workflow for delayed payments

-- Add payment_status and settled_at columns
ALTER TABLE public.invoice_payments 
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'settled'
CHECK (payment_status IN ('settled', 'pending', 'failed', 'voided', 'refunded', 'partially_refunded'));

ALTER TABLE public.invoice_payments 
ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoice_payments_status ON public.invoice_payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_settled_at ON public.invoice_payments(settled_at);

-- Set settled_at for existing payments (assume they were settled when created)
UPDATE public.invoice_payments 
SET settled_at = created_at 
WHERE payment_status = 'settled' AND settled_at IS NULL;

-- Add helpful comments
COMMENT ON COLUMN public.invoice_payments.payment_status IS 'Current status of payment: settled (funds confirmed), pending (awaiting settlement), failed, voided, refunded, partially_refunded';
COMMENT ON COLUMN public.invoice_payments.settled_at IS 'Timestamp when payment was marked as settled/confirmed';

-- Update the invoice balance calculation function to only count settled payments
CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_settled numeric(12,2);
    total_refunded numeric(12,2);
    invoice_total numeric(12,2);
    net_amount numeric(12,2);
BEGIN
    -- Get the invoice total, settled payments, and refunds
    SELECT 
        i.total_amount,
        COALESCE(SUM(CASE WHEN ip.payment_status = 'settled' THEN ip.amount_paid ELSE 0 END), 0),
        COALESCE(SUM(cn.total_amount), 0)
    INTO invoice_total, total_settled, total_refunded
    FROM invoice i
    LEFT JOIN invoice_payments ip ON i.invoice_id = ip.invoice_id
    LEFT JOIN credit_note cn ON i.invoice_id = cn.invoice_id
    WHERE i.invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    GROUP BY i.invoice_id, i.total_amount;
    
    -- Calculate net amount after refunds
    net_amount := GREATEST(invoice_total - total_refunded, 0);
    
    -- Update the invoice with only settled payments counting toward amount_paid
    UPDATE invoice 
    SET 
        amount_paid = total_settled,
        status = CASE 
            WHEN total_settled >= net_amount AND net_amount > 0 THEN 'Paid'
            WHEN total_refunded >= invoice_total THEN 'Fully Refunded'
            WHEN total_refunded > 0 AND total_settled >= (net_amount) THEN 'Partially Refunded'
            WHEN total_refunded > 0 THEN 'Partially Refunded'
            WHEN total_settled > 0 THEN 'Partially Paid'
            ELSE 'Unpaid'
        END
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Recreate triggers with the updated function
DROP TRIGGER IF EXISTS invoice_payments_update_balance_insert ON public.invoice_payments;
CREATE TRIGGER invoice_payments_update_balance_insert
    AFTER INSERT ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

DROP TRIGGER IF EXISTS invoice_payments_update_balance_update ON public.invoice_payments;
CREATE TRIGGER invoice_payments_update_balance_update
    AFTER UPDATE ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

DROP TRIGGER IF EXISTS invoice_payments_update_balance_delete ON public.invoice_payments;
CREATE TRIGGER invoice_payments_update_balance_delete
    AFTER DELETE ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();