const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// --- MOVED to customerRoutes.js ---
// The endpoint for getting unpaid invoices has been moved to keep all customer-related routes together.

// POST /api/payments - Receive a new customer payment and allocate it
router.post('/payments', protect, hasPermission('ar:receive_payment'), async (req, res) => {
    const { employee_id } = req.user;
    // Accept either `reference` (new clients) or legacy `reference_number`.
    const { customer_id, amount, payment_method, reference, reference_number, notes, allocations } = req.body;

    // Prefer `reference` if provided, otherwise fall back to `reference_number`.
    const referenceValue = reference || reference_number || null;

    if (!customer_id || !amount || !allocations || !Array.isArray(allocations)) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Step 1: Create the payment record in the ledger
        const paymentQuery = `
            INSERT INTO customer_payment (customer_id, employee_id, amount, payment_method, reference_number, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING payment_id;
        `;
        const paymentResult = await client.query(paymentQuery, [customer_id, employee_id, amount, payment_method, referenceValue, notes]);
        const newPaymentId = paymentResult.rows[0].payment_id;

        // Step 2: Create allocation records and update invoice statuses
        for (const alloc of allocations) {
            if (alloc.amount_allocated > 0) {
                const allocationQuery = `
                    INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated)
                    VALUES ($1, $2, $3);
                `;
                await client.query(allocationQuery, [alloc.invoice_id, newPaymentId, alloc.amount_allocated]);

                // Step 3: Recalculate total paid for the invoice and update its status
                const balanceQuery = `
                    SELECT
                        i.total_amount,
                        COALESCE(SUM(ipa.amount_allocated), 0) as total_paid
                    FROM invoice i
                    LEFT JOIN invoice_payment_allocation ipa ON i.invoice_id = ipa.invoice_id
                    WHERE i.invoice_id = $1
                    GROUP BY i.invoice_id;
                `;
                const balanceResult = await client.query(balanceQuery, [alloc.invoice_id]);
                const { total_amount, total_paid } = balanceResult.rows[0];

                let newStatus = 'Unpaid';
                if (parseFloat(total_paid) >= parseFloat(total_amount)) {
                    newStatus = 'Paid';
                } else if (parseFloat(total_paid) > 0) {
                    newStatus = 'Partially Paid';
                }

                await client.query('UPDATE invoice SET status = $1 WHERE invoice_id = $2', [newStatus, alloc.invoice_id]);
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Payment received successfully', payment_id: newPaymentId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction Error:', err.message);
        res.status(500).json({ message: 'Server error during transaction.', error: err.message });
    } finally {
        client.release();
    }
});


module.exports = router;

// GET /api/payments - list payments within date range (Phase 1 cash stats support)
router.get('/payments', protect, hasPermission('ar:view'), async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }
    try {
        const query = `
            SELECT payment_id, customer_id, employee_id, created_at as payment_date, amount_paid as amount, tendered_amount, COALESCE(legacy_method, method_name) as payment_method, reference
            FROM payments_unified
            WHERE (created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
            ORDER BY created_at ASC;`;
        const { rows } = await db.query(query, [startDate, endDate]);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching payments:', err.message);
        res.status(500).json({ message: 'Server error fetching payments.' });
    }
});

// TEMP: GET /api/payments/refunds-approx - credit note totals in date range (for approximate net cash)
router.get('/payments/refunds-approx', protect, hasPermission('ar:view'), async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }
    try {
        const q = `SELECT COALESCE(SUM(total_amount),0) AS total_refunds
                   FROM credit_note
                   WHERE (refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2;`;
        const { rows } = await db.query(q, [startDate, endDate]);
        res.json({ total_refunds: rows[0].total_refunds });
    } catch (err) {
        console.error('Error fetching refund approximation:', err.message);
        res.status(500).json({ message: 'Server error fetching refund approximation.' });
    }
});

