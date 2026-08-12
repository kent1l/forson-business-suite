// Real-database integration test for the AP ledger safety net added in
// 20260812_12_ap_ledger_production_hardening.sql. Excluded from the normal
// jest run (see jest.config.js testPathIgnorePatterns, matching the existing
// *_db_test.js convention) — run manually with a live DB via:
//   node tests/apLedgerSafetyNet_db_test.js
//
// Mirrors tests/arLedgerSafetyNet_db_test.js: unlike invoice_payments,
// supplier_bill.amount_paid/status has never had a DB trigger — it was only
// ever recomputed by hand in apPdcService.js, the same fragile pattern that
// already caused three separate AR incidents. This proves the new trigger
// closes that gap for AP before it has a chance to repeat AR's history: it
// writes directly into supplier_bill / ap_payment / ap_payment_allocation via
// raw SQL, completely bypassing apLedgerService.appendEntry(), and checks
// that the bill balance and ap_ledger both still end up correct — including
// through a subsequent bounce, which must reverse both automatically.
//
// Runs entirely inside a transaction that is rolled back at the end.

const db = require('../db');

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

async function run() {
  const client = await db.getClient();
  let failed = false;
  try {
    await client.query('BEGIN');

    const { rows: [supplier] } = await client.query('SELECT supplier_id FROM supplier LIMIT 1');
    const { rows: [employee] } = await client.query('SELECT employee_id FROM employee LIMIT 1');
    const { rows: [method] } = await client.query("SELECT method_id, code FROM payment_methods WHERE code = 'cheque' LIMIT 1");
    assert(supplier && employee && method, 'seed data (supplier/employee/cheque payment method) not found — cannot run test');

    const billNumber = `TEST-AP-SAFETYNET-${Date.now()}`;
    const { rows: [bill] } = await client.query(
      `INSERT INTO supplier_bill (supplier_id, bill_number, total_amount, amount_paid, status)
       VALUES ($1, $2, 500.00, 0, 'Unpaid')
       RETURNING bill_id`,
      [supplier.supplier_id, billNumber]
    );
    const billId = bill.bill_id;

    // Simulate issueOutboundCheque(): ap_payment created as 'ISSUED' (not yet settled),
    // with an allocation against the bill. No ledger entry expected yet.
    const { rows: [payment] } = await client.query(
      `INSERT INTO ap_payment (supplier_id, employee_id, amount, method_id, pdc_status, created_by)
       VALUES ($1, $2, 300.00, $3, 'ISSUED', $4)
       RETURNING payment_id`,
      [supplier.supplier_id, employee.employee_id, method.method_id, employee.employee_id]
    );
    const paymentId = payment.payment_id;

    await client.query(
      `INSERT INTO ap_payment_allocation (payment_id, bill_id, amount_allocated) VALUES ($1, $2, 300.00)`,
      [paymentId, billId]
    );

    const { rows: [billAfterIssue] } = await client.query('SELECT amount_paid, status FROM supplier_bill WHERE bill_id = $1', [billId]);
    assert(Number(billAfterIssue.amount_paid) === 0, `bill.amount_paid expected 0 while ISSUED, got ${billAfterIssue.amount_paid}`);
    assert(billAfterIssue.status === 'Unpaid', `bill.status expected 'Unpaid' while ISSUED, got '${billAfterIssue.status}'`);

    // Simulate the exact gap: flip pdc_status to CLEARED via raw SQL only,
    // completely bypassing apLedgerService.appendEntry().
    await client.query(`UPDATE ap_payment SET pdc_status = 'CLEARED' WHERE payment_id = $1`, [paymentId]);

    // 1) supplier_bill.amount_paid/status must self-heal via the new recompute trigger.
    const { rows: [billAfterClear] } = await client.query('SELECT amount_paid, status FROM supplier_bill WHERE bill_id = $1', [billId]);
    assert(Number(billAfterClear.amount_paid) === 300, `bill.amount_paid expected 300 after clear, got ${billAfterClear.amount_paid}`);
    assert(billAfterClear.status === 'Partially Paid', `bill.status expected 'Partially Paid' after clear, got '${billAfterClear.status}'`);

    // 2) ap_ledger must have exactly one auto-created PAYMENT_SETTLED entry.
    const { rows: ledgerRows } = await client.query(
      `SELECT ledger_id, amount, notes FROM ap_ledger WHERE payment_id = $1 AND entry_type = 'PAYMENT_SETTLED'`,
      [paymentId]
    );
    assert(ledgerRows.length === 1, `expected exactly 1 auto-created ledger entry, got ${ledgerRows.length}`);
    assert(Number(ledgerRows[0].amount) === -300, `ledger amount expected -300, got ${ledgerRows[0].amount}`);

    // 3) Idempotency: a second, explicit append_ap_ledger_entry() call for the same
    //    payment must not create a duplicate row.
    await client.query(
      `SELECT append_ap_ledger_entry($1, $2, $3, 'PAYMENT_SETTLED'::ap_ledger_entry_type, -300.00, $4, 'manual-retry', 'duplicate call test', $5)`,
      [supplier.supplier_id, billId, paymentId, method.code, employee.employee_id]
    );
    const { rows: [dup] } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM ap_ledger WHERE payment_id = $1 AND entry_type = 'PAYMENT_SETTLED'`,
      [paymentId]
    );
    assert(dup.cnt === 1, `idempotency failed: expected 1 row after duplicate call, got ${dup.cnt}`);

    // 4) Bounce: pdc_status transitions away from CLEARED must automatically pull the
    //    bill's amount_paid back down too (the trigger's recompute excludes non-CLEARED
    //    payments from the SUM), matching apPdcService.js's manual reversal logic.
    await client.query(`UPDATE ap_payment SET pdc_status = 'BOUNCED' WHERE payment_id = $1`, [paymentId]);
    const { rows: [billAfterBounce] } = await client.query('SELECT amount_paid, status FROM supplier_bill WHERE bill_id = $1', [billId]);
    assert(Number(billAfterBounce.amount_paid) === 0, `bill.amount_paid expected 0 after bounce, got ${billAfterBounce.amount_paid}`);
    assert(billAfterBounce.status === 'Unpaid', `bill.status expected 'Unpaid' after bounce, got '${billAfterBounce.status}'`);

    console.log('apLedgerSafetyNet DB test passed');
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
