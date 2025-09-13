-- Fix the invoice balance trigger function to remove reference to non-existent balance_due column
-- This fixes the 500 error when processing split payments

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
