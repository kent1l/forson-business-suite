const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /ar/dashboard-stats - Get AR dashboard statistics
router.get('/ar/dashboard-stats', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Default to last 30 days if no date range provided
        const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const end = endDate || new Date().toISOString();

        const [totalReceivablesRes, invoicesSentRes, overdueInvoicesRes, avgCollectionRes] = await Promise.all([
            // Total receivables
            db.query(`
                SELECT COALESCE(SUM(i.total_amount - i.amount_paid), 0) as total_receivables
                FROM invoice i 
                WHERE i.status IN ('Unpaid', 'Partially Paid')
            `),
            
            // Invoices sent in date range
            db.query(`
                SELECT COUNT(*) as invoices_sent
                FROM invoice i
                WHERE i.invoice_date >= $1 AND i.invoice_date <= $2
            `, [start, end]),
            
            // Overdue invoices count
            db.query(`
                SELECT COUNT(*) as overdue_count
                FROM invoice i
                WHERE i.status IN ('Unpaid', 'Partially Paid') 
                AND i.due_date < CURRENT_DATE
            `),
            
            // Average collection period (in days)
            db.query(`
                SELECT 
                    COALESCE(AVG(
                        CASE 
                            WHEN i.status = 'Paid' THEN 
                                EXTRACT(days FROM (
                                    (SELECT MAX(ip.created_at) FROM invoice_payments ip WHERE ip.invoice_id = i.invoice_id) 
                                    - i.invoice_date
                                ))
                            ELSE NULL
                        END
                    ), 30) as avg_collection_days
                FROM invoice i
                WHERE i.invoice_date >= ($1::timestamp - INTERVAL '90 days')
                AND i.status = 'Paid'
            `, [start])
        ]);

        const stats = {
            totalReceivables: parseFloat(totalReceivablesRes.rows[0].total_receivables) || 0,
            invoicesSent: parseInt(invoicesSentRes.rows[0].invoices_sent) || 0,
            overdueInvoices: parseInt(overdueInvoicesRes.rows[0].overdue_count) || 0,
            avgCollectionPeriod: Math.round(parseFloat(avgCollectionRes.rows[0].avg_collection_days) || 30)
        };

        res.json(stats);
    } catch (err) {
        console.error('AR Dashboard Stats Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch AR dashboard stats' });
    }
});

// GET /ar/aging-summary - Get invoice aging data
router.get('/ar/aging-summary', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const query = `
            WITH aging_buckets AS (
                SELECT 
                    CASE 
                        WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE THEN 'Current'
                        WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                        WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                        WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
                        ELSE '90+ Days'
                    END as bucket_name,
                    COALESCE(SUM(i.total_amount - i.amount_paid), 0) as bucket_value
                FROM invoice i
                WHERE i.status IN ('Unpaid', 'Partially Paid')
                GROUP BY 
                    CASE 
                        WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE THEN 'Current'
                        WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                        WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                        WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
                        ELSE '90+ Days'
                    END
            )
            SELECT bucket_name as name, bucket_value as value
            FROM aging_buckets
            ORDER BY 
                CASE bucket_name
                    WHEN 'Current' THEN 1
                    WHEN '1-30 Days' THEN 2
                    WHEN '31-60 Days' THEN 3
                    WHEN '61-90 Days' THEN 4
                    ELSE 5
                END;
        `;
        
        const { rows } = await db.query(query);
        
        // Ensure all buckets are present, even if empty
        const allBuckets = ['Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'];
        const agingData = allBuckets.map(bucket => {
            const existing = rows.find(row => row.name === bucket);
            return {
                name: bucket,
                value: existing ? parseFloat(existing.value) : 0
            };
        });

        res.json(agingData);
    } catch (err) {
        console.error('AR Aging Summary Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch aging summary' });
    }
});

