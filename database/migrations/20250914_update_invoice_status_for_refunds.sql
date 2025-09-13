-- Update invoice status logic to consider refunds (net amount = total_amount - refunded_amount)
-- and recalculate status when credit notes are inserted/updated/deleted.

-- 1) Replace update_invoice_balance_after_payment() to include refunded_amount in status logic
CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_paid numeric(12,2);
    invoice_total numeric(12,2);
    refunded_amount numeric(12,2);
    net_total numeric(12,2);
    v_invoice_id integer;
BEGIN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

    -- Sum of payments applied to the invoice
    SELECT COALESCE(SUM(ip.amount_paid), 0)
    INTO total_paid
    FROM invoice_payments ip
    WHERE ip.invoice_id = v_invoice_id;

    -- Invoice total and refunded amount
    SELECT i.total_amount,
           COALESCE((SELECT SUM(cn.total_amount) FROM credit_note cn WHERE cn.invoice_id = i.invoice_id), 0)
    INTO invoice_total, refunded_amount
    FROM invoice i
    WHERE i.invoice_id = v_invoice_id;

    -- Net total after refunds (not below zero)
    net_total := GREATEST(invoice_total - refunded_amount, 0);

    -- Update invoice accumulated paid and derived status
    UPDATE invoice
    SET amount_paid = total_paid,
        status = CASE
            WHEN total_paid >= net_total THEN 'Paid'
            WHEN total_paid > 0 THEN 'Partially Paid'
            ELSE 'Unpaid'
        END
    WHERE invoice_id = v_invoice_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 2) Ensure triggers exist on invoice_payments (idempotent pattern: drop then create)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'invoice_payments_update_balance_insert'
    ) THEN
        EXECUTE 'DROP TRIGGER invoice_payments_update_balance_insert ON public.invoice_payments';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'invoice_payments_update_balance_update'
    ) THEN
        EXECUTE 'DROP TRIGGER invoice_payments_update_balance_update ON public.invoice_payments';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'invoice_payments_update_balance_delete'
    ) THEN
        EXECUTE 'DROP TRIGGER invoice_payments_update_balance_delete ON public.invoice_payments';
    END IF;
END $$;

CREATE TRIGGER invoice_payments_update_balance_insert
    AFTER INSERT ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

CREATE TRIGGER invoice_payments_update_balance_update
    AFTER UPDATE ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

CREATE TRIGGER invoice_payments_update_balance_delete
    AFTER DELETE ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

-- 3) Add triggers on credit_note so status is recalculated when refunds change
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'credit_note_update_invoice_status_insert'
    ) THEN
        EXECUTE 'DROP TRIGGER credit_note_update_invoice_status_insert ON public.credit_note';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'credit_note_update_invoice_status_update'
    ) THEN
        EXECUTE 'DROP TRIGGER credit_note_update_invoice_status_update ON public.credit_note';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'credit_note_update_invoice_status_delete'
    ) THEN
        EXECUTE 'DROP TRIGGER credit_note_update_invoice_status_delete ON public.credit_note';
    END IF;
END $$;

CREATE TRIGGER credit_note_update_invoice_status_insert
    AFTER INSERT ON public.credit_note
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

CREATE TRIGGER credit_note_update_invoice_status_update
    AFTER UPDATE ON public.credit_note
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();

CREATE TRIGGER credit_note_update_invoice_status_delete
    AFTER DELETE ON public.credit_note
    FOR EACH ROW EXECUTE FUNCTION update_invoice_balance_after_payment();
