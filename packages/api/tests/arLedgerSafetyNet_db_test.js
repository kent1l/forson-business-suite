// Real-database integration test for the AR ledger safety net added in
// 20260812_10_ar_ledger_production_hardening.sql. Excluded from the normal
// jest run (see jest.config.js testPathIgnorePatterns, matching the existing
// *_db_test.js convention) — run manually with a live DB via:
//   node tests/arLedgerSafetyNet_db_test.js
//
// Proves the exact bug class that caused three prior silent-drift incidents
// (20260803_02, 20260808_01, 20260811_02 backfill migrations) can no longer
// happen: it writes directly into invoice_payments via raw SQL, completely
// bypassing arLedgerService.appendEntry(), simulating "a developer forgot to
// call the ledger service" (or a future/unknown code path with the same gap,
// such as the still-live one in pdcService.js verifyPayment()'s legacy
// invoice_payments branch). The DB trigger must still produce a correct,
// single ar_ledger entry on its own.
//
// Runs entirely inside a transaction that is rolled back at the end, so it
// leaves no trace in the database regardless of outcome.

const db = require('../db');

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

async function run() {
  const client = await db.getClient();
  let failed = false;
  try {
    await client.query('BEGIN');

    const { rows: [customer] } = await client.query('SELECT customer_id FROM customer LIMIT 1');
    const { rows: [employee] } = await client.query('SELECT employee_id FROM employee LIMIT 1');
    const { rows: [method] } = await client.query("SELECT method_id, code FROM payment_methods WHERE code = 'cash' AND enabled = true LIMIT 1");
    assert(customer && employee && method, 'seed data (customer/employee/cash payment method) not found — cannot run test');

    const invoiceNumber = `TEST-SAFETYNET-${Date.now()}`;
    const { rows: [invoice] } = await client.query(
      `INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, amount_paid, status, terms, payment_terms_days)
       VALUES ($1, $2, $3, 500.00, 0, 'Unpaid', 'Net 30', 30)
       RETURNING invoice_id`,
      [invoiceNumber, customer.customer_id, employee.employee_id]
    );
    const invoiceId = invoice.invoice_id;

    // Simulate a code path that forgets to call arLedgerService.appendEntry():
    // insert straight into invoice_payments as 'settled' via raw SQL only.
    const { rows: [payment] } = await client.query(
      `INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, created_by, payment_status, settled_at)
       VALUES ($1, $2, 300.00, $3, 'settled', CURRENT_TIMESTAMP)
       RETURNING payment_id`,
      [invoiceId, method.method_id, employee.employee_id]
    );
    const paymentId = payment.payment_id;

    // 1) invoice.amount_paid/status still self-heal via the pre-existing recompute trigger.
    const { rows: [inv] } = await client.query('SELECT amount_paid, status FROM invoice WHERE invoice_id = $1', [invoiceId]);
    assert(Number(inv.amount_paid) === 300, `invoice.amount_paid expected 300, got ${inv.amount_paid}`);
    assert(inv.status === 'Partially Paid', `invoice.status expected 'Partially Paid', got '${inv.status}'`);

    // 2) ar_ledger must have exactly one auto-created PAYMENT_SETTLED entry, despite no
    //    application code ever calling arLedgerService.appendEntry() for this payment.
    // Note: payment_id is not a globally unique key across payment_source values
    // (invoice_payments.payment_id and customer_payment.payment_id are independent
    // sequences that can collide — see 20260808_01_add_payment_source_to_ar_ledger.sql),
    // so payment_source must always be part of the filter, not just payment_id.
    const { rows: ledgerRows } = await client.query(
      `SELECT ledger_id, amount, payment_source, notes
         FROM ar_ledger
        WHERE payment_id = $1 AND payment_source = 'invoice_payments' AND entry_type = 'PAYMENT_SETTLED'`,
      [paymentId]
    );
    assert(ledgerRows.length === 1, `expected exactly 1 auto-created ledger entry, got ${ledgerRows.length}`);
    assert(Number(ledgerRows[0].amount) === -300, `ledger amount expected -300, got ${ledgerRows[0].amount}`);
    assert(ledgerRows[0].payment_source === 'invoice_payments', `payment_source expected 'invoice_payments', got '${ledgerRows[0].payment_source}'`);

    // 3) Idempotency: a second, explicit append_ar_ledger_entry() call for the same payment
    //    (simulating app code ALSO calling appendEntry, unaware the trigger already did) must
    //    not create a duplicate ledger row or double-count the balance.
    await client.query(
      `SELECT append_ar_ledger_entry($1, $2, $3, NULL, 'PAYMENT_SETTLED'::ar_ledger_entry_type, -300.00, $4, 'manual-retry', 'duplicate call test', $5, 'invoice_payments')`,
      [customer.customer_id, invoiceId, paymentId, method.code, employee.employee_id]
    );
    const { rows: [dup] } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM ar_ledger WHERE payment_id = $1 AND payment_source = 'invoice_payments' AND entry_type = 'PAYMENT_SETTLED'`,
      [paymentId]
    );
    assert(dup.cnt === 1, `idempotency failed: expected 1 row after duplicate call, got ${dup.cnt}`);

    console.log('arLedgerSafetyNet DB test passed');
  } catch (err) {
    failed = true;
    console.error('Test failed:', err);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  process.exit(failed ? 1 : 0);
}

run();
