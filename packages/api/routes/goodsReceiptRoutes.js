const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const router = express.Router();

// GET /goods-receipts - Fetch list of posted GRNs with search and sorting
router.get('/goods-receipts', async (req, res) => {
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
router.get('/goods-receipts/:id/lines', async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT 
        grl.quantity,
        grl.cost_price,
        grl.sale_price,
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

module.exports = router;