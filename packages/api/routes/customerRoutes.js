const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all customers
router.get('/customers', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM customer ORDER BY last_name, first_name');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST a new customer
router.post('/customers', async (req, res) => {
    const { first_name, last_name, company_name, phone, email, address } = req.body;
    if (!first_name) {
        return res.status(400).json({ message: 'First name is required.' });
    }
    try {
        const newCustomer = await db.query(
            'INSERT INTO customer (first_name, last_name, company_name, phone, email, address) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [first_name, last_name, company_name, phone, email, address]
        );
        res.status(201).json(newCustomer.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT - Update an existing customer
router.put('/customers/:id', async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, company_name, phone, email, address } = req.body;

    if (!first_name) {
        return res.status(400).json({ message: 'First name is required' });
    }

    try {
        const updatedCustomer = await db.query(
            'UPDATE customer SET first_name = $1, last_name = $2, company_name = $3, phone = $4, email = $5, address = $6 WHERE customer_id = $7 RETURNING *',
            [first_name, last_name, company_name, phone, email, address, id]
        );

        if (updatedCustomer.rows.length === 0) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        res.json(updatedCustomer.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE - Delete a customer
router.delete('/customers/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM customer WHERE customer_id = $1 RETURNING *', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Customer not found' });
        }
        res.json({ message: 'Customer deleted successfully' });
    } catch (err) {
        if (err.code === '23503') {
            return res.status(400).json({ message: 'Cannot delete this customer because they are linked to one or more invoices.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
