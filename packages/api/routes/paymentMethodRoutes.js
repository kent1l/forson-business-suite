const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/payment-methods - Get all payment methods (ordered by sort_order)
router.get('/payment-methods', protect, async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT 
                method_id, code, name, type, enabled, sort_order, config,
                created_at, created_by, updated_at, updated_by
            FROM payment_methods 
            ORDER BY sort_order ASC, name ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching payment methods:', err.message);
        res.status(500).json({ message: 'Server error fetching payment methods.' });
    }
});

// GET /api/payment-methods/enabled - Get only enabled payment methods
router.get('/payment-methods/enabled', protect, async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT 
                method_id, code, name, type, enabled, sort_order, config
            FROM payment_methods 
            WHERE enabled = true
            ORDER BY sort_order ASC, name ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching enabled payment methods:', err.message);
        res.status(500).json({ message: 'Server error fetching payment methods.' });
    }
});

// POST /api/payment-methods - Create a new payment method
router.post('/payment-methods', protect, hasPermission('settings:manage'), async (req, res) => {
    const { code, name, type, enabled = true, sort_order = 0, config = {} } = req.body;
    const { employee_id } = req.user;

    if (!code || !name || !type) {
        return res.status(400).json({ message: 'Code, name, and type are required.' });
    }

    // Validate type
    const validTypes = ['cash', 'card', 'bank', 'mobile', 'credit', 'voucher', 'other'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ message: 'Invalid payment method type.' });
    }

    // Validate config structure
    const defaultConfig = {
        requires_reference: false,
        reference_label: '',
        requires_receipt_no: false,
        change_allowed: type === 'cash',
        settlement_type: type === 'cash' ? 'instant' : 'delayed',
        max_split_count: null
    };

    const finalConfig = { ...defaultConfig, ...config };

    try {
        const { rows } = await db.query(`
            INSERT INTO payment_methods (code, name, type, enabled, sort_order, config, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
            RETURNING method_id, code, name, type, enabled, sort_order, config, created_at
        `, [code, name, type, enabled, sort_order, JSON.stringify(finalConfig), employee_id]);

        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') { // unique violation
            return res.status(409).json({ message: 'Payment method code already exists.' });
        }
        console.error('Error creating payment method:', err.message);
        res.status(500).json({ message: 'Server error creating payment method.' });
    }
});

// PUT /api/payment-methods/:id - Update a payment method
router.put('/payment-methods/:id', protect, hasPermission('settings:manage'), async (req, res) => {
    const { id } = req.params;
    const { code, name, type, enabled, sort_order, config } = req.body;
    const { employee_id } = req.user;

    if (!code || !name || !type) {
        return res.status(400).json({ message: 'Code, name, and type are required.' });
    }

    // Validate type
    const validTypes = ['cash', 'card', 'bank', 'mobile', 'credit', 'voucher', 'other'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ message: 'Invalid payment method type.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Check if method exists
        const existingMethod = await client.query(
            'SELECT method_id, enabled FROM payment_methods WHERE method_id = $1',
            [id]
        );

        if (existingMethod.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Payment method not found.' });
        }

        // Prevent disabling the last cash-equivalent method
        if (enabled === false && type === 'cash') {
            const cashMethodsCount = await client.query(
                'SELECT COUNT(*) as count FROM payment_methods WHERE type = $1 AND enabled = true AND method_id != $2',
                ['cash', id]
            );

            if (parseInt(cashMethodsCount.rows[0].count) === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Cannot disable the last cash payment method.' });
            }
        }

        // Update the method
        const { rows } = await client.query(`
            UPDATE payment_methods 
            SET code = $1, name = $2, type = $3, enabled = $4, sort_order = $5, 
                config = $6, updated_at = CURRENT_TIMESTAMP, updated_by = $7
            WHERE method_id = $8
            RETURNING method_id, code, name, type, enabled, sort_order, config, updated_at
        `, [code, name, type, enabled, sort_order, JSON.stringify(config), employee_id, id]);

        await client.query('COMMIT');
        res.json(rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') { // unique violation
            return res.status(409).json({ message: 'Payment method code already exists.' });
        }
        console.error('Error updating payment method:', err.message);
        res.status(500).json({ message: 'Server error updating payment method.' });
    } finally {
        client.release();
    }
});

