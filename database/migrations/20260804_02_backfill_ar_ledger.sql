-- Phase 2 A/R: Backfill ar_ledger from existing data
-- Seeds ledger entries from all settled invoice_payments, credit_notes, and
-- credit-term invoices — in chronological order per customer.
-- Idempotent: skips entirely if ar_ledger already has rows.

BEGIN;

DO $$
DECLARE
    rec RECORD;
    already_seeded boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM ar_ledger LIMIT 1) INTO already_seeded;
    IF already_seeded THEN
        RAISE NOTICE 'ar_ledger already contains rows — backfill skipped';
        RETURN;
    END IF;

    FOR rec IN (
        -- INVOICE_POSTED: credit-term invoices only (Cash invoices have no AR impact)
        SELECT
            i.customer_id,
            i.invoice_id,
            NULL::integer               AS payment_id,
            NULL::integer               AS cn_id,
            'INVOICE_POSTED'::text      AS entry_type,
            i.total_amount              AS amount,
            NULL::varchar(50)           AS payment_channel,
            i.invoice_number            AS reference_no,
            'Backfill: invoice posted'  AS notes,
            i.employee_id               AS created_by,
            COALESCE(i.submitted_at, i.approved_at, CURRENT_TIMESTAMP) AS event_time
        FROM invoice i
        WHERE i.terms IS DISTINCT FROM 'Cash'
          AND i.terms IS NOT NULL

        UNION ALL

        -- PAYMENT_SETTLED: all settled invoice_payments
        SELECT
            i.customer_id,
            ip.invoice_id,
            ip.payment_id,
            NULL::integer,
            'PAYMENT_SETTLED'::text,
            -ip.amount_paid,
            pm.code::varchar(50)                            AS payment_channel,
            COALESCE(ip.reference, i.invoice_number),
            'Backfill: payment settled',
            ip.created_by,
            COALESCE(ip.settled_at, ip.created_at)
        FROM invoice_payments ip
        JOIN invoice i        ON i.invoice_id  = ip.invoice_id
        JOIN payment_methods pm ON pm.method_id = ip.method_id
        WHERE ip.payment_status = 'settled'

        UNION ALL

        -- CREDIT_MEMO_APPLIED: all credit notes
        SELECT
            i.customer_id,
            cn.invoice_id,
            NULL::integer,
            cn.cn_id,
            'CREDIT_MEMO_APPLIED'::text,
            -cn.total_amount,
            NULL::varchar(50),
            cn.cn_number,
            'Backfill: credit memo applied',
            cn.employee_id,
            COALESCE(cn.refund_date, CURRENT_TIMESTAMP)
        FROM credit_note cn
        JOIN invoice i ON i.invoice_id = cn.invoice_id

        ORDER BY customer_id, event_time ASC
    )
    LOOP
        PERFORM append_ar_ledger_entry(
            rec.customer_id,
            rec.invoice_id,
            rec.payment_id,
            rec.cn_id,
            rec.entry_type::ar_ledger_entry_type,
            rec.amount,
            rec.payment_channel,
            rec.reference_no,
            rec.notes,
            rec.created_by
        );
    END LOOP;

    RAISE NOTICE 'ar_ledger backfill complete';
END $$;

COMMIT;
