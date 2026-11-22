'use strict';

const express = require('express');
const db = require('../db');
const { protect, hasPermission, userHasPermission } = require('../middleware/authMiddleware');
const arLedger = require('../services/arLedgerService');
const walletService = require('../services/customerWalletService');
const withholdingTax = require('../services/withholdingTaxService');
const arAdjustment = require('../services/arAdjustmentService');
const arAdjustmentAuth = require('../services/arAdjustmentAuthService');
const physicalDocumentService = require('../services/physicalDocumentService');

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const router = express.Router();

const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');

/**
 * Normalize settlement discount allocations and verify concession prerequisites
 * before opening a database transaction.
 */
function parseSettlementDiscounts(req) {
    const { discounts, discount } = req.body;
    const rawDiscounts = (Array.isArray(discounts) ? discounts : [])
        .filter(d => d && d.invoice_id != null && d.amount !== null && d.amount !== undefined && d.amount !== '');
    let discountEntries = [];
    let totalDiscount = 0;
    if (rawDiscounts.length > 0) {
        try {
            ({ allocations: discountEntries, total: totalDiscount } = arAdjustment.normalizeAllocations(rawDiscounts));
        } catch (err) {
            return { errorStatus: err.statusCode || 400, errorMessage: err.message };
        }
    }

    if (totalDiscount > 0) {
        if (!discount?.reason_code) {
            return {
                errorStatus: 400,
                errorMessage: 'A concession granted during a collection needs a reason code.',
            };
        }
        if (!userHasPermission(req, 'ar:discount_grant') && !discount?.authorization_token) {
            return {
                errorStatus: 403,
                errorMessage: 'Granting a discount needs authorization from someone who holds the discount permission.',
            };
        }
    }

    return { discountEntries, totalDiscount, discount };
}

function isChequeMethodRow(methodRow) {
    return methodRow.code === 'cheque' || methodRow.code === 'pdc' ||
        methodRow.type === 'cheque' ||
        methodRow.config?.settlement_type === 'deferred';
}

async function resolvePaymentMethod(client, methodId, paymentMethod) {
    let methodRow = null;
    if (methodId) {
        const r = await client.query(
            `SELECT method_id, code, name, type, config FROM payment_methods WHERE method_id = $1 AND enabled = true`,
            [methodId]
        );
        methodRow = r.rows[0] || null;
    } else if (paymentMethod) {
        const r = await client.query(
            `SELECT method_id, code, name, type, config FROM payment_methods
             WHERE (code = $1 OR name ILIKE $1) AND enabled = true LIMIT 1`,
            [paymentMethod]
        );
        methodRow = r.rows[0] || null;
    }
    return methodRow;
}

