const express = require('express');
const db = require('../db');
const { constructDisplayName } = require('../helpers/displayNameHelper');
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
        const timeRange = req.query.days || 30;
        const query = `
            WITH all_days AS (
                SELECT generate_series(
                    CURRENT_DATE - INTERVAL '${parseInt(timeRange) - 1} days',
                    CURRENT_DATE,
                    '1 day'
                )::date AS day
            )
            SELECT
                TO_CHAR(d.day, 'Mon DD') as date,
                (
                    COALESCE((SELECT SUM(total_amount) FROM invoice WHERE invoice_date::date = d.day AND (status = 'Paid' OR amount_paid >= total_amount)), 0)
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

// GET /dashboard/enhanced-stats - Enhanced dashboard statistics
router.get('/dashboard/enhanced-stats', async (req, res) => {
    try {
        const [
            todayRevenueRes,
            outstandingARRes,
            inventoryValueRes,
            lowStockCountRes,
            recentSalesRes,
            topProductsRes
        ] = await Promise.all([
            // Today's revenue
            db.query(`
                SELECT COALESCE(SUM(total_amount), 0) as today_revenue,
                       COALESCE(SUM(CASE WHEN invoice_date >= CURRENT_DATE - INTERVAL '1 day' AND invoice_date < CURRENT_DATE THEN total_amount ELSE 0 END), 0) as yesterday_revenue
                FROM invoice 
                WHERE invoice_date::date >= CURRENT_DATE - INTERVAL '1 day'
                AND status IN ('Paid', 'Partially Paid')
            `),
            
            // Outstanding A/R
            db.query(`
                SELECT COALESCE(SUM(total_amount - amount_paid), 0) as outstanding_ar
                FROM invoice 
                WHERE status IN ('Unpaid', 'Partially Paid')
            `),
            
            // Inventory value
            db.query(`
                SELECT COALESCE(SUM(COALESCE(p.wac_cost, p.last_cost, 0) * COALESCE(stock.quantity, 0)), 0) as inventory_value
                FROM part p
                LEFT JOIN (
                    SELECT part_id, SUM(quantity) as quantity
                    FROM inventory_transaction
                    GROUP BY part_id
                ) stock ON p.part_id = stock.part_id
                WHERE p.is_active = true
            `),
            
            // Low stock count
            db.query(`
                SELECT COUNT(*) as low_stock_count
                FROM part p
                WHERE p.low_stock_warning = TRUE 
                AND (
                    SELECT COALESCE(SUM(it.quantity), 0) 
                    FROM inventory_transaction it 
                    WHERE it.part_id = p.part_id
                ) <= p.warning_quantity
            `),
            
            // Recent sales (last 5)
            db.query(`
                SELECT 
                    i.invoice_number,
                    i.total_amount,
                    i.invoice_date,
                    COALESCE(c.company_name, CONCAT(c.first_name, ' ', c.last_name)) as customer_name
                FROM invoice i
                LEFT JOIN customer c ON i.customer_id = c.customer_id
                WHERE i.status IN ('Paid', 'Partially Paid')
                ORDER BY i.invoice_date DESC
                LIMIT 5
            `),
            
            // Top selling products (last 30 days)
            db.query(`
                SELECT 
                    p.part_id,
                    p.detail,
                    p.internal_sku,
                    COALESCE(g.group_name, '') as group_name,
                    COALESCE(b.brand_name, '') as brand_name,
                    COALESCE(array_to_string(array_agg(DISTINCT pn.part_number), ', '), '') as part_numbers,
                    SUM(il.quantity) as total_quantity,
                    SUM((il.sale_price * il.quantity) - COALESCE(il.discount_amount, 0)) as total_revenue
                FROM invoice_line il
                JOIN invoice i ON il.invoice_id = i.invoice_id
                JOIN part p ON il.part_id = p.part_id
                LEFT JOIN "group" g ON p.group_id = g.group_id
                LEFT JOIN brand b ON p.brand_id = b.brand_id
                LEFT JOIN part_number pn ON p.part_id = pn.part_id
                WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '30 days'
                AND i.status IN ('Paid', 'Partially Paid')
                GROUP BY p.part_id, p.detail, p.internal_sku, g.group_name, b.brand_name
                ORDER BY total_revenue DESC
                LIMIT 10
            `)
        ]);

        // Calculate percentage changes
        const todayRevenue = parseFloat(todayRevenueRes.rows[0].today_revenue);
        const yesterdayRevenue = parseFloat(todayRevenueRes.rows[0].yesterday_revenue);
        const revenueChange = yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100) : 0;

        const enhancedStats = {
            kpis: {
                todayRevenue: {
                    value: todayRevenue,
                    change: `${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}%`,
                    trend: revenueChange >= 0 ? 'up' : 'down'
                },
                outstandingAR: {
                    value: parseFloat(outstandingARRes.rows[0].outstanding_ar),
                    change: null,
                    trend: null
                },
                inventoryValue: {
                    value: parseFloat(inventoryValueRes.rows[0].inventory_value),
                    change: null,
                    trend: null
                },
                lowStockCount: {
                    value: parseInt(lowStockCountRes.rows[0].low_stock_count),
                    urgent: parseInt(lowStockCountRes.rows[0].low_stock_count) > 0
                }
            },
            recentSales: recentSalesRes.rows,
            topProducts: topProductsRes.rows.map(product => ({
                ...product,
                product_name: constructDisplayName(product)
            }))
        };

        res.json(enhancedStats);
    } catch (err) {
        console.error('Enhanced dashboard stats error:', err);
        res.status(500).json({ message: 'Failed to fetch enhanced dashboard stats' });
    }
});

// GET /dashboard/low-stock-items - Get detailed low stock items
router.get('/dashboard/low-stock-items', async (req, res) => {
    try {
        const query = `
            SELECT 
                p.part_id,
                p.detail,
                p.internal_sku,
                p.warning_quantity,
                COALESCE(stock.quantity, 0) as current_stock
            FROM part p
            LEFT JOIN (
                SELECT part_id, SUM(quantity) as quantity
                FROM inventory_transaction
                GROUP BY part_id
            ) stock ON p.part_id = stock.part_id
            WHERE p.low_stock_warning = TRUE 
            AND COALESCE(stock.quantity, 0) <= p.warning_quantity
            AND p.is_active = true
            ORDER BY (COALESCE(stock.quantity, 0) - p.warning_quantity) ASC
            LIMIT 10
        `;
        
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error('Low stock items error:', err);
        res.status(500).json({ message: 'Failed to fetch low stock items' });
    }
});

module.exports = router;