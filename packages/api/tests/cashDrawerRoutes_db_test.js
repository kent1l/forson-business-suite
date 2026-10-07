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
const { manilaDateString } = require('../helpers/manilaDate');
const router = require('../routes/cashDrawerRoutes');

const app = express();
app.use(express.json());
app.use('/api', router);

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
  const people = await request(app).get('/api/cash-drawers/custodians')
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(people.status, 200);
  assert(people.body.data.some(person => person.employee_id === actor.employee_id && person.name === 'Drawer Operator'));
  const date = manilaDateString();
  const opening = { business_date: date, custodian_id: actor.employee_id,
    opening_lines: [{ code: 'PHP_100', quantity: 1 }],
    opening_sources: [{ kind: 'FRESH_FLOAT', amount: '100.00' }] };
  const openingKey = idempotency();
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
  const closed = await request(app).post(`/api/cash-drawers/sessions/${sessionId}/close`).set(auth(actorToken))
    .send({ count_id: countId, expected_version: 3, approval_id: approval.body.data.approval_id,
      handovers: [{ amount: '50.00', destination: 'Safe', recipient_id: reviewer.employee_id,
        recipient_password: password, evidence: 'Signed handover' }] });
  assert.equal(closed.status, 201, JSON.stringify(closed.body));
  assert.equal(closed.body.data.retained_actual, '40.00');
  assert.equal(closed.body.data.retained_ledger, '50.00');
  const csv = await request(app).get(`/api/cash-drawers/sessions/${sessionId}/report?format=csv`)
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  const pdf = await request(app).get(`/api/cash-drawers/sessions/${sessionId}/report?format=pdf`)
    .set({ Authorization: `Bearer ${actorToken}` });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  const nextOpening = { business_date: date, custodian_id: actor.employee_id, prior_session_id: sessionId,
    opening_lines: [{ code: 'PHP_50', quantity: 1 }],
    opening_sources: [{ kind: 'PRIOR_RETAINED', amount: '40.00' }, { kind: 'FRESH_FLOAT', amount: '10.00' }] };
  const next = await request(app).post(`/api/cash-drawers/${drawerId}/sessions`).set(auth(actorToken)).send(nextOpening);
  assert.equal(next.status, 201, JSON.stringify(next.body));
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
    VALUES(CURRENT_DATE,$1,'5.00',$2,$3),(CURRENT_DATE,$1,'5.00',$4,$3) RETURNING expense_id`,
  [category.rows[0].category_id, cashMethod.rows[0].method_id, actor.employee_id, cardMethod.rows[0].method_id]);
  const reimbursementApproval = await approvedRelease('REIMBURSEMENT', '5.00', 1);
  const invalidReimbursement = await request(app).post(`/api/cash-drawers/advances/${advance.body.data.advance_id}/events`)
    .set(auth(actorToken)).send({ kind: 'REIMBURSEMENT', amount: '5.00', expense_id: expense.rows[1].expense_id,
      receiving_session_id: activeSessionId, approval_id: reimbursementApproval });
  assert.equal(invalidReimbursement.status, 422, JSON.stringify(invalidReimbursement.body));
  const reimbursement = await request(app).post(`/api/cash-drawers/advances/${advance.body.data.advance_id}/events`)
    .set(auth(actorToken)).send({ kind: 'REIMBURSEMENT', amount: '5.00', expense_id: expense.rows[0].expense_id,
      receiving_session_id: activeSessionId, approval_id: reimbursementApproval });
  assert.equal(reimbursement.status, 201, JSON.stringify(reimbursement.body));
  assert.equal(reimbursement.body.outstanding, '10.00', 'employee-paid expense must not inflate advance custody');
  const duplicateReimbursement = await request(app).post(`/api/cash-drawers/advances/${advance.body.data.advance_id}/events`)
    .set(auth(actorToken)).send({ kind: 'REIMBURSEMENT', amount: '5.00', expense_id: expense.rows[0].expense_id,
      receiving_session_id: activeSessionId, approval_id: reimbursementApproval });
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
  process.stdout.write('PASS cash drawer HTTP idempotency, review, close, custody, reimbursement and retained opening\n');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
