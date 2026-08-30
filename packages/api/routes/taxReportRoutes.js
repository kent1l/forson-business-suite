const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/tax-reports/summary - Get tax summary for a date range
router.get('/tax-reports/summary', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate, groupBy = 'day' } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    try {
        let groupUnit;
        let dateFormat;

        switch (groupBy) {
            case 'month':
                groupUnit = 'month';
                dateFormat = 'YYYY-MM';
                break;
            case 'week':
                groupUnit = 'week';
                dateFormat = 'YYYY-"W"WW';
                break;
            case 'day':
            default:
                groupUnit = 'day';
                dateFormat = 'YYYY-MM-DD';
                break;
        }

        /*
         * Sales are counted in the period they were invoiced; refunds in the
         * period the credit note was issued. They are aggregated separately and
         * joined on the period rather than netted per invoice, because a refund
         * often belongs to a different period than the sale it reverses.
         *
         * Netting per invoice (what this did before) put the reversal back into
         * the sale's period, so a refund raised today silently rewrote the VAT
         * figures of a period that had already been filed. Bounding that netting
         * by refund_date alone would have been worse still: the refund would
         * belong to neither period, because a report keyed on invoices has no
         * row for an invoice issued outside the window.
         *
         * This matches how the dashboard in reportingRoutes.js has always
         * counted refund VAT, so the two now agree.
         */
        const query = `
            WITH sales AS (
                SELECT
                    date_trunc('${groupUnit}', i.invoice_date) AS period,
                    i.invoice_id,
                    COALESCE(i.subtotal_ex_tax, 0) AS subtotal,
                    COALESCE(i.tax_total, 0) AS tax,
                    COALESCE(i.total_amount, 0) AS total
                FROM invoice i
                WHERE i.status != 'Cancelled'
                  AND i.invoice_date >= $1 AND i.invoice_date <= $2
            ),
            refunds AS (
                SELECT
                    date_trunc('${groupUnit}', cn.refund_date) AS period,
                    cn.cn_id,
                    COALESCE(cn.subtotal_ex_tax, 0) AS subtotal,
                    COALESCE(cn.tax_total, 0) AS tax,
                    COALESCE(cn.total_amount, 0) AS total
                FROM credit_note cn
                WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
            ),
            periods AS (
                SELECT period FROM sales
                UNION
                SELECT period FROM refunds
            ),
            sales_agg AS (
                SELECT period,
                       COUNT(DISTINCT invoice_id) AS invoice_count,
                       SUM(subtotal) AS subtotal,
                       SUM(tax) AS tax,
                       SUM(total) AS total,
                       AVG(tax) AS avg_tax_per_invoice
                FROM sales GROUP BY period
            ),
            refund_agg AS (
                SELECT period,
                       COUNT(DISTINCT cn_id) AS credit_note_count,
                       SUM(subtotal) AS subtotal,
                       SUM(tax) AS tax,
                       SUM(total) AS total
                FROM refunds GROUP BY period
            ),
            rate_movements AS (
                SELECT
                    date_trunc('${groupUnit}', i.invoice_date) AS period,
                    itb.rate_name,
                    itb.rate_percentage,
                    itb.tax_base AS tax_base,
                    itb.tax_amount AS tax_amount,
                    itb.invoice_id
                FROM invoice_tax_breakdown itb
                JOIN invoice i ON i.invoice_id = itb.invoice_id
                WHERE i.status != 'Cancelled'
                  AND i.invoice_date >= $1 AND i.invoice_date <= $2
                UNION ALL
                SELECT
                    date_trunc('${groupUnit}', cn.refund_date) AS period,
                    cntb.rate_name,
                    cntb.rate_percentage,
                    -cntb.tax_base,
                    -cntb.tax_amount,
                    cn.invoice_id
                FROM credit_note_tax_breakdown cntb
                JOIN credit_note cn ON cn.cn_id = cntb.cn_id
                WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
            ),
            rate_agg AS (
                SELECT period, rate_name, rate_percentage,
                       SUM(tax_base) AS tax_base,
                       SUM(tax_amount) AS tax_amount,
                       COUNT(DISTINCT invoice_id) AS invoice_count
                FROM rate_movements
                GROUP BY period, rate_name, rate_percentage
            )
            SELECT
                p.period,
                to_char(p.period, '${dateFormat}') AS period_label,
                COALESCE(s.invoice_count, 0) AS invoice_count,
                COALESCE(r.credit_note_count, 0) AS credit_note_count,
                COALESCE(s.subtotal, 0) AS gross_subtotal,
                COALESCE(s.tax, 0) AS gross_tax,
                COALESCE(s.total, 0) AS gross_total,
                COALESCE(r.subtotal, 0) AS refunded_subtotal,
                COALESCE(r.tax, 0) AS refunded_tax,
                COALESCE(r.total, 0) AS refunded_total,
                COALESCE(s.subtotal, 0) - COALESCE(r.subtotal, 0) AS total_subtotal,
                COALESCE(s.tax, 0) - COALESCE(r.tax, 0) AS total_tax,
                COALESCE(s.total, 0) - COALESCE(r.total, 0) AS total_amount,
                COALESCE(s.avg_tax_per_invoice, 0) AS avg_tax_per_invoice,
                (
                    SELECT json_agg(
                        json_build_object(
                            'rate_name', ra.rate_name,
                            'rate_percentage', ra.rate_percentage,
                            'tax_base', ra.tax_base,
                            'tax_amount', ra.tax_amount,
                            'invoice_count', ra.invoice_count
                        )
                    )
                    FROM rate_agg ra
                    WHERE ra.period = p.period
                ) as tax_breakdown_by_rate
            FROM periods p
            LEFT JOIN sales_agg s ON s.period = p.period
            LEFT JOIN refund_agg r ON r.period = p.period
            ORDER BY p.period DESC
        `;

        const { rows } = await db.query(query, [startDate, endDate]);

        // Process and aggregate tax breakdown data
        const processedRows = rows.map(row => ({
            ...row,
            gross_subtotal: parseFloat(row.gross_subtotal || 0),
            gross_tax: parseFloat(row.gross_tax || 0),
            gross_total: parseFloat(row.gross_total || 0),
            refunded_subtotal: parseFloat(row.refunded_subtotal || 0),
            refunded_tax: parseFloat(row.refunded_tax || 0),
            refunded_total: parseFloat(row.refunded_total || 0),
            total_subtotal: parseFloat(row.total_subtotal || 0),
            total_tax: parseFloat(row.total_tax || 0),
            total_amount: parseFloat(row.total_amount || 0),
            avg_tax_per_invoice: parseFloat(row.avg_tax_per_invoice || 0),
            tax_breakdown_by_rate: row.tax_breakdown_by_rate ? 
                row.tax_breakdown_by_rate
                    .filter(breakdown => breakdown.rate_name !== null)
                    .map(breakdown => ({
                        ...breakdown,
                        tax_base: parseFloat(breakdown.tax_base || 0),
                        tax_amount: parseFloat(breakdown.tax_amount || 0)
                    })) : []
        }));

        // Calculate overall totals
        const sumOf = (key) => processedRows.reduce((sum, row) => sum + row[key], 0);
        const totals = {
            total_invoices: processedRows.reduce((sum, row) => sum + parseInt(row.invoice_count), 0),
            total_credit_notes: processedRows.reduce((sum, row) => sum + parseInt(row.credit_note_count), 0),
            gross_subtotal: sumOf('gross_subtotal'),
            gross_tax: sumOf('gross_tax'),
            gross_total: sumOf('gross_total'),
            refunded_subtotal: sumOf('refunded_subtotal'),
            refunded_tax: sumOf('refunded_tax'),
            refunded_total: sumOf('refunded_total'),
            total_subtotal: sumOf('total_subtotal'),
            total_tax: sumOf('total_tax'),
            total_amount: sumOf('total_amount')
        };

        res.json({
            summary: processedRows,
            totals,
            period: { startDate, endDate, groupBy },
            generated_at: new Date().toISOString()
        });

    } catch (err) {
        console.error('Tax summary report error:', err.message);
        res.status(500).json({ message: 'Server error generating tax report.', error: err.message });
    }
});

