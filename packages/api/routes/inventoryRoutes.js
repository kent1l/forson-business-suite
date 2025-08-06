const express = require('express');
const db = require('../db');
const router = express.Router();

// Helper function to construct the display name
const constructDisplayName = (part) => {
    const displayNameParts = [];
    const category = `${part.group_name || ''} (${part.brand_name || ''})`.replace('()', '').trim();
    if (category) displayNameParts.push(category);
    if (part.detail) displayNameParts.push(part.detail);
    if (part.part_numbers) displayNameParts.push(part.part_numbers);
    return displayNameParts.join(' | ');
};

// GET /api/inventory - Get current stock levels with search
router.get('/inventory', async (req, res) => {
    const { search = '' } = req.query;
    const searchTerm = `%${search}%`;

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
                    SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) 
                    FROM part_number pn 
                    WHERE pn.part_id = p.part_id
                ) AS part_numbers,
                (
                    SELECT COALESCE(SUM(it.quantity), 0) 
                    FROM inventory_transaction it 
                    WHERE it.part_id = p.part_id
                ) AS stock_on_hand
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE 
                p.detail ILIKE $1 OR
                p.internal_sku ILIKE $1 OR
                b.brand_name ILIKE $1 OR
                g.group_name ILIKE $1
            GROUP BY p.part_id, b.brand_name, g.group_name
            ORDER BY p.detail;
        `;

        const { rows } = await db.query(query, [searchTerm]);
        const inventoryWithDisplayName = rows.map(item => ({
            ...item,
            display_name: constructDisplayName(item)
        }));
        res.json(inventoryWithDisplayName);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ... (rest of the inventoryRoutes.js file remains the same)
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