async function resolveWithholdingEntries(client, { customerId, withholding }) {
    const withholdingEntries = Array.isArray(withholding) ? withholding : [];
    const withholdingByInvoice = new Map();
    let totalWithheld = 0;

    for (const entry of withholdingEntries) {
        const invoiceId = Number(entry.invoice_id);
        const amountWithheld = round2(parseFloat(entry.amount_withheld) || 0);
        if (!invoiceId || amountWithheld <= 0) continue;

        const context = await withholdingTax.loadInvoiceWithholdingContext(client, invoiceId);
        if (!context) throw new Error(`Invoice #${invoiceId} not found.`);
        if (Number(context.invoice.customer_id) !== Number(customerId)) {
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

    return { withholdingByInvoice, totalWithheld };
}

async function assertInvoiceAvailableBalance(client, invoiceId, allocAmt) {
    const { rows: [invRow] } = await client.query(
        `SELECT i.total_amount,
                COALESCE(SUM(CASE WHEN cp.pdc_status IS DISTINCT FROM 'BOUNCED' THEN ipa.amount_allocated ELSE 0 END), 0) AS already_allocated
         FROM invoice i
         LEFT JOIN invoice_payment_allocation ipa ON ipa.invoice_id = i.invoice_id
         LEFT JOIN customer_payment cp ON cp.payment_id = ipa.payment_id
         WHERE i.invoice_id = $1
         GROUP BY i.invoice_id, i.total_amount`,
        [invoiceId]
    );
    if (!invRow) throw new Error(`Invoice #${invoiceId} not found.`);
    const availableBalance = parseFloat(invRow.total_amount) - parseFloat(invRow.already_allocated);
    if (allocAmt > availableBalance + 0.01) {
        throw new Error(
            `Allocation ₱${allocAmt.toFixed(2)} exceeds outstanding balance ₱${availableBalance.toFixed(2)} on invoice #${invoiceId}.`
        );
    }
}

async function applySettlementDiscount(client, req, {
    customerId,
    employeeId,
    customerPaymentId,
    isCheque,
    discountEntries,
    totalDiscount,
    discount,
}) {
    if (totalDiscount <= 0) return null;

    let authorizedBy = null;
    if (!userHasPermission(req, 'ar:discount_grant')) {
        authorizedBy = await arAdjustmentAuth.consumeAuthorization(client, {
            token: discount.authorization_token,
            requestedBy: employeeId,
            customerId,
            totalAmount: totalDiscount,
            purpose: 'SETTLEMENT_DISCOUNT',
        });
    }

    const adjustmentDoc = await arAdjustment.createAdjustment(client, {
        customerId,
        adjustmentType: 'SETTLEMENT_DISCOUNT',
        reasonCode: discount.reason_code,
        allocations: discountEntries,
        notes: discount.notes || null,
        grantedBy: employeeId,
        authorizedBy,
        clientRef: discount.client_ref || null,
        customerPaymentId,
        // A cheque cannot carry a concession that posts today. If it did,
        // a bounce would leave the invoice closed by a discount that was
        // never earned -- so the document is created at PENDING_CLEARANCE,
        // with no ledger entry and no settlement weight, and pdcService
        // posts or voids it when the cheque clears or bounces.
        pendingClearance: isCheque,
    });

    if (authorizedBy) {
        await arAdjustmentAuth.linkAuthorizationToAdjustment(client, {
            token: discount.authorization_token,
            adjustmentId: adjustmentDoc.adjustment_id,
        });
    }

    return adjustmentDoc;
}

// --- MOVED to customerRoutes.js ---
// The endpoint for getting unpaid invoices has been moved to keep all customer-related routes together.

// POST /api/payments - Receive a new customer payment and allocate it across invoices.
// This is the primary AR payment entry point used by ReceivePaymentForm.
// One POST call per payment split line (one per physical payment instrument).
// A single cheque covering N invoices → one customer_payment row, N allocation rows.
router.post('/payments', protect, hasPermission('ar:receive_payment'), async (req, res) => {
    const cashDrawer = require('../services/cashDrawerService');
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
        withholding,     // [{invoice_id, amount_withheld}] -- tax the customer deducted
    } = req.body;

    const referenceValue = reference || reference_number || null;
    const physicalDoc = req.body.physical_document;
    const physicalReceiptNoValue = physicalDoc?.recording_method === 'NOTEBOOK'
        ? null
        : (physical_receipt_no ? formatPhysicalReceiptNumber(physical_receipt_no) : null);

    if (!customer_id || !amount || !allocations || !Array.isArray(allocations)) {
        return res.status(400).json({ message: 'Missing required fields: customer_id, amount, allocations.' });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ message: 'Payment amount must be greater than zero.' });
    }

    const parsedDiscount = parseSettlementDiscounts(req);
    if (parsedDiscount.errorStatus) {
        return res.status(parsedDiscount.errorStatus).json({ message: parsedDiscount.errorMessage });
    }
    const { discountEntries, totalDiscount, discount } = parsedDiscount;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await cashDrawer.reserveSourceSession(client, req.body.cash_session_id);
        const cashRequestId = await cashDrawer.beginSourceRequest(client, req);

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
        const methodRow = await resolvePaymentMethod(client, method_id, payment_method);

        if (!methodRow) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid or disabled payment method.' });
        }

        const methodCode = methodRow.code;
        const resolvedMethodId = methodRow.method_id;

        // A cheque/PDC payment is deferred — funds are NOT cleared until PDC desk verification.
        // Detection: explicit 'cheque'/'pdc' codes OR settlement_type config field.
        const isCheque = isChequeMethodRow(methodRow);

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
        const effectiveRecordingMethod = physicalDoc?.recording_method || (physicalReceiptNoValue ? 'PAPER' : 'NOTEBOOK');
        // Defer setting physical_receipt_no until postPhysicalDocument assigns it so
        // the atomic registry check does not collide with this uncommitted row.
        const initialPhysicalReceiptNo = effectiveRecordingMethod === 'PAPER' ? null : physicalReceiptNoValue;

        const { rows: [{ payment_id: newPaymentId }] } = await client.query(
            `INSERT INTO customer_payment
                (customer_id, employee_id, amount, payment_method, method_id,
                 reference_number, physical_receipt_no, notes, pdc_status, cheque_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING payment_id`,
            [customer_id, employee_id, numAmount, methodCode, resolvedMethodId,
             referenceValue, initialPhysicalReceiptNo, notes || null, pdcStatusValue, chequeDateValue]
        );

        // Physical document posting (if physical_document or physicalReceiptNoValue provided)
        let receiptResult = null;
        if (effectiveRecordingMethod === 'PAPER' && (physicalDoc?.physical_receipt_no || physicalReceiptNoValue)) {
            receiptResult = await physicalDocumentService.postPhysicalDocument(client, {
                recording_method: 'PAPER',
                series_id: physicalDoc?.series_id ? parseInt(physicalDoc.series_id, 10) : null,
                physical_receipt_no: physicalDoc?.physical_receipt_no || physicalReceiptNoValue,
                suggestion_token: physicalDoc?.suggestion_token || null,
                exception: physicalDoc?.exception || null,
                source_type: 'CUSTOMER_PAYMENT',
                source_id: newPaymentId,
                employee_id,
                token_employee_id: req.user?.employee_id ?? employee_id,
                workstation_id: req.body.workstation_id || 'default',
                context: 'COLLECTION',
                request_id: req.body.request_id || req.headers['x-request-id'] || null,
            });

            await client.query(
                `UPDATE public.customer_payment
                 SET recording_method = 'PAPER',
                     physical_document_type_id = $1,
                     physical_document_series_id = $2,
                     physical_document_registry_id = $3,
                     physical_receipt_no = $4
                 WHERE payment_id = $5`,
                [receiptResult.type_id || null, receiptResult.series_id || null, receiptResult.registry_id || null, receiptResult.canonical_full_reference || null, newPaymentId]
            );
        } else {
            await client.query(
                `UPDATE public.customer_payment
                 SET recording_method = 'NOTEBOOK'
                 WHERE payment_id = $1`,
                [newPaymentId]
            );
        }
        await cashDrawer.postSourcePayment(client, { kind: 'customer', sourceId: newPaymentId, sessionId: req.body.cash_session_id, actorId: employee_id,
            notebookReceiptId: req.body.notebook_receipt_id, coveredAmount: req.body.notebook_covered_amount, canPost: cashDrawer.userCanPost(req.user) });

        // ── Step 1b: Resolve tax withheld at source ────────────────────────────
        const { withholdingByInvoice, totalWithheld } = await resolveWithholdingEntries(client, {
            customerId: customer_id,
            withholding,
        });

        // Fold the withheld amounts into the allocations so each invoice is settled by
        // the full amount it was actually cleared for, cash plus certificate.
        const allocationByInvoice = new Map();
        for (const alloc of allocations) {
            const invoiceId = Number(alloc.invoice_id);
            const allocAmt = parseFloat(alloc.amount_allocated) || 0;
            if (!invoiceId || allocAmt <= 0) continue;
            allocationByInvoice.set(invoiceId, round2((allocationByInvoice.get(invoiceId) || 0) + allocAmt));
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
            await assertInvoiceAvailableBalance(client, alloc.invoice_id, allocAmt);

            await client.query(
                `INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (invoice_id, payment_id) DO UPDATE SET amount_allocated = EXCLUDED.amount_allocated`,
                [alloc.invoice_id, newPaymentId, allocAmt]
            );
            totalAllocated += allocAmt;

            // ── Step 3: Recompute invoice balance & status ──────────────────────
            await client.query('SELECT recompute_invoice_settlement($1)', [alloc.invoice_id]);
        }

        // ── Step 4: AR ledger — only for instant / already-cleared payments ────
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

        // ── Step 4b: The concession ────────────────────────────────────────────
        const adjustmentDoc = await applySettlementDiscount(client, req, {
            customerId: customer_id,
            employeeId: employee_id,
            customerPaymentId: newPaymentId,
            isCheque,
            discountEntries,
            totalDiscount,
            discount,
        });

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

        const responsePayload = {
            message: 'Payment received successfully',
            payment_id: newPaymentId,
            allocated_amount: totalAllocated,
            withheld_amount: totalWithheld,
            discount_amount: totalDiscount,
            adjustment_no: adjustmentDoc?.adjustment_no || null,
            adjustment_status: adjustmentDoc?.status || null,
            overpayment_credited: overpaymentCredited,
            pdc_status: pdcStatusValue,
        };
        await cashDrawer.finishSourceRequest(client, cashRequestId, 201, responsePayload);
        await client.query('COMMIT');
        res.status(201).json(responsePayload);

    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        console.error('POST /payments error:', err.message);
        const status = err.status || (err.statusCode && err.statusCode < 500 ? err.statusCode : 500);
        res.status(status).json({ code: err.code, message: err.message || 'Server error during payment transaction.' });
    } finally {
        client.release();
    }
});

