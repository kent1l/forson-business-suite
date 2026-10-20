// Real HTTP routes + PostgreSQL. Run ONLY against a disposable schema-cloned DB:
// DB_NAME=forson_grn_import_test node packages/api/tests/grnImportWorkflow_db_test.js
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

if (process.env.DB_NAME !== 'forson_grn_import_test') {
  throw new Error('This suite requires the disposable forson_grn_import_test database.');
}

const db = require('../db');
const { manilaDateString } = require('../helpers/manilaDate');
const { abandonInactiveReviews, purgeExpiredAbandonedReviews } = require('../services/grnImportMaintenanceService');

const app = express();
app.use('/api/goods-receipts/imports', express.json({ limit: '1114112b' }));
app.use('/api/goods-receipts/imports', (err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' });
  }
  next(err);
});
app.use(express.json());
app.use('/api', require('../routes/goodsReceiptRoutes'));

(async () => {
  console.log('Starting GRN Import Integration Suite on forson_grn_import_test...');

  // Setup test permissions and actors
  await db.query("INSERT INTO permission_level (permission_level_id, level_name) VALUES (10, 'Test Admin'), (2, 'Receiver') ON CONFLICT DO NOTHING");
  await db.query(`
    INSERT INTO role_permission (permission_level_id, permission_id)
    SELECT 2, permission_id FROM permission WHERE permission_key IN ('goods_receipt:create', 'goods_receipt:post', 'goods_receipt:price_sync')
    ON CONFLICT DO NOTHING
  `);

  const runId = Math.random().toString(36).substring(2, 7);
  const { rows: [emp1] } = await db.query(
    `INSERT INTO employee (first_name,last_name,username,password_hash,password_salt,is_active,permission_level_id)
     VALUES ('GRN','Receiver','grn_receiver_1_${runId}','hash','salt',true,2) RETURNING employee_id`
  );
  const { rows: [emp2] } = await db.query(
    `INSERT INTO employee (first_name,last_name,username,password_hash,password_salt,is_active,permission_level_id)
     VALUES ('Other','Receiver','grn_receiver_2_${runId}','hash','salt',true,2) RETURNING employee_id`
  );

  const { rows: [supplier] } = await db.query(
    `INSERT INTO supplier (supplier_name,is_active,payment_terms_days)
     VALUES ('GRN Import Test Supplier ${runId}',true,30) RETURNING supplier_id`
  );
  const { rows: [brand] } = await db.query(
    `INSERT INTO brand (brand_name,brand_code)
     VALUES ('Import Brand ${runId}','IMP${runId}') RETURNING brand_id`
  );
  const { rows: [group] } = await db.query(
    `INSERT INTO "group" (group_name,group_code)
     VALUES ('Import Group ${runId}','IMP${runId}') RETURNING group_id`
  );

  const { rows: [partA] } = await db.query(
    `INSERT INTO part (internal_sku,detail,brand_id,group_id,is_active,last_cost,wac_cost,last_sale_price,measurement_unit)
     VALUES ('IMP-PART-A-${runId}','Import Part A',$1,$2,true,100,100,150,'PCS') RETURNING part_id`,
    [brand.brand_id, group.group_id]
  );
  const { rows: [partB] } = await db.query(
    `INSERT INTO part (internal_sku,detail,brand_id,group_id,is_active,last_cost,wac_cost,last_sale_price,measurement_unit)
     VALUES ('IMP-PART-B-${runId}','Import Part B',$1,$2,true,200,200,300,'PCS') RETURNING part_id`,
    [brand.brand_id, group.group_id]
  );

  const token1 = jwt.sign(
    { employee_id: emp1.employee_id, permissions: ['goods_receipt:create', 'goods_receipt:post', 'goods_receipt:price_sync'], login_date: manilaDateString() },
    process.env.JWT_SECRET || 'import-test-secret'
  );
  const token2 = jwt.sign(
    { employee_id: emp2.employee_id, permissions: ['goods_receipt:create'], login_date: manilaDateString() },
    process.env.JWT_SECRET || 'import-test-secret'
  );
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'import-test-secret';

  async function call(method, path, body, status = 200, token = token1) {
    const req = request(app)[method]('/api' + path).set('Authorization', `Bearer ${token}`);
    const res = await (body ? req.send(body) : req);
    assert.equal(res.status, status, `${method} ${path} returned ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  // 1. Feature Flag: when disabled, 503 GRN_IMPORT_DISABLED
  process.env.GRN_JSON_IMPORT_ENABLED = 'false';
  const capsDisabled = await call('get', '/goods-receipts/import-capabilities', null, 200);
  assert.equal(capsDisabled.enabled, false);

  const dummyPayload = {
    schema_version: 1,
    document: {
      supplier_name: 'GRN Import Test Supplier',
      document_type: 'delivery_receipt',
      document_number: 'DR-TEST-001',
      document_date: '2026-10-20',
      currency: 'PHP',
      printed_total: '250.00',
    },
    lines: [{
      line_no: 1,
      raw_text: '2 PCS OIL FILTER 125.00 250.00',
      description: 'OIL FILTER',
      brand: null,
      part_number: null,
      supplier_item_code: null,
      item_group_hint: null,
      quantity: '2.0000',
      unit: 'PCS',
      unit_cost: '125.00',
      printed_line_total: '250.00',
      handwritten_sale_price: null,
      receiving_mark: null,
      enrichment: { status: 'unresolved', sources: [] },
    }],
    extraction_issues: [],
  };

  const reqKey1 = crypto.randomUUID();
  const disabledPost = await call('post', '/goods-receipts/imports', { request_key: reqKey1, payload: dummyPayload }, 503);
  assert.equal(disabledPost.code, 'GRN_IMPORT_DISABLED');

  // 2. Enable Feature Flag
  process.env.GRN_JSON_IMPORT_ENABLED = 'true';
  const capsEnabled = await call('get', '/goods-receipts/import-capabilities', null, 200);
  assert.equal(capsEnabled.enabled, true);
  assert.equal(capsEnabled.schema_version, 1);

  // 3. Create Import and verify creation replay
  const createRes = await call('post', '/goods-receipts/imports', {
    request_key: reqKey1,
    payload: dummyPayload,
    context: { supplier_id: supplier.supplier_id },
  }, 201);
  assert.ok(createRes.import_id);
  assert.equal(createRes.status, 'IN_REVIEW');
  assert.equal(createRes.version, 1);
  assert(createRes.blockers.length > 0);

  const importId = createRes.import_id;

  // Replay identical request_key -> 200
  const replayRes = await call('post', '/goods-receipts/imports', {
    request_key: reqKey1,
    payload: dummyPayload,
    context: { supplier_id: supplier.supplier_id },
  }, 200);
  assert.equal(replayRes.import_id, importId);

  // Same key with different payload -> 409
  const changedPayload = {
    ...dummyPayload,
    document: { ...dummyPayload.document, document_number: 'DR-CHANGED' },
  };
  await call('post', '/goods-receipts/imports', {
    request_key: reqKey1,
    payload: changedPayload,
    context: { supplier_id: supplier.supplier_id },
  }, 409);

  // 4. Scoping & Privacy: User 2 cannot access User 1's import
  await call('get', `/goods-receipts/imports/${importId}`, null, 404, token2);
  await call('patch', `/goods-receipts/imports/${importId}`, { version: 1, actions: [{ type: 'confirm_header' }] }, 404, token2);

  // 5. User 1 GET import
  const fetched = await call('get', `/goods-receipts/imports/${importId}`);
  assert.equal(fetched.import_id, importId);
  assert.equal(fetched.status, 'IN_REVIEW');
  assert.equal(fetched.review_state.rows.length, 1);

  const row1Id = fetched.review_state.rows[0].row_id;

  // 6. PATCH actions & version check
  // Stale version check: request version 99 -> 409
  await call('patch', `/goods-receipts/imports/${importId}`, {
    version: 99,
    actions: [{ type: 'set_header', values: { receipt_date: '2026-10-20' } }],
  }, 409);

  // Update header and row
  const patch1 = await call('patch', `/goods-receipts/imports/${importId}`, {
    version: 1,
    actions: [
      {
        type: 'set_header',
        values: {
          supplier_id: supplier.supplier_id,
          receipt_date: '2026-10-20',
          confirmed_currency: 'PHP',
        },
      },
      {
        type: 'set_row',
        row_id: row1Id,
        values: {
          part_id: partA.part_id,
          stock_uom: 'PCS',
          units_per_source_unit: '1.0000',
          delivered_quantity: '2.0000',
          cost_price: '125.00',
          cost_kind: 'priced',
        },
      },
    ],
  }, 200);
  assert.equal(patch1.version, 2);

  // Confirm row and header
  const patch2 = await call('patch', `/goods-receipts/imports/${importId}`, {
    version: 2,
    actions: [
      { type: 'confirm_row', row_id: row1Id },
      { type: 'confirm_header' },
    ],
  }, 200);
  assert.equal(patch2.version, 3);
  assert.equal(patch2.blockers.length, 0, `Expected 0 blockers, got: ${JSON.stringify(patch2.blockers)}`);

  // 7. Commit
  const commitRes = await call('post', `/goods-receipts/imports/${importId}/commit`, {
    version: 3,
  }, 201);
  assert.ok(commitRes.grn_id);
  assert.match(commitRes.grn_number, /^GRD-/);
  assert.equal(commitRes.workflow_status, 'Draft');

  const committedGrnId = commitRes.grn_id;

  // Commit replay with stored commit_review_version (4) returns 200
  const commitReplay = await call('post', `/goods-receipts/imports/${importId}/commit`, {
    version: 4,
  }, 200);
  assert.equal(commitReplay.grn_id, committedGrnId);

  // Read goods receipt header and lines
  const grnHeader = await call('get', `/goods-receipts/${committedGrnId}`);
  assert.equal(grnHeader.grn_id, committedGrnId);
  assert.equal(grnHeader.import_provenance?.import_id, importId);
  assert.equal(grnHeader.import_provenance?.status, 'COMMITTED');

  const grnLines = await call('get', `/goods-receipts/${committedGrnId}/lines`);
  assert.equal(grnLines.length, 1);
  assert.equal(grnLines[0].line_uuid, row1Id, 'GRN line_uuid must match imported row_id');

  // Updating the imported GRN without line_identity_version returns 409
  await call('put', `/goods-receipts/${committedGrnId}/draft`, {
    supplier_id: supplier.supplier_id,
    supplier_document_no: 'DR-TEST-001',
    lines: [{ part_id: partA.part_id, quantity: 2, cost_price: 125, sale_price: 150 }],
  }, 409);

  // Updating with line_identity_version: 1 and line_uuid succeeds
  const updateRes = await call('put', `/goods-receipts/${committedGrnId}/draft`, {
    line_identity_version: 1,
    supplier_id: supplier.supplier_id,
    supplier_document_no: 'DR-TEST-001',
    lines: [{ line_uuid: row1Id, part_id: partA.part_id, quantity: 2, cost_price: 125, sale_price: 160 }],
  }, 200);
  assert.equal(updateRes.workflow_status, 'Draft');

  // 8. Test Deterministic Catalog Retail Price with Duplicate Parts
  // Create a posted GRN with duplicate part rows at different sale prices
  const postGrnRes = await call('post', '/goods-receipts', {
    supplier_id: supplier.supplier_id,
    received_by: emp1.employee_id,
    supplier_document_no: `DR-DUP-TEST-${runId}`,
    sync_retail_prices: true,
    lines: [
      { part_id: partB.part_id, quantity: 5, cost_price: 100, sale_price: 250 },
      { part_id: partB.part_id, quantity: 5, cost_price: 100, sale_price: 275 }, // last row
    ],
  }, 201);
  const postedGrnId = postGrnRes.grn_id;

  // Check partB retail price in DB -> should be 275 (from last eligible row)
  const { rows: [partBRow1] } = await db.query('SELECT last_sale_price FROM part WHERE part_id = $1', [partB.part_id]);
  assert.equal(Number(partBRow1.last_sale_price), 275, 'recompute_wac_for_part must select last eligible row price (275)');

  // Run explicit sync-retail-prices endpoint
  const syncRes = await call('post', `/goods-receipts/${postedGrnId}/sync-retail-prices`, null, 200);
  assert.equal(syncRes.parts[0].last_sale_price, '275.00');

  // 9. Maintenance tests: abandonment after 30 days and purge after 90 days
  // Create an old IN_REVIEW import
  const { rows: [oldReview] } = await db.query(
    `INSERT INTO grn_import_review (
       created_by_employee_id, status, schema_version, source_payload, payload_hash,
       initial_context, review_state, request_key, version, updated_at
     )
     VALUES ($1, 'IN_REVIEW', 1, '{"test":1}'::jsonb, 'hash-old-1', '{}'::jsonb, '{"rows":[]}'::jsonb, gen_random_uuid(), 1, CURRENT_TIMESTAMP - INTERVAL '35 days')
     RETURNING import_id`,
    [emp1.employee_id]
  );
  const client = await db.getClient();
  try {
    const abandonedCount = await abandonInactiveReviews(client);
    assert(abandonedCount >= 1, 'Should abandon inactive reviews older than 30 days');

    const { rows: [checkAbandoned] } = await db.query('SELECT status, abandoned_at FROM grn_import_review WHERE import_id = $1', [oldReview.import_id]);
    assert.equal(checkAbandoned.status, 'ABANDONED');
    assert.ok(checkAbandoned.abandoned_at);

    // Now age it to 95 days past abandonment
    await db.query(
      "UPDATE grn_import_review SET abandoned_at = CURRENT_TIMESTAMP - INTERVAL '95 days' WHERE import_id = $1",
      [oldReview.import_id]
    );

    const purgedCount = await purgeExpiredAbandonedReviews(client);
    assert(purgedCount >= 1, 'Should purge abandoned reviews older than 90 days');

    const { rows: [checkPurged] } = await db.query('SELECT status, source_payload, review_state, purged_at FROM grn_import_review WHERE import_id = $1', [oldReview.import_id]);
    assert.equal(checkPurged.status, 'ABANDONED');
    assert.equal(checkPurged.source_payload, null);
    assert.equal(checkPurged.review_state, null);
    assert.ok(checkPurged.purged_at);
  } finally {
    client.release();
  }

  console.log('✔ All GRN Import Integration Tests Passed on forson_grn_import_test!');
  process.exit(0);
})().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
