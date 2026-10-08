'use strict';

const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { processExchange, ExchangeError } = require('../services/exchangeService');
const cashDrawer = require('../services/cashDrawerService');
const router = express.Router();

// POST /api/invoices/exchange - Return item(s) from a past invoice and issue replacement(s)
// in one atomic transaction, settling only the net difference. See
// services/exchangeService.js for the business logic; this route only owns the
// HTTP transaction lifecycle and error-status mapping.
router.post('/invoices/exchange', protect, hasPermission('invoicing:create'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await cashDrawer.reserveSourceSession(client, req.body.cash_session_id);
        const sourceRequest = await cashDrawer.beginSourceRequest(client, req);

        const result = await processExchange(client, {
            ...req.body,
            override_credit_limit: req.body.override_credit_limit === true,
            manager_override: req.body.manager_override === true,
            requesting_permissions: req.user?.permissions || [],
            can_post_drawer: cashDrawer.userCanPost(req.user),
            cash_actor_id: req.user.employee_id,
        });

        await cashDrawer.finishSourceRequest(client, sourceRequest, 201, result);
        await client.query('COMMIT');
        res.status(201).json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
        if (err instanceof ExchangeError) {
            const { statusCode, ...body } = err;
            return res.status(statusCode).json({ message: err.message, ...body });
        }
        if (err && err.code === '23505' && /physical_receipt_no/i.test(err.detail || '')) {
            return res.status(409).json({ message: 'Physical Receipt No already exists. Please use a unique number.' });
        }
        console.error('Exchange Transaction Error:', err.message);
        res.status(500).json({ message: 'Server error during exchange transaction.', error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