// GET /ar/customer-summary - Get customer-level AR summary
router.get('/ar/customer-summary', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        
        const query = `
            SELECT 
                c.customer_id,
                c.company_name,
                c.first_name,
                c.last_name,
                COALESCE(SUM(i.total_amount - i.amount_paid), 0) as total_balance_due,
                MIN(i.due_date) as earliest_due_date,
                COUNT(i.invoice_id) as invoice_count,
                CASE 
                    WHEN MIN(COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days')) >= CURRENT_DATE THEN 'Current'
                    WHEN MIN(COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days')) >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                    WHEN MIN(COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days')) >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                    WHEN MIN(COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days')) >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
                    ELSE '90+ Days'
                END as status
            FROM customer c
            JOIN invoice i ON c.customer_id = i.customer_id
            WHERE i.status IN ('Unpaid', 'Partially Paid')
            AND (i.total_amount - i.amount_paid) > 0
            GROUP BY c.customer_id, c.company_name, c.first_name, c.last_name
            HAVING COALESCE(SUM(i.total_amount - i.amount_paid), 0) > 0
            ORDER BY earliest_due_date ASC, total_balance_due DESC
            LIMIT $1 OFFSET $2;
        `;
        
        const { rows } = await db.query(query, [limit, offset]);
        res.json(rows);
    } catch (err) {
        console.error('AR Customer Summary Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch customer summary' });
    }
});

// GET /ar/customer-invoices - Get all invoices for a specific customer
router.get('/ar/customer-invoices/:customerId', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { customerId } = req.params;
        const { limit = 100, offset = 0 } = req.query;
        
        const query = `
            SELECT 
                i.invoice_id,
                i.invoice_number,
                i.physical_receipt_no,
                i.invoice_date,
                i.due_date,
                i.total_amount,
                i.amount_paid,
                (i.total_amount - i.amount_paid) as balance_due,
                c.customer_id,
                c.company_name,
                c.first_name,
                c.last_name,
                EXTRACT(days FROM (CURRENT_DATE - COALESCE(i.due_date, CURRENT_DATE - INTERVAL '90 days'))) as days_overdue,
                CASE 
                    WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE THEN 'Current'
                    WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                    WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                    WHEN COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days') >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
                    ELSE '90+ Days'
                END as status
            FROM invoice i
            JOIN customer c ON i.customer_id = c.customer_id
            WHERE i.customer_id = $1
            AND i.status IN ('Unpaid', 'Partially Paid')
            AND (i.total_amount - i.amount_paid) > 0
            ORDER BY i.due_date ASC, (i.total_amount - i.amount_paid) DESC
            LIMIT $2 OFFSET $3;
        `;
        
        const { rows } = await db.query(query, [customerId, limit, offset]);
        res.json(rows);
    } catch (err) {
        console.error('AR Customer Invoices Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch customer invoices' });
    }
});// GET /ar/trends - Get trend data for comparison
router.get('/ar/trends', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const query = `
            WITH current_period AS (
                SELECT 
                    COALESCE(SUM(i.total_amount - i.amount_paid), 0) as current_receivables,
                    COUNT(CASE WHEN i.due_date < CURRENT_DATE THEN 1 END) as current_overdue
                FROM invoice i
                WHERE i.status IN ('Unpaid', 'Partially Paid')
            ),
            previous_period AS (
                SELECT 
                    COALESCE(SUM(i.total_amount - i.amount_paid), 0) as previous_receivables,
                    COUNT(CASE WHEN i.due_date < (CURRENT_DATE - INTERVAL '30 days') THEN 1 END) as previous_overdue
                FROM invoice i
                WHERE i.status IN ('Unpaid', 'Partially Paid')
                AND i.invoice_date <= CURRENT_DATE - INTERVAL '30 days'
            )
            SELECT 
                cp.current_receivables,
                cp.current_overdue,
                pp.previous_receivables,
                pp.previous_overdue,
                CASE 
                    WHEN pp.previous_receivables > 0 THEN 
                        ROUND(((cp.current_receivables - pp.previous_receivables) / pp.previous_receivables * 100)::numeric, 1)
                    ELSE 0 
                END as receivables_change_percent,
                CASE 
                    WHEN pp.previous_overdue > 0 THEN 
                        ROUND(((cp.current_overdue - pp.previous_overdue)::numeric / pp.previous_overdue * 100)::numeric, 1)
                    ELSE 0 
                END as overdue_change_percent
            FROM current_period cp, previous_period pp;
        `;
        
        const { rows } = await db.query(query);
        res.json(rows[0] || {});
    } catch (err) {
        console.error('AR Trends Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch trend data' });
    }
});

