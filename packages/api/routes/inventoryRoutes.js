const express = require('express');
const db = require('../db');
const { meiliClient } = require('../meilisearch'); // <-- 1. Import Meili client
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { validateCapturedAt, offlineNote } = require('../services/offlineCaptureService');
const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/inventory - Get current stock levels with search
router.get('/inventory', protect, hasPermission('inventory:view'), async (req, res) => {
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
router.get('/inventory/:partId/history', protect, hasPermission('inventory:view'), async (req, res) => {
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
/**
 * Records a manual stock adjustment.
 *
 * The actor is taken from the token, never from the body. This used to require
 * an `employee_id` in the request and write it verbatim, which meant anyone
 * holding `inventory:adjust` could attribute a stock change to a colleague --
 * and an audit trail that can be addressed to someone else is not an audit
 * trail. Clients may still send the field; it is ignored.
 */
router.post('/inventory/adjust', protect, hasPermission('inventory:adjust'), async (req, res) => {
    const { part_id, quantity, notes, client_ref, captured_at } = req.body;

    if (!part_id) {
        return res.status(400).json({ message: 'Part ID is required.' });
    }
    // Separated from the missing-field case: an adjustment queued on a phone
    // that fails here is parked for a human to read, so "you sent nothing" and
    // "you sent zero" must not arrive as the same sentence.
    const parsedQuantity = Number(quantity);
    if (quantity === undefined || quantity === null || quantity === '') {
        return res.status(400).json({ message: 'Quantity is required.' });
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity === 0) {
        return res.status(400).json({ message: 'Quantity must be a non-zero number.' });
    }
    if (client_ref && !UUID_RE.test(client_ref)) {
        return res.status(400).json({ message: 'client_ref must be a UUID' });
    }

    // An adjustment is a delta against a stock level the device saw some time
    // ago. Past the window that reading is too stale to apply blindly, and a
    // recount is the honest answer.
    const capture = await validateCapturedAt(captured_at, {
        tooOldCode: 'ADJUSTMENT_TOO_OLD',
        tooOldMessage: (hours, limitHours) =>
            `That adjustment was made ${Math.round(hours)} hours ago, beyond the `
            + `${Math.round(limitHours)}-hour limit for offline adjustments. `
            + 'Please recount the item and enter it again.',
    });
    if (!capture.ok) return res.status(capture.status).json(capture.body);

    const finalNotes = capture.isOffline
        ? [notes, offlineNote(capture.driftMinutes)].filter(Boolean).join(' ')
        : notes;

    try {
        // A retry of an adjustment that already landed resolves to the original
        // rather than appending a second delta. Without this the quantity moves
        // twice and leaves two equally plausible audit rows behind.
        if (client_ref) {
            const { rows: existing } = await db.query(
                'SELECT * FROM inventory_transaction WHERE client_ref = $1', [client_ref]
            );
            if (existing.length > 0) {
                return res.status(200).json({ ...existing[0], duplicate: true });
            }
        }

        // transaction_date stays at receipt time even when captured_at is set.
        // Stock on hand is a running SUM over this table, so dating a row into
        // the past rewrites every on-hand figure since -- captured_at records
        // when it happened without moving the ledger underneath anyone.
        const transactionQuery = `
            INSERT INTO inventory_transaction (part_id, trans_type, quantity, notes, employee_id, client_ref, captured_at)
            VALUES ($1, 'Adjustment', $2, $3, $4, $5, $6) RETURNING *;
        `;
        const newTransaction = await db.query(transactionQuery, [
            part_id, parsedQuantity, finalNotes, req.user.employee_id, client_ref || null, capture.capturedAt
        ]);
        res.status(201).json(newTransaction.rows[0]);
    } catch (err) {
        // Two flushes of the same queued adjustment can both pass the lookup
        // above and race to insert. The unique index is what actually enforces
        // this, so a violation means the other attempt won -- a success.
        if (err.code === '23505' && client_ref) {
            try {
                const { rows } = await db.query(
                    'SELECT * FROM inventory_transaction WHERE client_ref = $1', [client_ref]
                );
                if (rows.length > 0) {
                    return res.status(200).json({ ...rows[0], duplicate: true });
                }
            } catch { /* fall through to the generic error below */ }
        }

        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;
