const express = require('express');
const db = require('../db');
const { meiliClient } = require('../meilisearch');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const router = express.Router();

// GET /api/power-search/parts - Advanced multi-filter search using Meilisearch
router.get('/power-search/parts', async (req, res) => {
    const { keyword, brand, group, application, year } = req.query;

    try {
        const index = meiliClient.index('parts');
        const searchOptions = {
            limit: 200, // increase limit to return more matches for UI
            attributesToRetrieve: ['part_id']
        };

        const searchResults = await index.search(keyword || '', searchOptions);
        const partIds = searchResults.hits.map(h => h.part_id);

        if (partIds.length === 0) return res.json([]);

        // Fetch stock and sale price and other display fields from DB
        const query = `
            SELECT
                p.part_id,
                p.internal_sku,
                p.detail,
                p.last_sale_price,
                b.brand_name,
                g.group_name,
                (
                    SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order)
                    FROM part_number pn WHERE pn.part_id = p.part_id
                ) AS part_numbers,
                (
                    SELECT COALESCE(SUM(it.quantity), 0) FROM inventory_transaction it WHERE it.part_id = p.part_id
                ) AS stock_on_hand
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE p.part_id = ANY($1::int[])
            ORDER BY p.detail ASC;
        `;

        const { rows } = await db.query(query, [partIds]);
        const parts = rows.map(p => ({
            ...p,
            display_name: constructDisplayName(p),
            applications: searchResults.hits.find(h => h.part_id === p.part_id)?.applications || null
        }));

        res.json(parts);
    } catch (err) {
        console.error('Meilisearch Error:', err.message);
        res.status(500).send('Server Error during search.');
    }
});

module.exports = router;