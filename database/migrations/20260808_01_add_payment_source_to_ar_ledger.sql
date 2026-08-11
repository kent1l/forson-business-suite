-- Migration: 20260808_01_add_payment_source_to_ar_ledger.sql
-- Description: Add payment_source column to ar_ledger to distinguish between
--              invoice_payments and customer_payment sources and resolve payment_id collisions.

BEGIN;

-- 1. Add payment_source column to ar_ledger
ALTER TABLE ar_ledger ADD COLUMN IF NOT EXISTS payment_source VARCHAR(30);

-- 2. Populate payment_source for existing rows (temporarily disabling immutability guard)
ALTER TABLE ar_ledger DISABLE TRIGGER trg_ar_ledger_immutable;

UPDATE ar_ledger
SET payment_source = CASE
    WHEN notes LIKE '%customer_payment%' 
      OR notes LIKE '%cleared cheque%' 
      OR notes LIKE '%Payment settled via%'
      OR (invoice_id IS NULL AND payment_id IS NOT NULL) 
    THEN 'customer_payment'
    WHEN payment_id IS NOT NULL 
    THEN 'invoice_payments'
    ELSE NULL
END
WHERE payment_id IS NOT NULL AND payment_source IS NULL;

ALTER TABLE ar_ledger ENABLE TRIGGER trg_ar_ledger_immutable;

-- 3. Update append_ar_ledger_entry function to accept p_payment_source
DROP FUNCTION IF EXISTS append_ar_ledger_entry(integer, integer, integer, integer, ar_ledger_entry_type, numeric, varchar, varchar, text, integer);

CREATE OR REPLACE FUNCTION append_ar_ledger_entry(
    p_customer_id     integer,
    p_invoice_id      integer,
    p_payment_id      integer,
    p_cn_id           integer,
    p_entry_type      ar_ledger_entry_type,
    p_amount          numeric(12,2),
    p_payment_channel varchar(50),
    p_reference_no    varchar(100),
    p_notes           text,
    p_created_by      integer,
    p_payment_source  varchar(30) DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_prev_balance  numeric(12,2);
    v_ledger_id     bigint;
BEGIN
    -- Lock the most recent row for this customer to avoid concurrent balance races
    SELECT balance_after INTO v_prev_balance
      FROM ar_ledger
     WHERE customer_id = p_customer_id
     ORDER BY ledger_id DESC
     LIMIT 1
       FOR UPDATE;

    v_prev_balance := COALESCE(v_prev_balance, 0);

    INSERT INTO ar_ledger
        (customer_id, invoice_id, payment_id, cn_id, entry_type,
         amount, balance_after, payment_channel, reference_no, notes, created_by, payment_source)
    VALUES
        (p_customer_id, p_invoice_id, p_payment_id, p_cn_id, p_entry_type,
         p_amount, v_prev_balance + p_amount, p_payment_channel,
         p_reference_no, p_notes, p_created_by, p_payment_source)
    RETURNING ledger_id INTO v_ledger_id;

    RETURN v_ledger_id;
END;
$$;

-- 4. Re-backfill any cleared customer_payments that were skipped due to payment_id collisions
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN (
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
            'customer_payment'::varchar(30)                  AS payment_source,
            cp.payment_date                                  AS event_time
        FROM customer_payment cp
        LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
        LEFT JOIN ar_ledger l 
               ON l.payment_id = cp.payment_id 
              AND l.payment_source = 'customer_payment' 
              AND l.entry_type = 'PAYMENT_SETTLED'
        WHERE cp.pdc_status = 'CLEARED'
          AND l.ledger_id IS NULL
        ORDER BY cp.customer_id, cp.payment_date ASC, cp.payment_id ASC
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
            rec.created_by,
            rec.payment_source
        );
    END LOOP;
END $$;

COMMIT;
