const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { hasPermission, protect } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const apLedgerService = require('../services/apLedgerService');
const periodLockService = require('../services/periodLockService');
const { recomputeWacForParts } = require('../services/transactionDateService');
const grnCosting = require('../services/grnCostingService');
const grnWorkflow = require('../services/grnWorkflowService');
const { postReceipt } = require('../services/grnPostingService');
const router = express.Router();

// Shape a request's line payload into what grnCostingService expects, and back again.
// The API and the DB use snake_case column names throughout, so the costing service
// speaks the same names rather than inventing a second vocabulary.
function costingInputFromLines(lines) {
  return lines.map((l) => ({
    quantity: l.quantity,
    cost_price: l.cost_price,
    return_quantity: l.return_quantity || 0,
    line_discount_percent: l.line_discount_percent ?? null,
    line_discount_amount: l.line_discount_amount ?? null,
    override_freight_amount: l.override_freight_amount ?? null,
    effective_markup_percent: l.effective_markup_percent ?? null,
    sale_price: l.sale_price ?? null,
  }));
}

// A user-entered sale price is authoritative and is never silently overwritten — a
// re-opened draft must not have someone's deliberate pricing recomputed out from under
// them. Lines that carry no price yet still get one derived at the default markup, so
// nothing is left unpriced.
function costingForPayload(header, lines) {
  return grnCosting.computeCosting({
    lines: costingInputFromLines(lines),
    freightAmount: header.freight_amount || 0,
    freightMethod: header.freight_allocation_method || grnCosting.METHOD_A,
    overallDiscountPercent: header.overall_discount_percent ?? null,
    overallDiscountAmount: header.overall_discount_amount ?? null,
    recomputeSalePrice: false,
  });
}

// Costing errors are the user's data being contradictory (two kinds of discount on one
// line, overrides exceeding the freight), not server faults. Surface them as 400s with
// the specific message rather than a generic failure.
function assertCostingValid(costing) {
  if (costing.errors.length > 0) {
    const err = new Error(costing.errors.map((e) => e.message).join(' '));
    err.statusCode = 400;
    throw err;
  }
}

// The 30% floor is advisory while typing and blocking at post: a draft may legitimately
// be half-priced mid-entry, but a posted receipt writes those prices to the catalogue.
function assertMarkupFloor(costing) {
  const below = costing.warnings.filter((w) => w.code === 'BELOW_MIN_MARKUP');
  if (below.length > 0) {
    const err = new Error(`${below.map((w) => w.message).join(' ')} Adjust the prices before posting.`);
    err.statusCode = 400;
    throw err;
  }
}

