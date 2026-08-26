const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { hasPermission, protect } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const apLedgerService = require('../services/apLedgerService');
const periodLockService = require('../services/periodLockService');
const { recomputeWacForParts } = require('../services/transactionDateService');
const router = express.Router();

// GET /goods-receipts - Fetch list of posted GRNs with search and sorting
router.get('/goods-receipts', protect, async (req, res) => {
  const { q: search = '', sortBy = 'receipt_date', sortOrder = 'desc' } = req.query;
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

    if (search) {
      query += `
        WHERE gr.grn_number ILIKE $${paramIndex}
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
           )
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
router.get('/goods-receipts/:id/lines', protect, async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT 
        grl.quantity,
        grl.cost_price,
        grl.sale_price,
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
    
    // DEBUG: Log what we're actually returning
    console.log('[GRN Lines] SQL result for grn_id:', id);
    console.log('[GRN Lines] Row count:', rows.length);
    if (rows.length > 0) {
      console.log('[GRN Lines] First row keys:', Object.keys(rows[0]));
      console.log('[GRN Lines] First row part_id:', rows[0].part_id);
      console.log('[GRN Lines] Sample row:', JSON.stringify(rows[0], null, 2));
    }
    
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
  const { supplier_id, received_by, lines, po_id, bill_id, receipt_date,
          is_backfill, supplier_invoice_no } = req.body;

  if (!supplier_id || !received_by || !lines || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const isBackfill = !!is_backfill;
  const invoiceNo = supplier_invoice_no ? String(supplier_invoice_no).trim() : null;

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

    const goodsReceiptQuery = `
      INSERT INTO goods_receipt (grn_number, supplier_id, received_by, bill_id, po_id, receipt_date, is_backfill, supplier_invoice_no)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, CURRENT_TIMESTAMP), $7, $8)
      RETURNING grn_id;
    `;
    const receiptResult = await client.query(goodsReceiptQuery, [grn_number, supplier_id, received_by,
      isBackfill ? null : (bill_id || null), isBackfill ? null : (po_id || null), receiptDate, isBackfill, invoiceNo]);
    const newGrnId = receiptResult.rows[0].grn_id;

    for (const line of lines) {
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

      const lineQuery = `
        INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, sale_price)
        VALUES ($1, $2, $3, $4, $5);
      `;
      await client.query(lineQuery, [newGrnId, part_id, quantity, cost_price, sale_price ?? null]);

      const transactionQuery = `
        INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, transaction_date)
        VALUES ($1, 'StockIn', $2, $3, $4, $5, COALESCE($6::timestamptz, CURRENT_TIMESTAMP));
      `;
      // Note: sale_price is not used in inventory valuation; keep it separate from unit_cost
      await client.query(transactionQuery, [part_id, quantity, cost_price, grn_number, received_by, receiptDate]);
      
      // --- NEW: Update PO if linked ---
      if (po_id && !isBackfill) {
        await client.query(
            `UPDATE purchase_order_line SET quantity_received = quantity_received + $1 WHERE po_id = $2 AND part_id = $3`,
            [quantity, po_id, part_id]
        );
      }
    }

    // --- NEW: Update PO status after all lines are processed ---
    if (po_id && !isBackfill) {
        const poStatusQuery = `
            SELECT 
                SUM(quantity) as total_ordered,
                SUM(quantity_received) as total_received
            FROM purchase_order_line
            WHERE po_id = $1;
        `;
        const statusRes = await client.query(poStatusQuery, [po_id]);
        const { total_ordered, total_received } = statusRes.rows[0];

        let newStatus = 'Partially Received';
        if (parseFloat(total_received) >= parseFloat(total_ordered)) {
            newStatus = 'Received';
        }

        await client.query(`UPDATE purchase_order SET status = $1 WHERE po_id = $2`, [newStatus, po_id]);
    }

    // --- Auto-create the supplier bill this receipt represents, so AP monitoring
    // reflects the liability immediately instead of waiting on manual bill entry.
    // The partial unique index on supplier_bill.grn_id (migration 20260813_04)
    // makes this idempotent if the request is ever retried. Skipped entirely when
    // bill_id was provided — the receipt is attaching items to an existing payable,
    // not creating a new one.
    // A backfill never posts a payable: the goods it records were paid for long ago,
    // so auto-creating a bill would overstate what is owed to the supplier.
    const totalAmount = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) * parseFloat(l.cost_price)), 0);
    if (totalAmount > 0 && !bill_id && !isBackfill) {
      const { rows: [supplier] } = await client.query(
        'SELECT payment_terms_days FROM supplier WHERE supplier_id = $1', [supplier_id]
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
        [supplier_id, po_id || null, newGrnId, billNumber, termsDays, totalAmount, received_by, receiptDate]
      );

      if (bill) {
        // Back-link the receipt to the bill it created (goods_receipt.bill_id is the
        // authoritative "which items belong to this bill" pointer used by
        // GET /ap/supplier-bills/:billId/items — without this, auto-created bills
        // would show no attached items even though the stock-in already happened).
        await client.query(`UPDATE goods_receipt SET bill_id = $1 WHERE grn_id = $2`, [bill.bill_id, newGrnId]);

        await apLedgerService.appendEntry(client, {
          supplierId: supplier_id,
          billId: bill.bill_id,
          entryType: 'BILL_POSTED',
          amount: totalAmount,
          referenceNo: billNumber,
          notes: `Auto-posted from goods receipt ${grn_number}`,
          createdBy: received_by,
        });
      }
    }

    // Receiving stock at a real cost is what resolves a quick-added part's missing
    // cost, so clear the flag that put it in the costing queue.
    await client.query(
      `DELETE FROM part_tag
        WHERE part_id = ANY($1::int[])
          AND tag_id = (SELECT tag_id FROM tag WHERE tag_name = 'pending_costing')`,
      [[...new Set(lines.map((l) => l.part_id))]]
    );

    // The trg_update_wac trigger derives prev_stock from the SUM of all other rows
    // regardless of their dates, so it only produces the right average when the new
    // StockIn is the latest one. A backdated receipt lands mid-history and needs the
    // full chronological replay instead.
    if (receiptDate) {
      await recomputeWacForParts(client, [...new Set(lines.map((l) => l.part_id))]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Goods receipt created successfully', grn_id: newGrnId });

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
  console.log('Received PUT request for goods receipt:', req.params.id);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  const { id } = req.params;
  const { supplier_id, received_by, lines } = req.body;

  console.log('Validating input parameters...');
  console.log('supplier_id:', supplier_id, 'type:', typeof supplier_id);
  console.log('received_by:', received_by, 'type:', typeof received_by);
  console.log('lines:', JSON.stringify(lines, null, 2));

  // More detailed validation
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
    console.log(`Validating line ${index}:`, JSON.stringify(line, null, 2));
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
    console.log('Getting database client...');
    client = await db.getClient();
    console.log('Starting transaction for GRN update...');
    await client.query('BEGIN');

    try {
      // Verify the GRN exists and we can update it
      console.log('Verifying GRN exists...');
      const verifyGrnQuery = 'SELECT grn_id, grn_number, status FROM goods_receipt WHERE grn_id = $1';
      const verifyResult = await client.query(verifyGrnQuery, [id]);
      if (verifyResult.rows.length === 0) {
        throw new Error(`GRN with id ${id} not found`);
      }
      if (verifyResult.rows[0].status === 'Voided') {
        throw new Error('This goods receipt has been voided and can no longer be edited.');
      }
      const grn_number = verifyResult.rows[0].grn_number;
      console.log('Found GRN number:', grn_number);

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
      console.log('Executing main GRN update:', { supplier_id, received_by, id });
      const updateResult = await client.query(updateGrnQuery, updateParams);
      if (updateResult.rows.length === 0) {
        throw new Error('Failed to update GRN record');
      }
      console.log('Main GRN update successful');

      // Delete existing lines
      console.log('Deleting existing GRN lines for ID:', id);
      const deleteLineResult = await client.query('DELETE FROM goods_receipt_line WHERE grn_id = $1 RETURNING grn_line_id', [id]);
      console.log(`Deleted ${deleteLineResult.rowCount} existing GRN lines`);

      // Delete existing inventory transactions for this GRN
      console.log('Deleting existing inventory transactions for GRN:', grn_number);
      const deleteTransResult = await client.query(
        'DELETE FROM inventory_transaction WHERE reference_no = $1 AND trans_type = $2 RETURNING inv_trans_id',
        [grn_number, 'StockIn']
      );
      console.log(`Deleted ${deleteTransResult.rowCount} existing inventory transactions`);

      // Insert new lines
      console.log('Starting to insert new lines...');
      for (const [index, line] of lines.entries()) {
        console.log(`Processing line ${index}:`, JSON.stringify(line, null, 2));
        const { part_id, quantity, cost_price, sale_price } = line;

        // Verify part exists
        console.log('Verifying part exists:', part_id);
        const verifyPartQuery = 'SELECT part_id FROM part WHERE part_id = $1';
        const partResult = await client.query(verifyPartQuery, [part_id]);
        if (partResult.rows.length === 0) {
          throw new Error(`Part with id ${part_id} not found`);
        }

        const lineQuery = `
          INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, sale_price)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING grn_line_id;
        `;
        console.log('Inserting GRN line:', { id, part_id, quantity, cost_price, sale_price });
        const insertLineResult = await client.query(lineQuery, [id, part_id, quantity, cost_price, sale_price ?? null]);
        if (!insertLineResult.rows[0]) {
          throw new Error(`Failed to insert GRN line for part ${part_id}`);
        }
        console.log('GRN line inserted successfully, ID:', insertLineResult.rows[0].grn_line_id);

        const transactionQuery = `
          INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING inv_trans_id;
        `;
        const transResult = await client.query(
          transactionQuery,
          [part_id, 'StockIn', quantity, cost_price, grn_number, received_by]
        );
        if (!transResult.rows[0]) {
          throw new Error(`Failed to insert inventory transaction for part ${part_id}`);
        }
        console.log('Inventory transaction inserted successfully, ID:', transResult.rows[0].inv_trans_id);
      }

      console.log('All operations completed successfully, committing transaction...');
      await client.query('COMMIT');
      res.json({ message: 'Goods receipt updated successfully' });
    } catch (innerErr) {
      console.error('Inner transaction error:', innerErr);
      await client.query('ROLLBACK');
      throw innerErr; // Re-throw to be caught by outer catch
    }
  } catch (err) {
    console.error('Transaction Error:', err);
    res.status(500).json({ 
      message: 'Server error during transaction.',
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (client) {
      console.log('Releasing database client...');
      client.release();
    }
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
      'SELECT grn_id, grn_number, bill_id, po_id, status FROM goods_receipt WHERE grn_id = $1 FOR UPDATE',
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

    const { rows: lines } = await client.query(
      'SELECT part_id, quantity, cost_price FROM goods_receipt_line WHERE grn_id = $1',
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
      if (onHand - parseFloat(line.quantity) < -0.0001) {
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

module.exports = router;
