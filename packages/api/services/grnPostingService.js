'use strict';

/**
 * Everything that happens when a goods receipt is POSTED, in one place.
 *
 * This was previously inlined in POST /goods-receipts. Extracting it means the
 * one-shot create-and-post path and the new draft → submit → post path run exactly the
 * same code, so they cannot drift the way POST and PUT already had. It also makes the
 * workflow guarantee structural rather than conventional: a Draft or Submitted receipt
 * has no financial effect because nothing outside this function writes stock, bills or
 * ledger entries, and only the post transition calls it.
 *
 * The caller MUST have already issued BEGIN on the client and must own the COMMIT.
 */

const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const apLedgerService = require('./apLedgerService');
const stockReconciliation = require('./stockReconciliationService');
const { recomputeWacForParts } = require('./transactionDateService');

/**
 * Create a supplier bill and its opening ap_ledger entry.
 *
 * Returns null when the ON CONFLICT guard fires — the partial unique index on
 * supplier_bill.grn_id (20260813_04) makes goods bills idempotent under retry. The
 * freight bill has no such index because a receipt may legitimately have two bills, so
 * it is guarded by goods_receipt.freight_bill_id already being set instead.
 */
async function createBillWithLedger(client, {
  supplierId, poId = null, grnId = null, totalAmount, receiptDate, createdBy, notes, backlink = null,
}) {
  const { rows: [supplier] } = await client.query(
    'SELECT payment_terms_days FROM supplier WHERE supplier_id = $1', [supplierId],
  );
  const termsDays = supplier?.payment_terms_days || null;
  const billNumber = await getNextDocumentNumber(client, 'BILL');

  const { rows: [bill] } = await client.query(
    `INSERT INTO supplier_bill (supplier_id, po_id, grn_id, bill_number, bill_date, due_date, total_amount, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($8::date, CURRENT_DATE),
             CASE WHEN $5::int IS NOT NULL THEN COALESCE($8::date, CURRENT_DATE) + ($5::int || ' days')::interval ELSE NULL END,
             $6, $7)
     ON CONFLICT (grn_id) WHERE grn_id IS NOT NULL DO NOTHING
     RETURNING bill_id`,
    [supplierId, poId, grnId, billNumber, termsDays, totalAmount, createdBy, receiptDate],
  );

  if (!bill) return null;

  // Back-link before the ledger entry: goods_receipt.bill_id / .freight_bill_id are the
  // authoritative "which document does this payable belong to" pointers (used by
  // GET /ap/supplier-bills/:billId/items), and they should be in place before anything
  // downstream can observe the liability.
  if (backlink) {
    await client.query(
      `UPDATE goods_receipt SET ${backlink.column} = $1 WHERE grn_id = $2`,
      [bill.bill_id, backlink.grnId],
    );
  }

  await apLedgerService.appendEntry(client, {
    supplierId,
    billId: bill.bill_id,
    entryType: 'BILL_POSTED',
    amount: totalAmount,
    referenceNo: billNumber,
    notes,
    createdBy,
    entryDate: receiptDate || null,
  });

  return { bill_id: bill.bill_id, bill_number: billNumber };
}

/**
 * Post a goods receipt: stock in, purchase order, payables, price sync, WAC.
 *
 * @param {import('pg').PoolClient} client — inside an open transaction
 * @param {object} receipt
 * @param {number}  receipt.grnId
 * @param {string}  receipt.grnNumber
 * @param {number}  receipt.supplierId
 * @param {number}  receipt.employeeId          — recorded on the inventory transactions
 * @param {Array}   receipt.lines               — each `{ part_id, quantity, return_quantity,
 *                                                 cost_price, landed_unit_cost }`; landed cost
 *                                                 is what reaches inventory
 * @param {number|null} receipt.poId
 * @param {number|null} receipt.billId          — attaching to a pre-existing payable
 * @param {boolean} receipt.isBackfill
 * @param {string|null} receipt.receiptDate     — ISO; null means "now"
 * @param {string|null} receipt.supplierInvoiceNo
 * @param {number}  receipt.freightAmount
 * @param {number|null} receipt.freightSupplierId
 * @param {number}  receipt.netGoodsValue       — after discounts and returns; what is owed
 * @returns {Promise<{billId: number|null, freightBillId: number|null, reconciliations: object[]}>}
 */
