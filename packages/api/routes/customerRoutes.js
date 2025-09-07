const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// Helper function to handle tag logic
const manageTags = async (client, tags, customerId) => {
    await client.query('DELETE FROM customer_tag WHERE customer_id = $1', [customerId]);
    if (tags && tags.length > 0) {
        for (const tagName of tags) {
            await client.query(
                'INSERT INTO tag (tag_name) VALUES ($1) ON CONFLICT (tag_name) DO NOTHING',
                [tagName.toLowerCase()]
            );
            const tagRes = await client.query('SELECT tag_id FROM tag WHERE tag_name = $1', [tagName.toLowerCase()]);
            const tagId = tagRes.rows[0].tag_id;
            
            await client.query('INSERT INTO customer_tag (customer_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [customerId, tagId]);
        }
    }
};

// GET all customers
router.get('/customers', protect, hasPermission('customers:view'), async (req, res) => {
    // Adding a filter for active/inactive/all customers
    const { status = 'active' } = req.query;
    let whereClause = "WHERE is_active = TRUE";
    if (status === 'inactive') {
      whereClause = "WHERE is_active = FALSE";
    } else if (status === 'all') {
      whereClause = "";
    }
    try {
        const { rows } = await db.query(`SELECT * FROM customer ${whereClause} ORDER BY first_name, last_name`);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/customers/:id/tags - Get all tags for a specific customer
router.get('/customers/:id/tags', protect, hasPermission('customers:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT t.tag_id, t.tag_name
            FROM tag t
            JOIN customer_tag ct ON t.tag_id = ct.tag_id
            WHERE ct.customer_id = $1
            ORDER BY t.tag_name;
        `;
        const { rows } = await db.query(query, [id]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// GET /api/customers/with-balances
router.get('/customers/with-balances', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const query = `
            SELECT
                c.customer_id,
                c.first_name,
                c.last_name,
                c.company_name,
                (SELECT COALESCE(SUM(i.total_amount),0) FROM invoice i WHERE i.customer_id = c.customer_id) AS total_invoiced,
                (SELECT COALESCE(SUM(ipa.amount_allocated),0) FROM invoice_payment_allocation ipa JOIN invoice i2 ON ipa.invoice_id = i2.invoice_id WHERE i2.customer_id = c.customer_id) AS total_paid,
                (
                    (SELECT COALESCE(SUM(i.total_amount),0) FROM invoice i WHERE i.customer_id = c.customer_id)
                    -
                    (SELECT COALESCE(SUM(ipa.amount_allocated),0) FROM invoice_payment_allocation ipa JOIN invoice i2 ON ipa.invoice_id = i2.invoice_id WHERE i2.customer_id = c.customer_id)
                ) AS balance_due
            FROM customer c
            WHERE (
                    (SELECT COALESCE(SUM(i.total_amount),0) FROM invoice i WHERE i.customer_id = c.customer_id)
                    -
                    (SELECT COALESCE(SUM(ipa.amount_allocated),0) FROM invoice_payment_allocation ipa JOIN invoice i2 ON ipa.invoice_id = i2.invoice_id WHERE i2.customer_id = c.customer_id)
                  ) > 0
            ORDER BY c.first_name, c.last_name;
        `;
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/customers/:id/unpaid-invoices
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
    const { tags, ...customerData } = req.body;
    // Sanitize email: convert empty string to null
    const emailOrNull = customerData.email && customerData.email.trim() !== '' ? customerData.email.trim() : null;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            'INSERT INTO customer (first_name, last_name, company_name, phone, email, address, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [customerData.first_name, customerData.last_name, customerData.company_name, customerData.phone, emailOrNull, customerData.address, customerData.is_active]
        );
        const newCustomer = rows[0];
        await manageTags(client, tags, newCustomer.customer_id);
        await client.query('COMMIT');
        res.status(201).json(newCustomer);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// PUT to update a customer
router.put('/customers/:id', protect, hasPermission('customers:edit'), async (req, res) => {
    const { id } = req.params;
    const { tags, ...customerData } = req.body;
    // Sanitize email: convert empty string to null
    const emailOrNull = customerData.email && customerData.email.trim() !== '' ? customerData.email.trim() : null;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            'UPDATE customer SET first_name = $1, last_name = $2, company_name = $3, phone = $4, email = $5, address = $6, is_active = $7 WHERE customer_id = $8 RETURNING *',
            [customerData.first_name, customerData.last_name, customerData.company_name, customerData.phone, emailOrNull, customerData.address, customerData.is_active, id]
        );
        const updatedCustomer = rows[0];
        await manageTags(client, tags, updatedCustomer.customer_id);
        await client.query('COMMIT');
        res.json(updatedCustomer);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
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