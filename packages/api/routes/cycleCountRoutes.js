const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/inventory/cycle-count/my-tasks
router.get('/inventory/cycle-count/my-tasks', protect, hasPermission('cycle_count:execute'), async (req, res) => {
    try {
        const { employee_id } = req.user;
        const query = `
            SELECT l.*, p.detail, p.internal_sku
            FROM cycle_count_line l
            JOIN cycle_count_batch b ON l.batch_id = b.batch_id
            JOIN part p ON l.part_id = p.part_id
            WHERE b.employee_id = $1 AND b.status IN ('PENDING', 'IN_PROGRESS')
            AND l.status = 'PENDING'
            ORDER BY l.created_at ASC;
        `;
        const { rows } = await db.query(query, [employee_id]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /api/inventory/cycle-count/lines/:id/submit
router.post('/inventory/cycle-count/lines/:id/submit', protect, hasPermission('cycle_count:execute'), async (req, res) => {
    res.status(501).send('Not Implemented Yet');
});

// POST /api/inventory/cycle-count/unassigned-find
router.post('/inventory/cycle-count/unassigned-find', protect, hasPermission('cycle_count:execute'), async (req, res) => {
    res.status(501).send('Not Implemented Yet');
});

// GET /api/inventory/cycle-count/manager/review
router.get('/inventory/cycle-count/manager/review', protect, hasPermission('cycle_count:manage'), async (req, res) => {
    try {
        const query = `
            SELECT l.*, p.detail, p.internal_sku, b.employee_id
            FROM cycle_count_line l
            JOIN cycle_count_batch b ON l.batch_id = b.batch_id
            JOIN part p ON l.part_id = p.part_id
            WHERE l.status = 'PENDING_MANAGER_REVIEW'
            ORDER BY l.counted_at DESC;
        `;
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /api/inventory/cycle-count/manager/approve/:id
router.post('/inventory/cycle-count/manager/approve/:id', protect, hasPermission('cycle_count:manage'), async (req, res) => {
    res.status(501).send('Not Implemented Yet');
});

// POST /api/inventory/cycle-count/manager/recount/:id
router.post('/inventory/cycle-count/manager/recount/:id', protect, hasPermission('cycle_count:manage'), async (req, res) => {
    res.status(501).send('Not Implemented Yet');
});

module.exports = router;

// POST /api/inventory/cycle-count/request-audit
router.post('/inventory/cycle-count/request-audit', protect, hasPermission('cycle_count:manage'), async (req, res) => {
    try {
        const { part_id } = req.body;
        if (!part_id) {
            return res.status(400).json({ message: 'Part ID is required.' });
        }

        await db.query(`
            INSERT INTO part_inventory_stats (part_id, audit_requested)
            VALUES ($1, TRUE)
            ON CONFLICT (part_id) DO UPDATE SET audit_requested = TRUE;
        `, [part_id]);

        res.json({ message: 'Audit requested successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});
