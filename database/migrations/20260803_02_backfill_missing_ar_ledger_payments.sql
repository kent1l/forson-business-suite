-- Migration: 20260803_02_backfill_missing_ar_ledger_payments.sql
-- Description: Backfill historical cleared/settled payments into ar_ledger
--              so that all payments reflect accurately in Statements of Account (SOA).

BEGIN;

-- 1. Drop restrictive payment_id FK so payment_id can track payments from either table
ALTER TABLE ar_ledger DROP CONSTRAINT IF EXISTS ar_ledger_payment_id_fkey;

-- 2. Backfill missing cleared payments into ar_ledger
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN (
        SELECT * FROM (
            -- Missing settled payments from legacy invoice_payments
            SELECT
                i.customer_id,
                ip.invoice_id,
                ip.payment_id,
                NULL::integer                                    AS cn_id,
                'PAYMENT_SETTLED'::ar_ledger_entry_type          AS entry_type,
                -ip.amount_paid                                  AS amount,
                pm.code::varchar(50)                             AS payment_channel,
                COALESCE(ip.reference, i.invoice_number)         AS reference_no,
                'Backfill: cleared payment'                      AS notes,
                ip.created_by,
                COALESCE(ip.settled_at, ip.created_at)          AS event_time
            FROM invoice_payments ip
            JOIN invoice i ON i.invoice_id = ip.invoice_id
            LEFT JOIN payment_methods pm ON pm.method_id = ip.method_id
            LEFT JOIN ar_ledger l ON l.payment_id = ip.payment_id AND l.entry_type = 'PAYMENT_SETTLED'
            WHERE (ip.pdc_status = 'CLEARED' OR ip.payment_status = 'settled')
              AND (pm.code IS NULL OR pm.code != 'on_account')
              AND l.ledger_id IS NULL

            UNION ALL

            -- Missing cleared payments from customer_payment
            SELECT
                cp.customer_id,
                NULL::integer                                    AS invoice_id,
                cp.payment_id,
                NULL::integer                                    AS cn_id,
                'PAYMENT_SETTLED'::ar_ledger_entry_type          AS entry_type,
                -cp.amount                                       AS amount,
                pm.code::varchar(50)                             AS payment_channel,
                cp.reference_number                              AS reference_no,
                'Backfill: cleared cheque/payment'               AS notes,
                NULL::integer                                    AS created_by,
                cp.payment_date                                  AS event_time
            FROM customer_payment cp
            LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
            LEFT JOIN ar_ledger l ON l.payment_id = cp.payment_id AND l.entry_type = 'PAYMENT_SETTLED'
            WHERE cp.pdc_status = 'CLEARED'
              AND l.ledger_id IS NULL
        ) combined
        ORDER BY customer_id, event_time ASC, payment_id ASC
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

    RAISE NOTICE 'ar_ledger missing cleared payments backfill complete';
END $$;

COMMIT;