/*
 * GET /api/tax-reports/detailed - per-invoice tax listing for a period.
 *
 * Rows are invoices issued in the period, shown net of refunds issued in that
 * same period. A refund raised in a later period against one of these invoices
 * is deliberately not subtracted here: doing so would change the figures of a
 * period that may already have been filed. That refund is reported in its own
 * period by /tax-reports/summary, which counts sales and refunds separately.
 * Use /summary for period VAT totals; this endpoint is the invoice-level
 * supporting detail.
 */
router.get('/tax-reports/detailed', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate, taxRateId, limit = 100, offset = 0 } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    try {
        let whereClause = `
            WHERE i.invoice_date >= $1 
            AND i.invoice_date <= $2
            AND i.status != 'Cancelled'
        `;
        let params = [startDate, endDate];

        if (taxRateId) {
            whereClause += ` AND itb.tax_rate_id = $3`;
            params.push(taxRateId);
        }

        const query = `
            WITH invoice_net AS (
                SELECT 
                    i.invoice_id, 
                    COALESCE(i.subtotal_ex_tax, 0) - COALESCE(cn_totals.refunded_subtotal, 0) AS subtotal_ex_tax,
                    COALESCE(i.tax_total, 0) - COALESCE(cn_totals.refunded_tax, 0) AS tax_total,
                    COALESCE(i.total_amount, 0) - COALESCE(cn_totals.refunded_total, 0) AS total_amount
                FROM invoice i
                LEFT JOIN (
                    SELECT cn.invoice_id,
                           SUM(cn.subtotal_ex_tax) as refunded_subtotal,
                           SUM(cn.tax_total) as refunded_tax,
                           SUM(cn.total_amount) as refunded_total
                    FROM credit_note cn
                    WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
                    GROUP BY cn.invoice_id
                ) cn_totals ON i.invoice_id = cn_totals.invoice_id
                WHERE i.status != 'Cancelled'
            ),
            breakdown_net AS (
                SELECT 
                    itb.invoice_id, 
                    itb.tax_rate_id, 
                    itb.rate_name, 
                    itb.rate_percentage,
                    itb.tax_base - COALESCE(cn_bk.refunded_base, 0) AS tax_base,
                    itb.tax_amount - COALESCE(cn_bk.refunded_amount, 0) AS tax_amount
                FROM invoice_tax_breakdown itb
                LEFT JOIN (
                    SELECT cn.invoice_id, cntb.tax_rate_id,
                           SUM(cntb.tax_base) as refunded_base,
                           SUM(cntb.tax_amount) as refunded_amount
                    FROM credit_note cn
                    JOIN credit_note_tax_breakdown cntb ON cn.cn_id = cntb.cn_id
                    WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
                    GROUP BY cn.invoice_id, cntb.tax_rate_id
                ) cn_bk ON itb.invoice_id = cn_bk.invoice_id AND itb.tax_rate_id = cn_bk.tax_rate_id
            )
            SELECT 
                i.invoice_id,
                i.invoice_number,
                i.invoice_date,
                inet.subtotal_ex_tax,
                inet.tax_total,
                inet.total_amount,
                i.tax_calculation_version,
                c.first_name || ' ' || c.last_name as customer_name,
                e.first_name || ' ' || e.last_name as employee_name,
                (
                    SELECT json_agg(
                        json_build_object(
                            'tax_rate_id', bn.tax_rate_id,
                            'rate_name', bn.rate_name,
                            'rate_percentage', bn.rate_percentage,
                            'tax_base', bn.tax_base,
                            'tax_amount', bn.tax_amount
                        )
                    )
                    FROM breakdown_net bn
                    WHERE bn.invoice_id = i.invoice_id
                ) as tax_breakdown
            FROM invoice i
            JOIN invoice_net inet ON i.invoice_id = inet.invoice_id
            JOIN customer c ON i.customer_id = c.customer_id
            JOIN employee e ON i.employee_id = e.employee_id
            ${whereClause}
            ORDER BY i.invoice_date DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        params.push(limit, offset);

        const { rows } = await db.query(query, params);

        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(DISTINCT i.invoice_id) as total_count
            FROM invoice i
            ${whereClause.includes('itb.tax_rate_id') ? 'JOIN invoice_tax_breakdown itb ON i.invoice_id = itb.invoice_id' : ''}
            ${whereClause}
        `;

        const { rows: countRows } = await db.query(countQuery, params.slice(0, -2));
        const totalCount = parseInt(countRows[0].total_count);

        const processedRows = rows.map(row => ({
            ...row,
            subtotal_ex_tax: parseFloat(row.subtotal_ex_tax || 0),
            tax_total: parseFloat(row.tax_total || 0),
            total_amount: parseFloat(row.total_amount || 0),
            tax_breakdown: row.tax_breakdown ? 
                row.tax_breakdown
                    .filter(breakdown => breakdown.tax_rate_id !== null)
                    .map(breakdown => ({
                        ...breakdown,
                        tax_base: parseFloat(breakdown.tax_base || 0),
                        tax_amount: parseFloat(breakdown.tax_amount || 0)
                    })) : []
        }));

        res.json({
            invoices: processedRows,
            pagination: {
                total_count: totalCount,
                limit: parseInt(limit),
                offset: parseInt(offset),
                has_more: (parseInt(offset) + parseInt(limit)) < totalCount
            },
            filters: { startDate, endDate, taxRateId },
            generated_at: new Date().toISOString()
        });

    } catch (err) {
        console.error('Detailed tax report error:', err.message);
        res.status(500).json({ message: 'Server error generating detailed tax report.', error: err.message });
    }
});

