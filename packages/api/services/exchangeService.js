'use strict';

/**
 * POS Item Exchange ("Change Item") — docs/plans/2026-09-11_pos-item-exchange-module.md
 *
 * An exchange is not a new primitive: it is a credit_note against the original
 * invoice (exactly like refundRoutes.js) plus a brand-new invoice for the
 * replacement items (exactly like invoiceRoutes.js POST /invoices), wired
 * together in one transaction and settled for only the net difference.
 *
 * The one piece that is genuinely new is how the returned value pays for the
 * replacement: an 'exchange_credit' invoice_payments row (seeded by
 * 20260911_01_pos_exchange_schema.sql) settles the new invoice the same way
 * 'store_wallet' already does for a real credit balance. It deliberately posts
 * NO ar_ledger entry of its own -- the value it carries was already recorded
 * once, as the CREDIT_MEMO_APPLIED entry the credit note posts against the
 * *original* invoice. A second entry here would double-count it (and did,
 * until 20260911_02_exchange_credit_ledger_safety_net.sql taught the
 * invoice_payments ledger safety-net trigger to skip this method code).
 * Every other tender on the replacement invoice (cash, card, GCash, cheque,
 * wallet, on-account) posts to ar_ledger exactly as invoiceRoutes.js already
 * does.
 *
 * Callers own the transaction: pass an open PoolClient with BEGIN already
 * issued, exactly as arAdjustmentService.createAdjustment() and
 * grnPostingService.postReceipt() require. This function never calls
 * BEGIN/COMMIT/ROLLBACK itself, so exchange_db_test.js can wrap a call in its
 * own transaction and roll it back, leaving no trace.
 */

const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');
const { validatePaymentTerms } = require('../helpers/paymentTermsHelper');
const { calculateInvoiceTax, storeTaxBreakdown, validateTaxCalculation, computeTaxForBase } = require('./taxCalculationService');
const arLedger = require('./arLedgerService');
const walletService = require('./customerWalletService');

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

class ExchangeError extends Error {
    constructor(message, statusCode = 400, extra = {}) {
        super(message);
        this.statusCode = statusCode;
        Object.assign(this, extra);
    }
}

/**
 * @param {import('pg').PoolClient} client — open transaction client (BEGIN already issued)
 * @param {object} payload
 * @param {number} payload.original_invoice_id
 * @param {number} payload.employee_id
 * @param {Array<{invoice_line_id:number, quantity:number, is_defective?:boolean}>} payload.returned_lines
 * @param {Array<{part_id:number, quantity:number, sale_price:number, discount_amount?:number}>} payload.replacement_lines
 * @param {number} [payload.tax_rate_id]
 * @param {string} [payload.terms]
 * @param {number} [payload.payment_terms_days]
 * @param {Array<object>} [payload.payments] — real tenders collected now
 * @param {'wallet'|'cash_payout'} [payload.downgrade_disposition]
 * @param {string} [payload.physical_receipt_no]
 * @param {string} [payload.notes]
 * @param {boolean} [payload.override_credit_limit]
 * @param {boolean} [payload.manager_override]
 * @param {string[]} [payload.requesting_permissions] — req.user?.permissions, for the credit-hold override check
 */
