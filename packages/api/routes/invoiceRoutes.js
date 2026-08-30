const express = require('express');
const { Parser } = require('json2csv');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { validatePaymentTerms } = require('../helpers/paymentTermsHelper');
const { calculateInvoiceTax, storeTaxBreakdown, validateTaxCalculation } = require('../services/taxCalculationService');
const arLedger = require('../services/arLedgerService');
const walletService = require('../services/customerWalletService');
const { normalizeStatusFilter } = require('../helpers/invoiceStatusFilter');
const router = express.Router();

// Shared WHERE-clause builder for the invoice listing/export endpoints.
// status: 'active' excludes Cancelled (the default for Sales History); an array of known
// statuses filters to that set (multi-select); anything else (e.g. 'all'/omitted) applies no status filter.
function buildInvoiceFilters({ startDate, endDate, q, status }) {
    const params = [startDate, endDate];
    const whereClauses = [
        '(i.invoice_date AT TIME ZONE \'Asia/Manila\')::date BETWEEN $1 AND $2'
    ];

    const statusFilter = normalizeStatusFilter(status);
    if (statusFilter === 'active') {
        whereClauses.push(`i.status <> 'Cancelled'`);
    } else if (Array.isArray(statusFilter)) {
        const placeholders = statusFilter.map((_, idx) => `$${params.length + idx + 1}`).join(', ');
        params.push(...statusFilter);
        whereClauses.push(`i.status IN (${placeholders})`);
    }

    if (typeof q === 'string' && q.trim().length > 0) {
        const searchParamIndex = params.length + 1; // next $ index
        params.push(`%${q.trim()}%`);
        whereClauses.push(`(
            i.invoice_number ILIKE $${searchParamIndex}
            OR i.physical_receipt_no ILIKE $${searchParamIndex}
            OR c.first_name ILIKE $${searchParamIndex}
            OR c.last_name ILIKE $${searchParamIndex}
            OR (c.first_name || ' ' || c.last_name) ILIKE $${searchParamIndex}
            OR EXISTS (
                SELECT 1
                FROM invoice_line il2
                JOIN part p2 ON il2.part_id = p2.part_id
                LEFT JOIN brand b2 ON p2.brand_id = b2.brand_id
                LEFT JOIN "group" g2 ON p2.group_id = g2.group_id
                WHERE il2.invoice_id = i.invoice_id
                  AND (
                    p2.detail ILIKE $${searchParamIndex}
                    OR b2.brand_name ILIKE $${searchParamIndex}
                    OR g2.group_name ILIKE $${searchParamIndex}
                    OR EXISTS (
                        SELECT 1 FROM part_number pn2
                        WHERE pn2.part_id = p2.part_id AND pn2.part_number ILIKE $${searchParamIndex}
                    )
                  )
                )
            )`);
    }

    return { params, whereClauses };
}

const INVOICE_SELECT_FROM = `
            FROM invoice i
            JOIN customer c ON i.customer_id = c.customer_id
            JOIN employee e ON i.employee_id = e.employee_id
            LEFT JOIN employee appr ON i.approved_by = appr.employee_id
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(cn.total_amount), 0) AS refunded_amount,
                    COALESCE(SUM(cn.subtotal_ex_tax), 0) AS refunded_amount_ex_tax,
                    COALESCE(SUM(cn.tax_total), 0) AS refunded_tax_total
                FROM credit_note cn
                WHERE cn.invoice_id = i.invoice_id
            ) r ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(CASE WHEN ip.payment_status = 'settled' THEN ip.amount_paid ELSE 0 END), 0) AS settled_amount,
                    COALESCE(SUM(CASE WHEN ip.payment_status = 'pending' THEN ip.amount_paid ELSE 0 END), 0) AS pending_amount,
                    COALESCE(SUM(CASE WHEN ip.payment_status = 'on_account' THEN ip.amount_paid ELSE 0 END), 0) AS on_account_amount
                FROM invoice_payments ip
                WHERE ip.invoice_id = i.invoice_id
            ) ps ON TRUE
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object(
                    'tax_rate_id', itb.tax_rate_id,
                    'rate_name', itb.rate_name,
                    'rate_percentage', itb.rate_percentage,
                    'tax_base', itb.tax_base,
                    'tax_amount', itb.tax_amount,
                    'line_count', itb.line_count
                )) as tax_breakdown
                FROM invoice_tax_breakdown itb
                WHERE itb.invoice_id = i.invoice_id
            ) tb ON TRUE
`;