// GET /api/tax-reports/export - CSV of the per-invoice listing.
// Same period basis as /tax-reports/detailed above; see the note there.
router.get('/tax-reports/export', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate, format = 'csv' } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    try {
        const query = `
            WITH invoice_net AS (
                SELECT 
                    i.invoice_id, 
                    COALESCE(i.subtotal_ex_tax, 0) - COALESCE(cn_totals.refunded_subtotal, 0) AS subtotal_ex_tax,
                    COALESCE(i.tax_total, 0) - COALESCE(cn_totals.refunded_tax, 0) AS tax_total,
                    COALESCE(i.total_amount, 0) - COALESCE(cn_totals.refunded_total, 0) AS total_amount
                FROM invoice i
                LEFT JOIN (
                    SELECT cn.invoice_id,
                           SUM(cn.subtotal_ex_tax) as refunded_subtotal,
                           SUM(cn.tax_total) as refunded_tax,
                           SUM(cn.total_amount) as refunded_total
                    FROM credit_note cn
                    WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
                    GROUP BY cn.invoice_id
                ) cn_totals ON i.invoice_id = cn_totals.invoice_id
                WHERE i.status != 'Cancelled'
            ),
            breakdown_net AS (
                SELECT 
                    itb.invoice_id, 
                    itb.tax_rate_id, 
                    itb.rate_name, 
                    itb.rate_percentage,
                    itb.tax_base - COALESCE(cn_bk.refunded_base, 0) AS tax_base,
                    itb.tax_amount - COALESCE(cn_bk.refunded_amount, 0) AS tax_amount
                FROM invoice_tax_breakdown itb
                LEFT JOIN (
                    SELECT cn.invoice_id, cntb.tax_rate_id,
                           SUM(cntb.tax_base) as refunded_base,
                           SUM(cntb.tax_amount) as refunded_amount
                    FROM credit_note cn
                    JOIN credit_note_tax_breakdown cntb ON cn.cn_id = cntb.cn_id
                    WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
                    GROUP BY cn.invoice_id, cntb.tax_rate_id
                ) cn_bk ON itb.invoice_id = cn_bk.invoice_id AND itb.tax_rate_id = cn_bk.tax_rate_id
            )
            SELECT 
                i.invoice_number,
                i.invoice_date,
                c.first_name || ' ' || c.last_name as customer_name,
                inet.subtotal_ex_tax,
                inet.tax_total,
                inet.total_amount,
                bn.rate_name,
                bn.rate_percentage,
                bn.tax_base,
                bn.tax_amount
            FROM invoice i
            JOIN invoice_net inet ON i.invoice_id = inet.invoice_id
            JOIN customer c ON i.customer_id = c.customer_id
            LEFT JOIN breakdown_net bn ON i.invoice_id = bn.invoice_id
            WHERE i.invoice_date >= $1 
            AND i.invoice_date <= $2
            AND i.status != 'Cancelled'
            ORDER BY i.invoice_date DESC, i.invoice_number
        `;

        const { rows } = await db.query(query, [startDate, endDate]);

        if (format === 'csv') {
            // Generate CSV content
            const csvHeaders = [
                'Invoice Number', 'Invoice Date', 'Customer Name', 
                'Subtotal (Ex Tax)', 'Tax Total', 'Total Amount',
                'Tax Rate Name', 'Tax Rate %', 'Tax Base', 'Tax Amount'
            ];

            const csvContent = [
                csvHeaders.join(','),
                ...rows.map(row => [
                    `"${row.invoice_number}"`,
                    `"${row.invoice_date ? new Date(row.invoice_date).toISOString().split('T')[0] : ''}"`,
                    `"${row.customer_name}"`,
                    row.subtotal_ex_tax || 0,
                    row.tax_total || 0,
                    row.total_amount || 0,
                    `"${row.rate_name || ''}"`,
                    row.rate_percentage ? (row.rate_percentage * 100).toFixed(2) : '',
                    row.tax_base || 0,
                    row.tax_amount || 0
                ].join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="tax-report-${startDate}-to-${endDate}.csv"`);
            res.send(csvContent);
        } else {
            res.json({
                data: rows,
                filters: { startDate, endDate },
                generated_at: new Date().toISOString()
            });
        }

    } catch (err) {
        console.error('Tax export error:', err.message);
        res.status(500).json({ message: 'Server error exporting tax data.', error: err.message });
    }
});

// GET /api/tax-reports/rates-usage - Get usage statistics for tax rates
router.get('/tax-reports/rates-usage', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate } = req.query;

    try {
        let whereClause = '';
        let params = [];

        if (startDate && endDate) {
            whereClause = 'WHERE i.invoice_date >= $1 AND i.invoice_date <= $2 AND i.status != \'Cancelled\'';
            params = [startDate, endDate];
        } else if (startDate || endDate) {
            return res.status(400).json({ message: 'Both start date and end date are required, or omit both for all-time data.' });
        } else {
            whereClause = 'WHERE i.status != \'Cancelled\'';
        }

        // Refunds are netted into the period they were issued in, matching the
        // date basis used for invoices below. Without both dates this report is
        // all-time, so every refund counts.
        const refundDateClause = (startDate && endDate)
            ? `WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2`
            : '';

        const query = `
            WITH breakdown_net AS (
                SELECT
                    itb.invoice_id,
                    itb.tax_rate_id,
                    itb.tax_base - COALESCE(cn_bk.refunded_base, 0) AS tax_base,
                    itb.tax_amount - COALESCE(cn_bk.refunded_amount, 0) AS tax_amount,
                    itb.line_count
                FROM invoice_tax_breakdown itb
                LEFT JOIN (
                    SELECT cn.invoice_id, cntb.tax_rate_id,
                           SUM(cntb.tax_base) as refunded_base,
                           SUM(cntb.tax_amount) as refunded_amount
                    FROM credit_note cn
                    JOIN credit_note_tax_breakdown cntb ON cn.cn_id = cntb.cn_id
                    ${refundDateClause}
                    GROUP BY cn.invoice_id, cntb.tax_rate_id
                ) cn_bk ON itb.invoice_id = cn_bk.invoice_id AND itb.tax_rate_id = cn_bk.tax_rate_id
            )
            SELECT 
                tr.tax_rate_id,
                tr.rate_name,
                tr.rate_percentage,
                tr.is_default,
                COUNT(DISTINCT bn.invoice_id) as invoices_count,
                SUM(bn.line_count) as total_lines,
                SUM(bn.tax_base) as total_tax_base,
                SUM(bn.tax_amount) as total_tax_collected,
                AVG(bn.tax_amount) as avg_tax_per_breakdown,
                MIN(i.invoice_date) as first_used,
                MAX(i.invoice_date) as last_used
            FROM tax_rate tr
            LEFT JOIN breakdown_net bn ON tr.tax_rate_id = bn.tax_rate_id
            LEFT JOIN invoice i ON bn.invoice_id = i.invoice_id ${whereClause.replace('WHERE', 'AND')}
            ${whereClause.replace('AND i.status != \'Cancelled\'', '').replace('WHERE i.status != \'Cancelled\'', '')}
            GROUP BY tr.tax_rate_id, tr.rate_name, tr.rate_percentage, tr.is_default
            ORDER BY total_tax_collected DESC NULLS LAST, tr.rate_name
        `;

        const { rows } = await db.query(query, params);

        const processedRows = rows.map(row => ({
            ...row,
            rate_percentage: parseFloat(row.rate_percentage),
            total_tax_base: parseFloat(row.total_tax_base || 0),
            total_tax_collected: parseFloat(row.total_tax_collected || 0),
            avg_tax_per_breakdown: parseFloat(row.avg_tax_per_breakdown || 0),
            usage_percentage: null // Will be calculated below
        }));

        // Calculate usage percentages
        const totalInvoices = processedRows.reduce((sum, row) => sum + (parseInt(row.invoices_count) || 0), 0);
        if (totalInvoices > 0) {
            processedRows.forEach(row => {
                row.usage_percentage = ((parseInt(row.invoices_count) || 0) / totalInvoices * 100).toFixed(2);
            });
        }

        res.json({
            tax_rates_usage: processedRows,
            summary: {
                total_active_rates: processedRows.filter(r => r.invoices_count > 0).length,
                total_configured_rates: processedRows.length,
                total_invoices: totalInvoices,
                period: startDate && endDate ? { startDate, endDate } : 'all-time'
            },
            generated_at: new Date().toISOString()
        });

    } catch (err) {
        console.error('Tax rates usage report error:', err.message);
        res.status(500).json({ message: 'Server error generating tax rates usage report.', error: err.message });
    }
});

module.exports = router;