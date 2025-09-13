-- Database Payment Methods Implementation Validation
-- Run this script to verify all payment method changes are working correctly

\echo '=== PAYMENT METHODS VALIDATION REPORT ==='

\echo '1. Payment Methods Table Structure:'
\d payment_methods

\echo '2. Invoice Payments Table Structure:'
\d invoice_payments

\echo '3. Customer Payment Table (with method_id):'
\d customer_payment

\echo '4. Invoice Table (with physical_receipt_no):'
\d invoice

\echo '5. Payment Methods Data:'
SELECT code, name, type, enabled, sort_order FROM payment_methods ORDER BY sort_order;

\echo '6. Payment Method Settings:'
SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE '%PAYMENT%';

\echo '7. Legacy Payment Linkage:'
SELECT 
    COUNT(*) as total_payments,
    COUNT(method_id) as linked_payments,
    COUNT(*) - COUNT(method_id) as unlinked_payments
FROM customer_payment;

\echo '8. Unified Payments View:'
SELECT source_table, COUNT(*) FROM payments_unified GROUP BY source_table;

\echo '9. Payment Validation Functions:'
SELECT proname, prosrc FROM pg_proc WHERE proname LIKE '%payment%';

\echo '10. Invoice Payment Triggers:'
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE '%payment%';

\echo '11. Foreign Key Constraints:'
SELECT 
    tc.table_name, 
    tc.constraint_name, 
    tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.constraint_type = 'FOREIGN KEY'
AND (tc.table_name = 'payment_methods' OR 
     tc.table_name = 'invoice_payments' OR 
     tc.table_name = 'customer_payment')
ORDER BY tc.table_name;

\echo '=== VALIDATION COMPLETE ==='
