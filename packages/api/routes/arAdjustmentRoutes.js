'use strict';

/**
 * Post-invoice A/R concessions.
 *
 * Phase 1 surface: the standalone write-down, plus reading and reversing.
 * Settlement discounts granted alongside a collection extend POST /payments
 * instead, so the cash and the concession are recorded in one transaction.
 *
 * Authorization here is permission-only: a holder of ar:discount_grant acts
 * directly. The inline "have a manager authorize me" path arrives with the
 * counter flows, where it is actually needed — the standalone write-down is a
 * back-office action taken by someone who already holds the permission.
 */

const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const arAdjustment = require('../services/arAdjustmentService');

const router = express.Router();

/** Maps a thrown service/period-lock error onto its HTTP status. */
function sendError(res, err, fallback) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error(`${fallback}:`, err);
    res.status(status).json({ message: status >= 500 ? fallback : err.message });
}

// ── Reason codes ────────────────────────────────────────────────
// GET /ar/adjustment-reasons?applies_to=WRITE_DOWN&include_inactive=1
router.get('/ar/adjustment-reasons', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const reasons = await arAdjustment.listReasons(db, {
            activeOnly: req.query.include_inactive !== '1' && req.query.include_inactive !== 'true',
            appliesTo: req.query.applies_to || null,
        });
        res.json(reasons);
    } catch (err) {
        sendError(res, err, 'Failed to load adjustment reasons');
    }
});

// PUT /ar/adjustment-reasons/:code — Admin Settings maintenance.
// reason_code and gl_treatment are deliberately not editable: historical
// documents reference the code, and re-tagging the accounting treatment of a
// reason would silently restate every concession already posted under it.
router.put('/ar/adjustment-reasons/:code', protect, hasPermission('settings:edit'), async (req, res) => {
    const { label, description, applies_to, max_amount, requires_note, is_active, sort_order } = req.body;
    try {
        const { rows: [updated] } = await db.query(
            `UPDATE ar_adjustment_reason
                SET label         = COALESCE($2, label),
                    description   = COALESCE($3, description),
                    applies_to    = COALESCE($4, applies_to),
                    max_amount    = $5,
                    requires_note = COALESCE($6, requires_note),
                    is_active     = COALESCE($7, is_active),
                    sort_order    = COALESCE($8, sort_order)
              WHERE reason_code = $1
              RETURNING *`,
            [req.params.code, label ?? null, description ?? null, applies_to ?? null,
             max_amount === undefined || max_amount === '' ? null : max_amount,
             requires_note ?? null, is_active ?? null, sort_order ?? null]
        );
        if (!updated) return res.status(404).json({ message: 'Reason code not found.' });
        res.json(updated);
    } catch (err) {
        sendError(res, err, 'Failed to update adjustment reason');
    }
});

// ── The open balance a concession can be written against ────────
// GET /ar/customers/:customerId/adjustable-invoices
router.get('/ar/customers/:customerId/adjustable-invoices', protect, hasPermission('ar:view'), async (req, res) => {
    const customerId = parseInt(req.params.customerId, 10);
    if (!customerId) return res.status(400).json({ message: 'Invalid customer ID' });
    try {
        // Outstanding is computed the same way recompute_invoice_settlement()
        // computes it, so what the modal offers and what the server will accept
        // cannot disagree.
        const { rows } = await db.query(
            `SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.due_date, i.status,
                    i.total_amount, i.physical_receipt_no,
                    GREATEST(
                      GREATEST(i.total_amount - COALESCE((SELECT SUM(total_amount) FROM credit_note
                                                           WHERE invoice_id = i.invoice_id), 0), 0)
                      - (
                        COALESCE((SELECT SUM(amount_paid) FROM invoice_payments
                                   WHERE invoice_id = i.invoice_id AND payment_status = 'settled'), 0)
                      + COALESCE((SELECT SUM(ipa.amount_allocated) FROM invoice_payment_allocation ipa
                                   JOIN customer_payment cp ON cp.payment_id = ipa.payment_id
                                  WHERE ipa.invoice_id = i.invoice_id
                                    AND cp.pdc_status IS DISTINCT FROM 'BOUNCED'), 0)
                      + COALESCE((SELECT SUM(aa.amount) FROM ar_adjustment_allocation aa
                                   JOIN ar_adjustment adj ON adj.adjustment_id = aa.adjustment_id
                                  WHERE aa.invoice_id = i.invoice_id AND adj.status = 'POSTED'
                                    AND adj.reverses_adjustment_id IS NULL), 0)
                      ), 0) AS outstanding
               FROM invoice i
              WHERE i.customer_id = $1
                AND i.status NOT IN ('Cancelled', 'Fully Refunded')
              ORDER BY i.invoice_date, i.invoice_id`,
            [customerId]
        );
        res.json(rows.filter(r => Number(r.outstanding) > 0.005));
    } catch (err) {
        sendError(res, err, 'Failed to load adjustable invoices');
    }
});

