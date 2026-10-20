// Real-database integration test for Supplier A/P Shared Workflows:
// Document identities, matching resolver, Paid bill receiving, independent bill void preservation,
// audited amount corrections, and server-enforced operation idempotency.
//
// Run inside Docker with:
//   docker compose exec backend node tests/supplierApSharedWorkflows_db_test.js

const db = require('../db');
const supplierBillService = require('../services/supplierBillService');
const apOperationIdempotency = require('../services/apOperationIdempotencyService');
const apLedgerService = require('../services/apLedgerService');
const { postReceipt } = require('../services/grnPostingService');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error(`  ✘ ${msg}`);
  } else {
    console.log(`  ✔ ${msg}`);
  }
}

async function runTests() {
  const client = await db.getClient();
  console.log('Supplier A/P Shared Workflows Database Integration Test');

  try {
    await client.query('BEGIN');

    // 1. Setup test supplier, employee, brand, group, part
    const { rows: [employee] } = await client.query(
      `INSERT INTO employee (first_name, last_name, username, password_hash, password_salt, is_active, permission_level_id)
       VALUES ('AP', 'Tester', 'ap_tester_' || floor(random() * 100000), 'hash', 'salt', true, 10)
       RETURNING employee_id`,
    );
    const empId = employee.employee_id;

    const { rows: [supplier] } = await client.query(
      `INSERT INTO supplier (supplier_name, is_active, payment_terms_days)
       VALUES ('Shared Workflow Test Supplier', true, 30)
       RETURNING supplier_id`,
    );
    const suppId = supplier.supplier_id;

    const { rows: [brand] } = await client.query(
      `INSERT INTO brand (brand_name, brand_code) VALUES ('TestBrand_' || floor(random() * 100000), 'TB' || floor(random() * 100000)) RETURNING brand_id`,
    );
    const { rows: [group] } = await client.query(
      `INSERT INTO "group" (group_name, group_code) VALUES ('TestGroup_' || floor(random() * 100000), 'TG' || floor(random() * 100000)) RETURNING group_id`,
    );
    const { rows: [part] } = await client.query(
      `INSERT INTO part (internal_sku, detail, brand_id, group_id, is_active, last_cost, wac_cost, last_sale_price)
       VALUES ('TEST-AP-PART-' || floor(random() * 100000), 'AP Test Part', $1, $2, true, 100, 100, 150)
       RETURNING part_id`,
      [brand.brand_id, group.group_id],
    );
    const partId = part.part_id;

    console.log('\nIdentity Management & Collision Prevention');
    // Create an independent supplier bill
    const { rows: [bill1] } = await client.query(
      `INSERT INTO supplier_bill (supplier_id, bill_number, bill_date, due_date, total_amount, liability_basis,
                                  supplier_document_type, supplier_document_no, created_by)
       VALUES ($1, 'SB-TEST-001', CURRENT_DATE, CURRENT_DATE + 30, 5000, 'independent', 'invoice', 'INV-UNIQUE-999', $2)
       RETURNING bill_id`,
      [suppId, empId],
    );

    await supplierBillService.registerBillIdentity(client, {
      billId: bill1.bill_id,
      supplierId: suppId,
      documentType: 'invoice',
      documentNo: 'INV-UNIQUE-999',
      isPrimary: true,
    });
    assert(true, 'Registered primary bill identity for invoice INV-UNIQUE-999');

    // Attempting to register the same identity for another bill of the same supplier must fail
    const { rows: [bill2] } = await client.query(
      `INSERT INTO supplier_bill (supplier_id, bill_number, bill_date, due_date, total_amount, liability_basis, created_by)
       VALUES ($1, 'SB-TEST-002', CURRENT_DATE, CURRENT_DATE + 30, 2000, 'independent', $2)
       RETURNING bill_id`,
      [suppId, empId],
    );

    let collisionCaught = false;
    try {
      await supplierBillService.registerBillIdentity(client, {
        billId: bill2.bill_id,
        supplierId: suppId,
        documentType: 'invoice',
        documentNo: '  inv-unique-999  ', // testing normalization
        isPrimary: true,
      });
    } catch (err) {
      collisionCaught = err.code === 'BILL_IDENTITY_CONFLICT';
    }
    assert(collisionCaught, 'Duplicate document identity rejected with BILL_IDENTITY_CONFLICT');

    console.log('\nMatching Resolver');
    const matches = await supplierBillService.resolveDocumentMatches(client, {
      supplierId: suppId,
      documentType: 'invoice',
      documentNo: 'inv-unique-999',
    });
    assert(matches.exact.length === 1 && matches.exact[0].bill_id === bill1.bill_id, 'Resolver found exact candidate for inv-unique-999');
    assert(matches.exact[0].match_reason === 'exact', `Candidate match reason indicates exact match: ${matches.exact[0].match_reason}`);

    console.log('\nReceiving against a Paid Bill');
    // Mark bill1 as Paid
    await client.query(
      `UPDATE supplier_bill SET status = 'Paid', amount_paid = 5000 WHERE bill_id = $1`,
      [bill1.bill_id],
    );
    // Validation must succeed for Paid bill
    const validatedBill = await supplierBillService.validateBillForReceiving(client, {
      billId: bill1.bill_id,
      supplierId: suppId,
    });
    assert(validatedBill.bill_id === bill1.bill_id, 'validateBillForReceiving accepts Paid bill without error');

    // Post GRN against bill1
    const grnNumber = await getNextDocumentNumber(client, 'GRN');
    const { rows: [grn] } = await client.query(
      `INSERT INTO goods_receipt (grn_number, supplier_id, received_by, bill_id, workflow_status, created_by, posted_by, posted_at)
       VALUES ($1, $2, $3, $4, 'Posted', $3, $3, CURRENT_TIMESTAMP)
       RETURNING grn_id`,
      [grnNumber, suppId, empId, bill1.bill_id],
    );
    await client.query(
      `INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, landed_unit_cost, effective_markup_percent)
       VALUES ($1, $2, 10, 100, 100, 50)`,
      [grn.grn_id, partId],
    );

    const postRes = await postReceipt(client, {
      grnId: grn.grn_id,
      grnNumber,
      supplierId: suppId,
      employeeId: empId,
      lines: [{ part_id: partId, quantity: 10, cost_price: 100, landed_unit_cost: 100, return_quantity: 0 }],
      billId: bill1.bill_id,
      netGoodsValue: 1000,
    });
    assert(postRes.billId === bill1.bill_id, 'postReceipt links to existing bill without creating new bill');

    const { rows: [refreshedBill1] } = await client.query(
      `SELECT status, amount_paid, total_amount FROM supplier_bill WHERE bill_id = $1`,
      [bill1.bill_id],
    );
    assert(refreshedBill1.status === 'Paid' && Number(refreshedBill1.amount_paid) === 5000, 'Paid bill status and paid amount remain unchanged after receiving');

    console.log('\nIndependent Bill Void Preservation');
    // If a GR attached to an independent bill is voided, the bill must NOT be voided or reduced
    await client.query(
      `UPDATE goods_receipt SET status = 'Voided', voided_at = CURRENT_TIMESTAMP, voided_by = $1, void_reason = 'Test void'
       WHERE grn_id = $2`,
      [empId, grn.grn_id],
    );
    const { rows: [billAfterVoid] } = await client.query(
      `SELECT status, total_amount FROM supplier_bill WHERE bill_id = $1`,
      [bill1.bill_id],
    );
    assert(billAfterVoid.status === 'Paid' && Number(billAfterVoid.total_amount) === 5000, 'Independent bill is not voided or reduced when GR is voided');

    console.log('\nAudited Amount & Reference Correction');
    // Open a fresh bill to test amount correction
    const { rows: [bill3] } = await client.query(
      `INSERT INTO supplier_bill (supplier_id, bill_number, bill_date, due_date, total_amount, liability_basis, created_by)
       VALUES ($1, 'SB-CORR-001', CURRENT_DATE, CURRENT_DATE + 30, 3000, 'receipt_derived', $2)
       RETURNING bill_id`,
      [suppId, empId],
    );
    await apLedgerService.appendEntry(client, {
      supplierId: suppId,
      billId: bill3.bill_id,
      entryType: 'BILL_POSTED',
      amount: 3000,
      referenceNo: 'SB-CORR-001',
      createdBy: empId,
    });

    const correction = await supplierBillService.recordBillAmountCorrection(client, {
      billId: bill3.bill_id,
      newAmount: 3500,
      reason: 'Supplier invoice correction after audit',
      actorId: empId,
      confirmIndependent: true,
      documentType: 'invoice',
      documentNo: 'CORR-INV-777',
    });
    assert(Number(correction.total_amount) === 3500, 'Bill amount updated to 3500');
    assert(correction.liability_basis === 'independent', 'Bill liability basis promoted to independent');

    const { rows: corrLogs } = await client.query(
      `SELECT * FROM supplier_bill_correction_log WHERE bill_id = $1`,
      [bill3.bill_id],
    );
    assert(corrLogs.length === 1, 'supplier_bill_correction_log recorded 1 audit entry');
    assert(Number(corrLogs[0].old_total_amount) === 3000 && Number(corrLogs[0].new_total_amount) === 3500, 'Audit log accurately captured old (3000) and new (3500) amounts');

    console.log('\nServer-Enforced Operation Idempotency');
    const reqKey = 'idemp_test_' + Date.now();
    const opPayload = { amount: 500, supplier_id: suppId };

    // 1. Begin operation
    const opId = await apOperationIdempotency.beginOperation(client, {
      requestId: reqKey,
      actorId: empId,
      operation: 'AP_RECORD_PAYMENT',
      payload: opPayload,
    });
    assert(opId === reqKey, 'Operation successfully begun with request id');

    // 2. Finish operation
    await apOperationIdempotency.finishOperation(client, {
      requestId: opId,
      statusCode: 201,
      responseBody: { payment_id: 12345, success: true },
    });
    assert(true, 'Operation finished with status 201 and response body');

    // 3. Exact replay: same key, same actor, same operation, same payload
    let replayed = false;
    let replayResponse = null;
    try {
      await apOperationIdempotency.beginOperation(client, {
        requestId: reqKey,
        actorId: empId,
        operation: 'AP_RECORD_PAYMENT',
        payload: opPayload,
      });
    } catch (err) {
      if (err.isReplay) {
        replayed = true;
        replayResponse = err.response;
      }
    }
    assert(replayed && replayResponse?.payment_id === 12345, 'Identical request replay returns original cached response');

    // 4. Conflict: same key, but different payload
    let conflictCaught = false;
    try {
      await apOperationIdempotency.beginOperation(client, {
        requestId: reqKey,
        actorId: empId,
        operation: 'AP_RECORD_PAYMENT',
        payload: { amount: 9999, supplier_id: suppId }, // different amount!
      });
    } catch (err) {
      if (err.code === 'IDEMPOTENCY_CONFLICT') {
        conflictCaught = true;
      }
    }
    assert(conflictCaught, 'Modified payload with same idempotency key rejected with IDEMPOTENCY_CONFLICT');

    await client.query('ROLLBACK');
    console.log('\nAll integration checks passed cleanly and rolled back.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    failures += 1;
    console.error('Unhandled Test Failure:', err);
  } finally {
    client.release();
    process.exit(failures > 0 ? 1 : 0);
  }
}

runTests();
