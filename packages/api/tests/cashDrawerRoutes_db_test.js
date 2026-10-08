// End-to-end HTTP test on a disposable schema-only PostgreSQL database.
// DB_HOST=localhost CASH_DRAWER_TEST_DB=codex_cash_drawer_verify_... node tests/cashDrawerRoutes_db_test.js
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
if (!/^codex_cash_drawer_verify_[a-z0-9_]+$/.test(process.env.CASH_DRAWER_TEST_DB || '')) {
  throw new Error('Set CASH_DRAWER_TEST_DB to a disposable codex_cash_drawer_verify_* database.');
}
process.env.DB_NAME = process.env.CASH_DRAWER_TEST_DB;
process.env.ENABLE_CASH_DRAWER = 'true';

const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../db');
const cash = require('../services/cashDrawerService');
const { manilaDateString } = require('../helpers/manilaDate');
const router = require('../routes/cashDrawerRoutes');
const paymentRouter = require('../routes/paymentRoutes');

const app = express();
app.use(express.json());
app.use('/api', router);
app.use('/api', paymentRouter);

const idempotency = () => require('node:crypto').randomUUID();
const auth = token => ({ Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotency() });

async function run() {
  const role = await db.query("INSERT INTO permission_level(permission_level_id,level_name) VALUES(10,'Admin') ON CONFLICT(permission_level_id) DO UPDATE SET level_name=excluded.level_name RETURNING permission_level_id");
  assert.equal(role.rows[0].permission_level_id, 10);
  const password = 'drawer-test-recipient';
  const hash = await bcrypt.hash(password, 10);
  const employee = await db.query(`INSERT INTO employee
    (first_name,last_name,permission_level_id,username,password_hash,password_salt)
    VALUES('Drawer','Operator',10,$1,$2,'test'),('Drawer','Reviewer',10,$3,$2,'test')
    RETURNING employee_id,username`, [`cash_route_actor_${Date.now()}`, hash, `cash_route_reviewer_${Date.now()}`]);
  const [actor, reviewer] = employee.rows;
  const actorToken = jwt.sign({ employee_id: actor.employee_id, username: actor.username, login_date: manilaDateString() }, process.env.JWT_SECRET);
  const reviewerToken = jwt.sign({ employee_id: reviewer.employee_id, username: reviewer.username, login_date: manilaDateString() }, process.env.JWT_SECRET);
  const drawer = await db.query("INSERT INTO cash_drawer(code,name) VALUES($1,'HTTP Test Drawer') RETURNING drawer_id,hardware_mode", [`HTTP_TEST_${Date.now()}`]);
  assert.equal(drawer.rows[0].hardware_mode, 'MANUAL_CASH_BOX');
  const drawerId = drawer.rows[0].drawer_id;
  const raceDrawer = await db.query("INSERT INTO cash_drawer(code,name) VALUES($1,'Concurrent Open Test') RETURNING drawer_id", [`RACE_TEST_${Date.now()}`]);
  const people = await request(app).get('/api/cash-drawers/custodians')
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(people.status, 200);
  assert(people.body.data.some(person => person.employee_id === actor.employee_id && person.name === 'Drawer Operator'));
  const recipients = await request(app).get('/api/cash-drawers/employees')
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(recipients.status, 200);
  assert(recipients.body.data.some(person => person.employee_id === reviewer.employee_id && person.name === 'Drawer Reviewer'));
  const date = manilaDateString();
  const opening = { business_date: date, custodian_id: actor.employee_id,
    opening_lines: [{ code: 'PHP_100', quantity: 1 }],
    opening_sources: [{ kind: 'FRESH_FLOAT', amount: '100.00' }] };
  const openingKey = idempotency();
  const concurrentOpen = await Promise.all([request(app).post(`/api/cash-drawers/${raceDrawer.rows[0].drawer_id}/sessions`)
    .set(auth(actorToken)).send(opening), request(app).post(`/api/cash-drawers/${raceDrawer.rows[0].drawer_id}/sessions`)
    .set(auth(actorToken)).send(opening)]);
  assert.deepEqual(concurrentOpen.map(result => result.status).sort(), [201, 409]);
  const opened = await request(app).post(`/api/cash-drawers/${drawerId}/sessions`)
    .set({ Authorization: `Bearer ${actorToken}`, 'Idempotency-Key': openingKey }).send(opening);
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const openedDetail = await request(app).get(`/api/cash-drawers/sessions/${opened.body.data.session_id}`)
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(openedDetail.status, 200);
  assert.equal(openedDetail.body.data.custodian_name, 'Drawer Operator');
  const replay = await request(app).post(`/api/cash-drawers/${drawerId}/sessions`)
    .set({ Authorization: `Bearer ${actorToken}`, 'Idempotency-Key': openingKey }).send(opening);
  assert.equal(replay.status, 201);
  assert.equal(replay.body.data.session_id, opened.body.data.session_id);
  const conflict = await request(app).post(`/api/cash-drawers/${drawerId}/sessions`)
    .set({ Authorization: `Bearer ${actorToken}`, 'Idempotency-Key': openingKey }).send({ ...opening, reason: 'different' });
  assert.equal(conflict.status, 409);
  const sessionId = opened.body.data.session_id;
  const closing = await request(app).post(`/api/cash-drawers/sessions/${sessionId}/start-closing`)
    .set(auth(actorToken)).send({ expected_version: 0 });
  assert.equal(closing.status, 200, JSON.stringify(closing.body));
  const started = await request(app).post(`/api/cash-drawers/sessions/${sessionId}/counts/start`)
    .set(auth(actorToken)).send({ kind: 'CLOSING', expected_version: 1 });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const countId = started.body.data.count_id;
  const count = await request(app).post(`/api/cash-drawers/counts/${countId}/submit`)
    .set(auth(actorToken)).send({ lines: [{ code: 'PHP_50', quantity: 1 }, { code: 'PHP_20', quantity: 2 }] });
  assert.equal(count.status, 201, JSON.stringify(count.body));
  assert.equal(count.body.data.variance, '-10.00');
  const approval = await request(app).post('/api/cash-drawers/approvals').set(auth(actorToken))
    .send({ session_id: sessionId, count_id: countId, expected_version: 3, reason: 'Physical recount confirmed short cash' });
  assert.equal(approval.status, 201, JSON.stringify(approval.body));
  const decision = await request(app).post(`/api/cash-drawers/approvals/${approval.body.data.approval_id}/decision`)
    .set(auth(reviewerToken)).send({ decision: 'APPROVED' });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));
  const closeAck = await request(app).post(`/api/cash-drawers/sessions/${sessionId}/handover-ack`)
    .set({ Authorization: `Bearer ${actorToken}` }).send({ count_id: started.body.data.count_id,
      expected_version: 3, amount: '50.00', destination: 'Safe', recipient_id: reviewer.employee_id,
      recipient_password: password });
  assert.equal(closeAck.status, 200, JSON.stringify(closeAck.body));
  const closeKey = idempotency();
  const closeBody = { count_id: countId, expected_version: 3, approval_id: approval.body.data.approval_id,
      handovers: [{ amount: '50.00', destination: 'Safe', recipient_id: reviewer.employee_id,
        ack_token: closeAck.body.data.token, evidence: 'Signed handover' }] };
  const closed = await request(app).post(`/api/cash-drawers/sessions/${sessionId}/close`)
    .set({ Authorization: `Bearer ${actorToken}`, 'Idempotency-Key': closeKey }).send(closeBody);
  assert.equal(closed.status, 201, JSON.stringify(closed.body));
  const replayClose = await request(app).post(`/api/cash-drawers/sessions/${sessionId}/close`)
    .set({ Authorization: `Bearer ${actorToken}`, 'Idempotency-Key': closeKey }).send(closeBody);
  assert.equal(replayClose.status, 201);
  assert.equal(replayClose.body.data.session_id, sessionId);
  const closeResult = await request(app).get(`/api/cash-drawers/requests/${closeKey}`)
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(closeResult.status, 200);
  assert.equal(closeResult.body.data.status_code, 201);
  const deniedResult = await request(app).get(`/api/cash-drawers/requests/${closeKey}`)
    .set({ Authorization: `Bearer ${reviewerToken}` });
  assert.equal(deniedResult.status, 404);
  assert.equal(closed.body.data.retained_actual, '40.00');
  assert.equal(closed.body.data.retained_ledger, '50.00');
  const originalSnapshot = closed.body.data.report_snapshot;
  const finalTransfer = await db.query('SELECT transfer_id FROM cash_transfer WHERE session_id=$1', [sessionId]);
  const laterDeposit = await request(app).post(`/api/cash-drawers/transfers/${finalTransfer.rows[0].transfer_id}/events`)
    .set(auth(actorToken)).send({ stage: 'DEPOSITED', amount: '50.00', evidence: 'Bank slip after close' });
  assert.equal(laterDeposit.status, 201, JSON.stringify(laterDeposit.body));
  const stillClosed = await db.query('SELECT report_snapshot FROM cash_session_close WHERE session_id=$1', [sessionId]);
  assert.deepEqual(stillClosed.rows[0].report_snapshot, originalSnapshot, 'later custody cannot change the closing snapshot');
  const activity = await request(app).get(`/api/cash-drawers/sessions/${sessionId}/activity`)
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(activity.status, 200, JSON.stringify(activity.body));
  assert(activity.body.data.some(item => item.action === 'CLOSE'));
  assert(activity.body.data.some(item => item.action === 'DEPOSITED'));
  const csv = await request(app).get(`/api/cash-drawers/sessions/${sessionId}/report?format=csv`)
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Generated at/);
  const pdf = await request(app).get(`/api/cash-drawers/sessions/${sessionId}/report?format=pdf`)
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  const nextOpening = { business_date: date, custodian_id: actor.employee_id, prior_session_id: sessionId,
    opening_lines: [{ code: 'PHP_50', quantity: 1 }],
    opening_sources: [{ kind: 'PRIOR_RETAINED', amount: '40.00' }, { kind: 'FRESH_FLOAT', amount: '10.00' }] };
  const next = await request(app).post(`/api/cash-drawers/${drawerId}/sessions`).set(auth(actorToken)).send(nextOpening);
  assert.equal(next.status, 201, JSON.stringify(next.body));
  const doubleOpen = await request(app).post(`/api/cash-drawers/${drawerId}/sessions`).set(auth(actorToken)).send(nextOpening);
  assert.equal(doubleOpen.status, 409, JSON.stringify(doubleOpen.body));
  const activeSessionId = next.body.data.session_id;
  const approvedRelease = async (action, amount, version) => {
    const asked = await request(app).post('/api/cash-drawers/approvals').set(auth(actorToken))
      .send({ session_id: activeSessionId, action, amount, expected_version: version, reason: 'Verified cash box release' });
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    const reviewed = await request(app).post(`/api/cash-drawers/approvals/${asked.body.data.approval_id}/decision`)
      .set(auth(reviewerToken)).send({ decision: 'APPROVED' });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    return asked.body.data.approval_id;
  };
  const advanceApproval = await approvedRelease('ADVANCE', '10.00', 0);
  const advance = await request(app).post(`/api/cash-drawers/sessions/${activeSessionId}/advances`)
    .set(auth(actorToken)).send({ employee_id: reviewer.employee_id, purpose: 'Office supplies', amount: '10.00',
      expected_version: 0, approval_id: advanceApproval });
  assert.equal(advance.status, 201, JSON.stringify(advance.body));
  const category = await db.query('INSERT INTO expense_category(category_name) VALUES($1) RETURNING category_id', [`Drawer reimbursement ${Date.now()}`]);
  const cashMethod = await db.query("INSERT INTO payment_methods(code,name,type) VALUES($1,'Drawer test cash','cash') RETURNING method_id", [`drawer_cash_${Date.now()}`]);
  const cardMethod = await db.query("INSERT INTO payment_methods(code,name,type) VALUES($1,'Drawer test card','card') RETURNING method_id", [`drawer_card_${Date.now()}`]);
  const expense = await db.query(`INSERT INTO expense(expense_date,category_id,amount,payment_method_id,created_by)
    VALUES(CURRENT_DATE,$1,'5.00',$2,$3),(CURRENT_DATE,$1,'5.00',$4,$3),
      (CURRENT_DATE,$1,'5.00',$2,$3) RETURNING expense_id`,
  [category.rows[0].category_id, cashMethod.rows[0].method_id, actor.employee_id, cardMethod.rows[0].method_id]);
  const unrelatedEdit = await db.query("UPDATE expense SET amount='6.00' WHERE expense_id=$1 RETURNING amount", [expense.rows[1].expense_id]);
  assert.equal(unrelatedEdit.rows[0].amount, '6.00', 'unlinked expenses must remain editable');
  const reimbursementApproval = await approvedRelease('REIMBURSEMENT', '5.00', 1);
  const invalidReimbursement = await request(app).post(`/api/cash-drawers/advances/${advance.body.data.advance_id}/events`)
    .set(auth(actorToken)).send({ kind: 'REIMBURSEMENT', amount: '5.00', expense_id: expense.rows[1].expense_id,
      receiving_session_id: activeSessionId, approval_id: reimbursementApproval,
      payer_employee_id: reviewer.employee_id, payer_evidence: 'Signed employee cash receipt' });
  assert.equal(invalidReimbursement.status, 422, JSON.stringify(invalidReimbursement.body));
  const reimbursement = await request(app).post(`/api/cash-drawers/advances/${advance.body.data.advance_id}/events`)
    .set(auth(actorToken)).send({ kind: 'REIMBURSEMENT', amount: '5.00', expense_id: expense.rows[0].expense_id,
      receiving_session_id: activeSessionId, approval_id: reimbursementApproval,
      payer_employee_id: reviewer.employee_id, payer_evidence: 'Signed employee cash receipt' });
  assert.equal(reimbursement.status, 201, JSON.stringify(reimbursement.body));
  assert.equal(reimbursement.body.outstanding, '10.00', 'employee-paid expense must not inflate advance custody');
  await assert.rejects(() => db.query("UPDATE expense SET amount='6.00' WHERE expense_id=$1", [expense.rows[0].expense_id]),
    error => error.code === '23514');
  const consumption = await request(app).post(`/api/cash-drawers/advances/${advance.body.data.advance_id}/events`)
    .set(auth(actorToken)).send({ kind: 'CONSUMPTION', amount: '5.00', expense_id: expense.rows[2].expense_id });
  assert.equal(consumption.status, 201, JSON.stringify(consumption.body));
  await assert.rejects(() => db.query("UPDATE expense SET is_void=true WHERE expense_id=$1", [expense.rows[2].expense_id]),
    error => error.code === '23514');
  const duplicateReimbursement = await request(app).post(`/api/cash-drawers/advances/${advance.body.data.advance_id}/events`)
    .set(auth(actorToken)).send({ kind: 'REIMBURSEMENT', amount: '5.00', expense_id: expense.rows[0].expense_id,
      receiving_session_id: activeSessionId, approval_id: reimbursementApproval,
      payer_employee_id: reviewer.employee_id, payer_evidence: 'Signed employee cash receipt' });
  assert.equal(duplicateReimbursement.status, 409, JSON.stringify(duplicateReimbursement.body));
  const transferApproval = await approvedRelease('TRANSFER', '10.00', 2);
  const transfer = await request(app).post(`/api/cash-drawers/sessions/${activeSessionId}/transfers`)
    .set(auth(actorToken)).send({ amount: '10.00', destination: 'Store safe', recipient_id: reviewer.employee_id,
      expected_version: 2, approval_id: transferApproval });
  assert.equal(transfer.status, 201, JSON.stringify(transfer.body));
  const event = (token, stage, amount, extra = {}) => request(app)
    .post(`/api/cash-drawers/transfers/${transfer.body.data.transfer_id}/events`).set(auth(token))
    .send({ stage, amount, evidence: 'Signed test receipt', ...extra });
  const acknowledged = await event(reviewerToken, 'ACKNOWLEDGED', '10.00');
  assert.equal(acknowledged.status, 201, JSON.stringify(acknowledged.body));
  const returned = await event(actorToken, 'RETURNED', '4.00', { receiving_session_id: activeSessionId });
  assert.equal(returned.status, 201, JSON.stringify(returned.body));
  const deposited = await event(actorToken, 'DEPOSITED', '6.00');
  assert.equal(deposited.status, 201, JSON.stringify(deposited.body));
  const overDeposited = await event(actorToken, 'DEPOSITED', '0.01');
  assert.equal(overDeposited.status, 422, JSON.stringify(overDeposited.body));
  const overReturned = await event(actorToken, 'RETURNED', '0.01', { receiving_session_id: activeSessionId });
  assert.equal(overReturned.status, 422, JSON.stringify(overReturned.body));
  const register = await request(app).get(`/api/cash-drawers/sessions/${next.body.data.session_id}/movements`)
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(register.body.data.length, 4, 'opening float must not appear as a receipt movement');
  assert.deepEqual(register.body.data.map(row => Number(row.sequence)), [1, 2, 3, 4], 'register follows posting sequence');
  const current = await request(app).get(`/api/cash-drawers/sessions/${activeSessionId}`)
    .set({ Authorization: `Bearer ${actorToken}` });
  const notebookBody = { direction: 'IN', category: 'NOTEBOOK_RECEIPT', amount: '1.00',
    description: 'Notebook sale awaiting encoding', expected_version: current.body.data.version };
  const missingReference = await request(app).post(`/api/cash-drawers/sessions/${activeSessionId}/movements`)
    .set(auth(actorToken)).send(notebookBody);
  assert.equal(missingReference.status, 422);
  const physicalReference = `Notebook page ${Date.now()}`;
  const notebookReceipt = await request(app).post(`/api/cash-drawers/sessions/${activeSessionId}/movements`)
    .set(auth(actorToken)).send({ ...notebookBody, physical_reference: physicalReference });
  assert.equal(notebookReceipt.status, 201, JSON.stringify(notebookReceipt.body));
  for (const movementId of [returned.body.movement.movement_id, reimbursement.body.movement.movement_id]) {
    const correction = await request(app).post(`/api/cash-drawers/movements/${movementId}/reverse`)
      .set(auth(actorToken)).send({ reason: 'Safety regression: custody linked movement', expected_version: notebookReceipt.body.data.version });
    assert.equal(correction.status, 422, JSON.stringify(correction.body));
    assert.equal(correction.body.code, 'CUSTODY_CORRECTION_REQUIRED');
  }
  assert.equal(notebookReceipt.body.data.physical_reference, physicalReference);
  const notebookOptions = await request(app).get('/api/cash-drawers/notebook-receipts')
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(notebookOptions.status, 200, JSON.stringify(notebookOptions.body));
  assert(notebookOptions.body.data.some(row => row.movement_id === notebookReceipt.body.data.movement_id &&
    row.physical_reference === physicalReference && Number(row.available_amount) === 1));
  const found = await request(app).get(`/api/cash-drawers/sessions/${activeSessionId}/movements`)
    .query({ search: physicalReference, direction: 'IN', source: 'MANUAL', operator: actor.employee_id })
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.deepEqual(found.body.data.map(row => row.movement_id), [notebookReceipt.body.data.movement_id]);
  const historyPrefix = `HIST-${idempotency()}`;
  await db.query(`INSERT INTO cash_drawer_session(session_code,drawer_id,business_date,custodian_id,opening_amount,opened_by,status)
    SELECT $1||'-'||g,$2,$3,$4,'0.00',$4,'CLOSED' FROM generate_series(1,51) g`,
  [historyPrefix, drawerId, date, actor.employee_id]);
  const historyPage = await request(app).get('/api/cash-drawers/sessions')
    .query({ drawer_id: drawerId, from: date, to: date, status: 'CLOSED', custodian_id: actor.employee_id, page: 3, limit: 25 })
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(historyPage.status, 200, JSON.stringify(historyPage.body));
  assert(historyPage.body.total > 50 && historyPage.body.data.length > 0, 'history must reach sessions beyond page two');
  const raceCustomer = await db.query("INSERT INTO customer(first_name,last_name) VALUES('Race','Coverage') RETURNING customer_id");
  const paymentFor = async () => {
    const invoice = await db.query(`INSERT INTO invoice(invoice_number,customer_id,employee_id,total_amount)
      VALUES($1,$2,$3,'1.00') RETURNING invoice_id`,
    [`RACE-COVER-${idempotency()}`, raceCustomer.rows[0].customer_id, actor.employee_id]);
    const payment = await db.query(`INSERT INTO invoice_payments(invoice_id,method_id,amount_paid,payment_status,created_by)
      VALUES($1,$2,'1.00','settled',$3) RETURNING payment_id`,
    [invoice.rows[0].invoice_id, cashMethod.rows[0].method_id, actor.employee_id]);
    return payment.rows[0].payment_id;
  };
  const coveredPaymentId = await paymentFor();
  const coverageClient = await db.getClient();
  await coverageClient.query('BEGIN');
  try {
    const fullyCovered = await cash.postSourcePayment(coverageClient, { kind: 'invoice', sourceId: coveredPaymentId,
      actorId: actor.employee_id, canPost: true, notebookReceiptId: notebookReceipt.body.data.movement_id,
      coveredAmount: '1.00' });
    assert.equal(fullyCovered, null, 'full coverage posts no new drawer movement without a session id');
    const competingReverse = request(app).post(`/api/cash-drawers/movements/${notebookReceipt.body.data.movement_id}/reverse`)
      .set(auth(actorToken)).send({ reason: 'Concurrent correction check', expected_version: notebookReceipt.body.data.version });
    const reverseResult = competingReverse.then(response => response);
    await new Promise(resolve => setTimeout(resolve, 30));
    await coverageClient.query('COMMIT');
    const deniedReverse = await reverseResult;
    assert.equal(deniedReverse.status, 422, JSON.stringify(deniedReverse.body));
    assert.equal(deniedReverse.body.code, 'NOTEBOOK_COVERED');
  } catch (error) { await coverageClient.query('ROLLBACK'); throw error; }
  finally { coverageClient.release(); }
  const afterCoverage = await request(app).get(`/api/cash-drawers/sessions/${activeSessionId}`)
    .set({ Authorization: `Bearer ${actorToken}` });
  const reverseFirst = await request(app).post(`/api/cash-drawers/sessions/${activeSessionId}/movements`)
    .set(auth(actorToken)).send({ ...notebookBody, expected_version: afterCoverage.body.data.version,
      physical_reference: `Reverse first ${Date.now()}` });
  assert.equal(reverseFirst.status, 201, JSON.stringify(reverseFirst.body));
  const reversed = await request(app).post(`/api/cash-drawers/movements/${reverseFirst.body.data.movement_id}/reverse`)
    .set(auth(actorToken)).send({ reason: 'Cancel before source coverage', expected_version: reverseFirst.body.data.version });
  assert.equal(reversed.status, 201, JSON.stringify(reversed.body));
  const latePaymentId = await paymentFor();
  const lateClient = await db.getClient();
  await lateClient.query('BEGIN');
  try {
    await assert.rejects(() => cash.postSourcePayment(lateClient, { kind: 'invoice', sourceId: latePaymentId,
      actorId: actor.employee_id, canPost: true, notebookReceiptId: reverseFirst.body.data.movement_id,
      coveredAmount: '1.00' }), error => error.code === 'NOTEBOOK_REVERSED');
    await lateClient.query('ROLLBACK');
  } finally { lateClient.release(); }

  const beforeFullyCovered = await request(app).get(`/api/cash-drawers/sessions/${activeSessionId}`)
    .set({ Authorization: `Bearer ${actorToken}` });
  const freshNotebook = await request(app).post(`/api/cash-drawers/sessions/${activeSessionId}/movements`)
    .set(auth(actorToken)).send({ ...notebookBody, expected_version: beforeFullyCovered.body.data.version,
      physical_reference: `Fully covered retry ${Date.now()}` });
  assert.equal(freshNotebook.status, 201, JSON.stringify(freshNotebook.body));
  const sourceInvoice = await db.query(`INSERT INTO invoice(invoice_number,customer_id,employee_id,total_amount)
    VALUES($1,$2,$3,'1.00') RETURNING invoice_id`,
  [`FULL-COVER-${idempotency()}`, raceCustomer.rows[0].customer_id, actor.employee_id]);
  const coveredBody = { customer_id: raceCustomer.rows[0].customer_id, amount: '1.00',
    method_id: cashMethod.rows[0].method_id, allocations: [{ invoice_id: sourceInvoice.rows[0].invoice_id, amount_allocated: '1.00' }],
    notebook_receipt_id: freshNotebook.body.data.movement_id, notebook_covered_amount: '1.00' };
  const paymentKey = idempotency();
  const sourcePayment = await request(app).post('/api/payments')
    .set({ Authorization: `Bearer ${actorToken}`, 'Idempotency-Key': paymentKey }).send(coveredBody);
  assert.equal(sourcePayment.status, 201, JSON.stringify(sourcePayment.body));
  const samePayment = await request(app).post('/api/payments')
    .set({ Authorization: `Bearer ${actorToken}`, 'Idempotency-Key': paymentKey }).send(coveredBody);
  assert.equal(samePayment.status, 201, JSON.stringify(samePayment.body));
  const sourceCount = await db.query('SELECT COUNT(*)::int AS count FROM cash_source_link WHERE movement_id=$1', [freshNotebook.body.data.movement_id]);
  assert.equal(sourceCount.rows[0].count, 1, 'fully covered source retry must not create another receipt');

  process.stdout.write('PASS cash drawer HTTP idempotency, review, close, custody, reimbursement and retained opening\n');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
