const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const { parseExpenseText } = require('../services/expenseAIParser');

const router = express.Router();

// Helper to select and join expense details
const EXPENSE_SELECT_FIELDS = `
    e.expense_id,
    e.expense_date,
    e.amount,
    e.payee,
    e.payment_method_id,
    e.payment_method_text,
    e.reference_no,
    e.notes,
    e.is_void,
    e.voided_at,
    e.void_reason,
    e.created_at,
    e.updated_at,
    json_build_object(
        'category_id', c.category_id,
        'category_name', c.category_name,
        'is_active', c.is_active
    ) AS category,
    CASE 
        WHEN pm.method_id IS NOT NULL THEN json_build_object('method_id', pm.method_id, 'name', pm.name)
        ELSE NULL
    END AS payment_method,
    json_build_object(
        'employee_id', emp.employee_id,
        'first_name', emp.first_name,
        'last_name', emp.last_name,
        'username', emp.username
    ) AS created_by,
    CASE 
        WHEN vemp.employee_id IS NOT NULL THEN json_build_object(
            'employee_id', vemp.employee_id,
            'first_name', vemp.first_name,
            'last_name', vemp.last_name
        )
        ELSE NULL
    END AS voided_by
`;

const EXPENSE_JOIN_TABLES = `
    FROM expense e
    JOIN expense_category c ON e.category_id = c.category_id
    LEFT JOIN payment_methods pm ON e.payment_method_id = pm.method_id
    JOIN employee emp ON e.created_by = emp.employee_id
    LEFT JOIN employee vemp ON e.voided_by = vemp.employee_id
`;

// POST /api/expenses/parse - AI natural language parsing
router.post('/expenses/parse', protect, hasPermission('expenses:create'), async (req, res) => {
    const { text } = req.body;
    try {
        const result = await parseExpenseText(text);
        res.json(result);
    } catch (error) {
        if (error.statusCode === 400) {
            return res.status(400).json({ message: error.message });
        }
        if (error.statusCode === 503 || error.fallback === 'manual') {
            return res.status(503).json({ error: error.message || 'AI parsing unavailable', fallback: 'manual' });
        }
        console.error('Error in /api/expenses/parse:', error);
        res.status(503).json({ error: 'AI parsing failed', fallback: 'manual' });
    }
});