// GET /ar/drill-down-invoices - Get invoices for a specific aging bucket
router.get('/ar/drill-down-invoices', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { bucket, startDate, endDate, limit = 100, offset = 0 } = req.query;

        if (!bucket) {
            return res.status(400).json({ message: 'Bucket parameter is required' });
        }

        // Map bucket names to date conditions
        const bucketConditions = {
            'current': 'COALESCE(i.due_date, CURRENT_DATE) >= CURRENT_DATE',
            '1-30': 'COALESCE(i.due_date, CURRENT_DATE) >= CURRENT_DATE - INTERVAL \'30 days\' AND COALESCE(i.due_date, CURRENT_DATE) < CURRENT_DATE',
            '31-60': 'COALESCE(i.due_date, CURRENT_DATE) >= CURRENT_DATE - INTERVAL \'60 days\' AND COALESCE(i.due_date, CURRENT_DATE) < CURRENT_DATE - INTERVAL \'30 days\'',
            '61-90': 'COALESCE(i.due_date, CURRENT_DATE) >= CURRENT_DATE - INTERVAL \'90 days\' AND COALESCE(i.due_date, CURRENT_DATE) < CURRENT_DATE - INTERVAL \'60 days\'',
            '90-plus': 'COALESCE(i.due_date, CURRENT_DATE - INTERVAL \'91 days\') < CURRENT_DATE - INTERVAL \'90 days\''
        };

        const dateCondition = bucketConditions[bucket];
        if (!dateCondition) {
            return res.status(400).json({ message: 'Invalid bucket parameter' });
        }

        // Build the query with date range filter if provided
        let dateRangeCondition = '';
        let queryParams = [limit, offset];
        let paramIndex = 3;

        if (startDate && endDate) {
            dateRangeCondition = ` AND i.invoice_date >= $${paramIndex} AND i.invoice_date <= $${paramIndex + 1}`;
            queryParams.push(startDate, endDate);
        }

        const query = `
            SELECT
                i.invoice_id,
                i.invoice_number,
                i.physical_receipt_no,
                i.invoice_date,
                i.due_date,
                i.total_amount,
                i.amount_paid,
                (i.total_amount - i.amount_paid) as balance_due,
                c.customer_id,
                c.company_name,
                c.first_name,
                c.last_name,
                EXTRACT(days FROM (CURRENT_DATE - COALESCE(i.due_date, CURRENT_DATE - INTERVAL '90 days'))) as days_overdue
            FROM invoice i
            LEFT JOIN customer c ON i.customer_id = c.customer_id
            WHERE i.status IN ('Unpaid', 'Partially Paid')
            AND (i.total_amount - i.amount_paid) > 0
            AND ${dateCondition}
            ${dateRangeCondition}
            ORDER BY i.due_date ASC, (i.total_amount - i.amount_paid) DESC
            LIMIT $1 OFFSET $2;
        `;

        const { rows } = await db.query(query, queryParams);
        res.json(rows);
    } catch (err) {
        console.error('AR Drill-down Invoices Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch drill-down invoices' });
    }
});

