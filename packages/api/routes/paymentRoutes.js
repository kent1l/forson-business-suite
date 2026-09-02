'use strict';

const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const arLedger = require('../services/arLedgerService');
const walletService = require('../services/customerWalletService');
const withholdingTax = require('../services/withholdingTaxService');

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const router = express.Router();

const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');

// --- MOVED to customerRoutes.js ---
// The endpoint for getting unpaid invoices has been moved to keep all customer-related routes together.

// POST /api/payments - Receive a new customer payment and allocate it across invoices.
// This is the primary AR payment entry point used by ReceivePaymentForm.
// One POST call per payment split line (one per physical payment instrument).
// A single cheque covering N invoices → one customer_payment row, N allocation rows.
router.post('/payments', protect, hasPermission('ar:receive_payment'), async (req, res) => {
    const { employee_id } = req.user;
    const {
        customer_id,
        amount,
        method_id,       // integer FK to payment_methods (preferred)
        payment_method,  // legacy string code (fallback)
        reference,
        reference_number, // legacy alias (internal reference / cheque # / GCash ref)
        physical_receipt_no, // physical receipt number for the payment
        cheque_date,     // ISO date string for PDC cheques
        notes,
        allocations,     // [{invoice_id, amount_allocated}] -- the cash being applied
        withholding      // [{invoice_id, amount_withheld}] -- tax the customer deducted
    } = req.body;

    const referenceValue = reference || reference_number || null;
    const physicalReceiptNoValue = physical_receipt_no ? formatPhysicalReceiptNumber(physical_receipt_no) : null;

    if (!customer_id || !amount || !allocations || !Array.isArray(allocations)) {
        return res.status(400).json({ message: 'Missing required fields: customer_id, amount, allocations.' });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ message: 'Payment amount must be greater than zero.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        if (physicalReceiptNoValue) {
            const checkRes = await client.query(
                `SELECT public.is_physical_receipt_no_taken($1) AS is_taken`,
                [physicalReceiptNoValue]
            );
            if (checkRes.rows[0]?.is_taken) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    message: `Physical Receipt No '${physicalReceiptNoValue}' is already registered in the system.`
                });
            }
        }

        // ── Resolve payment method ──────────────────────────────────────────────
        let methodRow = null;
        if (method_id) {
            const r = await client.query(
                `SELECT method_id, code, name, type, config FROM payment_methods WHERE method_id = $1 AND enabled = true`,
                [method_id]
            );
            methodRow = r.rows[0] || null;
        } else if (payment_method) {
            const r = await client.query(
                `SELECT method_id, code, name, type, config FROM payment_methods
                 WHERE (code = $1 OR name ILIKE $1) AND enabled = true LIMIT 1`,
                [payment_method]
            );
            methodRow = r.rows[0] || null;
        }

        if (!methodRow) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid or disabled payment method.' });
        }

        const methodCode = methodRow.code;
        const resolvedMethodId = methodRow.method_id;

        // A cheque/PDC payment is deferred — funds are NOT cleared until PDC desk verification.
        // Detection: explicit 'cheque'/'pdc' codes OR settlement_type config field.
        const isCheque = methodCode === 'cheque' || methodCode === 'pdc' ||
            methodRow.type === 'cheque' ||
            methodRow.config?.settlement_type === 'deferred';

        // ── Store Wallet drawdown ───────────────────────────────────────────────
        if (methodCode === 'store_wallet') {
            const wallet = await walletService.getWallet(customer_id, client);
            if (!wallet || wallet.balance < numAmount) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: `Insufficient store wallet balance. Available: ₱${wallet ? wallet.balance.toFixed(2) : '0.00'}, Requested: ₱${numAmount.toFixed(2)}`
                });
            }
            await walletService.appendWalletTransaction(client, {
                customerId: customer_id,
                type: 'INVOICE_PAYMENT_DRAWDOWN',
                amount: -numAmount,
                referenceType: 'PAYMENT',
                notes: notes || 'Store wallet drawdown for payment',
                createdBy: employee_id,
            });
        }

        // ── Step 1: Create the customer_payment record ─────────────────────────
        // PDC status: RECEIVED = cheque in hand, not yet deposited
        //             CLEARED  = cash / bank transfer already settled
        const pdcStatusValue = isCheque ? 'RECEIVED' : 'CLEARED';
        const chequeDateValue = isCheque && cheque_date ? cheque_date : null;

        const { rows: [{ payment_id: newPaymentId }] } = await client.query(
            `INSERT INTO customer_payment
                (customer_id, employee_id, amount, payment_method, method_id,
                 reference_number, physical_receipt_no, notes, pdc_status, cheque_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING payment_id`,
            [customer_id, employee_id, numAmount, methodCode, resolvedMethodId,
             referenceValue, physicalReceiptNoValue, notes || null, pdcStatusValue, chequeDateValue]
        );

        // ── Step 1b: Resolve tax withheld at source ────────────────────────────
        // A withholding customer pays the invoice net of tax and hands over a BIR
        // certificate for the rest. The deducted amount still settles the receivable,
        // so it is merged into the allocation for the invoice it belongs to -- but it
        // is tracked separately, because no cash was received for it and the ledger
        // has to say so.
        const withholdingEntries = Array.isArray(withholding) ? withholding : [];
        const withholdingByInvoice = new Map();
        let totalWithheld = 0;

        for (const entry of withholdingEntries) {
            const invoiceId = Number(entry.invoice_id);
            const amountWithheld = round2(parseFloat(entry.amount_withheld) || 0);
            if (!invoiceId || amountWithheld <= 0) continue;

            const context = await withholdingTax.loadInvoiceWithholdingContext(client, invoiceId);
            if (!context) throw new Error(`Invoice #${invoiceId} not found.`);
            if (Number(context.invoice.customer_id) !== Number(customer_id)) {
                throw new Error(`Invoice #${invoiceId} does not belong to this customer.`);
            }

            const expected = await withholdingTax.computeWithholdingForInvoice({
                lines: context.lines,
                parts: context.parts,
                customer: context.customer,
            }, client);

            if (!expected.applicable) {
                throw new Error(
                    context.customer.is_withholding_agent
                        ? `Invoice #${context.invoice.invoice_number} has no VATable base for tax to be withheld from.`
                        : `Tax withheld at source can only be recorded for customers marked as withholding agents.`
                );
            }

            // Guard against withholding twice against the same base -- e.g. a partial
            // collection followed by a second one that repeats the full deduction.
            const alreadyWithheld = await withholdingTax.sumWithheldForInvoice(client, invoiceId);
            const ceiling = withholdingTax.computeWithholdingCeiling(expected, context.invoice.total_amount);
            if (alreadyWithheld + amountWithheld > ceiling + 0.01) {
                throw new Error(
                    `Tax withheld on invoice #${context.invoice.invoice_number} (₱${amountWithheld.toFixed(2)}` +
                    (alreadyWithheld > 0 ? `, on top of ₱${alreadyWithheld.toFixed(2)} already recorded` : '') +
                    `) exceeds the most that could plausibly be withheld (₱${ceiling.toFixed(2)}). ` +
                    `Expected ₱${expected.total_withheld.toFixed(2)} on a VAT-exclusive base of ₱${(expected.base_goods + expected.base_services).toFixed(2)}.`
                );
            }

            withholdingByInvoice.set(invoiceId, {
                amount: amountWithheld,
                components: withholdingTax.allocateActualAcrossComponents(expected.components, amountWithheld),
            });
            totalWithheld = round2(totalWithheld + amountWithheld);
        }

        // Fold the withheld amounts into the allocations so each invoice is settled by
        // the full amount it was actually cleared for, cash plus certificate.
        const allocationByInvoice = new Map();
        for (const alloc of allocations) {
            const invoiceId = Number(alloc.invoice_id);
            const amount = parseFloat(alloc.amount_allocated) || 0;
            if (!invoiceId || amount <= 0) continue;
            allocationByInvoice.set(invoiceId, round2((allocationByInvoice.get(invoiceId) || 0) + amount));
        }
        for (const [invoiceId, wh] of withholdingByInvoice) {
            allocationByInvoice.set(invoiceId, round2((allocationByInvoice.get(invoiceId) || 0) + wh.amount));
        }
        const mergedAllocations = Array.from(allocationByInvoice, ([invoice_id, amount_allocated]) => ({ invoice_id, amount_allocated }));

        // ── Step 2: Allocate to invoices ────────────────────────────────────────
        let totalAllocated = 0;

        for (const alloc of mergedAllocations) {
            const allocAmt = parseFloat(alloc.amount_allocated) || 0;
            if (allocAmt <= 0) continue;

            // Validate: allocation must not exceed the invoice's outstanding balance
            const { rows: [invRow] } = await client.query(
                `SELECT i.total_amount,
                        COALESCE(SUM(ipa.amount_allocated), 0) AS already_allocated
                 FROM invoice i
                 LEFT JOIN invoice_payment_allocation ipa ON ipa.invoice_id = i.invoice_id
                 WHERE i.invoice_id = $1
                 GROUP BY i.invoice_id, i.total_amount`,
                [alloc.invoice_id]
            );
            if (!invRow) throw new Error(`Invoice #${alloc.invoice_id} not found.`);
            const availableBalance = parseFloat(invRow.total_amount) - parseFloat(invRow.already_allocated);
            if (allocAmt > availableBalance + 0.01) {
                throw new Error(
                    `Allocation ₱${allocAmt.toFixed(2)} exceeds outstanding balance ₱${availableBalance.toFixed(2)} on invoice #${alloc.invoice_id}.`
                );
            }

            await client.query(
                `INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (invoice_id, payment_id) DO UPDATE SET amount_allocated = EXCLUDED.amount_allocated`,
                [alloc.invoice_id, newPaymentId, allocAmt]
            );
            totalAllocated += allocAmt;

            // ── Step 3: Recompute invoice balance & status ──────────────────────
            // Uses total allocations regardless of PDC status so the invoice reflects
            // committed payments. The AR ledger (cash basis) is updated separately.
            const { rows: [bal] } = await client.query(
                `SELECT i.total_amount,
                        COALESCE(SUM(ipa.amount_allocated), 0) AS total_allocated
                 FROM invoice i
                 LEFT JOIN invoice_payment_allocation ipa ON ipa.invoice_id = i.invoice_id
                 WHERE i.invoice_id = $1
                 GROUP BY i.invoice_id, i.total_amount`,
                [alloc.invoice_id]
            );
            const allocatedForInvoice = parseFloat(bal.total_allocated);
            const invoiceTotal = parseFloat(bal.total_amount);
            const newStatus = allocatedForInvoice >= invoiceTotal ? 'Paid'
                : allocatedForInvoice > 0 ? 'Partially Paid'
                : 'Unpaid';
            await client.query(
                'UPDATE invoice SET status = $1, amount_paid = $2 WHERE invoice_id = $3',
                [newStatus, allocatedForInvoice, alloc.invoice_id]
            );
        }

        // ── Step 4: AR ledger — only for instant / already-cleared payments ────
        // Cheques are credited to the AR ledger when the PDC desk marks them CLEARED,
        // ensuring the customer's balance reflects cleared cash, not just committed amounts.
        // The cash actually received is what settled minus what was withheld; the two
        // are posted as separate entries so a cash-basis report never counts a tax
        // certificate as collections.
        const cashSettled = round2(totalAllocated - totalWithheld);
        if (!isCheque && cashSettled > 0) {
            await arLedger.appendEntry(client, {
                customerId: customer_id,
                paymentId: newPaymentId,
                entryType: 'PAYMENT_SETTLED',
                amount: -cashSettled,
                paymentChannel: methodCode,
                referenceNo: referenceValue,
                notes: notes || `Payment settled via ${methodCode}`,
                createdBy: employee_id,
                paymentSource: 'customer_payment',
            });
        }

        if (totalWithheld > 0) {
            // Posted even for a cheque collection: the withholding is not contingent on
            // the cheque clearing. The customer has already remitted that tax to BIR
            // under our TIN, and the certificate proving it is owed to us either way.
            await arLedger.appendEntry(client, {
                customerId: customer_id,
                paymentId: newPaymentId,
                entryType: 'WITHHOLDING_TAX_CREDIT',
                amount: -totalWithheld,
                paymentChannel: 'withholding_tax',
                referenceNo: referenceValue,
                notes: 'Tax withheld at source, pending BIR certificate',
                createdBy: employee_id,
                paymentSource: 'customer_payment',
            });

            for (const [invoiceId, wh] of withholdingByInvoice) {
                await withholdingTax.recordWithholdingLines(client, {
                    invoiceId,
                    customerId: customer_id,
                    customerPaymentId: newPaymentId,
                    components: wh.components,
                    employeeId: employee_id,
                });
            }
        }

        // ── Step 5: Overpayment → store wallet ─────────────────────────────────
        const excessAmount = round2(numAmount - (totalAllocated - totalWithheld));
        let overpaymentCredited = 0;
        if (excessAmount > 0.005) {
            await walletService.appendWalletTransaction(client, {
                customerId: customer_id,
                type: 'OVERPAYMENT_CREDIT',
                amount: excessAmount,
                referenceType: 'PAYMENT',
                referenceId: newPaymentId,
                notes: `Automated credit from overpayment on payment #${newPaymentId}`,
                createdBy: employee_id,
            });
            overpaymentCredited = excessAmount;
        }

        await client.query('COMMIT');
        res.status(201).json({
            message: 'Payment received successfully',
            payment_id: newPaymentId,
            allocated_amount: totalAllocated,
            withheld_amount: totalWithheld,
            overpayment_credited: overpaymentCredited,
            pdc_status: pdcStatusValue,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /payments error:', err.message);
        res.status(500).json({ message: err.message || 'Server error during payment transaction.' });
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
            SELECT payment_id, customer_id, employee_id, created_at as payment_date, amount_paid as amount, tendered_amount, COALESCE(legacy_method, method_name) as payment_method, reference, payment_status
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
                   WHERE (refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
                     AND refund_payment_method = 'Cash';`;
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

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const updateQ = `
            UPDATE invoice_payments
            SET payment_status = 'settled',
                settled_at = CURRENT_TIMESTAMP,
                settlement_reference = $2,
                attempt_metadata = COALESCE($3::jsonb, attempt_metadata)
            WHERE payment_id = $1
            RETURNING *;
        `;
        const { rows } = await client.query(updateQ, [
            paymentId,
            settlement_reference || null,
            attempt_metadata ? JSON.stringify(attempt_metadata) : null,
        ]);
        if (!rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Payment not found or already settled.' });
        }

        const p = rows[0];

        // Resolve customer_id and payment method code for the ledger entry
        const { rows: ctx } = await client.query(`
            SELECT i.customer_id, pm.code AS method_code, pm.name AS method_name
            FROM invoice i
            JOIN payment_methods pm ON pm.method_id = $2
            WHERE i.invoice_id = $1
        `, [p.invoice_id, p.method_id]);

        if (ctx.length) {
            await arLedger.appendEntry(client, {
                customerId: ctx[0].customer_id,
                invoiceId: p.invoice_id,
                paymentId: p.payment_id,
                entryType: 'PAYMENT_SETTLED',
                amount: -p.amount_paid,
                paymentChannel: ctx[0].method_code,
                referenceNo: p.reference || settlement_reference || null,
                notes: `Settled via ${ctx[0].method_name}`,
                createdBy: req.user.employee_id,
                paymentSource: 'invoice_payments',
            });
        }

        await client.query('COMMIT');
        return res.json({ message: 'Payment settled successfully.', payment: p });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error settling payment:', err.message);
        return res.status(500).json({ message: 'Server error while settling payment.' });
    } finally {
        client.release();
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
