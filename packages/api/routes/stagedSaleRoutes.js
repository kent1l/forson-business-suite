const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');
const { validatePaymentTerms } = require('../helpers/paymentTermsHelper');
const { calculateInvoiceTax, storeTaxBreakdown, validateTaxCalculation } = require('../services/taxCalculationService');
const arLedger = require('../services/arLedgerService');
const { validateCapturedAt } = require('../services/offlineCaptureService');

const router = express.Router();

// POST /sales/staging - Stage a transaction from Mobile POS
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stages a sale for cashier approval.
 *
 * The staging employee comes from the token, never the body: this is the record
 * of who rang the sale up, and it feeds the per-employee activity and revenue
 * figures, so it must not be settable by the caller.
 *
 * An optional `client_ref` makes the write idempotent. Two genuine cash sales
 * for the same amount seconds apart are indistinguishable, so the server cannot
 * dedupe on its own -- but a client that queues and retries can say "this is the
 * same sale I sent before", and a retry whose original succeeded then resolves
 * to that sale instead of staging a duplicate for the cashier to catch.
 */
router.post('/sales/staging', protect, hasPermission('pos:use'), async (req, res) => {
    const { customer_id, lines, tax_rate_id, payment_method_id, tendered_amount, physical_receipt_no, client_ref, captured_at } = req.body;
    const employee_id = req.user.employee_id;

    if (!customer_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required staging fields.' });
    }
    if (client_ref && !UUID_RE.test(client_ref)) {
        return res.status(400).json({ message: 'client_ref must be a UUID' });
    }

    // Checked before opening a transaction: a sale too stale to accept should
    // cost nothing. Rejecting does not lose it -- the phone's queue parks a 400
    // as needs-attention, so it stays visible until someone deals with it.
    const capture = await validateCapturedAt(captured_at, {
        tooOldCode: 'SALE_TOO_OLD',
        tooOldMessage: (hours, limitHours) =>
            `That sale was rung up ${Math.round(hours)} hours ago, beyond the `
            + `${Math.round(limitHours)}-hour limit for offline sales. `
            + 'Ask a supervisor to enter it at the terminal.',
    });
    if (!capture.ok) return res.status(capture.status).json(capture.body);

    const source = capture.isOffline
        ? 'Mobile-Offline'
        : (req.body.source === 'Mobile' ? 'Mobile' : 'Web');

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // A retry of a sale that already landed resolves to the original rather
        // than creating a second one.
        if (client_ref) {
            const { rows: existing } = await client.query(
                'SELECT staged_sale_id FROM staged_sale WHERE client_ref = $1', [client_ref]
            );
            if (existing.length > 0) {
                await client.query('ROLLBACK');
                return res.status(200).json({
                    message: 'Transaction was already staged.',
                    staged_sale_id: existing[0].staged_sale_id,
                    staged_number: `STG-${existing[0].staged_sale_id}`,
                    duplicate: true,
                });
            }
        }

        let subtotal = 0;
        for (const line of lines) {
            subtotal += (parseFloat(line.sale_price) * parseFloat(line.quantity)) - (parseFloat(line.discount_amount) || 0);
        }

        // staged_date stays CURRENT_TIMESTAMP -- it means "when the server learned
        // of this sale", which is a different and independently useful fact from
        // captured_at ("when the customer paid"). Collapsing the two would hide
        // how long a sale sat queued.
        const insertQuery = `
            INSERT INTO staged_sale (customer_id, employee_id, total_amount, tax_rate_id, physical_receipt_no, payment_method_id, tendered_amount, status, staged_date, client_ref, captured_at, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', CURRENT_TIMESTAMP, $8, $9, $10)
            RETURNING staged_sale_id;
        `;
        const result = await client.query(insertQuery, [
            customer_id,
            employee_id,
            subtotal,
            tax_rate_id || null,
            physical_receipt_no || null,
            payment_method_id,
            tendered_amount || null,
            client_ref || null,
            capture.capturedAt,
            source
        ]);

        const stagedSaleId = result.rows[0].staged_sale_id;

        for (const line of lines) {
            await client.query(`
                INSERT INTO staged_sale_line (staged_sale_id, part_id, quantity, sale_price, discount_amount)
                VALUES ($1, $2, $3, $4, $5);
            `, [stagedSaleId, line.part_id, line.quantity, line.sale_price, line.discount_amount || 0]);
        }

        await client.query('COMMIT');
        res.status(201).json({
            message: 'Transaction successfully staged.',
            staged_sale_id: stagedSaleId,
            staged_number: `STG-${stagedSaleId}`
        });
    } catch (err) {
        await client.query('ROLLBACK');

        // Two flushes of the same queued sale can both pass the lookup above
        // and race to insert. The unique index is what actually enforces this,
        // so a violation here means the other attempt won -- which is a success,
        // not an error.
        if (err.code === '23505' && client_ref) {
            try {
                const { rows } = await db.query(
                    'SELECT staged_sale_id FROM staged_sale WHERE client_ref = $1', [client_ref]
                );
                if (rows.length > 0) {
                    return res.status(200).json({
                        message: 'Transaction was already staged.',
                        staged_sale_id: rows[0].staged_sale_id,
                        staged_number: `STG-${rows[0].staged_sale_id}`,
                        duplicate: true,
                    });
                }
            } catch { /* fall through to the generic error below */ }
        }

        console.error('Error staging sale:', err.message);
        res.status(500).json({ message: 'Error writing transaction staging record.' });
    } finally {
        client.release();
    }
});