// GET /invoices - Get invoices with date filtering, optional search/status filter, and pagination
router.get('/invoices', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { startDate, endDate, q, status } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 100, 1), 500);

    try {
        const { params, whereClauses } = buildInvoiceFilters({ startDate, endDate, q, status });

        const countQuery = `SELECT COUNT(*)::int AS total ${INVOICE_SELECT_FROM} WHERE ${whereClauses.join(' AND ')};`;
        const countResult = await db.query(countQuery, params);
        const total = countResult.rows[0]?.total || 0;

        const limitParamIndex = params.length + 1;
        const offsetParamIndex = params.length + 2;
        const pagedParams = [...params, pageSize, (page - 1) * pageSize];

        const query = `
            SELECT
                i.*,
                c.first_name as customer_first_name,
                c.last_name as customer_last_name,
                e.first_name as employee_first_name,
                e.last_name as employee_last_name,
                (appr.first_name || ' ' || appr.last_name) as approved_by_name,
                r.refunded_amount,
                r.refunded_amount_ex_tax,
                r.refunded_tax_total,
                GREATEST(i.total_amount - r.refunded_amount, 0) AS net_amount,
                GREATEST((i.total_amount - r.refunded_amount) - i.amount_paid, 0) AS balance_due,
                CASE
                    WHEN i.due_date IS NULL THEN NULL
                    WHEN i.due_date < CURRENT_TIMESTAMP THEN
                        EXTRACT(days FROM CURRENT_TIMESTAMP - i.due_date)::integer
                    ELSE 0
                END AS days_overdue,
                ps.settled_amount,
                ps.pending_amount,
                ps.on_account_amount,
                tb.tax_breakdown
            ${INVOICE_SELECT_FROM}
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY i.invoice_date DESC
            LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex};
        `;
        const { rows } = await db.query(query, pagedParams);
        res.json({ rows, total, page, pageSize });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /invoices/export - Export invoices matching the same filters as GET /invoices, as CSV (no pagination)
router.get('/invoices/export', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { startDate, endDate, q, status } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    try {
        const { params, whereClauses } = buildInvoiceFilters({ startDate, endDate, q, status });

        const query = `
            SELECT
                i.invoice_number,
                i.physical_receipt_no,
                i.invoice_date,
                e.first_name || ' ' || e.last_name AS issuer,
                (appr.first_name || ' ' || appr.last_name) AS approved_by_name,
                c.first_name || ' ' || c.last_name AS customer,
                i.status,
                i.total_amount,
                r.refunded_amount,
                GREATEST(i.total_amount - r.refunded_amount, 0) AS net_amount,
                i.amount_paid,
                GREATEST((i.total_amount - r.refunded_amount) - i.amount_paid, 0) AS balance_due
            ${INVOICE_SELECT_FROM}
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY i.invoice_date DESC;
        `;
        const { rows } = await db.query(query, params);
        const parser = new Parser();
        const csv = parser.parse(rows);
        res.header('Content-Type', 'text/csv').attachment(`sales-history-${startDate}-to-${endDate}.csv`).send(csv);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /invoices/summary - Aggregated financial stats for a date range/search, independent of table pagination.
// Always excludes Cancelled invoices (status: 'active'), regardless of the caller's table status filter, matching
// how the Sales History summary panel has always reported active (non-voided) figures.
router.get('/invoices/summary', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { startDate, endDate, q } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    try {
        const { params, whereClauses } = buildInvoiceFilters({ startDate, endDate, q, status: 'active' });

        const query = `
            WITH filtered AS (
                SELECT
                    i.invoice_number,
                    COALESCE(i.subtotal_ex_tax, i.total_amount) AS gross_line,
                    COALESCE(i.tax_total, 0) AS vat_line,
                    COALESCE(r.refunded_amount_ex_tax, r.refunded_amount, 0) AS refund_line,
                    COALESCE(r.refunded_tax_total, 0) AS refund_vat_line,
                    GREATEST(i.total_amount - COALESCE(r.refunded_amount, 0), 0) AS net_inclusive,
                    i.amount_paid,
                    NULLIF(TRIM(c.first_name || ' ' || c.last_name), '') AS customer_name
                ${INVOICE_SELECT_FROM}
                WHERE ${whereClauses.join(' AND ')}
            ),
            per_invoice AS (
                SELECT
                    *,
                    GREATEST(gross_line - refund_line, 0) AS net_excl_tax,
                    LEAST(amount_paid, net_inclusive) AS collected,
                    GREATEST(net_inclusive - LEAST(amount_paid, net_inclusive), 0) AS balance
                FROM filtered
            ),
            by_customer AS (
                SELECT customer_name, SUM(net_excl_tax) AS customer_net
                FROM per_invoice
                WHERE customer_name IS NOT NULL
                GROUP BY customer_name
                ORDER BY customer_net DESC
                LIMIT 1
            )
            SELECT
                (SELECT COUNT(*) FROM per_invoice)::int AS invoices_issued,
                (SELECT COUNT(*) FROM per_invoice WHERE net_excl_tax > 0)::int AS net_active_invoices,
                COALESCE((SELECT SUM(gross_line) FROM per_invoice), 0) AS gross_sales,
                COALESCE((SELECT SUM(refund_line) FROM per_invoice), 0) AS refunds,
                COALESCE((SELECT SUM(vat_line) FROM per_invoice), 0) AS vat_total,
                COALESCE((SELECT SUM(refund_vat_line) FROM per_invoice), 0) AS refund_vat_total,
                COALESCE((SELECT SUM(balance) FROM per_invoice), 0) AS ar_outstanding,
                COALESCE((SELECT SUM(collected) FROM per_invoice), 0) AS amount_collected,
                (SELECT customer_name FROM by_customer) AS top_customer,
                COALESCE((SELECT customer_net FROM by_customer), 0) AS top_customer_net,
                COALESCE((SELECT array_agg(invoice_number) FROM per_invoice), ARRAY[]::text[]) AS active_invoice_numbers;
        `;
        const { rows } = await db.query(query, params);
        res.json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/invoices/:id/lines - Get line items for a specific invoice
router.get('/invoices/:id/lines', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT
                il.*,
                p.detail,
                b.brand_name,
                g.group_name,
                (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) as part_numbers
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE il.invoice_id = $1
            ORDER BY p.detail;
        `;
        const { rows } = await db.query(query, [id]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/invoices/:id/lines-with-refunds - Get line items with refund data for a specific invoice
router.get('/invoices/:id/lines-with-refunds', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { id } = req.params;
    try {
        // Use a subquery to sum refunded quantities per invoice line
        const query = `
            SELECT
                il.*,
                p.detail,
                b.brand_name,
                g.group_name,
                (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) as part_numbers,
                COALESCE(rf.quantity_refunded, 0) AS quantity_refunded
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            LEFT JOIN (
                SELECT cnl.invoice_line_id, SUM(cnl.quantity) AS quantity_refunded
                FROM credit_note_line cnl
                GROUP BY cnl.invoice_line_id
            ) rf ON rf.invoice_line_id = il.invoice_line_id
            WHERE il.invoice_id = $1
            ORDER BY p.detail;
        `;
        const { rows } = await db.query(query, [id]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /invoices/check-physical-receipt/:prn - live-check whether a physical receipt number is already taken
// (the create-invoice flow below auto-increments on a collision rather than rejecting, so this is advisory only)
router.get('/invoices/check-physical-receipt/:prn', protect, hasPermission('invoicing:create'), async (req, res) => {
    const prn = formatPhysicalReceiptNumber(req.params.prn);
    if (!prn) {
        return res.json({ taken: false, normalized: null });
    }
    try {
        const { rows } = await db.query(
            `SELECT public.is_physical_receipt_no_taken($1) AS is_taken`,
            [prn]
        );
        res.json({ taken: !!rows[0]?.is_taken, normalized: prn });
    } catch (err) {
        console.error('Check physical receipt no error:', err.message);
        res.status(500).json({ message: 'Server error checking physical receipt number.' });
    }
});

// POST /invoices - Create a new invoice
router.post('/invoices', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { customer_id, employee_id, lines, amount_paid, tendered_amount, payment_method, terms, payment_terms_days, physical_receipt_no, tax_rate_id, payments, staged_sale_id } = req.body;

    if (!customer_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    // A discount larger than the line it sits on would produce a negative tax
    // base, which nothing downstream checks the sign of.
    for (const line of lines) {
        const lineSubtotal = Number(line.quantity) * Number(line.sale_price);
        const discount = Number(line.discount_amount || 0);
        if (discount > lineSubtotal + 0.01) {
            return res.status(400).json({
                message: `Discount for part_id ${line.part_id} (${discount.toFixed(2)}) exceeds the line subtotal (${lineSubtotal.toFixed(2)}).`
            });
        }
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const invoice_number = await getNextDocumentNumber(client, 'INV');

        // Get part details for tax calculation
        const partIds = lines.map(line => line.part_id);
        const { rows: parts } = await client.query(
            'SELECT part_id, tax_rate_id, is_tax_inclusive_price FROM part WHERE part_id = ANY($1)',
            [partIds]
        );

        // Calculate tax using the centralized service with selected tax rate
        const taxCalculation = await calculateInvoiceTax(lines, parts, tax_rate_id);
        
        // Validate calculation
        if (!validateTaxCalculation(taxCalculation)) {
            throw new Error('Tax calculation validation failed');
        }

        const { subtotal_ex_tax, tax_total, total_amount } = taxCalculation;

        // Securely parse amount_paid provided by client; default to 0
        const paid = parseFloat(String(amount_paid || '').replace(/[^0-9.-]+/g, '')) || 0;

        // Determine invoice status based on paid vs total_amount
        let status = 'Unpaid';
        if (paid >= total_amount && total_amount > 0) {
            status = 'Paid';
        } else if (paid > 0 && paid < total_amount) {
            status = 'Partially Paid';
        }

        // Validate and process payment terms using robust helper
        const termsValidation = validatePaymentTerms({
            terms,
            payment_terms_days,
            invoice_date: new Date() // Use current time as invoice date
        });

        if (!termsValidation.isValid) {
            return res.status(400).json({ 
                message: 'Invalid payment terms', 
                errors: termsValidation.errors 
            });
        }

        const canonicalDays = termsValidation.canonicalDays;
        const dueDate = termsValidation.dueDate;
        const normalizedTerms = termsValidation.normalizedTerms;

        // Fetch customer details
        const customerResult = await client.query('SELECT first_name, last_name, credit_hold, credit_hold_reason FROM customer WHERE customer_id = $1', [customer_id]);
        if (customerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid customer_id.' });
        }
        const customerRow = customerResult.rows[0];
        const customerName = `${customerRow.first_name || ''} ${customerRow.last_name || ''}`.trim().toLowerCase();
        const isWalkIn = customerName.includes('walk-in') || customerName.includes('walk in');

        // Check if any payment method in payments array or legacy payment_method is on_account
        let hasOnAccountPayment = false;
        if (payments && Array.isArray(payments) && payments.length > 0) {
            const pmIds = payments.map(p => {
                let lookupParam = p.method_id;
                if (typeof p.method_id === 'string' && /^\d+$/.test(p.method_id)) {
                    lookupParam = parseInt(p.method_id, 10);
                }
                return lookupParam;
            });
            const { rows: pmRows } = await client.query(
                'SELECT method_id, code, type, config FROM payment_methods WHERE method_id = ANY($1) AND enabled = true',
                [pmIds]
            );
            for (const pm of pmRows) {
                const pmConfig = typeof pm.config === 'string' ? JSON.parse(pm.config) : pm.config;
                const settlementType = pm.code === 'store_wallet' ? 'instant' : (pmConfig?.settlement_type || (pm.type === 'cash' ? 'instant' : 'delayed'));
                if (settlementType === 'on_account' || pm.code === 'on_account') {
                    hasOnAccountPayment = true;
                    break;
                }
            }
        } else if (payment_method) {
            const methodCode = payment_method.toLowerCase().replace(/\s+/g, '_');
            const { rows: pmRows } = await client.query(
                'SELECT method_id, code, type, config FROM payment_methods WHERE (code = $1 OR name ILIKE $1) AND enabled = true LIMIT 1',
                [methodCode]
            );
            if (pmRows.length > 0) {
                const pm = pmRows[0];
                const pmConfig = typeof pm.config === 'string' ? JSON.parse(pm.config) : pm.config;
                const settlementType = pmConfig?.settlement_type || (pm.type === 'cash' ? 'instant' : 'delayed');
                if (settlementType === 'on_account' || pm.code === 'on_account') {
                    hasOnAccountPayment = true;
                }
            }
        }

        const isCreditSale = canonicalDays > 0 || hasOnAccountPayment;

        // Walk-In Customer Credit Terms Enforcement
        if (isWalkIn && isCreditSale) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Payment terms or On Account payment are not allowed for Walk-In customers.' });
        }

        // Credit Hold Enforcement for credit sales
        if (isCreditSale) {
            if (customerRow.credit_hold) {
                const hasOverrideParam = req.body.override_credit_limit === true || req.body.manager_override === true;
                const hasManagerPermission = req.user?.permissions?.includes('ar:override_credit_limit');
                if (!hasOverrideParam && !hasManagerPermission) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({
                        message: `Credit sale blocked: Customer is on credit hold (${customerRow.credit_hold_reason || 'Credit Hold'}). Manager override required.`,
                        credit_hold: true,
                        reason: customerRow.credit_hold_reason
                    });
                }
            }
        }

        // Normalize physical receipt number: trim and treat empty as null
        let prn = formatPhysicalReceiptNumber(physical_receipt_no);
        
        // If a physical receipt number is provided, ensure it's unique
        if (prn) {
            let attempts = 0;
            let basePrn = prn;
            let isUnique = false;
            
            while (!isUnique && attempts < 10) {
                const { rows: checkRows } = await client.query(
                    `SELECT public.is_physical_receipt_no_taken($1) AS is_taken`,
                    [prn]
                );
                
                if (!checkRows[0]?.is_taken) {
                    isUnique = true;
                } else {
                    attempts++;
                    // Auto-increment: DR-4652 -> DR-4653, DR-4654, etc.
                    const match = basePrn.match(/^(.+?)(\d+)$/);
                    if (match) {
                        const prefix = match[1];
                        const number = parseInt(match[2]) + attempts;
                        prn = `${prefix}${number}`;
                    } else {
                        // If no number pattern, append attempt number
                        prn = `${basePrn}-${attempts}`;
                    }
                }
            }
            
            if (!isUnique) {
                throw new Error('Unable to generate unique physical receipt number after multiple attempts');
            }
        }

        const invoiceQuery = `
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, terms, payment_terms_days, due_date, physical_receipt_no, tax_calculation_version, submitted_at, approved_at, approved_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3)
            RETURNING invoice_id;
        `;
    // Debug: log computed financials to aid troubleshooting
    console.log(`Creating invoice ${invoice_number} - total_amount=${total_amount}, subtotal_ex_tax=${subtotal_ex_tax}, tax_total=${tax_total}, amount_paid=${paid}, status=${status}, payment_terms_days=${canonicalDays}, due_date=${dueDate}`);

    // Store numeric paid amount and computed status with tax breakdown
    const invoiceResult = await client.query(invoiceQuery, [invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, paid, status, normalizedTerms, canonicalDays, dueDate, prn, taxCalculation.tax_calculation_version]);
        const newInvoiceId = invoiceResult.rows[0].invoice_id;

        // Ledger: INVOICE_POSTED for credit-term invoices and on-account sales
        if (isCreditSale || (paid < total_amount && normalizedTerms !== 'Cash')) {
            await arLedger.appendEntry(client, {
                customerId: customer_id, invoiceId: newInvoiceId,
                entryType: 'INVOICE_POSTED', amount: total_amount,
                referenceNo: invoice_number,
                notes: `Invoice ${invoice_number} posted on credit terms`,
                createdBy: employee_id,
            });
        }

        // Store tax breakdown
        await storeTaxBreakdown(newInvoiceId, taxCalculation.tax_breakdown, client);

        for (const line of taxCalculation.lines) {
            const { part_id, quantity, sale_price, discount_amount, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive } = line;

            const costResult = await client.query('SELECT wac_cost FROM part WHERE part_id = $1', [part_id]);
            const cost_at_sale = costResult.rows.length > 0 ? costResult.rows[0].wac_cost : 0;

            const lineQuery = `
                INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
            `;
            await client.query(lineQuery, [newInvoiceId, part_id, quantity, sale_price, cost_at_sale, discount_amount || 0, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive]);

            const transactionQuery = `
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
                VALUES ($1, 'StockOut', $2, $3, $4, $5);
            `;
            await client.query(transactionQuery, [part_id, -quantity, cost_at_sale, invoice_number, employee_id]);
        }

        if (payments && Array.isArray(payments) && payments.length > 0) {
            const totalPayments = payments.reduce((sum, p) => sum + parseFloat(p.amount_paid), 0);
            if (totalPayments > total_amount + 0.01) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Total payments exceed invoice amount.' });
            }

            for (const payment of payments) {
                const { method_id, amount_paid: p_amount_paid, tendered_amount: p_tendered_amount, reference, metadata = {} } = payment;
                let lookupParam = method_id;
                try {
                    if (typeof method_id === 'string' && /^\d+$/.test(method_id)) {
                        lookupParam = parseInt(method_id, 10);
                    }
                } catch { }
                const method = await client.query('SELECT * FROM payment_methods WHERE method_id = $1 AND enabled = true', [lookupParam]);
                if (method.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ message: `Invalid payment method: ${method_id}` });
                }
                const methodConfig = typeof method.rows[0].config === 'string' ? JSON.parse(method.rows[0].config) : method.rows[0].config;
                if (methodConfig.requires_reference && (!reference || reference.trim() === '')) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ message: `Reference is required for ${method.rows[0].name}` });
                }
                if (methodConfig.requires_receipt_no && (!prn)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ message: `Physical receipt number is required for ${method.rows[0].name}` });
                }
                const tAmt = p_tendered_amount ? parseFloat(p_tendered_amount) : null;
                const pAmt = parseFloat(p_amount_paid);
                const changeAmt = tAmt && tAmt > pAmt ? tAmt - pAmt : 0;
                if (changeAmt > 0 && !methodConfig.change_allowed) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ message: `Change is not allowed for ${method.rows[0].name}` });
                }
                if (method.rows[0].code === 'store_wallet') {
                    const wallet = await walletService.getWallet(customer_id, client);
                    if (!wallet || wallet.balance < pAmt) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({ message: `Insufficient Store Wallet balance. Available: ₱${wallet ? wallet.balance.toFixed(2) : '0.00'}, Required: ₱${pAmt.toFixed(2)}` });
                    }
                    await walletService.appendWalletTransaction(client, {
                        customerId: customer_id,
                        type: 'INVOICE_PAYMENT_DRAWDOWN',
                        amount: -pAmt,
                        referenceType: 'INVOICE',
                        referenceId: newInvoiceId,
                        notes: `Store wallet payment for invoice #${invoice_number}`,
                        createdBy: employee_id,
                    });
                }
                const settlementType = method.rows[0].code === 'store_wallet' ? 'instant' : (methodConfig.settlement_type || (method.rows[0].type === 'cash' ? 'instant' : 'delayed'));
                
                if (settlementType === 'on_account' && method.rows[0].code !== 'store_wallet' && customerName.includes('walk-in')) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ message: 'On Account payment is not available for Walk-In customers.' });
                }

                const paymentStatus = settlementType === 'instant' ? 'settled' : settlementType === 'on_account' ? 'on_account' : 'pending';
                const ipRes = await client.query(`
                    INSERT INTO invoice_payments 
                    (invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, metadata, created_by, payment_status, settled_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::varchar, CASE WHEN $9::varchar = 'settled' THEN CURRENT_TIMESTAMP ELSE NULL END)
                    RETURNING payment_id
                `, [newInvoiceId, method.rows[0].method_id, pAmt, tAmt, changeAmt, reference, JSON.stringify(metadata), employee_id, paymentStatus]);
                if (paymentStatus === 'settled') {
                    await arLedger.appendEntry(client, {
                        customerId: customer_id, invoiceId: newInvoiceId,
                        paymentId: ipRes.rows[0].payment_id,
                        entryType: 'PAYMENT_SETTLED', amount: -pAmt,
                        paymentChannel: method.rows[0].code,
                        referenceNo: reference || invoice_number,
                        notes: `Payment via ${method.rows[0].name}`,
                        createdBy: employee_id,
                        paymentSource: 'invoice_payments',
                    });
                }
            }
        } else if (paid > 0) {
            const methodCode = payment_method ? payment_method.toLowerCase().replace(/\s+/g, '_') : 'cash';
            let method = await client.query("SELECT * FROM payment_methods WHERE code = $1 OR name ILIKE $1 LIMIT 1", [methodCode]);
            if (method.rows.length === 0) {
                method = await client.query("SELECT * FROM payment_methods WHERE type = 'cash' LIMIT 1");
            }
            if (method.rows.length > 0) {
                const methodConfig = typeof method.rows[0].config === 'string' ? JSON.parse(method.rows[0].config) : method.rows[0].config;
                const settlementType = methodConfig.settlement_type || (method.rows[0].type === 'cash' ? 'instant' : 'delayed');
                const paymentStatus = settlementType === 'instant' ? 'settled' : settlementType === 'on_account' ? 'on_account' : 'pending';
                const tenderVal = typeof tendered_amount !== 'undefined' && tendered_amount !== null ? tendered_amount : null;
                const changeAmt = tenderVal && tenderVal > paid ? tenderVal - paid : 0;
                const ipRes = await client.query(`
                    INSERT INTO invoice_payments 
                    (invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, created_by, payment_status, settled_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar, CASE WHEN $8::varchar = 'settled' THEN CURRENT_TIMESTAMP ELSE NULL END)
                    RETURNING payment_id
                `, [newInvoiceId, method.rows[0].method_id, paid, tenderVal, changeAmt, null, employee_id, paymentStatus]);
                if (paymentStatus === 'settled') {
                    await arLedger.appendEntry(client, {
                        customerId: customer_id, invoiceId: newInvoiceId,
                        paymentId: ipRes.rows[0].payment_id,
                        entryType: 'PAYMENT_SETTLED', amount: -paid,
                        paymentChannel: method.rows[0].code,
                        referenceNo: invoice_number,
                        notes: `Payment via ${method.rows[0].name}`,
                        createdBy: employee_id,
                        paymentSource: 'invoice_payments',
                    });
                }
            }
        }


        // If a staged sale was converted, resolve it as APPROVED
        if (staged_sale_id) {
            await client.query(`
                UPDATE staged_sale 
                SET status = 'APPROVED', approved_by = $2, approved_at = CURRENT_TIMESTAMP
                WHERE staged_sale_id = $1
            `, [staged_sale_id, employee_id]);
        }

        await client.query('COMMIT');
    res.status(201).json({ 
        message: 'Invoice created successfully', 
        invoice_id: newInvoiceId, 
        invoice_number, 
        amount_paid: paid, 
        tendered_amount: tendered_amount || null, 
        payment_terms_days: canonicalDays, 
        due_date: dueDate,
        physical_receipt_no: prn,
        subtotal_ex_tax,
        tax_total,
        total_amount,
        tax_breakdown: taxCalculation.tax_breakdown
    });

    } catch (err) {
        await client.query('ROLLBACK');
        // Unique violation for physical_receipt_no
        if (err && err.code === '23505' && /physical_receipt_no/i.test(err.detail || '')) {
            return res.status(409).json({ message: 'Physical Receipt No already exists. Please use a unique number.' });
        }
        console.error('Transaction Error:', err.message);
        res.status(500).json({ message: 'Server error during transaction.', error: err.message });
    } finally {
        client.release();
    }
});

