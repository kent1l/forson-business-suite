const express = require('express');
const db = require('../db');
const { protect, hasPermission, userHasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const apPaymentService = require('../services/apPaymentService');
const grnCosting = require('../services/grnCostingService');
const router = express.Router();

// GET /ap/aging-summary - Open supplier_bill balances bucketed by age (mirrors /ar/aging-summary)
router.get('/ap/aging-summary', protect, hasPermission('ap:view'), async (req, res) => {
    try {
        const query = `
            WITH aging_buckets AS (
                SELECT
                    CASE
                        WHEN COALESCE(sb.due_date, sb.bill_date) >= CURRENT_DATE THEN 'Current'
                        WHEN COALESCE(sb.due_date, sb.bill_date) >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                        WHEN COALESCE(sb.due_date, sb.bill_date) >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                        WHEN COALESCE(sb.due_date, sb.bill_date) >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
                        ELSE '90+ Days'
                    END as bucket_name,
                    COALESCE(SUM(GREATEST(sb.total_amount - sb.amount_paid, 0)), 0) as bucket_value
                FROM supplier_bill sb
                WHERE sb.status IN ('Unpaid', 'Partially Paid')
                GROUP BY
                    CASE
                        WHEN COALESCE(sb.due_date, sb.bill_date) >= CURRENT_DATE THEN 'Current'
                        WHEN COALESCE(sb.due_date, sb.bill_date) >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                        WHEN COALESCE(sb.due_date, sb.bill_date) >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                        WHEN COALESCE(sb.due_date, sb.bill_date) >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
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

        const allBuckets = ['Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'];
        const agingData = allBuckets.map(bucket => {
            const existing = rows.find(row => row.name === bucket);
            return { name: bucket, value: existing ? parseFloat(existing.value) : 0 };
        });

        res.json(agingData);
    } catch (err) {
        console.error('AP Aging Summary Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch AP aging summary' });
    }
});

// GET /ap/summary-stats - KPI header cards for the AP monitoring dashboard
router.get('/ap/summary-stats', protect, hasPermission('ap:view'), async (req, res) => {
    try {
        const [totalPayablesRes, overdueRes, dueSoonRes, holdRes] = await Promise.all([
            db.query(`SELECT COALESCE(SUM(ledger_balance), 0) AS total_payables FROM vw_supplier_ap_balance WHERE ledger_balance > 0`),
            db.query(`
                SELECT COUNT(*)::int AS overdue_count, COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)), 0) AS overdue_amount
                FROM supplier_bill
                WHERE status IN ('Unpaid', 'Partially Paid') AND COALESCE(due_date, bill_date) < CURRENT_DATE
            `),
            db.query(`
                SELECT
                    COUNT(*) FILTER (WHERE COALESCE(due_date, bill_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days')::int AS due_next_7_count,
                    COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (WHERE COALESCE(due_date, bill_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'), 0) AS due_next_7_amount,
                    COUNT(*) FILTER (WHERE COALESCE(due_date, bill_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')::int AS due_next_30_count,
                    COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (WHERE COALESCE(due_date, bill_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'), 0) AS due_next_30_amount
                FROM supplier_bill
                WHERE status IN ('Unpaid', 'Partially Paid')
            `),
            db.query(`SELECT COUNT(*)::int AS suppliers_on_hold FROM supplier WHERE payment_hold = TRUE`),
        ]);

        res.json({
            totalPayables: parseFloat(totalPayablesRes.rows[0].total_payables) || 0,
            overdueCount: overdueRes.rows[0].overdue_count || 0,
            overdueAmount: parseFloat(overdueRes.rows[0].overdue_amount) || 0,
            dueNext7Count: dueSoonRes.rows[0].due_next_7_count || 0,
            dueNext7Amount: parseFloat(dueSoonRes.rows[0].due_next_7_amount) || 0,
            dueNext30Count: dueSoonRes.rows[0].due_next_30_count || 0,
            dueNext30Amount: parseFloat(dueSoonRes.rows[0].due_next_30_amount) || 0,
            suppliersOnHold: holdRes.rows[0].suppliers_on_hold || 0,
        });
    } catch (err) {
        console.error('AP Summary Stats Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch AP summary stats' });
    }
});

// GET /ap/supplier-summary - Supplier-level AP summary (balance, earliest due date, aging bucket)
router.get('/ap/supplier-summary', protect, hasPermission('ap:view'), async (req, res) => {
    try {
        const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
        const { search, status, sortBy, sortDir } = req.query;

        const params = [];
        let paramIdx = 1;
        let searchWhere = '';
        if (search && search.trim()) {
            searchWhere = `AND (
                LOWER(COALESCE(s.supplier_name, '')) LIKE $${paramIdx} OR
                LOWER(COALESCE(s.contact_person, '')) LIKE $${paramIdx} OR
                LOWER(COALESCE(s.phone, '')) LIKE $${paramIdx}
            )`;
            params.push(`%${search.trim().toLowerCase()}%`);
            paramIdx++;
        }

        let havingClause = 'HAVING b.ledger_balance > 0';
        if (status === 'PAYMENT_HOLD') {
            searchWhere += ' AND s.payment_hold = TRUE';
        } else if (status === 'CURRENT') {
            havingClause += " AND MIN(COALESCE(sb.due_date, sb.bill_date)) >= CURRENT_DATE";
        } else if (status === 'OVERDUE') {
            havingClause += " AND MIN(COALESCE(sb.due_date, sb.bill_date)) < CURRENT_DATE";
        }

        let orderBy = 'ORDER BY bill_count DESC, earliest_due_date ASC, total_balance_due DESC';
        if (sortBy) {
            const dir = (sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            if (sortBy === 'supplier_name') {
                orderBy = `ORDER BY s.supplier_name ${dir}`;
            } else if (sortBy === 'bill_count') {
                orderBy = `ORDER BY bill_count ${dir}`;
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
                s.supplier_id,
                s.supplier_name,
                s.contact_person,
                s.phone,
                s.payment_hold,
                s.payment_hold_reason,
                s.payment_terms_days,
                b.ledger_balance                                     AS total_balance_due,
                MIN(COALESCE(sb.due_date, sb.bill_date))            AS earliest_due_date,
                COUNT(DISTINCT sb.bill_id)                           AS bill_count,
                CASE
                    WHEN MIN(COALESCE(sb.due_date, sb.bill_date)) >= CURRENT_DATE THEN 'Current'
                    WHEN MIN(COALESCE(sb.due_date, sb.bill_date)) >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
                    WHEN MIN(COALESCE(sb.due_date, sb.bill_date)) >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
                    WHEN MIN(COALESCE(sb.due_date, sb.bill_date)) >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
                    ELSE '90+ Days'
                END as status
            FROM supplier s
            JOIN vw_supplier_ap_balance b ON b.supplier_id = s.supplier_id
            LEFT JOIN supplier_bill sb ON s.supplier_id = sb.supplier_id AND sb.status IN ('Unpaid', 'Partially Paid')
            WHERE b.ledger_balance > 0
            ${searchWhere}
            GROUP BY s.supplier_id, s.supplier_name, s.contact_person, s.phone, s.payment_hold, s.payment_hold_reason, s.payment_terms_days, b.ledger_balance
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
                SELECT s.supplier_id
                FROM supplier s
                JOIN vw_supplier_ap_balance b ON b.supplier_id = s.supplier_id
                LEFT JOIN supplier_bill sb ON s.supplier_id = sb.supplier_id AND sb.status IN ('Unpaid', 'Partially Paid')
                WHERE b.ledger_balance > 0
                ${searchWhere}
                GROUP BY s.supplier_id, b.ledger_balance
                ${havingClause}
            ) summary
        `;
        const countRes = await db.query(countQuery, params);
        const total = countRes.rows[0]?.total || 0;
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
    } catch (err) {
        console.error('AP Supplier Summary Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch supplier summary' });
    }
});

// GET /ap/suppliers/:supplierId/ledger - Chronological ap_ledger history with running balance (SOA)
router.get('/ap/suppliers/:supplierId/ledger', protect, hasPermission('ap:view'), async (req, res) => {
    const supplierId = parseInt(req.params.supplierId, 10);
    if (!supplierId) return res.status(400).json({ message: 'Invalid supplier ID' });
    const { limit = 100, offset = 0 } = req.query;
    try {
        const { rows } = await db.query(`
            SELECT
                l.ledger_id, l.entry_type, l.amount, l.balance_after,
                l.payment_channel, l.reference_no, l.notes, l.entry_date,
                l.bill_id, sb.bill_number,
                l.payment_id, ap.reference_number AS payment_reference_number,
                e.first_name || ' ' || COALESCE(e.last_name, '') AS created_by_name
            FROM ap_ledger l
            LEFT JOIN supplier_bill sb ON sb.bill_id = l.bill_id
            LEFT JOIN ap_payment ap ON ap.payment_id = l.payment_id
            LEFT JOIN employee e ON e.employee_id = l.created_by
            WHERE l.supplier_id = $1
            ORDER BY l.ledger_id ASC
            LIMIT $2 OFFSET $3
        `, [supplierId, parseInt(limit), parseInt(offset)]);
        const { rows: [{ total }] } = await db.query(
            'SELECT COUNT(*)::int AS total FROM ap_ledger WHERE supplier_id = $1', [supplierId]);
        res.json({ rows, total });
    } catch (err) {
        console.error('AP Ledger fetch error:', err.message);
        res.status(500).json({ message: 'Server error fetching AP ledger.' });
    }
});

// GET /ap/suppliers/:supplierId/payments - Payment instruments issued to a supplier, with bill allocations
router.get('/ap/suppliers/:supplierId/payments', protect, hasPermission('ap:view'), async (req, res) => {
    const supplierId = parseInt(req.params.supplierId, 10);
    if (!supplierId) return res.status(400).json({ message: 'Invalid supplier ID' });
    try {
        const { rows } = await db.query(`
            SELECT
                p.payment_id, p.payment_date, p.amount, p.reference_number, p.notes,
                p.pdc_status, p.cheque_date, p.bank_account_id, ba.account_name,
                pm.name AS method_name,
                COALESCE(
                    json_agg(
                        json_build_object('bill_id', a.bill_id, 'bill_number', sb.bill_number, 'amount_allocated', a.amount_allocated)
                    ) FILTER (WHERE a.allocation_id IS NOT NULL), '[]'
                ) AS allocations
            FROM ap_payment p
            LEFT JOIN bank_account ba ON ba.bank_account_id = p.bank_account_id
            LEFT JOIN payment_methods pm ON pm.method_id = p.method_id
            LEFT JOIN ap_payment_allocation a ON a.payment_id = p.payment_id
            LEFT JOIN supplier_bill sb ON sb.bill_id = a.bill_id
            WHERE p.supplier_id = $1
            GROUP BY p.payment_id, ba.account_name, pm.name
            ORDER BY p.payment_date DESC
        `, [supplierId]);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('AP Supplier Payments Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch supplier payments' });
    }
});

// PATCH /ap/suppliers/:supplierId/payment-hold - Toggle a supplier's payment hold flag
router.patch('/ap/suppliers/:supplierId/payment-hold', protect, hasPermission('ap:manage'), async (req, res) => {
    const supplierId = parseInt(req.params.supplierId, 10);
    if (!supplierId) return res.status(400).json({ message: 'Invalid supplier ID' });
    const { payment_hold, payment_hold_reason } = req.body;
    if (typeof payment_hold !== 'boolean') {
        return res.status(400).json({ message: 'payment_hold (boolean) is required' });
    }
    if (payment_hold && (!payment_hold_reason || !payment_hold_reason.trim())) {
        return res.status(400).json({ message: 'payment_hold_reason is required when placing a supplier on hold' });
    }
    try {
        const { rows: [row] } = await db.query(
            `UPDATE supplier SET
                payment_hold = $1,
                payment_hold_reason = $2,
                modified_by = $3,
                date_modified = now()
             WHERE supplier_id = $4 RETURNING supplier_id, supplier_name, payment_hold, payment_hold_reason`,
            [payment_hold, payment_hold ? payment_hold_reason.trim() : null, req.user?.employee_id, supplierId]
        );
        if (!row) return res.status(404).json({ message: 'Supplier not found' });
        res.json({ success: true, data: row });
    } catch (err) {
        console.error('AP Payment Hold Toggle Error:', err.message);
        res.status(500).json({ message: 'Failed to update payment hold' });
    }
});

// PATCH /ap/supplier-bills/:billId/due-date - Edit a bill's due date, with an audit log entry
router.patch('/ap/supplier-bills/:billId/due-date', protect, hasPermission('ap:manage'), async (req, res) => {
    const billId = parseInt(req.params.billId, 10);
    if (!billId) return res.status(400).json({ message: 'Invalid bill ID' });
    const { new_due_date, reason } = req.body;
    if (!new_due_date) return res.status(400).json({ message: 'new_due_date is required' });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows: [bill] } = await client.query(
            'SELECT bill_id, due_date FROM supplier_bill WHERE bill_id = $1 FOR UPDATE', [billId]
        );
        if (!bill) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Bill not found' });
        }

        const oldDueDate = bill.due_date;
        let daysAdjustment = null;
        if (oldDueDate) {
            const diffMs = new Date(new_due_date).getTime() - new Date(oldDueDate).getTime();
            daysAdjustment = Math.round(diffMs / (1000 * 60 * 60 * 24));
        }

        await client.query('UPDATE supplier_bill SET due_date = $1 WHERE bill_id = $2', [new_due_date, billId]);
        await client.query(
            `INSERT INTO supplier_bill_due_date_log (bill_id, old_due_date, new_due_date, days_adjustment, edited_by, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [billId, oldDueDate, new_due_date, daysAdjustment, req.user?.employee_id, reason || null]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: 'Due date updated', bill_id: billId, old_due_date: oldDueDate, new_due_date });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Bill Due Date Edit Error:', err.message);
        res.status(500).json({ message: 'Failed to update due date' });
    } finally {
        client.release();
    }
});

// GET /ap/supplier-bills/:billId/due-date-history - Audit trail for a bill's due date changes
router.get('/ap/supplier-bills/:billId/due-date-history', protect, hasPermission('ap:view'), async (req, res) => {
    const billId = parseInt(req.params.billId, 10);
    if (!billId) return res.status(400).json({ message: 'Invalid bill ID' });
    try {
        const { rows } = await db.query(`
            SELECT ddl.log_id, ddl.old_due_date, ddl.new_due_date, ddl.days_adjustment, ddl.edited_on, ddl.reason,
                   e.first_name, e.last_name
            FROM supplier_bill_due_date_log ddl
            JOIN employee e ON e.employee_id = ddl.edited_by
            WHERE ddl.bill_id = $1
            ORDER BY ddl.edited_on ASC
        `, [billId]);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('AP Bill Due Date History Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch due date history' });
    }
});

// GET /ap/supplier-bills/:billId/items - Items attached to a manually-created bill via
// one or more linked goods receipts (goods_receipt.bill_id), plus a variance check
// against the bill's recorded total_amount.
router.get('/ap/supplier-bills/:billId/items', protect, hasPermission('ap:view'), async (req, res) => {
    const billId = parseInt(req.params.billId, 10);
    if (!billId) return res.status(400).json({ message: 'Invalid bill ID' });
    try {
        const { rows: [bill] } = await db.query('SELECT bill_id, total_amount FROM supplier_bill WHERE bill_id = $1', [billId]);
        if (!bill) return res.status(404).json({ message: 'Bill not found' });

        const { rows } = await db.query(`
            SELECT
                grl.grn_line_id, grl.grn_id, gr.grn_number, gr.receipt_date,
                grl.part_id, grl.quantity, grl.cost_price,
                p.internal_sku, p.detail,
                CASE
                    WHEN pn.part_number IS NOT NULL THEN
                        CASE
                            WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN CONCAT(g.group_name, ' (', b.brand_name, ') | ', pn.part_number)
                            WHEN g.group_name IS NOT NULL THEN CONCAT(g.group_name, ' | ', pn.part_number)
                            WHEN b.brand_name IS NOT NULL THEN CONCAT(b.brand_name, ' | ', pn.part_number)
                            ELSE pn.part_number
                        END
                    ELSE
                        CASE
                            WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN CONCAT(g.group_name, ' (', b.brand_name, ') | ', p.internal_sku)
                            WHEN g.group_name IS NOT NULL THEN CONCAT(g.group_name, ' | ', p.internal_sku)
                            WHEN b.brand_name IS NOT NULL THEN CONCAT(b.brand_name, ' | ', p.internal_sku)
                            ELSE p.internal_sku
                        END
                END ||
                CASE WHEN p.detail IS NOT NULL AND p.detail != '' THEN ' | ' || p.detail ELSE '' END AS display_name
            FROM goods_receipt gr
            JOIN goods_receipt_line grl ON grl.grn_id = gr.grn_id
            JOIN part p ON p.part_id = grl.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            LEFT JOIN part_number pn ON pn.part_id = p.part_id AND pn.display_order = (
                SELECT MIN(pn2.display_order) FROM part_number pn2 WHERE pn2.part_id = p.part_id
            )
            WHERE gr.bill_id = $1
            ORDER BY gr.receipt_date ASC, grl.grn_line_id ASC
        `, [billId]);

        const itemsTotal = rows.reduce((sum, r) => sum + (parseFloat(r.quantity) * parseFloat(r.cost_price)), 0);
        res.json({
            success: true,
            data: rows,
            itemsTotal,
            billTotal: parseFloat(bill.total_amount),
            variance: parseFloat(bill.total_amount) - itemsTotal,
        });
    } catch (err) {
        console.error('AP Bill Items Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch bill items' });
    }
});

// GET /ap/supplier-bills/:billId/goods-receipts - The goods receipt(s) behind a payable.
//
// A bill can reach a receipt three ways, and all three are real:
//   goods_receipt.bill_id         — the receipt whose stock-in created this bill, and
//                                   also every receipt later attached to a manually
//                                   created payable via AttachItemsModal (so a bill may
//                                   legitimately have several)
//   goods_receipt.freight_bill_id — the receipt whose freight charge created this bill,
//                                   billed to the carrier rather than the goods supplier
//   supplier_bill.grn_id          — the pointer written at bill creation, kept as a
//                                   fallback for rows that predate the back-link
//
// Lines are returned with the receipt so the AP clerk can check the delivery against
// the supplier's invoice without needing goods_receipt permissions — reading a payable's
// own supporting document is squarely an ap:view concern.
router.get('/ap/supplier-bills/:billId/goods-receipts', protect, hasPermission('ap:view'), async (req, res) => {
    const billId = parseInt(req.params.billId, 10);
    if (!billId) return res.status(400).json({ message: 'Invalid bill ID' });
    try {
        const { rows: [bill] } = await db.query(
            'SELECT bill_id, bill_number, total_amount FROM supplier_bill WHERE bill_id = $1', [billId]
        );
        if (!bill) return res.status(404).json({ message: 'Bill not found' });

        const { rows: receipts } = await db.query(`
            SELECT
                gr.grn_id, gr.grn_number, gr.receipt_date, gr.status, gr.workflow_status,
                gr.is_backfill, gr.supplier_invoice_no, gr.po_id, gr.freight_amount,
                gr.freight_allocation_method, gr.overall_discount_percent, gr.overall_discount_amount,
                gr.voided_at, gr.void_reason,
                s.supplier_name,
                fs.supplier_name AS freight_supplier_name,
                po.po_number,
                TRIM(BOTH ' ' FROM e.first_name || ' ' || COALESCE(e.last_name, '')) AS received_by_name,
                TRIM(BOTH ' ' FROM ve.first_name || ' ' || COALESCE(ve.last_name, '')) AS voided_by_name,
                CASE WHEN gr.freight_bill_id = $1 THEN 'freight' ELSE 'goods' END AS link_type
            FROM goods_receipt gr
            JOIN supplier s ON s.supplier_id = gr.supplier_id
            LEFT JOIN supplier fs ON fs.supplier_id = gr.freight_supplier_id
            LEFT JOIN purchase_order po ON po.po_id = gr.po_id
            LEFT JOIN employee e ON e.employee_id = gr.received_by
            LEFT JOIN employee ve ON ve.employee_id = gr.voided_by
            WHERE gr.bill_id = $1
               OR gr.freight_bill_id = $1
               OR gr.grn_id = (SELECT grn_id FROM supplier_bill WHERE bill_id = $1)
            ORDER BY gr.receipt_date, gr.grn_id
        `, [billId]);

        if (receipts.length === 0) {
            return res.json({ success: true, data: [], bill });
        }

        const grnIds = receipts.map((r) => r.grn_id);
        const { rows: lines } = await db.query(`
            SELECT
                grl.grn_line_id, grl.grn_id, grl.part_id, grl.quantity, grl.return_quantity,
                grl.cost_price, grl.landed_unit_cost, grl.allocated_freight_amount,
                grl.line_discount_percent, grl.line_discount_amount, grl.override_freight_amount,
                grl.effective_markup_percent, grl.sale_price, grl.rejection_reason,
                p.internal_sku,
                CASE
                    WHEN pn.part_number IS NOT NULL THEN
                        CASE
                            WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN CONCAT(g.group_name, ' (', b.brand_name, ') | ', pn.part_number)
                            WHEN g.group_name IS NOT NULL THEN CONCAT(g.group_name, ' | ', pn.part_number)
                            WHEN b.brand_name IS NOT NULL THEN CONCAT(b.brand_name, ' | ', pn.part_number)
                            ELSE pn.part_number
                        END
                    ELSE
                        CASE
                            WHEN g.group_name IS NOT NULL AND b.brand_name IS NOT NULL THEN CONCAT(g.group_name, ' (', b.brand_name, ') | ', p.internal_sku)
                            WHEN g.group_name IS NOT NULL THEN CONCAT(g.group_name, ' | ', p.internal_sku)
                            WHEN b.brand_name IS NOT NULL THEN CONCAT(b.brand_name, ' | ', p.internal_sku)
                            ELSE p.internal_sku
                        END
                END ||
                CASE WHEN p.detail IS NOT NULL AND p.detail != '' THEN ' | ' || p.detail ELSE '' END AS display_name
            FROM goods_receipt_line grl
            JOIN part p ON p.part_id = grl.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            LEFT JOIN part_number pn ON pn.part_id = p.part_id AND pn.display_order = (
                SELECT MIN(pn2.display_order) FROM part_number pn2 WHERE pn2.part_id = p.part_id
            )
            WHERE grl.grn_id = ANY($1::int[])
            ORDER BY grl.grn_id, grl.grn_line_id
        `, [grnIds]);

        const linesByGrn = lines.reduce((acc, line) => {
            (acc[line.grn_id] = acc[line.grn_id] || []).push(line);
            return acc;
        }, {});

        const data = receipts.map((receipt) => {
            const grnLines = linesByGrn[receipt.grn_id] || [];
            // The figure to check the supplier's invoice against is what the receipt
            // actually made us owe — accepted quantity only, after line and overall
            // discounts. That is exactly grnCostingService's net_goods_value, and it is
            // the same number grnPostingService billed, so reusing the service keeps the
            // two from drifting rather than re-deriving the arithmetic here.
            const costing = grnCosting.computeCosting({
                lines: grnLines.map((l) => ({
                    quantity: l.quantity,
                    cost_price: l.cost_price,
                    return_quantity: l.return_quantity || 0,
                    line_discount_percent: l.line_discount_percent ?? null,
                    line_discount_amount: l.line_discount_amount ?? null,
                    override_freight_amount: l.override_freight_amount ?? null,
                    effective_markup_percent: l.effective_markup_percent ?? null,
                    sale_price: l.sale_price ?? null,
                })),
                freightAmount: Number(receipt.freight_amount) || 0,
                freightMethod: receipt.freight_allocation_method || grnCosting.METHOD_A,
                overallDiscountPercent: receipt.overall_discount_percent ?? null,
                overallDiscountAmount: receipt.overall_discount_amount ?? null,
                recomputeSalePrice: false,
            });
            // The whole computation goes to the client, not just the bottom line: an AP
            // clerk checking a supplier's invoice has to be able to see how each figure
            // was arrived at — the discount taken on a line, the freight allocated to it,
            // the landed cost that came out — exactly as the receipt itself shows it.
            // Each stored line is merged with its computed counterpart, positionally,
            // because computeCosting preserves input order and reports it as `index`.
            const computedByIndex = costing.lines.reduce((acc, l) => {
                acc[l.index] = l;
                return acc;
            }, {});
            const billingLines = grnLines.map((line, index) => ({ ...line, ...computedByIndex[index] }));
            return {
                ...receipt,
                lines: billingLines,
                totals: costing.totals,
                goods_value: costing.totals.net_goods_value,
            };
        });

        res.json({ success: true, data, bill });
    } catch (err) {
        console.error('AP Bill Goods Receipts Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch goods receipts for this bill' });
    }
});

// GET /ap/payment-methods - Methods that may be used to settle a payable.
// Cash, bank transfer and e-wallet settle immediately; cheque methods are flagged
// `requires_cheque_instrument` and are settled by issuing an outbound cheque, so
// they only appear for callers who hold the permission that endpoint requires.
router.get('/ap/payment-methods', protect, hasPermission('ap:view'), async (req, res) => {
    try {
        const methods = await apPaymentService.getApPaymentMethods(db, {
            canIssueCheques: userHasPermission(req, 'ap-pdc:manage'),
        });
        res.json({ success: true, data: methods });
    } catch (err) {
        console.error('AP Payment Methods Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch supplier payment methods' });
    }
});

// GET /ap/payments - Cross-supplier payment register
router.get('/ap/payments', protect, hasPermission('ap:view'), async (req, res) => {
    try {
        const { supplier_id, channel, limit } = req.query;
        const payments = await apPaymentService.listPayments(db, {
            supplierId: supplier_id ? parseInt(supplier_id, 10) : null,
            channel,
            limit,
        });
        res.json({ success: true, count: payments.length, data: payments });
    } catch (err) {
        console.error('AP Payments List Error:', err.message);
        res.status(500).json({ message: 'Failed to fetch supplier payments' });
    }
});

// POST /ap/payments - Record a non-cheque supplier payment (cash, bank transfer, e-wallet).
// settlement_date is the day the money actually left and may be backdated, since
// payments are routinely recorded after the fact. Changing it afterwards requires
// transaction:change_date and a written reason (see transactionDateRoutes.js).
router.post('/ap/payments', protect, hasPermission('ap:manage'), async (req, res) => {
    const {
        supplier_id, method_id, amount, settlement_date, reference_number,
        bank_account_id, notes, allocations, override_payment_hold,
    } = req.body;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await apPaymentService.recordDirectPayment(client, {
            supplierId: supplier_id,
            methodId: method_id,
            amount,
            settlementDate: settlement_date,
            referenceNumber: reference_number,
            bankAccountId: bank_account_id,
            notes,
            allocations,
            userId: req.user?.employee_id,
            overridePaymentHold: Boolean(override_payment_hold),
        });
        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'Supplier payment recorded', data: result });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('AP Record Payment Error:', err.message);
        if (err.status) {
            return res.status(err.status).json({ message: err.message, code: err.code });
        }
        res.status(500).json({ message: 'Failed to record supplier payment' });
    } finally {
        client.release();
    }
});

module.exports = router;
