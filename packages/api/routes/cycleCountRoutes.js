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
            ORDER BY b.created_at ASC;
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
    const { id } = req.params;
    const { counted_qty } = req.body;

    if (counted_qty === undefined) {
        return res.status(400).json({ message: 'counted_qty is required' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Lock the line and verify it belongs to the current user's batch and is pending
        const lineResult = await client.query(`
            SELECT l.*, b.employee_id
            FROM cycle_count_line l
            JOIN cycle_count_batch b ON l.batch_id = b.batch_id
            WHERE l.line_id = $1 AND l.status = 'PENDING'
            FOR UPDATE OF l
        `, [id]);

        if (lineResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Line not found or already processed' });
        }

        const line = lineResult.rows[0];

        // Ensure the logged-in user is the one assigned to this batch
        if (line.employee_id !== req.user.employee_id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'Not authorized to submit this line' });
        }

        // 2. Snapshot current system quantity with a lock on the part
        const partResult = await client.query(`
            SELECT COALESCE(SUM(quantity), 0) AS system_qty 
            FROM inventory_transaction 
            WHERE part_id = $1
        `, [line.part_id]);

        // Aggregate functions always return 1 row, so we extract it directly
        const system_qty_snapshot = parseFloat(partResult.rows[0].system_qty || 0);
        const countedQuantity = parseFloat(counted_qty);

        // 3. Determine status
        const status = (system_qty_snapshot === countedQuantity) ? 'MATCHED_AUTO_APPROVED' : 'PENDING_MANAGER_REVIEW';

        // 4. Update the line
        const updateResult = await client.query(`
            UPDATE cycle_count_line
            SET
                counted_qty = $1,
                system_qty_snapshot = $2,
                status = $3,
                counted_at = CURRENT_TIMESTAMP
            WHERE line_id = $4
            RETURNING *
        `, [countedQuantity, system_qty_snapshot, status, id]);

        // 5. Also update part_inventory_stats last_counted_at
        await client.query(`
            INSERT INTO part_inventory_stats (part_id, last_counted_at, audit_requested)
            VALUES ($1, CURRENT_TIMESTAMP, FALSE)
            ON CONFLICT (part_id) DO UPDATE
            SET last_counted_at = CURRENT_TIMESTAMP, audit_requested = FALSE
        `, [line.part_id]);

        await client.query('COMMIT');
        res.json(updateResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// POST /api/inventory/cycle-count/unassigned-find
router.post('/inventory/cycle-count/unassigned-find', protect, hasPermission('cycle_count:execute'), async (req, res) => {
    const { employee_id } = req.user;
    const { part_id, counted_qty } = req.body;

    if (!part_id || counted_qty === undefined) {
        return res.status(400).json({ message: 'part_id and counted_qty are required' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Ensure part exists and snapshot qty
        const partResult = await client.query('SELECT stock_on_hand FROM part WHERE part_id = $1 FOR SHARE', [part_id]);
        if (partResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Part not found' });
        }

        const system_qty_snapshot = parseFloat(partResult.rows[0].stock_on_hand || 0);
        const countedQuantity = parseFloat(counted_qty);

        // 2. Find an active batch for this user
        const batchResult = await client.query(`
            SELECT batch_id FROM cycle_count_batch
            WHERE employee_id = $1 AND status IN ('PENDING', 'IN_PROGRESS')
            ORDER BY created_at DESC LIMIT 1
        `, [employee_id]);

        let batch_id;
        if (batchResult.rows.length > 0) {
            batch_id = batchResult.rows[0].batch_id;
            // Update status if it was pending
            await client.query(`UPDATE cycle_count_batch SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE batch_id = $1`, [batch_id]);
        } else {
            // No active batch, maybe create an ad-hoc one? The system requires a batch for lines.
            // Let's create an ad-hoc batch.
            const newBatchResult = await client.query(`
                INSERT INTO cycle_count_batch (employee_id, status, started_at)
                VALUES ($1, 'IN_PROGRESS', CURRENT_TIMESTAMP)
                RETURNING batch_id
            `, [employee_id]);
            batch_id = newBatchResult.rows[0].batch_id;
        }

        // 3. Insert line
        const status = (system_qty_snapshot === countedQuantity) ? 'MATCHED_AUTO_APPROVED' : 'PENDING_MANAGER_REVIEW';

        const lineResult = await client.query(`
            INSERT INTO cycle_count_line (batch_id, part_id, status, system_qty_snapshot, counted_qty, is_unassigned_find, counted_at)
            VALUES ($1, $2, $3, $4, $5, TRUE, CURRENT_TIMESTAMP)
            RETURNING *
        `, [batch_id, part_id, status, system_qty_snapshot, countedQuantity]);

        // 4. Update part_inventory_stats
        await client.query(`
            INSERT INTO part_inventory_stats (part_id, last_counted_at, audit_requested)
            VALUES ($1, CURRENT_TIMESTAMP, FALSE)
            ON CONFLICT (part_id) DO UPDATE
            SET last_counted_at = CURRENT_TIMESTAMP, audit_requested = FALSE
        `, [part_id]);

        await client.query('COMMIT');
        res.json(lineResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// GET /api/inventory/cycle-count/manager/review
router.get('/inventory/cycle-count/manager/review', protect, hasPermission('cycle_count:manage'), async (req, res) => {
    try {
        const query = `
            SELECT 
                l.*, 
                p.detail, 
                p.internal_sku, 
                p.wac_cost,
                b.employee_id,
                (l.counted_qty - l.system_qty_snapshot) AS variance_qty,
                ((l.counted_qty - l.system_qty_snapshot) * p.wac_cost) AS financial_impact
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

// POST /api/inventory/cycle-count/lines/:line_id/approve
router.post('/inventory/cycle-count/lines/:line_id/approve', protect, hasPermission('cycle_count:manage'), async (req, res) => {
    const { line_id } = req.params;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const lineResult = await client.query(`
            SELECT * FROM cycle_count_line 
            WHERE line_id = $1 
            FOR UPDATE
        `, [line_id]);

        if (lineResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Line not found' });
        }

        const line = lineResult.rows[0];

        if (line.status !== 'PENDING_MANAGER_REVIEW') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Line is not pending manager review' });
        }

        const variance_qty = line.counted_qty - line.system_qty_snapshot;

        // The Ledger Guardrail
        await client.query(`
            INSERT INTO inventory_transaction (part_id, quantity, trans_type, reference_no, employee_id)
            VALUES ($1, $2, 'Cycle Count Adjustment', $3, $4)
        `, [line.part_id, variance_qty, line_id.toString(), req.user.employee_id]);

        await client.query(`
            UPDATE cycle_count_line 
            SET status = 'APPROVED_ADJUSTED' 
            WHERE line_id = $1
        `, [line_id]);

        await client.query('COMMIT');
        res.json({ message: 'Adjustment approved successfully' });
        // Background cache clearance
        db.query('REFRESH MATERIALIZED VIEW employee_cycle_count_performance;')
          .catch(err => console.error('[AnalyticsView] Background refresh failure:', err));
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// POST /api/inventory/cycle-count/manager/recount/:id
router.post('/inventory/cycle-count/manager/recount/:id', protect, hasPermission('cycle_count:manage'), async (req, res) => {
    res.status(501).send('Not Implemented Yet');
});



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


// GET /api/inventory/cycle-count/performance
router.get('/inventory/cycle-count/performance', protect, hasPermission('cycle_count:manage'), async (req, res) => {
    try {
        await db.query('REFRESH MATERIALIZED VIEW employee_cycle_count_performance');
        const { rows } = await db.query('SELECT * FROM employee_cycle_count_performance ORDER BY employee_name ASC');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
