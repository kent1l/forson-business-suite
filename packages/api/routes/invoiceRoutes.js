const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { constructDisplayName } = require('../helpers/displayNameHelper'); // Import the helper
const router = express.Router();

// GET /invoices - Get all invoices with date filtering
router.get('/invoices', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    try {
        const query = `
            SELECT
                i.*,
                c.first_name as customer_first_name,
                c.last_name as customer_last_name,
                e.first_name as employee_first_name,
                e.last_name as employee_last_name
            FROM invoice i
            JOIN customer c ON i.customer_id = c.customer_id
            JOIN employee e ON i.employee_id = e.employee_id
            WHERE i.invoice_date::date BETWEEN $1 AND $2
            ORDER BY i.invoice_date DESC;
        `;
        const { rows } = await db.query(query, [startDate, endDate]);
        res.json(rows);
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
                (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id) as part_numbers
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE il.invoice_id = $1
            ORDER BY p.detail;
        `;
        const { rows } = await db.query(query, [id]);
        // Construct display_name for each line
        const linesWithDisplayName = rows.map(line => ({
            ...line,
            display_name: constructDisplayName(line)
        }));
        res.json(linesWithDisplayName);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/invoices/:id/lines-with-refunds - Get line items with refund data for a specific invoice
router.get('/invoices/:id/lines-with-refunds', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { id } = req.params;
    try {
        // Use a subquery to sum refunded quantities per invoice and part to avoid GROUP BY on il.*
        const query = `
            SELECT
                il.*,
                p.detail,
                b.brand_name,
                g.group_name,
                (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id) as part_numbers,
                COALESCE(rf.quantity_refunded, 0) AS quantity_refunded
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            LEFT JOIN (
                SELECT cnl.part_id, cn.invoice_id, SUM(cnl.quantity) AS quantity_refunded
                FROM credit_note_line cnl
                JOIN credit_note cn ON cnl.cn_id = cn.cn_id
                GROUP BY cn.invoice_id, cnl.part_id
            ) rf ON rf.part_id = il.part_id AND rf.invoice_id = il.invoice_id
            WHERE il.invoice_id = $1
            ORDER BY p.detail;
        `;
        const { rows } = await db.query(query, [id]);
        // Construct display_name for each line
        const linesWithDisplayName = rows.map(line => ({
            ...line,
            display_name: constructDisplayName(line)
        }));
        res.json(linesWithDisplayName);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /invoices - Create a new invoice
router.post('/invoices', async (req, res) => {
    const { customer_id, employee_id, lines, amount_paid, tendered_amount, payment_method, terms, payment_terms_days, physical_receipt_no } = req.body;

    if (!customer_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const invoice_number = await getNextDocumentNumber(client, 'INV');

        // Calculate total amount from lines (safely parse numeric fields)
        const total_amount = lines.reduce((sum, line) => {
            const qty = Number(line.quantity) || 0;
            const sale = Number(line.sale_price) || 0;
            const discount = Number(line.discount_amount) || 0;
            return sum + (qty * sale) - discount;
        }, 0);

        // Securely parse amount_paid provided by client; default to 0
        const paid = parseFloat(String(amount_paid || '').replace(/[^0-9.-]+/g, '')) || 0;

        // Determine invoice status based on paid vs total_amount
        let status = 'Unpaid';
        if (paid >= total_amount && total_amount > 0) {
            status = 'Paid';
        } else if (paid > 0 && paid < total_amount) {
            status = 'Partially Paid';
        }

        // Determine canonical payment_terms_days: prefer explicit field, else try to parse from terms (e.g., "Net 30")
        let canonicalDays = null;
        if (typeof payment_terms_days === 'number' && !Number.isNaN(payment_terms_days)) {
            canonicalDays = payment_terms_days;
        } else if (terms) {
            const m = String(terms).match(/(\d{1,4})/);
            if (m) canonicalDays = parseInt(m[1], 10);
        }

        // Compute due_date based on canonicalDays if present
        let dueDate = null;
        if (canonicalDays && Number.isInteger(canonicalDays)) {
            // use current timestamp as invoice_date basis
            const now = new Date();
            const due = new Date(now.getTime() + canonicalDays * 24 * 60 * 60 * 1000);
            dueDate = due.toISOString(); // will be sent to pg as timestamptz
        }

        // Normalize physical receipt number: trim and treat empty as null
        let prn = null;
        if (typeof physical_receipt_no === 'string') {
            const t = physical_receipt_no.trim();
            prn = t.length > 0 ? t : null;
        }

        const invoiceQuery = `
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, amount_paid, status, terms, payment_terms_days, due_date, physical_receipt_no)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING invoice_id;
        `;
    // Debug: log computed financials to aid troubleshooting
    console.log(`Creating invoice ${invoice_number} - total_amount=${total_amount}, amount_paid=${paid}, status=${status}, payment_terms_days=${canonicalDays}, due_date=${dueDate}`);

    // Store numeric paid amount and computed status
    const invoiceResult = await client.query(invoiceQuery, [invoice_number, customer_id, employee_id, total_amount, paid, status, terms, canonicalDays, dueDate, prn]);
        const newInvoiceId = invoiceResult.rows[0].invoice_id;

        for (const line of lines) {
            const { part_id, quantity, sale_price, discount_amount } = line;

            const costResult = await client.query('SELECT wac_cost FROM part WHERE part_id = $1', [part_id]);
            const cost_at_sale = costResult.rows.length > 0 ? costResult.rows[0].wac_cost : 0;

            const lineQuery = `
                INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount)
                VALUES ($1, $2, $3, $4, $5, $6);
            `;
            await client.query(lineQuery, [newInvoiceId, part_id, quantity, sale_price, cost_at_sale, discount_amount]);

            const transactionQuery = `
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id)
                VALUES ($1, 'StockOut', $2, $3, $4, $5);
            `;
            await client.query(transactionQuery, [part_id, -quantity, cost_at_sale, invoice_number, employee_id]);
        }

        if (paid > 0) {
            const paymentQuery = `
                INSERT INTO customer_payment (customer_id, employee_id, amount, tendered_amount, payment_method, reference_number)
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING payment_id;
            `;
            const paymentMethodToUse = payment_method || 'Cash';
            // store tendered_amount if provided; default to NULL
            const tenderVal = typeof tendered_amount !== 'undefined' && tendered_amount !== null ? tendered_amount : null;
            const paymentResult = await client.query(paymentQuery, [customer_id, employee_id, paid, tenderVal, paymentMethodToUse, invoice_number]);
            const newPaymentId = paymentResult.rows[0].payment_id;

            const allocationQuery = `
                INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated)
                VALUES ($1, $2, $3);
            `;
            await client.query(allocationQuery, [newInvoiceId, newPaymentId, paid]);
        }


        await client.query('COMMIT');
    res.status(201).json({ message: 'Invoice created successfully', invoice_id: newInvoiceId, invoice_number, amount_paid: paid, tendered_amount: tendered_amount || null, payment_terms_days: canonicalDays, due_date: dueDate });

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

module.exports = router;