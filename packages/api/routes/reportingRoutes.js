const express = require('express');
const db = require('../db');
const { Parser } = require('json2csv');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/reports/sales-summary
router.get('/reports/sales-summary', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate, format = 'json' } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: 'Start date and end date are required.' });
    
    const client = await db.getClient();
    try {
        const detailsQuery = `
            SELECT 
                i.invoice_date, i.invoice_number, p.detail,
                g.group_name, b.brand_name,
                (SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) AS part_numbers,
                il.quantity, il.sale_price,
                (il.quantity * il.sale_price) AS line_total,
                (il.quantity * il.cost_at_sale) AS line_cost
            FROM invoice i
            JOIN invoice_line il ON i.invoice_id = il.invoice_id
            JOIN part p ON il.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE (i.invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
            ORDER BY i.invoice_date;
        `;
        
        const summaryQuery = `
            SELECT
                (SELECT COALESCE(SUM(total_amount), 0) FROM invoice WHERE (invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2) AS gross_sales,
                (SELECT COALESCE(SUM(total_amount), 0) FROM credit_note WHERE (refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2) AS total_refunds,
                (SELECT COALESCE(SUM(il.quantity * il.cost_at_sale), 0) FROM invoice_line il JOIN invoice i ON il.invoice_id = i.invoice_id WHERE (i.invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2) AS total_cost_of_goods_sold,
                (SELECT COALESCE(SUM(cnl.quantity * p.wac_cost), 0) FROM credit_note_line cnl JOIN part p ON cnl.part_id = p.part_id JOIN credit_note cn ON cnl.cn_id = cn.cn_id WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2) AS total_cost_of_goods_returned,
                (SELECT COUNT(*) FROM invoice WHERE (invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2) AS total_invoices
        `;

        const [detailsRes, summaryRes] = await Promise.all([
            client.query(detailsQuery, [startDate, endDate]),
            client.query(summaryQuery, [startDate, endDate])
        ]);

        const details = detailsRes.rows.map(row => ({ ...row, display_name: constructDisplayName(row) }));
        
        const summaryData = summaryRes.rows[0];
        const netSales = parseFloat(summaryData.gross_sales) - parseFloat(summaryData.total_refunds);
        const netCost = parseFloat(summaryData.total_cost_of_goods_sold) - parseFloat(summaryData.total_cost_of_goods_returned);
        
        const summary = { 
            totalSales: netSales, 
            totalCost: netCost, 
            profit: netSales - netCost, 
            totalInvoices: parseInt(summaryData.total_invoices, 10) 
        };

        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(details);
            res.header('Content-Type', 'text/csv').attachment(`sales-report-${startDate}-to-${endDate}.csv`).send(csv);
        } else {
            res.json({ summary, details });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// GET /api/reports/top-selling - (No change needed here as it doesn't calculate profit)
router.get('/reports/top-selling', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate, sortBy = 'revenue', format = 'json' } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: 'Start date and end date are required.' });

    const orderByClause = sortBy === 'quantity' ? 'total_quantity_sold DESC' : 'total_revenue DESC';
    try {
        const query = `
            SELECT
                p.part_id, p.internal_sku, p.detail,
                b.brand_name, g.group_name,
                (SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) AS part_numbers,
                SUM(il.quantity) AS total_quantity_sold,
                SUM(il.quantity * il.sale_price) AS total_revenue
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id
            JOIN invoice i ON il.invoice_id = i.invoice_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE (i.invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
            GROUP BY p.part_id, b.brand_name, g.group_name
            ORDER BY ${orderByClause}
            LIMIT 100;
        `;
        const { rows } = await db.query(query, [startDate, endDate]);
        const data = rows.map(row => ({ ...row, display_name: constructDisplayName(row) }));

        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(data);
            res.header('Content-Type', 'text/csv').attachment(`top-selling-report-${startDate}-to-${endDate}.csv`).send(csv);
        } else {
            res.json(data);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/reports/inventory-valuation
router.get('/reports/inventory-valuation', protect, hasPermission('reports:view'), async (req, res) => {
    const { format = 'json' } = req.query;
    try {
        const query = `
            SELECT
                p.internal_sku,
                p.detail,
                b.brand_name,
                g.group_name,
                (
                    SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) 
                    FROM part_number pn 
                    WHERE pn.part_id = p.part_id
                ) AS part_numbers,
                p.wac_cost, -- UPDATED: Use wac_cost
                (
                    SELECT COALESCE(SUM(it.quantity), 0) 
                    FROM inventory_transaction it 
                    WHERE it.part_id = p.part_id
                ) AS stock_on_hand,
                (
                    p.wac_cost * ( -- UPDATED: Use wac_cost
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
        const data = rows.map(row => ({ ...row, display_name: constructDisplayName(row) }));

        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(data);
            res.header('Content-Type', 'text/csv');
            res.attachment(`inventory-valuation-report.csv`);
            return res.send(csv);
        }

        res.json(data);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/reports/low-stock - (No change needed)
router.get('/reports/low-stock', protect, hasPermission('reports:view'), async (req, res) => {
    const { format = 'json' } = req.query;
    try {
        const query = `
            SELECT 
                p.internal_sku,
                p.detail,
                b.brand_name,
                g.group_name,
                (
                    SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) 
                    FROM part_number pn 
                    WHERE pn.part_id = p.part_id
                ) AS part_numbers,
                p.reorder_point,
                (
                    SELECT COALESCE(SUM(it.quantity), 0) 
                    FROM inventory_transaction it 
                    WHERE it.part_id = p.part_id
                ) AS stock_on_hand
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE p.is_active = TRUE AND p.low_stock_warning = TRUE
            GROUP BY p.part_id, b.brand_name, g.group_name
            HAVING COALESCE(SUM( (SELECT SUM(it.quantity) FROM inventory_transaction it WHERE it.part_id = p.part_id) ), 0) <= p.reorder_point
            ORDER BY p.detail;
        `;
        const { rows } = await db.query(query);
        const data = rows.map(row => ({ ...row, display_name: constructDisplayName(row) }));

        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(data);
            res.header('Content-Type', 'text/csv').attachment('low-stock-report.csv').send(csv);
        } else {
            res.json(data);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// GET /api/reports/sales-by-customer - (No change needed)
router.get('/reports/sales-by-customer', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate, customerId, format = 'json' } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: 'Start date and end date are required.' });

    let whereClauses = ["(i.invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2"];
    let queryParams = [startDate, endDate];

    if (customerId) {
        queryParams.push(customerId);
        whereClauses.push(`c.customer_id = $${queryParams.length}`);
    }

    try {
        const query = `
            SELECT
                c.customer_id,
                c.first_name,
                c.last_name,
                c.company_name,
                COUNT(i.invoice_id) as total_invoices,
                SUM(i.total_amount) as total_sales
            FROM customer c
            JOIN invoice i ON c.customer_id = i.customer_id
            WHERE ${whereClauses.join(' AND ')}
            GROUP BY c.customer_id
            ORDER BY total_sales DESC;
        `;
        const { rows } = await db.query(query, queryParams);
        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(rows);
            res.header('Content-Type', 'text/csv').attachment('sales-by-customer.csv').send(csv);
        } else {
            res.json(rows);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/reports/inventory-movement - (No change needed)
router.get('/reports/inventory-movement', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate, partId, format = 'json' } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: 'Start date and end date are required.' });

    let whereClauses = ["(it.transaction_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2"];
    let queryParams = [startDate, endDate];

    if (partId) {
        queryParams.push(partId);
        whereClauses.push(`it.part_id = $${queryParams.length}`);
    }

    try {
        const query = `
            SELECT
                it.transaction_date,
                p.internal_sku,
                p.detail,
                b.brand_name,
                g.group_name,
                (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) AS part_numbers,
                it.trans_type,
                it.quantity,
                it.reference_no,
                e.first_name || ' ' || e.last_name as employee_name
            FROM inventory_transaction it
            JOIN part p ON it.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            LEFT JOIN employee e ON it.employee_id = e.employee_id
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY it.transaction_date DESC;
        `;
        const { rows } = await db.query(query, queryParams);
        const data = rows.map(row => ({ ...row, display_name: constructDisplayName(row) }));
        
        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(data);
            res.header('Content-Type', 'text/csv').attachment('inventory-movement.csv').send(csv);
        } else {
            res.json(data);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/reports/profitability-by-product
router.get('/reports/profitability-by-product', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate, brandId, groupId, format = 'json' } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: 'Start date and end date are required.' });
    
    let whereClauses = ["(i.invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2"];
    let queryParams = [startDate, endDate];

    if (brandId) {
        queryParams.push(brandId);
        whereClauses.push(`p.brand_id = $${queryParams.length}`);
    }
    if (groupId) {
        queryParams.push(groupId);
        whereClauses.push(`p.group_id = $${queryParams.length}`);
    }

    try {
        const query = `
            SELECT
                p.internal_sku,
                p.detail,
                b.brand_name,
                g.group_name,
                (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) AS part_numbers,
                SUM(il.quantity) AS total_quantity_sold,
                SUM(il.quantity * il.sale_price) AS total_revenue,
                SUM(il.quantity * il.cost_at_sale) AS total_cost, -- UPDATED: Use cost_at_sale
                SUM(il.quantity * il.sale_price) - SUM(il.quantity * il.cost_at_sale) AS total_profit -- UPDATED: Use cost_at_sale
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id
            JOIN invoice i ON il.invoice_id = i.invoice_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE ${whereClauses.join(' AND ')}
            GROUP BY p.part_id, b.brand_name, g.group_name
            ORDER BY total_profit DESC;
        `;
        const { rows } = await db.query(query, queryParams);
        const data = rows.map(row => ({ ...row, display_name: constructDisplayName(row) }));

        if (format === 'csv') {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(data);
            res.header('Content-Type', 'text/csv').attachment('profitability-by-product.csv').send(csv);
        } else {
            res.json(data);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// NEW ENDPOINT: Get refunds report
router.get('/reports/refunds', protect, hasPermission('reports:view'), async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required.' });
    }
    try {
        const query = `
            SELECT 
                cn.cn_id,
                cn.cn_number,
                cn.refund_date,
                cn.total_amount,
                i.invoice_number,
                c.first_name || ' ' || c.last_name as customer_name
            FROM credit_note cn
            JOIN invoice i ON cn.invoice_id = i.invoice_id
            JOIN customer c ON i.customer_id = c.customer_id
            WHERE (cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
            ORDER BY cn.refund_date DESC;
        `;
        const { rows } = await db.query(query, [startDate, endDate]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
