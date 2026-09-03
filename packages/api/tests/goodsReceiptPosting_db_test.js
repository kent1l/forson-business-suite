// Real-database integration test for the goods receipt draft → submit → post workflow,
// landed cost, freight billing and returns. Excluded from the normal jest run (see
// jest.config.js testPathIgnorePatterns, matching the existing *_db_test.js convention)
// — run manually against a live DB with:
//   node tests/goodsReceiptPosting_db_test.js
//
// The unit suites prove the arithmetic and the state machine in isolation, with the
// database mocked. What they cannot prove is the part that actually matters in
// production: that the landed cost computed in JavaScript survives the round trip
// through inventory_transaction and comes back out of the WAC trigger as the number it
// went in as, that two separate payables really are created for the goods and the
// carrier, that the price-sync flag genuinely gates part.last_sale_price, and that a
// return reverses all of it. Only a real Postgres — with the real triggers attached —
// can answer that.
//
// Runs entirely inside a transaction that is rolled back at the end, so it leaves no
// trace in the database it runs against.

const db = require('../db');
const { postReceipt } = require('../services/grnPostingService');
const { computeCosting } = require('../services/grnCostingService');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const apLedgerService = require('../services/apLedgerService');
const { recomputeWacForParts } = require('../services/transactionDateService');

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error(`  ✘ ${msg}`);
  } else {
    console.log(`  ✔ ${msg}`);
  }
}

