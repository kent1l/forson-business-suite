const express = require('express');
const db = require('../db');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const { meiliClient } = require('../meilisearch'); // <-- 1. Import Meili client
const router = express.Router();

// GET /api/inventory - Get current stock levels with search
router.get('/inventory', async (req, res) => {
    const { search = '' } = req.query;

    try {
        // --- NEW: Hybrid Meilisearch + DB Query ---

        // 1. Get a list of part IDs from Meilisearch
        const index = meiliClient.index('parts');
        const searchResults = await index.search(search, {
            limit: 200, // Limit the number of results for performance
            attributesToRetrieve: ['part_id'], // We only need the ID
        });
        const partIds = searchResults.hits.map(hit => hit.part_id);

        // If Meilisearch returns no results, we can stop here.
        if (partIds.length === 0) {
            return res.json([]);
        }

        // 2. Use those IDs to get the full inventory data from PostgreSQL
        const query = `
            SELECT
                p.part_id,
                p.internal_sku,
                p.detail,
                p.wac_cost,
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
                ) AS stock_on_hand,
                (
                    p.wac_cost * (
                        SELECT COALESCE(SUM(it.quantity), 0) 
                        FROM inventory_transaction it 
                        WHERE it.part_id = p.part_id
                    )
                ) AS total_value
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE p.part_id = ANY($1::int[]) -- Use the IDs from Meilisearch
            GROUP BY p.part_id, b.brand_name, g.group_name
            ORDER BY p.detail ASC;
        `;

        const { rows } = await db.query(query, [partIds]);
        
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

// GET /api/inventory/:partId/history (This route remains unchanged)
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

// POST /api/inventory/adjust (This route remains unchanged)
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