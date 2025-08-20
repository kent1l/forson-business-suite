const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /dashboard/stats - Fetch dashboard statistics
router.get('/dashboard/stats', async (req, res) => {
  try {
    const [totalPartsRes, lowStockRes, totalInvoicesRes] = await Promise.all([
      db.query('SELECT COUNT(*) AS total_parts FROM part WHERE is_active = TRUE'),
      db.query(`
        SELECT COUNT(*) AS low_stock_items
        FROM part p
        WHERE p.low_stock_warning = TRUE AND
              (SELECT COALESCE(SUM(it.quantity), 0) FROM inventory_transaction it WHERE it.part_id = p.part_id) <= p.warning_quantity
      `),
      db.query('SELECT COUNT(*) AS total_invoices FROM invoice')
    ]);

    const stats = {
      totalParts: parseInt(totalPartsRes.rows[0].total_parts, 10),
      lowStockItems: parseInt(lowStockRes.rows[0].low_stock_items, 10),
      pendingOrders: parseInt(totalInvoicesRes.rows[0].total_invoices, 10),
    };

    res.json(stats);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET /dashboard/sales-chart - Data for the last 30 days sales chart (now calculates NET sales)
router.get('/dashboard/sales-chart', async (req, res) => {
    try {
        const query = `
            WITH all_days AS (
                SELECT generate_series(
                    CURRENT_DATE - INTERVAL '29 days',
                    CURRENT_DATE,
                    '1 day'
                )::date AS day
            )
            SELECT
                TO_CHAR(d.day, 'Mon DD') as date,
                (
                    COALESCE((SELECT SUM(total_amount) FROM invoice WHERE invoice_date::date = d.day), 0)
                    -
                    COALESCE((SELECT SUM(total_amount) FROM credit_note WHERE refund_date::date = d.day), 0)
                ) as "total_sales"
            FROM all_days d
            GROUP BY d.day
            ORDER BY d.day;
        `;
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;