function near(a, b, tolerance = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

/** A part with no prior stock, so WAC starts from a known place. */
async function makeTestPart(client, sku, brandId, groupId) {
  const { rows: [part] } = await client.query(
    `INSERT INTO part (internal_sku, detail, brand_id, group_id, is_active, last_cost, wac_cost, last_sale_price)
     VALUES ($1, 'GRN integration test part', $2, $3, true, 0, 0, 999)
     RETURNING part_id`,
    [sku, brandId, groupId],
  );
  return part.part_id;
}

async function run() {
  const client = await db.getClient();
  const stamp = Date.now();

  try {
    await client.query('BEGIN');

    const { rows: [employee] } = await client.query('SELECT employee_id FROM employee LIMIT 1');
    const { rows: [supplier] } = await client.query(
      `INSERT INTO supplier (supplier_name, is_active) VALUES ($1, true) RETURNING supplier_id`,
      [`TEST GRN Supplier ${stamp}`],
    );
    const { rows: [carrier] } = await client.query(
      `INSERT INTO supplier (supplier_name, is_active) VALUES ($1, true) RETURNING supplier_id`,
      [`TEST GRN Carrier ${stamp}`],
    );
    if (!employee) throw new Error('No employee row to act as the receiver — cannot run.');

    const { rows: [brand] } = await client.query('SELECT brand_id FROM brand LIMIT 1');
    const { rows: [group] } = await client.query('SELECT group_id FROM "group" LIMIT 1');
    if (!brand || !group) throw new Error('No brand/group seed data — cannot create test parts.');

    const smallPartId = await makeTestPart(client, `TEST-GRN-SMALL-${stamp}`, brand.brand_id, group.group_id);
    const heavyPartId = await makeTestPart(client, `TEST-GRN-HEAVY-${stamp}`, brand.brand_id, group.group_id);

    // ── A draft: mixed shipment, freight with a heavy-item override ────────
    console.log('\nDraft stage — nothing may touch stock, bills or the ledger');

    const draftNumber = await getNextDocumentNumber(client, 'GRD');
    const { rows: [draft] } = await client.query(
      `INSERT INTO goods_receipt (grn_number, supplier_id, received_by, workflow_status, freight_amount,
                                  freight_allocation_method, freight_supplier_id, overall_discount_percent,
                                  sync_retail_prices, created_by)
       VALUES ($1, $2, $3, 'Draft', 1000, 'METHOD_A', $4, 10, true, $3)
       RETURNING grn_id`,
      [draftNumber, supplier.supplier_id, employee.employee_id, carrier.supplier_id],
    );
    const grnId = draft.grn_id;

    const draftLines = [
      { part_id: smallPartId, quantity: 20, cost_price: 50, override_freight_amount: null },
      { part_id: heavyPartId, quantity: 4, cost_price: 750, override_freight_amount: 600 },
    ];
    const costing = computeCosting({
      lines: draftLines,
      freightAmount: 1000,
      overallDiscountPercent: 10,
    });

    for (const [i, line] of draftLines.entries()) {
      const c = costing.lines[i];
      await client.query(
        `INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, sale_price,
                                         override_freight_amount, allocated_freight_amount,
                                         landed_unit_cost, effective_markup_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [grnId, line.part_id, line.quantity, line.cost_price, c.sale_price,
         line.override_freight_amount, c.allocated_freight_amount, c.landed_unit_cost,
         c.effective_markup_percent],
      );
    }

    const draftStock = await client.query(
      'SELECT COUNT(*)::int AS n FROM inventory_transaction WHERE part_id = ANY($1::int[])',
      [[smallPartId, heavyPartId]],
    );
    assert(draftStock.rows[0].n === 0, 'a draft creates no inventory transactions');

    const draftBills = await client.query('SELECT COUNT(*)::int AS n FROM supplier_bill WHERE grn_id = $1', [grnId]);
    assert(draftBills.rows[0].n === 0, 'a draft creates no supplier bill');

    const { rows: [draftWac] } = await client.query('SELECT wac_cost, last_sale_price FROM part WHERE part_id = $1', [smallPartId]);
    assert(Number(draftWac.wac_cost) === 0, 'a draft does not move weighted average cost');
    assert(Number(draftWac.last_sale_price) === 999, 'a draft does not touch the catalogue price');

    // ── Submit, then post ──────────────────────────────────────────────────
    console.log('\nSubmit, then post');
    await client.query(
      `UPDATE goods_receipt SET workflow_status = 'Submitted', submitted_by = $1, submitted_at = CURRENT_TIMESTAMP
       WHERE grn_id = $2`, [employee.employee_id, grnId],
    );

    const grnNumber = await getNextDocumentNumber(client, 'GRN');
    await client.query(
      `UPDATE goods_receipt SET grn_number = $1, workflow_status = 'Posted', posted_by = $2,
                                posted_at = CURRENT_TIMESTAMP WHERE grn_id = $3`,
      [grnNumber, employee.employee_id, grnId],
    );

    const { billId, freightBillId } = await postReceipt(client, {
      grnId,
      grnNumber,
      supplierId: supplier.supplier_id,
      employeeId: employee.employee_id,
      lines: draftLines.map((l, i) => ({
        part_id: l.part_id,
        quantity: l.quantity,
        return_quantity: 0,
        cost_price: l.cost_price,
        landed_unit_cost: costing.lines[i].landed_unit_cost,
      })),
      freightAmount: 1000,
      freightSupplierId: carrier.supplier_id,
      netGoodsValue: costing.totals.net_goods_value,
    });

    // Landed cost, not the supplier's price, is what inventory records.
    const { rows: [smallTxn] } = await client.query(
      `SELECT quantity, unit_cost FROM inventory_transaction
       WHERE part_id = $1 AND reference_no = $2 AND trans_type = 'StockIn'`,
      [smallPartId, grnNumber],
    );
    const expectedSmallLanded = costing.lines[0].landed_unit_cost;
    assert(smallTxn && near(smallTxn.unit_cost, expectedSmallLanded),
      `small part stocked in at its landed cost ${expectedSmallLanded} (got ${smallTxn?.unit_cost})`);
    assert(Number(smallTxn.quantity) === 20, 'the full accepted quantity was stocked in');

    const { rows: [heavyTxn] } = await client.query(
      `SELECT unit_cost FROM inventory_transaction
       WHERE part_id = $1 AND reference_no = $2 AND trans_type = 'StockIn'`,
      [heavyPartId, grnNumber],
    );
    assert(near(heavyTxn.unit_cost, costing.lines[1].landed_unit_cost),
      'the heavy item carries its flat freight override, not a share by value');
    assert(Number(heavyTxn.unit_cost) > 750,
      'the heavy item costs more than the supplier charged, because freight was capitalised');

    // The trigger has to arrive at the same number the JavaScript did.
    const { rows: [smallPart] } = await client.query(
      'SELECT wac_cost, last_cost, last_sale_price FROM part WHERE part_id = $1', [smallPartId],
    );
    assert(near(smallPart.wac_cost, expectedSmallLanded),
      `the WAC trigger produced the landed cost (${smallPart.wac_cost} vs ${expectedSmallLanded})`);
    assert(near(smallPart.last_sale_price, costing.lines[0].sale_price),
      'the catalogue price was synced from the receipt, because sync_retail_prices was set');

    // ── Two payables: the parts supplier's, and the carrier's ──────────────
    console.log('\nPayables');
    assert(!!billId && !!freightBillId, 'both a goods bill and a freight bill were created');

    const { rows: [goodsBill] } = await client.query(
      'SELECT supplier_id, total_amount FROM supplier_bill WHERE bill_id = $1', [billId],
    );
    assert(goodsBill.supplier_id === supplier.supplier_id, 'the goods bill is against the parts supplier');
    assert(near(goodsBill.total_amount, costing.totals.net_goods_value),
      `the goods bill is the discounted goods value ${costing.totals.net_goods_value} (got ${goodsBill.total_amount})`);

    const { rows: [freightBill] } = await client.query(
      'SELECT supplier_id, total_amount FROM supplier_bill WHERE bill_id = $1', [freightBillId],
    );
    assert(freightBill.supplier_id === carrier.supplier_id, 'the freight bill is against the carrier, not the parts supplier');
    assert(near(freightBill.total_amount, 1000), 'the freight bill is the full delivery charge');

    const { rows: ledger } = await client.query(
      `SELECT entry_type, amount, supplier_id FROM ap_ledger
       WHERE bill_id IN ($1, $2) ORDER BY ledger_id`, [billId, freightBillId],
    );
    assert(ledger.length === 2 && ledger.every((l) => l.entry_type === 'BILL_POSTED'),
      'both payables opened with a BILL_POSTED entry');
    assert(near(ledger.reduce((s, l) => s + Number(l.amount), 0), costing.totals.net_goods_value + 1000),
      'the liability posted equals the goods plus the freight');

    const { rows: [backlinks] } = await client.query(
      'SELECT bill_id, freight_bill_id FROM goods_receipt WHERE grn_id = $1', [grnId],
    );
    assert(backlinks.bill_id === billId && backlinks.freight_bill_id === freightBillId,
      'the receipt is back-linked to both of its bills');

    // ── A return after posting ─────────────────────────────────────────────
    console.log('\nReturn after posting');
    const returnQty = 2;
    const { rows: [heavyLine] } = await client.query(
      'SELECT grn_line_id, landed_unit_cost, cost_price FROM goods_receipt_line WHERE grn_id = $1 AND part_id = $2',
      [grnId, heavyPartId],
    );

    await client.query(
      `INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
       VALUES ($1, 'StockOut', $2, $3, $4, $5, 'RETURN TO SUPPLIER: Damaged')`,
      [heavyPartId, -returnQty, heavyLine.landed_unit_cost, grnNumber, employee.employee_id],
    );
    await client.query(
      'UPDATE goods_receipt_line SET return_quantity = $1, rejection_reason = $2 WHERE grn_line_id = $3',
      [returnQty, 'Damaged', heavyLine.grn_line_id],
    );
    await recomputeWacForParts(client, [heavyPartId]);

    const creditAmount = Math.round(returnQty * Number(heavyLine.cost_price) * 0.9 * 100) / 100;
    await client.query('UPDATE supplier_bill SET total_amount = total_amount - $1 WHERE bill_id = $2',
      [creditAmount, billId]);
    await apLedgerService.appendEntry(client, {
      supplierId: supplier.supplier_id,
      billId,
      entryType: 'RETURN_CREDIT',
      amount: -creditAmount,
      referenceNo: grnNumber,
      notes: 'Return on goods receipt: Damaged',
      createdBy: employee.employee_id,
    });

    const { rows: [onHand] } = await client.query(
      'SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_transaction WHERE part_id = $1', [heavyPartId],
    );
    assert(Number(onHand.qty) === 4 - returnQty, 'the returned units left stock');

    const { rows: [creditEntry] } = await client.query(
      `SELECT entry_type, amount, balance_after FROM ap_ledger
       WHERE bill_id = $1 ORDER BY ledger_id DESC LIMIT 1`, [billId],
    );
    assert(creditEntry.entry_type === 'RETURN_CREDIT', 'the return is recorded as RETURN_CREDIT, distinguishable from a void or a write-down');
    assert(Number(creditEntry.amount) < 0, 'the return reduces the liability');
    assert(near(creditEntry.amount, -creditAmount), `the credit is the discounted goods value of the returned units (${creditAmount})`);

    // ── A receipt that opts out of price sync ──────────────────────────────
    console.log('\nA receipt that leaves shelf prices alone');
    const quietPartId = await makeTestPart(client, `TEST-GRN-QUIET-${stamp}`, brand.brand_id, group.group_id);
    const quietNumber = await getNextDocumentNumber(client, 'GRN');
    const { rows: [quietGrn] } = await client.query(
      `INSERT INTO goods_receipt (grn_number, supplier_id, received_by, workflow_status, sync_retail_prices, created_by)
       VALUES ($1, $2, $3, 'Posted', false, $3) RETURNING grn_id`,
      [quietNumber, supplier.supplier_id, employee.employee_id],
    );
    await client.query(
      `INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, sale_price, landed_unit_cost)
       VALUES ($1, $2, 10, 200, 340, 200)`,
      [quietGrn.grn_id, quietPartId],
    );
    await client.query(
      `INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
       VALUES ($1, 'StockIn', 10, 200, $2, $3)`,
      [quietPartId, quietNumber, employee.employee_id],
    );

    const { rows: [quietPart] } = await client.query(
      'SELECT wac_cost, last_sale_price FROM part WHERE part_id = $1', [quietPartId],
    );
    assert(near(quietPart.wac_cost, 200), 'cost still updates when price sync is off');
    assert(Number(quietPart.last_sale_price) === 999,
      'the catalogue price was left untouched, because sync_retail_prices was false');

    // ── Constraints the database itself has to enforce ─────────────────────
    console.log('\nDatabase-level guards');
    let rejected = false;
    try {
      await client.query('SAVEPOINT c1');
      await client.query(
        `INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, return_quantity)
         VALUES ($1, $2, 5, 100, 9)`, [quietGrn.grn_id, quietPartId],
      );
    } catch { rejected = true; } finally { await client.query('ROLLBACK TO SAVEPOINT c1'); }
    assert(rejected, 'the database refuses a return larger than the quantity received');

    rejected = false;
    try {
      await client.query('SAVEPOINT c2');
      await client.query(
        `INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, line_discount_percent, line_discount_amount)
         VALUES ($1, $2, 5, 100, 10, 10)`, [quietGrn.grn_id, quietPartId],
      );
    } catch { rejected = true; } finally { await client.query('ROLLBACK TO SAVEPOINT c2'); }
    assert(rejected, 'the database refuses both a percentage and an amount discount on one line');

    rejected = false;
    try {
      await client.query('SAVEPOINT c3');
      await client.query(
        `UPDATE goods_receipt SET workflow_status = 'Approved' WHERE grn_id = $1`, [quietGrn.grn_id],
      );
    } catch { rejected = true; } finally { await client.query('ROLLBACK TO SAVEPOINT c3'); }
    assert(rejected, 'the database refuses a workflow status outside the state machine');

    // A cancelled draft must release the supplier invoice number it was holding.
    await client.query(
      `UPDATE goods_receipt SET supplier_invoice_no = $1, workflow_status = 'Cancelled' WHERE grn_id = $2`,
      [`SI-${stamp}`, quietGrn.grn_id],
    );
    let reusable = true;
    try {
      await client.query('SAVEPOINT c4');
      const n = await getNextDocumentNumber(client, 'GRN');
      await client.query(
        `INSERT INTO goods_receipt (grn_number, supplier_id, received_by, supplier_invoice_no)
         VALUES ($1, $2, $3, $4)`,
        [n, supplier.supplier_id, employee.employee_id, `SI-${stamp}`],
      );
    } catch { reusable = false; } finally { await client.query('ROLLBACK TO SAVEPOINT c4'); }
    assert(reusable, 'a cancelled receipt releases its supplier invoice number for re-entry');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await db.pool?.end?.().catch(() => {});
  }

  console.log(failures === 0
    ? '\nAll goods receipt integration checks passed.'
    : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nIntegration test crashed:', err);
  process.exit(1);
});
