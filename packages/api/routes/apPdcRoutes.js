const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const apPdcService = require('../services/apPdcService');
const apLedgerService = require('../services/apLedgerService');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const router = express.Router();

function parseBool(val) {
    return val === true || val === 'true' || val === '1';
}

function getIdempotencyKey(req) {
    return req.get('Idempotency-Key') || req.body?.idempotency_key || null;
}

// GET /ap/pdc/summary-stats - KPI summary metrics for outbound Treasury Desk header cards
router.get('/ap/pdc/summary-stats', protect, hasPermission(['ap-pdc:view']), async (req, res) => {
    try {
        const stats = await apPdcService.getOutboundPdcSummaryStats(db);
        res.json({ success: true, data: stats });
    } catch (err) {
        console.error('AP PDC Summary Stats Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch outbound PDC summary stats' });
    }
});

// GET /ap/outbound-clearance - List outbound cheques across all purposes (supplier/loan/rent/other)
router.get('/ap/outbound-clearance', protect, hasPermission(['ap-pdc:view']), async (req, res) => {
    try {
        const {
            pdc_status,
            maturity_status,
            include_history,
            include_deleted,
            include_hidden_legacy,
            search,
            bank_account_id,
        } = req.query;
        const list = await apPdcService.getOutboundClearanceList(db, pdc_status, maturity_status, {
            includeHistory: parseBool(include_history),
            includeDeleted: parseBool(include_deleted),
            includeHiddenLegacy: parseBool(include_hidden_legacy),
            search,
            bankAccountId: bank_account_id,
        });
        res.json({ success: true, count: list.length, data: list });
    } catch (err) {
        console.error('AP Outbound Clearance List Error:', err.message);
        const status = err.status || 500;
        res.status(status).json({ message: err.message || 'Failed to fetch outbound clearance list', code: err.code });
    }
});

// GET /ap/outbound-clearance/:chequeRecordId/eligibility - Contextual action eligibility & chain details
router.get('/ap/outbound-clearance/:chequeRecordId/eligibility', protect, hasPermission(['ap-pdc:view', 'ap:view', 'cheques:view']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });
    try {
        const { staleDays } = await apPdcService.getPdcSettings(db);
        const eligibility = await apPdcService.evaluateChequeActionEligibility(db, {
            chequeRecordId,
            staleDays,
        });
        res.json({ success: true, data: eligibility });
    } catch (err) {
        console.error('AP Cheque Eligibility Error:', err.message);
        res.status(err.status || 500).json({ message: err.message || 'Failed to evaluate cheque action eligibility', code: err.code });
    }
});

