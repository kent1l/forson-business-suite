-- Phase 1 A/R Hardening: Historical reconciliation of broken 'Partially Refunded' invoices
-- Re-derives the correct status and amount_paid for every invoice currently stuck in
-- the 'Partially Refunded' state using the authoritative invoice_payments and credit_note tables.
-- Safe to re-run: the WHERE clause self-limits to the affected rows only.

BEGIN;

WITH computed AS (
    SELECT
        i.invoice_id,
        i.total_amount,
        COALESCE(SUM(CASE WHEN ip.payment_status = 'settled'
                     THEN ip.amount_paid ELSE 0 END), 0)   AS total_settled,
        COALESCE(cn_agg.total_refunded, 0)                  AS total_refunded
    FROM invoice i
    LEFT JOIN invoice_payments ip  ON ip.invoice_id = i.invoice_id
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(cn.total_amount), 0) AS total_refunded
        FROM credit_note cn WHERE cn.invoice_id = i.invoice_id
    ) cn_agg ON TRUE
    WHERE i.status = 'Partially Refunded'
    GROUP BY i.invoice_id, i.total_amount, cn_agg.total_refunded
),
resolved AS (
    SELECT
        invoice_id,
        total_settled,
        CASE
            WHEN total_refunded >= total_amount                                        THEN 'Fully Refunded'
            WHEN GREATEST(total_amount - total_refunded, 0) > 0
                 AND total_settled >= GREATEST(total_amount - total_refunded, 0)       THEN 'Paid'
            WHEN total_settled > 0                                                     THEN 'Partially Paid'
            ELSE 'Unpaid'
        END AS correct_status
    FROM computed
)
UPDATE invoice i
SET
    amount_paid = r.total_settled,
    status      = r.correct_status
FROM resolved r
WHERE i.invoice_id = r.invoice_id;

COMMIT;
