const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /dashboard/stats - Fetch dashboard statistics
router.get('/dashboard/stats', async (req, res) => {
  try {
    // We'll run all queries in parallel for efficiency
    const [totalPartsRes, lowStockRes, totalInvoicesRes] = await Promise.all([
      // Query 1: Get the total count of parts
      db.query('SELECT COUNT(*) AS total_parts FROM part WHERE is_active = TRUE'),

      // Query 2: Get the count of parts that are below their warning quantity
      db.query(`
        SELECT COUNT(*) AS low_stock_items
        FROM part p
        WHERE p.low_stock_warning = TRUE AND
              (SELECT COALESCE(SUM(it.quantity), 0) FROM inventory_transaction it WHERE it.part_id = p.part_id) <= p.warning_quantity
      `),

      // Query 3: Get the total number of invoices (as a proxy for orders)
      db.query('SELECT COUNT(*) AS total_invoices FROM invoice')
    ]);

    const stats = {
      totalParts: parseInt(totalPartsRes.rows[0].total_parts, 10),
      lowStockItems: parseInt(lowStockRes.rows[0].low_stock_items, 10),
      // We'll use total_invoices for now, can be changed to pending_orders later
      pendingOrders: parseInt(totalInvoicesRes.rows[0].total_invoices, 10),
    };

    res.json(stats);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
