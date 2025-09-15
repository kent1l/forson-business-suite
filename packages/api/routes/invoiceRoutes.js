const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');
const { protect, hasPermission, isAdmin } = require('../middleware/authMiddleware');
const { constructDisplayName } = require('../helpers/displayNameHelper'); // Import the helper
const router = express.Router();

// GET /invoices - Get all invoices with date filtering and optional search
router.get('/invoices', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { startDate, endDate, q } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    try {
        const params = [startDate, endDate];
        const whereClauses = [
            '(i.invoice_date AT TIME ZONE \'Asia/Manila\')::date BETWEEN $1 AND $2'
        ];

        // Optional q filter: match invoice number, physical receipt no, customer name, or line item display fields
        let searchParamIndex = null;
        if (typeof q === 'string' && q.trim().length > 0) {
            searchParamIndex = params.length + 1; // next $ index
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

        const query = `
            SELECT
                i.*,
                c.first_name as customer_first_name,
                c.last_name as customer_last_name,
                e.first_name as employee_first_name,
                e.last_name as employee_last_name,
                r.refunded_amount,
                GREATEST(i.total_amount - r.refunded_amount, 0) AS net_amount,
                GREATEST((i.total_amount - r.refunded_amount) - i.amount_paid, 0) AS balance_due
            FROM invoice i
            JOIN customer c ON i.customer_id = c.customer_id
            JOIN employee e ON i.employee_id = e.employee_id
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(cn.total_amount),0) AS refunded_amount
                FROM credit_note cn
                WHERE cn.invoice_id = i.invoice_id
            ) r ON TRUE
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY i.invoice_date DESC;
        `;
        const { rows } = await db.query(query, params);
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
                (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) as part_numbers
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
                (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) as part_numbers,
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
        let prn = formatPhysicalReceiptNumber(physical_receipt_no);
        
        // If a physical receipt number is provided, ensure it's unique
        if (prn) {
            let attempts = 0;
            let basePrn = prn;
            let isUnique = false;
            
            while (!isUnique && attempts < 10) {
                const existingQuery = `
                    SELECT invoice_id FROM invoice 
                    WHERE LOWER(physical_receipt_no) = LOWER($1) 
                    AND physical_receipt_no IS NOT NULL 
                    AND LENGTH(TRIM(physical_receipt_no)) > 0
                `;
                const { rows: existingRows } = await client.query(existingQuery, [prn]);
                
                if (existingRows.length === 0) {
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
    res.status(201).json({ 
        message: 'Invoice created successfully', 
        invoice_id: newInvoiceId, 
        invoice_number, 
        amount_paid: paid, 
        tendered_amount: tendered_amount || null, 
        payment_terms_days: canonicalDays, 
        due_date: dueDate,
        physical_receipt_no: prn // Return the potentially auto-incremented number
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
router.post('/invoices/:id/payments', async (req, res) => {
    const { id } = req.params;
    const { payments } = req.body;

    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Invalid invoice ID.' });
    }
    if (!Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({ message: 'Payments array required.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        for (const payment of payments) {
            const {
                method_id,
                amount_paid,
                tendered_amount,
                reference,
                metadata
            } = payment;

            // Insert payment into invoice_payments table
            await client.query(`
                INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, tendered_amount, reference, metadata)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [id, method_id, amount_paid, tendered_amount || null, reference || null, metadata ? JSON.stringify(metadata) : null]);
        }

        // Call function to update invoice balance and status
        await client.query(`
            UPDATE invoice 
            SET 
                amount_paid = (
                    SELECT COALESCE(SUM(ip.amount_paid), 0)
                    FROM invoice_payments ip
                    WHERE ip.invoice_id = $1
                ),
                status = CASE 
                    WHEN (
                        SELECT COALESCE(SUM(ip.amount_paid), 0)
                        FROM invoice_payments ip
                        WHERE ip.invoice_id = $1
                    ) >= total_amount THEN 'Paid'
                    WHEN (
                        SELECT COALESCE(SUM(ip.amount_paid), 0)
                        FROM invoice_payments ip
                        WHERE ip.invoice_id = $1
                    ) > 0 THEN 'Partially Paid'
                    ELSE 'Unpaid'
                END
            WHERE invoice_id = $1
        `, [id]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Payments added and invoice updated.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Split payment error:', err.message);
        res.status(500).json({ message: 'Server error processing payments.', error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
// DELETE /api/invoices/:id - Admin only hard delete with stock reversal
router.delete('/invoices/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Fetch invoice header & lines first
        const { rows: invoiceRows } = await client.query('SELECT invoice_number FROM invoice WHERE invoice_id = $1', [id]);
        if (invoiceRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Invoice not found' });
        }
        const invoiceNumber = invoiceRows[0].invoice_number;

        const { rows: lines } = await client.query(`
            SELECT il.invoice_line_id, il.part_id, il.quantity, il.cost_at_sale
            FROM invoice_line il
            WHERE il.invoice_id = $1
        `, [id]);

        // Reversal strategy: add back stock using StockIn so WAC recalculates using original cost_at_sale
        for (const line of lines) {
            // quantity on invoice is negative stock movement, so we add back positive quantity
            await client.query(`
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
                VALUES ($1, 'StockIn', $2, $3, $4, $5, $6);
            `, [line.part_id, line.quantity, line.cost_at_sale, invoiceNumber, req.user.employee_id || null, 'SYSTEM REVERSAL: Invoice deleted']);
        }

    // Delete allocations first (cascades would remove via invoice cascade but be explicit for clarity)
        await client.query('DELETE FROM invoice_payment_allocation WHERE invoice_id = $1', [id]);
    // Remove invoice-specific payments from invoice_payments table
    await client.query('DELETE FROM invoice_payments WHERE invoice_id = $1', [id]);
    // Also remove the auto-created payment that was generated when the invoice was posted (legacy single payments).
    // We key it by reference_number = invoice_number which is only used for this purpose.
    await client.query('DELETE FROM customer_payment WHERE reference_number = $1', [invoiceNumber]);
    // Delete credit notes referencing this invoice (ON DELETE RESTRICT in schema, so must remove manually)
        await client.query('DELETE FROM credit_note WHERE invoice_id = $1', [id]);
        // Delete invoice (cascade removes invoice_line)
        await client.query('DELETE FROM invoice WHERE invoice_id = $1', [id]);

        await client.query('COMMIT');
        res.json({ message: 'Invoice deleted and stock reversed.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete invoice error:', err.message);
        res.status(500).json({ message: 'Server error deleting invoice', error: err.message });
    } finally {
        client.release();
    }
});

// PUT /api/invoices/:id/physical-receipt-no - Update physical receipt number
router.put('/invoices/:id/physical-receipt-no', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { id } = req.params;
    const { physical_receipt_no } = req.body;

    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Invalid invoice ID.' });
    }

    try {
        // Normalize physical receipt number: trim and treat empty as null
        const prn = formatPhysicalReceiptNumber(physical_receipt_no);

        // Check if another invoice already has this physical receipt number (case-insensitive)
        if (prn) {
            const existingQuery = `
                SELECT invoice_id FROM invoice 
                WHERE LOWER(physical_receipt_no) = LOWER($1) 
                AND invoice_id != $2
                AND physical_receipt_no IS NOT NULL 
                AND LENGTH(TRIM(physical_receipt_no)) > 0
            `;
            const { rows: existingRows } = await db.query(existingQuery, [prn, id]);
            if (existingRows.length > 0) {
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