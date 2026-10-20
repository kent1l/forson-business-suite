// Real HTTP routes + PostgreSQL. Run ONLY against a disposable schema-cloned DB:
// DB_NAME=forson_supplier_reference_test node tests/supplierReferenceWorkflow_db_test.js
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
if (process.env.DB_NAME !== 'forson_supplier_reference_test') {
  throw new Error('This suite requires the disposable forson_supplier_reference_test database.');
}
const db = require('../db');
const { manilaDateString } = require('../helpers/manilaDate');
const billService = require('../services/supplierBillService');
const app = express();
app.use(express.json());
app.use('/api', require('../routes/apRoutes'));
app.use('/api', require('../routes/apPdcRoutes'));
app.use('/api', require('../routes/goodsReceiptRoutes'));

(async () => {
  await db.query("INSERT INTO permission_level (permission_level_id, level_name) VALUES (10, 'Test Admin') ON CONFLICT DO NOTHING");
  const { rows: [emp] } = await db.query("INSERT INTO employee (first_name,last_name,username,password_hash,password_salt,is_active,permission_level_id) VALUES ('Reference','Tester','reference_tester','hash','salt',true,10) RETURNING employee_id");
  const { rows: [supplier] } = await db.query("INSERT INTO supplier (supplier_name,is_active,payment_terms_days) VALUES ('Reference Test Supplier',true,30) RETURNING supplier_id");
  const { rows: [supplier2] } = await db.query("INSERT INTO supplier (supplier_name,is_active) VALUES ('Other Test Supplier',true) RETURNING supplier_id");
  const { rows: [brand] } = await db.query("INSERT INTO brand (brand_name,brand_code) VALUES ('Reference Brand','REF') RETURNING brand_id");
  const { rows: [group] } = await db.query("INSERT INTO \"group\" (group_name,group_code) VALUES ('Reference Group','REF') RETURNING group_id");
  const { rows: [part] } = await db.query("INSERT INTO part (internal_sku,detail,brand_id,group_id,is_active,last_cost,wac_cost,last_sale_price) VALUES ('REF-TEST-PART','Reference test',$1,$2,true,100,100,150) RETURNING part_id", [brand.brand_id, group.group_id]);
  const token = jwt.sign({ employee_id: emp.employee_id, login_date: manilaDateString() }, process.env.JWT_SECRET || 'reference-test-secret');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'reference-test-secret';
  async function call(method, path, body, status = 200) {
    const req = request(app)[method]('/api' + path).set('Authorization', `Bearer ${token}`);
    const res = await (body ? req.send(body) : req);
    assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(res.body)}`);
    return res.body;
  }
  const goods = (ref, extra = {}) => ({
    supplier_id: supplier.supplier_id, received_by: emp.employee_id,
    supplier_document_no: ref,
    lines: [{ part_id: part.part_id, quantity: 2, cost_price: 100, sale_price: 150, effective_markup_percent: 50 }],
    ...extra,
  });
  const payable = (ref, extra = {}) => ({ supplier_id: supplier.supplier_id, supplier_document_no: ref, total_amount: 1000, ...extra });

  const bill = (await call('post', '/ap/supplier-bills', payable('AR-00182'), 201)).data;
  assert.match(bill.bill_number, /^BILL-/);
  assert.equal(bill.supplier_document_no, 'AR-00182');
  assert.equal(bill.supplier_document_type, 'other');
  const matches = await call('get', `/ap/supplier-bills/matches?supplier_id=${supplier.supplier_id}&document_no=ar-00182`);
  assert.equal(matches.data.exact[0].bill_id, bill.bill_id);
  assert.equal((await call('get', `/ap/supplier-bills/${bill.bill_id}`)).data.supplier_document_no, 'AR-00182');
  await call('post', '/ap/supplier-bills', payable(' ar-00182 '), 409);
  await call('post', '/ap/supplier-bills', payable('AR-00182', { supplier_id: supplier2.supplier_id }), 201);
  assert.equal((await call('get', `/ap/supplier-bills/matches?supplier_id=${supplier.supplier_id}&document_no=AR-182`)).data.exact.length, 0, 'leading zeroes significant');
  await call('post', '/goods-receipts', goods('AR-00182'), 409); // cannot create second payable
  const grn = await call('post', '/goods-receipts', goods('AR-00182', { bill_id: bill.bill_id }), 201);
  const header = await call('get', `/goods-receipts/${grn.grn_id}`);
  assert.equal(header.supplier_document_no, 'AR-00182');
  assert.equal(header.physical_receipt_no, null);
  assert.equal(header.supplier_invoice_no, null);
  await call('post', '/goods-receipts', goods('AR-00182', { bill_id: bill.bill_id }), 409);
  const before = (await db.query("SELECT count(*)::int n FROM inventory_transaction WHERE trans_type = 'StockIn' AND part_id=$1", [part.part_id])).rows[0].n;
  const duplicate = await call('get', `/goods-receipts/check-supplier-reference?supplier_id=${supplier.supplier_id}&document_no=AR-00182`);
  assert.equal(duplicate.receipts.length, 1);
  await call('post', '/goods-receipts', goods('AR-00182', { bill_id: bill.bill_id, another_delivery_confirmed: true }), 201);
  const after = (await db.query("SELECT count(*)::int n FROM inventory_transaction WHERE trans_type = 'StockIn' AND part_id=$1", [part.part_id])).rows[0].n;
  assert.equal(after, before + 1, 'only acknowledged arrival adds stock');
  assert.equal((await db.query('SELECT count(*)::int n FROM supplier_bill WHERE supplier_id=$1', [supplier.supplier_id])).rows[0].n, 1, 'one debt after two receipts');

  const draftPayload = goods('PACK-008');
  const draft = await call('post', '/goods-receipts/drafts', draftPayload, 201);
  assert.equal((await call('get', `/goods-receipts/${draft.grn_id}`)).supplier_document_no, 'PACK-008');
  await call('post', '/goods-receipts/drafts', draftPayload, 409);
  await call('put', `/goods-receipts/${draft.grn_id}/draft`, { ...draftPayload, supplier_document_no: 'PACK-009' });
  await call('patch', `/goods-receipts/${draft.grn_id}/submit`, {});
  const posted = await call('post', `/goods-receipts/${draft.grn_id}/post`, {});
  const newBill = (await call('get', `/ap/supplier-bills/${posted.bill_id}`)).data;
  assert.equal(newBill.supplier_document_no, 'PACK-009');
  const list = await call('get', `/goods-receipts?search=PACK-009`);
  assert.ok(JSON.stringify(list).includes('PACK-009'));
  await call('post', '/ap/supplier-bills', payable('PACK-009'), 409);

  // Typed references remain useful when a supplier legitimately reuses numbers.
  const typed = (await call('post', '/ap/supplier-bills', payable('123', { supplier_document_type: 'invoice' }), 201)).data;
  await call('post', '/ap/supplier-bills', payable('123', { supplier_document_type: 'delivery_receipt' }), 201);
  await call('post', '/ap/supplier-bills', payable('123'), 409);
  await db.query("UPDATE supplier_bill SET amount_paid=total_amount,status='Paid' WHERE bill_id=$1", [typed.bill_id]);
  const receivedPaid = await call('post', '/goods-receipts', goods('123', { bill_id: typed.bill_id, supplier_document_type: 'invoice' }), 201);
  assert.equal(receivedPaid.bill_id, typed.bill_id);
  assert.equal((await call('get', `/ap/supplier-bills/${typed.bill_id}`)).data.status, 'Paid');

  // Alias lookup searches the supplier's paperwork, never a generated BILL number.
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await billService.registerBillIdentity(client, { supplierId: supplier.supplier_id, billId: bill.bill_id, documentType: 'invoice', documentNo: 'SI-908', isPrimary: false });
    await client.query('COMMIT');
  } finally { client.release(); }
  const aliasList = await call('get', `/ap/supplier-bills?supplier_id=${supplier.supplier_id}&search=SI-908&status=all`);
  assert.equal(aliasList.data[0].bill_id, bill.bill_id);
  assert.ok(aliasList.data[0].document_references.includes('SI-908'));
  await call('post', '/ap/supplier-bills', payable('SI-908'), 409);
  const { rows: [method] } = await db.query("INSERT INTO payment_methods (code,name,type,enabled,ap_enabled,config) VALUES ('reference_transfer','Reference Transfer','other',true,true,'{}') RETURNING method_id");
  await call('post', '/ap/payments', {
    supplier_id: supplier.supplier_id, method_id: method.method_id, amount: 300,
    funding_source: 'OTHER', allocations: [{ bill_id: bill.bill_id, amount: 300 }],
    reference_number: 'BANK-TRANSFER-1',
  }, 201);
  const paidBill = (await call('get', `/ap/supplier-bills/${bill.bill_id}`)).data;
  assert.equal(Number(paidBill.amount_paid), 300);
  assert.equal(paidBill.supplier_document_no, 'AR-00182');
  const payments = await call('get', `/ap/suppliers/${supplier.supplier_id}/payments`);
  assert.ok(JSON.stringify(payments).includes('AR-00182'), 'payment history exposes supplier reference');
  assert.ok(JSON.stringify(await call('get', '/ap/payments')).includes('AR-00182'), 'payment register exposes supplier reference');
  // Concurrent manual/receiving creation of the same reference must commit one debt.
  const concurrent = await Promise.all([
    request(app).post('/api/ap/supplier-bills').set('Authorization', `Bearer ${token}`).send(payable('RACE-REFERENCE')),
    request(app).post('/api/goods-receipts').set('Authorization', `Bearer ${token}`).send(goods('RACE-REFERENCE')),
  ]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201,409], JSON.stringify(concurrent.map(r => r.body)));
  assert.equal((await db.query("SELECT count(*)::int n FROM supplier_bill WHERE supplier_id=$1 AND supplier_document_no='RACE-REFERENCE'", [supplier.supplier_id])).rows[0].n, 1);
  const repeatBody = goods('IDEMP-REFERENCE');
  const postWithKey = body => request(app).post('/api/goods-receipts').set('Authorization', `Bearer ${token}`).set('Idempotency-Key','reference-test-idem-1').send(body);
  const firstIntent = await postWithKey(repeatBody);
  assert.equal(firstIntent.status,201,JSON.stringify(firstIntent.body));
  const replayIntent = await postWithKey(repeatBody);
  assert.equal(replayIntent.status,201,JSON.stringify(replayIntent.body));
  assert.equal(replayIntent.body.grn_id,firstIntent.body.grn_id);
  assert.equal((await postWithKey({...repeatBody,supplier_document_no:'CHANGED-REFERENCE'})).status,409);
  const partialDraft = await call('post','/goods-receipts/drafts',goods('AR-00182',{bill_id:bill.bill_id,another_delivery_confirmed:true}),201);
  const partialHeader = await call('get',`/goods-receipts/${partialDraft.grn_id}`);
  assert.equal(partialHeader.another_delivery_confirmed,true);
  assert.equal(partialHeader.bill_id,bill.bill_id);
  await call('patch',`/goods-receipts/${partialDraft.grn_id}/submit`,{});
  assert.equal((await call('post',`/goods-receipts/${partialDraft.grn_id}/post`,{})).bill_id,bill.bill_id);
  const cancelled = await call('post','/goods-receipts/drafts',goods('CANCELLED-REF'),201);
  await call('patch',`/goods-receipts/${cancelled.grn_id}/cancel`,{});
  await call('post','/goods-receipts',goods('CANCELLED-REF'),201);
  const internal = await call('get', `/ap/supplier-bills/matches?supplier_id=${supplier.supplier_id}&document_no=${bill.bill_number}`);
  assert.equal(internal.data.exact.length + internal.data.legacy.length, 0);
  console.log('PASS: supplier reference API, stock/debt counts, drafts, typed ambiguity, Paid receiving, aliases, payment allocation, concurrency and retry idempotency.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
