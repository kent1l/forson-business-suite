const express = require('express');
const db = require('../db');
const { meiliClient } = require('../meilisearch'); // <-- 1. Import Meili client
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const router = express.Router();

// GET /api/inventory - Get current stock levels with search
router.get('/inventory', async (req, res) => {
    const { search = '' } = req.query;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
    const sortBy = String(req.query.sortBy || 'name').toLowerCase();
    const sortDirection = String(req.query.sortDirection || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const isGlobalSort = ['sku', 'name', 'display_name', 'stock_on_hand', 'wac', 'total_value'].includes(sortBy);

    try {
        // --- NEW: Hybrid Meilisearch + DB Query ---

        // 1. Get a list of part IDs from Meilisearch
        const index = meiliClient.index('parts');
        const metadataResults = paginated && isGlobalSort
            ? await index.search(search, { limit: 0, offset: 0, attributesToRetrieve: ['part_id'] })
            : null;
        const totalHits = metadataResults?.estimatedTotalHits || metadataResults?.totalHits || 0;
        const fetchLimit = paginated && isGlobalSort
            ? Math.min(totalHits, 20000)
            : (paginated ? limit : 200);
        const fetchOffset = paginated && isGlobalSort ? 0 : (paginated ? offset : 0);

        const searchResults = await index.search(search, {
            limit: fetchLimit,
            offset: fetchOffset,
            attributesToRetrieve: ['part_id'], // We only need the ID
        });
        // Ensure we send integer IDs to Postgres (Meili may return strings)
        const partIds = searchResults.hits
            .map(hit => parseInt(hit.part_id, 10))
            .filter(id => !Number.isNaN(id));

        // If Meilisearch returns no results, we can stop here.
        if (partIds.length === 0) {
            if (paginated) {
                return res.json(paginatedResponse({ data: [], page, pageSize, total: 0 }));
            }
            return res.json([]);
        }

        // 2. Use those IDs to get the full inventory data from PostgreSQL
        // Compute stock_on_hand once in a CTE to avoid duplicate subqueries and
        // coalesce wac_cost to 0 so total_value is deterministic.
        const queryParams = [partIds];
        const sqlOffset = isGlobalSort && paginated ? 'LIMIT $2 OFFSET $3' : '';
        if (isGlobalSort && paginated) {
            queryParams.push(limit, offset);
        }
        let orderByClause = 'ORDER BY p.detail ASC';
        if (isGlobalSort) {
            if (sortBy === 'sku') {
                orderByClause = `ORDER BY LOWER(COALESCE(p.internal_sku, '')) ${sortDirection}, p.part_id ${sortDirection}`;
            } else if (sortBy === 'stock_on_hand') {
                orderByClause = `ORDER BY COALESCE(s.stock_on_hand, 0) ${sortDirection}, p.part_id ${sortDirection}`;
            } else if (sortBy === 'wac') {
                orderByClause = `ORDER BY COALESCE(p.wac_cost, 0) ${sortDirection}, p.part_id ${sortDirection}`;
            } else if (sortBy === 'total_value') {
                orderByClause = `ORDER BY (COALESCE(p.wac_cost, 0) * COALESCE(s.stock_on_hand, 0)) ${sortDirection}, p.part_id ${sortDirection}`;
            } else {
                orderByClause = `ORDER BY LOWER(COALESCE(g.group_name, '') || ' ' || COALESCE(b.brand_name, '') || ' ' || COALESCE(p.detail, '')) ${sortDirection}, p.part_id ${sortDirection}`;
            }
        }

        const query = `
            WITH stock AS (
                SELECT part_id, COALESCE(SUM(quantity), 0) AS stock_on_hand
                FROM inventory_transaction
                GROUP BY part_id
            )
            SELECT
                p.part_id,
                p.internal_sku,
                p.detail,
                COALESCE(p.wac_cost, 0) AS wac_cost,
                p.reorder_point,
                p.warning_quantity,
                b.brand_name,
                g.group_name,
                (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                (
                    SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order)
                    FROM part_number pn
                    WHERE pn.part_id = p.part_id
                ) AS part_numbers,
                COALESCE(s.stock_on_hand, 0) AS stock_on_hand,
                (COALESCE(p.wac_cost, 0) * COALESCE(s.stock_on_hand, 0))::numeric(14,2) AS total_value
            FROM part p
            LEFT JOIN stock s ON s.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE p.part_id = ANY($1::int[])
            ${orderByClause}
            ${sqlOffset};
        `;

        const { rows } = await db.query(query, queryParams);

        if (!paginated) {
            return res.json(rows);
        }
        const total = isGlobalSort
            ? (totalHits || rows.length)
            : (searchResults.estimatedTotalHits || searchResults.totalHits || rows.length);
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
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
