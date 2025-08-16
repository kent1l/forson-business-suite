const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const router = express.Router();

// POST /invoices - Create a new Invoice
router.post('/invoices', async (req, res) => {
  const { customer_id, employee_id, lines, payment_method, terms } = req.body;

  if (!customer_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0 || !payment_method) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const invoice_number = await getNextDocumentNumber(client, 'INV');
    let total_amount = 0;

    // Calculate total amount
    for (const line of lines) {
        total_amount += line.quantity * line.sale_price;
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
      const { part_id, quantity, sale_price } = line;

      // *** WAC IMPLEMENTATION START ***
      // 1. Get the current WAC for the part
      const partRes = await client.query('SELECT wac_cost, last_sale_price FROM part WHERE part_id = $1', [part_id]);
      if (partRes.rows.length === 0) throw new Error(`Part ID ${part_id} not found.`);
      const cost_at_sale = partRes.rows[0].wac_cost;

      // 2. Insert into invoice_line with the cost_at_sale
      const lineQuery = `
        INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale)
        VALUES ($1, $2, $3, $4, $5);
      `;
      await client.query(lineQuery, [newInvoiceId, part_id, quantity, sale_price, cost_at_sale]);

      // 3. Update the part's last_sale_price
      await client.query('UPDATE part SET last_sale_price = $1, last_sale_price_date = CURRENT_TIMESTAMP WHERE part_id = $2', [sale_price, part_id]);

      // 4. Create the inventory transaction (as before)
      const transactionQuery = `
        INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
        VALUES ($1, 'Sale', $2, $3, $4, $5);
      `;
      // Note: We record the cost_at_sale in the transaction for a complete audit trail
      await client.query(transactionQuery, [part_id, -Math.abs(quantity), cost_at_sale, invoice_number, employee_id]);
      // *** WAC IMPLEMENTATION END ***
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
