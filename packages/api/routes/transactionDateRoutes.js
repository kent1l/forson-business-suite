const express = require('express');
const db = require('../db');
const { protect, hasPermission, userHasPermission } = require('../middleware/authMiddleware');
const transactionDateService = require('../services/transactionDateService');
const router = express.Router();

const REQUIRED_PERMISSIONS = ['transaction:change_date', 'transaction:change_date_unrestricted'];

function requestMeta(req) {
    return {
        ip: req.ip || (req.connection && req.connection.remoteAddress) || req.headers['x-forwarded-for'] || null,
        userAgent: req.headers['user-agent'] || null,
    };
}

// err.status is only ever set by transactionDateService's own deliberate,
// user-facing throws (bad kind, not found, guard/conflict, permission).
// Anything else is an unexpected failure (a raw DB error, a programming
// bug) whose message can name tables/columns/constraints — log it in full
// server-side, but don't hand that detail to the client.
function respondError(res, err, fallbackMessage) {
    console.error(fallbackMessage, err);
    if (err.status) {
        return res.status(err.status).json({ message: err.message });
    }
    return res.status(500).json({ message: fallbackMessage });
}

// GET /api/transaction-date/kinds - list of transaction kinds this feature supports,
// for the web UI to know which "Change date" actions to offer.
router.get('/transaction-date/kinds', protect, hasPermission(REQUIRED_PERMISSIONS), (req, res) => {
    const kinds = Object.entries(transactionDateService.KIND_HANDLERS).map(([kind, handler]) => ({
        kind,
        label: handler.label,
    }));
    res.json(kinds);
});

// GET /api/transaction-date/:kind/:id/preview?new_date=YYYY-MM-DD - dry run, no writes.
router.get('/transaction-date/:kind/:id/preview', protect, hasPermission(REQUIRED_PERMISSIONS), async (req, res) => {
    const { kind, id } = req.params;
    const { new_date } = req.query;

    if (!new_date) {
        return res.status(400).json({ message: 'new_date query parameter is required.' });
    }
    if (!id || isNaN(parseInt(id, 10))) {
        return res.status(400).json({ message: 'Invalid transaction id.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const requesterHasUnrestricted = userHasPermission(req, 'transaction:change_date_unrestricted');
        const result = await transactionDateService.preview(client, kind, id, new_date, requesterHasUnrestricted);
        // Preview never writes, but fetch() takes FOR UPDATE locks on the
        // anchor row — roll back rather than commit so nothing lingers.
        await client.query('ROLLBACK');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        respondError(res, err, 'Server error previewing date change.');
    } finally {
        client.release();
    }
});

// GET /api/transaction-date/:kind/:id/history - prior date changes for this transaction.
router.get('/transaction-date/:kind/:id/history', protect, hasPermission(REQUIRED_PERMISSIONS), async (req, res) => {
    const { kind, id } = req.params;
    if (!id || isNaN(parseInt(id, 10))) {
        return res.status(400).json({ message: 'Invalid transaction id.' });
    }
    try {
        const rows = await transactionDateService.history(db, kind, id);
        res.json(rows);
    } catch (err) {
        respondError(res, err, 'Server error fetching date change history.');
    }
});

// PUT /api/transaction-date/:kind/:id - apply the date change.
router.put('/transaction-date/:kind/:id', protect, hasPermission(REQUIRED_PERMISSIONS), async (req, res) => {
    const { kind, id } = req.params;
    const { new_date, reason } = req.body;

    if (!id || isNaN(parseInt(id, 10))) {
        return res.status(400).json({ message: 'Invalid transaction id.' });
    }
    if (!new_date) {
        return res.status(400).json({ message: 'new_date is required.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { ip, userAgent } = requestMeta(req);
        const requesterHasUnrestricted = userHasPermission(req, 'transaction:change_date_unrestricted');
        const result = await transactionDateService.apply(client, {
            kind,
            id,
            newDate: new_date,
            reason,
            employeeId: req.user.employee_id,
            ip,
            userAgent,
            requesterHasUnrestricted,
        });
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        respondError(res, err, 'Server error applying date change.');
    } finally {
        client.release();
    }
});

module.exports = router;