// POST /invoices/:id/payments - Add split payments to an invoice


// PUT /invoices/payments/:payment_id/settle - Mark a delayed payment as settled
router.put('/invoices/payments/:payment_id/settle', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { payment_id } = req.params;

    if (!payment_id || isNaN(parseInt(payment_id))) {
        return res.status(400).json({ message: 'Invalid payment ID.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Update payment status to settled
        const { rows: paymentRows } = await client.query(`
            UPDATE invoice_payments
            SET payment_status = 'settled', settled_at = CURRENT_TIMESTAMP
            WHERE payment_id = $1 AND payment_status = 'pending'
            RETURNING invoice_id, amount_paid, method_id, reference
        `, [payment_id]);

        if (paymentRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Payment not found or already settled.' });
        }

        const p = paymentRows[0];

        // invoice.amount_paid/status is updated automatically by the update_invoice_balance_after_payment
        // trigger on invoice_payments, but ar_ledger is append-only and must be written explicitly.
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
                paymentId: parseInt(payment_id, 10),
                entryType: 'PAYMENT_SETTLED',
                amount: -p.amount_paid,
                paymentChannel: ctx[0].method_code,
                referenceNo: p.reference || null,
                notes: `Settled via ${ctx[0].method_name}`,
                createdBy: req.user.employee_id,
                paymentSource: 'invoice_payments',
            });
        }

        await client.query('COMMIT');
        res.json({ message: 'Payment settled successfully.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Settle payment error:', err.message);
        res.status(500).json({ message: 'Server error settling payment.', error: err.message });
    } finally {
        client.release();
    }
});

