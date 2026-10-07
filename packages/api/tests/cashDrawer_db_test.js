// Run against a disposable schema-only database with the drawer migration:
// CASH_DRAWER_TEST_DB=codex_cash_drawer_verify_... node tests/cashDrawer_db_test.js
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
if (!/^codex_cash_drawer_verify_[a-z0-9_]+$/.test(process.env.CASH_DRAWER_TEST_DB || '')) {
  throw new Error('Set CASH_DRAWER_TEST_DB to a disposable codex_cash_drawer_verify_* database.');
}
process.env.DB_NAME = process.env.CASH_DRAWER_TEST_DB;
process.env.ENABLE_CASH_DRAWER = 'true';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const db = require('../db');
const cash = require('../services/cashDrawerService');

async function run() {
  for (const invalid of ['', '-1.00', '1.001', '1000000000000.00', 1.25]) {
    assert.throws(() => cash.cents(invalid, { positive: true }), error => error.code === 'INVALID_AMOUNT');
  }
  assert.equal(cash.countLines([{ code: 'PHP_1', quantity: 0 }]).total, '0.00');
  assert.throws(() => cash.countLines([{ code: 'PHP_1', quantity: 1.5 }]), error => error.code === 'INVALID_DENOMINATION');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const role = await client.query("INSERT INTO permission_level(level_name) VALUES('Drawer Test') RETURNING permission_level_id");
    const actor = await client.query(`INSERT INTO employee
      (first_name,last_name,permission_level_id,username,password_hash,password_salt)
      VALUES('Cash','Test',$1,$2,'test','test') RETURNING employee_id`,
    [role.rows[0].permission_level_id, `cash_test_${Date.now()}`]);
    const actorId = actor.rows[0].employee_id;
    const drawer = await client.query("SELECT drawer_id FROM cash_drawer WHERE code='MAIN_COUNTER'");
    const session = await client.query(`INSERT INTO cash_drawer_session
      (session_code,drawer_id,business_date,custodian_id,opening_amount,opened_by)
      VALUES($1,$2,CURRENT_DATE,$3,'100.00',$3) RETURNING *`,
    [`CASH-TEST-${Date.now()}`, drawer.rows[0].drawer_id, actorId]);
    const sessionId = session.rows[0].session_id;
    const receipt = await cash.postMovement(client, { sessionId, direction: 'IN', amount: '20.25', category: 'OTHER_RECEIPT', description: 'Test receipt', actorId, sourceEventKey: `test:${Date.now()}` });
    assert.equal(receipt.balance_after, '120.25');
    const release = await cash.postMovement(client, { sessionId, direction: 'OUT', amount: '30.00', category: 'OWNER_DRAW', description: 'Test release', actorId });
    assert.equal(release.balance_after, '90.25');
    const count = await cash.startCount(client, { sessionId, kind: 'MIDDAY', actorId, expectedVersion: release.version });
    assert.equal(count.expected, '90.25');
    await assert.rejects(() => cash.postMovement(client, { sessionId, direction: 'IN', amount: '1.00', category: 'OTHER_RECEIPT', description: 'Blocked during count', actorId }), error => error.code === 'COUNT_PAUSED');
    const submitted = await cash.submitCount(client, { countId: count.count_id, actorId,
      lines: [{ code: 'PHP_50', quantity: 1 }, { code: 'PHP_20', quantity: 2 }, { code: 'PHP_025', quantity: 1 }] });
    assert.equal(submitted.counted, '90.25');
    assert.equal(submitted.variance, '0.00');
    const later = await cash.postMovement(client, { sessionId, direction: 'IN', amount: '1.00', category: 'OTHER_RECEIPT', description: 'Later receipt', actorId });
    assert.equal(later.balance_after, '91.25');
    const expired = await cash.startCount(client, { sessionId, kind: 'MIDDAY', actorId, expectedVersion: later.version });
    await client.query("UPDATE cash_drawer_session SET count_window_expires_at=now()-interval '1 minute' WHERE session_id=$1", [sessionId]);
    await assert.rejects(() => cash.submitCount(client, { countId: expired.count_id, actorId,
      lines: [{ code: 'PHP_1', quantity: 1 }] }), error => error.code === 'COUNT_EXPIRED');
    const afterExpiry = await cash.postMovement(client, { sessionId, direction: 'IN', amount: '0.01',
      category: 'OTHER_RECEIPT', description: 'After count expiry', actorId });
    const restarted = await cash.startCount(client, { sessionId, kind: 'MIDDAY', actorId, expectedVersion: afterExpiry.version });
    assert.equal(restarted.expected, '91.26');
    const invalidated = await client.query('SELECT status FROM cash_count WHERE count_id=$1', [expired.count_id]);
    assert.equal(invalidated.rows[0].status, 'INVALIDATED');
    await client.query("UPDATE cash_count SET status='INVALIDATED',invalidated_at=now() WHERE count_id=$1", [restarted.count_id]);
    await client.query('UPDATE cash_drawer_session SET count_window_expires_at=NULL WHERE session_id=$1', [sessionId]);
    const customer = await client.query("INSERT INTO customer(first_name,last_name) VALUES('Drawer','Test') RETURNING customer_id");
    const cashMethod = await client.query("INSERT INTO payment_methods(code,name,type) VALUES($1,'Test Cash','cash') RETURNING method_id", [`test_cash_${Date.now()}`]);
    const cardMethod = await client.query("INSERT INTO payment_methods(code,name,type) VALUES($1,'Test Card','card') RETURNING method_id", [`test_card_${Date.now()}`]);
    const invoice = await client.query(`INSERT INTO invoice(invoice_number,customer_id,employee_id,total_amount)
      VALUES($1,$2,$3,'20.00') RETURNING invoice_id`, [`CASH-INV-${Date.now()}`, customer.rows[0].customer_id, actorId]);
    const cashPayment = await client.query(`INSERT INTO invoice_payments(invoice_id,method_id,amount_paid,payment_status,created_by)
      VALUES($1,$2,'10.00','settled',$3) RETURNING payment_id`, [invoice.rows[0].invoice_id, cashMethod.rows[0].method_id, actorId]);
    const cardPayment = await client.query(`INSERT INTO invoice_payments(invoice_id,method_id,amount_paid,payment_status,created_by)
      VALUES($1,$2,'10.00','settled',$3) RETURNING payment_id`, [invoice.rows[0].invoice_id, cardMethod.rows[0].method_id, actorId]);
    const postedCash = await cash.postSourcePayment(client, { kind: 'invoice', sourceId: cashPayment.rows[0].payment_id,
      sessionId, actorId, canPost: true });
    assert.equal(postedCash.amount, '10.00');
    assert.equal(postedCash.balance_after, '101.26');
    const card = await cash.postSourcePayment(client, { kind: 'invoice', sourceId: cardPayment.rows[0].payment_id,
      sessionId, actorId, canPost: true });
    assert.equal(card, null);
    const notebook = await cash.postMovement(client, { sessionId, direction: 'IN', amount: '5.00',
      category: 'NOTEBOOK_RECEIPT', description: 'Notebook page 1', actorId });
    const notebookInvoice = await client.query(`INSERT INTO invoice(invoice_number,customer_id,employee_id,total_amount)
      VALUES($1,$2,$3,'5.00') RETURNING invoice_id`, [`CASH-NOTE-${Date.now()}`, customer.rows[0].customer_id, actorId]);
    const notebookPayment = await client.query(`INSERT INTO invoice_payments(invoice_id,method_id,amount_paid,payment_status,created_by)
      VALUES($1,$2,'5.00','settled',$3) RETURNING payment_id`, [notebookInvoice.rows[0].invoice_id, cashMethod.rows[0].method_id, actorId]);
    const covered = await cash.postSourcePayment(client, { kind: 'invoice', sourceId: notebookPayment.rows[0].payment_id,
      sessionId, actorId, canPost: true, notebookReceiptId: notebook.movement_id, coveredAmount: '5.00' });
    assert.equal(covered, null);
    const coverage = await client.query('SELECT amount_covered FROM cash_source_link WHERE invoice_payment_id=$1', [notebookPayment.rows[0].payment_id]);
    assert.equal(coverage.rows[0].amount_covered, '5.00');
    const sharedNotebook = await cash.postMovement(client, { sessionId, direction: 'IN', amount: '5.00',
      category: 'NOTEBOOK_RECEIPT', description: 'Notebook page 2', actorId });
    for (const [index, paymentAmount, coveredAmount] of [[1, '2.00', '2.00'], [2, '4.00', '3.00']]) {
      const sale = await client.query(`INSERT INTO invoice(invoice_number,customer_id,employee_id,total_amount)
        VALUES($1,$2,$3,$4) RETURNING invoice_id`, [`CASH-SHARED-${Date.now()}-${index}`, customer.rows[0].customer_id, actorId, paymentAmount]);
      const payment = await client.query(`INSERT INTO invoice_payments(invoice_id,method_id,amount_paid,payment_status,created_by)
        VALUES($1,$2,$3,'settled',$4) RETURNING payment_id`,
      [sale.rows[0].invoice_id, cashMethod.rows[0].method_id, paymentAmount, actorId]);
      const extra = await cash.postSourcePayment(client, { kind: 'invoice', sourceId: payment.rows[0].payment_id,
        sessionId, actorId, canPost: true, notebookReceiptId: sharedNotebook.movement_id, coveredAmount });
      assert.equal(extra?.amount || null, index === 2 ? '1.00' : null);
    }
    const sharedCoverage = await client.query('SELECT SUM(amount_covered) AS covered,COUNT(*) AS sources FROM cash_source_link WHERE movement_id=$1', [sharedNotebook.movement_id]);
    assert.equal(sharedCoverage.rows[0].covered, '5.00');
    assert.equal(Number(sharedCoverage.rows[0].sources), 2);
    const original = await client.query('SELECT expected,counted,variance,cutoff_sequence FROM cash_count WHERE count_id=$1', [count.count_id]);
    assert.deepEqual(original.rows[0], { expected: '90.25', counted: '90.25', variance: '0.00', cutoff_sequence: '2' });
    await client.query('SAVEPOINT immutable_check');
    await assert.rejects(() => client.query("UPDATE cash_drawer_movement SET amount='999.00' WHERE movement_id=$1", [receipt.movement_id]));
    await client.query('ROLLBACK TO SAVEPOINT immutable_check');
    const requestKey = randomUUID();
    const request = { method: 'POST', path: '/invoices', body: { cash_session_id: sessionId, amount: '1.00' },
      user: { employee_id: actorId }, get: () => requestKey };
    const claim = await cash.beginSourceRequest(client, request);
    await cash.finishSourceRequest(client, claim, 201, { invoice_id: 42 });
    await assert.rejects(() => cash.beginSourceRequest(client, request), error =>
      error.replay?.status === 201 && error.replay.body.invoice_id === 42);
    await assert.rejects(() => cash.beginSourceRequest(client, { ...request, body: { cash_session_id: sessionId, amount: '2.00' } }),
      error => error.code === 'IDEMPOTENCY_CONFLICT');
    await client.query('ROLLBACK');
    process.stdout.write('PASS cash posting, noncash exclusion, notebook coverage, count cutoff/expiry, immutability\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
