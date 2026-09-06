'use strict';

/**
 * Post-invoice A/R concessions: settlement discounts and balance write-downs.
 *
 * The one rule this file exists to enforce: a concession is not money. It never
 * becomes a payment_methods row, never enters a tender list, and never lands in
 * invoice_payments or invoice_payment_allocation. It relieves the receivable
 * through its own document and its own ar_ledger entry type, so a cash-basis
 * report can always tell what was collected apart from what was forgiven.
 *
 * Every write goes through createAdjustment() or reverseAdjustment(). Nothing
 * else may INSERT into ar_adjustment -- the immutability triggers in
 * 20260906_05 will reject an edit, but they cannot invent a document number, an
 * allocation, or a ledger entry for a caller that skipped this service.
 *
 * Callers own the transaction: pass an open PoolClient, exactly as
 * arLedgerService.appendEntry() requires.
 */

const arLedger = require('./arLedgerService');
const periodLock = require('./periodLockService');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/** ar_ledger entry type each document posts. */
const LEDGER_ENTRY_TYPE = {
    SETTLEMENT_DISCOUNT: 'SETTLEMENT_DISCOUNT',
    BALANCE_WRITE_DOWN: 'BALANCE_WRITE_DOWN',
};

const MIN_NOTE_LENGTH = 10;

class AdjustmentError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

// ────────────────────────────────────────────────────────────────
// Reasons
// ────────────────────────────────────────────────────────────────

/**
 * @param {object} executor  db or an open PoolClient
 */
