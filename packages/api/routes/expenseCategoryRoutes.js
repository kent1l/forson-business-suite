const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/expense-categories - List active categories
router.get('/expense-categories', protect, hasPermission('expenses:view'), async (req, res) => {
    try {
        const query = `
            SELECT category_id, category_name, description, sort_order, is_active, created_at, updated_at
            FROM expense_category
            WHERE is_active = true
            ORDER BY sort_order ASC, category_name ASC
        `;
        const result = await db.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching expense categories:', error);
        res.status(500).json({ message: 'Failed to fetch expense categories' });
    }
});

// GET /api/expense-categories/all - List all categories including inactive (Admin)
router.get('/expense-categories/all', protect, hasPermission('expenses:manage_categories'), async (req, res) => {
    try {
        const query = `
            SELECT category_id, category_name, description, sort_order, is_active, created_at, updated_at
            FROM expense_category
            ORDER BY sort_order ASC, category_name ASC
        `;
        const result = await db.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching all expense categories:', error);
        res.status(500).json({ message: 'Failed to fetch expense categories' });
    }
});

// POST /api/expense-categories - Create category
router.post('/expense-categories', protect, hasPermission('expenses:manage_categories'), async (req, res) => {
    const { category_name, description, sort_order = 0 } = req.body;
    const employeeId = req.user.employee_id;

    if (!category_name || typeof category_name !== 'string' || category_name.trim().length === 0) {
        return res.status(400).json({ message: 'Category name is required (max 100 characters)' });
    }

    const trimmedName = category_name.trim();
    if (trimmedName.length > 100) {
        return res.status(400).json({ message: 'Category name must not exceed 100 characters' });
    }

    try {
        // Check case-insensitive duplicate
        const existing = await db.query(
            'SELECT category_id FROM expense_category WHERE LOWER(category_name) = LOWER($1)',
            [trimmedName]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'An expense category with this name already exists' });
        }

        const insertQuery = `
            INSERT INTO expense_category (category_name, description, sort_order, created_by, modified_by)
            VALUES ($1, $2, $3, $4, $4)
            RETURNING category_id, category_name, description, sort_order, is_active, created_at, updated_at
        `;
        const result = await db.query(insertQuery, [trimmedName, description || null, parseInt(sort_order, 10) || 0, employeeId]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating expense category:', error);
        res.status(500).json({ message: 'Failed to create expense category' });
    }
});

// PUT /api/expense-categories/reorder - Batch reorder categories
router.put('/expense-categories/reorder', protect, hasPermission('expenses:manage_categories'), async (req, res) => {
    const { items } = req.body; // Array of { category_id, sort_order }
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'Items array is required for reordering' });
    }

    const employeeId = req.user.employee_id;

    try {
        await db.query('BEGIN');
        for (const item of items) {
            if (item.category_id && typeof item.sort_order === 'number') {
                await db.query(
                    `UPDATE expense_category 
                     SET sort_order = $1, modified_by = $2, updated_at = NOW() 
                     WHERE category_id = $3`,
                    [item.sort_order, employeeId, item.category_id]
                );
            }
        }
        await db.query('COMMIT');
        res.json({ message: 'Category sort order updated successfully' });
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Error reordering expense categories:', error);
        res.status(500).json({ message: 'Failed to reorder expense categories' });
    }
});

// PUT /api/expense-categories/:id - Update category
router.put('/expense-categories/:id', protect, hasPermission('expenses:manage_categories'), async (req, res) => {
    const categoryId = parseInt(req.params.id, 10);
    const { category_name, description, sort_order } = req.body;
    const employeeId = req.user.employee_id;

    if (isNaN(categoryId)) {
        return res.status(400).json({ message: 'Invalid category ID' });
    }

    if (!category_name || typeof category_name !== 'string' || category_name.trim().length === 0) {
        return res.status(400).json({ message: 'Category name is required' });
    }

    const trimmedName = category_name.trim();

    try {
        // Check case-insensitive duplicate excluding current category
        const existing = await db.query(
            'SELECT category_id FROM expense_category WHERE LOWER(category_name) = LOWER($1) AND category_id != $2',
            [trimmedName, categoryId]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'Another expense category with this name already exists' });
        }

        const updateQuery = `
            UPDATE expense_category
            SET category_name = $1, description = $2, sort_order = COALESCE($3, sort_order), modified_by = $4, updated_at = NOW()
            WHERE category_id = $5
            RETURNING category_id, category_name, description, sort_order, is_active, created_at, updated_at
        `;
        const result = await db.query(updateQuery, [trimmedName, description || null, sort_order !== undefined ? parseInt(sort_order, 10) : null, employeeId, categoryId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Category not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating expense category:', error);
        res.status(500).json({ message: 'Failed to update expense category' });
    }
});

// PUT /api/expense-categories/:id/toggle-active - Activate/deactivate category
router.put('/expense-categories/:id/toggle-active', protect, hasPermission('expenses:manage_categories'), async (req, res) => {
    const categoryId = parseInt(req.params.id, 10);
    const employeeId = req.user.employee_id;

    if (isNaN(categoryId)) {
        return res.status(400).json({ message: 'Invalid category ID' });
    }

    try {
        const query = `
            UPDATE expense_category
            SET is_active = NOT is_active, modified_by = $1, updated_at = NOW()
            WHERE category_id = $2
            RETURNING category_id, category_name, is_active
        `;
        const result = await db.query(query, [employeeId, categoryId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Category not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error toggling expense category status:', error);
        res.status(500).json({ message: 'Failed to toggle category status' });
    }
});

module.exports = router;
