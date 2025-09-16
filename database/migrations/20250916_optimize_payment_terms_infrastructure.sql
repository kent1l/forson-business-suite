-- Migration: Optimize payment terms infrastructure 
-- Date: 2025-09-16
-- Description: Add missing indexes and ensure payment terms infrastructure is complete and optimized

BEGIN;

-- Add index on due_date for efficient aging reports and due date queries
CREATE INDEX IF NOT EXISTS idx_invoice_due_date ON public.invoice(due_date);

-- Add composite index for common invoice queries with payment terms
CREATE INDEX IF NOT EXISTS idx_invoice_status_due_date ON public.invoice(status, due_date);

-- Add index for payment terms lookup efficiency
CREATE INDEX IF NOT EXISTS idx_invoice_payment_terms_days ON public.invoice(payment_terms_days);

-- Ensure invoice_payments has proper settlement_type support for reporting
-- Add index on payment_status for settlement reporting
CREATE INDEX IF NOT EXISTS idx_invoice_payments_status_settled ON public.invoice_payments(payment_status, settled_at);

-- Add composite index for invoice payment summarization queries
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_status ON public.invoice_payments(invoice_id, payment_status);

-- Update the balance calculation function to handle on_account properly
-- This ensures on_account payments don't count toward invoice.amount_paid
CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_settled numeric(12,2);
    total_refunded numeric(12,2);
    invoice_total numeric(12,2);
    net_amount numeric(12,2);
BEGIN
    -- Get the invoice total, settled payments, and refunds
    -- NOTE: Only 'settled' payments count toward amount_paid, not 'on_account' or 'pending'
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

-- Add computed column helper for balance due (useful for views/reports)
-- This is a view, not a computed column, to avoid storage overhead
CREATE OR REPLACE VIEW public.invoice_with_balance AS
SELECT 
    i.*,
    GREATEST(i.total_amount - COALESCE(cn_totals.refunded_amount, 0), 0) AS net_amount,
    GREATEST(
        i.total_amount - COALESCE(cn_totals.refunded_amount, 0) - i.amount_paid, 
        0
    ) AS balance_due,
    CASE 
        WHEN i.due_date IS NULL THEN NULL
        WHEN i.due_date < CURRENT_TIMESTAMP THEN 
            EXTRACT(days FROM CURRENT_TIMESTAMP - i.due_date)::integer
        ELSE 0
    END AS days_overdue,
    COALESCE(cn_totals.refunded_amount, 0) AS refunded_amount,
    -- Payment summary from invoice_payments
    COALESCE(payment_summary.settled_amount, 0) AS settled_amount,
    COALESCE(payment_summary.pending_amount, 0) AS pending_amount,
    COALESCE(payment_summary.on_account_amount, 0) AS on_account_amount
FROM public.invoice i
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(cn.total_amount), 0) AS refunded_amount
    FROM credit_note cn
    WHERE cn.invoice_id = i.invoice_id
) cn_totals ON TRUE
LEFT JOIN LATERAL (
    SELECT 
        COALESCE(SUM(CASE WHEN ip.payment_status = 'settled' THEN ip.amount_paid ELSE 0 END), 0) AS settled_amount,
        COALESCE(SUM(CASE WHEN ip.payment_status = 'pending' THEN ip.amount_paid ELSE 0 END), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN ip.payment_status = 'on_account' THEN ip.amount_paid ELSE 0 END), 0) AS on_account_amount
    FROM invoice_payments ip
    WHERE ip.invoice_id = i.invoice_id
) payment_summary ON TRUE;

-- Add helpful view for aging analysis
CREATE OR REPLACE VIEW public.invoice_aging AS
SELECT 
    i.invoice_id,
    i.invoice_number,
    i.customer_id,
    c.first_name || ' ' || COALESCE(c.last_name, '') AS customer_name,
    i.invoice_date,
    i.due_date,
    i.total_amount,
    i.amount_paid,
    iwb.balance_due,
    iwb.days_overdue,
    iwb.on_account_amount,
    iwb.pending_amount,
    CASE 
        WHEN iwb.balance_due <= 0 THEN 'Paid'
        WHEN i.due_date IS NULL THEN 'No Terms'
        WHEN iwb.days_overdue = 0 THEN 'Current'
        WHEN iwb.days_overdue <= 30 THEN '1-30 Days'
        WHEN iwb.days_overdue <= 60 THEN '31-60 Days'
        WHEN iwb.days_overdue <= 90 THEN '61-90 Days'
        ELSE '90+ Days'
    END AS aging_bucket
FROM public.invoice_with_balance iwb
JOIN public.invoice i ON iwb.invoice_id = i.invoice_id
JOIN public.customer c ON i.customer_id = c.customer_id
WHERE iwb.balance_due > 0 OR iwb.on_account_amount > 0;

-- Add comments for documentation
COMMENT ON INDEX idx_invoice_due_date IS 'Supports aging reports and due date filtering';
COMMENT ON INDEX idx_invoice_status_due_date IS 'Supports dashboard queries for overdue invoices';
COMMENT ON INDEX idx_invoice_payment_terms_days IS 'Supports payment terms analysis and reporting';

COMMENT ON VIEW invoice_with_balance IS 'Enhanced invoice view with computed balances, aging, and payment breakdowns';
COMMENT ON VIEW invoice_aging IS 'Aging analysis view for accounts receivable management';

COMMIT;