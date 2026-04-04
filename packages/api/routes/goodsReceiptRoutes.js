const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { hasPermission, protect } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /goods-receipts - Fetch list of posted GRNs with search and sorting
router.get('/goods-receipts', protect, async (req, res) => {
  const { q: search = '', sortBy = 'receipt_date', sortOrder = 'desc' } = req.query;

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
        s.supplier_name,
        CONCAT(e.first_name, ' ', e.last_name) AS employee_name
      FROM goods_receipt gr
      JOIN supplier s ON gr.supplier_id = s.supplier_id
      JOIN employee e ON gr.received_by = e.employee_id
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

    const { rows } = await db.query(query, params);
    res.json(rows);
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
router.post('/goods-receipts', async (req, res) => {
  // NEW: Added po_id to destructuring
  const { supplier_id, received_by, lines, po_id } = req.body;

  if (!supplier_id || !received_by || !lines || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const grn_number = await getNextDocumentNumber(client, 'GRN');

    const goodsReceiptQuery = `
      INSERT INTO goods_receipt (grn_number, supplier_id, received_by)
      VALUES ($1, $2, $3)
      RETURNING grn_id;
    `;
    const receiptResult = await client.query(goodsReceiptQuery, [grn_number, supplier_id, received_by]);
    const newGrnId = receiptResult.rows[0].grn_id;

    for (const line of lines) {
      const { part_id, quantity, cost_price, sale_price } = line;
      if (!part_id || !quantity || !cost_price) {
        throw new Error('Each line item must have part_id, quantity, and cost_price.');
      }

      const lineQuery = `
        INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price, sale_price)
        VALUES ($1, $2, $3, $4, $5);
      `;
      await client.query(lineQuery, [newGrnId, part_id, quantity, cost_price, sale_price ?? null]);

      const transactionQuery = `
        INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
        VALUES ($1, 'StockIn', $2, $3, $4, $5);
      `;
      // Note: sale_price is not used in inventory valuation; keep it separate from unit_cost
      await client.query(transactionQuery, [part_id, quantity, cost_price, grn_number, received_by]);
      
      // --- NEW: Update PO if linked ---
      if (po_id) {
        await client.query(
            `UPDATE purchase_order_line SET quantity_received = quantity_received + $1 WHERE po_id = $2 AND part_id = $3`,
            [quantity, po_id, part_id]
        );
      }
    }

    // --- NEW: Update PO status after all lines are processed ---
    if (po_id) {
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

    await client.query('COMMIT');
    res.status(201).json({ message: 'Goods receipt created successfully', grn_id: newGrnId });

  } catch (err) {
    await client.query('ROLLBACK');
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
      const verifyGrnQuery = 'SELECT grn_id, grn_number FROM goods_receipt WHERE grn_id = $1';
      const verifyResult = await client.query(verifyGrnQuery, [id]);
      if (verifyResult.rows.length === 0) {
        throw new Error(`GRN with id ${id} not found`);
      }
      const grn_number = verifyResult.rows[0].grn_number;
      console.log('Found GRN number:', grn_number);

      // Update the main GRN record
      const updateGrnQuery = `
        UPDATE goods_receipt
        SET ${supplier_id ? 'supplier_id = $1,' : ''} received_by = $${supplier_id ? '2' : '1'}, receipt_date = CURRENT_TIMESTAMP
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

module.exports = router;