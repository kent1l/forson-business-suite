-- Phase 1 A/R Hardening: Fix invoice status trigger
-- Removes the 'Partially Refunded' status which caused invoices with a remaining
-- balance to disappear from all A/R queries (which filter WHERE status IN ('Unpaid','Partially Paid')).
-- Now only two terminal states exist: 'Fully Refunded' and 'Paid'.
-- An invoice with any outstanding balance always remains 'Unpaid' or 'Partially Paid'.

BEGIN;

CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_settled  numeric(12,2);
    total_refunded numeric(12,2);
    invoice_total  numeric(12,2);
    net_amount     numeric(12,2);
    v_invoice_id   integer;
BEGIN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

    SELECT total_amount INTO invoice_total
    FROM invoice WHERE invoice_id = v_invoice_id;

    -- Aggregate settled payments only (pending/bounced do not reduce balance)
    SELECT COALESCE(SUM(amount_paid), 0) INTO total_settled
    FROM invoice_payments
    WHERE invoice_id = v_invoice_id AND payment_status = 'settled';

    -- Aggregate all credit notes applied to this invoice
    SELECT COALESCE(SUM(total_amount), 0) INTO total_refunded
    FROM credit_note WHERE invoice_id = v_invoice_id;

    -- Net collectible amount after refunds (floor at 0)
    net_amount := GREATEST(invoice_total - total_refunded, 0);

    UPDATE invoice
    SET
        amount_paid = total_settled,
        status = CASE
            -- Full refund: nothing left to collect
            WHEN total_refunded >= invoice_total                              THEN 'Fully Refunded'
            -- Fully paid (may be after a partial refund)
            WHEN net_amount > 0 AND total_settled >= net_amount              THEN 'Paid'
            -- Something paid but balance remains
            WHEN total_settled > 0                                            THEN 'Partially Paid'
            -- Nothing paid yet
            ELSE 'Unpaid'
        END
    WHERE invoice_id = v_invoice_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMIT;