// DELETE /api/invoices/:id - Void an invoice: reverses stock and AR ledger impact,
// but never hard-deletes the row or its payment/ledger history. ar_ledger is an
// append-only, immutable audit trail (see 20260802_03_create_ar_ledger.sql) — a true
// delete would either violate its FKs or (if forced) erase financial history, so
// correcting a mistaken invoice is done the accounting way: reverse it, keep the record.
router.delete('/invoices/:id', protect, hasPermission('invoice:delete'), async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { rows: invoiceRows } = await client.query(
            'SELECT invoice_number, customer_id, status FROM invoice WHERE invoice_id = $1 FOR UPDATE',
            [id]
        );
        if (invoiceRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Invoice not found' });
        }
        const { invoice_number: invoiceNumber, customer_id: customerId, status } = invoiceRows[0];
        if (status === 'Cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invoice is already voided.' });
        }

        // Reverse stock for whatever quantity hasn't already been returned via a refund
        // (credit_note), so a previously part-refunded invoice isn't double-restocked.
        const { rows: lines } = await client.query(`
            SELECT il.invoice_line_id, il.part_id, il.quantity, il.cost_at_sale,
                   COALESCE(rf.quantity_refunded, 0) AS quantity_refunded
            FROM invoice_line il
            LEFT JOIN (
                SELECT invoice_line_id, SUM(quantity) AS quantity_refunded
                FROM credit_note_line
                GROUP BY invoice_line_id
            ) rf ON rf.invoice_line_id = il.invoice_line_id
            WHERE il.invoice_id = $1
        `, [id]);

        for (const line of lines) {
            const qtyToReverse = line.quantity - line.quantity_refunded;
            if (qtyToReverse <= 0) continue;
            await client.query(`
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
                VALUES ($1, 'StockIn', $2, $3, $4, $5, $6);
            `, [line.part_id, qtyToReverse, line.cost_at_sale, invoiceNumber, req.user.employee_id || null, 'SYSTEM REVERSAL: Invoice voided']);
        }

        // Void any non-voided payments so amount_paid/status recompute to reflect
        // the voided invoice; the trigger on invoice_payments fires per-row.
        await client.query(
            `UPDATE invoice_payments SET payment_status = 'voided' WHERE invoice_id = $1 AND payment_status <> 'voided'`,
            [id]
        );

        // Offset the invoice's net effect on the customer's AR ledger with a single
        // adjustment entry rather than touching (immutable) historical rows.
        const { rows: ledgerRows } = await client.query(
            `SELECT COALESCE(SUM(amount), 0) AS net FROM ar_ledger WHERE invoice_id = $1`,
            [id]
        );
        const net = parseFloat(ledgerRows[0].net);
        if (net !== 0) {
            const reversalAmount = -net;
            await arLedger.appendEntry(client, {
                customerId,
                invoiceId: id,
                entryType: reversalAmount >= 0 ? 'DEBIT_ADJUSTMENT' : 'CREDIT_ADJUSTMENT',
                amount: reversalAmount,
                referenceNo: invoiceNumber,
                notes: 'SYSTEM REVERSAL: Invoice voided',
                createdBy: req.user.employee_id || null,
            });
        }

        // Free the physical receipt number for reuse and mark the invoice voided.
        // invoice_number and all line/payment/ledger history are preserved intact.
        await client.query(
            `UPDATE invoice SET status = 'Cancelled', physical_receipt_no = NULL WHERE invoice_id = $1`,
            [id]
        );

        await client.query('COMMIT');
        res.json({ message: 'Invoice voided and stock reversed.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Void invoice error:', err.message);
        res.status(500).json({ message: 'Server error voiding invoice', error: err.message });
    } finally {
        client.release();
    }
});

