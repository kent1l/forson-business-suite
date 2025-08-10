const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const router = express.Router();

// POST /invoices - Create a new Invoice
router.post('/invoices', async (req, res) => {
  const { customer_id, employee_id, lines, payment_method, terms } = req.body; // Added 'terms'

  if (!customer_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0 || !payment_method) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const invoice_number = await getNextDocumentNumber(client, 'INV');
    let total_amount = 0;

    // Calculate total amount and tax for each line
    for (const line of lines) {
        const partRes = await client.query(
            `SELECT p.last_sale_price, tr.rate_percentage 
             FROM part p
             LEFT JOIN tax_rate tr ON p.tax_rate_id = tr.tax_rate_id
             WHERE p.part_id = $1`,
            [line.part_id]
        );

        if (partRes.rows.length === 0) {
            throw new Error(`Part with ID ${line.part_id} not found.`);
        }

        const part = partRes.rows[0];
        const lineSubtotal = line.quantity * line.sale_price;
        const taxRate = part.rate_percentage || 0;
        line.tax_amount = lineSubtotal * taxRate; // Calculate and store tax amount
        total_amount += lineSubtotal + line.tax_amount; // Add subtotal and tax to total
    }
    
    const status = (payment_method.toLowerCase() === 'on account') ? 'Unpaid' : 'Paid';

    const invoiceQuery = `
      INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, amount_paid, status, terms)
      VALUES ($1, $2, $3, $4, $4, $5, $6)
      RETURNING invoice_id;
    `;
    const invoiceResult = await client.query(invoiceQuery, [invoice_number, customer_id, employee_id, total_amount, status, terms]);
    const newInvoiceId = invoiceResult.rows[0].invoice_id;

    for (const line of lines) {
      const { part_id, quantity, sale_price, tax_amount } = line;

      const lineQuery = `
        INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, tax_amount)
        VALUES ($1, $2, $3, $4, $5);
      `;
      await client.query(lineQuery, [newInvoiceId, part_id, quantity, sale_price, tax_amount]);

      const transactionQuery = `
        INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
        VALUES ($1, 'Sale', $2, $3, $4, $5);
      `;
      await client.query(transactionQuery, [part_id, -Math.abs(quantity), sale_price, invoice_number, employee_id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Invoice created successfully', invoice_id: newInvoiceId, invoice_number });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction Error:', err.message);
    res.status(500).json({ message: 'Server error during transaction.', error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;