// GET /ar/invoice-due-date-history/:invoiceId - Get due date change history for an invoice
router.get('/ar/invoice-due-date-history/:invoiceId', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { limit = 100, offset = 0 } = req.query;

        // Verify invoice exists and pull key header fields, including creator info
        const { rows: invRows } = await db.query(`
            SELECT 
                i.invoice_id,
                i.invoice_number,
                i.invoice_date,
                i.due_date AS current_due_date,
                i.employee_id AS created_by_employee_id,
                e.first_name AS created_by_first_name,
                e.last_name AS created_by_last_name,
                c.customer_id,
                c.company_name,
                c.first_name AS customer_first_name,
                c.last_name AS customer_last_name
            FROM invoice i
            JOIN employee e ON i.employee_id = e.employee_id
            JOIN customer c ON i.customer_id = c.customer_id
            WHERE i.invoice_id = $1
        `, [invoiceId]);

        if (invRows.length === 0) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const invoiceHeader = invRows[0];

        // Get the due date history (ascending for timeline construction)
        const historyQuery = `
            SELECT
                ddl.log_id,
                ddl.old_due_date,
                ddl.new_due_date,
                ddl.days_adjustment,
                ddl.edited_on,
                ddl.reason,
                ddl.system_generated,
                e.employee_id,
                e.first_name,
                e.last_name,
                e.username
            FROM due_date_log ddl
            JOIN employee e ON ddl.edited_by = e.employee_id
            WHERE ddl.invoice_id = $1
            ORDER BY ddl.edited_on ASC
            LIMIT $2 OFFSET $3;
        `;

        const { rows } = await db.query(historyQuery, [invoiceId, limit, offset]);

        const history = rows.map(row => ({
            log_id: row.log_id,
            old_due_date: row.old_due_date,
            new_due_date: row.new_due_date,
            days_adjustment: row.days_adjustment,
            edited_on: row.edited_on,
            reason: row.reason,
            system_generated: row.system_generated,
            edited_by: {
                employee_id: row.employee_id,
                first_name: row.first_name,
                last_name: row.last_name,
                username: row.username,
                full_name: `${row.first_name} ${row.last_name}`.trim()
            }
        }));

        // Build full timeline from initial to current due date
        // Determine initial due date: earliest old_due_date if available; otherwise use current_due_date
        const earliest = history.length > 0 ? history[0] : null;
        const initialDueDate = earliest && earliest.old_due_date ? earliest.old_due_date : invoiceHeader.current_due_date;

        const timeline = [];

        // Initial row (invoice creation)
        timeline.push({
            kind: 'initial',
            edited_on: invoiceHeader.invoice_date,
            edited_by: {
                employee_id: invoiceHeader.created_by_employee_id,
                first_name: invoiceHeader.created_by_first_name,
                last_name: invoiceHeader.created_by_last_name,
                username: null,
                full_name: `${invoiceHeader.created_by_first_name} ${invoiceHeader.created_by_last_name}`.trim()
            },
            due_date: initialDueDate,
            reason: 'Initial due date',
        });

        // Subsequent edits from history
        for (const h of history) {
            timeline.push({
                kind: 'edit',
                edited_on: h.edited_on,
                edited_by: h.edited_by,
                due_date: h.new_due_date,
                days_adjustment: h.days_adjustment,
                reason: h.reason || null,
            });
        }

        res.json({
            invoice: {
                invoice_id: invoiceHeader.invoice_id,
                invoice_number: invoiceHeader.invoice_number,
                invoice_date: invoiceHeader.invoice_date,
                current_due_date: invoiceHeader.current_due_date,
                customer: {
                    customer_id: invoiceHeader.customer_id,
                    company_name: invoiceHeader.company_name,
                    first_name: invoiceHeader.customer_first_name,
                    last_name: invoiceHeader.customer_last_name
                }
            },
            history, // keep raw history for debugging/back-compat
            timeline
        });
    } catch (err) {
        console.error('AR Invoice Due Date History Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch due date history' });
    }
});

module.exports = router;