// PUT /api/invoices/:id/physical-receipt-no - Update physical receipt number
router.put('/invoices/:id/physical-receipt-no', protect, hasPermission('invoice:edit_receipt_no'), async (req, res) => {
    const { id } = req.params;
    const { physical_receipt_no } = req.body;

    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Invalid invoice ID.' });
    }

    try {
        // Normalize physical receipt number: trim and treat empty as null
        const prn = formatPhysicalReceiptNumber(physical_receipt_no);

        // Check if another invoice or payment already has this physical receipt number
        if (prn) {
            const { rows: checkRows } = await db.query(
                `SELECT public.is_physical_receipt_no_taken($1, $2) AS is_taken`,
                [prn, parseInt(id)]
            );
            if (checkRows[0]?.is_taken) {
                return res.status(409).json({ message: 'Physical Receipt No already exists. Please use a unique number.' });
            }
        }

        // Update the invoice
        const updateQuery = `
            UPDATE invoice 
            SET physical_receipt_no = $1
            WHERE invoice_id = $2
            RETURNING invoice_id, physical_receipt_no
        `;
        const { rows } = await db.query(updateQuery, [prn, id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Invoice not found.' });
        }

        res.json({ 
            message: 'Physical receipt number updated successfully.',
            invoice_id: rows[0].invoice_id,
            physical_receipt_no: rows[0].physical_receipt_no
        });
    } catch (err) {
        console.error('Update physical receipt no error:', err.message);
        res.status(500).json({ message: 'Server error updating physical receipt number.', error: err.message });
    }
});

