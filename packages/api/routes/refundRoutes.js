const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// POST /api/refunds - Process a new refund
router.post('/refunds', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { invoice_id, employee_id, lines } = req.body;

    if (!invoice_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required fields for refund.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const creditNoteNumber = await getNextDocumentNumber(client, 'CN');

        for (const line of lines) {
            const { part_id, quantity, sale_price } = line;

            // Add stock back into inventory
            const transactionQuery = `
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
                VALUES ($1, 'Refund', $2, $3, $4, $5, $6);
            `;
            await client.query(transactionQuery, [part_id, quantity, sale_price, creditNoteNumber, employee_id, `Refund for Invoice #${req.body.invoice_number}`]);
        }
        
        // You would typically create a credit note record here and update the original invoice status.
        // For now, we are just handling the inventory return.

        await client.query('COMMIT');
        res.status(201).json({ message: 'Refund processed successfully', creditNoteNumber });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Refund Transaction Error:', err.message);
        res.status(500).json({ message: 'Server error during refund transaction.', error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;