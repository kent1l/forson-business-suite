const express = require('express');
const fs = require('fs');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const arLedger = require('../services/arLedgerService');
const pdcService = require('../services/pdcService');
const { generateStatementOfAccountPDF } = require('../helpers/pdf/soaPdf');
const router = express.Router();

// GET /ar/dashboard-stats - Get AR dashboard statistics
router.get('/ar/dashboard-stats', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Default to last 30 days if no date range provided
        const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const end = endDate || new Date().toISOString();

        const [totalReceivablesRes, invoicesSentRes, overdueInvoicesRes, avgCollectionRes] = await Promise.all([
            // Total receivables — authoritative: sum of positive ledger balances
            db.query(`
                SELECT COALESCE(SUM(ledger_balance), 0) AS total_receivables
                FROM vw_customer_ar_balance
                WHERE ledger_balance > 0
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
                                    (SELECT MAX(COALESCE(ip.settled_at, ip.created_at)) FROM invoice_payments ip WHERE ip.invoice_id = i.invoice_id) 
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
                        WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE THEN 'Current'
                        WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                        WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                        WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
                        ELSE '90+ Days'
                    END as bucket_name,
                    COALESCE(SUM(i.total_amount - i.amount_paid), 0) as bucket_value
                FROM invoice i
                WHERE i.status IN ('Unpaid', 'Partially Paid')
                GROUP BY 
                    CASE 
                        WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE THEN 'Current'
                        WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                        WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                        WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
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
        const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
        const { search, status, sortBy, sortDir } = req.query;
        
        const params = [];
        let paramIdx = 1;
        let searchWhere = '';
        if (search && search.trim()) {
            searchWhere = `AND (
                LOWER(COALESCE(c.company_name, '')) LIKE $${paramIdx} OR
                LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE $${paramIdx} OR
                LOWER(COALESCE(c.phone, '')) LIKE $${paramIdx}
            )`;
            params.push(`%${search.trim().toLowerCase()}%`);
            paramIdx++;
        }

        let havingClause = 'HAVING b.ledger_balance > 0';
        if (status === 'CREDIT_HOLD') {
            searchWhere += ' AND c.credit_hold = TRUE';
        } else if (status === 'CURRENT') {
            havingClause += " AND MIN(COALESCE(i.due_date, i.invoice_date)) >= CURRENT_DATE";
        } else if (status === 'OVERDUE') {
            havingClause += " AND MIN(COALESCE(i.due_date, i.invoice_date)) < CURRENT_DATE";
        }

        let orderBy = 'ORDER BY invoice_count DESC, earliest_due_date ASC, total_balance_due DESC';
        if (sortBy) {
            const dir = (sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            if (sortBy === 'customer_name') {
                orderBy = `ORDER BY COALESCE(NULLIF(c.company_name, ''), c.first_name || ' ' || c.last_name) ${dir}`;
            } else if (sortBy === 'invoice_count') {
                orderBy = `ORDER BY invoice_count ${dir}`;
            } else if (sortBy === 'earliest_due_date') {
                orderBy = `ORDER BY earliest_due_date ${dir} NULLS LAST`;
            } else if (sortBy === 'total_balance_due') {
                orderBy = `ORDER BY total_balance_due ${dir}`;
            } else if (sortBy === 'status') {
                orderBy = `ORDER BY status ${dir}`;
            }
        }

        const query = `
            SELECT 
                c.customer_id,
                c.company_name,
                c.first_name,
                c.last_name,
                c.credit_hold,
                c.phone,
                b.ledger_balance                                    AS total_balance_due,
                COALESCE(w.balance, 0)                              AS wallet_balance,
                MIN(COALESCE(i.due_date, i.invoice_date))          AS earliest_due_date,
                COUNT(DISTINCT i.invoice_id)                        AS invoice_count,
                CASE 
                    WHEN MIN(COALESCE(i.due_date, i.invoice_date)) >= CURRENT_DATE THEN 'Current'
                    WHEN MIN(COALESCE(i.due_date, i.invoice_date)) >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                    WHEN MIN(COALESCE(i.due_date, i.invoice_date)) >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                    WHEN MIN(COALESCE(i.due_date, i.invoice_date)) >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
                    ELSE '90+ Days'
                END as status
            FROM customer c
            JOIN vw_customer_ar_balance b ON b.customer_id = c.customer_id
            LEFT JOIN customer_wallet w ON c.customer_id = w.customer_id
            LEFT JOIN invoice i ON c.customer_id = i.customer_id AND i.status IN ('Unpaid', 'Partially Paid')
            WHERE b.ledger_balance > 0
            ${searchWhere}
            GROUP BY c.customer_id, c.company_name, c.first_name, c.last_name, c.credit_hold, c.phone, b.ledger_balance, w.balance
            ${havingClause}
            ${orderBy}
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1};
        `;
        
        const queryParams = [...params, limit, offset];
        const { rows } = await db.query(query, queryParams);

        if (!paginated) return res.json(rows);

        const countQuery = `
            SELECT COUNT(*)::int AS total
            FROM (
                SELECT c.customer_id
                FROM customer c
                JOIN vw_customer_ar_balance b ON b.customer_id = c.customer_id
                LEFT JOIN invoice i ON c.customer_id = i.customer_id AND i.status IN ('Unpaid', 'Partially Paid')
                WHERE b.ledger_balance > 0
                ${searchWhere}
                GROUP BY c.customer_id, b.ledger_balance
                ${havingClause}
            ) summary
        `;
        const countRes = await db.query(countQuery, params);
        const total = countRes.rows[0]?.total || 0;
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
    } catch (err) {
        console.error('AR Customer Summary Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch customer summary' });
    }
});

// GET /ar/customer-invoices - Get all invoices for a specific customer
router.get('/ar/customer-invoices/:customerId', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { customerId } = req.params;
        const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
        
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
                GREATEST(EXTRACT(days FROM (CURRENT_DATE - COALESCE(i.due_date, i.invoice_date))), 0) as days_overdue,
                CASE 
                    WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE THEN 'Current'
                    WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                    WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                    WHEN COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
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
        if (!paginated) return res.json(rows);
        const countRes = await db.query(`
            SELECT COUNT(*)::int AS total
            FROM invoice i
            WHERE i.customer_id = $1
            AND i.status IN ('Unpaid', 'Partially Paid')
            AND (i.total_amount - i.amount_paid) > 0
        `, [customerId]);
        const total = countRes.rows[0]?.total || 0;
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
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
        const { bucket, startDate, endDate } = req.query;
        const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);

        if (!bucket) {
            return res.status(400).json({ message: 'Bucket parameter is required' });
        }

        // Map bucket names to date conditions
        const bucketConditions = {
            'current':  'COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE',
            '1-30':     'COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL \'30 days\' AND COALESCE(i.due_date, i.invoice_date) < CURRENT_DATE',
            '31-60':    'COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL \'60 days\' AND COALESCE(i.due_date, i.invoice_date) < CURRENT_DATE - INTERVAL \'30 days\'',
            '61-90':    'COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE - INTERVAL \'90 days\' AND COALESCE(i.due_date, i.invoice_date) < CURRENT_DATE - INTERVAL \'60 days\'',
            '90-plus':  'COALESCE(i.due_date, i.invoice_date) < CURRENT_DATE - INTERVAL \'90 days\''
        };

        const dateCondition = bucketConditions[bucket];
        if (!dateCondition) {
            return res.status(400).json({ message: 'Invalid bucket parameter' });
        }

        // Build the query with date range filter if provided
        let dateRangeCondition = '';
        let queryParams = [];
        let paramIndex = 1;

        if (startDate && endDate) {
            dateRangeCondition = ` AND i.invoice_date >= $${paramIndex} AND i.invoice_date <= $${paramIndex + 1}`;
            queryParams.push(startDate, endDate);
            paramIndex += 2;
        }

        let query = `
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
                GREATEST(EXTRACT(days FROM (CURRENT_DATE - COALESCE(i.due_date, i.invoice_date))), 0) as days_overdue
            FROM invoice i
            LEFT JOIN customer c ON i.customer_id = c.customer_id
            WHERE i.status IN ('Unpaid', 'Partially Paid')
            AND (i.total_amount - i.amount_paid) > 0
            AND ${dateCondition}
            ${dateRangeCondition}
            ORDER BY i.due_date ASC, (i.total_amount - i.amount_paid) DESC
        `;
        if (!paginated) {
            const { rows } = await db.query(query, queryParams);
            return res.json(rows);
        }
        const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM (${query}) drilldown`, queryParams);
        const total = countRes.rows[0]?.total || 0;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        queryParams.push(limit, offset);
        const { rows } = await db.query(query, queryParams);
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
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

// GET /api/ar/verify-integrity - Check for drift between trigger-maintained amount_paid and raw payment sums
router.get('/ar/verify-integrity', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT
                i.invoice_id,
                i.invoice_number,
                i.amount_paid                                                            AS stored_amount_paid,
                COALESCE(SUM(CASE WHEN ip.payment_status = 'settled'
                             THEN ip.amount_paid ELSE 0 END), 0)                         AS computed_amount_paid,
                i.amount_paid - COALESCE(SUM(CASE WHEN ip.payment_status = 'settled'
                                THEN ip.amount_paid ELSE 0 END), 0)                      AS drift
            FROM invoice i
            LEFT JOIN invoice_payments ip ON ip.invoice_id = i.invoice_id
            GROUP BY i.invoice_id, i.invoice_number, i.amount_paid
            HAVING ABS(
                i.amount_paid - COALESCE(SUM(CASE WHEN ip.payment_status = 'settled'
                                THEN ip.amount_paid ELSE 0 END), 0)
            ) > 0.01
            ORDER BY ABS(i.amount_paid - COALESCE(SUM(CASE WHEN ip.payment_status = 'settled'
                                THEN ip.amount_paid ELSE 0 END), 0)) DESC
            LIMIT 100;
        `);
        res.json({
            valid: rows.length === 0,
            drift_count: rows.length,
            issues: rows
        });
    } catch (err) {
        console.error('AR Integrity Check Error:', err.message);
        res.status(500).json({ message: 'Failed to run integrity check' });
    }
});



// GET /api/ar/ledger/:customerId - Chronological ledger history with running balance
router.get('/ar/ledger/:customerId', protect, hasPermission('ar:view'), async (req, res) => {
    const customerId = parseInt(req.params.customerId, 10);
    if (!customerId) return res.status(400).json({ message: 'Invalid customer ID' });
    const { limit = 100, offset = 0 } = req.query;
    try {
        const { rows } = await db.query(`
            SELECT
                l.ledger_id, l.entry_type, l.amount, l.balance_after,
                l.payment_channel, l.reference_no, l.notes, l.created_at,
                l.invoice_id, i.invoice_number,
                l.payment_id,
                l.cn_id, cn.cn_number,
                e.first_name || ' ' || COALESCE(e.last_name, '') AS created_by_name
            FROM ar_ledger l
            LEFT JOIN invoice i      ON i.invoice_id  = l.invoice_id
            LEFT JOIN credit_note cn ON cn.cn_id       = l.cn_id
            LEFT JOIN employee e     ON e.employee_id  = l.created_by
            WHERE l.customer_id = $1
            ORDER BY l.ledger_id ASC
            LIMIT $2 OFFSET $3
        `, [customerId, parseInt(limit), parseInt(offset)]);
        const { rows: [{ total }] } = await db.query(
            'SELECT COUNT(*)::int AS total FROM ar_ledger WHERE customer_id = $1', [customerId]);
        res.json({ rows, total });
    } catch (err) {
        console.error('AR Ledger fetch error:', err.message);
        res.status(500).json({ message: 'Server error fetching AR ledger.' });
    }
});

// POST /api/ar/ledger/:customerId/adjustment - Manual debit or credit adjustment (ar:manage only)
router.post('/ar/ledger/:customerId/adjustment', protect, hasPermission('ar:manage'), async (req, res) => {
    const customerId = parseInt(req.params.customerId, 10);
    if (!customerId) return res.status(400).json({ message: 'Invalid customer ID' });

    const { entry_type, amount, reference_no, notes } = req.body;
    const { employee_id } = req.user;

    if (!['DEBIT_ADJUSTMENT', 'CREDIT_ADJUSTMENT'].includes(entry_type)) {
        return res.status(400).json({ message: 'entry_type must be DEBIT_ADJUSTMENT or CREDIT_ADJUSTMENT' });
    }
    const parsedAmount = parseFloat(String(amount || '').replace(/[^0-9.]+/g, ''));
    if (!parsedAmount || parsedAmount <= 0) {
        return res.status(400).json({ message: 'amount must be a positive number' });
    }
    if (!notes || notes.trim().length < 5) {
        return res.status(400).json({ message: 'notes is required (min 5 chars) for audit trail' });
    }

    // DEBIT_ADJUSTMENT increases balance (+), CREDIT_ADJUSTMENT decreases (-)
    const signedAmount = entry_type === 'DEBIT_ADJUSTMENT' ? parsedAmount : -parsedAmount;

    const client = await db.getClient();
    try {
        const { rows: cust } = await client.query(
            'SELECT customer_id FROM customer WHERE customer_id = $1', [customerId]);
        if (!cust.length) return res.status(404).json({ message: 'Customer not found' });

        await client.query('BEGIN');
        const ledgerId = await arLedger.appendEntry(client, {
            customerId,
            entryType: entry_type,
            amount: signedAmount,
            referenceNo: reference_no || null,
            notes: notes.trim(),
            createdBy: employee_id,
        });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Adjustment recorded', ledger_id: ledgerId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AR Adjustment error:', err.message);
        res.status(500).json({ message: 'Server error recording adjustment.' });
    } finally {
        client.release();
    }
});

// GET /ar/pdc/summary-stats - KPI summary metrics for PDC Vault Header Cards
router.get('/ar/pdc/summary-stats', protect, hasPermission(['pdc:view', 'ar:view']), async (req, res) => {
    try {
        const stats = await pdcService.getPdcSummaryStats(db);
        res.json({ success: true, data: stats });
    } catch (err) {
        console.error('PDC Summary Stats Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch PDC summary stats' });
    }
});

// GET /ar/collections-clearance - List pending payments awaiting clearance across channels
router.get('/ar/collections-clearance', protect, hasPermission(['pdc:view', 'ar:view']), async (req, res) => {
    try {
        const { pdc_status, maturity_status } = req.query;
        const list = await pdcService.getCollectionsClearanceList(db, pdc_status, maturity_status);
        res.json({ success: true, count: list.length, data: list });
    } catch (err) {
        console.error('AR Collections Clearance List Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch collections clearance list' });
    }
});

// POST /ar/collections-clearance/:paymentId/verify - Clear / settle a pending payment or PDC
router.post('/ar/collections-clearance/:paymentId/verify', protect, hasPermission(['pdc:manage', 'ar:manage']), async (req, res) => {
    const paymentId = parseInt(req.params.paymentId, 10);
    if (!paymentId) return res.status(400).json({ message: 'Invalid payment ID' });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await pdcService.verifyPayment(client, {
            paymentId,
            sourceTable: req.body?.source_table || 'auto',
            userId: req.user?.employee_id
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Payment verified and cleared', ...result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AR Verify Payment Error:', err.message);
        res.status(500).json({ message: err.message || 'Failed to verify payment' });
    } finally {
        client.release();
    }
});

// POST /ar/collections-clearance/:paymentId/fail - Fail / bounce a payment or PDC and trigger automated reversal
router.post('/ar/collections-clearance/:paymentId/fail', protect, hasPermission(['pdc:manage', 'ar:manage']), async (req, res) => {
    const paymentId = parseInt(req.params.paymentId, 10);
    if (!paymentId) return res.status(400).json({ message: 'Invalid payment ID' });

    const { bounce_fee, reason, source_table } = req.body;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await pdcService.processBouncedCheque(client, {
            paymentId,
            sourceTable: source_table || 'auto',
            bounceFee: bounce_fee,
            reason,
            userId: req.user?.employee_id
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Payment bounced and reversal processed', ...result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AR Fail Payment Error:', err.message);
        res.status(500).json({ message: err.message || 'Failed to process bounced payment' });
    } finally {
        client.release();
    }
});

// POST /ar/collections-clearance/:paymentId/redeposit - Re-deposit a bounced cheque
router.post('/ar/collections-clearance/:paymentId/redeposit', protect, hasPermission(['pdc:manage', 'ar:manage']), async (req, res) => {
    const paymentId = parseInt(req.params.paymentId, 10);
    if (!paymentId) return res.status(400).json({ message: 'Invalid payment ID' });

    const { lift_credit_hold, notes, source_table } = req.body;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await pdcService.processRedepositCheque(client, {
            paymentId,
            sourceTable: source_table || 'auto',
            liftCreditHold: Boolean(lift_credit_hold),
            notes,
            userId: req.user?.user_id || req.user?.employee_id
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Cheque re-deposited successfully for clearance', data: result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AR Redeposit Payment Error:', err.message);
        res.status(400).json({ message: err.message || 'Failed to re-deposit cheque' });
    } finally {
        client.release();
    }
});

// GET /ar/collections-clearance/:paymentId/history - Get audit history for a specific payment/cheque
router.get('/ar/collections-clearance/:paymentId/history', protect, hasPermission(['pdc:view', 'ar:view']), async (req, res) => {
    try {
        const paymentId = parseInt(req.params.paymentId, 10);
        if (!paymentId) return res.status(400).json({ message: 'Invalid payment ID' });

        const sourceTable = req.query.source_table || 'auto';
        const history = await pdcService.getChequeClearanceHistory(db, paymentId, sourceTable);
        res.json({ success: true, data: history });
    } catch (err) {
        console.error('AR Clearance History Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch cheque clearance history' });
    }
});

async function fetchGlobalCompanySettings(dbClient) {
    try {
        const { rows } = await dbClient.query(`
            SELECT setting_key, setting_value FROM settings
            WHERE setting_key IN (
                'COMPANY_NAME', 'COMPANY_ADDRESS', 'COMPANY_PHONE', 'COMPANY_EMAIL',
                'COMPANY_WEBSITE', 'COMPANY_TIN', 'COMPANY_TAX_ID', 'COMPANY_BANK_NAME',
                'COMPANY_BANK_ACCOUNT', 'DEFAULT_PAYMENT_TERMS'
            )
        `);
        const s = rows.reduce((acc, { setting_key, setting_value }) => {
            if (setting_key && setting_value && setting_value.trim()) {
                acc[setting_key] = setting_value.trim();
            }
            return acc;
        }, {});
        return {
            name:          s.COMPANY_NAME         || '',
            address:       s.COMPANY_ADDRESS      || '',
            phone:         s.COMPANY_PHONE        || '',
            email:         s.COMPANY_EMAIL        || '',
            website:       s.COMPANY_WEBSITE      || '',
            tin:           s.COMPANY_TIN          || s.COMPANY_TAX_ID || '',
            bank_name:     s.COMPANY_BANK_NAME    || '',
            bank_account:  s.COMPANY_BANK_ACCOUNT || '',
            default_terms: s.DEFAULT_PAYMENT_TERMS || '',
        };
    } catch {
        return {
            name: '', address: '', phone: '', email: '', website: '', tin: '', bank_name: '', bank_account: '', default_terms: ''
        };
    }
}

// GET /ar/customers/:customerId/ledger - Interactive ledger history for SOA
router.get('/ar/customers/:customerId/ledger', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { customerId } = req.params;
        const { startDate, endDate } = req.query;

        const companyInfo = await fetchGlobalCompanySettings(db);

        const custRes = await db.query(`
            SELECT c.*,
                   COALESCE(w.balance, 0) AS wallet_balance
            FROM customer c
            LEFT JOIN customer_wallet w ON c.customer_id = w.customer_id
            WHERE c.customer_id = $1
        `, [customerId]);
        if (custRes.rows.length === 0) return res.status(404).json({ message: 'Customer not found' });
        const customer = custRes.rows[0];

        const startFilter = startDate ? new Date(startDate) : null;
        const endFilter   = endDate   ? new Date(endDate)   : null;

        // Ledger with full context: invoice dates, due dates, payment channel, credit note numbers
        const ledgerRes = await db.query(`
            SELECT
                l.ledger_id,
                l.entry_type,
                l.amount,
                l.balance_after,
                l.invoice_id,
                l.payment_id,
                l.cn_id,
                l.reference_no,
                l.payment_channel,
                l.notes,
                l.created_at,
                l.created_by,
                i.invoice_number,
                i.physical_receipt_no,
                i.invoice_date,
                i.due_date,
                i.terms                     AS invoice_terms,
                i.total_amount              AS invoice_total,
                cn.cn_number,
                cn.refund_date              AS cn_date
            FROM ar_ledger l
            LEFT JOIN invoice i  ON l.invoice_id = i.invoice_id
            LEFT JOIN credit_note cn ON l.cn_id  = cn.cn_id
            WHERE l.customer_id = $1
            ORDER BY l.created_at ASC, l.ledger_id ASC
        `, [customerId]);

        // Pending cheques: customer_payment rows that are RECEIVED/DEPOSITED (not yet cleared)
        // These affect committed invoice balances but NOT the ar_ledger cash balance.
        const pendingChequeRes = await db.query(`
            SELECT COALESCE(SUM(cp.amount), 0) AS pending_cheque_total,
                   COUNT(*)::int               AS pending_cheque_count
            FROM customer_payment cp
            LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
            WHERE cp.customer_id = $1
              AND cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED')
              AND (pm.type = 'cheque' OR pm.code IN ('cheque', 'pdc') OR
                   cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED'))
        `, [customerId]);
        const pendingCheques = pendingChequeRes.rows[0];

        const pendingItemsRes = await db.query(`
            SELECT cp.payment_id, cp.reference_number, cp.cheque_date, cp.amount, cp.pdc_status, pm.name AS payment_method_name
            FROM customer_payment cp
            LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
            WHERE cp.customer_id = $1
              AND cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED')
            ORDER BY cp.cheque_date ASC, cp.payment_id ASC
        `, [customerId]);

        const TYPE_LABELS = {
            INVOICE_POSTED:        'Invoice Charged',
            PAYMENT_SETTLED:       'Payment Received',
            CREDIT_MEMO_APPLIED:   'Credit Note Applied',
            DEBIT_ADJUSTMENT:      'Debit Adjustment',
            CREDIT_ADJUSTMENT:     'Credit Adjustment',
            PDC_BOUNCED_REVERSAL:  'Cheque Bounced (Reversal)',
            BOUNCE_FEE_PENALTY:    'Bounced Cheque Penalty',
        };

        let openingBalance = 0;
        let totalCharged = 0;   // sum of debits (positive amounts)
        let totalCredited = 0;  // sum of credits (negative amounts, shown as positive)
        let currentRunning = 0;
        const ledgerRows = [];

        for (const entry of ledgerRes.rows) {
            const amt = Number(entry.amount) || 0;
            const entryDate = new Date(entry.created_at);

            if (startFilter && entryDate < startFilter) {
                openingBalance += amt;
                currentRunning += amt;
                continue;
            }
            if (endFilter && entryDate > endFilter) continue;

            currentRunning += amt;
            if (amt > 0) totalCharged  += amt;
            else         totalCredited += Math.abs(amt);

            const physReceipt = entry.physical_receipt_no ? entry.physical_receipt_no.trim() : null;
            const invNum = entry.invoice_number ? entry.invoice_number.trim() : null;

            // DOC/REF #: Primary reference is strictly physical receipt provided by user (or '-' if none).
            // Sub-reference below primary is generated invoice number, CN number, or repayment tracking number (PMT-xxxx).
            const primaryRef = physReceipt || '-';
            let subRef = null;
            if (invNum && invNum !== physReceipt) {
                subRef = invNum;
            } else if (entry.cn_number && entry.cn_number !== physReceipt) {
                subRef = entry.cn_number;
            } else if (entry.payment_id) {
                const d = entry.created_at ? new Date(entry.created_at) : new Date();
                const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
                const seq = String(entry.payment_id).padStart(4, '0');
                const trackingNo = `PMT-${yyyymm}-${seq}`;
                subRef = (physReceipt && physReceipt === trackingNo) ? null : trackingNo;
            } else if (entry.reference_no && entry.reference_no !== physReceipt) {
                subRef = entry.reference_no;
            }

            ledgerRows.push({
                ledger_id:           entry.ledger_id,
                date:                entry.created_at,
                invoice_date:        entry.invoice_date   || null,
                due_date:            entry.due_date        || null,
                invoice_terms:       entry.invoice_terms  || null,
                invoice_total:       entry.invoice_total  || null,
                physical_receipt_no: physReceipt,
                invoice_number:      invNum,
                primary_ref:         primaryRef,
                sub_ref:             subRef,
                cn_number:           entry.cn_number       || null,
                event_type:          entry.entry_type,
                type_label:          TYPE_LABELS[entry.entry_type] || entry.entry_type.replace(/_/g, ' '),
                reference:           primaryRef,
                document_number:     primaryRef,
                payment_channel:     entry.payment_channel || null,
                description:         entry.notes || TYPE_LABELS[entry.entry_type] || entry.entry_type.replace(/_/g, ' '),
                debit_amount:        amt > 0 ? amt : null,
                credit_amount:       amt < 0 ? Math.abs(amt) : null,
                amount:              amt,
                running_balance:     currentRunning,
                invoice_id:          entry.invoice_id  || null,
                payment_id:          entry.payment_id  || null,
                cn_id:               entry.cn_id        || null,
            });
        }

        const dateSuffix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const statementNumber = `SOA-${customerId}-${dateSuffix}`;

        res.json({
            statement_number:       statementNumber,
            company:                companyInfo,
            customer: {
                customer_id:        customer.customer_id,
                name:               customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
                company_name:       customer.company_name,
                first_name:         customer.first_name,
                last_name:          customer.last_name,
                email:              customer.email,
                phone:              customer.phone,
                address:            customer.address,
                tin:                customer.tin || customer.tax_id || null,
                credit_limit:       customer.credit_limit,
                credit_hold:        customer.credit_hold,
                credit_hold_reason: customer.credit_hold_reason,
                payment_terms:      customer.payment_terms || companyInfo.default_terms,
                wallet_balance:     customer.wallet_balance,
                date_created:       customer.date_created,
            },
            opening_balance:        openingBalance,
            total_invoiced:         totalCharged,
            total_settled:          totalCredited,
            closing_balance:        currentRunning,
            pending_cheque_total:   parseFloat(pendingCheques.pending_cheque_total),
            pending_cheque_count:   pendingCheques.pending_cheque_count,
            pending_cheques:        pendingItemsRes.rows,
            ledger_rows:            ledgerRows,
        });
    } catch (err) {
        console.error('AR Customer Ledger Error:', err);
        res.status(500).json({ message: 'Failed to fetch customer ledger history' });
    }
});

// GET /ar/customers/:customerId/soa/pdf - Export Statement of Account PDF
router.get('/ar/customers/:customerId/soa/pdf', protect, hasPermission('ar:view'), async (req, res) => {
    try {
        const { customerId } = req.params;
        const { startDate, endDate } = req.query;

        const companyInfo = await fetchGlobalCompanySettings(db);

        const custRes = await db.query(`
            SELECT c.*,
                   COALESCE(w.balance, 0) AS wallet_balance
            FROM customer c
            LEFT JOIN customer_wallet w ON c.customer_id = w.customer_id
            WHERE c.customer_id = $1
        `, [customerId]);
        if (custRes.rows.length === 0) return res.status(404).json({ message: 'Customer not found' });
        const customer = custRes.rows[0];

        // Aging — key names match what soaPdf.js expects (days_1_30, days_31_60, etc.)
        const agingRes = await db.query(`
            SELECT
                COALESCE(SUM(CASE WHEN (CURRENT_DATE - COALESCE(i.due_date::date, i.invoice_date::date)) <= 0
                    THEN (i.total_amount - i.amount_paid) ELSE 0 END), 0)          AS current,
                COALESCE(SUM(CASE WHEN (CURRENT_DATE - COALESCE(i.due_date::date, i.invoice_date::date)) BETWEEN 1 AND 30
                    THEN (i.total_amount - i.amount_paid) ELSE 0 END), 0)          AS days_1_30,
                COALESCE(SUM(CASE WHEN (CURRENT_DATE - COALESCE(i.due_date::date, i.invoice_date::date)) BETWEEN 31 AND 60
                    THEN (i.total_amount - i.amount_paid) ELSE 0 END), 0)          AS days_31_60,
                COALESCE(SUM(CASE WHEN (CURRENT_DATE - COALESCE(i.due_date::date, i.invoice_date::date)) BETWEEN 61 AND 90
                    THEN (i.total_amount - i.amount_paid) ELSE 0 END), 0)          AS days_61_90,
                COALESCE(SUM(CASE WHEN (CURRENT_DATE - COALESCE(i.due_date::date, i.invoice_date::date)) > 90
                    THEN (i.total_amount - i.amount_paid) ELSE 0 END), 0)          AS days_90_plus
            FROM invoice i
            WHERE i.customer_id = $1
              AND (i.total_amount - i.amount_paid) > 0
              AND i.status NOT IN ('Paid', 'Voided')
        `, [customerId]);
        const aging = agingRes.rows[0] || {};

        const startFilter = startDate ? new Date(startDate) : null;
        const endFilter   = endDate   ? new Date(endDate)   : null;

        const TYPE_LABELS = {
            INVOICE_POSTED:        'Invoice Charged',
            PAYMENT_SETTLED:       'Payment Received',
            CREDIT_MEMO_APPLIED:   'Credit Note Applied',
            DEBIT_ADJUSTMENT:      'Debit Adjustment',
            CREDIT_ADJUSTMENT:     'Credit Adjustment',
            PDC_BOUNCED_REVERSAL:  'Cheque Bounced — Reversal',
            BOUNCE_FEE_PENALTY:    'Bounced Cheque Penalty',
        };

        const ledgerRes = await db.query(`
            SELECT
                l.ledger_id,
                l.entry_type,
                l.amount,
                l.invoice_id,
                l.payment_id,
                l.cn_id,
                l.reference_no,
                l.payment_channel,
                l.created_at,
                l.notes,
                i.invoice_number,
                i.physical_receipt_no,
                i.invoice_date,
                i.due_date,
                i.terms             AS invoice_terms,
                cn.cn_number,
                cn.refund_date      AS cn_date
            FROM ar_ledger l
            LEFT JOIN invoice i   ON l.invoice_id = i.invoice_id
            LEFT JOIN credit_note cn ON l.cn_id   = cn.cn_id
            WHERE l.customer_id = $1
            ORDER BY l.created_at ASC, l.ledger_id ASC
        `, [customerId]);

        // Pending cheques (committed but not yet cleared — shown as a breakdown)
        const pendingRes = await db.query(`
            SELECT COALESCE(SUM(cp.amount), 0) AS pending_total, COUNT(*)::int AS pending_count
            FROM customer_payment cp
            LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
            WHERE cp.customer_id = $1
              AND cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED')
              AND (pm.type = 'cheque' OR pm.code IN ('cheque', 'pdc') OR
                   cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED'))
        `, [customerId]);
        const pending = pendingRes.rows[0];

        const pendingItemsRes = await db.query(`
            SELECT cp.payment_id, cp.reference_number, cp.cheque_date, cp.amount, cp.pdc_status, pm.name AS payment_method_name
            FROM customer_payment cp
            LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
            WHERE cp.customer_id = $1
              AND cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED')
            ORDER BY cp.cheque_date ASC, cp.payment_id ASC
        `, [customerId]);

        let openingBalance = 0;
        let totalInvoiced = 0;
        let totalSettled = 0;
        let currentRunning = 0;
        const ledgerRows = [];

        for (const entry of ledgerRes.rows) {
            const amt = Number(entry.amount) || 0;
            const entryDate = new Date(entry.created_at);

            if (startFilter && entryDate < startFilter) {
                openingBalance += amt;
                currentRunning += amt;
                continue;
            }
            if (endFilter && entryDate > endFilter) continue;

            currentRunning += amt;
            if (amt > 0) totalInvoiced += amt;
            else         totalSettled  += Math.abs(amt);

            const physReceipt = entry.physical_receipt_no ? entry.physical_receipt_no.trim() : null;
            const invNum = entry.invoice_number ? entry.invoice_number.trim() : null;

            const primaryRef = physReceipt || '-';
            let subRef = null;
            if (invNum && invNum !== physReceipt) {
                subRef = invNum;
            } else if (entry.cn_number && entry.cn_number !== physReceipt) {
                subRef = entry.cn_number;
            } else if (entry.payment_id) {
                const d = entry.created_at ? new Date(entry.created_at) : new Date();
                const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
                const seq = String(entry.payment_id).padStart(4, '0');
                const trackingNo = `PMT-${yyyymm}-${seq}`;
                subRef = (physReceipt && physReceipt === trackingNo) ? null : trackingNo;
            } else if (entry.reference_no && entry.reference_no !== physReceipt) {
                subRef = entry.reference_no;
            }

            ledgerRows.push({
                date:                entry.created_at,
                invoice_date:        entry.invoice_date   || null,
                due_date:            entry.due_date        || null,
                invoice_terms:       entry.invoice_terms  || null,
                physical_receipt_no: physReceipt,
                invoice_number:      invNum,
                primary_ref:         primaryRef,
                sub_ref:             subRef,
                cn_number:           entry.cn_number       || null,
                event_type:          entry.entry_type,
                type_label:          TYPE_LABELS[entry.entry_type] || entry.entry_type.replace(/_/g, ' '),
                reference:           primaryRef,
                document_number:     primaryRef,
                payment_channel:     entry.payment_channel || null,
                description:         entry.notes || TYPE_LABELS[entry.entry_type] || entry.entry_type.replace(/_/g, ' '),
                debit_amount:        amt > 0 ? amt  : null,
                credit_amount:       amt < 0 ? Math.abs(amt) : null,
                running_balance:     currentRunning,
            });
        }

        const dateSuffix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const statementNumber = `SOA-${customerId}-${dateSuffix}`;

        const pdfPath = await generateStatementOfAccountPDF(customer, ledgerRows, aging, {
            company:             companyInfo,
            statementNumber,
            startDate:           startFilter,
            endDate:             endFilter || new Date(),
            openingBalance,
            totalInvoiced,
            totalSettled,
            closingBalance:      currentRunning,
            pendingChequeTotal:  parseFloat(pending.pending_total),
            pendingChequeCount:  pending.pending_count,
            pendingCheques:      pendingItemsRes.rows,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=SOA_${(customer.company_name || 'Customer').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`);
        return res.sendFile(pdfPath, (err) => {
            if (err && !res.headersSent) console.error('Error sending SOA PDF:', err);
            if (pdfPath && fs.existsSync(pdfPath)) fs.unlink(pdfPath, () => {});
        });
    } catch (err) {
        console.error('AR SOA PDF Error:', err);
        res.status(500).json({ message: 'Failed to generate Statement of Account PDF' });
    }
});

module.exports = router;

