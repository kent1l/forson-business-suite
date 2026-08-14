const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const dtrService = require('../services/hr/dtrService');

const router = express.Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const LEAVE_SELECT = `
    lr.leave_id, lr.employee_id, lr.leave_type_id,
    TO_CHAR(lr.date_from, 'YYYY-MM-DD') AS date_from,
    TO_CHAR(lr.date_to, 'YYYY-MM-DD') AS date_to,
    lr.day_fraction, lr.total_days, lr.status, lr.reason, lr.decision_note,
    lr.approved_at,
    lt.leave_code, lt.leave_name, lt.is_paid,
    e.employee_code,
    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
    NULLIF(TRIM(CONCAT_WS(' ', a.first_name, a.last_name)), '') AS approved_by_name
`;

const LEAVE_JOINS = `
    FROM leave_request lr
    JOIN leave_type lt ON lr.leave_type_id = lt.leave_type_id
    JOIN employee e ON lr.employee_id = e.employee_id
    LEFT JOIN employee a ON lr.approved_by = a.employee_id
`;

// --- Leave types ---------------------------------------------------------

router.get('/types', protect, hasPermission('leave:view'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT leave_type_id, leave_code, leave_name, description, is_paid,
                    default_days_per_year, requires_approval, is_active, sort_order
             FROM leave_type
             ${req.query.status === 'all' ? '' : 'WHERE is_active = TRUE'}
             ORDER BY sort_order, leave_name`
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.put('/types/:id', protect, hasPermission('leave:manage'), async (req, res) => {
    const { leave_name, description, is_paid, default_days_per_year, requires_approval, is_active, sort_order } = req.body;
    if (!leave_name || !leave_name.trim()) {
        return res.status(400).json({ message: 'Leave name is required' });
    }
    try {
        const { rows } = await db.query(
            `UPDATE leave_type
             SET leave_name = $1, description = $2, is_paid = $3, default_days_per_year = $4,
                 requires_approval = $5, is_active = $6, sort_order = $7,
                 modified_by = $8, updated_at = now()
             WHERE leave_type_id = $9 RETURNING *`,
            [leave_name.trim(), description || null, is_paid !== false,
                default_days_per_year || null, requires_approval !== false,
                is_active !== false, sort_order || 0, req.user.employee_id, req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Leave type not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Balances ------------------------------------------------------------

router.get('/balances/:employeeId', protect, hasPermission('leave:view'), async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    try {
        // Every active leave type is returned, with zeroes where no balance row
        // exists yet, so the UI shows a complete picture rather than gaps.
        const { rows } = await db.query(
            `SELECT lt.leave_type_id, lt.leave_code, lt.leave_name, lt.is_paid,
                    COALESCE(b.entitled_days, 0)     AS entitled_days,
                    COALESCE(b.carried_over_days, 0) AS carried_over_days,
                    COALESCE(b.used_days, 0)         AS used_days,
                    COALESCE(b.entitled_days, 0) + COALESCE(b.carried_over_days, 0)
                        - COALESCE(b.used_days, 0)   AS remaining_days,
                    b.balance_id
             FROM leave_type lt
             LEFT JOIN employee_leave_balance b
                    ON b.leave_type_id = lt.leave_type_id
                   AND b.employee_id = $1 AND b.year = $2
             WHERE lt.is_active = TRUE
             ORDER BY lt.sort_order, lt.leave_name`,
            [req.params.employeeId, year]
        );
        res.json({ employee_id: Number(req.params.employeeId), year, balances: rows });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.put('/balances/:employeeId', protect, hasPermission('leave:manage'), async (req, res) => {
    const { leave_type_id, year, entitled_days, carried_over_days, notes } = req.body;
    if (!leave_type_id || !year) {
        return res.status(400).json({ message: 'leave_type_id and year are required' });
    }
    try {
        // used_days is intentionally not settable — it is derived from approved
        // requests by the recalc_leave_balance trigger.
        const { rows } = await db.query(
            `INSERT INTO employee_leave_balance
                (employee_id, leave_type_id, year, entitled_days, carried_over_days, notes, created_by, modified_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
             ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE
             SET entitled_days = EXCLUDED.entitled_days,
                 carried_over_days = EXCLUDED.carried_over_days,
                 notes = EXCLUDED.notes,
                 modified_by = EXCLUDED.modified_by,
                 updated_at = now()
             RETURNING *`,
            [req.params.employeeId, leave_type_id, year,
                Number(entitled_days) || 0, Number(carried_over_days) || 0,
                notes || null, req.user.employee_id]
        );
        res.json(rows[0]);
    } catch (err) {
        if (err.code === '23503') return res.status(404).json({ message: 'Employee or leave type not found' });
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Requests ------------------------------------------------------------

router.get('/requests', protect, hasPermission('leave:view'), async (req, res) => {
    const { employee_id, status, from, to } = req.query;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);

    const conditions = [];
    const params = [];
    let idx = 1;
    if (employee_id) { conditions.push(`lr.employee_id = $${idx++}`); params.push(Number(employee_id)); }
    if (status) { conditions.push(`lr.status = $${idx++}`); params.push(status); }
    if (from && ISO_DATE.test(from)) { conditions.push(`lr.date_to >= $${idx++}`); params.push(from); }
    if (to && ISO_DATE.test(to)) { conditions.push(`lr.date_from <= $${idx++}`); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const base = `SELECT ${LEAVE_SELECT} ${LEAVE_JOINS} ${where} ORDER BY lr.date_from DESC, lr.leave_id DESC`;

    try {
        if (!paginated) {
            const { rows } = await db.query(base, params);
            return res.json(rows);
        }
        const countRes = await db.query(`SELECT COUNT(*)::int AS total ${LEAVE_JOINS} ${where}`, params);
        const { rows } = await db.query(`${base} LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limit, offset]);
        res.json(paginatedResponse({ data: rows, page, pageSize, total: countRes.rows[0]?.total || 0 }));
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/requests', protect, hasPermission('leave:request'), async (req, res) => {
    const { employee_id, leave_type_id, date_from, date_to, day_fraction = 1, reason } = req.body;

    if (!employee_id || !leave_type_id) {
        return res.status(400).json({ message: 'employee_id and leave_type_id are required' });
    }
    if (!ISO_DATE.test(date_from || '') || !ISO_DATE.test(date_to || '')) {
        return res.status(400).json({ message: 'date_from and date_to are required in YYYY-MM-DD format' });
    }
    if (date_to < date_from) {
        return res.status(400).json({ message: 'date_to must be on or after date_from' });
    }
    const fraction = Number(day_fraction);
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
        return res.status(400).json({ message: 'day_fraction must be between 0 and 1' });
    }

    try {
        // Rest days and holidays inside the span are not charged to the balance.
        const totalDays = await dtrService.countLeaveWorkingDays(db, {
            employeeId: employee_id, dateFrom: date_from, dateTo: date_to, dayFraction: fraction,
        });

        const { rows } = await db.query(
            `INSERT INTO leave_request
                (employee_id, leave_type_id, date_from, date_to, day_fraction, total_days, reason, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING leave_id, employee_id, leave_type_id,
                       TO_CHAR(date_from, 'YYYY-MM-DD') AS date_from,
                       TO_CHAR(date_to, 'YYYY-MM-DD') AS date_to,
                       day_fraction, total_days, status`,
            [employee_id, leave_type_id, date_from, date_to, fraction, totalDays, reason || null, req.user.employee_id]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23P01') {
            return res.status(409).json({ message: 'This employee already has a leave request covering those dates.' });
        }
        if (err.code === '23503') return res.status(404).json({ message: 'Employee or leave type not found' });
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

/**
 * Approving a request is what writes 'On Leave' onto the DTR, so the two must
 * move together — hence an explicit transaction.
 */
router.post('/requests/:id/approve', protect, hasPermission('leave:approve'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT lr.*, lt.is_paid, lt.leave_name,
                    TO_CHAR(lr.date_from, 'YYYY-MM-DD') AS date_from,
                    TO_CHAR(lr.date_to, 'YYYY-MM-DD') AS date_to
             FROM leave_request lr
             JOIN leave_type lt ON lr.leave_type_id = lt.leave_type_id
             WHERE lr.leave_id = $1 FOR UPDATE`,
            [req.params.id]
        );
        const leave = rows[0];
        if (!leave) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Leave request not found' });
        }
        if (leave.status !== 'Pending') {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `This request is already ${leave.status.toLowerCase()}.` });
        }
        if (Number(leave.employee_id) === Number(req.user.employee_id)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'You cannot approve your own leave request.' });
        }

        await client.query(
            `UPDATE leave_request
             SET status = 'Approved', approved_by = $1, approved_at = now(),
                 decision_note = $2, modified_by = $1, updated_at = now()
             WHERE leave_id = $3`,
            [req.user.employee_id, req.body.decision_note || null, req.params.id]
        );

        const applied = await dtrService.applyLeaveToDtr(client, {
            leaveRequest: leave,
            actorId: req.user.employee_id,
        });

        await client.query('COMMIT');
        res.json({
            leave_id: Number(req.params.id),
            status: 'Approved',
            dtr_days_updated: applied.applied,
            // Days payroll already consumed cannot be changed; surface them so
            // the approver knows the DTR is not fully in step.
            locked_days: applied.locked,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

router.post('/requests/:id/reject', protect, hasPermission('leave:approve'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `UPDATE leave_request
             SET status = 'Rejected', approved_by = $1, approved_at = now(),
                 decision_note = $2, modified_by = $1, updated_at = now()
             WHERE leave_id = $3 AND status = 'Pending'
             RETURNING leave_id, status`,
            [req.user.employee_id, req.body.decision_note || null, req.params.id]
        );
        if (rows.length === 0) {
            return res.status(409).json({ message: 'Leave request not found or no longer pending.' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

/** Cancelling an approved request must also unwind the DTR days it created. */
router.post('/requests/:id/cancel', protect, hasPermission('leave:request'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            'SELECT leave_id, status FROM leave_request WHERE leave_id = $1 FOR UPDATE', [req.params.id]
        );
        const leave = rows[0];
        if (!leave) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Leave request not found' });
        }
        if (leave.status === 'Cancelled' || leave.status === 'Rejected') {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `This request is already ${leave.status.toLowerCase()}.` });
        }

        await client.query(
            `UPDATE leave_request
             SET status = 'Cancelled', decision_note = $1, modified_by = $2, updated_at = now()
             WHERE leave_id = $3`,
            [req.body.decision_note || null, req.user.employee_id, req.params.id]
        );
        const reverted = leave.status === 'Approved'
            ? await dtrService.removeLeaveFromDtr(client, { leaveId: req.params.id })
            : { reverted: 0 };

        await client.query('COMMIT');
        res.json({ leave_id: Number(req.params.id), status: 'Cancelled', dtr_days_reverted: reverted.reverted });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

module.exports = router;
