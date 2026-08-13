const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');

const router = express.Router();

const LEXICON_SELECT = `
    a.alias_id,
    a.term,
    a.term_normalized,
    a.target_type,
    a.category_id,
    a.payee,
    a.payment_method_id,
    a.status,
    a.confirm_count,
    a.language_hint,
    a.example_input,
    a.created_at,
    a.reviewed_at,
    c.category_name,
    pm.name AS payment_method_name,
    CASE WHEN r.employee_id IS NOT NULL
         THEN json_build_object('employee_id', r.employee_id, 'first_name', r.first_name, 'last_name', r.last_name)
         ELSE NULL END AS reviewed_by
`;

const LEXICON_JOINS = `
    FROM expense_term_alias a
    LEFT JOIN expense_category c ON a.category_id = c.category_id
    LEFT JOIN payment_methods pm ON a.payment_method_id = pm.method_id
    LEFT JOIN employee r ON a.reviewed_by = r.employee_id
`;

// GET /api/expense-lexicon - List learned terms, filterable by status
router.get('/expense-lexicon', protect, hasPermission('expenses:manage_lexicon'), async (req, res) => {
    const { status, target_type } = req.query;

    try {
        const params = [];
        const where = [];

        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            params.push(status);
            where.push(`a.status = $${params.length}`);
        }
        if (target_type && ['category', 'payee', 'payment_method'].includes(target_type)) {
            params.push(target_type);
            where.push(`a.target_type = $${params.length}`);
        }

        const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        // Most-confirmed terms first — those are the vocabulary actually in daily use.
        const { rows } = await db.query(
            `SELECT ${LEXICON_SELECT} ${LEXICON_JOINS} ${whereSql}
             ORDER BY a.confirm_count DESC, a.created_at DESC
             LIMIT 500`,
            params
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching expense lexicon:', error);
        res.status(500).json({ message: 'Failed to fetch expense lexicon' });
    }
});

// GET /api/expense-lexicon/pending-count - Badge for the review queue
router.get('/expense-lexicon/pending-count', protect, hasPermission('expenses:manage_lexicon'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT COUNT(*)::int AS pending FROM expense_term_alias WHERE status = 'pending'`
        );
        res.json({ pending: rows[0]?.pending || 0 });
    } catch (error) {
        console.error('Error fetching pending lexicon count:', error);
        res.status(500).json({ message: 'Failed to fetch pending lexicon count' });
    }
});

// PUT /api/expense-lexicon/:id/review - Approve or reject a learned term
router.put('/expense-lexicon/:id/review', protect, hasPermission('expenses:manage_lexicon'), async (req, res) => {
    const aliasId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const employeeId = req.user.employee_id;

    if (isNaN(aliasId)) {
        return res.status(400).json({ message: 'Invalid lexicon entry ID' });
    }
    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ message: 'Status must be either approved or rejected' });
    }

    try {
        const { rows } = await db.query(
            `UPDATE expense_term_alias
             SET status = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
             WHERE alias_id = $3
             RETURNING alias_id, term, target_type, status`,
            [status, employeeId, aliasId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Lexicon entry not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Error reviewing lexicon entry:', error);
        res.status(500).json({ message: 'Failed to review lexicon entry' });
    }
});

// PUT /api/expense-lexicon/:id - Correct what a learned term maps to
router.put('/expense-lexicon/:id', protect, hasPermission('expenses:manage_lexicon'), async (req, res) => {
    const aliasId = parseInt(req.params.id, 10);
    const { term, target_type, category_id, payee, payment_method_id } = req.body;
    const employeeId = req.user.employee_id;

    if (isNaN(aliasId)) {
        return res.status(400).json({ message: 'Invalid lexicon entry ID' });
    }
    if (!term || !String(term).trim()) {
        return res.status(400).json({ message: 'Term is required' });
    }
    if (!['category', 'payee', 'payment_method'].includes(target_type)) {
        return res.status(400).json({ message: 'Target type must be category, payee, or payment_method' });
    }

    // The DB enforces this too, but a clear message beats a constraint violation.
    if (target_type === 'category' && !category_id) {
        return res.status(400).json({ message: 'A category must be selected for a category term' });
    }
    if (target_type === 'payee' && (!payee || !String(payee).trim())) {
        return res.status(400).json({ message: 'A payee must be provided for a payee term' });
    }
    if (target_type === 'payment_method' && !payment_method_id) {
        return res.status(400).json({ message: 'A payment method must be selected for a payment method term' });
    }

    const normalized = String(term).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

    try {
        const { rows } = await db.query(
            `UPDATE expense_term_alias
             SET term = $1,
                 term_normalized = $2,
                 target_type = $3,
                 category_id = $4,
                 payee = $5,
                 payment_method_id = $6,
                 reviewed_by = $7,
                 updated_at = NOW()
             WHERE alias_id = $8
             RETURNING alias_id, term, target_type, status`,
            [
                String(term).trim().substring(0, 100),
                normalized.substring(0, 100),
                target_type,
                target_type === 'category' ? parseInt(category_id, 10) : null,
                target_type === 'payee' ? String(payee).trim().substring(0, 200) : null,
                target_type === 'payment_method' ? parseInt(payment_method_id, 10) : null,
                employeeId,
                aliasId
            ]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Lexicon entry not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ message: 'Another entry already maps this term to the same type' });
        }
        console.error('Error updating lexicon entry:', error);
        res.status(500).json({ message: 'Failed to update lexicon entry' });
    }
});

// DELETE /api/expense-lexicon/:id - Remove a learned term entirely
router.delete('/expense-lexicon/:id', protect, hasPermission('expenses:manage_lexicon'), async (req, res) => {
    const aliasId = parseInt(req.params.id, 10);
    if (isNaN(aliasId)) {
        return res.status(400).json({ message: 'Invalid lexicon entry ID' });
    }

    try {
        const { rows } = await db.query(
            'DELETE FROM expense_term_alias WHERE alias_id = $1 RETURNING alias_id',
            [aliasId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Lexicon entry not found' });
        }
        res.json({ message: 'Lexicon entry removed', alias_id: rows[0].alias_id });
    } catch (error) {
        console.error('Error deleting lexicon entry:', error);
        res.status(500).json({ message: 'Failed to delete lexicon entry' });
    }
});

// GET /api/expense-lexicon/accuracy - Is the AI actually getting better?
router.get('/expense-lexicon/accuracy', protect, hasPermission('expenses:manage_lexicon'), async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT
                TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-MM-DD') AS week_start,
                COUNT(*)::int AS total_parses,
                COUNT(*) FILTER (WHERE was_accepted)::int AS accepted,
                ROUND(
                    100.0 * COUNT(*) FILTER (WHERE was_accepted) / NULLIF(COUNT(*), 0)
                , 1)::float AS acceptance_rate
            FROM expense_ai_parse_log
            WHERE created_at >= NOW() - INTERVAL '12 weeks'
            GROUP BY DATE_TRUNC('week', created_at)
            ORDER BY DATE_TRUNC('week', created_at) ASC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching AI accuracy trend:', error);
        res.status(500).json({ message: 'Failed to fetch AI accuracy trend' });
    }
});

module.exports = router;
