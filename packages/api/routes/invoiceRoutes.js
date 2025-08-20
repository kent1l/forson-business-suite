const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /invoices - Get all invoices with date filtering
router.get('/invoices', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    try {
        const query = `
            SELECT 
                i.*, 
                c.first_name as customer_first_name, 
                c.last_name as customer_last_name,
                e.first_name as employee_first_name,
                e.last_name as employee_last_name
            FROM invoice i
            JOIN customer c ON i.customer_id = c.customer_id
            JOIN employee e ON i.employee_id = e.employee_id
            WHERE i.invoice_date::date BETWEEN $1 AND $2
            ORDER BY i.invoice_date DESC;
        `;
        const { rows } = await db.query(query, [startDate, endDate]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /invoices - Create a new invoice
router.post('/invoices', async (req, res) => {
    const { customer_id, employee_id, lines, amount_paid, terms } = req.body;

    if (!customer_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const invoice_number = await getNextDocumentNumber(client, 'INV');
        const total_amount = lines.reduce((sum, line) => sum + (line.quantity * line.sale_price) - (line.discount_amount || 0), 0);
        
        // --- FIX: Intelligently determine the status on the backend ---
        let status;
        const paid = parseFloat(amount_paid) || 0;
        if (paid >= total_amount) {
            status = 'Paid';
        } else if (paid > 0 && paid < total_amount) {
            status = 'Partially Paid';
        } else {
            status = 'Unpaid';
        }

        const invoiceQuery = `
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, amount_paid, status, terms)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING invoice_id;
        `;
        const invoiceResult = await client.query(invoiceQuery, [invoice_number, customer_id, employee_id, total_amount, amount_paid, status, terms]);
        const newInvoiceId = invoiceResult.rows[0].invoice_id;

        for (const line of lines) {
            const { part_id, quantity, sale_price, discount_amount } = line;
            
            // Get the current WAC cost for the part
            const costResult = await client.query('SELECT wac_cost FROM part WHERE part_id = $1', [part_id]);
            const cost_at_sale = costResult.rows.length > 0 ? costResult.rows[0].wac_cost : 0;

            const lineQuery = `
                INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount)
                VALUES ($1, $2, $3, $4, $5, $6);
            `;
            await client.query(lineQuery, [newInvoiceId, part_id, quantity, sale_price, cost_at_sale, discount_amount]);

            // Create inventory transaction for the sale
            const transactionQuery = `
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
                VALUES ($1, 'StockOut', $2, $3, $4, $5);
            `;
            await client.query(transactionQuery, [part_id, -quantity, cost_at_sale, invoice_number, employee_id]);
        }
        
        // If a payment was made, create the payment and allocation records
        if (paid > 0) {
            const paymentQuery = `
                INSERT INTO customer_payment (customer_id, employee_id, amount, payment_method, reference_number)
                VALUES ($1, $2, $3, 'Cash', $4) RETURNING payment_id;
            `;
            const paymentResult = await client.query(paymentQuery, [customer_id, employee_id, paid, invoice_number]);
            const newPaymentId = paymentResult.rows[0].payment_id;

            const allocationQuery = `
                INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated)
                VALUES ($1, $2, $3);
            `;
            await client.query(allocationQuery, [newInvoiceId, newPaymentId, paid]);
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