async function processExchange(client, payload) {
    const {
        original_invoice_id,
        employee_id,
        returned_lines,
        replacement_lines,
        tax_rate_id,
        terms,
        payment_terms_days,
        payments,
        downgrade_disposition,
        physical_receipt_no,
        notes,
        override_credit_limit = false,
        manager_override = false,
        requesting_permissions = [],
    } = payload;

    if (!original_invoice_id || !employee_id) {
        throw new ExchangeError('original_invoice_id and employee_id are required.');
    }
    if (!Array.isArray(returned_lines) || returned_lines.length === 0) {
        throw new ExchangeError('At least one returned line is required.');
    }
    if (!Array.isArray(replacement_lines) || replacement_lines.length === 0) {
        throw new ExchangeError('At least one replacement line is required.');
    }

    const { rows: [originalInvoice] } = await client.query(
        `SELECT invoice_id, invoice_number, customer_id, status, invoice_date
           FROM invoice WHERE invoice_id = $1 FOR UPDATE`,
        [original_invoice_id]
    );
    if (!originalInvoice) {
        throw new ExchangeError('Original invoice not found.', 404);
    }
    if (['Cancelled', 'Written Off'].includes(originalInvoice.status)) {
        throw new ExchangeError(`Cannot exchange items from a ${originalInvoice.status} invoice.`);
    }

    const { rows: [customerRow] } = await client.query(
        'SELECT first_name, last_name, credit_hold, credit_hold_reason FROM customer WHERE customer_id = $1',
        [originalInvoice.customer_id]
    );
    const customer_id = originalInvoice.customer_id;
    const customerName = `${customerRow.first_name || ''} ${customerRow.last_name || ''}`.trim().toLowerCase();
    const isWalkIn = customerName.includes('walk-in') || customerName.includes('walk in');

    // Warn-only per PRD §7 (Explicitly Deferred Items): a manager-override
    // hard block on exchanges older than 30 days is Phase 5. The frontend
    // renders this as a non-blocking banner.
    const invoiceAgeDays = Math.floor((Date.now() - new Date(originalInvoice.invoice_date).getTime()) / 86400000);
    const agingWarning = invoiceAgeDays > 30
        ? `Original invoice is ${invoiceAgeDays} days old (over the 30-day exchange guideline).`
        : null;

    // ── 1. Validate & price the returned lines (mirrors refundRoutes.js) ──
    let cnSubtotalExTax = 0;
    let cnTaxTotal = 0;
    const cnTaxBreakdown = new Map();
    const returnLinesWithTax = [];

    for (const line of returned_lines) {
        const { invoice_line_id, quantity, is_defective = false } = line;
        if (!invoice_line_id || !(Number(quantity) > 0)) {
            throw new ExchangeError('Each returned line needs invoice_line_id and a positive quantity.');
        }

        const { rows: [lineData] } = await client.query(`
            SELECT
                il.invoice_line_id, il.part_id, il.quantity AS original_quantity,
                il.sale_price, il.discount_amount, il.cost_at_sale,
                il.tax_rate_id, il.tax_rate_snapshot, il.is_tax_inclusive,
                COALESCE(rf.refunded_quantity, 0) AS refunded_quantity
            FROM invoice_line il
            LEFT JOIN (
                SELECT cnl.invoice_line_id, SUM(cnl.quantity) AS refunded_quantity
                FROM credit_note_line cnl GROUP BY cnl.invoice_line_id
            ) rf ON rf.invoice_line_id = il.invoice_line_id
            WHERE il.invoice_id = $1 AND il.invoice_line_id = $2
        `, [original_invoice_id, invoice_line_id]);

        if (!lineData) {
            throw new ExchangeError(`Invoice line not found: ${invoice_line_id}.`);
        }

        const availableToReturn = Number(lineData.original_quantity) - Number(lineData.refunded_quantity || 0);
        if (Number(quantity) > availableToReturn) {
            throw new ExchangeError(
                `Exchange failed for part_id ${lineData.part_id}: requested ${quantity}, available ${availableToReturn}.`
            );
        }

        // Tax reversed at the rate frozen on the original sale line, never the
        // current live rate (same reasoning as refundRoutes.js).
        const taxRateSnapshot = Number(lineData.tax_rate_snapshot) || 0;
        const isTaxInclusive = lineData.is_tax_inclusive || false;
        const taxRateId = lineData.tax_rate_id;
        const salePrice = Number(lineData.sale_price);

        // Prorated net-paid credit, never the gross catalog price (PRD Decision #3).
        const originalQuantity = Number(lineData.original_quantity);
        const originalDiscount = Number(lineData.discount_amount || 0);
        const unitDiscount = originalQuantity > 0 ? originalDiscount / originalQuantity : 0;
        const lineTotal = (Number(quantity) * salePrice) - (unitDiscount * Number(quantity));

        const { tax_base: taxBase, tax_amount: taxAmount } = computeTaxForBase(lineTotal, taxRateSnapshot, isTaxInclusive);

        cnSubtotalExTax += taxBase;
        cnTaxTotal += taxAmount;

        returnLinesWithTax.push({
            invoice_line_id, part_id: lineData.part_id, quantity: Number(quantity),
            sale_price: salePrice, cost_at_sale: Number(lineData.cost_at_sale || 0),
            tax_rate_id: taxRateId, tax_rate_snapshot: taxRateSnapshot,
            tax_base: taxBase, tax_amount: taxAmount, is_tax_inclusive: isTaxInclusive,
            is_defective: !!is_defective,
        });

        const key = taxRateId || 'default';
        const existing = cnTaxBreakdown.get(key) || {
            tax_rate_id: taxRateId, rate_percentage: taxRateSnapshot,
            tax_base: 0, tax_amount: 0, line_count: 0,
        };
        existing.tax_base += taxBase;
        existing.tax_amount += taxAmount;
        existing.line_count += 1;
        cnTaxBreakdown.set(key, existing);
    }

    cnSubtotalExTax = round2(cnSubtotalExTax);
    cnTaxTotal = round2(cnTaxTotal);
    const returnCredit = round2(cnSubtotalExTax + cnTaxTotal);

    // ── 2. Price the replacement lines (mirrors invoiceRoutes.js POST /invoices) ──
    const partIds = replacement_lines.map(l => l.part_id);
    const { rows: parts } = await client.query(
        'SELECT part_id, tax_rate_id, is_tax_inclusive_price, is_service, wac_cost FROM part WHERE part_id = ANY($1)',
        [partIds]
    );
    if (parts.length !== new Set(partIds).size) {
        throw new ExchangeError('One or more replacement part_id values were not found.');
    }
    for (const line of replacement_lines) {
        const lineSubtotal = Number(line.quantity) * Number(line.sale_price);
        const discount = Number(line.discount_amount || 0);
        if (discount > lineSubtotal + 0.01) {
            throw new ExchangeError(
                `Discount for part_id ${line.part_id} (${discount.toFixed(2)}) exceeds the line subtotal (${lineSubtotal.toFixed(2)}).`
            );
        }
    }

    const taxCalculation = await calculateInvoiceTax(replacement_lines, parts, tax_rate_id);
    if (!validateTaxCalculation(taxCalculation)) {
        throw new Error('Tax calculation validation failed for replacement lines.');
    }
    const { subtotal_ex_tax, tax_total, total_amount: replacementTotal } = taxCalculation;

    // ── 3. Net settlement (PRD §3 Decisions, §4 Scenarios Matrix) ────────
    const netDiff = round2(replacementTotal - returnCredit); // >0 upgrade, <0 downgrade, 0 even
    const amountDue = Math.max(netDiff, 0);
    const exchangeCreditTenderAmount = Math.min(returnCredit, replacementTotal);
    const leftoverCredit = round2(returnCredit - exchangeCreditTenderAmount); // >0 only on downgrade

    // ── 4. Payment terms / credit-sale determination (mirrors invoiceRoutes.js) ──
    const termsValidation = validatePaymentTerms({ terms, payment_terms_days, invoice_date: new Date() });
    if (!termsValidation.isValid) {
        throw new ExchangeError('Invalid payment terms', 400, { errors: termsValidation.errors });
    }
    const canonicalDays = termsValidation.canonicalDays;
    const dueDate = termsValidation.dueDate;
    const normalizedTerms = termsValidation.normalizedTerms;

    let hasOnAccountPayment = false;
    if (Array.isArray(payments) && payments.length > 0) {
        const pmIds = payments.map(p => (typeof p.method_id === 'string' && /^\d+$/.test(p.method_id)) ? parseInt(p.method_id, 10) : p.method_id);
        const { rows: pmRowsForDetection } = await client.query(
            'SELECT method_id, code, type, config FROM payment_methods WHERE method_id = ANY($1) AND enabled = true',
            [pmIds]
        );
        for (const pm of pmRowsForDetection) {
            const pmConfig = typeof pm.config === 'string' ? JSON.parse(pm.config) : pm.config;
            const settlementType = pm.code === 'store_wallet' ? 'instant' : (pmConfig?.settlement_type || (pm.type === 'cash' ? 'instant' : 'delayed'));
            if (settlementType === 'on_account' || pm.code === 'on_account') {
                hasOnAccountPayment = true;
                break;
            }
        }
    }
    const isCreditSale = canonicalDays > 0 || hasOnAccountPayment;

    if (isWalkIn && isCreditSale) {
        throw new ExchangeError('Payment terms or On Account payment are not allowed for Walk-In customers.');
    }
    if (isCreditSale && customerRow.credit_hold) {
        const hasManagerPermission = requesting_permissions.includes('ar:override_credit_limit');
        if (!override_credit_limit && !manager_override && !hasManagerPermission) {
            throw new ExchangeError(
                `Exchange blocked: Customer is on credit hold (${customerRow.credit_hold_reason || 'Credit Hold'}). Manager override required.`,
                403, { credit_hold: true, reason: customerRow.credit_hold_reason }
            );
        }
    }

    // Strict cash-drawer isolation for on-account exchanges (PRD Decision #2):
    // a downgrade on a credit sale always absorbs into A/R via the ledger
    // arithmetic in step 7 below, never a wallet credit or a cash payout.
    if (leftoverCredit > 0 && !isCreditSale && !['wallet', 'cash_payout'].includes(downgrade_disposition)) {
        throw new ExchangeError(
            `This exchange owes the customer ₱${leftoverCredit.toFixed(2)}. Specify downgrade_disposition: 'wallet' or 'cash_payout'.`
        );
    }
    if (amountDue > 0 && !isCreditSale) {
        const totalTendered = round2((payments || []).reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0));
        if (totalTendered !== amountDue) {
            throw new ExchangeError(
                `This exchange requires ₱${amountDue.toFixed(2)} to be tendered now; received ₱${totalTendered.toFixed(2)}.`
            );
        }
    }

    // ── 5. Credit note for the returned items ─────────────────────────────
    const creditNoteNumber = await getNextDocumentNumber(client, 'CN');
    const refundPaymentMethodLabel = leftoverCredit > 0
        ? (downgrade_disposition === 'wallet' ? 'Store Credit' : downgrade_disposition === 'cash_payout' ? 'Cash Payout' : 'Applied to Account')
        : 'Exchange';

    const cnResult = await client.query(`
        INSERT INTO credit_note (cn_number, invoice_id, employee_id, total_amount, subtotal_ex_tax, tax_total, tax_calculation_version, refund_payment_method, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING cn_id;
    `, [
        creditNoteNumber, original_invoice_id, employee_id, returnCredit, cnSubtotalExTax, cnTaxTotal,
        'v1.0', refundPaymentMethodLabel, notes || `Item exchange against Invoice #${originalInvoice.invoice_number}`,
    ]);
    const newCnId = cnResult.rows[0].cn_id;

    await arLedger.appendEntry(client, {
        customerId: customer_id, invoiceId: original_invoice_id, cnId: newCnId,
        entryType: 'CREDIT_MEMO_APPLIED', amount: -returnCredit,
        referenceNo: creditNoteNumber,
        notes: `Credit note ${creditNoteNumber} for item exchange against Invoice #${originalInvoice.invoice_number}`,
        createdBy: employee_id,
    });

    const rateIds = Array.from(cnTaxBreakdown.keys()).filter(id => id !== 'default');
    if (rateIds.length > 0) {
        const { rows: rateNames } = await client.query('SELECT tax_rate_id, rate_name FROM tax_rate WHERE tax_rate_id = ANY($1)', [rateIds]);
        const rateNamesMap = new Map(rateNames.map(r => [r.tax_rate_id, r.rate_name]));
        cnTaxBreakdown.forEach((breakdown, key) => {
            breakdown.rate_name = key !== 'default' ? (rateNamesMap.get(breakdown.tax_rate_id) || 'Unknown') : 'Default Rate';
        });
    }
    for (const breakdown of cnTaxBreakdown.values()) {
        await client.query(`
            INSERT INTO credit_note_tax_breakdown (cn_id, tax_rate_id, rate_name, rate_percentage, tax_base, tax_amount, line_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            newCnId, breakdown.tax_rate_id, breakdown.rate_name, breakdown.rate_percentage,
            round2(breakdown.tax_base), breakdown.tax_amount, breakdown.line_count
        ]);
    }

    for (const line of returnLinesWithTax) {
        await client.query(`
            INSERT INTO credit_note_line (cn_id, part_id, quantity, sale_price, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive, invoice_line_id, is_defective)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [newCnId, line.part_id, line.quantity, line.sale_price, line.tax_rate_id, line.tax_rate_snapshot, line.tax_base, line.tax_amount, line.is_tax_inclusive, line.invoice_line_id, line.is_defective]);

        // Re-sellable goes back to active stock; Defective/Damaged is quarantined
        // (PRD Decision #4). Same free-text trans_type column refundRoutes.js uses.
        await client.query(`
            INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7);
        `, [
            line.part_id, line.is_defective ? 'Defective Return' : 'Refund', line.quantity, line.cost_at_sale,
            creditNoteNumber, employee_id, `Item exchange return for Invoice #${originalInvoice.invoice_number}`
        ]);
    }

    // ── 6. Replacement invoice (mirrors invoiceRoutes.js POST /invoices) ──
    const invoice_number = await getNextDocumentNumber(client, 'INV');

    let prn = formatPhysicalReceiptNumber(physical_receipt_no);
    if (prn) {
        let attempts = 0;
        let basePrn = prn;
        let isUnique = false;
        while (!isUnique && attempts < 10) {
            const { rows: checkRows } = await client.query(`SELECT public.is_physical_receipt_no_taken($1) AS is_taken`, [prn]);
            if (!checkRows[0]?.is_taken) {
                isUnique = true;
            } else {
                attempts++;
                const match = basePrn.match(/^(.+?)(\d+)$/);
                prn = match ? `${match[1]}${parseInt(match[2]) + attempts}` : `${basePrn}-${attempts}`;
            }
        }
        if (!isUnique) throw new Error('Unable to generate unique physical receipt number after multiple attempts');
    }

    // Booked today, always -- PRD Decision #1. status/amount_paid seeded here
    // are provisional; recompute_invoice_settlement corrects them in step 8
    // once every tender exists, exactly like invoiceRoutes.js does.
    const invoiceResult = await client.query(`
        INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, terms, payment_terms_days, due_date, physical_receipt_no, tax_calculation_version, exchange_original_invoice_id, submitted_at, approved_at, approved_by)
        VALUES ($1, $2, $3, $4, $5, $6, 0, 'Unpaid', $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3)
        RETURNING invoice_id;
    `, [invoice_number, customer_id, employee_id, replacementTotal, subtotal_ex_tax, tax_total, normalizedTerms, canonicalDays, dueDate, prn, taxCalculation.tax_calculation_version, original_invoice_id]);
    const newInvoiceId = invoiceResult.rows[0].invoice_id;

    await client.query('UPDATE credit_note SET exchange_replacement_invoice_id = $1 WHERE cn_id = $2', [newInvoiceId, newCnId]);

    if (isCreditSale) {
        await arLedger.appendEntry(client, {
            customerId: customer_id, invoiceId: newInvoiceId,
            entryType: 'INVOICE_POSTED', amount: replacementTotal,
            referenceNo: invoice_number,
            notes: `Invoice ${invoice_number} posted (exchange replacement for Invoice #${originalInvoice.invoice_number})`,
            createdBy: employee_id,
        });
    }

    await storeTaxBreakdown(newInvoiceId, taxCalculation.tax_breakdown, client);

    const partsById = new Map(parts.map(p => [p.part_id, p]));
    for (const line of taxCalculation.lines) {
        const { part_id, quantity, sale_price, discount_amount, tax_rate_id: lineTaxRateId, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive } = line;
        const cost_at_sale = partsById.get(part_id)?.wac_cost || 0;

        await client.query(`
            INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
        `, [newInvoiceId, part_id, quantity, sale_price, cost_at_sale, discount_amount || 0, lineTaxRateId, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive]);

        await client.query(`
            INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
            VALUES ($1, 'StockOut', $2, $3, $4, $5, $6);
        `, [part_id, -quantity, cost_at_sale, invoice_number, employee_id, `Exchange replacement for Invoice #${originalInvoice.invoice_number}`]);
    }

    // ── 7. Settle the replacement invoice ────────────────────────────────
    // 7a. The traded-in value, applied silently (no ar_ledger entry of its
    // own — see file header).
    if (exchangeCreditTenderAmount > 0) {
        const { rows: [ecMethod] } = await client.query(`SELECT method_id FROM payment_methods WHERE code = 'exchange_credit'`);
        await client.query(`
            INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, reference, created_by, payment_status, settled_at)
            VALUES ($1, $2, $3, $4, $5, 'settled', CURRENT_TIMESTAMP)
        `, [newInvoiceId, ecMethod.method_id, exchangeCreditTenderAmount, creditNoteNumber, employee_id]);
    }

    // 7b. Real tenders collected now, whether covering the whole of an upgrade
    // (cash/walk-in) or a voluntary counter payment on a credit sale.
    if (Array.isArray(payments) && payments.length > 0) {
        const totalPayments = round2(payments.reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0));
        if (totalPayments > amountDue + 0.01) {
            throw new ExchangeError(`Tendered ₱${totalPayments.toFixed(2)} exceeds the ₱${amountDue.toFixed(2)} due on this exchange.`);
        }

        for (const payment of payments) {
            const { method_id, amount_paid: pAmountPaidRaw, tendered_amount: pTenderedRaw, reference, cheque_date, metadata = {} } = payment;
            const lookupParam = (typeof method_id === 'string' && /^\d+$/.test(method_id)) ? parseInt(method_id, 10) : method_id;
            const { rows: methodRows } = await client.query('SELECT * FROM payment_methods WHERE method_id = $1 AND enabled = true', [lookupParam]);
            if (methodRows.length === 0) {
                throw new ExchangeError(`Invalid payment method: ${method_id}`);
            }
            const method = methodRows[0];
            const methodConfig = typeof method.config === 'string' ? JSON.parse(method.config) : method.config;

            if (methodConfig.requires_reference && (!reference || reference.trim() === '')) {
                throw new ExchangeError(`Reference is required for ${method.name}`);
            }
            if (methodConfig.requires_receipt_no && !prn) {
                throw new ExchangeError(`Physical receipt number is required for ${method.name}`);
            }

            const pAmt = parseFloat(pAmountPaidRaw);
            const tAmt = pTenderedRaw ? parseFloat(pTenderedRaw) : null;
            const changeAmt = tAmt && tAmt > pAmt ? tAmt - pAmt : 0;
            if (changeAmt > 0 && !methodConfig.change_allowed) {
                throw new ExchangeError(`Change is not allowed for ${method.name}`);
            }

            if (method.code === 'store_wallet') {
                const wallet = await walletService.getWallet(customer_id, client);
                if (!wallet || wallet.balance < pAmt) {
                    throw new ExchangeError(`Insufficient Store Wallet balance. Available: ₱${wallet ? wallet.balance.toFixed(2) : '0.00'}, Required: ₱${pAmt.toFixed(2)}`);
                }
                await walletService.appendWalletTransaction(client, {
                    customerId: customer_id, type: 'INVOICE_PAYMENT_DRAWDOWN', amount: -pAmt,
                    referenceType: 'INVOICE', referenceId: newInvoiceId,
                    notes: `Store wallet payment for invoice #${invoice_number} (exchange)`,
                    createdBy: employee_id,
                });
            }

            const settlementType = method.code === 'store_wallet' ? 'instant' : (methodConfig.settlement_type || (method.type === 'cash' ? 'instant' : 'delayed'));
            if (settlementType === 'on_account' && method.code !== 'store_wallet' && isWalkIn) {
                throw new ExchangeError('On Account payment is not available for Walk-In customers.');
            }
            const paymentStatus = settlementType === 'instant' ? 'settled' : settlementType === 'on_account' ? 'on_account' : 'pending';

            const isChequeMethod = method.code === 'cheque' || method.code === 'pdc' || method.type === 'cheque' || (method.name || '').toLowerCase().includes('cheque');
            const pdcStatusValue = isChequeMethod && paymentStatus === 'pending' ? 'RECEIVED' : 'CLEARED';
            const chequeDateValue = isChequeMethod && cheque_date ? cheque_date : null;
            const paymentMetadata = chequeDateValue ? { ...metadata, cheque_date: chequeDateValue } : metadata;

            const ipRes = await client.query(`
                INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, metadata, created_by, payment_status, settled_at, pdc_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::varchar, CASE WHEN $9::varchar = 'settled' THEN CURRENT_TIMESTAMP ELSE NULL END, $10)
                RETURNING payment_id
            `, [newInvoiceId, method.method_id, pAmt, tAmt, changeAmt, reference, JSON.stringify(paymentMetadata), employee_id, paymentStatus, pdcStatusValue]);

            if (paymentStatus === 'settled') {
                await arLedger.appendEntry(client, {
                    customerId: customer_id, invoiceId: newInvoiceId, paymentId: ipRes.rows[0].payment_id,
                    entryType: 'PAYMENT_SETTLED', amount: -pAmt,
                    paymentChannel: method.code, referenceNo: reference || invoice_number,
                    notes: `Payment via ${method.name} (exchange)`,
                    createdBy: employee_id, paymentSource: 'invoice_payments',
                });
            }
        }
    }

    // 7c. Downgrade disposition when the store owes the customer (non-credit
    // sales only — see the guard in step 4).
    if (leftoverCredit > 0 && !isCreditSale && downgrade_disposition === 'wallet') {
        await walletService.appendWalletTransaction(client, {
            customerId: customer_id, type: 'STORE_CREDIT_REFUND', amount: leftoverCredit,
            referenceType: 'CREDIT_NOTE', referenceId: newCnId,
            notes: `Store credit issued for exchange downgrade, CN ${creditNoteNumber}`,
            createdBy: employee_id,
        });
    }
    // 'cash_payout' needs no further DB write: the credit_note.refund_payment_method
    // label above records it, and the cashier dispenses the cash physically —
    // exactly how refundRoutes.js already treats a Cash refund.

    await client.query('SELECT recompute_invoice_settlement($1)', [newInvoiceId]);
    await client.query('SELECT recompute_invoice_settlement($1)', [original_invoice_id]);

    return {
        message: 'Exchange processed successfully',
        credit_note: { cn_id: newCnId, cn_number: creditNoteNumber, total_amount: returnCredit },
        invoice: {
            invoice_id: newInvoiceId, invoice_number, physical_receipt_no: prn,
            subtotal_ex_tax, tax_total, total_amount: replacementTotal,
            due_date: dueDate, payment_terms_days: canonicalDays,
        },
        net_differential: netDiff,
        amount_due: amountDue,
        leftover_credit: leftoverCredit,
        is_credit_sale: isCreditSale,
        aging_warning: agingWarning,
    };
}

module.exports = { processExchange, ExchangeError };
