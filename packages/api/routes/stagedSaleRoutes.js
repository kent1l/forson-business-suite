const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');
const { validatePaymentTerms } = require('../helpers/paymentTermsHelper');
const { calculateInvoiceTax, storeTaxBreakdown, validateTaxCalculation } = require('../services/taxCalculationService');

const router = express.Router();

// POST /sales/staging - Stage a transaction from Mobile POS
router.post('/sales/staging', protect, async (req, res) => {
    const { customer_id, employee_id, lines, tax_rate_id, payment_method_id, tendered_amount, physical_receipt_no } = req.body;

    if (!customer_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required staging fields.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        let subtotal = 0;
        for (const line of lines) {
            subtotal += (parseFloat(line.sale_price) * parseFloat(line.quantity)) - (parseFloat(line.discount_amount) || 0);
        }

        const insertQuery = `
            INSERT INTO staged_sale (customer_id, employee_id, total_amount, tax_rate_id, physical_receipt_no, payment_method_id, tendered_amount, status, staged_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', CURRENT_TIMESTAMP)
            RETURNING staged_sale_id;
        `;
        const result = await client.query(insertQuery, [
            customer_id,
            employee_id,
            subtotal,
            tax_rate_id || null,
            physical_receipt_no || null,
            payment_method_id,
            tendered_amount || null
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
        console.error('Error staging sale:', err.message);
        res.status(500).json({ message: 'Error writing transaction staging record.' });
    } finally {
        client.release();
    }
});

// GET /sales/staging - Query staged transactions by status
router.get('/sales/staging', protect, async (req, res) => {
    const { status = 'PENDING' } = req.query;

    try {
        const query = `
            SELECT 
                ss.staged_sale_id as id,
                ss.staged_date as timestamp,
                ss.total_amount,
                ('₱' || TO_CHAR(ss.total_amount, 'FM999,999,999.00')) as total_formatted,
                ss.status,
                ss.physical_receipt_no,
                (c.first_name || ' ' || COALESCE(c.last_name, '')) as customer_name,
                (e.first_name || ' ' || e.last_name) as cashier_name,
                pm.name as payment_method_name
            FROM staged_sale ss
            JOIN customer c ON ss.customer_id = c.customer_id
            JOIN employee e ON ss.employee_id = e.employee_id
            JOIN payment_methods pm ON ss.payment_method_id = pm.method_id
            WHERE ss.status = $1
            ORDER BY ss.staged_date DESC;
        `;
        const { rows } = await db.query(query, [status]);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching staged sales queue:', err.message);
        res.status(500).json({ message: 'Server error retrieving queue.' });
    }
});

// GET /sales/staging/:id - Inspect a single staged transaction
router.get('/sales/staging/:id', protect, async (req, res) => {
    const { id } = req.params;

    try {
        const detailQuery = `
            SELECT 
                ss.staged_sale_id as id,
                ss.staged_date as timestamp,
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
                (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS name
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
    const { physical_receipt_no, tendered_amount } = req.body; // accept optional edits from approval modal
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
        const amountPaid = parseFloat(total_amount) || 0;

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

        // Setup COD terms default
        const termsValidation = validatePaymentTerms({ terms: 'COD', invoice_date: new Date() });

        // Create actual invoice: Set both invoice_date, approved_at to CURRENT_TIMESTAMP, and submitted_at to original staging time
        const invoiceQuery = `
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, terms, payment_terms_days, due_date, physical_receipt_no, tax_calculation_version, invoice_date, submitted_at, approved_at, approved_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, $14, CURRENT_TIMESTAMP, $15)
            RETURNING invoice_id;
        `;
        const invoiceRes = await client.query(invoiceQuery, [
            invoice_number,
            staged.customer_id,
            staged.employee_id, // credit original checkout cashier
            total_amount,
            subtotal_ex_tax,
            tax_total,
            amountPaid, // fully paid
            'Paid',
            termsValidation.normalizedTerms,
            termsValidation.canonicalDays,
            termsValidation.dueDate,
            prn,
            taxCalculation.tax_calculation_version,
            staged.staged_date,
            reviewerId
        ]);

        const invoiceId = invoiceRes.rows[0].invoice_id;

        // Store tax breakdown
        await storeTaxBreakdown(invoiceId, taxCalculation.tax_breakdown, client);

        // Deduct inventory items and write StockOut transactions (proceeding regardless of stock availability)
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
        const methodQuery = await client.query('SELECT * FROM payment_methods WHERE method_id = $1', [staged.payment_method_id]);
        if (methodQuery.rows.length > 0) {
            const method = methodQuery.rows[0];
            const methodConfig = typeof method.config === 'string' ? JSON.parse(method.config) : method.config;
            const settlementType = methodConfig.settlement_type || (method.type === 'cash' ? 'instant' : 'delayed');
            const paymentStatus = settlementType === 'instant' ? 'settled' : 'pending';

            const finalTenderedAmt = tendered_amount !== undefined ? (tendered_amount !== null ? parseFloat(tendered_amount) : null) : (staged.tendered_amount ? parseFloat(staged.tendered_amount) : null);
            const changeAmt = finalTenderedAmt && finalTenderedAmt > parseFloat(total_amount)
                ? finalTenderedAmt - parseFloat(total_amount)
                : 0;

            await client.query(`
                INSERT INTO invoice_payments 
                (invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, metadata, created_by, payment_status, settled_at, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::varchar, CASE WHEN $9::varchar = 'settled' THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
            `, [
                invoiceId,
                staged.payment_method_id,
                total_amount,
                finalTenderedAmt,
                changeAmt,
                invoice_number,
                JSON.stringify({ source: 'pos_mobile_staged', staged_sale_id: id }),
                staged.employee_id,
                paymentStatus
            ]);
        }

        // Update staged sale status to APPROVED
        await client.query(`
            UPDATE staged_sale 
            SET status = 'APPROVED', approved_by = $2, approved_at = CURRENT_TIMESTAMP, physical_receipt_no = $3, tendered_amount = $4
            WHERE staged_sale_id = $1
        `, [id, reviewerId, prn, tendered_amount !== undefined ? tendered_amount : staged.tendered_amount]);

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
router.post('/sales/staging/:id/reject', protect, async (req, res) => {
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
