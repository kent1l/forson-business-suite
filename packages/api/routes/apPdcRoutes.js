const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const apPdcService = require('../services/apPdcService');
const apLedgerService = require('../services/apLedgerService');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const router = express.Router();

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
        const { pdc_status, maturity_status } = req.query;
        const list = await apPdcService.getOutboundClearanceList(db, pdc_status, maturity_status);
        res.json({ success: true, count: list.length, data: list });
    } catch (err) {
        console.error('AP Outbound Clearance List Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch outbound clearance list' });
    }
});

// POST /ap/outbound-clearance/issue - Issue a new outbound cheque (supplier payment, loan, rent, other)
router.post('/ap/outbound-clearance/issue', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const {
        bank_account_id, cheque_number, cheque_date, purpose_type, amount, payee, memo,
        template_id, supplier_id, bill_ids, expense_category_id, reference_number,
        override_payment_hold,
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

        // Auto-resolve the print template from the bank account's default so the
        // issued cheque can be immediately handed to the cheque printer without
        // asking the user to re-select a layout every time.
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
            expenseCategoryId: expense_category_id,
            referenceNumber: reference_number,
            employeeId: req.user?.employee_id,
            userId: req.user?.employee_id,
            overridePaymentHold: Boolean(override_payment_hold),
        });
        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'Outbound cheque issued', ...result, templateId: resolvedTemplateId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Issue Outbound Cheque Error:', err.message);
        if (err.code === 'PAYMENT_HOLD_BLOCKED') {
            return res.status(409).json({ message: err.message, code: err.code });
        }
        if (err.code === '23505') {
            return res.status(409).json({ message: 'This cheque number has already been recorded for this bank account' });
        }
        res.status(500).json({ message: err.message || 'Failed to issue outbound cheque' });
    } finally {
        client.release();
    }
});

