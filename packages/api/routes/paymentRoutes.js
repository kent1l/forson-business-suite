const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/customers/:id/unpaid-invoices - Get all unpaid or partially paid invoices for a customer
router.get('/customers/:id/unpaid-invoices', protect, hasPermission('ar:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                i.invoice_id, 
                i.invoice_number, 
                i.invoice_date, 
                i.total_amount,
                COALESCE(SUM(ipa.amount_allocated), 0) as amount_paid,
                (i.total_amount - COALESCE(SUM(ipa.amount_allocated), 0)) as balance_due
            FROM invoice i
            LEFT JOIN invoice_payment_allocation ipa ON i.invoice_id = ipa.invoice_id
            WHERE i.customer_id = $1 AND i.status IN ('Unpaid', 'Partially Paid')
            GROUP BY i.invoice_id
            HAVING (i.total_amount - COALESCE(SUM(ipa.amount_allocated), 0)) > 0
            ORDER BY i.invoice_date ASC;
        `;
        const { rows } = await db.query(query, [id]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// POST /api/payments - Receive a new customer payment and allocate it
router.post('/payments', protect, hasPermission('ar:receive_payment'), async (req, res) => {
    const { employee_id } = req.user;
    const { customer_id, amount, payment_method, reference_number, notes, allocations } = req.body;

    if (!customer_id || !amount || !allocations || !Array.isArray(allocations)) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Step 1: Create the payment record in the ledger
        const paymentQuery = `
            INSERT INTO customer_payment (customer_id, employee_id, amount, payment_method, reference_number, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING payment_id;
        `;
        const paymentResult = await client.query(paymentQuery, [customer_id, employee_id, amount, payment_method, reference_number, notes]);
        const newPaymentId = paymentResult.rows[0].payment_id;

        // Step 2: Create allocation records and update invoice statuses
        for (const alloc of allocations) {
            if (alloc.amount_allocated > 0) {
                const allocationQuery = `
                    INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated)
                    VALUES ($1, $2, $3);
                `;
                await client.query(allocationQuery, [alloc.invoice_id, newPaymentId, alloc.amount_allocated]);

                // Step 3: Recalculate total paid for the invoice and update its status
                const balanceQuery = `
                    SELECT
                        i.total_amount,
                        COALESCE(SUM(ipa.amount_allocated), 0) as total_paid
                    FROM invoice i
                    LEFT JOIN invoice_payment_allocation ipa ON i.invoice_id = ipa.invoice_id
                    WHERE i.invoice_id = $1
                    GROUP BY i.invoice_id;
                `;
                const balanceResult = await client.query(balanceQuery, [alloc.invoice_id]);
                const { total_amount, total_paid } = balanceResult.rows[0];

                let newStatus = 'Unpaid';
                if (parseFloat(total_paid) >= parseFloat(total_amount)) {
                    newStatus = 'Paid';
                } else if (parseFloat(total_paid) > 0) {
                    newStatus = 'Partially Paid';
                }

                await client.query('UPDATE invoice SET status = $1 WHERE invoice_id = $2', [newStatus, alloc.invoice_id]);
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Payment received successfully', payment_id: newPaymentId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction Error:', err.message);
        res.status(500).json({ message: 'Server error during transaction.', error: err.message });
    } finally {
        client.release();
    }
});


module.exports = router;
