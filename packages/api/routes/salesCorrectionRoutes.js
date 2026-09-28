const express = require('express');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const corrections = require('../services/salesCorrectionService');

const router = express.Router();

function sendError(res, error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Sales correction failed.' });
}

router.post('/sales-corrections/preview', protect, hasPermission('sales_correction:create'), async (req, res) => {
    try {
        const invoiceId = Number(req.body.invoice_id);
        if (!Number.isInteger(invoiceId) || invoiceId < 1) return res.status(400).json({ message: 'invoice_id is required.' });
        res.json(await corrections.preview(invoiceId));
    } catch (error) { return sendError(res, error); }
});

router.post('/sales-corrections', protect, hasPermission('sales_correction:create'), async (req, res) => {
    try {
        const created = await corrections.createCase({
            invoiceId: Number(req.body.invoice_id),
            reasonCode: req.body.reason_code,
            reasonText: req.body.reason_text,
            evidence: req.body.resolution_evidence,
            idempotencyKey: req.get('Idempotency-Key') || req.body.idempotency_key,
            requestedBy: req.user.employee_id,
        });
        res.status(201).json({ case: created });
    } catch (error) { return sendError(res, error); }
});

router.post('/sales-corrections/:id/approve', protect, hasPermission('sales_correction:approve'), async (req, res) => {
    try {
        const caseRow = await corrections.approveAndExecute(Number(req.params.id), req.user.employee_id);
        res.json({ case: caseRow, message: 'Correction completed. Start the replacement sale with a new invoice number.' });
    } catch (error) { return sendError(res, error); }
});

router.get('/sales-corrections/:id', protect, hasPermission('sales_correction:view'), async (req, res) => {
    try { res.json(await corrections.getCase(Number(req.params.id))); }
    catch (error) { return sendError(res, error); }
});

module.exports = router;