// GET /goods-receipts - Fetch list of posted GRNs with search and sorting
router.get('/goods-receipts', protect, hasPermission('goods_receipt:create'), async (req, res) => {
  const { q: search = '', sortBy = 'receipt_date', sortOrder = 'desc' } = req.query;
  // Receipt history means posted documents. Drafts live behind their own review queue
  // (GET /goods-receipts/drafts) and must not appear here, where every row is assumed
  // to have already moved stock.
  const workflowStatus = req.query.workflow_status || grnWorkflow.POSTED;
  if (workflowStatus !== 'all' && !grnWorkflow.STATUSES.includes(workflowStatus)) {
    return res.status(400).json({ message: 'Invalid workflow_status parameter' });
  }
  const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);

  // Validate sortBy and sortOrder
  const allowedSortBy = ['receipt_date', 'supplier_name', 'grn_number'];
  const allowedSortOrder = ['asc', 'desc'];
  if (!allowedSortBy.includes(sortBy)) {
    return res.status(400).json({ message: 'Invalid sortBy parameter' });
  }
  if (!allowedSortOrder.includes(sortOrder)) {
    return res.status(400).json({ message: 'Invalid sortOrder parameter' });
  }

  try {
    let query = `
      SELECT
        gr.grn_id,
        gr.grn_number,
        gr.receipt_date,
        gr.status,
        gr.workflow_status,
        gr.freight_amount,
        gr.overall_discount_percent,
        gr.overall_discount_amount,
        gr.voided_at,
        gr.void_reason,
        gr.is_backfill,
        gr.supplier_invoice_no,
        s.supplier_name,
        CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
        CASE WHEN gr.voided_by IS NOT NULL THEN CONCAT(ve.first_name, ' ', ve.last_name) END AS voided_by_name
      FROM goods_receipt gr
      JOIN supplier s ON gr.supplier_id = s.supplier_id
      JOIN employee e ON gr.received_by = e.employee_id
      LEFT JOIN employee ve ON gr.voided_by = ve.employee_id
    `;

    const params = [];
    let paramIndex = 1;

    if (workflowStatus === 'all') {
      query += ' WHERE TRUE';
    } else {
      query += ` WHERE gr.workflow_status = $${paramIndex}`;
      params.push(workflowStatus);
      paramIndex += 1;
    }

    if (search) {
      query += `
        AND (gr.grn_number ILIKE $${paramIndex}
           OR s.supplier_name ILIKE $${paramIndex + 1}
           OR EXISTS (
             SELECT 1 FROM goods_receipt_line grl
             JOIN part p ON grl.part_id = p.part_id
             LEFT JOIN brand b ON p.brand_id = b.brand_id
             LEFT JOIN "group" g ON p.group_id = g.group_id
             LEFT JOIN part_number pn ON pn.part_id = p.part_id
             WHERE grl.grn_id = gr.grn_id
               AND (pn.part_number ILIKE $${paramIndex + 2}
                    OR p.detail ILIKE $${paramIndex + 2}
                    OR p.internal_sku ILIKE $${paramIndex + 2}
                    OR b.brand_name ILIKE $${paramIndex + 2}
                    OR g.group_name ILIKE $${paramIndex + 2})
           ))
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIndex += 3;
    }

    query += ` ORDER BY ${sortBy} ${sortOrder}`;

    if (!paginated) {
      const { rows } = await db.query(query, params);
      return res.json(rows);
    }

    const countQuery = `SELECT COUNT(*)::int AS total FROM (${query}) as grn_results`;
    const countRes = await db.query(countQuery, params);
    const total = countRes.rows[0]?.total || 0;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const paginatedParams = [...params, limit, offset];
    const { rows } = await db.query(query, paginatedParams);
    res.json(paginatedResponse({ data: rows, page, pageSize, total }));
  } catch (err) {
    console.error('Error fetching goods receipts:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /goods-receipts/:id/lines - Fetch line items for a specific GRN
router.get('/goods-receipts/:id/lines', protect, hasPermission('goods_receipt:create'), async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT
        grl.grn_line_id,
        grl.quantity,
        grl.cost_price,
        grl.sale_price,
        grl.line_discount_percent,
        grl.line_discount_amount,
        grl.override_freight_amount,
        grl.allocated_freight_amount,
        grl.landed_unit_cost,
        grl.effective_markup_percent,
        grl.return_quantity,
        grl.rejection_reason,
        grl.part_id AS part_id,
        p.internal_sku,
        CASE
          WHEN pn.part_number IS NOT NULL THEN
            CASE
              WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN CONCAT(g.group_name, ' (', b.brand_name, ') | ', pn.part_number)
              WHEN g.group_name IS NOT NULL THEN CONCAT(g.group_name, ' | ', pn.part_number)
              WHEN b.brand_name IS NOT NULL THEN CONCAT(b.brand_name, ' | ', pn.part_number)
              ELSE pn.part_number
            END
          ELSE
            CASE
              WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN CONCAT(g.group_name, ' (', b.brand_name, ') | ', p.internal_sku)
              WHEN g.group_name IS NOT NULL THEN CONCAT(g.group_name, ' | ', p.internal_sku)
              WHEN b.brand_name IS NOT NULL THEN CONCAT(b.brand_name, ' | ', p.internal_sku)
              ELSE p.internal_sku
            END
        END ||
        CASE WHEN p.detail IS NOT NULL AND p.detail != '' THEN ' | ' || p.detail ELSE '' END AS display_name,
        p.detail
      FROM goods_receipt_line grl
      JOIN part p ON grl.part_id = p.part_id
      LEFT JOIN brand b ON p.brand_id = b.brand_id
      LEFT JOIN "group" g ON p.group_id = g.group_id
      LEFT JOIN part_number pn ON pn.part_id = p.part_id AND pn.display_order = (
        SELECT MIN(pn2.display_order) FROM part_number pn2 WHERE pn2.part_id = p.part_id
      )
      WHERE grl.grn_id = $1
      ORDER BY grl.grn_line_id
    `;

    const { rows } = await db.query(query, [id]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching GRN lines:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /goods-receipts - Create a new Goods Receipt
router.post('/goods-receipts', protect, hasPermission('goods_receipt:create'), async (req, res) => {
  // NEW: Added po_id to destructuring
  // bill_id: optional — attaches this receipt's stock-in to a pre-existing manually
  // created supplier_bill (see AddPayableModal) instead of auto-generating a new bill.
  // receipt_date: optional true date the goods physically arrived. Paperwork is often
  // entered days late, and stamping those receipts "now" puts the StockIn *after* sales
  // that already consumed the stock — which corrupts the chronological replay that
  // recompute_wac_for_part() uses to derive WAC. Letting the receipt carry its real date
  // keeps the ledger in physical order. Defaults to now when omitted.
  // is_backfill: this document records a delivery that already happened and was never
  // entered. It posts stock and cost exactly like a receipt — that is the point, since
  // WAC is replayed from the StockIn history — but creates no payable and touches no
  // purchase order, because the goods were paid for long ago and no open PO is waiting
  // on them.
  //
  // freight_amount / freight_supplier_id: the delivery charge for this shipment and the
  // carrier it is owed to. Freight is capitalised into each line's landed cost — which is
  // what reaches inventory and therefore WAC — while the payable for it goes on its own
  // bill against the carrier, because the parts supplier did not charge it.
  // overall_discount_*, and the per-line discounts, are applied in a fixed order:
  // unit cost → line discounts → freight → header discount → landed cost.
  // sync_retail_prices: whether posting should push each line's sale_price to the parts
  // catalogue. Default true, matching the long-standing behaviour of the WAC trigger.
  const { supplier_id, received_by, lines, po_id, bill_id, receipt_date,
          is_backfill, supplier_invoice_no,
          freight_amount, freight_allocation_method, freight_supplier_id,
          overall_discount_percent, overall_discount_amount, sync_retail_prices } = req.body;

  if (!supplier_id || !received_by || !lines || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const isBackfill = !!is_backfill;
  const invoiceNo = supplier_invoice_no ? String(supplier_invoice_no).trim() : null;
  const freightAmount = Number(freight_amount) > 0 ? Number(freight_amount) : 0;
  const freightMethod = freight_allocation_method || grnCosting.METHOD_A;
  const freightSupplierId = freight_supplier_id || null;
  const overallDiscountPercent = overall_discount_percent ?? null;
  const overallDiscountAmount = overall_discount_amount ?? null;
  const syncRetailPrices = sync_retail_prices === undefined ? true : !!sync_retail_prices;

  // Freight with nobody to pay it would silently vanish from accounts payable while
  // still inflating inventory. Make the encoder name the carrier.
  if (freightAmount > 0 && !freightSupplierId && !isBackfill) {
    return res.status(400).json({ message: 'Select the carrier the freight is owed to, so the delivery charge can be billed.' });
  }

  if (isBackfill) {
    if (!receipt_date) {
      return res.status(400).json({ message: 'A historical receipt needs the date the goods actually arrived.' });
    }
    // The supplier's own document number is what makes re-entering the same invoice
    // detectable. Without it there is nothing to match a duplicate against.
    if (!invoiceNo) {
      return res.status(400).json({ message: "Enter the supplier's invoice or delivery receipt number so the same document cannot be recorded twice." });
    }
    if (po_id) {
      return res.status(400).json({ message: 'A historical receipt cannot be received against a purchase order.' });
    }
  }

  let receiptDate = null;
  if (receipt_date) {
    const parsed = new Date(receipt_date);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ message: 'receipt_date is not a valid date.' });
    }
    if (parsed.getTime() > Date.now()) {
      return res.status(400).json({ message: 'receipt_date cannot be in the future.' });
    }
    try {
      await periodLockService.assertPeriodOpen(parsed, { module: 'goods_receipt' });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ message: err.message });
    }
    receiptDate = parsed.toISOString();
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    if (bill_id) {
      const { rows: [bill] } = await client.query(
        `SELECT bill_id FROM supplier_bill WHERE bill_id = $1 AND supplier_id = $2 AND status != 'Paid'`,
        [bill_id, supplier_id]
      );
      if (!bill) {
        throw new Error('The selected payable was not found for this supplier, or is already fully paid.');
      }
    }

    const grn_number = await getNextDocumentNumber(client, 'GRN');

    // Freight and discounts are computed before anything is written, so the landed
    // unit cost that reaches inventory is the same figure the encoder saw on screen.
    const costing = costingForPayload({
      freight_amount: freightAmount,
      freight_allocation_method: freightMethod,
      overall_discount_percent: overallDiscountPercent,
      overall_discount_amount: overallDiscountAmount,
    }, lines);
    assertCostingValid(costing);
    // Deliberately NOT enforcing the markup floor here. This endpoint is the
    // long-standing one-shot path used by the A/P attach-items flow and PO receiving,
    // and rejecting a receipt it would previously have accepted would break them. The
    // floor is enforced where prices are actually being reviewed: POST .../post.
    const markupWarnings = costing.warnings.filter((w) => w.code === 'BELOW_MIN_MARKUP');

    const goodsReceiptQuery = `
      INSERT INTO goods_receipt (grn_number, supplier_id, received_by, bill_id, po_id, receipt_date,
                                 is_backfill, supplier_invoice_no, workflow_status, freight_amount,
                                 freight_allocation_method, freight_supplier_id, overall_discount_percent,
                                 overall_discount_amount, sync_retail_prices, created_by, posted_by, posted_at)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, CURRENT_TIMESTAMP), $7, $8, 'Posted',
              $9, $10, $11, $12, $13, $14, $3, $3, CURRENT_TIMESTAMP)
      RETURNING grn_id;
    `;
    const receiptResult = await client.query(goodsReceiptQuery, [grn_number, supplier_id, received_by,
      isBackfill ? null : (bill_id || null), isBackfill ? null : (po_id || null), receiptDate, isBackfill, invoiceNo,
      freightAmount, freightMethod, isBackfill ? null : freightSupplierId,
      overallDiscountPercent, overallDiscountAmount, syncRetailPrices]);
    const newGrnId = receiptResult.rows[0].grn_id;

    const postedLines = [];
    for (const [index, line] of lines.entries()) {
      const { part_id, quantity, cost_price, sale_price } = line;
      if (!part_id || !quantity || !cost_price) {
        throw new Error('Each line item must have part_id, quantity, and cost_price.');
      }
      // Numeric validation matching the PUT handler below. The falsy checks above let
      // negatives through, and a negative unit_cost feeds straight into the WAC average.
      const qty = Number(quantity);
      const cost = Number(cost_price);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('Each line item must have a quantity greater than zero.');
      }
      if (!Number.isFinite(cost) || cost <= 0) {
        throw new Error('Each line item must have a cost_price greater than zero.');
      }
      if (sale_price != null && (!Number.isFinite(Number(sale_price)) || Number(sale_price) < 0)) {
        throw new Error('sale_price cannot be negative.');
      }

      const computed = costing.lines[index];
      const lineQuery = `
        INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, sale_price,
                                        line_discount_percent, line_discount_amount, override_freight_amount,
                                        allocated_freight_amount, landed_unit_cost, effective_markup_percent,
                                        return_quantity, rejection_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
      `;
      await client.query(lineQuery, [newGrnId, part_id, quantity, cost_price, computed.sale_price,
        line.line_discount_percent ?? null, line.line_discount_amount ?? null, line.override_freight_amount ?? null,
        computed.allocated_freight_amount, computed.landed_unit_cost, computed.effective_markup_percent,
        computed.return_quantity, line.rejection_reason || null]);

      postedLines.push({
        part_id,
        quantity,
        return_quantity: computed.return_quantity,
        cost_price,
        landed_unit_cost: computed.landed_unit_cost,
      });
    }

    const { reconciliations } = await postReceipt(client, {
      grnId: newGrnId,
      grnNumber: grn_number,
      supplierId: supplier_id,
      employeeId: received_by,
      lines: postedLines,
      poId: isBackfill ? null : (po_id || null),
      billId: isBackfill ? null : (bill_id || null),
      isBackfill,
      receiptDate,
      supplierInvoiceNo: invoiceNo,
      freightAmount,
      freightSupplierId: isBackfill ? null : freightSupplierId,
      netGoodsValue: costing.totals.net_goods_value,
    });

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Goods receipt created successfully',
      grn_id: newGrnId,
      totals: costing.totals,
      warnings: markupWarnings,
      // Surfaced so the encoder is told what happened rather than discovering the
      // quantity did not move the way they expected.
      reconciliations: reconciliations.map((r) => ({
        part_id: r.part_id,
        backfill_qty: r.backfill_qty,
        reconcile_qty: r.reconcile_qty,
        counted_at: r.counted_at,
        unexplained_shortfall: r.unexplained_shortfall,
      })),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    // The whole point of recording the supplier's document number is to make a repeat
    // entry impossible, so say plainly what happened rather than surfacing a 500.
    if (err.code === '23505' && err.constraint === 'uq_goods_receipt_supplier_invoice') {
      return res.status(409).json({
        message: `Invoice ${invoiceNo} has already been recorded for this supplier. Check the receipt history before entering it again.`,
      });
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error('Transaction Error:', err.message);
    res.status(500).json({ message: 'Server error during transaction.', error: err.message });
  } finally {
    client.release();
  }
});

