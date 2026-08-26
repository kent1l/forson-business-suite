const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const wacCorrection = require('../services/wacCorrectionService');

const router = express.Router();
const BASE = '/inventory/cost-correction';

function sendError(res, err, context) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error(`[${context}]`, err.message);
    return res.status(500).json({ message: 'Server error', error: err.message });
}

// Stock, cost, and cycle-count status for one part, so a manager can judge whether a
// receipt is genuinely missing before estimating anything.
router.get(`${BASE}/parts/:partId`, protect, hasPermission('wac_correction:manage'), async (req, res) => {
    try {
        const status = await wacCorrection.getPartStatus(db, req.params.partId);
        res.json(status);
    } catch (err) { sendError(res, err, 'cost-correction part status'); }
});

// Post the estimate directly. No draft or review step — this is the manager's own
// judgment call, made once.
router.post(`${BASE}/parts/:partId/estimate`, protect, hasPermission('wac_correction:manage'), async (req, res) => {
    const { quantity, unit_cost, notes } = req.body || {};
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await wacCorrection.postEstimate(client, req.params.partId, {
            quantity, unitCost: unit_cost, notes, employeeId: req.user.employee_id,
        });
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        sendError(res, err, 'cost-correction post estimate');
    } finally { client.release(); }
});

router.get(`${BASE}/audit-log`, protect, hasPermission('wac_correction:manage'), async (req, res) => {
    const { paginated, page, pageSize, limit, offset } = parsePaginationQuery(req.query);
    try {
        const { rows } = await db.query(
            `SELECT l.*, p.internal_sku,
                    (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = l.part_id) AS display_name,
                    e.first_name || ' ' || e.last_name AS actioned_by_name
               FROM wac_correction_audit_log l
               LEFT JOIN part p ON p.part_id = l.part_id
               LEFT JOIN employee e ON e.employee_id = l.actioned_by
              ORDER BY l.actioned_at DESC
              LIMIT $1 OFFSET $2`,
            [paginated ? limit : 100, paginated ? offset : 0]
        );
        if (!paginated) return res.json(rows);
        const { rows: [{ total }] } = await db.query(`SELECT COUNT(*)::int AS total FROM wac_correction_audit_log`);
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
    } catch (err) { sendError(res, err, 'cost-correction audit-log'); }
});

module.exports = router;
