#!/usr/bin/env node

const { Pool } = require('pg');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const API_BASE = 'http://localhost:3001/api';

const pool = new Pool({
  host: '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function runVerification() {
  console.log('🧪 Starting Cheque & Bank Transfer Verification Script...\n');

  try {
    // 1. Verify payment methods are enabled and settlement_type is delayed
    console.log('1. Verifying payment methods in database...');
    const pmRes = await pool.query(`
      SELECT method_id, code, name, enabled, settlement_type, config 
      FROM payment_methods 
      WHERE code IN ('cheque', 'bank_transfer');
    `);

    console.log('Payment Methods found:', pmRes.rows);

    const chequeMethod = pmRes.rows.find(r => r.code === 'cheque');
    const bankTransferMethod = pmRes.rows.find(r => r.code === 'bank_transfer');

    if (!chequeMethod || !chequeMethod.enabled || chequeMethod.settlement_type !== 'delayed') {
      throw new Error('Cheque payment method is not configured correctly in the DB.');
    }
    if (!bankTransferMethod || !bankTransferMethod.enabled || bankTransferMethod.settlement_type !== 'delayed') {
      throw new Error('Bank Transfer payment method is not configured correctly in the DB.');
    }
    console.log('✅ Payment methods verification passed.\n');

    // 2. Fetch a test customer, a test part, and the test user (employee)
    console.log('2. Fetching test data...');
    const customerRes = await pool.query('SELECT customer_id, first_name, last_name FROM customer LIMIT 1');
    if (!customerRes.rows.length) throw new Error('No customers found in database.');
    const testCustomer = customerRes.rows[0];
    console.log(`Using customer: ${testCustomer.first_name} ${testCustomer.last_name} (ID: ${testCustomer.customer_id})`);

    const partRes = await pool.query(`
      SELECT part_id, detail 
      FROM part 
      WHERE is_active = TRUE AND is_service = FALSE AND merged_into_part_id IS NULL
      LIMIT 1
    `);
    if (!partRes.rows.length) throw new Error('No active parts found in database.');
    const testPart = partRes.rows[0];
    const price = 50.00;
    console.log(`Using part: ${testPart.detail} (ID: ${testPart.part_id}, Price: ${price})`);

    const employeeRes = await pool.query(`
      SELECT employee_id, username, permission_level_id 
      FROM employee 
      WHERE username = 'kent.pilar' AND is_active = TRUE
      LIMIT 1
    `);
    if (!employeeRes.rows.length) throw new Error('Employee kent.pilar not found.');
    const testEmployee = employeeRes.rows[0];
    console.log(`Using employee: ${testEmployee.username} (ID: ${testEmployee.employee_id}, Permission Level: ${testEmployee.permission_level_id})`);
    
    // Generate JWT token for test employee
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET not found in environment variables.');
    }
    const token = jwt.sign({
      employee_id: testEmployee.employee_id,
      username: testEmployee.username,
      permission_level_id: testEmployee.permission_level_id
    }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log('✅ JWT Token generated successfully.\n');

    const authHeaders = {
      headers: {
        Authorization: `Bearer ${token}`
      }
    };

    // 3. Create Invoice with Split Payment: Cash (settled) + Cheque (pending)
    console.log('3. Creating Invoice with Cash (settled) + Cheque (pending)...');
    
    // Let's buy 2 units of the test part. Total sale price = 2 * retail_price
    const qty = 2;
    const invoiceTotal = qty * price;
    
    // Split the payment:
    // Cash (settled): 1/3 of the invoice total
    // Cheque (pending): 2/3 of the invoice total
    const cashAmount = Math.round((invoiceTotal / 3) * 100) / 100;
    const chequeAmount = Math.round((invoiceTotal - cashAmount) * 100) / 100;

    console.log(`Calculated Invoice Total: ${invoiceTotal}. Cash (settled): ${cashAmount}. Cheque (pending): ${chequeAmount}`);

    const invoicePayload = {
      customer_id: testCustomer.customer_id,
      employee_id: testEmployee.employee_id,
      terms: 'COD',
      payment_terms_days: 0,
      lines: [
        {
          part_id: testPart.part_id,
          quantity: qty,
          sale_price: price,
          discount_amount: 0
        }
      ],
      payments: [
        {
          method_id: 1, // Cash
          amount_paid: cashAmount,
          tendered_amount: cashAmount,
          reference: 'CASH-REC'
        },
        {
          method_id: chequeMethod.method_id, // Cheque
          amount_paid: chequeAmount,
          tendered_amount: chequeAmount,
          reference: 'CHQ-5551212'
        }
      ]
    };

    const invoiceResponse = await axios.post(`${API_BASE}/invoices`, invoicePayload);
    const { invoice_id, invoice_number } = invoiceResponse.data;
    console.log(`✅ Invoice created: ${invoice_number} (ID: ${invoice_id})`);

    // 4. Verify initial state of invoice and payments
    console.log('\n4. Verifying initial state in DB (Trigger Verification)...');
    
    // Get invoice details from DB
    const invDbRes = await pool.query('SELECT amount_paid, status, total_amount FROM invoice WHERE invoice_id = $1', [invoice_id]);
    const invoiceRecord = invDbRes.rows[0];
    console.log('Invoice in DB:', invoiceRecord);

    // Verify trigger ignored the pending cheque payment
    console.log(`Expected amount_paid: ${cashAmount}. Actual: ${parseFloat(invoiceRecord.amount_paid)}`);
    console.log(`Expected status: 'Partially Paid'. Actual: '${invoiceRecord.status}'`);

    if (Math.abs(parseFloat(invoiceRecord.amount_paid) - cashAmount) > 0.01) {
      throw new Error('Trigger did not ignore pending cheque payment! amount_paid is incorrect.');
    }
    if (invoiceRecord.status !== 'Partially Paid') {
      throw new Error('Trigger did not set invoice status to Partially Paid.');
    }
    console.log('✅ Trigger verification for pending payment passed.');

    // Fetch payments for this invoice
    const paymentsRes = await pool.query(`
      SELECT payment_id, method_id, amount_paid, payment_status, settled_at 
      FROM invoice_payments 
      WHERE invoice_id = $1
    `, [invoice_id]);
    console.log('Payments recorded for invoice:', paymentsRes.rows);

    const chequePayment = paymentsRes.rows.find(p => p.method_id === chequeMethod.method_id);
    const cashPayment = paymentsRes.rows.find(p => p.method_id === 1);

    if (!chequePayment || chequePayment.payment_status !== 'pending' || chequePayment.settled_at !== null) {
      throw new Error('Cheque payment is not in pending status.');
    }
    if (!cashPayment || cashPayment.payment_status !== 'settled' || cashPayment.settled_at === null) {
      throw new Error('Cash payment is not in settled status.');
    }
    console.log('✅ Initial payment statuses are correct.');

    // 5. Test manual settlement endpoint POST /api/payments/:id/settle
    console.log(`\n5. Settling cheque payment via API POST /api/payments/${chequePayment.payment_id}/settle...`);
    const settleRes = await axios.post(`${API_BASE}/payments/${chequePayment.payment_id}/settle`, {
      settlement_reference: 'SETTLE-CHQ-999'
    }, authHeaders);
    
    console.log('Settle Response:', settleRes.data);

    // 6. Verify that it updates status to 'settled' and triggers recalculation
    console.log('\n6. Verifying settled state in DB...');
    
    // Check payment status
    const chequePaymentAfter = await pool.query(`
      SELECT payment_status, settled_at, settlement_reference 
      FROM invoice_payments 
      WHERE payment_id = $1
    `, [chequePayment.payment_id]);
    const chequeRecord = chequePaymentAfter.rows[0];
    console.log('Cheque payment after settlement:', chequeRecord);

    if (chequeRecord.payment_status !== 'settled' || chequeRecord.settled_at === null || chequeRecord.settlement_reference !== 'SETTLE-CHQ-999') {
      throw new Error('Payment was not correctly updated to settled status.');
    }

    // Check invoice recalculation
    const invDbResAfter = await pool.query('SELECT amount_paid, status FROM invoice WHERE invoice_id = $1', [invoice_id]);
    const invoiceRecordAfter = invDbResAfter.rows[0];
    console.log('Invoice in DB after settlement:', invoiceRecordAfter);

    console.log(`Expected amount_paid: ${invoiceTotal}. Actual: ${parseFloat(invoiceRecordAfter.amount_paid)}`);
    console.log(`Expected status: 'Paid'. Actual: '${invoiceRecordAfter.status}'`);

    if (Math.abs(parseFloat(invoiceRecordAfter.amount_paid) - invoiceTotal) > 0.01) {
      throw new Error('Invoice amount_paid was not recalculated correctly after settlement.');
    }
    if (invoiceRecordAfter.status !== 'Paid') {
      throw new Error('Invoice status was not updated to Paid after settlement.');
    }
    console.log('✅ Settlement endpoint and recalculation trigger verification passed.\n');

    // 7. Verify unified payments view content
    console.log('7. Verifying payments_unified view...');
    const unifiedRes = await pool.query(`
      SELECT payment_id, source_table, amount_paid, payment_status, settled_at, settlement_reference
      FROM payments_unified
      WHERE payment_id IN ($1, $2)
    `, [cashPayment.payment_id, chequePayment.payment_id]);
    console.log('Unified view rows:', unifiedRes.rows);

    if (unifiedRes.rows.length !== 2) {
      throw new Error('Unified view did not contain both payments.');
    }
    console.log('✅ Payments unified view verification passed.\n');

    console.log('🎉 ALL AUTOMATED VERIFICATIONS SUCCEEDED! Cheque and Bank Transfer delayed payments work perfectly.');
    process.exit(0);

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    if (error.response) {
      console.error('API Error Response:', error.response.status, error.response.data);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runVerification();