// PUT /goods-receipts/:id - Update a Goods Receipt (requires edit permission)
router.put('/goods-receipts/:id', protect, hasPermission('goods_receipt:edit'), async (req, res) => {
  const { id } = req.params;
  const { supplier_id, received_by, lines } = req.body;

  if (!received_by) {
    return res.status(400).json({ message: 'received_by is required' });
  }
  if (!lines || !Array.isArray(lines)) {
    return res.status(400).json({ message: 'lines must be an array' });
  }
  if (lines.length === 0) {
    return res.status(400).json({ message: 'lines array cannot be empty' });
  }

  // Validate each line
  for (const [index, line] of lines.entries()) {
    if (!line.part_id) {
      return res.status(400).json({ message: `Missing part_id in line ${index}` });
    }
    if (typeof line.quantity !== 'number' || line.quantity <= 0) {
      return res.status(400).json({ message: `Invalid quantity in line ${index}` });
    }
    if (typeof line.cost_price !== 'number' || line.cost_price < 0) {
      return res.status(400).json({ message: `Invalid cost_price in line ${index}` });
    }
    if (line.sale_price !== null && (typeof line.sale_price !== 'number' || line.sale_price < 0)) {
      return res.status(400).json({ message: `Invalid sale_price in line ${index}` });
    }
  }

  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');

    try {
      // Verify the GRN exists and we can update it
      const verifyGrnQuery = `SELECT grn_id, grn_number, status, workflow_status, freight_amount,
                                     freight_allocation_method, overall_discount_percent, overall_discount_amount
                              FROM goods_receipt WHERE grn_id = $1 FOR UPDATE`;
      const verifyResult = await client.query(verifyGrnQuery, [id]);
      if (verifyResult.rows.length === 0) {
        throw new Error(`GRN with id ${id} not found`);
      }
      if (verifyResult.rows[0].status === 'Voided') {
        throw new Error('This goods receipt has been voided and can no longer be edited.');
      }
      const grnRow = verifyResult.rows[0];
      const grn_number = grnRow.grn_number;
      if (grnRow.workflow_status !== grnWorkflow.POSTED) {
        // A staged receipt is edited through PUT .../draft, which knows how to keep the
        // freight allocation coherent and never touches inventory.
        throw Object.assign(new Error('This receipt is still a draft. Edit it from the draft queue.'), { statusCode: 409 });
      }

      // Re-derive landed cost from the receipt's own freight and discount header.
      // Without this, editing a line would silently drop the freight back out of cost
      // and post the raw supplier price to inventory.
      const costing = grnCosting.computeCosting({
        lines: costingInputFromLines(lines),
        freightAmount: Number(grnRow.freight_amount) || 0,
        freightMethod: grnRow.freight_allocation_method,
        overallDiscountPercent: grnRow.overall_discount_percent,
        overallDiscountAmount: grnRow.overall_discount_amount,
        recomputeSalePrice: false,
      });
      assertCostingValid(costing);

      // Update the main GRN record. receipt_date is intentionally left
      // untouched here — this endpoint edits GRN metadata/lines, and
      // silently re-dating the receipt to "now" on every edit would fight
      // the transaction-date-override feature (transactionDateService.js),
      // which is the only path that should ever move receipt_date.
      const updateGrnQuery = `
        UPDATE goods_receipt
        SET ${supplier_id ? 'supplier_id = $1,' : ''} received_by = $${supplier_id ? '2' : '1'}
        WHERE grn_id = $${supplier_id ? '3' : '2'}
        RETURNING grn_id;
      `;
      const updateParams = supplier_id ? [supplier_id, received_by, id] : [received_by, id];
      const updateResult = await client.query(updateGrnQuery, updateParams);
      if (updateResult.rows.length === 0) {
        throw new Error('Failed to update GRN record');
      }

      // Lines and their stock movements are replaced wholesale rather than diffed,
      // because freight and the header discount are shared across the document: one
      // line changing moves every other line's landed cost.
      await client.query('DELETE FROM goods_receipt_line WHERE grn_id = $1', [id]);
      await client.query(
        'DELETE FROM inventory_transaction WHERE reference_no = $1 AND trans_type = $2',
        [grn_number, 'StockIn']
      );

      for (const [index, line] of lines.entries()) {
        const { part_id, quantity, cost_price, sale_price } = line;
        const computed = costing.lines[index];

        const partResult = await client.query('SELECT part_id FROM part WHERE part_id = $1', [part_id]);
        if (partResult.rows.length === 0) {
          throw new Error(`Part with id ${part_id} not found`);
        }

        await client.query(
          `INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, sale_price,
                                           line_discount_percent, line_discount_amount, override_freight_amount,
                                           allocated_freight_amount, landed_unit_cost, effective_markup_percent,
                                           return_quantity, rejection_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [id, part_id, quantity, cost_price, sale_price ?? computed.sale_price,
           line.line_discount_percent ?? null, line.line_discount_amount ?? null, line.override_freight_amount ?? null,
           computed.allocated_freight_amount, computed.landed_unit_cost, computed.effective_markup_percent,
           computed.return_quantity, line.rejection_reason ?? null]
        );

        const acceptedQty = computed.accepted_quantity;
        if (acceptedQty > 0) {
          await client.query(
            `INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
             VALUES ($1, 'StockIn', $2, $3, $4, $5)`,
            [part_id, acceptedQty, computed.landed_unit_cost, grn_number, received_by]
          );
        }
      }

      // Deleting and re-inserting stock movements leaves the average derived from a
      // history that no longer exists, so replay it. The original handler skipped this
      // and left part.wac_cost stale after every edit.
      await recomputeWacForParts(client, [...new Set(lines.map((l) => l.part_id))]);

      await client.query('COMMIT');
      res.json({ message: 'Goods receipt updated successfully' });
    } catch (innerErr) {
      console.error('Inner transaction error:', innerErr);
      await client.query('ROLLBACK');
      throw innerErr; // Re-throw to be caught by outer catch
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error('Goods receipt update error:', err.message);
    res.status(500).json({
      message: 'Server error during transaction.',
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (client) client.release();
  }
});

// DELETE /goods-receipts/:id - Void a goods receipt: reverses the stock it added, rolls
// back its contribution to a linked purchase order, and reverses any AP liability it
// posted — but never hard-deletes the row or its lines. Mirrors the invoice void pattern
// (see invoiceRoutes.js DELETE /invoices/:id): correcting a mistaken receipt is done the
// accounting way — reverse it, keep the record, so it "simulates" the receipt never
// having happened without erasing the audit trail.
router.delete('/goods-receipts/:id', protect, hasPermission('goods_receipt:void'), async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { rows: grnRows } = await client.query(
      'SELECT grn_id, grn_number, bill_id, freight_bill_id, supplier_id, po_id, status FROM goods_receipt WHERE grn_id = $1 FOR UPDATE',
      [id]
    );
    if (grnRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Goods receipt not found' });
    }
    const grn = grnRows[0];
    if (grn.status === 'Voided') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This goods receipt has already been voided.' });
    }

    // What a void has to reverse is what this receipt actually left in the building —
    // quantity less anything already sent back to the supplier, at the landed cost it
    // was brought in at. Reversing the full quantity would take the returned units out
    // a second time, and reversing at cost_price would leave the freight capitalised
    // into the average with nothing to offset it.
    const { rows: lines } = await client.query(
      `SELECT part_id,
              quantity - return_quantity AS quantity,
              COALESCE(landed_unit_cost, cost_price) AS cost_price
       FROM goods_receipt_line WHERE grn_id = $1`,
      [id]
    );
    if (lines.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This goods receipt has no line items to reverse.' });
    }

    // Guard: voiding removes stock this receipt added, so it must not drive any
    // part's current on-hand quantity negative (e.g. some of it was already sold
    // or transferred out since receiving).
    const insufficientStock = [];
    for (const line of lines) {
      const { rows: stockRows } = await client.query(
        'SELECT COALESCE(SUM(quantity), 0) AS on_hand FROM inventory_transaction WHERE part_id = $1',
        [line.part_id]
      );
      const onHand = parseFloat(stockRows[0].on_hand);
      if (parseFloat(line.quantity) > 0 && onHand - parseFloat(line.quantity) < -0.0001) {
        insufficientStock.push({ part_id: line.part_id, on_hand: onHand, needed: parseFloat(line.quantity) });
      }
    }
    if (insufficientStock.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Cannot void: some of the received stock has already been used elsewhere, and reversing it would drive on-hand quantity negative.',
        details: insufficientStock,
      });
    }

    // If linked to a bill, block the void when the bill already has payments applied —
    // reversing a paid bill's liability without also reversing the payment/allocation
    // would leave the AP ledger internally inconsistent.
    let bill = null;
    if (grn.bill_id) {
      const { rows: billRows } = await client.query(
        'SELECT bill_id, bill_number, supplier_id, amount_paid, status FROM supplier_bill WHERE bill_id = $1 FOR UPDATE',
        [grn.bill_id]
      );
      bill = billRows[0] || null;
      if (bill && bill.status !== 'Void') {
        if (parseFloat(bill.amount_paid) > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: `Cannot void: linked supplier bill ${bill.bill_number} already has payments applied. Reverse the payment first.` });
        }
        // A bill is header-only (no per-line detail), so a partial reversal can't be
        // computed accurately when other active receipts still share it.
        const { rows: otherRows } = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM goods_receipt WHERE bill_id = $1 AND grn_id != $2 AND status = 'Active'`,
          [grn.bill_id, id]
        );
        if (otherRows[0].cnt > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: `Cannot void: supplier bill ${bill.bill_number} has other active goods receipts attached to it. Void those first, or handle this bill manually.` });
        }
      }
    }

    // Reverse the stock this receipt added.
    for (const line of lines) {
      // A line returned in full left nothing behind, so there is nothing to reverse.
      if (parseFloat(line.quantity) <= 0) continue;
      await client.query(
        `INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
         VALUES ($1, 'StockOut', $2, $3, $4, $5, $6)`,
        [line.part_id, -line.quantity, line.cost_price, grn.grn_number, req.user.employee_id || null, 'SYSTEM REVERSAL: Goods receipt voided']
      );
    }

    // Roll back this receipt's contribution to its purchase order, if any.
    if (grn.po_id) {
      for (const line of lines) {
        await client.query(
          `UPDATE purchase_order_line
           SET quantity_received = GREATEST(0, quantity_received - $1)
           WHERE po_id = $2 AND part_id = $3`,
          [line.quantity, grn.po_id, line.part_id]
        );
      }

      const { rows: statusRows } = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) AS total_ordered, COALESCE(SUM(quantity_received), 0) AS total_received
         FROM purchase_order_line WHERE po_id = $1`,
        [grn.po_id]
      );
      const totalOrdered = parseFloat(statusRows[0].total_ordered);
      const totalReceived = parseFloat(statusRows[0].total_received);
      let newStatus = 'Pending';
      if (totalReceived > 0) {
        newStatus = totalReceived >= totalOrdered ? 'Received' : 'Partially Received';
      }
      await client.query('UPDATE purchase_order SET status = $1 WHERE po_id = $2', [newStatus, grn.po_id]);
    }

    // Reverse this receipt's AP liability with a single offsetting adjustment entry
    // rather than touching (immutable) historical ap_ledger rows, then void the bill —
    // only reachable once we've established this GRN is the bill's sole active basis.
    if (bill && bill.status !== 'Void') {
      const { rows: ledgerRows } = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS net FROM ap_ledger WHERE bill_id = $1',
        [bill.bill_id]
      );
      const net = parseFloat(ledgerRows[0].net);
      if (net !== 0) {
        const reversalAmount = -net;
        await apLedgerService.appendEntry(client, {
          supplierId: bill.supplier_id,
          billId: bill.bill_id,
          entryType: reversalAmount >= 0 ? 'DEBIT_ADJUSTMENT' : 'CREDIT_ADJUSTMENT',
          amount: reversalAmount,
          referenceNo: grn.grn_number,
          notes: `SYSTEM REVERSAL: Goods receipt ${grn.grn_number} voided`,
          createdBy: req.user.employee_id || null,
        });
      }
      await client.query(`UPDATE supplier_bill SET status = 'Void' WHERE bill_id = $1`, [bill.bill_id]);
    }

    // Freight rides on its own bill against the carrier, so voiding the receipt has to
    // reverse that liability too. Without this the carrier's payable would survive a
    // receipt that no longer exists.
    if (grn.freight_bill_id) {
      const { rows: [freightBill] } = await client.query(
        'SELECT bill_id, bill_number, supplier_id, total_amount, amount_paid, status FROM supplier_bill WHERE bill_id = $1 FOR UPDATE',
        [grn.freight_bill_id]
      );
      if (freightBill && freightBill.status !== 'Void') {
        if (parseFloat(freightBill.amount_paid) > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: `Cannot void: the freight bill ${freightBill.bill_number} has already been paid. Reverse that payment first.` });
        }
        const { rows: [freightLedger] } = await client.query(
          'SELECT COALESCE(SUM(amount), 0) AS net FROM ap_ledger WHERE bill_id = $1',
          [freightBill.bill_id]
        );
        const freightNet = parseFloat(freightLedger.net);
        if (freightNet !== 0) {
          await apLedgerService.appendEntry(client, {
            supplierId: freightBill.supplier_id,
            billId: freightBill.bill_id,
            entryType: freightNet <= 0 ? 'DEBIT_ADJUSTMENT' : 'CREDIT_ADJUSTMENT',
            amount: -freightNet,
            referenceNo: grn.grn_number,
            notes: `SYSTEM REVERSAL: Goods receipt ${grn.grn_number} voided`,
            createdBy: req.user.employee_id || null,
          });
        }
        await client.query(`UPDATE supplier_bill SET status = 'Void' WHERE bill_id = $1`, [freightBill.bill_id]);
      }
    }

    // Re-derive the average from the StockIn history, which the void's StockOut rows do
    // not trigger on their own. This keeps wac_cost, last_cost and last_cost_date
    // mutually consistent after the reversal.
    //
    // Known limitation, pre-existing and not fixed here: recompute_wac_for_part() replays
    // only StockIn rows, and a void deliberately leaves this receipt's StockIn in history
    // rather than deleting it. So the voided receipt's cost still contributes to the
    // average afterwards. Correcting that belongs to the WAC correction module
    // (wacCorrectionRoutes.js), which exists for exactly this kind of adjustment.
    await recomputeWacForParts(client, [...new Set(lines.map((l) => l.part_id))]);

    await client.query(
      `UPDATE goods_receipt
       SET status = 'Voided', voided_at = CURRENT_TIMESTAMP, voided_by = $1, void_reason = $2
       WHERE grn_id = $3`,
      [req.user.employee_id || null, reason || null, id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Goods receipt voided and stock reversed.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Void goods receipt error:', err.message);
    res.status(500).json({ message: 'Server error voiding goods receipt', error: err.message });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Draft workflow
//
// A receipt can now be staged before it commits anything. Draft and Submitted
// documents are ordinary goods_receipt rows with workflow_status set accordingly, and
// they deliberately write nothing to inventory_transaction, supplier_bill or ap_ledger
// — all of that lives in grnPostingService.postReceipt(), which only POST .../post
// reaches.
//
// A draft carries a provisional GRD- number rather than a GRN- one. Goods receipt
// numbers are a financial document sequence and should not develop gaps because
// somebody abandoned a half-typed delivery; the real GRN number is drawn at the moment
// the receipt actually posts.
// ─────────────────────────────────────────────────────────────────────────────

const DRAFT_PREFIX = 'GRD';

function parseHeaderPayload(body) {
  return {
    supplier_id: body.supplier_id || null,
    received_by: body.received_by || null,
    po_id: body.po_id || null,
    bill_id: body.bill_id || null,
    receipt_date: body.receipt_date || null,
    is_backfill: !!body.is_backfill,
    supplier_invoice_no: body.supplier_invoice_no ? String(body.supplier_invoice_no).trim() : null,
    freight_amount: Number(body.freight_amount) > 0 ? Number(body.freight_amount) : 0,
    freight_allocation_method: body.freight_allocation_method || grnCosting.METHOD_A,
    freight_supplier_id: body.freight_supplier_id || null,
    overall_discount_percent: body.overall_discount_percent ?? null,
    overall_discount_amount: body.overall_discount_amount ?? null,
    sync_retail_prices: body.sync_retail_prices === undefined ? true : !!body.sync_retail_prices,
  };
}

// Replace a draft's lines wholesale with the costed payload. Full replacement rather
// than a diff because the UI edits the document as a single form and a partial update
// would leave the freight allocation — which depends on every line — inconsistent.
async function writeDraftLines(client, grnId, lines, costing) {
  await client.query('DELETE FROM goods_receipt_line WHERE grn_id = $1', [grnId]);
  for (const [index, line] of lines.entries()) {
    const computed = costing.lines[index];
    await client.query(
      `INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, sale_price,
                                       line_discount_percent, line_discount_amount, override_freight_amount,
                                       allocated_freight_amount, landed_unit_cost, effective_markup_percent,
                                       return_quantity, rejection_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [grnId, line.part_id, line.quantity, line.cost_price, computed.sale_price,
       line.line_discount_percent ?? null, line.line_discount_amount ?? null, line.override_freight_amount ?? null,
       computed.allocated_freight_amount, computed.landed_unit_cost, computed.effective_markup_percent,
       computed.return_quantity, line.rejection_reason || null],
    );
  }
}

function validateDraftLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    const err = new Error('A receipt needs at least one line item.');
    err.statusCode = 400;
    throw err;
  }
  for (const [index, line] of lines.entries()) {
    if (!line.part_id) {
      const err = new Error(`Line ${index + 1} has no part selected.`);
      err.statusCode = 400;
      throw err;
    }
    const qty = Number(line.quantity);
    const cost = Number(line.cost_price);
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error(`Line ${index + 1} needs a quantity greater than zero.`);
      err.statusCode = 400;
      throw err;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      const err = new Error(`Line ${index + 1} needs a valid cost.`);
      err.statusCode = 400;
      throw err;
    }
    if (line.rejection_reason && !grnCosting.REJECTION_REASONS.includes(line.rejection_reason)) {
      const err = new Error(`'${line.rejection_reason}' is not a rejection reason.`);
      err.statusCode = 400;
      throw err;
    }
  }
}

// POST /goods-receipts/preview-costing - Stateless allocation preview.
// Stateless because the freight wizard runs while the receipt is still being typed,
// before any draft exists to attach the numbers to.
router.post('/goods-receipts/preview-costing', protect, (req, res) => {
  const { lines = [] } = req.body || {};
  if (!Array.isArray(lines)) {
    return res.status(400).json({ message: 'lines must be an array' });
  }
  const header = parseHeaderPayload(req.body || {});
  const costing = grnCosting.computeCosting({
    lines: costingInputFromLines(lines),
    freightAmount: header.freight_amount,
    freightMethod: header.freight_allocation_method,
    overallDiscountPercent: header.overall_discount_percent,
    overallDiscountAmount: header.overall_discount_amount,
    recomputeSalePrice: req.body?.recompute_sale_price !== false,
  });
  res.json(costing);
});

