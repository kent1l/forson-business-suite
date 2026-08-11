-- Migration: 20260811_02_backfill_ar_ledger_settle_gaps.sql
-- Description: Two live code paths mutated invoice/payment balances without writing an
--              ar_ledger entry: PUT /invoices/payments/:payment_id/settle (invoiceRoutes.js)
--              and the POS staged-sale approval flow (stagedSaleRoutes.js). Both were fixed
--              in this same batch of changes to write PAYMENT_SETTLED entries going forward.
--              This re-runs the same "settled payment missing from ar_ledger" backfill query
--              as 20260803_02_backfill_missing_ar_ledger_payments.sql to catch any rows that
--              became settled via those two gaps between that migration and this fix.

BEGIN;

DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN (
        SELECT
            i.customer_id,
            ip.invoice_id,
            ip.payment_id,
            NULL::integer                                    AS cn_id,
            'PAYMENT_SETTLED'::ar_ledger_entry_type          AS entry_type,
            -ip.amount_paid                                  AS amount,
            pm.code::varchar(50)                             AS payment_channel,
            COALESCE(ip.reference, i.invoice_number)         AS reference_no,
            'Backfill: settled payment missing ledger entry' AS notes,
            ip.created_by,
            COALESCE(ip.settled_at, ip.created_at)           AS event_time
        FROM invoice_payments ip
        JOIN invoice i ON i.invoice_id = ip.invoice_id
        LEFT JOIN payment_methods pm ON pm.method_id = ip.method_id
        LEFT JOIN ar_ledger l ON l.payment_id = ip.payment_id AND l.entry_type = 'PAYMENT_SETTLED'
        WHERE (ip.pdc_status = 'CLEARED' OR ip.payment_status = 'settled')
          AND (pm.code IS NULL OR pm.code != 'on_account')
          AND ip.amount_paid > 0
          AND l.ledger_id IS NULL
        ORDER BY i.customer_id, event_time ASC, ip.payment_id ASC
    )
    LOOP
        PERFORM append_ar_ledger_entry(
            rec.customer_id,
            rec.invoice_id,
            rec.payment_id,
            rec.cn_id,
            rec.entry_type,
            rec.amount,
            rec.payment_channel,
            rec.reference_no,
            rec.notes,
            rec.created_by
        );
    END LOOP;

    RAISE NOTICE 'ar_ledger settle-gap backfill complete';
END $$;

COMMIT;
