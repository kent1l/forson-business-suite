-- Migration: 20260902_04_withholding_ledger_entry_type.sql
-- Description: Stop a withheld-tax payment being posted to the AR ledger twice.
--
--   Two things write a settlement entry for an invoice_payments row: the application
--   code that inserted it, and the safety-net trigger on invoice_payments added by
--   20260812_10_ar_ledger_production_hardening.sql. They are meant not to collide,
--   and don't, because append_ar_ledger_entry() short-circuits when an entry for the
--   same payment already exists.
--
--   That short-circuit only ever considered PAYMENT_SETTLED, because until now that
--   was the only entry type a payment could produce. Tax withheld at source is
--   settlement without cash, so it posts WITHHOLDING_TAX_CREDIT instead -- and the
--   trigger, which hardcodes PAYMENT_SETTLED, no longer matched the entry the
--   application had written. Both were inserted. The receivable was relieved twice
--   and the customer's balance went negative by the withheld amount, manufacturing
--   store credit out of a tax deduction.
--
--   Two changes, both needed:
--
--   1. The trigger derives the entry type from the payment method rather than
--      assuming cash. A withholding payment is not a collection, and every
--      cash-basis report distinguishes the two by entry type.
--
--   2. The idempotency short-circuit covers both settlement types, matching on the
--      entry type as well as the payment. Deliberately NOT "one settlement entry per
--      payment": a customer_payment collected net of tax legitimately posts one
--      PAYMENT_SETTLED for the cash and one WITHHOLDING_TAX_CREDIT for the deduction,
--      against the same payment_id. Those are two funding components of one payment,
--      not a duplicate.

BEGIN;

-- Replaces the entry_date-aware signature in place. The parameter list must match
-- exactly: 20260816_05_fix_ledger_entry_function_overloads.sql had to clean up after
-- an earlier attempt that changed the arity and silently created a second overload,
-- which broke every caller with "function ... is not unique".
CREATE OR REPLACE FUNCTION public.append_ar_ledger_entry(
    p_customer_id     integer,
    p_invoice_id      integer,
    p_payment_id      integer,
    p_cn_id           integer,
    p_entry_type      ar_ledger_entry_type,
    p_amount          numeric,
    p_payment_channel character varying,
    p_reference_no    character varying,
    p_notes           text,
    p_created_by      integer,
    p_payment_source  character varying DEFAULT NULL::character varying,
    p_entry_date      timestamp with time zone DEFAULT CURRENT_TIMESTAMP
) RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('ar_ledger:' || p_customer_id::text));

    -- Idempotency short-circuit: a given payment posts at most one entry of each
    -- settlement type, so this is safe to call more than once for the same payment
    -- (once from the safety-net trigger, once from application code).
    --
    -- Deliberately NOT "one settlement entry per payment": a customer_payment
    -- collected net of tax legitimately posts one PAYMENT_SETTLED for the cash and
    -- one WITHHOLDING_TAX_CREDIT for the deduction, against the same payment_id.
    -- Those are two funding components of one payment, not a duplicate.
    IF p_payment_id IS NOT NULL
       AND p_entry_type IN ('PAYMENT_SETTLED', 'WITHHOLDING_TAX_CREDIT') THEN
        SELECT ledger_id INTO v_ledger_id
          FROM ar_ledger
         WHERE payment_id = p_payment_id
           AND payment_source IS NOT DISTINCT FROM p_payment_source
           AND entry_type = p_entry_type;
        IF FOUND THEN
            RETURN v_ledger_id;
        END IF;
    END IF;

    SELECT balance_after INTO v_prev_balance
      FROM ar_ledger
     WHERE customer_id = p_customer_id
     ORDER BY ledger_id DESC
     LIMIT 1
       FOR UPDATE;

    v_prev_balance := COALESCE(v_prev_balance, 0);

    INSERT INTO ar_ledger
        (customer_id, invoice_id, payment_id, cn_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by,
         payment_source, entry_date)
    VALUES
        (p_customer_id, p_invoice_id, p_payment_id, p_cn_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by, p_payment_source,
         COALESCE(p_entry_date, CURRENT_TIMESTAMP))
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION update_invoice_balance_after_payment() RETURNS trigger AS $$
DECLARE
    total_settled  numeric(12,2);
    total_refunded numeric(12,2);
    invoice_total  numeric(12,2);
    net_amount     numeric(12,2);
    v_invoice_id   integer;
    v_customer_id  integer;
    v_method_code  varchar(50);
    v_entry_type   ar_ledger_entry_type;
BEGIN
    v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

    SELECT total_amount, customer_id INTO invoice_total, v_customer_id
    FROM invoice WHERE invoice_id = v_invoice_id;

    -- Aggregate settled payments only (pending/bounced do not reduce balance).
    -- Tax withheld at source is included: the receivable really is settled by it,
    -- it is simply settled by certificate rather than by cash.
    SELECT COALESCE(SUM(amount_paid), 0) INTO total_settled
    FROM invoice_payments
    WHERE invoice_id = v_invoice_id AND payment_status = 'settled';

    SELECT COALESCE(SUM(total_amount), 0) INTO total_refunded
    FROM credit_note WHERE invoice_id = v_invoice_id;

    net_amount := GREATEST(invoice_total - total_refunded, 0);

    UPDATE invoice
    SET
        amount_paid = total_settled,
        status = CASE
            WHEN total_refunded >= invoice_total                  THEN 'Fully Refunded'
            WHEN net_amount > 0 AND total_settled >= net_amount   THEN 'Paid'
            WHEN total_settled > 0                                THEN 'Partially Paid'
            ELSE 'Unpaid'
        END
    WHERE invoice_id = v_invoice_id;

    -- Ledger safety net: guarantee a settlement entry exists whenever an
    -- invoice_payments row transitions into 'settled', no matter which application
    -- code path caused it. Idempotent, so this is a no-op when the caller already
    -- wrote the entry -- provided it writes the same entry type, which is why the
    -- type is derived here rather than assumed.
    IF TG_TABLE_NAME = 'invoice_payments' THEN
        IF TG_OP IN ('INSERT', 'UPDATE')
           AND NEW.payment_status = 'settled'
           AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'settled') THEN

            SELECT code INTO v_method_code FROM payment_methods WHERE method_id = NEW.method_id;

            v_entry_type := CASE
                WHEN v_method_code = 'withholding_tax' THEN 'WITHHOLDING_TAX_CREDIT'
                ELSE 'PAYMENT_SETTLED'
            END::ar_ledger_entry_type;

            PERFORM append_ar_ledger_entry(
                v_customer_id, NEW.invoice_id, NEW.payment_id, NULL,
                v_entry_type, -NEW.amount_paid,
                v_method_code, NEW.reference,
                'Auto-recorded by invoice balance trigger (ledger safety net)',
                NEW.created_by, 'invoice_payments'
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMIT;
