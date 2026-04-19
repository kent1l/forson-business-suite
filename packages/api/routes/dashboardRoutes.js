const express = require('express');
const db = require('../db');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const router = express.Router();

const OUTBOX_ALERTS_DEFAULTS = Object.freeze({
    deadGrowthThreshold: Number(process.env.MEILI_OUTBOX_ALERT_DEAD_GROWTH || 10),
    backlogAgeThresholdSeconds: Number(process.env.MEILI_OUTBOX_ALERT_BACKLOG_AGE_SECONDS || 120),
    workerIdleThresholdSeconds: Number(process.env.MEILI_OUTBOX_ALERT_WORKER_IDLE_SECONDS || 300)
});

const getSearchSyncHealth = async () => {
    try {
        const [statusRes, lagRes, processedRes] = await Promise.all([
            db.query(`
                SELECT status, COUNT(*)::int AS count
                FROM meili_sync_outbox
                GROUP BY status
            `),
            db.query(`
                SELECT
                    EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int AS oldest_pending_seconds
                FROM meili_sync_outbox
                WHERE status = 'pending'
            `),
            db.query(`
                SELECT
                    EXTRACT(EPOCH FROM (NOW() - MAX(processed_at)))::int AS seconds_since_last_processed
                FROM meili_sync_outbox
                WHERE processed_at IS NOT NULL
            `)
        ]);

        const counts = { pending: 0, processing: 0, done: 0, dead: 0 };
        statusRes.rows.forEach((row) => {
            counts[row.status] = row.count;
        });

        return {
            enabled: true,
            queueCounts: counts,
            oldestPendingSeconds: lagRes.rows[0].oldest_pending_seconds || 0,
            secondsSinceLastProcessed: processedRes.rows[0].seconds_since_last_processed,
            hasBacklog: counts.pending > 0 || counts.processing > 0,
            hasDeadLetters: counts.dead > 0
        };
    } catch (err) {
        // If the outbox table does not exist yet, keep dashboard functional.
        if (err && err.code === '42P01') {
            return {
                enabled: false,
                reason: 'meili_sync_outbox table not found (migration not applied)'
            };
        }
        throw err;
    }
};

const getSearchSyncAlerts = async () => {
    const health = await getSearchSyncHealth();
    if (!health.enabled) {
        return { enabled: false, reason: health.reason, alerts: [] };
    }

    const [deadDeltaRes] = await Promise.all([
        db.query(`
            SELECT
                GREATEST(
                    0,
                    COUNT(*) FILTER (WHERE status = 'dead' AND updated_at >= NOW() - INTERVAL '10 minutes')
                    -
                    COUNT(*) FILTER (WHERE status = 'dead' AND updated_at >= NOW() - INTERVAL '20 minutes' AND updated_at < NOW() - INTERVAL '10 minutes')
                )::int AS dead_growth_10m
            FROM meili_sync_outbox
        `)
    ]);

    const deadGrowth10m = deadDeltaRes.rows[0]?.dead_growth_10m || 0;
    const alerts = [];

    if (deadGrowth10m >= OUTBOX_ALERTS_DEFAULTS.deadGrowthThreshold) {
        alerts.push({
            type: 'dead_queue_growth',
            severity: 'critical',
            message: `Dead queue grew by ${deadGrowth10m} in the last 10 minutes.`,
            value: deadGrowth10m,
            threshold: OUTBOX_ALERTS_DEFAULTS.deadGrowthThreshold
        });
    }

    if ((health.oldestPendingSeconds || 0) >= OUTBOX_ALERTS_DEFAULTS.backlogAgeThresholdSeconds) {
        alerts.push({
            type: 'pending_backlog_age',
            severity: 'critical',
            message: `Oldest pending event age is ${health.oldestPendingSeconds}s.`,
            value: health.oldestPendingSeconds || 0,
            threshold: OUTBOX_ALERTS_DEFAULTS.backlogAgeThresholdSeconds
        });
    }

    if (
        (health.queueCounts?.pending || 0) > 0
        && health.secondsSinceLastProcessed !== null
        && health.secondsSinceLastProcessed >= OUTBOX_ALERTS_DEFAULTS.workerIdleThresholdSeconds
    ) {
        alerts.push({
            type: 'worker_idle',
            severity: 'critical',
            message: `No outbox event has been processed for ${health.secondsSinceLastProcessed}s while backlog exists.`,
            value: health.secondsSinceLastProcessed,
            threshold: OUTBOX_ALERTS_DEFAULTS.workerIdleThresholdSeconds
        });
    }

    return {
        enabled: true,
        generated_at: new Date().toISOString(),
        alerts,
        thresholds: OUTBOX_ALERTS_DEFAULTS,
        health
    };
};

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
        const parsedDays = Number.parseInt(req.query.days, 10);
        const timeRange = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 7), 365) : 30;
        const query = `
            WITH all_days AS (
                SELECT generate_series(
                    CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day'),
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
        const { rows } = await db.query(query, [timeRange]);
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
            topProductsRes,
            searchSyncHealth
        ] = await Promise.all([
            // Today's revenue
            db.query(`
                SELECT
                    COALESCE(SUM(total_amount) FILTER (WHERE invoice_date::date = CURRENT_DATE), 0) as today_revenue,
                    COALESCE(SUM(total_amount) FILTER (WHERE invoice_date::date = CURRENT_DATE - INTERVAL '1 day'), 0) as yesterday_revenue
                FROM invoice 
                WHERE status IN ('Paid', 'Partially Paid')
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
                WITH stock_totals AS (
                    SELECT part_id, SUM(quantity) as quantity
                    FROM inventory_transaction
                    GROUP BY part_id
                )
                SELECT COUNT(*) as low_stock_count
                FROM part p
                LEFT JOIN stock_totals st ON st.part_id = p.part_id
                WHERE p.low_stock_warning = TRUE 
                AND COALESCE(st.quantity, 0) <= p.warning_quantity
                AND p.is_active = TRUE
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
            `),
            getSearchSyncHealth()
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
            })),
            searchSyncHealth
        };

        res.json(enhancedStats);
    } catch (err) {
        console.error('Enhanced dashboard stats error:', err);
        res.status(500).json({ message: 'Failed to fetch enhanced dashboard stats' });
    }
});

// GET /dashboard/search-sync-health - Metrics endpoint for search sync outbox health
router.get('/dashboard/search-sync-health', async (req, res) => {
    try {
        const searchSyncHealth = await getSearchSyncHealth();
        res.json(searchSyncHealth);
    } catch (err) {
        console.error('Search sync health error:', err);
        res.status(500).json({ message: 'Failed to fetch search sync health' });
    }
});

// GET /dashboard/search-sync-alerts - Alert state endpoint for search sync outbox health
router.get('/dashboard/search-sync-alerts', async (req, res) => {
    try {
        const payload = await getSearchSyncAlerts();
        res.json(payload);
    } catch (err) {
        console.error('Search sync alerts error:', err);
        res.status(500).json({ message: 'Failed to fetch search sync alerts' });
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