// GET /api/expenses/summary/by-category - Category totals for date range
router.get('/expenses/summary/by-category', protect, hasPermission('expenses:view'), async (req, res) => {
    const { date_from, date_to } = req.query;

    try {
        let whereClauses = ['e.is_void = false'];
        let queryParams = [];

        if (date_from) {
            queryParams.push(date_from);
            whereClauses.push(`e.expense_date >= $${queryParams.length}`);
        }
        if (date_to) {
            queryParams.push(date_to);
            whereClauses.push(`e.expense_date <= $${queryParams.length}`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const query = `
            SELECT 
                c.category_id,
                c.category_name,
                SUM(e.amount) AS total_amount,
                COUNT(e.expense_id)::integer AS count
            FROM expense e
            JOIN expense_category c ON e.category_id = c.category_id
            ${whereSql}
            GROUP BY c.category_id, c.category_name
            ORDER BY total_amount DESC
        `;

        const result = await db.query(query, queryParams);
        res.json(result.rows.map(r => ({
            ...r,
            total_amount: parseFloat(r.total_amount) || 0
        })));
    } catch (error) {
        console.error('Error fetching expense summary by category:', error);
        res.status(500).json({ message: 'Failed to fetch expense summary by category' });
    }
});

// GET /api/expenses/summary/monthly - Monthly totals for last 12 months
router.get('/expenses/summary/monthly', protect, hasPermission('expenses:view'), async (req, res) => {
    try {
        const query = `
            SELECT 
                TO_CHAR(DATE_TRUNC('month', expense_date), 'YYYY-MM') AS month_key,
                TO_CHAR(DATE_TRUNC('month', expense_date), 'Mon YYYY') AS month_label,
                EXTRACT(YEAR FROM DATE_TRUNC('month', expense_date))::integer AS year,
                EXTRACT(MONTH FROM DATE_TRUNC('month', expense_date))::integer AS month,
                SUM(amount) AS total_amount,
                COUNT(expense_id)::integer AS count
            FROM expense
            WHERE is_void = false 
              AND expense_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months')
            GROUP BY DATE_TRUNC('month', expense_date)
            ORDER BY DATE_TRUNC('month', expense_date) ASC
        `;

        const result = await db.query(query);
        res.json(result.rows.map(r => ({
            ...r,
            total_amount: parseFloat(r.total_amount) || 0
        })));
    } catch (error) {
        console.error('Error fetching monthly expense summary:', error);
        res.status(500).json({ message: 'Failed to fetch monthly expense summary' });
    }
});

// GET /api/expenses - List expenses (paginated, filterable)
router.get('/expenses', protect, hasPermission('expenses:view'), async (req, res) => {
    const { page, pageSize, offset, limit } = parsePaginationQuery({
        page: req.query.page,
        pageSize: req.query.limit || req.query.pageSize
    });

    const {
        date_from,
        date_to,
        category_id,
        payment_method_id,
        payee,
        show_void = 'false',
        sort_by = 'expense_date',
        sort_dir = 'desc'
    } = req.query;

    try {
        let whereClauses = [];
        let queryParams = [];

        if (show_void !== 'true' && show_void !== true && show_void !== '1') {
            whereClauses.push(`e.is_void = false`);
        }

        if (date_from) {
            queryParams.push(date_from);
            whereClauses.push(`e.expense_date >= $${queryParams.length}`);
        }

        if (date_to) {
            queryParams.push(date_to);
            whereClauses.push(`e.expense_date <= $${queryParams.length}`);
        }

        if (category_id) {
            queryParams.push(parseInt(category_id, 10));
            whereClauses.push(`e.category_id = $${queryParams.length}`);
        }

        if (payment_method_id) {
            queryParams.push(parseInt(payment_method_id, 10));
            whereClauses.push(`e.payment_method_id = $${queryParams.length}`);
        }

        if (payee && payee.trim()) {
            queryParams.push(`%${payee.trim().toLowerCase()}%`);
            whereClauses.push(`LOWER(e.payee) LIKE $${queryParams.length}`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Count total
        const countQuery = `SELECT COUNT(*)::integer AS total FROM expense e ${whereSql}`;
        const countRes = await db.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        // Sorting
        const validSortFields = {
            expense_date: 'e.expense_date',
            amount: 'e.amount',
            created_at: 'e.created_at',
            category_name: 'c.category_name'
        };
        const sortField = validSortFields[sort_by] || 'e.expense_date';
        const direction = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        // Query items
        const itemsQueryParams = [...queryParams, limit, offset];
        const itemsQuery = `
            SELECT ${EXPENSE_SELECT_FIELDS}
            ${EXPENSE_JOIN_TABLES}
            ${whereSql}
            ORDER BY ${sortField} ${direction}, e.created_at DESC
            LIMIT $${itemsQueryParams.length - 1} OFFSET $${itemsQueryParams.length}
        `;

        const itemsRes = await db.query(itemsQuery, itemsQueryParams);

        res.json({
            data: itemsRes.rows,
            pagination: {
                page,
                limit: pageSize,
                totalItems: total,
                totalPages: Math.max(Math.ceil(total / pageSize), 1)
            }
        });
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({ message: 'Failed to fetch expenses' });
    }
});

// GET /api/expenses/:id - Get single expense
router.get('/expenses/:id', protect, hasPermission('expenses:view'), async (req, res) => {
    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) {
        return res.status(400).json({ message: 'Invalid expense ID' });
    }

    try {
        const query = `
            SELECT ${EXPENSE_SELECT_FIELDS}
            ${EXPENSE_JOIN_TABLES}
            WHERE e.expense_id = $1
        `;
        const result = await db.query(query, [expenseId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Expense record not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching expense details:', error);
        res.status(500).json({ message: 'Failed to fetch expense details' });
    }
});

// POST /api/expenses - Record expense
router.post('/expenses', protect, hasPermission('expenses:create'), async (req, res) => {
    const {
        expense_date,
        category_id,
        amount,
        payee,
        payment_method_id,
        payment_method_text = 'Cash',
        reference_no,
        notes,
        ai_corrections
    } = req.body;

    const employeeId = req.user.employee_id;

    if (!expense_date || !/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) {
        return res.status(400).json({ message: 'Valid expense date is required (YYYY-MM-DD)' });
    }

    const dateObj = new Date(expense_date);
    const maxFutureDate = new Date();
    maxFutureDate.setDate(maxFutureDate.getDate() + 365);
    if (dateObj > maxFutureDate) {
        return res.status(400).json({ message: 'Expense date cannot be more than 365 days in the future' });
    }

    if (!category_id || isNaN(parseInt(category_id, 10))) {
        return res.status(400).json({ message: 'Valid expense category is required' });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ message: 'Amount must be greater than 0' });
    }
    if (numericAmount > 99999999.99) {
        return res.status(400).json({ message: 'Amount exceeds maximum limit (99,999,999.99)' });
    }

    try {
        // Validate category exists and is active
        const categoryRes = await db.query(
            'SELECT category_id FROM expense_category WHERE category_id = $1 AND is_active = true',
            [parseInt(category_id, 10)]
        );
        if (categoryRes.rows.length === 0) {
            return res.status(400).json({ message: 'Selected expense category is invalid or inactive' });
        }

        // Validate payment method if ID provided
        let pmId = null;
        let pmText = payment_method_text ? String(payment_method_text).trim().substring(0, 50) : 'Cash';

        if (payment_method_id && !isNaN(parseInt(payment_method_id, 10))) {
            const pmRes = await db.query(
                'SELECT method_id, name FROM payment_methods WHERE method_id = $1 AND is_active = true',
                [parseInt(payment_method_id, 10)]
            );
            if (pmRes.rows.length > 0) {
                pmId = pmRes.rows[0].method_id;
                pmText = pmRes.rows[0].name;
            }
        }

        const insertQuery = `
            INSERT INTO expense (
                expense_date, category_id, amount, payee, 
                payment_method_id, payment_method_text, reference_no, notes, 
                created_by, modified_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
            RETURNING expense_id
        `;

        const insertRes = await db.query(insertQuery, [
            expense_date,
            parseInt(category_id, 10),
            numericAmount,
            payee ? String(payee).trim().substring(0, 200) : null,
            pmId,
            pmText,
            reference_no ? String(reference_no).trim().substring(0, 100) : null,
            notes ? String(notes).trim() : null,
            employeeId
        ]);

        const newExpenseId = insertRes.rows[0].expense_id;

        // Record AI corrections if provided
        if (Array.isArray(ai_corrections) && ai_corrections.length > 0) {
            for (const c of ai_corrections) {
                if (c.field_name && (c.ai_suggestion !== c.user_correction)) {
                    await db.query(
                        `INSERT INTO expense_ai_correction (expense_id, field_name, ai_suggestion, user_correction)
                         VALUES ($1, $2, $3, $4)`,
                        [newExpenseId, String(c.field_name).substring(0, 50), String(c.ai_suggestion || ''), String(c.user_correction || '')]
                    );
                }
            }
        }

        // Fetch full inserted record
        const getQuery = `
            SELECT ${EXPENSE_SELECT_FIELDS}
            ${EXPENSE_JOIN_TABLES}
            WHERE e.expense_id = $1
        `;
        const result = await db.query(getQuery, [newExpenseId]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error recording expense:', error);
        res.status(500).json({ message: 'Failed to record expense' });
    }
});

// PUT /api/expenses/:id - Update expense
router.put('/expenses/:id', protect, hasPermission('expenses:edit'), async (req, res) => {
    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) {
        return res.status(400).json({ message: 'Invalid expense ID' });
    }

    const {
        expense_date,
        category_id,
        amount,
        payee,
        payment_method_id,
        payment_method_text = 'Cash',
        reference_no,
        notes
    } = req.body;

    const employeeId = req.user.employee_id;

    try {
        // Check if expense exists and is not voided
        const existing = await db.query('SELECT is_void FROM expense WHERE expense_id = $1', [expenseId]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: 'Expense record not found' });
        }
        if (existing.rows[0].is_void) {
            return res.status(409).json({ message: 'Cannot edit a voided expense record' });
        }

        if (!expense_date || !/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) {
            return res.status(400).json({ message: 'Valid expense date is required (YYYY-MM-DD)' });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ message: 'Amount must be greater than 0' });
        }

        let pmId = null;
        let pmText = payment_method_text ? String(payment_method_text).trim().substring(0, 50) : 'Cash';
        if (payment_method_id && !isNaN(parseInt(payment_method_id, 10))) {
            const pmRes = await db.query('SELECT method_id, name FROM payment_methods WHERE method_id = $1', [parseInt(payment_method_id, 10)]);
            if (pmRes.rows.length > 0) {
                pmId = pmRes.rows[0].method_id;
                pmText = pmRes.rows[0].name;
            }
        }

        const updateQuery = `
            UPDATE expense
            SET expense_date = $1,
                category_id = $2,
                amount = $3,
                payee = $4,
                payment_method_id = $5,
                payment_method_text = $6,
                reference_no = $7,
                notes = $8,
                modified_by = $9,
                updated_at = NOW()
            WHERE expense_id = $10
        `;

        await db.query(updateQuery, [
            expense_date,
            parseInt(category_id, 10),
            numericAmount,
            payee ? String(payee).trim().substring(0, 200) : null,
            pmId,
            pmText,
            reference_no ? String(reference_no).trim().substring(0, 100) : null,
            notes ? String(notes).trim() : null,
            employeeId,
            expenseId
        ]);

        const getQuery = `
            SELECT ${EXPENSE_SELECT_FIELDS}
            ${EXPENSE_JOIN_TABLES}
            WHERE e.expense_id = $1
        `;
        const result = await db.query(getQuery, [expenseId]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({ message: 'Failed to update expense' });
    }
});

