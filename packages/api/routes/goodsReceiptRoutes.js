const express = require('express');
const db = require('../db'); // We need the raw pool for transactions
const router = express.Router();

// POST /goods-receipts - Create a new Goods Receipt
router.post('/goods-receipts', async (req, res) => {
  const { supplier_id, received_by, lines } = req.body;

  // --- Data Validation ---
  if (!supplier_id || !received_by || !lines || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'Missing required fields: supplier_id, received_by, and a non-empty lines array.' });
  }

  // Get a client from the connection pool to manage the transaction
  const client = await db.getClient();

  try {
    // --- Begin Database Transaction ---
    await client.query('BEGIN');

    // 1. Create the Goods Receipt header to get the new grn_id
    // For now, we'll generate a simple GRN number. We can make this more robust later.
    const grn_number = `GRN-${Date.now()}`;
    const goodsReceiptQuery = `
      INSERT INTO goods_receipt (grn_number, supplier_id, received_by)
      VALUES ($1, $2, $3)
      RETURNING grn_id;
    `;
    const receiptResult = await client.query(goodsReceiptQuery, [grn_number, supplier_id, received_by]);
    const newGrnId = receiptResult.rows[0].grn_id;

    // 2. Loop through the line items and insert them
    for (const line of lines) {
      const { part_id, quantity, cost_price } = line;
      if (!part_id || !quantity || !cost_price) {
        throw new Error('Each line item must have part_id, quantity, and cost_price.');
      }

      // Insert into goods_receipt_line
      const lineQuery = `
        INSERT INTO goods_receipt_line (grn_id, part_id, quantity, cost_price)
        VALUES ($1, $2, $3, $4);
      `;
      await client.query(lineQuery, [newGrnId, part_id, quantity, cost_price]);

      // Insert into inventory_transaction (the ledger)
      const transactionQuery = `
        INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
        VALUES ($1, 'StockIn', $2, $3, $4, $5);
      `;
      await client.query(transactionQuery, [part_id, quantity, cost_price, grn_number, received_by]);
    }

    // --- Commit Transaction ---
    await client.query('COMMIT');
    res.status(201).json({ message: 'Goods receipt created successfully', grn_id: newGrnId });

  } catch (err) {
    // --- Rollback Transaction on Error ---
    await client.query('ROLLBACK');
    console.error('Transaction Error:', err.message);
    res.status(500).json({ message: 'Server error during transaction.', error: err.message });
  } finally {
    // --- Release Client Back to Pool ---
    client.release();
  }
});

module.exports = router;