// PATCH /api/payment-methods/reorder - Reorder payment methods
router.patch('/payment-methods/reorder', protect, hasPermission('settings:manage'), async (req, res) => {
    const { methods } = req.body; // Array of { method_id, sort_order }
    const { employee_id } = req.user;

    if (!Array.isArray(methods)) {
        return res.status(400).json({ message: 'Methods array is required.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Update all sort orders
        for (const method of methods) {
            await client.query(
                'UPDATE payment_methods SET sort_order = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE method_id = $3',
                [method.sort_order, employee_id, method.method_id]
            );
        }

        await client.query('COMMIT');
        res.json({ message: 'Payment methods reordered successfully.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error reordering payment methods:', err.message);
        res.status(500).json({ message: 'Server error reordering payment methods.' });
    } finally {
        client.release();
    }
});

// DELETE /api/payment-methods/:id - Delete/disable a payment method
router.delete('/payment-methods/:id', protect, hasPermission('settings:manage'), async (req, res) => {
    const { id } = req.params;
    const { force = false } = req.query; // Add force parameter for hard delete

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Check if method exists and get its type
        const method = await client.query(
            'SELECT method_id, type, enabled FROM payment_methods WHERE method_id = $1',
            [id]
        );

        if (method.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Payment method not found.' });
        }

        const methodType = method.rows[0].type;

        // Check if method is being used in payments
        const usageCheck = await client.query(`
            SELECT COUNT(*) as count FROM (
                SELECT 1 FROM customer_payment WHERE method_id = $1
                UNION ALL
                SELECT 1 FROM invoice_payments WHERE method_id = $1
            ) combined
        `, [id]);

        const isInUse = parseInt(usageCheck.rows[0].count) > 0;

        if (isInUse && !force) {
            // Soft delete - just disable
            await client.query(
                'UPDATE payment_methods SET enabled = false, updated_at = CURRENT_TIMESTAMP WHERE method_id = $1',
                [id]
            );
            await client.query('COMMIT');
            return res.json({ message: 'Payment method disabled (in use).', disabled: true });
        }

        // Prevent deleting the last cash method
        if (methodType === 'cash') {
            const cashMethodsCount = await client.query(
                'SELECT COUNT(*) as count FROM payment_methods WHERE type = $1 AND enabled = true AND method_id != $2',
                ['cash', id]
            );

            if (parseInt(cashMethodsCount.rows[0].count) === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Cannot delete the last cash payment method.' });
            }
        }

        // Hard delete if not in use or force is true
        await client.query('DELETE FROM payment_methods WHERE method_id = $1', [id]);
        await client.query('COMMIT');
        res.json({ message: 'Payment method deleted successfully.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting payment method:', err.message);
        res.status(500).json({ message: 'Server error deleting payment method.' });
    } finally {
        client.release();
    }
});

// POST /api/invoices/:id/payments - Add payments to an invoice (split payment support)
router.post('/invoices/:id/payments', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { id: invoice_id } = req.params;
    const { payments, physical_receipt_no } = req.body;
    const { employee_id } = req.user;

    if (!Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({ message: 'Payments array is required.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Validate invoice exists and get total
        const invoice = await client.query(
            'SELECT invoice_id, total_amount, customer_id FROM invoice WHERE invoice_id = $1',
            [invoice_id]
        );

        if (invoice.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Invoice not found.' });
        }

        const invoiceTotal = parseFloat(invoice.rows[0].total_amount);

        // Validate total payments don't exceed invoice total (allowing for reasonable rounding)
        const totalPayments = payments.reduce((sum, p) => sum + parseFloat(p.amount_paid), 0);
        
        if (totalPayments > invoiceTotal + 0.01) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Total payments exceed invoice amount.' });
        }

        // Validate each payment and insert
        const insertedPayments = [];
        for (const payment of payments) {
            const { method_id, amount_paid, tendered_amount, reference, metadata = {} } = payment;

            // Get method configuration for validation
            const method = await client.query(
                'SELECT * FROM payment_methods WHERE method_id = $1 AND enabled = true',
                [method_id]
            );

            if (method.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `Invalid payment method: ${method_id}` });
            }

            const methodConfig = method.rows[0].config;

            // Validate required reference
            if (methodConfig.requires_reference && (!reference || reference.trim() === '')) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    message: `Reference is required for ${method.rows[0].name}` 
                });
            }

            // Validate physical receipt requirement
            if (methodConfig.requires_receipt_no && (!physical_receipt_no || physical_receipt_no.trim() === '')) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    message: `Physical receipt number is required for ${method.rows[0].name}` 
                });
            }

            // Calculate change
            const tenderedAmt = tendered_amount ? parseFloat(tendered_amount) : null;
            const paidAmt = parseFloat(amount_paid);
            const changeAmt = tenderedAmt && tenderedAmt > paidAmt ? tenderedAmt - paidAmt : 0;

            // Validate change allowance
            if (changeAmt > 0 && !methodConfig.change_allowed) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    message: `Change is not allowed for ${method.rows[0].name}` 
                });
            }

            // Insert payment
            const paymentResult = await client.query(`
                INSERT INTO invoice_payments 
                (invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, metadata, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [invoice_id, method_id, paidAmt, tenderedAmt, changeAmt, reference, JSON.stringify(metadata), employee_id]);

            insertedPayments.push(paymentResult.rows[0]);
        }

        // Update physical receipt number if provided
        if (physical_receipt_no && physical_receipt_no.trim()) {
            await client.query(
                'UPDATE invoice SET physical_receipt_no = $1 WHERE invoice_id = $2',
                [physical_receipt_no.trim(), invoice_id]
            );
        }

        // Get updated invoice with totals (triggers will have updated balance)
        const updatedInvoice = await client.query(
            'SELECT * FROM invoice WHERE invoice_id = $1',
            [invoice_id]
        );

        await client.query('COMMIT');

        res.status(201).json({
            payments: insertedPayments,
            invoice: updatedInvoice.rows[0],
            total_payments: totalPayments
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error adding payments to invoice:', err.message);
        res.status(500).json({ message: 'Server error processing payments.' });
    } finally {
        client.release();
    }
});

// GET /api/invoices/:id/payments - Get payments for an invoice
router.get('/invoices/:id/payments', protect, hasPermission('invoicing:view'), async (req, res) => {
    const { id: invoice_id } = req.params;

    try {
        const { rows } = await db.query(`
            SELECT 
                ip.payment_id, ip.invoice_id, ip.amount_paid, ip.tendered_amount, 
                ip.change_amount, ip.reference, ip.metadata, ip.created_at,
                pm.method_id, pm.code as method_code, pm.name as method_name, 
                pm.type as method_type, pm.config as method_config,
                e.first_name, e.last_name
            FROM invoice_payments ip
            JOIN payment_methods pm ON ip.method_id = pm.method_id
            LEFT JOIN employee e ON ip.created_by = e.employee_id
            WHERE ip.invoice_id = $1
            ORDER BY ip.created_at ASC
        `, [invoice_id]);

        res.json(rows);
    } catch (err) {
        console.error('Error fetching invoice payments:', err.message);
        res.status(500).json({ message: 'Server error fetching payments.' });
    }
});

module.exports = router;
