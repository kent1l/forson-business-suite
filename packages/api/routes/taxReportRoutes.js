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
        let dateGroupClause;
        let dateFormat;
        
        switch (groupBy) {
            case 'month':
                dateGroupClause = "date_trunc('month', i.invoice_date)";
                dateFormat = 'YYYY-MM';
                break;
            case 'week':
                dateGroupClause = "date_trunc('week', i.invoice_date)";
                dateFormat = 'YYYY-"W"WW';
                break;
            case 'day':
            default:
                dateGroupClause = "date_trunc('day', i.invoice_date)";
                dateFormat = 'YYYY-MM-DD';
                break;
        }

        const query = `
            WITH invoice_net AS (
                SELECT 
                    i.invoice_id, 
                    i.invoice_date, 
                    COALESCE(i.subtotal_ex_tax, 0) - COALESCE(cn_totals.refunded_subtotal, 0) AS subtotal_ex_tax,
                    COALESCE(i.tax_total, 0) - COALESCE(cn_totals.refunded_tax, 0) AS tax_total,
                    COALESCE(i.total_amount, 0) - COALESCE(cn_totals.refunded_total, 0) AS total_amount
                FROM invoice i
                LEFT JOIN (
                    SELECT invoice_id, 
                           SUM(subtotal_ex_tax) as refunded_subtotal,
                           SUM(tax_total) as refunded_tax,
                           SUM(total_amount) as refunded_total
                    FROM credit_note
                    GROUP BY invoice_id
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
                    GROUP BY cn.invoice_id, cntb.tax_rate_id
                ) cn_bk ON itb.invoice_id = cn_bk.invoice_id AND itb.tax_rate_id = cn_bk.tax_rate_id
            ),
            period_grouped AS (
                SELECT 
                    ${dateGroupClause} as period,
                    to_char(${dateGroupClause}, '${dateFormat}') as period_label,
                    COUNT(DISTINCT i.invoice_id) as invoice_count,
                    SUM(i.subtotal_ex_tax) as total_subtotal,
                    SUM(i.tax_total) as total_tax,
                    SUM(i.total_amount) as total_amount,
                    AVG(i.tax_total) as avg_tax_per_invoice
                FROM invoice_net i
                WHERE i.invoice_date >= $1 AND i.invoice_date <= $2
                GROUP BY ${dateGroupClause}
            ),
            period_breakdown AS (
                SELECT 
                    ${dateGroupClause} as period,
                    bn.rate_name,
                    bn.rate_percentage,
                    SUM(bn.tax_base) as tax_base,
                    SUM(bn.tax_amount) as tax_amount,
                    COUNT(DISTINCT bn.invoice_id) as invoice_count
                FROM invoice_net i
                JOIN breakdown_net bn ON i.invoice_id = bn.invoice_id
                WHERE i.invoice_date >= $1 AND i.invoice_date <= $2
                GROUP BY ${dateGroupClause}, bn.rate_name, bn.rate_percentage
            )
            SELECT 
                pg.period,
                pg.period_label,
                pg.invoice_count,
                pg.total_subtotal,
                pg.total_tax,
                pg.total_amount,
                pg.avg_tax_per_invoice,
                (
                    SELECT json_agg(
                        json_build_object(
                            'rate_name', pb.rate_name,
                            'rate_percentage', pb.rate_percentage,
                            'tax_base', pb.tax_base,
                            'tax_amount', pb.tax_amount,
                            'invoice_count', pb.invoice_count
                        )
                    )
                    FROM period_breakdown pb
                    WHERE pb.period = pg.period
                ) as tax_breakdown_by_rate
            FROM period_grouped pg
            ORDER BY pg.period DESC
        `;

        const { rows } = await db.query(query, [startDate, endDate]);

        // Process and aggregate tax breakdown data
        const processedRows = rows.map(row => ({
            ...row,
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
        const totals = {
            total_invoices: processedRows.reduce((sum, row) => sum + parseInt(row.invoice_count), 0),
            total_subtotal: processedRows.reduce((sum, row) => sum + row.total_subtotal, 0),
            total_tax: processedRows.reduce((sum, row) => sum + row.total_tax, 0),
            total_amount: processedRows.reduce((sum, row) => sum + row.total_amount, 0)
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

// GET /api/tax-reports/detailed - Get detailed tax report with invoice breakdown
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
                    SELECT invoice_id, 
                           SUM(subtotal_ex_tax) as refunded_subtotal,
                           SUM(tax_total) as refunded_tax,
                           SUM(total_amount) as refunded_total
                    FROM credit_note
                    GROUP BY invoice_id
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

// GET /api/tax-reports/export - Export tax data as CSV
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
                    SELECT invoice_id, 
                           SUM(subtotal_ex_tax) as refunded_subtotal,
                           SUM(tax_total) as refunded_tax,
                           SUM(total_amount) as refunded_total
                    FROM credit_note
                    GROUP BY invoice_id
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