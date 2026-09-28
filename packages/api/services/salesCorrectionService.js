'use strict';

const db = require('../db');
const arLedger = require('./arLedgerService');

const AUTOMATIC_RESOLUTION = 'CANCEL_ONLY';

function appError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function asNumber(value) {
    return Number.parseFloat(value || 0) || 0;
}

async function assertFeatureEnabled(client) {
    const { rows: [setting] } = await client.query(
        `SELECT setting_value FROM settings WHERE setting_key = 'ENABLE_SALES_CORRECTIONS'`,
    );
    if (setting?.setting_value !== 'true') {
        throw appError('Correct & Restart Sale is not enabled for this environment.', 403);
    }
}

async function getInvoiceState(client, invoiceId, { lock = false } = {}) {
    const { rows: [invoice] } = await client.query(
        `SELECT i.invoice_id, i.invoice_number, i.customer_id, i.employee_id, i.invoice_date,
                i.status, i.physical_receipt_no, i.total_amount,
                COALESCE(p.payment_count, 0)::int AS payment_count,
                COALESCE(p.settled_amount, 0) AS settled_amount,
                COALESCE(p.pending_amount, 0) AS pending_amount,
                COALESCE(c.credit_note_count, 0)::int AS credit_note_count,
                COALESCE(c.credit_note_total, 0) AS credit_note_total,
                EXISTS(
                    SELECT 1 FROM period_lock pl
                     WHERE pl.module = 'sales'
                       AND pl.is_locked = true
                       AND pl.period_month = date_trunc('month', i.invoice_date AT TIME ZONE 'Asia/Manila')::date
                ) AS period_locked
           FROM invoice i
           LEFT JOIN LATERAL (
                SELECT COUNT(*) AS payment_count,
                       SUM(CASE WHEN payment_status = 'settled' THEN amount_paid ELSE 0 END) AS settled_amount,
                       SUM(CASE WHEN payment_status IN ('pending', 'on_account') THEN amount_paid ELSE 0 END) AS pending_amount
                  FROM invoice_payments WHERE invoice_id = i.invoice_id
           ) p ON TRUE
           LEFT JOIN LATERAL (
                SELECT COUNT(*) AS credit_note_count, SUM(total_amount) AS credit_note_total
                  FROM credit_note WHERE invoice_id = i.invoice_id
           ) c ON TRUE
          WHERE i.invoice_id = $1 ${lock ? 'FOR UPDATE OF i' : ''}`,
        [invoiceId],
    );
    if (!invoice) throw appError('Invoice not found.', 404);
    return invoice;
}

function proposeResolution(invoice) {
    if (invoice.status === 'Cancelled') {
        return { resolution: 'MANUAL_REVIEW', automatic: false, reason: 'This invoice is already cancelled.' };
    }
    if (invoice.period_locked) {
        return { resolution: 'MANUAL_REVIEW', automatic: false, reason: 'The invoice accounting period is locked.' };
    }
    if (asNumber(invoice.credit_note_count) > 0) {
        return {
            resolution: 'RECOVER_REFUND_AND_RESTART', automatic: false,
            reason: 'Issued credit notes need explicit refund-payout/recovery evidence and accounting review.',
        };
    }
    if (asNumber(invoice.settled_amount) > 0 || asNumber(invoice.pending_amount) > 0) {
        return {
            resolution: 'REVERSE_PAYMENT_AND_CANCEL', automatic: false,
            reason: 'Recorded payments must be reversed through the appropriate payment workflow before cancellation.',
        };
    }
    return { resolution: AUTOMATIC_RESOLUTION, automatic: true, reason: null };
}

async function preview(invoiceId) {
    const client = await db.getClient();
    try {
        await assertFeatureEnabled(client);
        const invoice = await getInvoiceState(client, invoiceId);
        const proposal = proposeResolution(invoice);
        const { rows: lines } = await client.query(
            `SELECT invoice_line_id, part_id, quantity, sale_price, cost_at_sale
               FROM invoice_line WHERE invoice_id = $1 ORDER BY invoice_line_id`, [invoiceId],
        );
        return {
            invoice,
            proposal,
            impact: {
                inventory: proposal.automatic ? lines.map(line => ({ part_id: line.part_id, quantity: asNumber(line.quantity) })) : [],
                ar: proposal.automatic ? -asNumber(invoice.total_amount) : 0,
                cash_or_bank: 0,
                tax: proposal.automatic ? -asNumber(invoice.total_amount) : 0,
            },
            replacement: {
                creates_invoice_now: false,
                receives_fresh_identity: true,
                source_lines: lines,
            },
        };
    } finally {
        client.release();
    }
}

