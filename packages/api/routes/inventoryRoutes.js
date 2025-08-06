const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/inventory - Get current stock levels with search and status filter
router.get('/inventory', async (req, res) => {
    const { search = '', status = 'active' } = req.query;
    const searchTerm = `%${search}%`;

    let statusFilter = "AND p.is_active = TRUE";
    if (status === 'inactive') {
        statusFilter = "AND p.is_active = FALSE";
    } else if (status === 'all') {
        statusFilter = ""; // No status filter
    }

    try {
        const query = `
            SELECT
                p.part_id,
                p.internal_sku,
                p.detail,
                p.last_cost,
                p.reorder_point,
                p.warning_quantity,
                b.brand_name,
                g.group_name,
                (
                    SELECT COALESCE(SUM(it.quantity), 0) 
                    FROM inventory_transaction it 
                    WHERE it.part_id = p.part_id
                ) AS stock_on_hand,
                (
                    p.last_cost * (
                        SELECT COALESCE(SUM(it.quantity), 0) 
                        FROM inventory_transaction it 
                        WHERE it.part_id = p.part_id
                    )
                ) AS total_value
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE 
                (p.detail ILIKE $1 OR
                p.internal_sku ILIKE $1 OR
                b.brand_name ILIKE $1 OR
                g.group_name ILIKE $1)
                ${statusFilter}
            GROUP BY p.part_id, b.brand_name, g.group_name
            ORDER BY p.detail ASC;
        `;

        const { rows } = await db.query(query, [searchTerm]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/inventory/:partId/history
router.get('/inventory/:partId/history', async (req, res) => {
    const { partId } = req.params;
    try {
        const query = `
            SELECT it.*, e.first_name, e.last_name
            FROM inventory_transaction it
            LEFT JOIN employee e ON it.employee_id = e.employee_id
            WHERE it.part_id = $1
            ORDER BY it.transaction_date DESC;
        `;
        const { rows } = await db.query(query, [partId]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /api/inventory/adjust
router.post('/inventory/adjust', async (req, res) => {
    const { part_id, quantity, notes, employee_id } = req.body;

    if (!part_id || !quantity || !employee_id) {
        return res.status(400).json({ message: 'Part ID, quantity, and employee ID are required.' });
    }

    try {
        const transactionQuery = `
            INSERT INTO inventory_transaction (part_id, trans_type, quantity, notes, employee_id)
            VALUES ($1, 'Adjustment', $2, $3, $4) RETURNING *;
        `;
        const newTransaction = await db.query(transactionQuery, [part_id, quantity, notes, employee_id]);
        res.status(201).json(newTransaction.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;
