const express = require('express');
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/tax-rates - Get all tax rates
router.get('/tax-rates', protect, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM tax_rate ORDER BY rate_name');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /api/tax-rates - Create a new tax rate
router.post('/tax-rates', protect, isAdmin, async (req, res) => {
    const { rate_name, rate_percentage } = req.body;
    if (!rate_name || rate_percentage === undefined) {
        return res.status(400).json({ message: 'Rate name and percentage are required.' });
    }
    try {
        const newRate = await db.query(
            'INSERT INTO tax_rate (rate_name, rate_percentage) VALUES ($1, $2) RETURNING *',
            [rate_name, rate_percentage]
        );
        res.status(201).json(newRate.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT /api/tax-rates/:id - Update a tax rate
router.put('/tax-rates/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { rate_name, rate_percentage } = req.body;
    if (!rate_name || rate_percentage === undefined) {
        return res.status(400).json({ message: 'Rate name and percentage are required.' });
    }
    try {
        const updatedRate = await db.query(
            'UPDATE tax_rate SET rate_name = $1, rate_percentage = $2 WHERE tax_rate_id = $3 RETURNING *',
            [rate_name, rate_percentage, id]
        );
        if (updatedRate.rows.length === 0) {
            return res.status(404).json({ message: 'Tax rate not found.' });
        }
        res.json(updatedRate.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE /api/tax-rates/:id - Delete a tax rate
router.delete('/tax-rates/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM tax_rate WHERE tax_rate_id = $1', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Tax rate not found.' });
        }
        res.json({ message: 'Tax rate deleted successfully.' });
    } catch (err) {
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({ message: 'Cannot delete this tax rate as it is currently assigned to one or more parts.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// NEW ROUTE: Set a tax rate as the default
router.put('/tax-rates/:id/set-default', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        // Step 1: Set all rates to NOT be the default
        await client.query('UPDATE tax_rate SET is_default = FALSE');

        // Step 2: Set the specified rate as the default
        const result = await client.query(
            'UPDATE tax_rate SET is_default = TRUE WHERE tax_rate_id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            throw new Error('Tax rate not found.');
        }

        await client.query('COMMIT');
        res.json({ message: 'Default tax rate updated successfully.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

module.exports = router;