// PUT /api/invoices/:id/due-date - Update invoice due date with comprehensive logging
router.put('/invoices/:id/due-date', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { id } = req.params;
    const { new_due_date, reason, days_adjustment } = req.body;

    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Invalid invoice ID.' });
    }

    if (!new_due_date) {
        return res.status(400).json({ message: 'New due date is required.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Get current invoice data
        const { rows: invoiceRows } = await client.query(
            'SELECT invoice_id, due_date, invoice_number FROM invoice WHERE invoice_id = $1',
            [id]
        );

        if (invoiceRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Invoice not found.' });
        }

        const invoice = invoiceRows[0];
        const oldDueDate = invoice.due_date;
        
        // Preserve the original time when updating the date
        let newDueDate;
        if (oldDueDate) {
            // Extract time components from the original due date
            const originalDate = new Date(oldDueDate);
            const originalHours = originalDate.getHours();
            const originalMinutes = originalDate.getMinutes();
            const originalSeconds = originalDate.getSeconds();
            const originalMilliseconds = originalDate.getMilliseconds();
            
            // Create new date with the selected date but preserve original time
            const selectedDate = new Date(new_due_date + 'T00:00:00.000Z'); // Parse as UTC date
            selectedDate.setUTCHours(originalHours, originalMinutes, originalSeconds, originalMilliseconds);
            newDueDate = selectedDate;
        } else {
            // If no original due date, use the selected date as-is
            newDueDate = new Date(new_due_date);
        }

        // Validate the new date
        if (isNaN(newDueDate.getTime())) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid date format.' });
        }

        // Calculate days adjustment if not provided
        let calculatedDaysAdjustment = days_adjustment;
        if (oldDueDate && !calculatedDaysAdjustment) {
            const oldDate = new Date(oldDueDate);
            const timeDiff = newDueDate.getTime() - oldDate.getTime();
            calculatedDaysAdjustment = Math.round(timeDiff / (1000 * 60 * 60 * 24));
        }

        // Get request metadata for audit trail
        const userAgent = req.headers['user-agent'] || null;
        const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || null;

        // Update the invoice due date
        await client.query(
            'UPDATE invoice SET due_date = $1 WHERE invoice_id = $2',
            [newDueDate, id]
        );

        // Log the change to due_date_log
        await client.query(`
            INSERT INTO due_date_log (
                invoice_id, 
                old_due_date, 
                new_due_date, 
                days_adjustment, 
                edited_by, 
                edited_on, 
                reason, 
                ip_address, 
                user_agent,
                system_generated
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8, $9)
        `, [
            id,
            oldDueDate,
            newDueDate,
            calculatedDaysAdjustment,
            req.user.employee_id,
            reason || null,
            ipAddress,
            userAgent,
            false // manual edit
        ]);

        await client.query('COMMIT');

        res.json({
            message: 'Due date updated successfully.',
            invoice_id: id,
            invoice_number: invoice.invoice_number,
            old_due_date: oldDueDate,
            new_due_date: newDueDate,
            days_adjustment: calculatedDaysAdjustment
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Update due date error:', err.message);
        res.status(500).json({ message: 'Server error updating due date.', error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;