async function listReasons(executor, { activeOnly = true, appliesTo = null } = {}) {
    const clauses = [];
    const params = [];
    if (activeOnly) clauses.push('is_active = true');
    if (appliesTo) {
        params.push(appliesTo);
        clauses.push(`(applies_to = $${params.length} OR applies_to = 'BOTH')`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await executor.query(
        `SELECT reason_code, label, description, applies_to, gl_treatment,
                max_amount, requires_note, is_active, sort_order
           FROM ar_adjustment_reason
           ${where}
          ORDER BY sort_order, label`,
        params
    );
    return rows;
}

/**
 * Reason rules are checked here rather than in the route so the POS path, the
 * A/R path and the standalone write-down cannot drift apart on what counts as a
 * valid concession.
 */
async function resolveReason(client, { reasonCode, adjustmentType, amount, notes }) {
    if (!reasonCode) {
        throw new AdjustmentError('A reason code is required. A concession without a stated reason cannot be reviewed later.');
    }

    const { rows: [reason] } = await client.query(
        `SELECT * FROM ar_adjustment_reason WHERE reason_code = $1`, [reasonCode]
    );
    if (!reason) throw new AdjustmentError(`Unknown reason code '${reasonCode}'.`);
    if (!reason.is_active) throw new AdjustmentError(`Reason '${reason.label}' is no longer in use.`);

    const scope = adjustmentType === 'SETTLEMENT_DISCOUNT' ? 'SETTLEMENT' : 'WRITE_DOWN';
    if (reason.applies_to !== 'BOTH' && reason.applies_to !== scope) {
        throw new AdjustmentError(
            `Reason '${reason.label}' cannot be used for ${scope === 'SETTLEMENT'
                ? 'a discount granted during a collection'
                : 'a write-down granted without a payment'}.`
        );
    }

    if (reason.max_amount !== null && amount > Number(reason.max_amount) + 0.005) {
        throw new AdjustmentError(
            `Reason '${reason.label}' is capped at ₱${Number(reason.max_amount).toFixed(2)}; ₱${amount.toFixed(2)} was entered.`
        );
    }

    if (reason.requires_note && (!notes || notes.trim().length < MIN_NOTE_LENGTH)) {
        throw new AdjustmentError(
            `Reason '${reason.label}' requires a note of at least ${MIN_NOTE_LENGTH} characters explaining the concession.`
        );
    }

    return reason;
}

// ────────────────────────────────────────────────────────────────
// Invoice arithmetic
// ────────────────────────────────────────────────────────────────

/**
 * What is still owed on an invoice, counting every way it can already have been
 * settled. Mirrors recompute_invoice_settlement() deliberately: if the two ever
 * disagreed, a concession could be allocated past the balance and push the
 * invoice into over-settlement.
 */
async function outstandingForInvoice(client, invoiceId) {
    const { rows: [row] } = await client.query(
        `SELECT i.invoice_id, i.invoice_number, i.customer_id, i.status,
                i.total_amount,
                COALESCE((SELECT SUM(amount_paid) FROM invoice_payments
                           WHERE invoice_id = i.invoice_id AND payment_status = 'settled'), 0)
              + COALESCE((SELECT SUM(ipa.amount_allocated) FROM invoice_payment_allocation ipa
                           JOIN customer_payment cp ON cp.payment_id = ipa.payment_id
                          WHERE ipa.invoice_id = i.invoice_id
                            AND cp.pdc_status IS DISTINCT FROM 'BOUNCED'), 0)
              + COALESCE((SELECT SUM(aa.amount) FROM ar_adjustment_allocation aa
                           JOIN ar_adjustment adj ON adj.adjustment_id = aa.adjustment_id
                          WHERE aa.invoice_id = i.invoice_id AND adj.status = 'POSTED'
                            AND adj.reverses_adjustment_id IS NULL), 0) AS settled,
                COALESCE((SELECT SUM(total_amount) FROM credit_note WHERE invoice_id = i.invoice_id), 0) AS refunded
           FROM invoice i
          WHERE i.invoice_id = $1`,
        [invoiceId]
    );
    if (!row) throw new AdjustmentError(`Invoice #${invoiceId} not found.`, 404);

    const net = Math.max(round2(Number(row.total_amount) - Number(row.refunded)), 0);
    return {
        invoice_id: row.invoice_id,
        invoice_number: row.invoice_number,
        customer_id: row.customer_id,
        status: row.status,
        total_amount: Number(row.total_amount),
        settled: round2(Number(row.settled)),
        refunded: Number(row.refunded),
        outstanding: round2(net - Number(row.settled)),
    };
}

// ────────────────────────────────────────────────────────────────
// Creating a concession
// ────────────────────────────────────────────────────────────────

/**
 * Turn a caller's allocation list into exactly the set the document will carry,
 * and refuse anything that is not one.
 *
 * This REJECTS rather than filters, and that distinction is load-bearing. A
 * route that has to authorize a concession must be able to compute the amount
 * being authorized from the same input the document will be written from. When
 * the service silently discarded non-positive entries, the two disagreed: a
 * caller could send [{inv 900, +50000}, {inv 900, -49999.99}], have the
 * authorization checked against the signed sum of 0.01, and have the document
 * written for 50000. Every caller now normalizes once, up front, and works from
 * the result -- so the amount approved and the amount forgiven are the same
 * number by construction.
 *
 * @returns {{ allocations: Array<{invoice_id: number, amount: number}>, total: number }}
 */
function normalizeAllocations(allocations) {
    const list = Array.isArray(allocations) ? allocations : [];
    const clean = [];
    const seen = new Set();

    for (const entry of list) {
        const invoiceId = Number(entry?.invoice_id);
        const amount = round2(entry?.amount);

        if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
            throw new AdjustmentError('Every line of a concession must name the invoice it forgives.');
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new AdjustmentError(
                `The amount forgiven on invoice #${invoiceId} must be greater than zero.`
            );
        }
        if (seen.has(invoiceId)) {
            throw new AdjustmentError(`Invoice #${invoiceId} is listed twice in the same adjustment.`);
        }
        seen.add(invoiceId);
        clean.push({ invoice_id: invoiceId, amount });
    }

    if (clean.length === 0) {
        throw new AdjustmentError(
            'A concession must name the invoices it forgives. An unallocated credit moves the customer balance but leaves the invoice open forever.'
        );
    }

    return { allocations: clean, total: round2(clean.reduce((s, a) => s + a.amount, 0)) };
}

/**
 * @param {import('pg').PoolClient} client   open transaction
 * @param {object}   opts
 * @param {number}   opts.customerId
 * @param {string}   opts.adjustmentType     SETTLEMENT_DISCOUNT | BALANCE_WRITE_DOWN
 * @param {string}   opts.reasonCode
 * @param {Array}    opts.allocations        [{ invoice_id, amount }] — must be non-empty
 * @param {string}   [opts.notes]
 * @param {number}   opts.grantedBy          employee_id keying it in
 * @param {number}   [opts.authorizedBy]     employee_id who authorized, when the grantor lacked the permission
 * @param {string}   [opts.clientRef]        uuid; makes a retried POST idempotent
 * @param {Date|string} [opts.entryDate]     business date; defaults to now
 * @param {number}   [opts.customerPaymentId]
 * @param {number}   [opts.invoicePaymentId]
 * @param {boolean}  [opts.pendingClearance] true when the collection was a cheque —
 *                                           the document is created but has no effect
 *                                           on the invoice or the ledger until it clears
 */
async function createAdjustment(client, {
    customerId,
    adjustmentType,
    reasonCode,
    allocations,
    notes = null,
    grantedBy,
    authorizedBy = null,
    clientRef = null,
    entryDate = null,
    customerPaymentId = null,
    invoicePaymentId = null,
    pendingClearance = false,
}) {
    if (!LEDGER_ENTRY_TYPE[adjustmentType]) {
        throw new AdjustmentError(`Unknown adjustment type '${adjustmentType}'.`);
    }
    if (!customerId) throw new AdjustmentError('customer_id is required.');
    if (!grantedBy) throw new AdjustmentError('The granting employee could not be identified.');

    // A retry of the same request returns the document the first attempt created
    // rather than forgiving the balance twice.
    if (clientRef) {
        const { rows: [existing] } = await client.query(
            `SELECT adjustment_id FROM ar_adjustment WHERE client_ref = $1`, [clientRef]
        );
        if (existing) return getAdjustment(client, existing.adjustment_id);
    }

    const { allocations: cleanAllocations, total: totalAmount } = normalizeAllocations(allocations);

    const reason = await resolveReason(client, { reasonCode, adjustmentType, amount: totalAmount, notes });

    const businessDate = entryDate ? new Date(entryDate) : new Date();
    // A closed month cannot be written into, by anyone. Reopening it is a separate,
    // audited action -- deliberately not a permission check on this write.
    await periodLock.assertPeriodOpen(businessDate, { module: 'ar' });

    // Every invoice must belong to this customer and have room for its share.
    for (const alloc of cleanAllocations) {
        const inv = await outstandingForInvoice(client, alloc.invoice_id);
        if (Number(inv.customer_id) !== Number(customerId)) {
            throw new AdjustmentError(`Invoice ${inv.invoice_number} does not belong to this customer.`);
        }
        if (inv.status === 'Cancelled') {
            throw new AdjustmentError(`Invoice ${inv.invoice_number} is cancelled and has nothing to forgive.`);
        }
        if (alloc.amount > inv.outstanding + 0.005) {
            throw new AdjustmentError(
                `₱${alloc.amount.toFixed(2)} exceeds the ₱${inv.outstanding.toFixed(2)} still outstanding on ${inv.invoice_number}. ` +
                `A concession can only forgive what is actually owed — it never creates a credit balance.`
            );
        }
    }

    const adjustmentNo = await getNextDocumentNumber(client, 'ADJ');
    const status = pendingClearance ? 'PENDING_CLEARANCE' : 'POSTED';

    const { rows: [doc] } = await client.query(
        `INSERT INTO ar_adjustment
            (adjustment_no, customer_id, adjustment_type, reason_code, total_amount, notes,
             status, customer_payment_id, invoice_payment_id, granted_by, authorized_by,
             authorization_method, client_ref, entry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14, CURRENT_TIMESTAMP))
         RETURNING adjustment_id, adjustment_no`,
        [adjustmentNo, customerId, adjustmentType, reasonCode, totalAmount, notes || null,
         status, customerPaymentId, invoicePaymentId, grantedBy, authorizedBy,
         authorizedBy ? 'ELEVATED' : 'SELF', clientRef, businessDate]
    );

    // The allocations are written whatever the status: they are what the document
    // SAYS it forgives, and a cheque-backed concession that had forgotten which
    // invoices it was for could never be posted when the cheque cleared. They
    // carry no settlement weight yet -- recompute_invoice_settlement() counts
    // only POSTED adjustments, so a PENDING_CLEARANCE one moves neither the
    // invoice nor the customer balance. What waits for the cheque is the ledger
    // entry and the status, because posting those now would leave the invoice
    // closed by a discount that was never earned if the cheque bounced.
    await insertAllocations(client, doc.adjustment_id, cleanAllocations);

    if (status === 'POSTED') {
        await appendAdjustmentLedgerEntry(client, {
            adjustmentId: doc.adjustment_id,
            adjustmentNo: doc.adjustment_no,
            adjustmentType,
            customerId,
            totalAmount,
            reason,
            notes,
            createdBy: grantedBy,
            entryDate: businessDate,
        });
    }

    return getAdjustment(client, doc.adjustment_id);
}

async function insertAllocations(client, adjustmentId, allocations) {
    for (const alloc of allocations) {
        await client.query(
            `INSERT INTO ar_adjustment_allocation (adjustment_id, invoice_id, amount) VALUES ($1,$2,$3)`,
            [adjustmentId, alloc.invoice_id, alloc.amount]
        );
    }
}

/**
 * Posts the single ledger entry a concession produces, and links it back to the
 * document. Split out because a cheque-backed concession runs it later, on
 * clearance, rather than when it was keyed in.
 */
async function appendAdjustmentLedgerEntry(client, {
    adjustmentId, adjustmentNo, adjustmentType, customerId,
    totalAmount, reason, notes, createdBy, entryDate,
}) {
    const ledgerId = await arLedger.appendEntry(client, {
        customerId,
        entryType: LEDGER_ENTRY_TYPE[adjustmentType],
        // Negative: a concession relieves the receivable, same direction as a
        // payment or a credit memo. paymentChannel is left null on purpose --
        // there is no channel, because no money moved.
        amount: -totalAmount,
        referenceNo: adjustmentNo,
        notes: notes && notes.trim() ? `${reason.label} — ${notes.trim()}` : reason.label,
        createdBy,
        entryDate,
    });

    await client.query(
        `UPDATE ar_adjustment SET ledger_id = $1 WHERE adjustment_id = $2`,
        [ledgerId, adjustmentId]
    );

    return ledgerId;
}

// ────────────────────────────────────────────────────────────────
// Cheque clearance
// ────────────────────────────────────────────────────────────────

/**
 * Everything still waiting on one collection instrument.
 *
 * A concession granted alongside a post-dated cheque cannot post when it is
 * keyed: if it did, a bounce would leave the invoice closed by a discount the
 * customer never earned. It sits at PENDING_CLEARANCE until the PDC desk says
 * what became of the cheque.
 */
async function listPendingForPayment(executor, { customerPaymentId = null, invoicePaymentId = null }) {
    const column = customerPaymentId ? 'customer_payment_id' : 'invoice_payment_id';
    const value = customerPaymentId || invoicePaymentId;
    if (!value) return [];
    const { rows } = await executor.query(
        `SELECT a.*
           FROM ar_adjustment a
          WHERE a.${column} = $1 AND a.status = 'PENDING_CLEARANCE'
          FOR UPDATE`,
        [value]
    );
    return rows;
}

/**
 * The cheque cleared, so the concession was earned. Posts its ledger entry, flips
 * it to POSTED and refreshes the invoices it names — in the same transaction as
 * the PAYMENT_SETTLED entry the clearance itself writes, so the cash and the
 * concession become real together or not at all.
 *
 * @returns {Array<string>} the adjustment numbers that were posted
 */
async function postPendingForPayment(client, { customerPaymentId = null, invoicePaymentId = null, employeeId = null }) {
    const pending = await listPendingForPayment(client, { customerPaymentId, invoicePaymentId });
    const posted = [];

    for (const doc of pending) {
        const { rows: [reason] } = await client.query(
            `SELECT * FROM ar_adjustment_reason WHERE reason_code = $1`, [doc.reason_code]
        );

        await appendAdjustmentLedgerEntry(client, {
            adjustmentId: doc.adjustment_id,
            adjustmentNo: doc.adjustment_no,
            adjustmentType: doc.adjustment_type,
            customerId: doc.customer_id,
            totalAmount: Number(doc.total_amount),
            reason,
            notes: doc.notes,
            createdBy: employeeId || doc.granted_by,
            // Dated the day the cheque cleared, not the day the concession was
            // keyed. The A/R ledger is cash-basis; the discount became real at
            // the same moment the money did.
            entryDate: new Date(),
        });

        // trg_ar_adjustment_status_recompute refreshes every invoice this document
        // names, so the concession lands on them the moment the status changes —
        // the same mechanism a reversal relies on.
        await client.query(
            `UPDATE ar_adjustment SET status = 'POSTED' WHERE adjustment_id = $1`,
            [doc.adjustment_id]
        );

        posted.push(doc.adjustment_no);
    }

    return posted;
}

/**
 * The cheque bounced, so the concession was never earned and the customer's full
 * balance stands. The document is voided rather than deleted — it was granted,
 * and the record of that is exactly the point.
 *
 * Nothing needs unwinding: a PENDING_CLEARANCE document never had a ledger entry,
 * and its allocations never counted towards settlement, so voiding it leaves the
 * invoice precisely as the bounce found it.
 *
 * @returns {Array<string>} the adjustment numbers that were voided
 */
async function voidPendingForPayment(client, { customerPaymentId = null, invoicePaymentId = null, reason = null }) {
    const pending = await listPendingForPayment(client, { customerPaymentId, invoicePaymentId });
    const voided = [];

    for (const doc of pending) {
        await client.query(
            `UPDATE ar_adjustment SET status = 'VOIDED', reversal_reason = $2 WHERE adjustment_id = $1`,
            [doc.adjustment_id, reason || 'Cheque bounced — the concession granted alongside it was never earned.']
        );
        voided.push(doc.adjustment_no);
    }

    return voided;
}

// ────────────────────────────────────────────────────────────────
// Reversing
// ────────────────────────────────────────────────────────────────

/**
 * Corrections are made by posting the opposite document, never by editing the
 * original -- both remain on the customer's statement, which is the point.
 */
async function reverseAdjustment(client, { adjustmentId, reason, employeeId }) {
    if (!reason || reason.trim().length < MIN_NOTE_LENGTH) {
        throw new AdjustmentError(`A reversal reason of at least ${MIN_NOTE_LENGTH} characters is required.`);
    }

    const { rows: [original] } = await client.query(
        `SELECT * FROM ar_adjustment WHERE adjustment_id = $1 FOR UPDATE`, [adjustmentId]
    );
    if (!original) throw new AdjustmentError('Adjustment not found.', 404);
    if (original.status === 'REVERSED') {
        throw new AdjustmentError(`${original.adjustment_no} has already been reversed.`, 409);
    }
    if (original.status !== 'POSTED') {
        throw new AdjustmentError(`${original.adjustment_no} is ${original.status.toLowerCase().replace('_', ' ')} and cannot be reversed.`, 409);
    }

    const reversalDate = new Date();
    // The reversal is dated today, so it is today's period that must be open --
    // not the period the original was posted into.
    await periodLock.assertPeriodOpen(reversalDate, { module: 'ar' });

    const { rows: allocations } = await client.query(
        `SELECT invoice_id, amount FROM ar_adjustment_allocation WHERE adjustment_id = $1`,
        [adjustmentId]
    );

    const reversalNo = await getNextDocumentNumber(client, 'ADJ');
    const { rows: [reversal] } = await client.query(
        `INSERT INTO ar_adjustment
            (adjustment_no, customer_id, adjustment_type, reason_code, total_amount, notes,
             status, granted_by, authorization_method, entry_date, reverses_adjustment_id)
         VALUES ($1,$2,$3,$4,$5,$6,'POSTED',$7,'SELF',$8,$9)
         RETURNING adjustment_id, adjustment_no`,
        [reversalNo, original.customer_id, original.adjustment_type, original.reason_code,
         original.total_amount, `Reversal of ${original.adjustment_no}: ${reason.trim()}`,
         employeeId, reversalDate, original.adjustment_id]
    );

    // Mirrored allocations record which invoices this reversal reopened, and
    // satisfy the "every peso lands on a named invoice" constraint. They carry no
    // settlement weight -- recompute_invoice_settlement() counts only POSTED
    // adjustments that are not themselves reversals (20260906_07). What reopens
    // the balance is the original dropping out of the sum when it goes REVERSED.
    await insertAllocations(client, reversal.adjustment_id, allocations);

    const ledgerId = await arLedger.appendEntry(client, {
        customerId: original.customer_id,
        entryType: 'ADJUSTMENT_REVERSAL',
        // Positive: the receivable is reinstated.
        amount: Number(original.total_amount),
        referenceNo: reversal.adjustment_no,
        notes: `Reversal of ${original.adjustment_no} — ${reason.trim()}`,
        createdBy: employeeId,
        entryDate: reversalDate,
    });

    await client.query(
        `UPDATE ar_adjustment SET ledger_id = $1 WHERE adjustment_id = $2`,
        [ledgerId, reversal.adjustment_id]
    );

    // Flipping the original triggers the invoice recompute, reopening the balance.
    await client.query(
        `UPDATE ar_adjustment
            SET status = 'REVERSED', reversed_at = CURRENT_TIMESTAMP, reversal_reason = $2
          WHERE adjustment_id = $1`,
        [adjustmentId, reason.trim()]
    );

    await client.query(
        `INSERT INTO ar_adjustment_authorization_log
            (adjustment_id, customer_id, action, requested_by, amount, reason_code, notes)
         VALUES ($1,$2,'REVERSED',$3,$4,$5,$6)`,
        [adjustmentId, original.customer_id, employeeId, original.total_amount,
         original.reason_code, reason.trim()]
    );

    return getAdjustment(client, reversal.adjustment_id);
}

// ────────────────────────────────────────────────────────────────
// Reading
// ────────────────────────────────────────────────────────────────

async function getAdjustment(executor, adjustmentId) {
    const { rows: [doc] } = await executor.query(
        `SELECT a.*, r.label AS reason_label, r.gl_treatment,
                c.company_name, c.first_name, c.last_name,
                g.username AS granted_by_username,
                z.username AS authorized_by_username,
                orig.adjustment_no AS reverses_adjustment_no
           FROM ar_adjustment a
           JOIN ar_adjustment_reason r ON r.reason_code = a.reason_code
           JOIN customer c             ON c.customer_id = a.customer_id
           LEFT JOIN employee g        ON g.employee_id = a.granted_by
           LEFT JOIN employee z        ON z.employee_id = a.authorized_by
           LEFT JOIN ar_adjustment orig ON orig.adjustment_id = a.reverses_adjustment_id
          WHERE a.adjustment_id = $1`,
        [adjustmentId]
    );
    if (!doc) return null;

    const { rows: allocations } = await executor.query(
        `SELECT aa.invoice_id, aa.amount, i.invoice_number, i.status, i.total_amount, i.amount_paid
           FROM ar_adjustment_allocation aa
           JOIN invoice i ON i.invoice_id = aa.invoice_id
          WHERE aa.adjustment_id = $1
          ORDER BY i.invoice_id`,
        [adjustmentId]
    );

    return { ...doc, total_amount: Number(doc.total_amount), allocations };
}

module.exports = {
    AdjustmentError,
    LEDGER_ENTRY_TYPE,
    MIN_NOTE_LENGTH,
    listReasons,
    resolveReason,
    outstandingForInvoice,
    normalizeAllocations,
    createAdjustment,
    insertAllocations,
    appendAdjustmentLedgerEntry,
    listPendingForPayment,
    postPendingForPayment,
    voidPendingForPayment,
    reverseAdjustment,
    getAdjustment,
};
