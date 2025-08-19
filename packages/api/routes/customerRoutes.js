const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware'); // Import middleware
const router = express.Router();

// GET all customers
router.get('/customers', protect, hasPermission('customers:view'), async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM customer ORDER BY first_name, last_name');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/customers/with-balances - Get all customers with an outstanding balance
router.get('/customers/with-balances', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const query = `
            SELECT
                c.customer_id,
                c.first_name,
                c.last_name,
                c.company_name,
                (
                    SELECT COALESCE(SUM(total_amount), 0)
                    FROM invoice
                    WHERE customer_id = c.customer_id
                ) as total_invoiced,
                (
                    SELECT COALESCE(SUM(ipa.amount_allocated), 0)
                    FROM invoice_payment_allocation ipa
                    JOIN invoice i ON ipa.invoice_id = i.invoice_id
                    WHERE i.customer_id = c.customer_id
                ) as total_paid
            FROM customer c
            WHERE (
                SELECT COALESCE(SUM(total_amount), 0)
                FROM invoice
                WHERE customer_id = c.customer_id
            ) > (
                SELECT COALESCE(SUM(ipa.amount_allocated), 0)
                FROM invoice_payment_allocation ipa
                JOIN invoice i ON ipa.invoice_id = i.invoice_id
                WHERE i.customer_id = c.customer_id
            )
            ORDER BY c.first_name, c.last_name;
        `;
        const { rows } = await db.query(query);
        const customersWithBalance = rows.map(c => ({
            ...c,
            balance_due: parseFloat(c.total_invoiced) - parseFloat(c.total_paid)
        }));
        res.json(customersWithBalance);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- MOVED FROM paymentRoutes.js ---
// GET /api/customers/:id/unpaid-invoices - Get all unpaid or partially paid invoices for a customer
router.get('/customers/:id/unpaid-invoices', protect, hasPermission('ar:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                i.invoice_id, 
                i.invoice_number, 
                i.invoice_date, 
                i.total_amount,
                COALESCE(SUM(ipa.amount_allocated), 0) as amount_paid,
                (i.total_amount - COALESCE(SUM(ipa.amount_allocated), 0)) as balance_due
            FROM invoice i
            LEFT JOIN invoice_payment_allocation ipa ON i.invoice_id = ipa.invoice_id
            WHERE i.customer_id = $1 AND i.status IN ('Unpaid', 'Partially Paid')
            GROUP BY i.invoice_id
            HAVING (i.total_amount - COALESCE(SUM(ipa.amount_allocated), 0)) > 0
            ORDER BY i.invoice_date ASC;
        `;
        const { rows } = await db.query(query, [id]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// POST a new customer
router.post('/customers', protect, hasPermission('customers:edit'), async (req, res) => {
    const { first_name, last_name, company_name, phone, email, address } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO customer (first_name, last_name, company_name, phone, email, address) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [first_name, last_name, company_name, phone, email, address]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT to update a customer
router.put('/customers/:id', protect, hasPermission('customers:edit'), async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, company_name, phone, email, address, is_active } = req.body;
    try {
        const { rows } = await db.query(
            'UPDATE customer SET first_name = $1, last_name = $2, company_name = $3, phone = $4, email = $5, address = $6, is_active = $7 WHERE customer_id = $8 RETURNING *',
            [first_name, last_name, company_name, phone, email, address, is_active, id]
        );
        res.json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE a customer
router.delete('/customers/:id', protect, hasPermission('customers:edit'), async (req, res) => {
    const { id } = req.params;
    try {
        const invoiceCheck = await db.query('SELECT 1 FROM invoice WHERE customer_id = $1 LIMIT 1', [id]);
        if (invoiceCheck.rows.length > 0) {
            return res.status(400).json({ message: 'Cannot delete customer. They have existing invoices.' });
        }

        const { rowCount } = await db.query('DELETE FROM customer WHERE customer_id = $1', [id]);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'Customer not found.' });
        }
        res.status(200).json({ message: 'Customer deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;