// GET /sales/staging - Query staged transactions by status
router.get('/sales/staging', protect, hasPermission('pos:use'), async (req, res) => {
    const { status = 'PENDING' } = req.query;

    try {
        const query = `
            SELECT 
                ss.staged_sale_id as id,
                ss.staged_date as timestamp,
                ss.captured_at,
                ss.source,
                ss.total_amount,
                ('₱' || TO_CHAR(ss.total_amount, 'FM999,999,999.00')) as total_formatted,
                ss.status,
                ss.physical_receipt_no,
                (c.first_name || ' ' || COALESCE(c.last_name, '')) as customer_name,
                (e.first_name || ' ' || e.last_name) as cashier_name,
                pm.name as payment_method_name,
                (
                    SELECT STRING_AGG(pv.display_name, ' | ') 
                    FROM staged_sale_line ssl
                    JOIN parts_view pv ON ssl.part_id = pv.part_id
                    WHERE ssl.staged_sale_id = ss.staged_sale_id
                ) as items_summary
            FROM staged_sale ss
            JOIN customer c ON ss.customer_id = c.customer_id
            JOIN employee e ON ss.employee_id = e.employee_id
            JOIN payment_methods pm ON ss.payment_method_id = pm.method_id
            WHERE ss.status = $1
            -- Ordered by when each sale was rung up, not when it arrived, so a
            -- sale that sat queued through an outage still takes its place in
            -- the order customers actually stood in.
            ORDER BY COALESCE(ss.captured_at, ss.staged_date) ASC;
        `;
        const { rows } = await db.query(query, [status]);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching staged sales queue:', err.message);
        res.status(500).json({ message: 'Server error retrieving queue.' });
    }
});

// GET /sales/staging/my-activity - Per-employee sales stats and recent items (for mobile "My Activity" screen)
router.get('/sales/staging/my-activity', protect, hasPermission('pos:use'), async (req, res) => {
    const employeeId = req.user.employee_id;

    try {
        const statsQuery = `
            SELECT
                COUNT(*) FILTER (WHERE status = 'PENDING') AS total_pending,
                COUNT(*) FILTER (WHERE status = 'APPROVED') AS total_approved,
                COUNT(*) FILTER (WHERE status = 'REJECTED') AS total_rejected,
                COALESCE(SUM(total_amount) FILTER (WHERE status = 'APPROVED'), 0) AS total_revenue,
                COALESCE(SUM(total_amount) FILTER (WHERE status = 'APPROVED' AND staged_date >= CURRENT_TIMESTAMP - INTERVAL '30 days'), 0) AS total_revenue_30d
            FROM staged_sale
            WHERE employee_id = $1;
        `;
        const { rows: statsRows } = await db.query(statsQuery, [employeeId]);

        const itemsQuery = `
            SELECT
                ss.staged_sale_id AS id,
                ss.staged_date,
                ss.total_amount,
                ('₱' || TO_CHAR(ss.total_amount, 'FM999,999,999.00')) AS total_formatted,
                ss.status,
                ss.physical_receipt_no,
                (c.first_name || ' ' || COALESCE(c.last_name, '')) AS customer_name
            FROM staged_sale ss
            JOIN customer c ON ss.customer_id = c.customer_id
            WHERE ss.employee_id = $1
            ORDER BY ss.staged_date DESC
            LIMIT 50;
        `;
        const { rows: items } = await db.query(itemsQuery, [employeeId]);

        res.json({
            stats: statsRows[0],
            items,
        });
    } catch (err) {
        console.error('Error fetching my sales activity:', err.message);
        res.status(500).json({ message: 'Server error retrieving sales activity.' });
    }
});