// PUT /api/expenses/:id/void - Void expense
router.put('/expenses/:id/void', protect, hasPermission('expenses:void'), async (req, res) => {
    const expenseId = parseInt(req.params.id, 10);
    const { void_reason } = req.body;
    const employeeId = req.user.employee_id;

    if (isNaN(expenseId)) {
        return res.status(400).json({ message: 'Invalid expense ID' });
    }

    if (!void_reason || typeof void_reason !== 'string' || void_reason.trim().length < 5) {
        return res.status(400).json({ message: 'Reason for voiding is required (minimum 5 characters)' });
    }

    try {
        const existing = await db.query('SELECT is_void FROM expense WHERE expense_id = $1', [expenseId]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: 'Expense record not found' });
        }
        if (existing.rows[0].is_void) {
            return res.status(409).json({ message: 'Expense record is already voided' });
        }

        const updateQuery = `
            UPDATE expense
            SET is_void = true,
                voided_by = $1,
                voided_at = NOW(),
                void_reason = $2,
                modified_by = $1,
                updated_at = NOW()
            WHERE expense_id = $3
        `;

        await db.query(updateQuery, [employeeId, void_reason.trim(), expenseId]);

        const getQuery = `
            SELECT ${EXPENSE_SELECT_FIELDS}
            ${EXPENSE_JOIN_TABLES}
            WHERE e.expense_id = $1
        `;
        const result = await db.query(getQuery, [expenseId]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error voiding expense:', error);
        res.status(500).json({ message: 'Failed to void expense' });
    }
});

module.exports = router;
