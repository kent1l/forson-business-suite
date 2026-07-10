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
        let cnSubtotalExTax = 0;
        let cnTaxTotal = 0;
        const cnTaxBreakdown = new Map();
        const refundLinesWithTax = [];

        for (const line of lines) {
            const { part_id, quantity, sale_price } = line;

            const validationQuery = `
                SELECT
                    il.invoice_line_id,
                    il.quantity AS original_quantity,
                    il.tax_rate_id,
                    il.tax_rate_snapshot,
                    il.is_tax_inclusive,
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

            // Tax Calculation
            const taxRateSnapshot = Number(lineData.tax_rate_snapshot) || 0;
            const isTaxInclusive = lineData.is_tax_inclusive || false;
            const taxRateId = lineData.tax_rate_id;
            
            const lineTotal = quantity * sale_price;
            let taxBase, taxAmount;
            
            if (isTaxInclusive) {
                taxBase = lineTotal / (1 + taxRateSnapshot);
                taxAmount = lineTotal - taxBase;
                taxAmount = Math.round(taxAmount * 100) / 100;
                taxBase = lineTotal - taxAmount;
            } else {
                taxBase = lineTotal;
                taxAmount = lineTotal * taxRateSnapshot;
                taxAmount = Math.round(taxAmount * 100) / 100;
            }
            
            cnSubtotalExTax += taxBase;
            cnTaxTotal += taxAmount;
            
            refundLinesWithTax.push({
                part_id, quantity, sale_price,
                tax_rate_id: taxRateId,
                tax_rate_snapshot: taxRateSnapshot,
                tax_base: parseFloat(taxBase.toFixed(4)),
                tax_amount: taxAmount,
                is_tax_inclusive: isTaxInclusive
            });
            
            const key = taxRateId || 'default';
            const existing = cnTaxBreakdown.get(key) || {
                tax_rate_id: taxRateId,
                rate_percentage: taxRateSnapshot,
                tax_base: 0, tax_amount: 0, line_count: 0
            };
            existing.tax_base += taxBase;
            existing.tax_amount += taxAmount;
            existing.line_count += 1;
            cnTaxBreakdown.set(key, existing);
        }

        cnSubtotalExTax = Math.round(cnSubtotalExTax * 100) / 100;
        cnTaxTotal = Math.round(cnTaxTotal * 100) / 100;
        const cnTotalAmount = Math.round((cnSubtotalExTax + cnTaxTotal) * 100) / 100;

        // Fetch rate names for breakdown
        const rateIds = Array.from(cnTaxBreakdown.keys()).filter(id => id !== 'default');
        if (rateIds.length > 0) {
            const { rows: rateNames } = await client.query('SELECT tax_rate_id, rate_name FROM tax_rate WHERE tax_rate_id = ANY($1)', [rateIds]);
            const rateNamesMap = new Map(rateNames.map(r => [r.tax_rate_id, r.rate_name]));
            cnTaxBreakdown.forEach((breakdown, key) => {
                if (key !== 'default') {
                    breakdown.rate_name = rateNamesMap.get(breakdown.tax_rate_id) || 'Unknown';
                } else {
                    breakdown.rate_name = 'Default Rate';
                }
            });
        }

        // All validations passed; create credit note and lines
        const creditNoteNumber = await getNextDocumentNumber(client, 'CN');

        // Create the main credit note record
        const cnQuery = `
            INSERT INTO credit_note (cn_number, invoice_id, employee_id, total_amount, subtotal_ex_tax, tax_total, tax_calculation_version, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING cn_id;
        `;
        const cnResult = await client.query(cnQuery, [creditNoteNumber, invoice_id, employee_id, cnTotalAmount, cnSubtotalExTax, cnTaxTotal, 'v1.0', `Refund for Invoice #${invoice_number}`]);
        const newCnId = cnResult.rows[0].cn_id;

        // Insert tax breakdown
        for (const breakdown of cnTaxBreakdown.values()) {
            await client.query(`
                INSERT INTO credit_note_tax_breakdown (
                    cn_id, tax_rate_id, rate_name, rate_percentage, tax_base, tax_amount, line_count
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                newCnId, breakdown.tax_rate_id, breakdown.rate_name, breakdown.rate_percentage,
                Math.round(breakdown.tax_base * 100) / 100, breakdown.tax_amount, breakdown.line_count
            ]);
        }

        // Insert lines and inventory transactions
        for (const line of refundLinesWithTax) {
            await client.query(`
                INSERT INTO credit_note_line (cn_id, part_id, quantity, sale_price, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [newCnId, line.part_id, line.quantity, line.sale_price, line.tax_rate_id, line.tax_rate_snapshot, line.tax_base, line.tax_amount, line.is_tax_inclusive]);

            const transactionQuery = `
                INSERT INTO inventory_transaction (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
                VALUES ($1, 'Refund', $2, $3, $4, $5, $6);
            `;
            await client.query(transactionQuery, [line.part_id, line.quantity, line.sale_price, creditNoteNumber, employee_id, `Refund for Invoice #${invoice_number}`]);
        }

        // 4. Update the original invoice status is handled automatically by the update_invoice_balance_after_payment trigger on credit_note table

        await client.query('COMMIT');
        res.status(201).json({ message: 'Refund processed successfully', creditNoteNumber, total_refunded: cnTotalAmount });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Refund Transaction Error:', err.message);
        res.status(500).json({ message: 'Server error during refund transaction.', error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;