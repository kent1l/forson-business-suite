const express = require('express');
const db = require('../db');
const router = express.Router();

// POST /invoices - Create a new Invoice
router.post('/invoices', async (req, res) => {
  const { customer_id, employee_id, lines } = req.body;

  if (!customer_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'Missing required fields: customer_id, employee_id, and a non-empty lines array.' });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const invoice_number = `INV-${Date.now()}`;
    let total_amount = 0;

    // Calculate total amount from lines
    for (const line of lines) {
        total_amount += line.quantity * line.sale_price;
    }

    // 1. Create the Invoice header
    const invoiceQuery = `
      INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, amount_paid, status)
      VALUES ($1, $2, $3, $4, $4, 'Paid') -- Assuming it's paid immediately
      RETURNING invoice_id;
    `;
    const invoiceResult = await client.query(invoiceQuery, [invoice_number, customer_id, employee_id, total_amount]);
    const newInvoiceId = invoiceResult.rows[0].invoice_id;

    // 2. Loop through the line items and insert them
    for (const line of lines) {
      const { part_id, quantity, sale_price } = line;

      // Insert into invoice_line
      const lineQuery = `
        INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price)
        VALUES ($1, $2, $3, $4);
      `;
      await client.query(lineQuery, [newInvoiceId, part_id, quantity, sale_price]);

      // Insert into inventory_transaction (with a NEGATIVE quantity for stock out)
      const transactionQuery = `
        INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
        VALUES ($1, 'Sale', $2, $3, $4, $5);
      `;
      // Note: We multiply quantity by -1 to decrease stock
      await client.query(transactionQuery, [part_id, -Math.abs(quantity), sale_price, invoice_number, employee_id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Invoice created successfully', invoice_id: newInvoiceId });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction Error:', err.message);
    res.status(500).json({ message: 'Server error during transaction.', error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