// ── Create a standalone concession ──────────────────────────────
// POST /ar/adjustments
router.post('/ar/adjustments', protect, hasPermission('ar:discount_grant'), async (req, res) => {
    const { employee_id } = req.user;
    const {
        customer_id,
        adjustment_type = 'BALANCE_WRITE_DOWN',
        reason_code,
        notes,
        entry_date,
        client_ref,
        allocations,
    } = req.body;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const doc = await arAdjustment.createAdjustment(client, {
            customerId: customer_id,
            adjustmentType: adjustment_type,
            reasonCode: reason_code,
            allocations,
            notes,
            grantedBy: employee_id,
            clientRef: client_ref || null,
            entryDate: entry_date || null,
        });
        await client.query('COMMIT');
        res.status(201).json(doc);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        sendError(res, err, 'Failed to record adjustment');
    } finally {
        client.release();
    }
});

// POST /ar/adjustments/:id/reverse
router.post('/ar/adjustments/:id/reverse', protect, hasPermission('ar:adjustment_reverse'), async (req, res) => {
    const adjustmentId = parseInt(req.params.id, 10);
    if (!adjustmentId) return res.status(400).json({ message: 'Invalid adjustment ID' });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const reversal = await arAdjustment.reverseAdjustment(client, {
            adjustmentId,
            reason: req.body.reason,
            employeeId: req.user.employee_id,
        });
        await client.query('COMMIT');
        res.status(201).json(reversal);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        sendError(res, err, 'Failed to reverse adjustment');
    } finally {
        client.release();
    }
});

