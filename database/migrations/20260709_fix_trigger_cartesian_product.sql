-- Fix Cartesian product bug in update_invoice_balance_after_payment trigger
-- Prioritize Fully/Partially Refunded statuses over Paid.

CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_settled numeric(12,2);
    total_refunded numeric(12,2);
    invoice_total numeric(12,2);
    net_amount numeric(12,2);
    v_invoice_id integer;
BEGIN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

    -- Get the invoice total
    SELECT total_amount INTO invoice_total FROM invoice WHERE invoice_id = v_invoice_id;

    -- Subquery settled payments to avoid Cartesian product duplication
    SELECT COALESCE(SUM(amount_paid), 0)
    INTO total_settled
    FROM invoice_payments
    WHERE invoice_id = v_invoice_id AND payment_status = 'settled';

    -- Subquery refunded amount to avoid Cartesian product duplication
    SELECT COALESCE(SUM(total_amount), 0)
    INTO total_refunded
    FROM credit_note
    WHERE invoice_id = v_invoice_id;

    -- Calculate net amount after refunds
    net_amount := GREATEST(invoice_total - total_refunded, 0);

    -- Update invoice
    UPDATE invoice 
    SET 
        amount_paid = total_settled,
        status = CASE 
            WHEN total_refunded >= invoice_total THEN 'Fully Refunded'
            WHEN total_refunded > 0 THEN 'Partially Refunded'
            WHEN total_settled >= net_amount AND net_amount > 0 THEN 'Paid'
            WHEN total_settled > 0 THEN 'Partially Paid'
            ELSE 'Unpaid'
        END
    WHERE invoice_id = v_invoice_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
