const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const stockReconciliation = require('../services/stockReconciliationService');

const router = express.Router();
const BASE = '/inventory/reconciliations';
const PERM = 'stock_reconciliation:manage';

function sendError(res, err, context) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error(`[${context}]`, err.message);
    return res.status(500).json({ message: 'Server error', error: err.message });
}

// Automatic reconciliations awaiting a look, worst shortfall first. `filter=shortfall`
// narrows to the ones where documents prove more arrived than the count ever found —
// the cases that are a real finding rather than routine bookkeeping.
router.get(BASE, protect, hasPermission(PERM), async (req, res) => {
    const { status = 'OPEN', filter } = req.query;
    const { paginated, page, pageSize, limit, offset } = parsePaginationQuery(req.query);

    if (!['OPEN', 'REVIEWED', 'ALL'].includes(status)) {
        return res.status(400).json({ message: 'status must be OPEN, REVIEWED or ALL.' });
    }
    if (filter && filter !== 'shortfall') {
        return res.status(400).json({ message: "filter must be 'shortfall' if provided." });
    }

    const where = [];
    const params = [];
    if (status !== 'ALL') { params.push(status); where.push(`r.status = $${params.length}`); }
    if (filter === 'shortfall') where.push('r.unexplained_shortfall > 0');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
        const rowsQuery = `
            SELECT r.*, p.internal_sku,
                   (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = r.part_id) AS display_name,
                   e.first_name || ' ' || e.last_name AS reviewed_by_name
              FROM stock_reconciliation_log r
              LEFT JOIN part p ON p.part_id = r.part_id
              LEFT JOIN employee e ON e.employee_id = r.reviewed_by
              ${whereSql}
             ORDER BY COALESCE(r.unexplained_shortfall, 0) DESC, r.created_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        const { rows } = await db.query(rowsQuery, [...params, paginated ? limit : 200, paginated ? offset : 0]);

        const { rows: [summary] } = await db.query(
            `SELECT COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_count,
                    COUNT(*) FILTER (WHERE status = 'OPEN' AND unexplained_shortfall > 0)::int AS shortfall_count,
                    COALESCE(SUM(unexplained_shortfall) FILTER (WHERE status = 'OPEN' AND unexplained_shortfall > 0), 0) AS shortfall_units
               FROM stock_reconciliation_log`
        );

        if (!paginated) return res.json({ data: rows, summary });
        const { rows: [{ total }] } = await db.query(
            `SELECT COUNT(*)::int AS total FROM stock_reconciliation_log r ${whereSql}`, params
        );
        res.json({ ...paginatedResponse({ data: rows, page, pageSize, total }), summary });
    } catch (err) { sendError(res, err, 'reconciliations list'); }
});

// The whole story for one part: ledger with running balance, every cycle count, and
// every reconciliation, so the double-count and its correction are visible in sequence.
router.get(`${BASE}/parts/:partId/timeline`, protect, hasPermission(PERM), async (req, res) => {
    try {
        const timeline = await stockReconciliation.partTimeline(db, req.params.partId);
        if (!timeline.part) return res.status(404).json({ message: 'Part not found.' });
        res.json(timeline);
    } catch (err) { sendError(res, err, 'reconciliation timeline'); }
});

router.post(`${BASE}/:reconId/review`, protect, hasPermission(PERM), async (req, res) => {
    const { notes } = req.body || {};
    try {
        const { rows } = await db.query(
            `UPDATE stock_reconciliation_log
                SET status = 'REVIEWED', reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP,
                    review_notes = $3
              WHERE recon_id = $1 AND status = 'OPEN'
              RETURNING recon_id`,
            [req.params.reconId, req.user.employee_id, notes || null]
        );
        if (rows.length === 0) {
            return res.status(400).json({ message: 'That reconciliation was not found or has already been reviewed.' });
        }
        res.json({ recon_id: rows[0].recon_id, status: 'REVIEWED' });
    } catch (err) { sendError(res, err, 'reconciliation review'); }
});

module.exports = router;