// GET /ap/cheque-register/next-number - Suggest the next numeric cheque number for a bank account
router.get('/ap/cheque-register/next-number', protect, hasPermission(['ap-pdc:view']), async (req, res) => {
    try {
        const { bank_account_id } = req.query;
        if (!bank_account_id) return res.status(400).json({ message: 'bank_account_id is required' });
        const { rows } = await db.query(
            `SELECT cheque_number FROM cheque_records
             WHERE bank_account_id = $1 AND cheque_number ~ '^[0-9]+$'
             ORDER BY (cheque_number::bigint) DESC LIMIT 1`,
            [bank_account_id]
        );
        const last = rows[0]?.cheque_number;
        if (!last) return res.json({ success: true, data: { next_cheque_number: null } });
        const width = last.length;
        const next = String(BigInt(last) + 1n).padStart(width, '0');
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

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await apPdcService.verifyOutboundPayment(client, { chequeRecordId, userId: req.user?.employee_id });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Outbound cheque verified and cleared', ...result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Verify Outbound Cheque Error:', err.message);
        res.status(500).json({ message: err.message || 'Failed to verify outbound cheque' });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/fail - Bounce/dishonor an outbound cheque
router.post('/ap/outbound-clearance/:chequeRecordId/fail', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { bounce_fee, reason } = req.body;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await apPdcService.processBouncedOutboundCheque(client, {
            chequeRecordId, bounceFee: bounce_fee, reason, userId: req.user?.employee_id,
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Outbound cheque bounced and reversal processed', ...result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Fail Outbound Cheque Error:', err.message);
        res.status(500).json({ message: err.message || 'Failed to process bounced outbound cheque' });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/redeposit - Re-present a bounced outbound cheque
router.post('/ap/outbound-clearance/:chequeRecordId/redeposit', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { lift_payment_hold, notes } = req.body;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await apPdcService.redepositOutboundCheque(client, {
            chequeRecordId, liftPaymentHold: Boolean(lift_payment_hold), notes, userId: req.user?.employee_id,
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Outbound cheque re-presented for clearance', data: result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Redeposit Outbound Cheque Error:', err.message);
        res.status(400).json({ message: err.message || 'Failed to re-deposit outbound cheque' });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/void - Void a spoiled/mistake cheque before it was ever honored
router.post('/ap/outbound-clearance/:chequeRecordId/void', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ message: 'A void reason is required' });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await apPdcService.voidCheque(client, { chequeRecordId, reason: reason.trim(), userId: req.user?.employee_id });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Cheque voided', data: result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Void Outbound Cheque Error:', err.message);
        res.status(400).json({ message: err.message || 'Failed to void cheque' });
    } finally {
        client.release();
    }
});

// POST /ap/outbound-clearance/:chequeRecordId/replace - Replace a stale or repeatedly-bounced cheque
router.post('/ap/outbound-clearance/:chequeRecordId/replace', protect, hasPermission(['ap-pdc:manage']), async (req, res) => {
    const chequeRecordId = parseInt(req.params.chequeRecordId, 10);
    if (!chequeRecordId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { new_cheque_number, new_cheque_date, new_bank_account_id, reason } = req.body;
    if (!new_cheque_number || !new_cheque_date) {
        return res.status(400).json({ message: 'new_cheque_number and new_cheque_date are required' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await apPdcService.replaceCheque(client, {
            chequeRecordId,
            newChequeNumber: new_cheque_number,
            newChequeDate: new_cheque_date,
            newBankAccountId: new_bank_account_id,
            reason,
            userId: req.user?.employee_id,
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Cheque replaced', data: result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Replace Outbound Cheque Error:', err.message);
        if (err.code === '23505') {
            return res.status(409).json({ message: 'This cheque number has already been recorded for this bank account' });
        }
        res.status(400).json({ message: err.message || 'Failed to replace cheque' });
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
        const { bank_account_id } = req.query;
        const params = [];
        let where = 'WHERE cr.cheque_number IS NOT NULL';
        if (bank_account_id) {
            params.push(bank_account_id);
            where += ` AND cr.bank_account_id = $${params.length}`;
        }
        const { rows } = await db.query(
            `SELECT cr.id, cr.bank_account_id, ba.account_name, cr.cheque_number, cr.status,
                    cr.purpose_type, cr.payee, cr.amount, cr.cheque_date, cr.is_void, cr.void_reason,
                    cr.replaces_cheque_id, cr.replaced_by_cheque_id, cr.created_at
             FROM cheque_records cr
             LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
             ${where}
             ORDER BY cr.bank_account_id, cr.cheque_number`,
            params
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('AP Cheque Register Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch cheque register' });
    }
});

// ── Supplier bills (minimal — header-only, just enough to attach outbound cheques to a real liability) ──

router.get('/ap/supplier-bills', protect, hasPermission(['ap-pdc:view', 'ap:view']), async (req, res) => {
    try {
        const { supplier_id, status } = req.query;
        const params = [];
        let where = 'WHERE 1=1';
        if (supplier_id) { params.push(supplier_id); where += ` AND sb.supplier_id = $${params.length}`; }
        if (status && status !== 'all') { params.push(status); where += ` AND sb.status = $${params.length}`; }
        else if (!status) { where += ` AND sb.status != 'Paid'`; }
        const { rows } = await db.query(
            `SELECT sb.*, s.supplier_name,
                    GREATEST(CURRENT_DATE - COALESCE(sb.due_date, sb.bill_date), 0) AS days_overdue
             FROM supplier_bill sb
             JOIN supplier s ON s.supplier_id = sb.supplier_id
             ${where} ORDER BY sb.due_date NULLS LAST, sb.bill_date`,
            params
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('List Supplier Bills Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch supplier bills' });
    }
});

// POST /ap/supplier-bills - Create a payable directly against a supplier (no PO/GRN
// required). Auto-generates a bill_number when none is supplied, and posts the
// BILL_POSTED ap_ledger entry in the same transaction so the new liability shows up
// in AP balances/aging immediately, exactly like the automatic GRN-triggered path does.
router.post('/ap/supplier-bills', protect, hasPermission(['ap:manage']), async (req, res) => {
    const { supplier_id, po_id, grn_id, bill_number, bill_date, due_date, total_amount, notes } = req.body;
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

        const resolvedBillNumber = bill_number || await getNextDocumentNumber(client, 'BILL');

        const { rows: [bill] } = await client.query(
            `INSERT INTO supplier_bill (supplier_id, po_id, grn_id, bill_number, bill_date, due_date, total_amount, notes, created_by)
             VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, $8, $9) RETURNING *`,
            [supplier_id, po_id || null, grn_id || null, resolvedBillNumber, bill_date || null, resolvedDueDate, parsedAmount, notes || null, req.user?.employee_id]
        );

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
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A bill with this number already exists.' });
        }
        res.status(500).json({ message: 'Failed to create supplier bill' });
    } finally {
        client.release();
    }
});

// ── Bank accounts (minimal CRUD, required to select an account when issuing cheques) ──

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