// POST /api/payments/collection-group - Grouped multi-instrument collection under a single collection receipt
router.post('/payments/collection-group', protect, hasPermission('ar:receive_payment'), async (req, res) => {
    const cashDrawer = require('../services/cashDrawerService');
    const { employee_id } = req.user;
    const {
        customer_id,
        request_id,
        physical_document,
        payments: paymentTenders = [],
        allocations = [],
        withholding,
        notes = null,
        workstation_id = 'default',
    } = req.body;

    if (!customer_id || !Array.isArray(paymentTenders) || paymentTenders.length === 0 || !Array.isArray(allocations) || allocations.length === 0) {
        return res.status(400).json({ message: 'Missing required fields: customer_id, payments, allocations.' });
    }

    const parsedDiscount = parseSettlementDiscounts(req);
    if (parsedDiscount.errorStatus) {
        return res.status(parsedDiscount.errorStatus).json({ message: parsedDiscount.errorMessage });
    }
    const { discountEntries, totalDiscount, discount } = parsedDiscount;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await cashDrawer.reserveSourceSession(client, req.body.cash_session_id);
        const cashRequestId = await cashDrawer.beginSourceRequest(client, req);

        // Idempotency check on request_id
        if (request_id) {
            const { rows: existingGroup } = await client.query(
                `SELECT * FROM public.customer_payment_collection_group WHERE request_id = $1`,
                [request_id]
            );
            if (existingGroup.length > 0) {
                const grp = existingGroup[0];
                const { rows: linkedPayments } = await client.query(
                    `SELECT * FROM public.customer_payment WHERE collection_group_id = $1`,
                    [grp.group_id]
                );
                await client.query('ROLLBACK');
                return res.status(200).json({
                    message: 'Idempotent replay: collection group already recorded',
                    group_id: grp.group_id,
                    group_reference: grp.group_reference,
                    physical_receipt_no: grp.physical_receipt_no,
                    payments: linkedPayments,
                });
            }
        }

        const totalPaymentAmount = round2(paymentTenders.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0));
        if (isNaN(totalPaymentAmount) || totalPaymentAmount <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Total payment amount must be greater than zero.' });
        }

        const effectiveRecordingMethod = physical_document?.recording_method || 'PAPER';
        const candidatePrn = effectiveRecordingMethod === 'PAPER' && physical_document?.physical_receipt_no
            ? formatPhysicalReceiptNumber(physical_document.physical_receipt_no)
            : null;
        if (candidatePrn) {
            const checkRes = await client.query(
                `SELECT public.is_physical_receipt_no_taken($1) AS is_taken`,
                [candidatePrn]
            );
            if (checkRes.rows[0]?.is_taken) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    message: `Physical Receipt No '${candidatePrn}' is already registered in the system.`
                });
            }
        }

        // Create collection group
        const groupRef = `CRG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const { rows: [newGroup] } = await client.query(
            `INSERT INTO public.customer_payment_collection_group
             (group_reference, customer_id, created_by, request_id, recording_method, total_amount, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING group_id`,
            [groupRef, customer_id, employee_id, request_id || null, effectiveRecordingMethod, totalPaymentAmount, notes || null]
        );
        const groupId = newGroup.group_id;

        // Atomic post physical document for the collection group (or record NOTEBOOK preference)
        let receiptResult = null;
        if (effectiveRecordingMethod === 'PAPER' || effectiveRecordingMethod === 'NOTEBOOK') {
            receiptResult = await physicalDocumentService.postPhysicalDocument(client, {
                recording_method: effectiveRecordingMethod,
                series_id: physical_document?.series_id ? parseInt(physical_document.series_id, 10) : null,
                physical_receipt_no: candidatePrn,
                suggestion_token: physical_document?.suggestion_token || null,
                exception: physical_document?.exception || null,
                source_type: 'COLLECTION_GROUP',
                source_id: groupId,
                employee_id,
                token_employee_id: req.user?.employee_id ?? employee_id,
                workstation_id,
                context: 'COLLECTION',
                request_id: request_id || `crg:${groupId}`,
            });

            if (effectiveRecordingMethod === 'PAPER') {
                await client.query(
                    `UPDATE public.customer_payment_collection_group
                     SET physical_document_type_id = $1,
                         physical_document_series_id = $2,
                         physical_document_registry_id = $3,
                         physical_receipt_no = $4
                     WHERE group_id = $5`,
                    [receiptResult.type_id || null, receiptResult.series_id || null, receiptResult.registry_id || null, receiptResult.canonical_full_reference || null, groupId]
                );
            }
        }

        const groupPrn = receiptResult?.canonical_full_reference || null;

        // Create individual customer_payment records for each tender
        const createdPayments = [];
        for (const tender of paymentTenders) {
            const numAmount = round2(parseFloat(tender.amount) || 0);
            if (numAmount <= 0) continue;

            const methodRow = await resolvePaymentMethod(client, tender.method_id, tender.payment_method);
            if (!methodRow) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `Invalid payment method: ${tender.payment_method || tender.method_id}` });
            }

            if (methodRow.code === 'store_wallet') {
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
                    notes: notes || tender.notes || 'Store wallet drawdown for payment',
                    createdBy: employee_id,
                });
            }

            const isCheque = isChequeMethodRow(methodRow);
            const pdcStatusValue = isCheque ? 'RECEIVED' : 'CLEARED';
            const chequeDateValue = isCheque && tender.cheque_date ? tender.cheque_date : null;
            const tenderRef = tender.reference || tender.reference_number || null;

            const { rows: [{ payment_id: tenderPaymentId }] } = await client.query(
                `INSERT INTO public.customer_payment
                 (customer_id, employee_id, amount, payment_method, method_id, reference_number,
                  physical_receipt_no, notes, pdc_status, cheque_date, collection_group_id, recording_method,
                  physical_document_type_id, physical_document_series_id, physical_document_registry_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                 RETURNING payment_id`,
                [
                    customer_id, employee_id, numAmount, methodRow.code, methodRow.method_id,
                    tenderRef, groupPrn,
                    tender.notes || notes || null, pdcStatusValue, chequeDateValue, groupId,
                    effectiveRecordingMethod, receiptResult?.type_id || null,
                    receiptResult?.series_id || null, receiptResult?.registry_id || null
                ]
            );

            await cashDrawer.postSourcePayment(client, {
                kind: 'customer',
                sourceId: tenderPaymentId,
                sessionId: req.body.cash_session_id,
                actorId: employee_id,
                notebookReceiptId: tender.notebook_receipt_id,
                coveredAmount: tender.notebook_covered_amount,
                canPost: cashDrawer.userCanPost(req.user)
            });

            createdPayments.push({
                payment_id: tenderPaymentId,
                amount: numAmount,
                remaining: numAmount,
                cash_allocated: 0,
                method: methodRow.code,
                reference_number: tenderRef,
                is_cheque: isCheque,
            });
        }

        if (createdPayments.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'At least one positive payment tender is required.' });
        }

        const { withholdingByInvoice, totalWithheld } = await resolveWithholdingEntries(client, {
            customerId: customer_id,
            withholding,
        });

        // Merge cash allocations by invoice while preserving order
        const cashAllocByInvoice = new Map();
        for (const alloc of allocations) {
            const invoiceId = Number(alloc.invoice_id);
            const allocAmt = round2(parseFloat(alloc.amount_allocated) || 0);
            if (!invoiceId || allocAmt <= 0) continue;
            cashAllocByInvoice.set(invoiceId, round2((cashAllocByInvoice.get(invoiceId) || 0) + allocAmt));
        }

        const totalCashRequested = round2(Array.from(cashAllocByInvoice.values()).reduce((s, v) => s + v, 0));
        if (totalCashRequested > totalPaymentAmount + 0.005) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Total invoice allocations exceed total payment amount.' });
        }

        const touchedInvoiceIds = new Set([...cashAllocByInvoice.keys(), ...withholdingByInvoice.keys()]);
        for (const invoiceId of touchedInvoiceIds) {
            const combinedAmt = round2((cashAllocByInvoice.get(invoiceId) || 0) + (withholdingByInvoice.get(invoiceId)?.amount || 0));
            if (combinedAmt > 0) {
                await assertInvoiceAvailableBalance(client, invoiceId, combinedAmt);
            }
        }

        // Distribute cash allocations across tenders sequentially so PDC clearance/bounce
        // operates accurately on each instrument's own invoice_payment_allocation rows.
        const invoiceQueue = Array.from(cashAllocByInvoice, ([invoice_id, remaining]) => ({ invoice_id, remaining }));
        const tenderInvoiceAllocations = new Map(); // key `${payment_id}:${invoice_id}` -> { payment_id, invoice_id, amount }

        for (const tender of createdPayments) {
            let toDistribute = tender.amount;
            for (const inv of invoiceQueue) {
                if (toDistribute <= 0.005) break;
                if (inv.remaining <= 0.005) continue;
                const portion = round2(Math.min(toDistribute, inv.remaining));
                if (portion <= 0) continue;
                const key = `${tender.payment_id}:${inv.invoice_id}`;
                tenderInvoiceAllocations.set(key, {
                    payment_id: tender.payment_id,
                    invoice_id: inv.invoice_id,
                    amount: round2((tenderInvoiceAllocations.get(key)?.amount || 0) + portion),
                });
                inv.remaining = round2(inv.remaining - portion);
                toDistribute = round2(toDistribute - portion);
                tender.cash_allocated = round2(tender.cash_allocated + portion);
            }
        }

        // Attach withholding onto a cleared tender when available so a cheque bounce
        // never wipes out the BIR tax certificate credit on recompute_invoice_settlement().
        const withholdingCarrier = createdPayments.find(p => !p.is_cheque) || createdPayments[0];
        for (const [invoiceId, wh] of withholdingByInvoice) {
            const key = `${withholdingCarrier.payment_id}:${invoiceId}`;
            tenderInvoiceAllocations.set(key, {
                payment_id: withholdingCarrier.payment_id,
                invoice_id: invoiceId,
                amount: round2((tenderInvoiceAllocations.get(key)?.amount || 0) + wh.amount),
            });
        }

        for (const row of tenderInvoiceAllocations.values()) {
            await client.query(
                `INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (invoice_id, payment_id) DO UPDATE SET amount_allocated = EXCLUDED.amount_allocated`,
                [row.invoice_id, row.payment_id, row.amount]
            );
        }

        for (const invoiceId of touchedInvoiceIds) {
            await client.query('SELECT recompute_invoice_settlement($1)', [invoiceId]);
        }

        // Post AR ledger entries per cleared cash/non-cheque tender so a pending cheque
        // never receives an immediate PAYMENT_SETTLED row on its payment_id.
        for (const p of createdPayments) {
            if (!p.is_cheque && p.cash_allocated > 0) {
                await arLedger.appendEntry(client, {
                    customerId: customer_id,
                    paymentId: p.payment_id,
                    entryType: 'PAYMENT_SETTLED',
                    amount: -p.cash_allocated,
                    paymentChannel: p.method,
                    referenceNo: groupPrn || p.reference_number,
                    notes: notes || `Grouped collection receipt #${groupPrn || groupRef} (${p.method})`,
                    createdBy: employee_id,
                    paymentSource: 'customer_payment',
                });
            }
        }

        if (totalWithheld > 0) {
            await arLedger.appendEntry(client, {
                customerId: customer_id,
                paymentId: withholdingCarrier.payment_id,
                entryType: 'WITHHOLDING_TAX_CREDIT',
                amount: -totalWithheld,
                paymentChannel: 'withholding_tax',
                referenceNo: groupPrn || withholdingCarrier.reference_number,
                notes: 'Tax withheld at source, pending BIR certificate',
                createdBy: employee_id,
                paymentSource: 'customer_payment',
            });

            for (const [invoiceId, wh] of withholdingByInvoice) {
                await withholdingTax.recordWithholdingLines(client, {
                    invoiceId,
                    customerId: customer_id,
                    customerPaymentId: withholdingCarrier.payment_id,
                    components: wh.components,
                    employeeId: employee_id,
                });
            }
        }

        // Attach settlement concession to a cheque tender when present so it waits
        // in PENDING_CLEARANCE until the cheque clears, otherwise to the first tender.
        const discountCarrier = createdPayments.find(p => p.is_cheque) || createdPayments[0];
        const adjustmentDoc = await applySettlementDiscount(client, req, {
            customerId: customer_id,
            employeeId: employee_id,
            customerPaymentId: discountCarrier.payment_id,
            isCheque: discountCarrier.is_cheque,
            discountEntries,
            totalDiscount,
            discount,
        });

        const totalCashAllocated = round2(createdPayments.reduce((sum, p) => sum + p.cash_allocated, 0));
        const excessAmount = round2(totalPaymentAmount - totalCashAllocated);
        let overpaymentCredited = 0;
        if (excessAmount > 0.005) {
            await walletService.appendWalletTransaction(client, {
                customerId: customer_id,
                type: 'OVERPAYMENT_CREDIT',
                amount: excessAmount,
                referenceType: 'PAYMENT',
                referenceId: createdPayments[0].payment_id,
                notes: `Automated credit from overpayment on collection group #${groupPrn || groupRef}`,
                createdBy: employee_id,
            });
            overpaymentCredited = excessAmount;
        }

        const responsePayload = {
            message: 'Collection group payment recorded successfully.',
            group_id: groupId,
            group_reference: groupRef,
            physical_receipt_no: groupPrn,
            physical_document: receiptResult,
            total_amount: totalPaymentAmount,
            allocated_amount: round2(totalCashAllocated + totalWithheld),
            withheld_amount: totalWithheld,
            discount_amount: totalDiscount,
            adjustment_no: adjustmentDoc?.adjustment_no || null,
            adjustment_status: adjustmentDoc?.status || null,
            overpayment_credited: overpaymentCredited,
            payments: createdPayments.map(({ payment_id, amount, method, is_cheque }) => ({
                payment_id,
                amount,
                method,
                is_cheque,
            })),
        };
        await cashDrawer.finishSourceRequest(client, cashRequestId, 201, responsePayload);
        await client.query('COMMIT');
        res.status(201).json(responsePayload);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.replay) return res.status(err.replay.status).json(err.replay.body);
        console.error('POST /payments/collection-group error:', err);
        const status = err.statusCode || (err.status && err.status < 500 ? err.status : 500);
        res.status(status).json({ code: err.code || 'COLLECTION_GROUP_ERROR', message: err.message || 'Server error recording collection group.' });
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