// POST /ap/outbound-clearance/issue - Issue a new outbound cheque (supplier payment, loan, rent, other)
router.post('/ap/outbound-clearance/issue', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const {
        bank_account_id, cheque_number, cheque_date, purpose_type, amount, payee, memo,
        template_id, supplier_id, bill_ids, allocations, auto_allocate, method_id,
        expense_category_id, reference_number, override_payment_hold,
    } = req.body;

    if (!bank_account_id || !cheque_number || !cheque_date || !purpose_type || !amount || !payee) {
        return res.status(400).json({ message: 'bank_account_id, cheque_number, cheque_date, purpose_type, amount, and payee are required' });
    }

    const isAdminBypass = Number(req.user?.permission_level_id) === 10;
    if (override_payment_hold && !isAdminBypass && !(req.user?.permissions || []).includes('ap:manage')) {
        return res.status(403).json({ message: 'ap:manage permission is required to override a supplier payment hold' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        let resolvedTemplateId = template_id || null;
        if (!resolvedTemplateId) {
            const { rows: [ba] } = await client.query(
                'SELECT default_cheque_template_id FROM bank_account WHERE bank_account_id = $1',
                [bank_account_id]
            );
            resolvedTemplateId = ba?.default_cheque_template_id || null;
        }

        const result = await apPdcService.issueOutboundCheque(client, {
            bankAccountId: bank_account_id,
            chequeNumber: cheque_number,
            chequeDate: cheque_date,
            purposeType: purpose_type,
            amount,
            payee,
            memo,
            templateId: resolvedTemplateId,
            supplierId: supplier_id,
            billIds: bill_ids || [],
            allocations: Array.isArray(allocations) ? allocations : null,
            autoAllocate: Boolean(auto_allocate),
            methodId: method_id,
            expenseCategoryId: expense_category_id,
            referenceNumber: reference_number,
            employeeId: req.user?.employee_id,
            userId: req.user?.employee_id,
            overridePaymentHold: Boolean(override_payment_hold),
        });
        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'Outbound cheque issued', ...result, templateId: result.templateId ?? resolvedTemplateId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Issue Outbound Cheque Error:', err.message);
        if (err.code === 'PAYMENT_HOLD_BLOCKED') {
            return res.status(409).json({ message: err.message, code: err.code });
        }
        if (err.code === 'CHEQUE_NUMBER_RESERVED' || err.code === '23505') {
            return res.status(409).json({
                message: err.code === 'CHEQUE_NUMBER_RESERVED' ? err.message : 'This cheque number has already been recorded for this bank account',
                code: 'CHEQUE_NUMBER_RESERVED',
                conflictingCheque: err.conflictingCheque || null,
            });
        }
        if (err.status) {
            return res.status(err.status).json({ message: err.message, code: err.code });
        }
        res.status(500).json({ message: err.message || 'Failed to issue outbound cheque' });
    } finally {
        client.release();
    }
});

// GET /ap/cheque-register/next-number - Suggest the next available cheque number for a bank account
router.get('/ap/cheque-register/next-number', protect, hasPermission(['ap-pdc:view']), async (req, res) => {
    try {
        const { bank_account_id } = req.query;
        if (!bank_account_id) return res.status(400).json({ message: 'bank_account_id is required' });
        const next = await apPdcService.suggestNextChequeNumber(db, Number(bank_account_id));
        res.json({ success: true, data: { next_cheque_number: next } });
    } catch (err) {
        console.error('Next Cheque Number Error:', err.message);
        res.status(500).json({ message: 'Failed to compute next cheque number' });
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/verify - Verify / clear an outbound cheque
router.post('/ap/outbound-clearance/:chequeRecordId/verify', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { expected_status } = req.body || {};
    const requestId = getIdempotencyKey(req);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const reqKey = await apPdcService.beginLifecycleRequest(client, {
            requestId,
            actorId: req.user?.employee_id,
            action: 'VERIFY_CHEQUE',
            targetType: 'cheque_records',
            targetId: chequeRecordId,
            payload: { expected_status: expected_status || null },
        });
        const result = await apPdcService.verifyOutboundPayment(client, {
            chequeRecordId,
            userId: req.user?.employee_id,
            expectedStatus: expected_status || null,
        });
        const responseBody = { success: true, message: 'Outbound cheque verified and cleared', ...result };
        await apPdcService.finishLifecycleRequest(client, reqKey, 200, responseBody);
        await client.query('COMMIT');
        res.json(responseBody);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        console.error('AP Verify Outbound Cheque Error:', err.message);
        res.status(err.status || 500).json({ message: err.message || 'Failed to verify outbound cheque', code: err.code, currentStatus: err.currentStatus });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/fail - Bounce/dishonor an outbound cheque
router.post('/ap/outbound-clearance/:chequeRecordId/fail', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { bounce_fee, reason, expected_status } = req.body || {};
    const requestId = getIdempotencyKey(req);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const reqKey = await apPdcService.beginLifecycleRequest(client, {
            requestId,
            actorId: req.user?.employee_id,
            action: 'FAIL_CHEQUE',
            targetType: 'cheque_records',
            targetId: chequeRecordId,
            payload: { bounce_fee: bounce_fee ?? 0, reason: reason || null, expected_status: expected_status || null },
        });
        const result = await apPdcService.processBouncedOutboundCheque(client, {
            chequeRecordId,
            bounceFee: bounce_fee,
            reason,
            userId: req.user?.employee_id,
            expectedStatus: expected_status || null,
        });
        const responseBody = { success: true, message: 'Outbound cheque bounced and reversal processed', ...result };
        await apPdcService.finishLifecycleRequest(client, reqKey, 200, responseBody);
        await client.query('COMMIT');
        res.json(responseBody);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        console.error('AP Fail Outbound Cheque Error:', err.message);
        res.status(err.status || 500).json({ message: err.message || 'Failed to process bounced outbound cheque', code: err.code, currentStatus: err.currentStatus });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/redeposit - Re-present a bounced outbound cheque
router.post('/ap/outbound-clearance/:chequeRecordId/redeposit', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { lift_payment_hold, notes } = req.body || {};
    const requestId = getIdempotencyKey(req);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const reqKey = await apPdcService.beginLifecycleRequest(client, {
            requestId,
            actorId: req.user?.employee_id,
            action: 'REDEPOSIT_CHEQUE',
            targetType: 'cheque_records',
            targetId: chequeRecordId,
            payload: { lift_payment_hold: Boolean(lift_payment_hold), notes: notes || null },
        });
        const result = await apPdcService.redepositOutboundCheque(client, {
            chequeRecordId,
            liftPaymentHold: Boolean(lift_payment_hold),
            notes,
            userId: req.user?.employee_id,
        });
        const responseBody = { success: true, message: 'Outbound cheque re-presented for clearance', data: result };
        await apPdcService.finishLifecycleRequest(client, reqKey, 200, responseBody);
        await client.query('COMMIT');
        res.json(responseBody);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        console.error('AP Redeposit Outbound Cheque Error:', err.message);
        res.status(err.status || 400).json({ message: err.message || 'Failed to re-deposit outbound cheque', code: err.code });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/void - Void a spoiled/mistake cheque before it was ever honored
router.post('/ap/outbound-clearance/:chequeRecordId/void', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { reason, expected_status } = req.body || {};
    if (!reason || !String(reason).trim()) return res.status(400).json({ message: 'A void reason is required' });

    const requestId = getIdempotencyKey(req);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const reqKey = await apPdcService.beginLifecycleRequest(client, {
            requestId,
            actorId: req.user?.employee_id,
            action: 'VOID_CHEQUE',
            targetType: 'cheque_records',
            targetId: chequeRecordId,
            payload: { reason: String(reason).trim(), expected_status: expected_status || null },
        });
        const result = await apPdcService.voidCheque(client, {
            chequeRecordId,
            reason: String(reason).trim(),
            userId: req.user?.employee_id,
            expectedStatus: expected_status || null,
        });
        const responseBody = { success: true, message: 'Cheque voided', data: result };
        await apPdcService.finishLifecycleRequest(client, reqKey, 200, responseBody);
        await client.query('COMMIT');
        res.json(responseBody);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        console.error('AP Void Outbound Cheque Error:', err.message);
        res.status(err.status || 400).json({ message: err.message || 'Failed to void cheque', code: err.code, currentStatus: err.currentStatus });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/replace - Replace an eligible outbound cheque
router.post('/ap/outbound-clearance/:chequeRecordId/replace', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const {
        new_cheque_number,
        new_cheque_date,
        new_bank_account_id,
        reason_category,
        reason_notes,
        reason,
        confirm_recovered_or_stopped,
        expected_status,
        // Guard against clients trying to mutate economic inputs via Replace
        amount,
        payee,
        supplier_id,
        allocations,
        bill_ids,
        purpose_type,
        expense_category_id,
    } = req.body || {};

    if (
        amount !== undefined ||
        payee !== undefined ||
        supplier_id !== undefined ||
        allocations !== undefined ||
        bill_ids !== undefined ||
        purpose_type !== undefined ||
        expense_category_id !== undefined
    ) {
        return res.status(400).json({
            message: 'Economic payment details (payee, amount, supplier, bills, purpose, category) cannot be modified during cheque replacement.',
            code: 'ECONOMIC_MUTATION_FORBIDDEN',
        });
    }

    if (!new_cheque_number) {
        return res.status(400).json({ message: 'new_cheque_number is required', code: 'CHEQUE_NUMBER_REQUIRED' });
    }

    const requestId = getIdempotencyKey(req);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const reqKey = await apPdcService.beginLifecycleRequest(client, {
            requestId,
            actorId: req.user?.employee_id,
            action: 'REPLACE_CHEQUE',
            targetType: 'cheque_records',
            targetId: chequeRecordId,
            payload: {
                new_cheque_number: String(new_cheque_number).trim(),
                new_cheque_date: new_cheque_date || null,
                new_bank_account_id: new_bank_account_id ? Number(new_bank_account_id) : null,
                reason_category: reason_category || null,
                reason_notes: reason_notes || null,
                reason: reason || null,
                confirm_recovered_or_stopped: Boolean(confirm_recovered_or_stopped),
            },
        });
        const result = await apPdcService.replaceCheque(client, {
            chequeRecordId,
            newChequeNumber: new_cheque_number,
            newChequeDate: new_cheque_date || null,
            newBankAccountId: new_bank_account_id || null,
            reasonCategory: reason_category,
            reasonNotes: reason_notes,
            reason,
            confirmRecoveredOrStopped: Boolean(confirm_recovered_or_stopped),
            expectedStatus: expected_status || null,
            userId: req.user?.employee_id,
        });
        const responseBody = {
            success: true,
            message: `Cheque ${result.newChequeNumber} replaces ${result.oldChequeNumber || `#${result.oldChequeRecordId}`}.`,
            data: result,
        };
        await apPdcService.finishLifecycleRequest(client, reqKey, 200, responseBody);
        await client.query('COMMIT');
        res.json(responseBody);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        console.error('AP Replace Outbound Cheque Error:', err.message);
        if (err.code === 'CHEQUE_NUMBER_RESERVED' || err.code === '23505') {
            return res.status(409).json({
                message: err.code === 'CHEQUE_NUMBER_RESERVED' ? err.message : 'This cheque number has already been recorded for this bank account',
                code: 'CHEQUE_NUMBER_RESERVED',
                conflictingCheque: err.conflictingCheque || null,
            });
        }
        res.status(err.status || 400).json({
            message: err.message || 'Failed to replace cheque',
            code: err.code,
            currentStatus: err.currentStatus,
            replacementCheque: err.replacementCheque || null,
        });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/delete - Delete an erroneous unsettled payment and release its cheque number
router.post('/ap/outbound-clearance/:chequeRecordId/delete', protect, hasPermission(['ap-pdc:delete', 'ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { reason, expected_status } = req.body || {};
    if (!reason || !String(reason).trim()) {
        return res.status(400).json({ message: 'A deletion reason is required', code: 'DELETE_REASON_REQUIRED' });
    }

    const requestId = getIdempotencyKey(req);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const reqKey = await apPdcService.beginLifecycleRequest(client, {
            requestId,
            actorId: req.user?.employee_id,
            action: 'DELETE_CHEQUE_PAYMENT',
            targetType: 'cheque_records',
            targetId: chequeRecordId,
            payload: { reason: String(reason).trim(), expected_status: expected_status || null },
        });
        const result = await apPdcService.deleteErroneousPayment(client, {
            chequeRecordId,
            reason: String(reason).trim(),
            expectedStatus: expected_status || null,
            userId: req.user?.employee_id,
        });
        const responseBody = {
            success: true,
            message: result.releasedChequeNumber
                ? `Payment deleted and cheque #${result.releasedChequeNumber} is available again.`
                : 'Print entry removed.',
            data: result,
        };
        await apPdcService.finishLifecycleRequest(client, reqKey, 200, responseBody);
        await client.query('COMMIT');
        res.json(responseBody);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        console.error('AP Delete Outbound Cheque Payment Error:', err.message);
        res.status(err.status || 400).json({
            message: err.message || 'Failed to delete payment',
            code: err.code,
            currentStatus: err.currentStatus,
        });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/restore - Restore visibility of a legacy hidden cheque record
router.post('/ap/outbound-clearance/:chequeRecordId/restore', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { reason } = req.body || {};
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await apPdcService.restoreHiddenChequeVisibility(client, {
            chequeRecordId,
            reason: reason ? String(reason).trim() : null,
            userId: req.user?.employee_id,
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Cheque visibility restored', data: result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Restore Hidden Cheque Error:', err.message);
        res.status(err.status || 400).json({ message: err.message || 'Failed to restore cheque visibility', code: err.code });
    } finally {
        client.release();
    }
});

// GET /ap/outbound-clearance/:chequeRecordId/history - Audit history for a specific outbound cheque
router.get('/ap/outbound-clearance/:chequeRecordId/history', protect, hasPermission(['ap-pdc:view']), async (req, res) => {
    try {
        const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
        if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

        const history = await apPdcService.getOutboundClearanceHistory(db, chequeRecordId);
        res.json({ success: true, data: history });
    } catch (err) {
        console.error('AP Outbound Clearance History Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch outbound cheque clearance history' });
    }
});

// GET /ap/cheque-register - Full cheque number sequence for a bank account, for gap-continuity review
router.get('/ap/cheque-register', protect, hasPermission(['ap-pdc:view']), async (req, res) => {
    try {
        const { bank_account_id, include_deleted, search, status } = req.query;
        const params = [];
        let where = 'WHERE cr.cheque_number IS NOT NULL';
        if (bank_account_id) {
            params.push(bank_account_id);
            where += ` AND cr.bank_account_id = $${params.length}`;
        }
        if (!parseBool(include_deleted) && status !== 'DELETED') {
            where += ` AND cr.status <> 'DELETED'`;
        }
        if (status && status !== 'ALL') {
            params.push(status);
            where += ` AND cr.status = $${params.length}`;
        }
        if (search && String(search).trim()) {
            params.push(`%${String(search).trim().toLowerCase()}%`);
            where += ` AND (LOWER(cr.cheque_number) LIKE $${params.length} OR LOWER(cr.payee) LIKE $${params.length})`;
        }
        const { rows } = await db.query(
            `SELECT cr.id, cr.bank_account_id, ba.account_name, ba.bank_name, cr.cheque_number, cr.status,
                    cr.purpose_type, cr.payee, cr.amount, TO_CHAR(cr.cheque_date, 'YYYY-MM-DD') AS cheque_date,
                    cr.is_void, cr.void_reason, cr.is_deleted, cr.deleted_reason, cr.deleted_at,
                    cr.ap_payment_id, cr.expense_id,
                    cr.replaces_cheque_id, cr.replaced_by_cheque_id,
                    prev_cr.cheque_number AS replaces_cheque_number,
                    next_cr.cheque_number AS replaced_by_cheque_number,
                    cr.created_at
             FROM cheque_records cr
             LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
             LEFT JOIN cheque_records prev_cr ON prev_cr.id = cr.replaces_cheque_id
             LEFT JOIN cheque_records next_cr ON next_cr.id = cr.replaced_by_cheque_id
             ${where}
             ORDER BY cr.bank_account_id, cr.cheque_number, cr.id DESC`,
            params
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('AP Cheque Register Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch cheque register' });
    }
});

// ── Supplier bills (with scheduled_amount and available_to_schedule for bill pickers) ──

router.get('/ap/supplier-bills', protect, hasPermission(['ap-pdc:view', 'ap:view']), async (req, res) => {
    try {
        const { supplier_id, status, search } = req.query;
        const params = [];
        let where = 'WHERE 1=1';
        if (supplier_id) { params.push(supplier_id); where += ` AND sb.supplier_id = $${params.length}`; }
        if (status && status !== 'all') { params.push(status); where += ` AND sb.status = $${params.length}`; }
        else if (!status) { where += ` AND sb.status NOT IN ('Paid', 'Void')`; }

        if (search?.trim()) {
            params.push(`%${search.trim()}%`);
            where += ` AND (sb.supplier_document_no ILIKE $${params.length}
                OR sb.bill_number ILIKE $${params.length}
                OR EXISTS (SELECT 1 FROM supplier_bill_document_identity di
                    WHERE di.bill_id = sb.bill_id AND di.status = 'active' AND di.document_no ILIKE $${params.length}))`;
        }
        const { rows } = await db.query(
            `SELECT sb.*, s.supplier_name,
                    COALESCE(NULLIF(BTRIM(sb.supplier_document_no), ''),
                        (SELECT di.document_no FROM supplier_bill_document_identity di
                         WHERE di.bill_id = sb.bill_id AND di.supplier_id = sb.supplier_id AND di.status = 'active'
                         ORDER BY di.is_primary DESC, di.identity_id LIMIT 1),
                        (SELECT COALESCE(NULLIF(BTRIM(gr.supplier_document_no), ''),
                                         NULLIF(BTRIM(gr.physical_receipt_no), ''),
                                         NULLIF(BTRIM(gr.supplier_invoice_no), ''))
                         FROM goods_receipt gr
                         WHERE gr.supplier_id = sb.supplier_id
                           AND (gr.bill_id = sb.bill_id OR gr.grn_id = sb.grn_id)
                           AND COALESCE(NULLIF(BTRIM(gr.supplier_document_no), ''),
                                        NULLIF(BTRIM(gr.physical_receipt_no), ''),
                                        NULLIF(BTRIM(gr.supplier_invoice_no), '')) IS NOT NULL
                         ORDER BY (gr.status = 'Active' AND gr.workflow_status = 'Posted') DESC,
                                  (gr.grn_id = sb.grn_id) DESC NULLS LAST, gr.receipt_date, gr.grn_id LIMIT 1),
                        CASE WHEN sb.bill_number NOT LIKE 'BILL-%' THEN sb.bill_number END
                    ) AS display_supplier_reference,
                    ARRAY(SELECT di.document_no FROM supplier_bill_document_identity di WHERE di.bill_id = sb.bill_id AND di.status = 'active') AS document_references,
                    GREATEST(CURRENT_DATE - COALESCE(sb.due_date, sb.bill_date), 0) AS days_overdue,
                    COALESCE(sched.scheduled_amount, 0) AS scheduled_amount,
                    COALESCE(sched.scheduled_cheques, '[]'::json) AS scheduled_cheques,
                    GREATEST(sb.total_amount - sb.amount_paid, 0) AS outstanding_amount,
                    GREATEST(sb.total_amount - sb.amount_paid - COALESCE(sched.scheduled_amount, 0), 0) AS available_to_schedule,
                    grn.related_grns
             FROM supplier_bill sb
             JOIN supplier s ON s.supplier_id = sb.supplier_id
             LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(apa.amount_allocated), 0) AS scheduled_amount,
                       COALESCE(json_agg(json_build_object(
                           'payment_id', ap.payment_id,
                           'cheque_record_id', cr.id,
                           'cheque_number', cr.cheque_number,
                           'cheque_date', TO_CHAR(cr.cheque_date, 'YYYY-MM-DD'),
                           'status', COALESCE(cr.status, ap.pdc_status),
                           'amount', apa.amount_allocated
                       ) ORDER BY ap.payment_id), '[]'::json) AS scheduled_cheques
                FROM ap_payment_allocation apa
                JOIN ap_payment ap ON ap.payment_id = apa.payment_id
                LEFT JOIN cheque_records cr ON cr.id = ap.cheque_record_id
                WHERE apa.bill_id = sb.bill_id
                  AND ap.pdc_status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'BOUNCED', 'STALE')
                  AND (cr.id IS NULL OR cr.status NOT IN ('VOID', 'REPLACED', 'DELETED'))
             ) sched ON true
             LEFT JOIN LATERAL (
                SELECT COALESCE(json_agg(json_build_object(
                            'grn_id', gr.grn_id,
                            'grn_number', gr.grn_number,
                            'receipt_date', gr.receipt_date,
                            'status', gr.status,
                            'link_type', CASE WHEN gr.freight_bill_id = sb.bill_id OR EXISTS (SELECT 1 FROM goods_receipt_freight grf WHERE grf.grn_id = gr.grn_id AND grf.bill_id = sb.bill_id) THEN 'freight' ELSE 'goods' END
                        ) ORDER BY gr.receipt_date, gr.grn_id), '[]'::json) AS related_grns
                FROM goods_receipt gr
                WHERE gr.bill_id = sb.bill_id
                   OR gr.freight_bill_id = sb.bill_id
                   OR EXISTS (SELECT 1 FROM goods_receipt_freight grf WHERE grf.grn_id = gr.grn_id AND grf.bill_id = sb.bill_id)
                   OR (sb.grn_id IS NOT NULL AND gr.grn_id = sb.grn_id)
             ) grn ON true
             ${where} ORDER BY sb.due_date NULLS LAST, sb.bill_date`,
            params
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('List Supplier Bills Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch supplier bills' });
    }
});

// POST /ap/supplier-bills - Create a payable directly against a supplier
router.post('/ap/supplier-bills', protect, hasPermission(['ap:manage']), async (req, res) => {
    const {
        supplier_id,
        po_id,
        grn_id,
        bill_number,
        bill_date,
        due_date,
        total_amount,
        notes,
        supplier_document_type,
        supplier_document_no,
    } = req.body;
    const parsedAmount = parseFloat(total_amount);
    if (!supplier_id || !parsedAmount || parsedAmount <= 0) {
        return res.status(400).json({ message: 'supplier_id and a positive total_amount are required' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        let resolvedDueDate = due_date || null;
        if (!resolvedDueDate) {
            const { rows: [supplier] } = await client.query(
                'SELECT payment_terms_days FROM supplier WHERE supplier_id = $1', [supplier_id]
            );
            if (supplier?.payment_terms_days) {
                const { rows: [computed] } = await client.query(
                    `SELECT (COALESCE($1::date, CURRENT_DATE) + ($2::int || ' days')::interval)::date AS due_date`,
                    [bill_date || null, supplier.payment_terms_days]
                );
                resolvedDueDate = computed.due_date;
            }
        }

        const resolvedDocType = supplier_document_type || ((supplier_document_no || bill_number) ? 'other' : null);
        const resolvedDocNo = String(supplier_document_no || bill_number || '').trim() || null;
        if (resolvedDocNo) {
            await require('../services/supplierBillService').assertBillReferenceAvailable(client, {
                supplierId: supplier_id, documentType: resolvedDocType, documentNo: resolvedDocNo,
            });
        }

        const resolvedBillNumber = bill_number || await getNextDocumentNumber(client, 'BILL');

        const { rows: [bill] } = await client.query(
            `INSERT INTO supplier_bill (supplier_id, po_id, grn_id, bill_number, bill_date, due_date, total_amount, notes, created_by,
                                       liability_basis, supplier_document_type, supplier_document_no)
             VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, $8, $9, 'independent', $10, $11) RETURNING *`,
            [supplier_id, po_id || null, grn_id || null, resolvedBillNumber, bill_date || null, resolvedDueDate, parsedAmount, notes || null, req.user?.employee_id,
             resolvedDocType, resolvedDocNo]
        );

        if (resolvedDocType && resolvedDocNo) {
            const supplierBillService = require('../services/supplierBillService');
            await supplierBillService.registerBillIdentity(client, {
                billId: bill.bill_id,
                supplierId: supplier_id,
                documentType: resolvedDocType,
                documentNo: resolvedDocNo,
                isPrimary: true,
            });
        }

        await apLedgerService.appendEntry(client, {
            supplierId: supplier_id,
            billId: bill.bill_id,
            entryType: 'BILL_POSTED',
            amount: parsedAmount,
            referenceNo: resolvedBillNumber,
            notes: notes || `Manually recorded payable ${resolvedBillNumber}`,
            createdBy: req.user?.employee_id,
        });

        await client.query('COMMIT');
        res.status(201).json({ success: true, data: bill });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Create Supplier Bill Error:', err.message);
        if (err.code === 'BILL_IDENTITY_CONFLICT') {
            return res.status(409).json({
                code: 'BILL_IDENTITY_CONFLICT',
                message: err.message,
                conflictingBill: err.conflictingBill,
            });
        }
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A bill with this number already exists.' });
        }
        res.status(500).json({ message: 'Failed to create supplier bill' });
    } finally {
        client.release();
    }
});

// ── Bank accounts ──

router.get('/bank-accounts', protect, hasPermission(['ap-pdc:view']), async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM bank_account ORDER BY is_active DESC, account_name');
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('List Bank Accounts Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch bank accounts' });
    }
});

router.post('/bank-accounts', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    try {
        const { account_name, bank_name, account_number, currency, opening_balance, notes, default_cheque_template_id } = req.body;
        if (!account_name || !bank_name) {
            return res.status(400).json({ message: 'account_name and bank_name are required' });
        }
        const { rows: [row] } = await db.query(
            `INSERT INTO bank_account (account_name, bank_name, account_number, currency, opening_balance, notes, default_cheque_template_id, created_by)
             VALUES ($1, $2, $3, COALESCE($4, 'PHP'), COALESCE($5, 0), $6, $7, $8) RETURNING *`,
            [account_name, bank_name, account_number, currency, opening_balance, notes, default_cheque_template_id || null, req.user?.employee_id]
        );
        res.status(201).json({ success: true, data: row });
    } catch (err) {
        console.error('Create Bank Account Error:', err.message);
        res.status(500).json({ message: 'Failed to create bank account' });
    }
});

router.put('/bank-accounts/:id', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    try {
        const { account_name, bank_name, account_number, currency, opening_balance, notes, is_active, default_cheque_template_id } = req.body;
        const { rows: [row] } = await db.query(
            `UPDATE bank_account SET
                account_name = COALESCE($1, account_name),
                bank_name = COALESCE($2, bank_name),
                account_number = COALESCE($3, account_number),
                currency = COALESCE($4, currency),
                opening_balance = COALESCE($5, opening_balance),
                notes = COALESCE($6, notes),
                is_active = COALESCE($7, is_active),
                default_cheque_template_id = CASE WHEN $9 THEN $8 ELSE default_cheque_template_id END
             WHERE bank_account_id = $10 RETURNING *`,
            [account_name, bank_name, account_number, currency, opening_balance, notes, is_active,
             default_cheque_template_id || null, default_cheque_template_id !== undefined, req.params.id]
        );
        if (!row) return res.status(404).json({ message: 'Bank account not found' });
        res.json({ success: true, data: row });
    } catch (err) {
        console.error('Update Bank Account Error:', err.message);
        res.status(500).json({ message: 'Failed to update bank account' });
    }
});

module.exports = router;
