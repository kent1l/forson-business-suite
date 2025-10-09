-- Sales History Summary Verification Script
-- Run this script to verify the corrected formula calculations
-- This script should be run against the same date range as the frontend for comparison

-- Replace these dates with your test date range
\set start_date '2024-01-01'
\set end_date '2024-12-31'

\echo 'Sales History Summary Verification for date range:' :start_date 'to' :end_date

-- 1. Verify invoice data (gross, net, collected, outstanding)
\echo '=== INVOICE METRICS ==='
WITH invoice_metrics AS (
    SELECT 
        COUNT(*) FILTER (WHERE i.status != 'Cancelled') as invoices_issued,
        SUM(i.total_amount) FILTER (WHERE i.status != 'Cancelled') as gross_sales,
        SUM(COALESCE(r.refunded_amount, 0)) FILTER (WHERE i.status != 'Cancelled') as total_refunds,
        SUM(GREATEST(i.total_amount - COALESCE(r.refunded_amount, 0), 0)) FILTER (WHERE i.status != 'Cancelled') as net_sales,
        SUM(i.amount_paid) FILTER (WHERE i.status != 'Cancelled') as amount_collected,
        SUM(GREATEST((i.total_amount - COALESCE(r.refunded_amount, 0)) - i.amount_paid, 0)) FILTER (WHERE i.status != 'Cancelled') as ar_outstanding
    FROM invoice i
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(cn.total_amount), 0) AS refunded_amount
        FROM credit_note cn
        WHERE cn.invoice_id = i.invoice_id
    ) r ON TRUE
    WHERE i.invoice_date::date BETWEEN :start_date AND :end_date
)
SELECT 
    invoices_issued,
    gross_sales,
    total_refunds,
    net_sales,
    amount_collected,
    ar_outstanding,
    CASE 
        WHEN net_sales > 0 THEN ROUND((amount_collected / net_sales * 100)::numeric, 2)
        ELSE 0 
    END as collection_rate_percent
FROM invoice_metrics;

-- 2. Verify payment data (cash vs non-cash breakdown)
\echo '=== PAYMENT METRICS ==='
WITH payment_metrics AS (
    SELECT 
        pm.type as method_type,
        pm.name as method_name,
        SUM(pu.amount_paid) as total_amount,
        SUM(COALESCE(pu.tendered_amount, pu.amount_paid)) as total_tendered,
        SUM(COALESCE(pu.change_amount, 0)) as total_change,
        COUNT(*) as payment_count
    FROM payments_unified pu
    LEFT JOIN payment_methods pm ON pu.method_id = pm.method_id
    WHERE pu.created_at::date BETWEEN :start_date AND :end_date
    GROUP BY pm.type, pm.name
)
SELECT 
    method_type,
    method_name,
    total_amount,
    total_tendered,
    total_change,
    payment_count,
    CASE 
        WHEN method_type = 'cash' THEN 'CASH'
        ELSE 'NON-CASH'
    END as classification
FROM payment_metrics
ORDER BY method_type, method_name;

-- 3. Cash vs Non-Cash summary
\echo '=== CASH VS NON-CASH SUMMARY ==='
WITH cash_summary AS (
    SELECT 
        SUM(CASE WHEN pm.type = 'cash' THEN COALESCE(pu.tendered_amount, pu.amount_paid) ELSE 0 END) as cash_collected,
        SUM(CASE WHEN pm.type = 'cash' THEN COALESCE(pu.change_amount, 0) ELSE 0 END) as change_returned,
        SUM(CASE WHEN pm.type != 'cash' OR pm.type IS NULL THEN pu.amount_paid ELSE 0 END) as non_cash_collected
    FROM payments_unified pu
    LEFT JOIN payment_methods pm ON pu.method_id = pm.method_id
    WHERE pu.created_at::date BETWEEN :start_date AND :end_date
)
SELECT 
    cash_collected,
    change_returned,
    (cash_collected - change_returned) as cash_collected_net,
    non_cash_collected,
    (cash_collected + non_cash_collected) as total_collected_for_mix,
    CASE 
        WHEN (cash_collected + non_cash_collected) > 0 
        THEN ROUND((cash_collected / (cash_collected + non_cash_collected) * 100)::numeric, 2)
        ELSE 0 
    END as cash_mix_percent
FROM cash_summary;

-- 4. Refunds approximation
\echo '=== REFUNDS APPROXIMATION ==='
SELECT 
    SUM(total_amount) as total_refunds_approx
FROM credit_note
WHERE refund_date::date BETWEEN :start_date AND :end_date;

-- 5. Sample invoices for manual verification
\echo '=== SAMPLE INVOICES (First 5 for verification) ==='
SELECT 
    i.invoice_number,
    i.invoice_date,
    i.total_amount,
    COALESCE(r.refunded_amount, 0) as refunded_amount,
    GREATEST(i.total_amount - COALESCE(r.refunded_amount, 0), 0) as net_amount,
    i.amount_paid,
    GREATEST((i.total_amount - COALESCE(r.refunded_amount, 0)) - i.amount_paid, 0) as balance_due,
    i.status
FROM invoice i
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(cn.total_amount), 0) AS refunded_amount
    FROM credit_note cn
    WHERE cn.invoice_id = i.invoice_id
) r ON TRUE
WHERE i.invoice_date::date BETWEEN :start_date AND :end_date
AND i.status != 'Cancelled'
ORDER BY i.invoice_date DESC
LIMIT 5;

\echo 'Verification complete. Compare these results with frontend summary calculations.'