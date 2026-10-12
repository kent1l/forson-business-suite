// Run against a schema-only disposable DB: CASH_DRAWER_TEST_DB=codex_cash_drawer_verify_* node tests/refundCashDrawer_db_test.js
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
if (!/^codex_cash_drawer_verify_[a-z0-9_]+$/.test(process.env.CASH_DRAWER_TEST_DB || '')) {
  throw new Error('Select a disposable CASH_DRAWER_TEST_DB.');
}
process.env.DB_NAME = process.env.CASH_DRAWER_TEST_DB;
process.env.ENABLE_CASH_DRAWER = 'true';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { manilaDateString } = require('../helpers/manilaDate');
const app = express();
app.use(express.json());
app.use('/api', require('../routes/refundRoutes'));
app.use('/api', require('../routes/exchangeRoutes'));
app.use('/api', require('../routes/cashDrawerRoutes'));
app.use('/api', require('../routes/paymentRoutes'));

async function run() {
  await db.query("INSERT INTO permission_level(permission_level_id,level_name) VALUES(10,'Admin') ON CONFLICT DO NOTHING");
  const { rows: [actor] } = await db.query(`INSERT INTO employee(first_name,last_name,permission_level_id,username,password_hash,password_salt)
    VALUES('Refund','Tester',10,$1,'unused','unused') RETURNING employee_id,username`, [`refund_${Date.now()}`]);
  const token = jwt.sign({ employee_id: actor.employee_id, username: actor.username, login_date: manilaDateString() }, process.env.JWT_SECRET);
  const headers = key => ({ Authorization: `Bearer ${token}`, 'Idempotency-Key': key || randomUUID() });
  const { rows: [brand] } = await db.query("INSERT INTO brand(brand_name,brand_code) VALUES($1,$2) RETURNING brand_id", [`Refund test ${Date.now()}`, randomUUID().slice(0, 8)]);
  const { rows: [group] } = await db.query(`INSERT INTO "group"(group_name,group_code) VALUES($1,$2) RETURNING group_id`, [`Refund test ${Date.now()}`, randomUUID().slice(0, 8)]);
  const { rows: [tax] } = await db.query("INSERT INTO tax_rate(rate_name,rate_percentage) VALUES($1,0) RETURNING tax_rate_id", [`Test zero ${Date.now()}`]);
  const { rows: [customer] } = await db.query("INSERT INTO customer(first_name,last_name) VALUES('Refund','Fixture') RETURNING customer_id");
  const { rows: [part] } = await db.query(`INSERT INTO part(internal_sku,detail,brand_id,group_id,is_active,wac_cost,last_sale_price,tax_rate_id)
    VALUES($1,'Refund fixture',$2,$3,true,50,100,$4) RETURNING part_id`, [`REFUND-${Date.now()}`, brand.brand_id, group.group_id, tax.tax_rate_id]);
  await db.query(`INSERT INTO payment_methods(code,name,type,config) VALUES
    ('cash','Cash','cash','{"settlement_type":"instant"}'),
    ('exchange_credit','Exchange Credit','voucher','{"settlement_type":"instant"}'),
    ('store_wallet','Store Credit','credit','{"settlement_type":"instant"}') ON CONFLICT(code) DO NOTHING`);
  const { rows: [drawer] } = await db.query("INSERT INTO cash_drawer(code,name) VALUES($1,'Refund Drawer') RETURNING drawer_id", [`REFUND-${Date.now()}`]);
  const { rows: [session] } = await db.query(`INSERT INTO cash_drawer_session(session_code,drawer_id,business_date,custodian_id,opening_amount,opened_by)
    VALUES($1,$2,CURRENT_DATE,$3,1000,$3) RETURNING session_id`, [`REFUND-${Date.now()}`, drawer.drawer_id, actor.employee_id]);
  const dates = { startDate: manilaDateString(), endDate: manilaDateString() };
  const cashRefunds = async () => {
    const result = await request(app).get('/api/payments/refunds-approx').set(headers()).query(dates);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return Number(result.body.total_refunds);
  };
  const initialRefunds = await cashRefunds();
  let number = 0;
  const original = async () => {
    const { rows: [inv] } = await db.query(`INSERT INTO invoice(invoice_number,customer_id,employee_id,total_amount,subtotal_ex_tax,tax_total,amount_paid,status,terms,payment_terms_days,tax_calculation_version)
      VALUES($1,$2,$3,200,200,0,200,'Paid','Cash',0,'v1.0') RETURNING invoice_id`, [`REFUND-${Date.now()}-${++number}`, customer.customer_id, actor.employee_id]);
    const { rows: [line] } = await db.query(`INSERT INTO invoice_line(invoice_id,part_id,quantity,sale_price,cost_at_sale,discount_amount,tax_rate_id,tax_rate_snapshot,tax_base,tax_amount,is_tax_inclusive)
      VALUES($1,$2,2,100,50,0,$3,0,200,0,false) RETURNING invoice_line_id`, [inv.invoice_id, part.part_id, tax.tax_rate_id]);
    return { inv, line };
  };
  const detail = async expected => {
    const response = await request(app).get(`/api/cash-drawers/sessions/${session.session_id}`).set(headers());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.expected, expected);
  };
  const refundPayload = ({ inv, line }, method = 'Cash') => ({ invoice_id: inv.invoice_id, refund_payment_method: method,
    cash_session_id: session.session_id, lines: [{ invoice_line_id: line.invoice_line_id, quantity: 1 }] });
  const exchangePayload = ({ inv, line }, disposition = 'cash_payout') => ({ original_invoice_id: inv.invoice_id,
    employee_id: actor.employee_id, returned_lines: [{ invoice_line_id: line.invoice_line_id, quantity: 1 }],
    replacement_lines: [{ part_id: part.part_id, quantity: 1, sale_price: 60, discount_amount: 0 }],
    terms: '0', payment_terms_days: 0, downgrade_disposition: disposition, cash_session_id: session.session_id });
  for (const [path, payload, expected] of [
    ['/refunds', refundPayload(await original()), '900.00'],
    ['/invoices/exchange', exchangePayload(await original()), '860.00'],
  ]) {
    const key = randomUUID();
    const saved = await request(app).post(`/api${path}`).set(headers(key)).send(payload);
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    await detail(expected);
    const replay = await request(app).post(`/api${path}`).set(headers(key)).send(payload);
    assert.equal(replay.status, 201, JSON.stringify(replay.body));
    assert.deepEqual(replay.body, saved.body);
    await detail(expected);
  }
  const movements = await db.query("SELECT direction,amount FROM cash_drawer_movement WHERE session_id=$1 ORDER BY sequence", [session.session_id]);
  assert.deepEqual(movements.rows, [{ direction: 'OUT', amount: '100.00' }, { direction: 'OUT', amount: '40.00' }]);
  const disbursements = await db.query('SELECT r.amount FROM refund_disbursement r JOIN cash_drawer_movement m USING(movement_id) WHERE m.session_id=$1', [session.session_id]);
  assert.equal(disbursements.rowCount, 2);
  for (const [path, factory] of [['/refunds', refundPayload], ['/invoices/exchange', exchangePayload]]) {
    const payload = factory(await original());
    delete payload.cash_session_id;
    const rejected = await request(app).post(`/api${path}`).set(headers()).send(payload);
    assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'DRAWER_SESSION_REQUIRED');
    const notes = await db.query('SELECT 1 FROM credit_note WHERE invoice_id=$1', [payload.invoice_id || payload.original_invoice_id]);
    assert.equal(notes.rowCount, 0, 'failed cash payout rolls back the credit note');
  }
  const nonCash = await request(app).post('/api/refunds').set(headers()).send(refundPayload(await original(), 'GCash'));
  assert.equal(nonCash.status, 201, JSON.stringify(nonCash.body));
  const wallet = await request(app).post('/api/invoices/exchange').set(headers()).send(exchangePayload(await original(), 'wallet'));
  assert.equal(wallet.status, 201, JSON.stringify(wallet.body));
  await detail('860.00');
  for (const [path, factory] of [['/refunds', refundPayload], ['/invoices/exchange', exchangePayload]]) {
    const payload = factory(await original());
    process.env.ENABLE_CASH_DRAWER = 'false';
    const disabled = await request(app).post(`/api${path}`).set(headers()).send(payload);
    assert.equal(disabled.status, 503, JSON.stringify(disabled.body));
    assert.equal(disabled.body.code, 'CASH_DRAWER_DISABLED');
    const notes = await db.query('SELECT 1 FROM credit_note WHERE invoice_id=$1', [payload.invoice_id || payload.original_invoice_id]);
    assert.equal(notes.rowCount, 0);
    process.env.ENABLE_CASH_DRAWER = 'true';
  }
  assert.equal(await cashRefunds(), initialRefunds + 140, 'Sales History includes full refund plus exchange difference');
  process.env.ENABLE_CASH_DRAWER = 'false';
  for (const [path, factory] of [['/refunds', refundPayload], ['/invoices/exchange', exchangePayload]]) {
    const payload = factory(await original());
    delete payload.cash_session_id;
    const saved = await request(app).post(`/api${path}`).set(headers()).send(payload);
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
  }
  assert.equal(await cashRefunds(), initialRefunds + 280, 'Sales History includes payouts with Cash Box disabled');
  const onAccountPayload = exchangePayload(await original());
  delete onAccountPayload.cash_session_id;
  onAccountPayload.terms = '30';
  onAccountPayload.payment_terms_days = 30;
  const onAccount = await request(app).post('/api/invoices/exchange').set(headers()).send(onAccountPayload);
  assert.equal(onAccount.status, 201, JSON.stringify(onAccount.body));
  const onAccountNote = await db.query('SELECT refund_payment_method FROM credit_note WHERE invoice_id=$1', [onAccountPayload.original_invoice_id]);
  assert.equal(onAccountNote.rows[0].refund_payment_method, 'Applied to Account');
  assert.equal(await cashRefunds(), initialRefunds + 280, 'Account exchange never counts as cash out');
  const outside = await request(app).get('/api/payments/refunds-approx').set(headers()).query({ startDate: '1900-01-01', endDate: '1900-01-01' });
  assert.equal(Number(outside.body.total_refunds), 0, 'payouts are filtered by refund date');
  process.env.ENABLE_CASH_DRAWER = 'true';
  for (const state of ['CLOSING', 'COUNT_PAUSED']) {
    await db.query("UPDATE cash_drawer_session SET status=$2,count_window_expires_at=$3 WHERE session_id=$1",
      [session.session_id, state === 'CLOSING' ? 'CLOSING' : 'OPEN', state === 'COUNT_PAUSED' ? new Date(Date.now() + 60000) : null]);
    for (const [path, factory] of [['/refunds', refundPayload], ['/invoices/exchange', exchangePayload]]) {
      const payload = factory(await original());
      const rejected = await request(app).post(`/api${path}`).set(headers()).send(payload);
      assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
      assert.equal(rejected.body.code, state === 'CLOSING' ? 'SESSION_STATE' : 'COUNT_PAUSED');
      const notes = await db.query('SELECT 1 FROM credit_note WHERE invoice_id=$1', [payload.invoice_id || payload.original_invoice_id]);
      assert.equal(notes.rowCount, 0);
    }
  }
  await detail('860.00');
  console.log('PASS: refund/exchange cash payout balances, replay, rollback, noncash isolation, disabled tracking guard');
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