// GET /sales/staging/:id - Inspect a single staged transaction
router.get('/sales/staging/:id', protect, hasPermission('pos:use'), async (req, res) => {
    const { id } = req.params;

    try {
        const detailQuery = `
            SELECT 
                ss.staged_sale_id as id,
                ss.staged_date as timestamp,
                ss.captured_at,
                ss.source,
                ss.total_amount,
                ('₱' || TO_CHAR(ss.total_amount, 'FM999,999,999.00')) as total_formatted,
                ss.status,
                ss.physical_receipt_no,
                ss.tendered_amount,
                ss.payment_method_id,
                ss.tax_rate_id,
                (c.first_name || ' ' || COALESCE(c.last_name, '')) as customer_name,
                ss.customer_id,
                (e.first_name || ' ' || e.last_name) as cashier_name,
                pm.name as payment_method_name,
                (rev.first_name || ' ' || rev.last_name) as reviewer,
                ss.rejection_reason
            FROM staged_sale ss
            JOIN customer c ON ss.customer_id = c.customer_id
            JOIN employee e ON ss.employee_id = e.employee_id
            JOIN payment_methods pm ON ss.payment_method_id = pm.method_id
            LEFT JOIN employee rev ON COALESCE(ss.approved_by, ss.rejected_by) = rev.employee_id
            WHERE ss.staged_sale_id = $1;
        `;
        const { rows: details } = await db.query(detailQuery, [id]);

        if (details.length === 0) {
            return res.status(404).json({ message: 'Staged sale not found.' });
        }

        const linesQuery = `
            SELECT 
                ssl.part_id,
                ssl.quantity as qty,
                ssl.sale_price,
                ssl.discount_amount,
                ('₱' || TO_CHAR(ssl.sale_price, 'FM999,999,999.00')) as price_formatted,
                ('₱' || TO_CHAR(ssl.quantity * ssl.sale_price, 'FM999,999,999.00')) as total_formatted,
                p.internal_sku as sku,
                (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS name,
                -- Current stock, so the approval desk can see when a sale
                -- staged offline is asking for more than is left. Only on the
                -- detail view: on the polled list this would be an aggregate
                -- per line per row per refresh.
                COALESCE((
                    SELECT SUM(it.quantity) FROM inventory_transaction it
                    WHERE it.part_id = ssl.part_id
                ), 0) AS stock_on_hand
            FROM staged_sale_line ssl
            JOIN part p ON ssl.part_id = p.part_id
            WHERE ssl.staged_sale_id = $1;
        `;
        const { rows: lines } = await db.query(linesQuery, [id]);

        const stagedDetail = details[0];
        const taxRateQuery = await db.query('SELECT rate_percentage, rate_name FROM tax_rate WHERE tax_rate_id = $1', [stagedDetail.tax_rate_id || 1]);
        const rate = taxRateQuery.rows[0] ? parseFloat(taxRateQuery.rows[0].rate_percentage) : 0.12;
        const rateName = taxRateQuery.rows[0] ? taxRateQuery.rows[0].rate_name : 'VAT-Inclusive';

        const subtotalVal = parseFloat(stagedDetail.total_amount) / (1 + rate);
        const taxVal = parseFloat(stagedDetail.total_amount) - subtotalVal;

        res.json({
            ...stagedDetail,
            subtotal_formatted: '₱' + subtotalVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            tax_amount_formatted: '₱' + taxVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            tax_rate_name: rateName,
            items: lines
        });
    } catch (err) {
        console.error('Error fetching staged detail:', err.message);
        res.status(500).json({ message: 'Server error retrieving transaction detail.' });
    }
});