// POST /api/payments/:id/settle - mark an invoice_payment as settled (manual/operator action)
router.post('/payments/:id/settle', protect, hasPermission('ar:receive_payment'), async (req, res) => {
    const paymentId = parseInt(req.params.id, 10);
    const { settlement_reference, attempt_metadata } = req.body;

    if (!paymentId) return res.status(400).json({ message: 'Invalid payment id' });

    try {
        const updateQ = `
            UPDATE invoice_payments
            SET payment_status = 'settled',
                settled_at = CURRENT_TIMESTAMP,
                settlement_reference = $2,
                attempt_metadata = COALESCE($3::jsonb, attempt_metadata)
            WHERE payment_id = $1
            RETURNING *;
        `;
        const { rows } = await db.query(updateQ, [paymentId, settlement_reference || null, attempt_metadata ? JSON.stringify(attempt_metadata) : null]);
        if (!rows.length) return res.status(404).json({ message: 'Payment not found' });
        return res.json({ message: 'Payment marked as settled', payment: rows[0] });
    } catch (err) {
        console.error('Error settling payment:', err.message);
        return res.status(500).json({ message: 'Server error while settling payment.' });
    }
});

// POST /api/payments/:id/fail - mark an invoice_payment as failed
router.post('/payments/:id/fail', protect, hasPermission('ar:receive_payment'), async (req, res) => {
    const paymentId = parseInt(req.params.id, 10);
    const { attempt_metadata } = req.body;

    if (!paymentId) return res.status(400).json({ message: 'Invalid payment id' });

    try {
        const updateQ = `
            UPDATE invoice_payments
            SET payment_status = 'failed',
                attempt_metadata = COALESCE($2::jsonb, attempt_metadata)
            WHERE payment_id = $1
            RETURNING *;
        `;
        const { rows } = await db.query(updateQ, [paymentId, attempt_metadata ? JSON.stringify(attempt_metadata) : null]);
        if (!rows.length) return res.status(404).json({ message: 'Payment not found' });
        return res.json({ message: 'Payment marked as failed', payment: rows[0] });
    } catch (err) {
        console.error('Error marking payment failed:', err.message);
        return res.status(500).json({ message: 'Server error while updating payment.' });
    }
});

// POST /api/payments/webhook - lightweight webhook receiver from payment processors
// Expects header 'x-payment-webhook-secret' to match process.env.PAYMENT_WEBHOOK_SECRET
router.post('/payments/webhook', async (req, res) => {
    const secret = req.get('x-payment-webhook-secret');
    const configured = process.env.PAYMENT_WEBHOOK_SECRET || null;
    if (!configured || secret !== configured) {
        return res.status(403).json({ message: 'Invalid webhook secret' });
    }

    const { payment_id, external_status, settlement_reference, attempt_metadata } = req.body;
    if (!payment_id || !external_status) {
        return res.status(400).json({ message: 'Missing required webhook fields' });
    }

    try {
        // Map common external statuses to our internal statuses
        let targetStatus = null;
        if (['settled', 'succeeded', 'paid'].includes(String(external_status).toLowerCase())) targetStatus = 'settled';
        else if (['failed', 'declined', 'error'].includes(String(external_status).toLowerCase())) targetStatus = 'failed';

        if (!targetStatus) {
            return res.status(400).json({ message: 'Unsupported external_status' });
        }

        const updateQ = `
            UPDATE invoice_payments
            SET payment_status = $2::varchar,
                settled_at = CASE WHEN $2::varchar = 'settled' THEN CURRENT_TIMESTAMP ELSE settled_at END,
                settlement_reference = COALESCE($3, settlement_reference),
                attempt_metadata = COALESCE($4::jsonb, attempt_metadata)
            WHERE payment_id = $1
            RETURNING *;
        `;

        const { rows } = await db.query(updateQ, [payment_id, targetStatus, settlement_reference || null, attempt_metadata ? JSON.stringify(attempt_metadata) : null]);
        if (!rows.length) return res.status(404).json({ message: 'Payment not found' });
        return res.json({ message: 'Webhook processed', payment: rows[0] });
    } catch (err) {
        console.error('Error processing payment webhook:', err.message);
        return res.status(500).json({ message: 'Server error processing webhook' });
    }
});
