const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// POST /api/refunds - Process a new refund
router.post('/refunds', protect, hasPermission('invoicing:create'), async (req, res) => {
    const { invoice_id, invoice_number, employee_id, lines } = req.body;

    if (!invoice_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required fields for refund.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Validate all refund lines first (security layer) before creating any records
        for (const line of lines) {
            const { part_id, quantity } = line;

            const validationQuery = `
                SELECT
                    il.invoice_line_id,
                    il.quantity AS original_quantity,
                    COALESCE(rf.refunded_quantity, 0) AS refunded_quantity
                FROM invoice_line il
                LEFT JOIN (
                    SELECT cn.invoice_id, cnl.part_id, SUM(cnl.quantity) AS refunded_quantity
                    FROM credit_note_line cnl
                    JOIN credit_note cn ON cnl.cn_id = cn.cn_id
                    GROUP BY cn.invoice_id, cnl.part_id
                ) rf ON rf.invoice_id = il.invoice_id AND rf.part_id = il.part_id
                WHERE il.invoice_id = $1 AND il.part_id = $2
                LIMIT 1;
            `;
            const { rows: [lineData] } = await client.query(validationQuery, [invoice_id, part_id]);

            if (!lineData) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `Invoice line not found for invoice_id ${invoice_id} and part_id ${part_id}.` });
            }

            const availableToRefund = Number(lineData.original_quantity) - Number(lineData.refunded_quantity || 0);
            if (quantity > availableToRefund) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: `Refund failed for part_id ${part_id}: requested ${quantity}, available ${availableToRefund}.`
                });
            }
        }

        // All validations passed; create credit note and lines
        const creditNoteNumber = await getNextDocumentNumber(client, 'CN');
        const totalRefundAmount = lines.reduce((sum, line) => sum + (line.quantity * line.sale_price), 0);

        // Create the main credit note record
        const cnQuery = `
            INSERT INTO credit_note (cn_number, invoice_id, employee_id, total_amount, notes)
            VALUES ($1, $2, $3, $4, $5) RETURNING cn_id;
        `;
        const cnResult = await client.query(cnQuery, [creditNoteNumber, invoice_id, employee_id, totalRefundAmount, `Refund for Invoice #${invoice_number}`]);
        const newCnId = cnResult.rows[0].cn_id;

        // Insert lines and inventory transactions
        for (const line of lines) {
            const { part_id, quantity, sale_price } = line;

            await client.query(
                'INSERT INTO credit_note_line (cn_id, part_id, quantity, sale_price) VALUES ($1, $2, $3, $4)',
                [newCnId, part_id, quantity, sale_price]
            );

            const transactionQuery = `
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
                VALUES ($1, 'Refund', $2, $3, $4, $5, $6);
            `;
            await client.query(transactionQuery, [part_id, quantity, sale_price, creditNoteNumber, employee_id, `Refund for Invoice #${invoice_number}`]);
        }

        // 4. Update the original invoice status
        const { rows: [invoiceTotals] } = await client.query(
            `SELECT
                i.total_amount,
                COALESCE((SELECT SUM(total_amount) FROM credit_note WHERE invoice_id = i.invoice_id), 0) as total_refunded
             FROM invoice i WHERE i.invoice_id = $1`,
            [invoice_id]
        );

        let newStatus = 'Partially Refunded';
        if (parseFloat(invoiceTotals.total_refunded) >= parseFloat(invoiceTotals.total_amount)) {
            newStatus = 'Fully Refunded';
        }

        await client.query('UPDATE invoice SET status = $1 WHERE invoice_id = $2', [newStatus, invoice_id]);

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