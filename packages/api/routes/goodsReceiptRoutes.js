const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const router = express.Router();

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
      const { part_id, quantity, cost_price } = line;
      if (!part_id || !quantity || !cost_price) {
        throw new Error('Each line item must have part_id, quantity, and cost_price.');
      }

      const lineQuery = `
        INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price)
        VALUES ($1, $2, $3, $4);
      `;
      await client.query(lineQuery, [newGrnId, part_id, quantity, cost_price]);

      const transactionQuery = `
        INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
        VALUES ($1, 'StockIn', $2, $3, $4, $5);
      `;
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