async function postReceipt(client, {
  grnId,
  grnNumber,
  supplierId,
  employeeId,
  lines,
  poId = null,
  billId = null,
  isBackfill = false,
  receiptDate = null,
  supplierInvoiceNo = null,
  freightAmount = 0,
  freightSupplierId = null,
  netGoodsValue,
}) {
  // ── Stock ─────────────────────────────────────────────────────────────────
  // Quantity is what was actually accepted; anything rejected at the dock never
  // entered the building and must not enter the ledger either.
  for (const line of lines) {
    const acceptedQty = Number(line.quantity) - Number(line.return_quantity || 0);
    if (acceptedQty <= 0) continue;

    await client.query(
      `INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, transaction_date)
       VALUES ($1, 'StockIn', $2, $3, $4, $5, COALESCE($6::timestamptz, CURRENT_TIMESTAMP))`,
      // landed_unit_cost is authoritative, null included: a line whose cost was never
      // recorded posts NULL so recompute_wac_for_part() skips it rather than averaging
      // it in as zero. Falling back to cost_price here would reintroduce that exact bug.
      [line.part_id, acceptedQty, line.landed_unit_cost ?? null, grnNumber, employeeId, receiptDate],
    );

    if (poId && !isBackfill) {
      await client.query(
        `UPDATE purchase_order_line SET quantity_received = quantity_received + $1 WHERE po_id = $2 AND part_id = $3`,
        [acceptedQty, poId, line.part_id],
      );
    }
  }

  // ── Purchase order status ─────────────────────────────────────────────────
  if (poId && !isBackfill) {
    const { rows: [totals] } = await client.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total_ordered, COALESCE(SUM(quantity_received), 0) AS total_received
       FROM purchase_order_line WHERE po_id = $1`,
      [poId],
    );
    const newStatus = parseFloat(totals.total_received) >= parseFloat(totals.total_ordered)
      ? 'Received'
      : 'Partially Received';
    await client.query('UPDATE purchase_order SET status = $1 WHERE po_id = $2', [newStatus, poId]);
  }

  // ── Payables ──────────────────────────────────────────────────────────────
  // A backfill never posts a payable: the goods it records were paid for long ago, so
  // auto-creating a bill would overstate what is owed.
  let goodsBillId = billId || null;
  if (netGoodsValue > 0 && !billId && !isBackfill) {
    const bill = await createBillWithLedger(client, {
      supplierId,
      poId,
      grnId,
      totalAmount: netGoodsValue,
      receiptDate,
      createdBy: employeeId,
      notes: `Auto-posted from goods receipt ${grnNumber}`,
      backlink: { column: 'bill_id', grnId },
    });
    if (bill) goodsBillId = bill.bill_id;
  }

  // Freight is owed to the carrier, not to the parts supplier, so it gets its own bill
  // against its own supplier rather than inflating the goods payable. The cost still
  // reaches inventory — that happened above, through each line's landed unit cost.
  let freightBillId = null;
  if (Number(freightAmount) > 0 && freightSupplierId && !isBackfill) {
    const { rows: [existing] } = await client.query(
      'SELECT freight_bill_id FROM goods_receipt WHERE grn_id = $1', [grnId],
    );
    if (!existing?.freight_bill_id) {
      const bill = await createBillWithLedger(client, {
        supplierId: freightSupplierId,
        poId: null,
        grnId: null, // the grn_id slot is claimed by the goods bill's idempotency index
        totalAmount: Number(freightAmount),
        receiptDate,
        createdBy: employeeId,
        notes: `Freight-in for goods receipt ${grnNumber}`,
        backlink: { column: 'freight_bill_id', grnId },
      });
      if (bill) freightBillId = bill.bill_id;
    } else {
      freightBillId = existing.freight_bill_id;
    }
  }

  // ── Backfill reconciliation ───────────────────────────────────────────────
  // A backfilled receipt dated before an approved cycle count describes stock that
  // count already recorded. Give it its cost effect but cancel its quantity, so the
  // same units are not counted twice.
  const reconciliations = [];
  if (isBackfill) {
    for (const line of lines) {
      const acceptedQty = Number(line.quantity) - Number(line.return_quantity || 0);
      if (acceptedQty <= 0) continue;
      const recon = await stockReconciliation.reconcileBackfillLine(client, {
        partId: line.part_id,
        quantity: acceptedQty,
        receiptDate,
        grnId,
        grnNumber,
        supplierInvoiceNo,
        employeeId,
      });
      if (recon) reconciliations.push(recon);
    }
  }

  // Receiving stock at a real cost is what resolves a quick-added part's missing cost,
  // so clear the flag that put it in the costing queue.
  const partIds = [...new Set(lines.map((l) => l.part_id))];
  await client.query(
    `DELETE FROM part_tag
      WHERE part_id = ANY($1::int[])
        AND tag_id = (SELECT tag_id FROM tag WHERE tag_name = 'pending_costing')`,
    [partIds],
  );

  // ── WAC ───────────────────────────────────────────────────────────────────
  // The trg_update_wac trigger derives prev_stock from the SUM of all other rows
  // regardless of their dates, so it only produces the right average when the new
  // StockIn is the latest one. A backdated receipt lands mid-history and needs the full
  // chronological replay instead.
  if (receiptDate) {
    const impacts = await recomputeWacForParts(client, partIds);
    if (reconciliations.length > 0) {
      const wacByPart = new Map(impacts.map((i) => [i.part_id, i.new_wac_cost]));
      await stockReconciliation.recordWacAfter(client, reconciliations, wacByPart);
    }
  }

  return { billId: goodsBillId, freightBillId, reconciliations };
}

module.exports = { postReceipt, createBillWithLedger };
