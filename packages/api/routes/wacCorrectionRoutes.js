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

// ── Encoder side ────────────────────────────────────────────────

// Parts assigned to the signed-in encoder that still need cost research.
router.get(`${BASE}/my-tasks`, protect, hasPermission('wac_correction:propose'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT wcl.line_id, wcl.part_id, wcl.status, wcl.system_qty_snapshot, wcl.counted_qty,
                    wcl.wac_before, wcl.impact_estimate, wcl.review_notes,
                    p.internal_sku, p.detail, b.brand_name, g.group_name,
                    (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                    s.supplier_name,
                    (SELECT COUNT(*)::int FROM wac_correction_entry e WHERE e.line_id = wcl.line_id) AS entry_count
               FROM wac_correction_line wcl
               JOIN wac_correction_batch wcb ON wcb.batch_id = wcl.batch_id
               JOIN part p ON p.part_id = wcl.part_id
               LEFT JOIN brand b ON b.brand_id = p.brand_id
               LEFT JOIN "group" g ON g.group_id = p.group_id
               LEFT JOIN supplier s ON s.supplier_id = wcb.supplier_id
              WHERE wcb.employee_id = $1 AND wcl.status IN ('PENDING', 'PROPOSED')
              ORDER BY wcl.impact_estimate DESC NULLS LAST`,
            [req.user.employee_id]
        );
        res.json(rows);
    } catch (err) { sendError(res, err, 'cost-correction my-tasks'); }
});

// Everything the encoder needs to research one part: the queued line, the entries
// gathered so far, and the ledger history that explains how it got into this state.
router.get(`${BASE}/lines/:id`, protect, hasPermission('wac_correction:propose'), async (req, res) => {
    const client = await db.getClient();
    try {
        const projection = await wacCorrection.projectLine(client, req.params.id);
        const { rows: entries } = await client.query(
            `SELECT * FROM wac_correction_entry WHERE line_id = $1 ORDER BY date_received ASC, entry_id ASC`,
            [req.params.id]
        );
        const { rows: history } = await client.query(
            `SELECT trans_type, quantity, unit_cost, reference_no, transaction_date
               FROM inventory_transaction WHERE part_id = $1
              ORDER BY transaction_date DESC LIMIT 50`,
            [projection.line.part_id]
        );
        res.json({ ...projection, entries, history });
    } catch (err) { sendError(res, err, 'cost-correction line detail'); }
    finally { client.release(); }
});

// Save reconstructed receipts and send the line for review. Writes nothing to the ledger.
router.post(`${BASE}/lines/:id/propose`, protect, hasPermission('wac_correction:propose'), async (req, res) => {
    const { entries, gap_unit_cost, notes } = req.body;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await wacCorrection.proposeCorrection(client, req.params.id, {
            entries, gapUnitCost: gap_unit_cost, notes, employeeId: req.user.employee_id,
        });
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        sendError(res, err, 'cost-correction propose');
    } finally { client.release(); }
});

// ── Manager side ────────────────────────────────────────────────

router.get(`${BASE}/review`, protect, hasPermission('wac_correction:approve'), async (req, res) => {
    const { paginated, page, pageSize, limit, offset } = parsePaginationQuery(req.query);
    try {
        const { rows } = await db.query(
            `SELECT wcl.line_id, wcl.part_id, wcl.status, wcl.system_qty_snapshot, wcl.counted_qty,
                    wcl.wac_before, wcl.impact_estimate, wcl.gap_qty, wcl.gap_unit_cost,
                    wcl.proposed_at, wcl.review_notes,
                    p.internal_sku, p.detail,
                    (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                    e.first_name || ' ' || e.last_name AS proposed_by_name,
                    (SELECT COUNT(*)::int FROM wac_correction_entry en WHERE en.line_id = wcl.line_id) AS entry_count,
                    (SELECT COUNT(*)::int FROM wac_correction_entry en WHERE en.line_id = wcl.line_id AND en.is_estimate) AS estimate_count
               FROM wac_correction_line wcl
               JOIN part p ON p.part_id = wcl.part_id
               LEFT JOIN employee e ON e.employee_id = wcl.proposed_by
              WHERE wcl.status = 'PENDING_MANAGER_REVIEW'
              ORDER BY wcl.impact_estimate DESC NULLS LAST
              LIMIT $1 OFFSET $2`,
            [paginated ? limit : 200, paginated ? offset : 0]
        );
        if (!paginated) return res.json(rows);
        const { rows: [{ total }] } = await db.query(
            `SELECT COUNT(*)::int AS total FROM wac_correction_line WHERE status = 'PENDING_MANAGER_REVIEW'`
        );
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
    } catch (err) { sendError(res, err, 'cost-correction review'); }
});

router.post(`${BASE}/lines/:id/approve`, protect, hasPermission('wac_correction:approve'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await wacCorrection.approveCorrection(client, req.params.id, {
            employeeId: req.user.employee_id, notes: req.body?.notes,
        });
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        sendError(res, err, 'cost-correction approve');
    } finally { client.release(); }
});

router.post(`${BASE}/lines/:id/send-back`, protect, hasPermission('wac_correction:approve'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await wacCorrection.rejectCorrection(client, req.params.id, {
            employeeId: req.user.employee_id, notes: req.body?.notes,
        });
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        sendError(res, err, 'cost-correction send-back');
    } finally { client.release(); }
});

// Queue the highest-impact parts that already have an approved cycle count.
router.post(`${BASE}/generate-batch`, protect, hasPermission('wac_correction:approve'), async (req, res) => {
    const { employee_id, supplier_id, limit } = req.body || {};
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await wacCorrection.generateBatch(client, {
            employeeId: employee_id || null,
            supplierId: supplier_id || null,
            limit: Math.min(Number(limit) || 50, 200),
            createdBy: req.user.employee_id,
        });
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        sendError(res, err, 'cost-correction generate-batch');
    } finally { client.release(); }
});

router.get(`${BASE}/audit-log`, protect, hasPermission('wac_correction:approve'), async (req, res) => {
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
