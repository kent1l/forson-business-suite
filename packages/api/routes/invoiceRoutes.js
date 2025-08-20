const express = require('express');
const db = require('../db');
const { generateDocumentNumber } = require('../helpers/documentNumberGenerator');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET all invoices
router.get('/invoices', protect, hasPermission('invoicing:create'), async (req, res) => {
    try {
        const query = `
            SELECT i.*, c.first_name, c.last_name, c.company_name
            FROM invoice i
            JOIN customer c ON i.customer_id = c.customer_id
            ORDER BY i.invoice_date DESC
        `;
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST a new invoice
router.post('/invoices', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { customer_id, employee_id, lines, total_amount } = req.body;
    if (!customer_id || !employee_id || !lines || lines.length === 0) {
        return res.status(400).json({ message: 'Customer, employee, and line items are required.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Get customer's payment term to calculate due date
        const customerRes = await client.query(
            `SELECT c.payment_term_id, pt.days_to_due 
             FROM customer c
             LEFT JOIN payment_term pt ON c.payment_term_id = pt.payment_term_id
             WHERE c.customer_id = $1`,
            [customer_id]
        );

        if (customerRes.rows.length === 0) {
            throw new Error('Customer not found.');
        }

        const daysToDue = customerRes.rows[0].days_to_due || 0;
        const invoiceDate = new Date();
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + daysToDue);

        const invoiceNumber = await generateDocumentNumber(client, 'INV');

        const invoiceQuery = `
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, invoice_date, due_date, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'Unpaid') RETURNING *
        `;
        const invoiceResult = await client.query(invoiceQuery, [invoiceNumber, customer_id, employee_id, total_amount, invoiceDate, dueDate]);
        const newInvoice = invoiceResult.rows[0];

        for (const line of lines) {
            const lineQuery = `
                INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale)
                VALUES ($1, $2, $3, $4, (SELECT wac_cost FROM part WHERE part_id = $2))
            `;
            await client.query(lineQuery, [newInvoice.invoice_id, line.part_id, line.quantity, line.sale_price]);

            const transQuery = `
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
                VALUES ($1, 'SALE', $2, (SELECT wac_cost FROM part WHERE part_id = $1), $3, $4)
            `;
            await client.query(transQuery, [line.part_id, -line.quantity, invoiceNumber, employee_id]);
        }

        await client.query('COMMIT');
        res.status(201).json(newInvoice);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

module.exports = router;