// POST /goods-receipts/drafts - Stage a receipt without committing anything.
router.post('/goods-receipts/drafts', protect, hasPermission('goods_receipt:create'), async (req, res) => {
  const header = parseHeaderPayload(req.body || {});
  const lines = req.body?.lines || [];
  const employeeId = req.user.employee_id;

  if (!header.supplier_id) {
    return res.status(400).json({ message: 'Select the supplier this delivery came from.' });
  }

  const client = await db.getClient();
  try {
    validateDraftLines(lines);
    const costing = costingForPayload(header, lines);
    assertCostingValid(costing);

    await client.query('BEGIN');
    const draftNumber = await getNextDocumentNumber(client, DRAFT_PREFIX);
    const { rows: [draft] } = await client.query(
      `INSERT INTO goods_receipt (grn_number, supplier_id, received_by, po_id, receipt_date, is_backfill,
                                  supplier_invoice_no, workflow_status, freight_amount, freight_allocation_method,
                                  freight_supplier_id, overall_discount_percent, overall_discount_amount,
                                  sync_retail_prices, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, CURRENT_TIMESTAMP), $6, $7, 'Draft',
               $8, $9, $10, $11, $12, $13, $14)
       RETURNING grn_id, grn_number`,
      [draftNumber, header.supplier_id, header.received_by || employeeId, header.po_id, header.receipt_date,
       header.is_backfill, header.supplier_invoice_no, header.freight_amount, header.freight_allocation_method,
       header.freight_supplier_id, header.overall_discount_percent, header.overall_discount_amount,
       header.sync_retail_prices, employeeId],
    );

    await writeDraftLines(client, draft.grn_id, lines, costing);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Draft saved.', grn_id: draft.grn_id, grn_number: draft.grn_number, costing });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505' && err.constraint === 'uq_goods_receipt_supplier_invoice') {
      return res.status(409).json({ message: `Invoice ${header.supplier_invoice_no} has already been recorded for this supplier.` });
    }
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error('Error creating goods receipt draft:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// GET /goods-receipts/drafts - The team review queue.
router.get('/goods-receipts/drafts', protect, hasPermission('goods_receipt:create'), async (req, res) => {
  const { status = 'all', q: search = '' } = req.query;
  const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);

  if (status !== 'all' && ![grnWorkflow.DRAFT, grnWorkflow.SUBMITTED].includes(status)) {
    return res.status(400).json({ message: 'status must be Draft, Submitted or all' });
  }

  try {
    const params = [];
    let where = `WHERE gr.workflow_status IN ('${grnWorkflow.DRAFT}', '${grnWorkflow.SUBMITTED}')`;
    if (status !== 'all') {
      params.push(status);
      where += ` AND gr.workflow_status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (gr.grn_number ILIKE $${params.length} OR s.supplier_name ILIKE $${params.length}
                      OR gr.supplier_invoice_no ILIKE $${params.length})`;
    }

    // The line aggregate is what makes the queue reviewable at a glance: a reviewer
    // needs the document's value and size before deciding to open it.
    let query = `
      SELECT
        gr.grn_id, gr.grn_number, gr.receipt_date, gr.workflow_status, gr.supplier_invoice_no,
        gr.freight_amount, gr.overall_discount_percent, gr.overall_discount_amount,
        gr.created_at, gr.submitted_at,
        s.supplier_name,
        CONCAT(ce.first_name, ' ', ce.last_name) AS created_by_name,
        CASE WHEN gr.submitted_by IS NOT NULL THEN CONCAT(se.first_name, ' ', se.last_name) END AS submitted_by_name,
        COALESCE(agg.line_count, 0)::int AS line_count,
        COALESCE(agg.total_value, 0) AS total_value
      FROM goods_receipt gr
      JOIN supplier s ON gr.supplier_id = s.supplier_id
      LEFT JOIN employee ce ON gr.created_by = ce.employee_id
      LEFT JOIN employee se ON gr.submitted_by = se.employee_id
      LEFT JOIN (
        SELECT grn_id, COUNT(*) AS line_count,
               SUM((quantity - return_quantity) * COALESCE(landed_unit_cost, cost_price)) AS total_value
        FROM goods_receipt_line GROUP BY grn_id
      ) agg ON agg.grn_id = gr.grn_id
      ${where}
      ORDER BY gr.created_at DESC
    `;

    if (!paginated) {
      const { rows } = await db.query(query, params);
      return res.json(rows);
    }
    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM (${query}) d`, params);
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const { rows } = await db.query(query, [...params, limit, offset]);
    res.json(paginatedResponse({ data: rows, page, pageSize, total: countRes.rows[0]?.total || 0 }));
  } catch (err) {
    console.error('Error fetching goods receipt drafts:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /goods-receipts/:id - One receipt's header, so a staged document can be reopened
// in the entry screen with its freight, discounts and price-sync choice intact. Declared
// after /goods-receipts/drafts so that literal path is not captured by :id.
router.get('/goods-receipts/:id', protect, hasPermission('goods_receipt:create'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT gr.grn_id, gr.grn_number, gr.receipt_date, gr.supplier_id, gr.received_by, gr.po_id,
              gr.bill_id, gr.freight_bill_id, gr.status, gr.workflow_status, gr.is_backfill,
              gr.supplier_invoice_no, gr.freight_amount, gr.freight_allocation_method,
              gr.freight_supplier_id, gr.overall_discount_percent, gr.overall_discount_amount,
              gr.sync_retail_prices, gr.created_at, gr.submitted_at, gr.posted_at,
              s.supplier_name,
              fs.supplier_name AS freight_supplier_name,
              CONCAT(e.first_name, ' ', e.last_name) AS received_by_name
       FROM goods_receipt gr
       JOIN supplier s ON gr.supplier_id = s.supplier_id
       LEFT JOIN supplier fs ON gr.freight_supplier_id = fs.supplier_id
       LEFT JOIN employee e ON gr.received_by = e.employee_id
       WHERE gr.grn_id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Goods receipt not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching goods receipt:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// PUT /goods-receipts/:id/draft - Replace a staged receipt's header and lines.
router.put('/goods-receipts/:id/draft', protect, hasPermission('goods_receipt:create'), async (req, res) => {
  const { id } = req.params;
  const header = parseHeaderPayload(req.body || {});
  const lines = req.body?.lines || [];

  const client = await db.getClient();
  try {
    validateDraftLines(lines);
    const costing = costingForPayload(header, lines);
    assertCostingValid(costing);

    await client.query('BEGIN');
    const { rows: [grn] } = await client.query(
      'SELECT grn_id, workflow_status FROM goods_receipt WHERE grn_id = $1 FOR UPDATE',
      [id],
    );
    if (!grn) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Goods receipt not found' });
    }
    grnWorkflow.assertEditable(grn.workflow_status);

    // Editing a receipt that has already been submitted sends it back to Draft.
    //
    // Approval is only worth anything if what gets posted is what was reviewed. Without
    // this, anyone holding goods_receipt:create — which is most of the shop floor —
    // could rewrite a submitted receipt's quantities, costs and freight while a manager
    // had it open, and the post would go through at the rewritten figures under the
    // manager's authority, because posting recomputes from the stored lines. Returning
    // it to Draft forces it to be submitted and looked at again.
    const wasSubmitted = grn.workflow_status === grnWorkflow.SUBMITTED;

    await client.query(
      `UPDATE goods_receipt
       SET supplier_id = COALESCE($1, supplier_id),
           received_by = COALESCE($2, received_by),
           po_id = $3,
           receipt_date = COALESCE($4::timestamptz, receipt_date),
           is_backfill = $5,
           supplier_invoice_no = $6,
           freight_amount = $7,
           freight_allocation_method = $8,
           freight_supplier_id = $9,
           overall_discount_percent = $10,
           overall_discount_amount = $11,
           sync_retail_prices = $12,
           workflow_status = $14,
           -- The edit leaves it a draft, and a draft has no submission behind it, so the
           -- previous approval trail is cleared unconditionally rather than conditionally.
           submitted_by = NULL,
           submitted_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE grn_id = $13`,
      [header.supplier_id, header.received_by, header.po_id, header.receipt_date, header.is_backfill,
       header.supplier_invoice_no, header.freight_amount, header.freight_allocation_method,
       header.freight_supplier_id, header.overall_discount_percent, header.overall_discount_amount,
       header.sync_retail_prices, id, grnWorkflow.DRAFT],
    );

    await writeDraftLines(client, id, lines, costing);
    await client.query('COMMIT');
    res.json({
      message: wasSubmitted
        ? 'Draft updated. Because it had already been submitted, it has gone back to draft and needs submitting again.'
        : 'Draft updated.',
      grn_id: Number(id),
      workflow_status: grnWorkflow.DRAFT,
      returned_to_draft: wasSubmitted,
      costing,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error('Error updating goods receipt draft:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// Shared body for the pure status moves (submit, cancel, send back).
async function transitionReceipt(req, res, { to, permissionField, timestampField }) {
  const { id } = req.params;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: [grn] } = await client.query(
      'SELECT grn_id, workflow_status FROM goods_receipt WHERE grn_id = $1 FOR UPDATE',
      [id],
    );
    if (!grn) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Goods receipt not found' });
    }
    grnWorkflow.assertTransition(grn.workflow_status, to);

    const sets = ['workflow_status = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [to];
    if (permissionField) {
      params.push(req.user.employee_id);
      sets.push(`${permissionField} = $${params.length}`);
    }
    if (timestampField) sets.push(`${timestampField} = CURRENT_TIMESTAMP`);
    params.push(id);

    await client.query(`UPDATE goods_receipt SET ${sets.join(', ')} WHERE grn_id = $${params.length}`, params);
    await client.query('COMMIT');
    res.json({ message: `Goods receipt ${to.toLowerCase()}.`, grn_id: Number(id), workflow_status: to });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error(`Error transitioning goods receipt to ${to}:`, err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
}

// PATCH /goods-receipts/:id/submit - Send a draft up for review.
router.patch('/goods-receipts/:id/submit', protect, hasPermission('goods_receipt:submit'), (req, res) =>
  transitionReceipt(req, res, { to: grnWorkflow.SUBMITTED, permissionField: 'submitted_by', timestampField: 'submitted_at' }));

// PATCH /goods-receipts/:id/return-to-draft - Reviewer sends it back for correction.
router.patch('/goods-receipts/:id/return-to-draft', protect, hasPermission('goods_receipt:post'), (req, res) =>
  transitionReceipt(req, res, { to: grnWorkflow.DRAFT }));

// PATCH /goods-receipts/:id/cancel - Abandon a staged receipt. Nothing to reverse,
// because a draft never committed anything in the first place.
router.patch('/goods-receipts/:id/cancel', protect, hasPermission('goods_receipt:submit'), (req, res) =>
  transitionReceipt(req, res, { to: grnWorkflow.CANCELLED }));

// POST /goods-receipts/:id/post - Commit a staged receipt: stock, WAC, payables, prices.
router.post('/goods-receipts/:id/post', protect, hasPermission('goods_receipt:post'), async (req, res) => {
  const { id } = req.params;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    const { rows: [grn] } = await client.query(
      `SELECT grn_id, grn_number, supplier_id, received_by, po_id, bill_id, receipt_date, is_backfill,
              supplier_invoice_no, workflow_status, freight_amount, freight_allocation_method,
              freight_supplier_id, overall_discount_percent, overall_discount_amount
       FROM goods_receipt WHERE grn_id = $1 FOR UPDATE`,
      [id],
    );
    if (!grn) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Goods receipt not found' });
    }
    grnWorkflow.assertTransition(grn.workflow_status, grnWorkflow.POSTED);
    await periodLockService.assertPeriodOpen(new Date(grn.receipt_date), { module: 'goods_receipt' });

    const { rows: lines } = await client.query(
      `SELECT grn_line_id, part_id, quantity, cost_price, sale_price, line_discount_percent,
              line_discount_amount, override_freight_amount, effective_markup_percent,
              return_quantity, rejection_reason
       FROM goods_receipt_line WHERE grn_id = $1 ORDER BY grn_line_id`,
      [id],
    );
    if (lines.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This receipt has no line items to post.' });
    }

    // Recompute rather than trust what the draft stored: the underlying figures may have
    // been edited in another tab, and the numbers that reach inventory must be derived
    // from the lines as they stand at this moment.
    const costing = grnCosting.computeCosting({
      lines: costingInputFromLines(lines),
      freightAmount: Number(grn.freight_amount) || 0,
      freightMethod: grn.freight_allocation_method,
      overallDiscountPercent: grn.overall_discount_percent,
      overallDiscountAmount: grn.overall_discount_amount,
      recomputeSalePrice: false,
    });
    assertCostingValid(costing);
    assertMarkupFloor(costing);

    if (costing.totals.net_goods_value <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This receipt has no value left to post — every line was returned or discounted away.' });
    }

    // Swap the provisional draft number for a real one at the moment the document
    // becomes a financial record, so the GRN sequence has no gaps from abandoned drafts.
    const grnNumber = grn.grn_number.startsWith(`${DRAFT_PREFIX}-`)
      ? await getNextDocumentNumber(client, 'GRN')
      : grn.grn_number;

    for (const [index, line] of lines.entries()) {
      const computed = costing.lines[index];
      await client.query(
        `UPDATE goods_receipt_line
         SET allocated_freight_amount = $1, landed_unit_cost = $2, effective_markup_percent = $3, sale_price = $4
         WHERE grn_line_id = $5`,
        [computed.allocated_freight_amount, computed.landed_unit_cost, computed.effective_markup_percent,
         computed.sale_price, line.grn_line_id],
      );
    }

    await client.query(
      `UPDATE goods_receipt
       SET grn_number = $1, workflow_status = 'Posted', posted_by = $2, posted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE grn_id = $3`,
      [grnNumber, req.user.employee_id, id],
    );

    const { reconciliations, billId, freightBillId } = await postReceipt(client, {
      grnId: Number(id),
      grnNumber,
      supplierId: grn.supplier_id,
      employeeId: grn.received_by || req.user.employee_id,
      lines: lines.map((l, i) => ({
        part_id: l.part_id,
        quantity: l.quantity,
        return_quantity: costing.lines[i].return_quantity,
        cost_price: l.cost_price,
        landed_unit_cost: costing.lines[i].landed_unit_cost,
      })),
      poId: grn.is_backfill ? null : grn.po_id,
      billId: grn.is_backfill ? null : grn.bill_id,
      isBackfill: grn.is_backfill,
      receiptDate: grn.receipt_date,
      supplierInvoiceNo: grn.supplier_invoice_no,
      freightAmount: Number(grn.freight_amount) || 0,
      freightSupplierId: grn.is_backfill ? null : grn.freight_supplier_id,
      netGoodsValue: costing.totals.net_goods_value,
    });

    await client.query('COMMIT');
    res.json({
      message: 'Goods receipt posted.',
      grn_id: Number(id),
      grn_number: grnNumber,
      bill_id: billId,
      freight_bill_id: freightBillId,
      totals: costing.totals,
      reconciliations: reconciliations.map((r) => ({
        part_id: r.part_id, backfill_qty: r.backfill_qty, reconcile_qty: r.reconcile_qty,
        counted_at: r.counted_at, unexplained_shortfall: r.unexplained_shortfall,
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505' && err.constraint === 'uq_goods_receipt_supplier_invoice') {
      return res.status(409).json({ message: 'That supplier invoice has already been recorded.' });
    }
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error('Error posting goods receipt:', err.message);
    res.status(500).json({ message: 'Server error posting goods receipt', error: err.message });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Returns and rejections — one mechanism, two behaviours
//
// The distinction customers draw between "rejected at the dock" and "returned to the
// supplier afterwards" is really a question of when it was noticed, not of what
// happened: in both cases goods came in on this document and are going back. So it is
// one field pair on the line, and the behaviour follows the receipt's status.
//
//   Draft / Submitted — the goods never entered the books. Reduce the received
//   quantity, re-run the allocation (freight and the header discount both move, since
//   they are shared across lines), and nothing financial happens.
//
//   Posted — stock and a payable already exist. Reverse the units at their landed cost,
//   replay WAC, credit the supplier bill and record a RETURN_CREDIT in ap_ledger.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/goods-receipts/:id/lines/:lineId/return', protect, hasPermission('goods_receipt:return'), async (req, res) => {
  const { id, lineId } = req.params;
  const { return_quantity, rejection_reason, notes } = req.body || {};

  const returnQty = Number(return_quantity);
  if (!Number.isFinite(returnQty) || returnQty <= 0) {
    return res.status(400).json({ message: 'Enter how many units are going back.' });
  }
  if (!rejection_reason || !grnCosting.REJECTION_REASONS.includes(rejection_reason)) {
    return res.status(400).json({ message: `Choose a reason: ${grnCosting.REJECTION_REASONS.join(', ')}.` });
  }
  // "Other" says nothing on its own; the whole point of recording a reason is to be able
  // to raise it with the supplier later.
  if (rejection_reason === 'Other' && !String(notes || '').trim()) {
    return res.status(400).json({ message: 'Describe the problem when the reason is Other.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: [grn] } = await client.query(
      `SELECT grn_id, grn_number, supplier_id, bill_id, po_id, status, workflow_status, receipt_date,
              is_backfill, freight_amount, freight_allocation_method,
              overall_discount_percent, overall_discount_amount
       FROM goods_receipt WHERE grn_id = $1 FOR UPDATE`,
      [id],
    );
    if (!grn) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Goods receipt not found' });
    }
    if (grn.status === 'Voided') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This receipt has been voided; there is nothing left to return.' });
    }
    if (grn.workflow_status === grnWorkflow.CANCELLED) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This receipt was cancelled and can no longer be changed.' });
    }

    const { rows: allLines } = await client.query(
      `SELECT grn_line_id, part_id, quantity, cost_price, sale_price, line_discount_percent,
              line_discount_amount, override_freight_amount, effective_markup_percent,
              return_quantity, landed_unit_cost
       FROM goods_receipt_line WHERE grn_id = $1 ORDER BY grn_line_id FOR UPDATE`,
      [id],
    );
    const target = allLines.find((l) => String(l.grn_line_id) === String(lineId));
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'That line is not on this receipt.' });
    }

    const alreadyReturned = Number(target.return_quantity) || 0;
    const remaining = Number(target.quantity) - alreadyReturned;
    if (returnQty > remaining + 0.0001) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Only ${remaining} of the ${target.quantity} received on this line are still on hand to return.`,
      });
    }

    const isPosted = grn.workflow_status === grnWorkflow.POSTED;

    if (isPosted) {
      await periodLockService.assertPeriodOpen(new Date(), { module: 'goods_receipt' });

      // The units may already have been sold on. Sending them back to the supplier when
      // they are no longer in the building would drive on-hand negative.
      const { rows: [stock] } = await client.query(
        'SELECT COALESCE(SUM(quantity), 0) AS on_hand FROM inventory_transaction WHERE part_id = $1',
        [target.part_id],
      );
      if (parseFloat(stock.on_hand) - returnQty < -0.0001) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Cannot return ${returnQty}: only ${stock.on_hand} of this part are on hand. Some have already been sold.`,
        });
      }
    }

    // Apply the return, then recompute the whole document — freight and the header
    // discount are shared across lines, so one line going back changes every other
    // line's landed cost.
    const updatedLines = allLines.map((l) => (
      String(l.grn_line_id) === String(lineId)
        ? { ...l, return_quantity: alreadyReturned + returnQty }
        : l
    ));
    const costing = grnCosting.computeCosting({
      lines: costingInputFromLines(updatedLines),
      freightAmount: Number(grn.freight_amount) || 0,
      freightMethod: grn.freight_allocation_method,
      overallDiscountPercent: grn.overall_discount_percent,
      overallDiscountAmount: grn.overall_discount_amount,
      recomputeSalePrice: false,
    });
    assertCostingValid(costing);

    const reasonText = rejection_reason === 'Other'
      ? `Other: ${String(notes).trim()}`.slice(0, 100)
      : rejection_reason;

    for (const [index, line] of updatedLines.entries()) {
      const computed = costing.lines[index];
      const isTarget = String(line.grn_line_id) === String(lineId);
      await client.query(
        `UPDATE goods_receipt_line
         SET return_quantity = $1,
             allocated_freight_amount = $2,
             landed_unit_cost = $3,
             rejection_reason = COALESCE($4, rejection_reason),
             returned_at = CASE WHEN $4 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE returned_at END,
             returned_by = CASE WHEN $4 IS NOT NULL THEN $5 ELSE returned_by END
         WHERE grn_line_id = $6`,
        [computed.return_quantity, computed.allocated_freight_amount, computed.landed_unit_cost,
         isTarget ? reasonText : null, req.user.employee_id, line.grn_line_id],
      );
    }

    let creditAmount = 0;
    if (isPosted) {
      // Reverse the stock at the cost it came in at, so the average is not skewed by
      // returning units at a different valuation than they were received.
      const returnCost = Number(target.landed_unit_cost ?? target.cost_price);
      await client.query(
        `INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
         VALUES ($1, 'StockOut', $2, $3, $4, $5, $6)`,
        [target.part_id, -returnQty, returnCost, grn.grn_number, req.user.employee_id,
         `RETURN TO SUPPLIER: ${reasonText}`],
      );

      // The trigger only maintains WAC on StockIn, so a reversal needs the explicit
      // chronological replay. (The older void path omits this; do not copy that.)
      await recomputeWacForParts(client, [target.part_id]);

      if (grn.po_id && !grn.is_backfill) {
        await client.query(
          `UPDATE purchase_order_line SET quantity_received = GREATEST(0, quantity_received - $1)
           WHERE po_id = $2 AND part_id = $3`,
          [returnQty, grn.po_id, target.part_id],
        );
      }

      // Credit the payable at the goods value of the returned units — net of the line's
      // own discount, but excluding freight, which the carrier still charged for
      // carrying them and does not refund.
      const targetIndex = updatedLines.findIndex((l) => String(l.grn_line_id) === String(lineId));
      const targetComputed = costing.lines[targetIndex];
      const unitNetCost = targetComputed && targetComputed.accepted_quantity > 0
        ? targetComputed.net_line_value / targetComputed.accepted_quantity
        : Number(target.cost_price);
      creditAmount = Math.round(returnQty * unitNetCost * 100) / 100;

      if (grn.bill_id && creditAmount > 0) {
        const { rows: [bill] } = await client.query(
          'SELECT bill_id, bill_number, supplier_id, total_amount, amount_paid, status FROM supplier_bill WHERE bill_id = $1 FOR UPDATE',
          [grn.bill_id],
        );
        if (bill && bill.status !== 'Void') {
          const newTotal = Math.max(0, Number(bill.total_amount) - creditAmount);
          if (newTotal < Number(bill.amount_paid)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              message: `Returning these goods would take bill ${bill.bill_number} below what has already been paid on it. Handle the refund with the supplier first.`,
            });
          }
          await client.query('UPDATE supplier_bill SET total_amount = $1 WHERE bill_id = $2', [newTotal, bill.bill_id]);
          await apLedgerService.appendEntry(client, {
            supplierId: bill.supplier_id,
            billId: bill.bill_id,
            entryType: 'RETURN_CREDIT',
            amount: -creditAmount,
            referenceNo: grn.grn_number,
            notes: `Return on goods receipt ${grn.grn_number}: ${reasonText}`,
            createdBy: req.user.employee_id,
          });
        }
      }
    }

    await client.query('UPDATE goods_receipt SET updated_at = CURRENT_TIMESTAMP WHERE grn_id = $1', [id]);
    await client.query('COMMIT');
    res.json({
      message: isPosted
        ? 'Return recorded, stock reversed and the payable credited.'
        : 'Rejection recorded on the draft.',
      grn_id: Number(id),
      grn_line_id: Number(lineId),
      return_quantity: alreadyReturned + returnQty,
      credit_amount: creditAmount,
      totals: costing.totals,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error('Error recording goods receipt return:', err.message);
    res.status(500).json({ message: 'Server error recording return', error: err.message });
  } finally {
    client.release();
  }
});

// POST /goods-receipts/:id/sync-retail-prices - Push this receipt's prices to the
// catalogue on demand.
//
// Posting already does this when sync_retail_prices is set. This endpoint exists for the
// case where prices were deliberately held back at posting time and are being released
// later, or where a price was corrected on the receipt after the fact — without which
// the only way to move the catalogue would be to void and re-enter the whole document.
router.post('/goods-receipts/:id/sync-retail-prices', protect, hasPermission('goods_receipt:price_sync'), async (req, res) => {
  const { id } = req.params;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: [grn] } = await client.query(
      'SELECT grn_id, grn_number, status, workflow_status FROM goods_receipt WHERE grn_id = $1 FOR UPDATE',
      [id],
    );
    if (!grn) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Goods receipt not found' });
    }
    if (grn.workflow_status !== grnWorkflow.POSTED || grn.status === 'Voided') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Only a posted, un-voided receipt can set catalogue prices.' });
    }

    const { rows: updated } = await client.query(
      `UPDATE part p
       SET last_sale_price = grl.sale_price, last_sale_price_date = CURRENT_TIMESTAMP
       FROM goods_receipt_line grl
       WHERE grl.grn_id = $1
         AND grl.part_id = p.part_id
         AND grl.sale_price IS NOT NULL
         AND grl.quantity > grl.return_quantity
       RETURNING p.part_id, p.last_sale_price`,
      [id],
    );

    // Record the intent as well as the effect: a receipt that has had its prices pushed
    // manually should behave like one that opted in, so a later WAC replay
    // (recompute_wac_for_part) re-resolves the same prices rather than reverting them.
    await client.query(
      'UPDATE goods_receipt SET sync_retail_prices = true, updated_at = CURRENT_TIMESTAMP WHERE grn_id = $1',
      [id],
    );

    await client.query('COMMIT');
    res.json({
      message: `Updated catalogue prices for ${updated.length} part${updated.length === 1 ? '' : 's'}.`,
      updated_count: updated.length,
      parts: updated,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error syncing retail prices:', err.message);
    res.status(500).json({ message: 'Server error syncing prices', error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