// ── Reading ─────────────────────────────────────────────────────
// GET /ar/adjustments
router.get('/ar/adjustments', protect, hasPermission('ar:view'), async (req, res) => {
    const { page, pageSize, offset, limit, paginated } = parsePaginationQuery(req.query);
    const filters = [];
    const params = [];
    const add = (sql, value) => { params.push(value); filters.push(sql.replace('$?', `$${params.length}`)); };

    if (req.query.customer_id)     add('a.customer_id = $?', parseInt(req.query.customer_id, 10));
    // Lets a ledger row, which knows its document only by the reference number
    // printed on it, resolve straight to the document rather than pulling the
    // customer's whole history to search client-side.
    if (req.query.adjustment_no)   add('a.adjustment_no = $?', req.query.adjustment_no);
    if (req.query.reason_code)     add('a.reason_code = $?', req.query.reason_code);
    if (req.query.adjustment_type) add('a.adjustment_type = $?', req.query.adjustment_type);
    if (req.query.status)          add('a.status = $?', req.query.status);
    if (req.query.granted_by)      add('a.granted_by = $?', parseInt(req.query.granted_by, 10));
    if (req.query.authorized_by)   add('a.authorized_by = $?', parseInt(req.query.authorized_by, 10));
    if (req.query.date_from)       add('a.entry_date >= $?', req.query.date_from);
    if (req.query.date_to)         add('a.entry_date <= $?', req.query.date_to);

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    try {
        const listSql = `
            SELECT a.adjustment_id, a.adjustment_no, a.customer_id, a.adjustment_type,
                   a.reason_code, r.label AS reason_label, r.gl_treatment,
                   a.total_amount, a.notes, a.status, a.entry_date, a.created_at,
                   a.authorization_method, a.reverses_adjustment_id,
                   COALESCE(c.company_name, TRIM(c.first_name || ' ' || COALESCE(c.last_name, ''))) AS customer_name,
                   g.username AS granted_by_username,
                   z.username AS authorized_by_username,
                   (SELECT COUNT(*) FROM ar_adjustment_allocation aa WHERE aa.adjustment_id = a.adjustment_id) AS invoice_count
              FROM ar_adjustment a
              JOIN ar_adjustment_reason r ON r.reason_code = a.reason_code
              JOIN customer c             ON c.customer_id = a.customer_id
              LEFT JOIN employee g        ON g.employee_id = a.granted_by
              LEFT JOIN employee z        ON z.employee_id = a.authorized_by
              ${where}
             ORDER BY a.entry_date DESC, a.adjustment_id DESC`;

        if (!paginated) {
            const { rows } = await db.query(listSql, params);
            return res.json(rows);
        }

        const { rows: [{ count }] } = await db.query(
            `SELECT COUNT(*)::int AS count FROM ar_adjustment a ${where}`, params
        );
        const { rows } = await db.query(
            `${listSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );
        res.json(paginatedResponse({ data: rows, page, pageSize, total: count }));
    } catch (err) {
        sendError(res, err, 'Failed to list adjustments');
    }
});

// GET /ar/adjustments/summary
// The bookkeeper's posting sheet, and the concession-rate view worth watching.
// Registered before /ar/adjustments/:id so 'summary' is not read as an id.
router.get('/ar/adjustments/summary', protect, hasPermission('ar:view'), async (req, res) => {
    const params = [];
    const filters = ["a.status = 'POSTED'", 'a.reverses_adjustment_id IS NULL'];
    if (req.query.date_from) { params.push(req.query.date_from); filters.push(`a.entry_date >= $${params.length}`); }
    if (req.query.date_to)   { params.push(req.query.date_to);   filters.push(`a.entry_date <= $${params.length}`); }
    const where = `WHERE ${filters.join(' AND ')}`;

    try {
        const [byReason, byEmployee, byCustomer, totals] = await Promise.all([
            db.query(`
                SELECT a.reason_code, r.label AS reason_label, r.gl_treatment,
                       COUNT(*)::int AS count, SUM(a.total_amount) AS total
                  FROM ar_adjustment a
                  JOIN ar_adjustment_reason r ON r.reason_code = a.reason_code
                  ${where}
                 GROUP BY a.reason_code, r.label, r.gl_treatment
                 ORDER BY SUM(a.total_amount) DESC`, params),
            db.query(`
                SELECT a.granted_by, g.username AS granted_by_username,
                       a.authorized_by, z.username AS authorized_by_username,
                       COUNT(*)::int AS count, SUM(a.total_amount) AS total
                  FROM ar_adjustment a
                  LEFT JOIN employee g ON g.employee_id = a.granted_by
                  LEFT JOIN employee z ON z.employee_id = a.authorized_by
                  ${where}
                 GROUP BY a.granted_by, g.username, a.authorized_by, z.username
                 ORDER BY SUM(a.total_amount) DESC`, params),
            db.query(`
                SELECT a.customer_id,
                       COALESCE(c.company_name, TRIM(c.first_name || ' ' || COALESCE(c.last_name, ''))) AS customer_name,
                       COUNT(*)::int AS count, SUM(a.total_amount) AS total
                  FROM ar_adjustment a
                  JOIN customer c ON c.customer_id = a.customer_id
                  ${where}
                 GROUP BY a.customer_id, c.company_name, c.first_name, c.last_name
                 ORDER BY SUM(a.total_amount) DESC
                 LIMIT 25`, params),
            db.query(`
                SELECT COUNT(*)::int AS count,
                       COALESCE(SUM(a.total_amount), 0) AS total,
                       COALESCE(SUM(a.total_amount) FILTER (WHERE r.gl_treatment = 'CONTRA_REVENUE'), 0)   AS contra_revenue,
                       COALESCE(SUM(a.total_amount) FILTER (WHERE r.gl_treatment = 'BAD_DEBT_EXPENSE'), 0) AS bad_debt_expense
                  FROM ar_adjustment a
                  JOIN ar_adjustment_reason r ON r.reason_code = a.reason_code
                  ${where}`, params),
        ]);

        res.json({
            totals: totals.rows[0],
            by_reason: byReason.rows,
            by_employee: byEmployee.rows,
            by_customer: byCustomer.rows,
        });
    } catch (err) {
        sendError(res, err, 'Failed to build adjustment summary');
    }
});

// GET /ar/adjustments/:id
router.get('/ar/adjustments/:id', protect, hasPermission('ar:view'), async (req, res) => {
    const adjustmentId = parseInt(req.params.id, 10);
    if (!adjustmentId) return res.status(400).json({ message: 'Invalid adjustment ID' });
    try {
        const doc = await arAdjustment.getAdjustment(db, adjustmentId);
        if (!doc) return res.status(404).json({ message: 'Adjustment not found.' });
        res.json(doc);
    } catch (err) {
        sendError(res, err, 'Failed to load adjustment');
    }
});

module.exports = router;
