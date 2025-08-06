const express = require('express');
const db = require('../db');
const { Parser } = require('json2csv');
const router = express.Router();

// GET /api/reports/sales-summary - Fetch a summary of sales data with date filtering
router.get('/reports/sales-summary', async (req, res) => {
    const { startDate, endDate, format = 'json' } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    const client = await db.getClient();

    try {
        // Query for detailed report data
        const detailsQuery = `
            SELECT 
                i.invoice_date,
                i.invoice_number,
                c.first_name || ' ' || c.last_name AS customer_name,
                p.internal_sku,
                p.detail AS part_detail,
                il.quantity,
                il.sale_price,
                (il.quantity * il.sale_price) AS line_total,
                (il.quantity * p.last_cost) AS line_cost
            FROM invoice i
            JOIN invoice_line il ON i.invoice_id = il.invoice_id
            JOIN customer c ON i.customer_id = c.customer_id
            JOIN part p ON il.part_id = p.part_id
            WHERE i.invoice_date::date BETWEEN $1 AND $2
            ORDER BY i.invoice_date;
        `;

        // Query for summary data
        const summaryQuery = `
            SELECT
                COALESCE(SUM(il.quantity * il.sale_price), 0) AS total_sales,
                COALESCE(SUM(il.quantity * p.last_cost), 0) AS total_cost,
                COUNT(DISTINCT i.invoice_id) AS total_invoices
            FROM invoice i
            JOIN invoice_line il ON i.invoice_id = il.invoice_id
            JOIN part p ON il.part_id = p.part_id
            WHERE i.invoice_date::date BETWEEN $1 AND $2;
        `;

        const [detailsRes, summaryRes] = await Promise.all([
            client.query(detailsQuery, [startDate, endDate]),
            client.query(summaryQuery, [startDate, endDate])
        ]);

        const details = detailsRes.rows;
        const summaryData = summaryRes.rows[0];
        
        const totalSales = parseFloat(summaryData.total_sales);
        const totalCost = parseFloat(summaryData.total_cost);

        const summary = {
            totalSales,
            totalCost,
            profit: totalSales - totalCost,
            totalInvoices: parseInt(summaryData.total_invoices, 10),
        };

        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(details);
            res.header('Content-Type', 'text/csv');
            res.attachment(`sales-report-${startDate}-to-${endDate}.csv`);
            return res.send(csv);
        }
        
        // Default to JSON
        res.json({ summary, details });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// GET /api/reports/inventory-valuation - Fetch a report of current inventory value
router.get('/reports/inventory-valuation', async (req, res) => {
    const { format = 'json' } = req.query;
    try {
        const query = `
            SELECT
                p.internal_sku,
                p.detail,
                b.brand_name,
                g.group_name,
                p.last_cost,
                (
                    SELECT COALESCE(SUM(it.quantity), 0) 
                    FROM inventory_transaction it 
                    WHERE it.part_id = p.part_id
                ) AS stock_on_hand,
                (
                    p.last_cost * (
                        SELECT COALESCE(SUM(it.quantity), 0) 
                        FROM inventory_transaction it 
                        WHERE it.part_id = p.part_id
                    )
                ) AS total_value
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE p.is_service = FALSE AND p.is_active = TRUE
            GROUP BY p.part_id, b.brand_name, g.group_name
            ORDER BY p.detail;
        `;

        const { rows } = await db.query(query);

        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(rows);
            res.header('Content-Type', 'text/csv');
            res.attachment(`inventory-valuation-report.csv`);
            return res.send(csv);
        }

        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/reports/top-selling - Fetch a report of top selling products
router.get('/reports/top-selling', async (req, res) => {
    const { startDate, endDate, sortBy = 'revenue', format = 'json' } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    const orderByClause = sortBy === 'quantity' ? 'total_quantity_sold DESC' : 'total_revenue DESC';

    try {
        const query = `
            SELECT
                p.internal_sku,
                p.detail,
                b.brand_name,
                g.group_name,
                SUM(il.quantity) AS total_quantity_sold,
                SUM(il.quantity * il.sale_price) AS total_revenue
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id
            JOIN invoice i ON il.invoice_id = i.invoice_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE i.invoice_date::date BETWEEN $1 AND $2
            GROUP BY p.part_id, b.brand_name, g.group_name
            ORDER BY ${orderByClause}
            LIMIT 100; -- Limit to top 100 results for performance
        `;

        const { rows } = await db.query(query, [startDate, endDate]);

        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(rows);
            res.header('Content-Type', 'text/csv');
            res.attachment(`top-selling-report-${startDate}-to-${endDate}.csv`);
            return res.send(csv);
        }

        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