async function executeCancelOnly(client, { caseId, invoice, employeeId }) {
    const { rows: lines } = await client.query(
        `SELECT part_id, quantity FROM invoice_line WHERE invoice_id = $1 ORDER BY invoice_line_id`,
        [invoice.invoice_id],
    );
    for (const line of lines) {
        await client.query(
            `INSERT INTO inventory_transaction (part_id, trans_type, quantity, reference_no, employee_id, notes)
             VALUES ($1, 'Reversal', $2, $3, $4, $5)`,
            [line.part_id, line.quantity, invoice.invoice_number, employeeId,
                `SALES CORRECTION ${caseId}: Cancel and restart`],
        );
    }

    const { rows: [ledger] } = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS net FROM ar_ledger WHERE invoice_id = $1`, [invoice.invoice_id],
    );
    const net = asNumber(ledger.net);
    if (net !== 0) {
        await arLedger.appendEntry(client, {
            customerId: invoice.customer_id,
            invoiceId: invoice.invoice_id,
            entryType: net > 0 ? 'CREDIT_ADJUSTMENT' : 'DEBIT_ADJUSTMENT',
            amount: -net,
            referenceNo: invoice.invoice_number,
            notes: `SALES CORRECTION ${caseId}: Cancel and restart`,
            createdBy: employeeId,
        });
    }
    // Physical receipt numbers remain attached to the cancelled original.  A
    // replacement must receive a new identity; this is intentionally different
    // from the legacy simple-void endpoint.
    await client.query(`UPDATE invoice SET status = 'Cancelled' WHERE invoice_id = $1`, [invoice.invoice_id]);
}

async function createCase({ invoiceId, reasonCode, reasonText, requestedBy, idempotencyKey, evidence = {} }) {
    if (!reasonCode || !String(reasonCode).trim() || !reasonText || String(reasonText).trim().length < 5) {
        throw appError('A reason code and at least five characters of explanation are required.');
    }
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await assertFeatureEnabled(client);
        const existing = idempotencyKey ? await client.query(
            `SELECT * FROM sales_correction_case WHERE idempotency_key = $1 FOR UPDATE`, [idempotencyKey],
        ) : { rows: [] };
        if (existing.rows[0]) {
            await client.query('COMMIT');
            return existing.rows[0];
        }
        const invoice = await getInvoiceState(client, invoiceId, { lock: true });
        const proposal = proposeResolution(invoice);
        const state = proposal.automatic ? 'PENDING_APPROVAL' : 'REQUIRES_MANUAL_REVIEW';
        const { rows: [created] } = await client.query(
            `INSERT INTO sales_correction_case
                (original_invoice_id, requested_by, reason_code, reason_text, state, financial_resolution, resolution_evidence, idempotency_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::uuid, gen_random_uuid()))
             RETURNING *`,
            [invoiceId, requestedBy, String(reasonCode).trim(), String(reasonText).trim(), state,
                proposal.resolution, JSON.stringify({ ...evidence, preview_reason: proposal.reason }), idempotencyKey || null],
        );
        await client.query('COMMIT');
        return created;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505' && /original_invoice_id/.test(error.detail || '')) {
            throw appError('A correction case already exists for this invoice.', 409);
        }
        throw error;
    } finally {
        client.release();
    }
}

async function approveAndExecute(caseId, approverId) {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await assertFeatureEnabled(client);
        const { rows: [caseRow] } = await client.query(
            `SELECT * FROM sales_correction_case WHERE correction_case_id = $1 FOR UPDATE`, [caseId],
        );
        if (!caseRow) throw appError('Correction case not found.', 404);
        if (caseRow.state === 'COMPLETED') {
            await client.query('COMMIT');
            return caseRow;
        }
        if (caseRow.state !== 'PENDING_APPROVAL') {
            throw appError(`This correction case cannot be approved while ${caseRow.state}.`, 409);
        }
        const invoice = await getInvoiceState(client, caseRow.original_invoice_id, { lock: true });
        const proposal = proposeResolution(invoice);
        if (!proposal.automatic || caseRow.financial_resolution !== AUTOMATIC_RESOLUTION) {
            await client.query(
                `UPDATE sales_correction_case
                    SET state = 'REQUIRES_MANUAL_REVIEW', approved_by = $2, approved_at = NOW(),
                        failure_reason = $3
                  WHERE correction_case_id = $1`, [caseId, approverId, proposal.reason || 'The invoice state changed before approval.'],
            );
            await client.query('COMMIT');
            throw appError(proposal.reason || 'This correction requires manual accounting review.', 409);
        }
        await client.query(
            `UPDATE sales_correction_case SET state = 'EXECUTING', approved_by = $2, approved_at = NOW(), executed_at = NOW()
              WHERE correction_case_id = $1`, [caseId, approverId],
        );
        await executeCancelOnly(client, { caseId, invoice, employeeId: approverId });
        const { rows: [completed] } = await client.query(
            `UPDATE sales_correction_case SET state = 'COMPLETED', completed_at = NOW()
              WHERE correction_case_id = $1 RETURNING *`, [caseId],
        );
        await client.query('COMMIT');
        return completed;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function getCase(caseId) {
    const { rows: [caseRow] } = await db.query(
        `SELECT sc.*, i.invoice_number AS original_invoice_number,
                ri.invoice_number AS replacement_invoice_number
           FROM sales_correction_case sc
           JOIN invoice i ON i.invoice_id = sc.original_invoice_id
           LEFT JOIN invoice ri ON ri.invoice_id = sc.replacement_invoice_id
          WHERE sc.correction_case_id = $1`, [caseId],
    );
    if (!caseRow) throw appError('Correction case not found.', 404);
    const { rows: events } = await db.query(
        `SELECT * FROM sales_correction_event WHERE correction_case_id = $1 ORDER BY correction_event_id`, [caseId],
    );
    return { ...caseRow, events };
}

module.exports = { preview, createCase, approveAndExecute, getCase, appError };