// Legacy URL retained for Sales History. These are cash payouts inferred from
// credit notes, independent of whether the Cash Box rollout is enabled.
router.get('/payments/refunds-approx', protect, hasPermission('ar:view'), async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }
    try {
        const q = `SELECT COALESCE(SUM(
                     CASE WHEN cn.exchange_replacement_invoice_id IS NOT NULL THEN
                       GREATEST(cn.total_amount - COALESCE((
                         SELECT SUM(ip.amount_paid)
                         FROM invoice_payments ip
                         JOIN payment_methods pm ON pm.method_id=ip.method_id
                         WHERE ip.invoice_id=cn.exchange_replacement_invoice_id
                           AND pm.code='exchange_credit' AND ip.reference=cn.cn_number
                       ), replacement.total_amount, 0), 0)
                     ELSE cn.total_amount END
                   ),0) AS total_refunds
                   FROM credit_note cn
                   LEFT JOIN invoice replacement ON replacement.invoice_id=cn.exchange_replacement_invoice_id
                   WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
                     AND LOWER(TRIM(cn.refund_payment_method)) IN ('cash', 'cash payout')
                     AND (cn.exchange_replacement_invoice_id IS NULL OR COALESCE(replacement.payment_terms_days,0)=0)
                     AND NOT EXISTS (
                       SELECT 1 FROM invoice_payments account_payment
                       JOIN payment_methods account_method ON account_method.method_id=account_payment.method_id
                       WHERE account_payment.invoice_id=cn.exchange_replacement_invoice_id
                         AND (account_method.code='on_account' OR account_method.config->>'settlement_type'='on_account')
                     );`;
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