// POST /sales/staging/:id/approve-post - Approve staged sale (accepts updated physical_receipt_no and tendered_amount)
router.post('/sales/staging/:id/approve-post', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { id } = req.params;
    const { physical_receipt_no, tendered_amount, customer_id } = req.body; // accept optional edits from approval modal
    const reviewerId = req.user.employee_id;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Fetch staged sale
        const stagedRes = await client.query('SELECT * FROM staged_sale WHERE staged_sale_id = $1 FOR UPDATE', [id]);
        if (stagedRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Staged sale not found.' });
        }

        const staged = stagedRes.rows[0];
        if (staged.status !== 'PENDING') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Transaction has already been processed: ${staged.status}` });
        }

        const linesRes = await client.query('SELECT * FROM staged_sale_line WHERE staged_sale_id = $1', [id]);
        const lines = linesRes.rows;

        // Perform invoicing & tax calculations
        const invoice_number = await getNextDocumentNumber(client, 'INV');

        const partIds = lines.map(l => l.part_id);
        const { rows: parts } = await client.query(
            'SELECT part_id, tax_rate_id, is_tax_inclusive_price FROM part WHERE part_id = ANY($1)',
            [partIds]
        );

        const taxCalculation = await calculateInvoiceTax(lines, parts, staged.tax_rate_id);
        if (!validateTaxCalculation(taxCalculation)) {
            throw new Error('Tax calculation validation failed');
        }
        const { subtotal_ex_tax, tax_total, total_amount } = taxCalculation;

        const finalCustomerId = customer_id !== undefined ? customer_id : staged.customer_id;

        // Fetch customer details and payment method for validation
        const custRes = await client.query('SELECT first_name, last_name, credit_hold, credit_hold_reason FROM customer WHERE customer_id = $1', [finalCustomerId]);
        const custRow = custRes.rows[0] || {};
        const custName = `${custRow.first_name || ''} ${custRow.last_name || ''}`.trim().toLowerCase();
        const isWalkIn = custName.includes('walk-in') || custName.includes('walk in');

        const methodQuery = await client.query('SELECT * FROM payment_methods WHERE method_id = $1', [staged.payment_method_id]);
        const method = methodQuery.rows[0];
        const methodConfig = method ? (typeof method.config === 'string' ? JSON.parse(method.config) : method.config) : {};
        const settlementType = methodConfig?.settlement_type || (method?.type === 'cash' ? 'instant' : 'delayed');
        const isCreditSale = settlementType === 'on_account' || method?.code === 'on_account';

        if (isCreditSale && isWalkIn) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'On Account payment is not available for Walk-In customers.' });
        }

        if (isCreditSale && custRow.credit_hold) {
            const hasOverrideParam = req.body.override_credit_limit === true || req.body.manager_override === true;
            const hasManagerPermission = req.user?.permissions?.includes('ar:override_credit_limit');
            if (!hasOverrideParam && !hasManagerPermission) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    message: `Credit sale blocked: Customer is on credit hold (${custRow.credit_hold_reason || 'Credit Hold'}). Manager override required.`,
                    credit_hold: true,
                    reason: custRow.credit_hold_reason
                });
            }
        }

        const amountPaid = isCreditSale ? 0 : (parseFloat(total_amount) || 0);
        const invoiceStatus = isCreditSale ? 'Unpaid' : 'Paid';

        // Verify and process physical receipt number (prefer user input from approval modal)
        const prnSource = physical_receipt_no !== undefined ? physical_receipt_no : staged.physical_receipt_no;
        let prn = formatPhysicalReceiptNumber(prnSource);
        if (prn) {
            const existing = await client.query(
                `SELECT invoice_id FROM invoice WHERE LOWER(physical_receipt_no) = LOWER($1) AND physical_receipt_no IS NOT NULL`,
                [prn]
            );
            if (existing.rows.length > 0) {
                prn = `${prn}-STG-${id}`;
            }
        }

        /*
         * The invoice is dated when the sale actually happened, not when it was
         * approved. For a sale rung up on a phone during a blackout those differ
         * by however long the server was down, and dating it to the approval
         * would put a Monday sale in Tuesday's books.
         *
         * Two consequences worth knowing:
         *
         * 1. This applies to web-staged sales too, not just mobile ones. Any
         *    staged sale approved on a later day than it was rung up now lands in
         *    the earlier day's revenue -- which is correct, but it means a day's
         *    total can still move after that day has closed.
         * 2. Invoice numbers are still allocated in approval order, so number
         *    order and date order can disagree for backdated sales.
         *
         * How far back this can reach is bounded by MOBILE_OFFLINE_MAX_BACKDATE_MINUTES
         * (12h by default), which is why that setting must stay under a day: a
         * longer window would let a sale post into a closed month or tax period.
         */
        const invoiceDate = staged.captured_at || staged.staged_date;

        // Terms are derived from the invoice date, not today, so a backdated
        // sale's due date is counted from the sale rather than the approval.
        const termsValidation = validatePaymentTerms({ terms: 'COD', invoice_date: invoiceDate });

        const invoiceQuery = `
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, terms, payment_terms_days, due_date, physical_receipt_no, tax_calculation_version, invoice_date, submitted_at, approved_at, approved_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, $16)
            RETURNING invoice_id;
        `;
        const invoiceRes = await client.query(invoiceQuery, [
            invoice_number,
            finalCustomerId,
            staged.employee_id, // credit original checkout cashier
            total_amount,
            subtotal_ex_tax,
            tax_total,
            amountPaid,
            invoiceStatus,
            termsValidation.normalizedTerms,
            termsValidation.canonicalDays,
            termsValidation.dueDate,
            prn,
            taxCalculation.tax_calculation_version,
            invoiceDate,
            staged.staged_date,
            reviewerId
        ]);

        const invoiceId = invoiceRes.rows[0].invoice_id;

        // Ledger: INVOICE_POSTED for credit / on account sales
        if (isCreditSale) {
            await arLedger.appendEntry(client, {
                customerId: finalCustomerId,
                invoiceId: invoiceId,
                entryType: 'INVOICE_POSTED',
                amount: total_amount,
                referenceNo: invoice_number,
                notes: `Staged sale approved on account (STG-${id})`,
                createdBy: staged.employee_id,
            });
        }

        // Store tax breakdown
        await storeTaxBreakdown(invoiceId, taxCalculation.tax_breakdown, client);

        /*
         * Deduct inventory and write StockOut rows, proceeding regardless of
         * stock availability.
         *
         * These deliberately keep CURRENT_TIMESTAMP rather than following
         * invoiceDate above, so an offline sale's document is backdated but its
         * stock movement is not. That inconsistency is intentional and should
         * not be "corrected": stock on hand is a running SUM over this table
         * with no snapshot, so backdating a StockOut rewrites history -- last
         * night's on-hand figure silently changes, and can be driven negative
         * for a window when it was genuinely positive. assertStockNeverNegative
         * in services/transactionDateService.js exists because of exactly that.
         *
         * A document dated a few hours late is a bookkeeping wrinkle; a
         * retroactively negative stock ledger corrupts costing and every "as of"
         * report. If the business ever needs the movement backdated too, the way
         * to do it is to run assertStockNeverNegative here and refuse the
         * approval when it fails -- not to backdate quietly.
         */
        for (const line of taxCalculation.lines) {
            const { part_id, quantity, sale_price, discount_amount, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive } = line;

            const costResult = await client.query('SELECT wac_cost FROM part WHERE part_id = $1', [part_id]);
            const cost_at_sale = costResult.rows.length > 0 ? costResult.rows[0].wac_cost : 0;

            const lineQuery = `
                INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
            `;
            await client.query(lineQuery, [invoiceId, part_id, quantity, sale_price, cost_at_sale, discount_amount || 0, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive]);

            // Transaction timestamp aligned with approval time (CURRENT_TIMESTAMP)
            const transactionQuery = `
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, transaction_date)
                VALUES ($1, 'StockOut', $2, $3, $4, $5, CURRENT_TIMESTAMP);
            `;
            await client.query(transactionQuery, [part_id, -quantity, cost_at_sale, invoice_number, staged.employee_id]);
        }

        // Add payment method and insert payment transaction
        if (methodQuery.rows.length > 0 && total_amount > 0) {
            const paymentStatus = settlementType === 'instant' ? 'settled' : settlementType === 'on_account' ? 'on_account' : 'pending';

            const finalTenderedAmt = tendered_amount !== undefined ? (tendered_amount !== null ? parseFloat(tendered_amount) : null) : (staged.tendered_amount ? parseFloat(staged.tendered_amount) : null);
            const changeAmt = finalTenderedAmt && finalTenderedAmt > parseFloat(total_amount)
                ? finalTenderedAmt - parseFloat(total_amount)
                : 0;

            const payAmount = isCreditSale ? 0 : total_amount;
            const stagedPaymentRes = await client.query(`
                INSERT INTO invoice_payments
                (invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, metadata, created_by, payment_status, settled_at, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::varchar, CASE WHEN $9::varchar = 'settled' THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
                RETURNING payment_id
            `, [
                invoiceId,
                staged.payment_method_id,
                payAmount,
                finalTenderedAmt,
                changeAmt,
                null,
                JSON.stringify({ source: 'pos_mobile_staged', staged_sale_id: id }),
                staged.employee_id,
                paymentStatus
            ]);

            if (paymentStatus === 'settled' && payAmount > 0) {
                await arLedger.appendEntry(client, {
                    customerId: finalCustomerId,
                    invoiceId: invoiceId,
                    paymentId: stagedPaymentRes.rows[0].payment_id,
                    entryType: 'PAYMENT_SETTLED',
                    amount: -payAmount,
                    paymentChannel: method.code,
                    referenceNo: invoice_number,
                    notes: `Payment via ${method.name} (staged sale STG-${id})`,
                    createdBy: staged.employee_id,
                    paymentSource: 'invoice_payments',
                });
            }
        }

        // Update staged sale status to APPROVED
        await client.query(`
            UPDATE staged_sale 
            SET status = 'APPROVED', approved_by = $2, approved_at = CURRENT_TIMESTAMP, physical_receipt_no = $3, tendered_amount = $4, customer_id = $5
            WHERE staged_sale_id = $1
        `, [id, reviewerId, prn, tendered_amount !== undefined ? tendered_amount : staged.tendered_amount, finalCustomerId]);

        await client.query('COMMIT');
        res.status(200).json({
            message: 'Staged sale approved and recorded successfully.',
            invoice_id: invoiceId,
            invoice_number
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error approving staged sale:', err.message);
        res.status(500).json({ message: 'Server error during approval.', error: err.message });
    } finally {
        client.release();
    }
});

// POST /sales/staging/:id/reject - Reject transaction
router.post('/sales/staging/:id/reject', protect, hasPermission('pos:use'), async (req, res) => {
    const { id } = req.params;
    const { reason, notes } = req.body;
    const reviewerId = req.user.employee_id;

    try {
        const fullReason = `${reason || 'Staged sale rejected'}${notes ? ' - ' + notes : ''}`;
        const { rows } = await db.query(`
            UPDATE staged_sale 
            SET status = 'REJECTED', rejected_by = $2, rejected_at = CURRENT_TIMESTAMP, rejection_reason = $3
            WHERE staged_sale_id = $1 AND status = 'PENDING'
            RETURNING *;
        `, [id, reviewerId, fullReason]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Staged transaction not found or already processed.' });
        }

        res.json({ message: 'Transaction rejected successfully.', staged_sale: rows[0] });
    } catch (err) {
        console.error('Error rejecting staged transaction:', err.message);
        res.status(500).json({ message: 'Server error during rejection.' });
    }
});

module.exports = router;
