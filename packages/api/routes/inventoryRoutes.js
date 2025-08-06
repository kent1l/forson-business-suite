const express = require('express');
const db = require('../db');
const router = express.Router();

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
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
