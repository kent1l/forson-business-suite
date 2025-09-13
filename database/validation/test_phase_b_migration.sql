-- Test script to verify Phase B migration worked correctly
-- This script tests that all payment operations work with payments_unified

\echo 'Testing payments_unified view functionality...'

-- Test 1: Verify payments_unified aggregates both tables
\echo 'Test 1: Checking payments_unified aggregation'
SELECT 
    source_table, 
    COUNT(*) as count,
    SUM(amount_paid) as total_amount
FROM payments_unified 
GROUP BY source_table;

-- Test 2: Verify payment method usage check works
\echo 'Test 2: Testing payment method usage query'
SELECT 
    method_id,
    method_name,
    COUNT(*) as usage_count
FROM payments_unified 
WHERE method_id IS NOT NULL 
GROUP BY method_id, method_name 
ORDER BY usage_count DESC;

-- Test 3: Verify payment listing query works (mimics paymentRoutes.js)
\echo 'Test 3: Testing payment listing query'
SELECT 
    payment_id, 
    customer_id, 
    employee_id, 
    created_at as payment_date, 
    amount_paid as amount, 
    tendered_amount, 
    legacy_method as payment_method, 
    reference
FROM payments_unified
WHERE (created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN '2025-09-01' AND '2025-09-13'
AND source_table = 'customer_payment'
ORDER BY created_at DESC 
LIMIT 3;

-- Test 4: Verify invoice deletion would work (check what we would delete)
\echo 'Test 4: Testing invoice deletion preparation'
-- Find a recent invoice to test deletion logic
WITH recent_invoice AS (
    SELECT invoice_id, invoice_number 
    FROM invoice 
    ORDER BY invoice_date DESC 
    LIMIT 1
)
SELECT 
    'invoice_payments' as table_name,
    COUNT(*) as records_to_delete
FROM invoice_payments ip, recent_invoice ri
WHERE ip.invoice_id = ri.invoice_id
UNION ALL
SELECT 
    'customer_payment' as table_name,
    COUNT(*) as records_to_delete
FROM customer_payment cp, recent_invoice ri
WHERE cp.reference_number = ri.invoice_number
UNION ALL
SELECT 
    'invoice_payment_allocation' as table_name,
    COUNT(*) as records_to_delete
FROM invoice_payment_allocation ipa, recent_invoice ri
WHERE ipa.invoice_id = ri.invoice_id;

-- Test 5: Verify unified view includes all necessary columns
\echo 'Test 5: Checking payments_unified structure'
\d payments_unified

\echo 'All tests completed. Verify output manually for correctness.'
