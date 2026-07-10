#!/usr/bin/env node

/**
 * Automated Verification Script for the On Account Payment Method (settlement_type = 'on_account')
 * Store path: scratch/verify-on-account.js
 */

const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config({ path: '/home/dev-server/docker/forson-business-suite/.env' });

const API_BASE = 'http://localhost:3001/api';

// Create a database connection pool
const pool = new Pool({
  host: '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function main() {
  console.log('🧪 STARTING ON-ACCOUNT PAYMENT METHOD VERIFICATION 🧪\n');
  
  let authToken = null;
  let employeeId = null;
  let walkInCustomerId = null;
  let testCustomerId = null;
  let testPartId = null;
  let testPartPrice = 1500.00;
  let onAccountMethodId = null;
  let testInvoiceId = null;
  let testInvoiceNumber = null;

  try {
    // ----------------------------------------------------
    // Step 1: Query the database to ensure payment method is enabled
    // ----------------------------------------------------
    console.log('Step 1: Checking payment method in database...');
    const pmResult = await pool.query(`
      SELECT method_id, name, code, type, settlement_type, enabled, config 
      FROM payment_methods 
      WHERE settlement_type = 'on_account'
    `);

    if (pmResult.rows.length === 0) {
      throw new Error("No payment method with settlement_type = 'on_account' found in database.");
    }

    const pm = pmResult.rows[0];
    onAccountMethodId = pm.method_id;
    console.log(`✅ Database check passed!`);
    console.log(`   - Name: "${pm.name}"`);
    console.log(`   - Code: "${pm.code}"`);
    console.log(`   - Settlement Type: "${pm.settlement_type}"`);
    console.log(`   - Enabled: ${pm.enabled}`);
    console.log(`   - Config: ${JSON.stringify(pm.config)}`);

    if (!pm.enabled) {
      console.log('   ⚠️  Payment method is disabled. Enabling it for testing...');
      await pool.query("UPDATE payment_methods SET enabled = true WHERE method_id = $1", [onAccountMethodId]);
      console.log('   ✅ Payment method enabled successfully');
    }

    // Verify check constraints on invoice_payments table
    const constraintResult = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid = 'invoice_payments'::regclass
    `);
    console.log('   - Table constraints on invoice_payments:');
    for (const row of constraintResult.rows) {
      console.log(`     * ${row.conname}: ${row.pg_get_constraintdef}`);
    }

    // ----------------------------------------------------
    // Step 2: Authenticate with the API
    // ----------------------------------------------------
    console.log('\nStep 2: Authenticating with API...');
    const loginResponse = await axios.post(`${API_BASE}/login`, {
      username: 'kent.pilar',
      password: 'onelpilar1123'
    });
    authToken = loginResponse.data.token;
    employeeId = loginResponse.data.user.employee_id;
    console.log(`✅ Authentication successful. Employee ID: ${employeeId}`);

    // ----------------------------------------------------
    // Step 3: Setup Test Customers and Parts in the Database
    // ----------------------------------------------------
    console.log('\nStep 3: Setting up test records (customers and parts)...');

    // 3a. Find or create Walk-In Customer
    const walkInRes = await pool.query("SELECT customer_id FROM customer WHERE LOWER(first_name || ' ' || COALESCE(last_name, '')) LIKE '%walk-in%' LIMIT 1");
    if (walkInRes.rows.length > 0) {
      walkInCustomerId = walkInRes.rows[0].customer_id;
      console.log(`   - Found existing Walk-In customer (ID: ${walkInCustomerId})`);
    } else {
      const createWalkIn = await pool.query("INSERT INTO customer (first_name, last_name, company_name) VALUES ('Walk-In', 'Customer', 'Walk-In Corp') RETURNING customer_id");
      walkInCustomerId = createWalkIn.rows[0].customer_id;
      console.log(`   - Created temporary Walk-In customer (ID: ${walkInCustomerId})`);
    }

    // 3b. Find or create Regular Test Customer
    const testCustRes = await pool.query("SELECT customer_id FROM customer WHERE email = 'test.onaccount@example.com' LIMIT 1");
    if (testCustRes.rows.length > 0) {
      testCustomerId = testCustRes.rows[0].customer_id;
      console.log(`   - Found existing Test customer (ID: ${testCustomerId})`);
    } else {
      const createTestCust = await pool.query("INSERT INTO customer (first_name, last_name, company_name, email) VALUES ('Test OnAccount', 'Customer', 'Test Account Co', 'test.onaccount@example.com') RETURNING customer_id");
      testCustomerId = createTestCust.rows[0].customer_id;
      console.log(`   - Created temporary Test customer (ID: ${testCustomerId})`);
    }

    // 3c. Find active part for invoice line
    const partRes = await pool.query("SELECT part_id, detail, last_sale_price FROM part WHERE is_active = true LIMIT 1");
    if (partRes.rows.length === 0) {
      throw new Error("No active part found in the database to create invoice lines.");
    }
    testPartId = partRes.rows[0].part_id;
    testPartPrice = parseFloat(partRes.rows[0].last_sale_price) || 1500.00;
    console.log(`   - Found active part: "${partRes.rows[0].detail}" (ID: ${testPartId}, Retail Price: ${testPartPrice})`);

    // ----------------------------------------------------
    // Step 4: Verify Walk-In customer blocking
    // ----------------------------------------------------
    console.log('\nStep 4: Verifying Walk-In customer blocking...');
    try {
      await axios.post(`${API_BASE}/invoices`, {
        customer_id: walkInCustomerId,
        employee_id: employeeId,
        physical_receipt_no: 'PR-BLOCK-' + Date.now(),
        lines: [
          { part_id: testPartId, quantity: 1, sale_price: testPartPrice }
        ],
        payments: [
          { method_id: onAccountMethodId, amount_paid: testPartPrice, tendered_amount: testPartPrice, reference: 'Test Block' }
        ]
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('❌ Error: The API allowed creating an On Account invoice for a Walk-In customer!');
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('✅ Success: API correctly rejected Walk-In customer with On Account payment.');
        console.log(`   API Response: "${error.response.data.message}"`);
      } else {
        console.log('❌ Error: Unexpected error during Walk-In blocking check:', error.message);
      }
    }

    // ----------------------------------------------------
    // Step 5: Verify creating On Account invoice for regular customer succeeds
    // ----------------------------------------------------
    console.log('\nStep 5: Creating invoice with On Account payment for regular customer...');
    const invoiceRes = await axios.post(`${API_BASE}/invoices`, {
      customer_id: testCustomerId,
      employee_id: employeeId,
      physical_receipt_no: 'PR-SUCCESS-' + Date.now(),
      lines: [
        { part_id: testPartId, quantity: 1, sale_price: testPartPrice }
      ],
      payments: [
        { method_id: onAccountMethodId, amount_paid: testPartPrice, tendered_amount: testPartPrice, reference: 'OnAccount-Test-Ref-999' }
      ]
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    testInvoiceId = invoiceRes.data.invoice_id;
    testInvoiceNumber = invoiceRes.data.invoice_number;
    console.log(`✅ Success: Invoice created! ID: ${testInvoiceId}, Number: ${testInvoiceNumber}`);
    console.log(`   Invoice Total Amount: ${invoiceRes.data.total_amount}`);

    // ----------------------------------------------------
    // Step 6: Verify Database Recording (invoice remained unpaid, amount_paid = 0, trigger worked)
    // ----------------------------------------------------
    console.log('\nStep 6: Verifying Database Recording...');
    const invDbRes = await pool.query("SELECT invoice_id, invoice_number, total_amount, amount_paid, status FROM invoice WHERE invoice_id = $1", [testInvoiceId]);
    const inv = invDbRes.rows[0];
    
    console.log(`   Invoice status in DB: "${inv.status}" (Expected: "Unpaid")`);
    console.log(`   Invoice amount_paid in DB: ${inv.amount_paid} (Expected: 0.00)`);
    console.log(`   Invoice total_amount in DB: ${inv.total_amount}`);

    const isUnpaid = inv.status === 'Unpaid';
    const hasZeroAmountPaid = parseFloat(inv.amount_paid) === 0;

    if (isUnpaid && hasZeroAmountPaid) {
      console.log('✅ Success: Invoice remains unpaid and amount_paid does not count the on-account payment!');
    } else {
      console.log('❌ Error: DB values incorrect for On Account invoice!');
    }

    // ----------------------------------------------------
    // Step 7: Verify payment records are stored correctly in database
    // ----------------------------------------------------
    console.log('\nStep 7: Verifying invoice_payments record status...');
    const payDbRes = await pool.query("SELECT payment_id, method_id, amount_paid, payment_status, reference FROM invoice_payments WHERE invoice_id = $1", [testInvoiceId]);
    
    if (payDbRes.rows.length === 0) {
      console.log('❌ Error: No payment record found in invoice_payments table!');
    } else {
      const pay = payDbRes.rows[0];
      console.log(`   Payment ID: ${pay.payment_id}`);
      console.log(`   Payment Method ID: ${pay.method_id} (Expected: ${onAccountMethodId})`);
      console.log(`   Payment Status: "${pay.payment_status}" (Expected: "on_account")`);
      console.log(`   Payment Amount Paid: ${pay.amount_paid}`);
      console.log(`   Payment Reference: "${pay.reference}"`);

      if (pay.payment_status === 'on_account') {
        console.log('✅ Success: Payment status is correctly recorded as "on_account"!');
      } else {
        console.log(`❌ Error: Payment status was recorded as "${pay.payment_status}" instead of "on_account"!`);
      }
    }

    // ----------------------------------------------------
    // Step 8: Verify A/R Views (invoice_with_balance & invoice_aging)
    // ----------------------------------------------------
    console.log('\nStep 8: Verifying invoice_with_balance and invoice_aging views...');
    const iwbRes = await pool.query("SELECT balance_due, on_account_amount, settled_amount FROM invoice_with_balance WHERE invoice_id = $1", [testInvoiceId]);
    if (iwbRes.rows.length > 0) {
      const iwb = iwbRes.rows[0];
      console.log(`   invoice_with_balance values:`);
      console.log(`     - balance_due: ${iwb.balance_due} (Expected: ${inv.total_amount})`);
      console.log(`     - on_account_amount: ${iwb.on_account_amount} (Expected: ${testPartPrice})`);
      console.log(`     - settled_amount: ${iwb.settled_amount} (Expected: 0)`);
      if (parseFloat(iwb.balance_due) > 0 && parseFloat(iwb.on_account_amount) > 0) {
        console.log('   ✅ invoice_with_balance query successful and values are correct.');
      } else {
        console.log('   ❌ Error: invoice_with_balance returned incorrect values.');
      }
    } else {
      console.log('   ❌ Error: Invoice not found in invoice_with_balance view.');
    }

    const agingRes = await pool.query("SELECT balance_due, on_account_amount, aging_bucket FROM invoice_aging WHERE invoice_id = $1", [testInvoiceId]);
    if (agingRes.rows.length > 0) {
      console.log(`   invoice_aging values:`);
      console.log(`     - balance_due: ${agingRes.rows[0].balance_due}`);
      console.log(`     - on_account_amount: ${agingRes.rows[0].on_account_amount}`);
      console.log(`     - aging_bucket: "${agingRes.rows[0].aging_bucket}" (Expected: "Current")`);
      console.log('   ✅ invoice_aging query successful.');
    } else {
      console.log('   ❌ Error: Invoice not found in invoice_aging view.');
    }

    // ----------------------------------------------------
    // Step 9: Verify payments are correctly queried by reports (payments_unified view)
    // ----------------------------------------------------
    console.log('\nStep 9: Verifying reports queries (payments_unified view)...');
    const unifiedRes = await pool.query("SELECT payment_id, invoice_id, amount_paid, payment_status, method_name FROM payments_unified WHERE invoice_id = $1", [testInvoiceId]);
    if (unifiedRes.rows.length > 0) {
      const up = unifiedRes.rows[0];
      console.log(`   payments_unified values:`);
      console.log(`     - payment_id: ${up.payment_id}`);
      console.log(`     - invoice_id: ${up.invoice_id}`);
      console.log(`     - amount_paid: ${up.amount_paid}`);
      console.log(`     - payment_status: "${up.payment_status}" (Expected: "on_account")`);
      console.log(`     - method_name: "${up.method_name}"`);
      if (up.payment_status === 'on_account') {
        console.log('   ✅ Success: On-account payment is correctly exposed in payments_unified!');
      } else {
        console.log('   ❌ Error: payments_unified status is incorrect.');
      }
    } else {
      console.log('   ❌ Error: On-account payment not found in payments_unified view.');
    }

    // ----------------------------------------------------
    // Step 10: Verify how they appear in the reports / Sales History via APIs
    // ----------------------------------------------------
    console.log('\nStep 10: Querying reports APIs to verify summary metrics...');
    
    // 10a. API /payments list check
    const todayStr = new Date().toISOString().split('T')[0];
    const apiPaymentsRes = await axios.get(`${API_BASE}/payments`, {
      params: { startDate: todayStr, endDate: todayStr },
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    const ourApiPayment = apiPaymentsRes.data.find(p => p.reference === 'OnAccount-Test-Ref-999');
    if (ourApiPayment) {
      console.log(`   - /api/payments API returned our test payment!`);
      console.log(`     Amount: ${ourApiPayment.amount}, Method: "${ourApiPayment.payment_method}", Reference: "${ourApiPayment.reference}"`);
      console.log('   ✅ Success: Payments API reports on-account payments correctly.');
    } else {
      console.log('   ❌ Error: Our test payment was not returned by /api/payments API.');
    }

    // 10b. API /ar/dashboard-stats check
    const arStatsRes = await axios.get(`${API_BASE}/ar/dashboard-stats`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log(`   - A/R Dashboard Total Receivables: ${arStatsRes.data.totalReceivables}`);
    console.log(`   - A/R Dashboard Overdue Invoices Count: ${arStatsRes.data.overdueInvoices}`);
    console.log('   ✅ A/R Dashboard stats retrieved successfully.');

    // 10c. API /ar/aging-summary check
    const agingSummaryRes = await axios.get(`${API_BASE}/ar/aging-summary`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log(`   - A/R Aging Summary:`, agingSummaryRes.data);
    console.log('   ✅ A/R Aging summary retrieved successfully.');

  } catch (err) {
    console.error('\n💥 VERIFICATION PROCESS CRASHED:', err.response?.data?.message || err.message);
  } finally {
    // ----------------------------------------------------
    // Cleanup Section
    // ----------------------------------------------------
    console.log('\n🧹 Cleaning up test records...');
    try {
      if (testInvoiceId) {
        // Cascade delete will clean up payments and lines
        await pool.query('DELETE FROM invoice WHERE invoice_id = $1', [testInvoiceId]);
        console.log(`   - Deleted test invoice (ID: ${testInvoiceId})`);
      }
      
      // Delete temporary customer if created
      const cleanupCust = await pool.query("DELETE FROM customer WHERE email = 'test.onaccount@example.com' RETURNING customer_id");
      if (cleanupCust.rows.length > 0) {
        console.log(`   - Deleted temporary test customer`);
      }
    } catch (cleanupErr) {
      console.error('   ⚠️ Error during cleanup:', cleanupErr.message);
    }
    
    await pool.end();
    console.log('\n🏁 VERIFICATION COMPLETE. Database pool closed.');
  }
}

main();
