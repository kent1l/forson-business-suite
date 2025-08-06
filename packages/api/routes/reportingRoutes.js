const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/reports/sales-summary - Fetch a summary of sales data
router.get('/reports/sales-summary', async (req, res) => {
    try {
        // Query to get total sales revenue and the number of invoices
        const salesQuery = `
            SELECT 
                COALESCE(SUM(total_amount), 0) AS total_sales,
                COUNT(*) AS total_invoices
            FROM invoice;
        `;

        // Query to get the total cost of all items sold
        const costQuery = `
            SELECT
                COALESCE(SUM(il.quantity * p.last_cost), 0) AS total_cost
            FROM invoice_line il
            JOIN part p ON il.part_id = p.part_id;
        `;

        const [salesRes, costRes] = await Promise.all([
            db.query(salesQuery),
            db.query(costQuery)
        ]);

        const totalSales = parseFloat(salesRes.rows[0].total_sales);
        const totalInvoices = parseInt(salesRes.rows[0].total_invoices, 10);
        const totalCost = parseFloat(costRes.rows[0].total_cost);
        const profit = totalSales - totalCost;

        const summary = {
            totalSales,
            totalInvoices,
            totalCost,
            profit,
        };

        res.json(summary);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
