-- Add settlement lifecycle columns to invoice_payments and update balance logic
-- 1) Add columns: payment_status, settled_at, settlement_reference, attempt_metadata
-- 2) Backfill settled_at from created_at for existing rows
-- 3) Update payments_unified view to expose new fields (customer_payment treated as settled)
-- 4) Replace update_invoice_balance_after_payment() to only count settled payments and still consider refunds
-- 5) Recreate triggers idempotently

-- 1) Add columns (idempotent)
ALTER TABLE public.invoice_payments
    ADD COLUMN IF NOT EXISTS payment_status varchar(20) NOT NULL DEFAULT 'settled';

ALTER TABLE public.invoice_payments
    ADD COLUMN IF NOT EXISTS settled_at timestamp with time zone;

ALTER TABLE public.invoice_payments
    ADD COLUMN IF NOT EXISTS settlement_reference character varying(200);

ALTER TABLE public.invoice_payments
    ADD COLUMN IF NOT EXISTS attempt_metadata jsonb DEFAULT '{}';

-- Create an index on status for faster queries
CREATE INDEX IF NOT EXISTS idx_invoice_payments_status ON public.invoice_payments(payment_status);

-- 2) Backfill settled_at for historical rows where it is NULL
UPDATE public.invoice_payments
SET settled_at = created_at
WHERE settled_at IS NULL;

-- 3) Replace payments_unified view to include settlement columns
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
    jsonb_build_object('notes', cp.notes) as metadata,
    'settled' as payment_status,
    cp.payment_date as settled_at,
    NULL::character varying as settlement_reference,
    '{}'::jsonb as attempt_metadata
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
    ip.metadata,
    COALESCE(ip.payment_status, 'settled') as payment_status,
    ip.settled_at,
    ip.settlement_reference,
    ip.attempt_metadata
FROM public.invoice_payments ip
JOIN public.invoice i ON ip.invoice_id = i.invoice_id
JOIN public.payment_methods pm ON ip.method_id = pm.method_id;

-- 4) Replace update_invoice_balance_after_payment() to only SUM settled payments and consider refunds
CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_paid numeric(12,2);
    invoice_total numeric(12,2);
    refunded_amount numeric(12,2);
    net_total numeric(12,2);
    v_invoice_id integer;
BEGIN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

    -- Only include payments that are marked 'settled'
    SELECT COALESCE(SUM(ip.amount_paid), 0)
    INTO total_paid
    FROM invoice_payments ip
    WHERE ip.invoice_id = v_invoice_id
      AND COALESCE(ip.payment_status, 'settled') = 'settled';

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

-- 5) Recreate triggers idempotently on invoice_payments
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

-- Recreate credit_note triggers idempotently so they call the new function
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

-- End of migration
