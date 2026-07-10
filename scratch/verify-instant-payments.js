const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'your_secret_password_here',
  database: 'forson_business_suite',
});

async function runTest() {
  console.log('🧪 Starting Cash & GCash Instant Payments Verification Script...\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure the payment methods are enabled and check their config
    console.log('Step 1: Checking payment methods configuration...');
    const pmRes = await client.query(`
      SELECT method_id, code, name, type, enabled, config, settlement_type 
      FROM payment_methods 
      WHERE code IN ('cash', 'gcash')
    `);

    const cashMethod = pmRes.rows.find(r => r.code === 'cash');
    const gcashMethod = pmRes.rows.find(r => r.code === 'gcash');

    if (!cashMethod || !cashMethod.enabled) {
      throw new Error('Cash payment method is not defined or not enabled in DB!');
    }
    console.log('✅ Cash payment method is enabled. Config:', JSON.stringify(cashMethod.config));

    if (!gcashMethod || !gcashMethod.enabled) {
      throw new Error('GCash payment method is not defined or not enabled in DB!');
    }
    console.log('✅ GCash payment method is enabled. Config:', JSON.stringify(gcashMethod.config));

    // Choose sample customer and employee
    const customerId = 1; // Walk-in Customer
    const employeeId = 1; // Kent Pilar
    const partId = 1; // Sample active part

    // Generate unique invoice numbers
    const cashInvoiceNum = 'TEST-CASH-' + Date.now();
    const gcashInvoiceNum = 'TEST-GCASH-' + Date.now();

    const totalAmount = 150.00;
    const subtotalExTax = 133.93;
    const taxTotal = 16.07;

    // --- TEST 1: CASH PAYMENT FLOW ---
    console.log('\n--- TEST 1: Cash Payment Transaction Flow ---');

    // Create Invoice for Cash Test
    const cashInvRes = await client.query(`
      INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, terms, payment_terms_days, due_date)
      VALUES ($1, $2, $3, $4, $5, $6, 0.00, 'Unpaid', 'COD', 0, CURRENT_TIMESTAMP)
      RETURNING invoice_id;
    `, [cashInvoiceNum, customerId, employeeId, totalAmount, subtotalExTax, taxTotal]);
    const cashInvoiceId = cashInvRes.rows[0].invoice_id;
    console.log(`Created Cash Test Invoice ID: ${cashInvoiceId}, Number: ${cashInvoiceNum}`);

    // Insert Invoice Line
    await client.query(`
      INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive)
      VALUES ($1, $2, 1, $3, 0.00, 0.00, NULL, 0.12, $4, $5, true);
    `, [cashInvoiceId, partId, totalAmount, subtotalExTax, taxTotal]);

    // Check state before payment
    let invState = await client.query('SELECT amount_paid, status FROM invoice WHERE invoice_id = $1', [cashInvoiceId]);
    console.log(`Before Cash payment - amount_paid: ${invState.rows[0].amount_paid}, status: ${invState.rows[0].status}`);
    if (parseFloat(invState.rows[0].amount_paid) !== 0 || invState.rows[0].status !== 'Unpaid') {
      throw new Error('Initial invoice state is incorrect (expected 0.00 / Unpaid)');
    }

    // Insert Cash Payment
    console.log('Inserting Cash payment of 150.00 (tendered 200.00, change 50.00)...');
    const cashPaymentStatus = 'settled'; // Since Cash settlement_type is instant
    await client.query(`
      INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, created_by, payment_status, settled_at)
      VALUES ($1, $2, $3, $4, $5, NULL, $6, $7::varchar, CURRENT_TIMESTAMP)
    `, [cashInvoiceId, cashMethod.method_id, totalAmount, 200.00, 50.00, employeeId, cashPaymentStatus]);

    // Check state after payment (should trigger update_invoice_balance_after_payment)
    invState = await client.query('SELECT amount_paid, status FROM invoice WHERE invoice_id = $1', [cashInvoiceId]);
    console.log(`After Cash payment - amount_paid: ${invState.rows[0].amount_paid}, status: ${invState.rows[0].status}`);
    if (parseFloat(invState.rows[0].amount_paid) !== totalAmount || invState.rows[0].status !== 'Paid') {
      throw new Error(`Invoice state after Cash payment is incorrect (expected ${totalAmount} / Paid, got ${invState.rows[0].amount_paid} / ${invState.rows[0].status})`);
    }
    console.log('✅ Cash payment trigger verification succeeded!');

    // Check payments_unified view for Cash
    let unifiedRes = await client.query(`
      SELECT source_table, amount_paid, tendered_amount, change_amount, method_code, method_name, payment_status, settled_at
      FROM payments_unified
      WHERE invoice_id = $1
    `, [cashInvoiceId]);
    console.log('Unified Payment View Record for Cash:', unifiedRes.rows[0]);
    if (unifiedRes.rows.length === 0 || unifiedRes.rows[0].method_code !== 'cash' || unifiedRes.rows[0].payment_status !== 'settled') {
      throw new Error('Cash payment not correctly represented in payments_unified!');
    }
    console.log('✅ Cash payments_unified verification succeeded!');


    // --- TEST 2: GCASH PAYMENT FLOW ---
    console.log('\n--- TEST 2: GCash Payment Transaction Flow ---');

    // Create Invoice for GCash Test
    const gcashInvRes = await client.query(`
      INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, terms, payment_terms_days, due_date)
      VALUES ($1, $2, $3, $4, $5, $6, 0.00, 'Unpaid', 'COD', 0, CURRENT_TIMESTAMP)
      RETURNING invoice_id;
    `, [gcashInvoiceNum, customerId, employeeId, totalAmount, subtotalExTax, taxTotal]);
    const gcashInvoiceId = gcashInvRes.rows[0].invoice_id;
    console.log(`Created GCash Test Invoice ID: ${gcashInvoiceId}, Number: ${gcashInvoiceNum}`);

    // Insert Invoice Line
    await client.query(`
      INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive)
      VALUES ($1, $2, 1, $3, 0.00, 0.00, NULL, 0.12, $4, $5, true);
    `, [gcashInvoiceId, partId, totalAmount, subtotalExTax, taxTotal]);

    // Check state before payment
    invState = await client.query('SELECT amount_paid, status FROM invoice WHERE invoice_id = $1', [gcashInvoiceId]);
    console.log(`Before GCash payment - amount_paid: ${invState.rows[0].amount_paid}, status: ${invState.rows[0].status}`);
    if (parseFloat(invState.rows[0].amount_paid) !== 0 || invState.rows[0].status !== 'Unpaid') {
      throw new Error('Initial invoice state is incorrect (expected 0.00 / Unpaid)');
    }

    // Insert GCash Payment
    console.log('Inserting GCash payment of 150.00 (tendered 150.00, reference "REF-GCASH-123")...');
    const gcashPaymentStatus = 'settled'; // Since GCash settlement_type is instant
    await client.query(`
      INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, created_by, payment_status, settled_at)
      VALUES ($1, $2, $3, $4, 0.00, $5, $6, $7::varchar, CURRENT_TIMESTAMP)
    `, [gcashInvoiceId, gcashMethod.method_id, totalAmount, totalAmount, 'REF-GCASH-123', employeeId, gcashPaymentStatus]);

    // Check state after payment (should trigger update_invoice_balance_after_payment)
    invState = await client.query('SELECT amount_paid, status FROM invoice WHERE invoice_id = $1', [gcashInvoiceId]);
    console.log(`After GCash payment - amount_paid: ${invState.rows[0].amount_paid}, status: ${invState.rows[0].status}`);
    if (parseFloat(invState.rows[0].amount_paid) !== totalAmount || invState.rows[0].status !== 'Paid') {
      throw new Error(`Invoice state after GCash payment is incorrect (expected ${totalAmount} / Paid, got ${invState.rows[0].amount_paid} / ${invState.rows[0].status})`);
    }
    console.log('✅ GCash payment trigger verification succeeded!');

    // Check payments_unified view for GCash
    unifiedRes = await client.query(`
      SELECT source_table, amount_paid, tendered_amount, change_amount, reference, method_code, method_name, payment_status, settled_at
      FROM payments_unified
      WHERE invoice_id = $1
    `, [gcashInvoiceId]);
    console.log('Unified Payment View Record for GCash:', unifiedRes.rows[0]);
    if (unifiedRes.rows.length === 0 || unifiedRes.rows[0].method_code !== 'gcash' || unifiedRes.rows[0].payment_status !== 'settled' || unifiedRes.rows[0].reference !== 'REF-GCASH-123') {
      throw new Error('GCash payment not correctly represented in payments_unified!');
    }
    console.log('✅ GCash payments_unified verification succeeded!');

    console.log('\n🎉 ALL TESTS COMPLETED SUCCESSFULLY! Rolling back transaction to keep DB clean.');
    await client.query('ROLLBACK');

  } catch (err) {
    console.error('❌ Test failed with error:', err.message);
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('Failed to rollback transaction:', rbErr.message);
    }
  } finally {
    client.release();
  }

  await pool.end();
}

runTest();
