const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all customers
router.get('/customers', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM customer ORDER BY first_name, last_name');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- NEW ---
// GET /api/customers/with-balances - Get all customers with an outstanding balance
router.get('/customers/with-balances', async (req, res) => {
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


// POST a new customer
router.post('/customers', async (req, res) => {
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
router.put('/customers/:id', async (req, res) => {
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

module.exports = router;
