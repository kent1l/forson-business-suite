const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/inventory/cycle-count/my-tasks
router.get('/inventory/cycle-count/my-tasks', protect, hasPermission('cycle_count:execute'), async (req, res) => {
    try {
        const { employee_id } = req.user;
        const query = `
            SELECT
                l.*,
                p.detail,
                p.internal_sku,
                COALESCE(pv.display_name, p.internal_sku, p.detail) AS display_name
            FROM cycle_count_line l
            JOIN cycle_count_batch b ON l.batch_id = b.batch_id
            JOIN part p ON l.part_id = p.part_id
            LEFT JOIN parts_view pv ON pv.part_id = p.part_id
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

        // Load Smart Tolerance Thresholds from settings
        const settingsResult = await client.query(`
            SELECT setting_key, setting_value FROM settings 
            WHERE setting_key IN ('CYCLE_COUNT_MAX_VARIANCE_QTY', 'CYCLE_COUNT_MAX_FINANCIAL_IMPACT')
        `);
        const settings = settingsResult.rows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});

        const MAX_VARIANCE_QTY = parseFloat(settings['CYCLE_COUNT_MAX_VARIANCE_QTY'] || '2');
        const MAX_FINANCIAL_IMPACT = parseFloat(settings['CYCLE_COUNT_MAX_FINANCIAL_IMPACT'] || '5.00');

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

        // 2. Snapshot current system quantity and fetch WAC cost with a lock on the part
        const partResult = await client.query(`
            SELECT 
                p.wac_cost,
                COALESCE((SELECT SUM(quantity) FROM inventory_transaction WHERE part_id = $1), 0) AS system_qty
            FROM part p 
            WHERE p.part_id = $1
        `, [line.part_id]);

        const system_qty_snapshot = parseFloat(partResult.rows[0].system_qty || 0);
        const wac_cost = parseFloat(partResult.rows[0].wac_cost || 0);
        const countedQuantity = parseFloat(counted_qty);

        // 3. Determine status and calculate variance
        const variance_qty = countedQuantity - system_qty_snapshot;
        const financial_impact = Math.abs(variance_qty * wac_cost);
        let status = 'PENDING_MANAGER_REVIEW';

        if (variance_qty === 0) {
            status = 'MATCHED_AUTO_APPROVED';
        } else if (Math.abs(variance_qty) <= MAX_VARIANCE_QTY || financial_impact <= MAX_FINANCIAL_IMPACT) {
            status = 'APPROVED_ADJUSTED'; // Auto-approved due to tolerance
        }

        // 3.5 The Ledger Guardrail (Auto-Adjustment)
        // If the variance is within tolerance but not 0, we must automatically adjust the stock
        if (variance_qty !== 0 && status === 'APPROVED_ADJUSTED') {
            await client.query(`
                INSERT INTO inventory_transaction (part_id, quantity, trans_type, reference_no, employee_id)
                VALUES ($1, $2, 'Cycle Count Auto-Adjustment', $3, $4)
            `, [line.part_id, variance_qty, id.toString(), req.user.employee_id]);
        }

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

        // 1. Ensure part exists, fetch WAC, and snapshot qty
        const partResult = await client.query(`
            SELECT
                p.part_id,
                p.wac_cost,
                COALESCE((SELECT SUM(quantity) FROM inventory_transaction WHERE part_id = $1), 0) AS stock_on_hand
            FROM part p
            WHERE p.part_id = $1
        `, [part_id]);

        if (partResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Part not found' });
        }

        const system_qty_snapshot = parseFloat(partResult.rows[0].stock_on_hand || 0);
        const wac_cost = parseFloat(partResult.rows[0].wac_cost || 0);
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

        // 2.5 Tolerance Evaluation
        // Load Smart Tolerance Thresholds from settings
        const settingsResult = await client.query(`
            SELECT setting_key, setting_value FROM settings 
            WHERE setting_key IN ('CYCLE_COUNT_MAX_VARIANCE_QTY', 'CYCLE_COUNT_MAX_FINANCIAL_IMPACT')
        `);
        const settings = settingsResult.rows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});

        const MAX_VARIANCE_QTY = parseFloat(settings['CYCLE_COUNT_MAX_VARIANCE_QTY'] || '2');
        const MAX_FINANCIAL_IMPACT = parseFloat(settings['CYCLE_COUNT_MAX_FINANCIAL_IMPACT'] || '5.00');
        
        const variance_qty = countedQuantity - system_qty_snapshot;
        const financial_impact = Math.abs(variance_qty * wac_cost);
        let status = 'PENDING_MANAGER_REVIEW';

        if (variance_qty === 0) {
            status = 'MATCHED_AUTO_APPROVED';
        } else if (Math.abs(variance_qty) <= MAX_VARIANCE_QTY || financial_impact <= MAX_FINANCIAL_IMPACT) {
            status = 'APPROVED_ADJUSTED';
        }

        // Auto-Adjustment Ledger Guardrail
        if (variance_qty !== 0 && status === 'APPROVED_ADJUSTED') {
            // We need a temporary reference since the line isn't created yet, we will use 'Auto-Adj'
            await client.query(`
                INSERT INTO inventory_transaction (part_id, quantity, trans_type, reference_no, employee_id)
                VALUES ($1, $2, 'Cycle Count Auto-Adjustment', 'Unassigned-Find', $3)
            `, [part_id, variance_qty, employee_id]);
        }

        // 3. Insert line
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
                COALESCE(pv.display_name, p.internal_sku, p.detail) AS display_name,
                p.wac_cost,
                b.employee_id,
                (l.counted_qty - l.system_qty_snapshot) AS variance_qty,
                ((l.counted_qty - l.system_qty_snapshot) * p.wac_cost) AS financial_impact
            FROM cycle_count_line l
            JOIN cycle_count_batch b ON l.batch_id = b.batch_id
            JOIN part p ON l.part_id = p.part_id
            LEFT JOIN parts_view pv ON pv.part_id = p.part_id
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
    const { id } = req.params;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        // 1. Lock the line for update
        const lineResult = await client.query(`
            SELECT * FROM cycle_count_line 
            WHERE line_id = $1 
            FOR UPDATE
        `, [id]);

        if (lineResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Line not found' });
        }

        const line = lineResult.rows[0];

        // 2. Ensure the line is actually pending review
        if (line.status !== 'PENDING_MANAGER_REVIEW') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Line is not pending manager review' });
        }

        // 3. Mark the line as rejected for recount
        await client.query(`
            UPDATE cycle_count_line 
            SET status = 'RECOUNT_REQUESTED' 
            WHERE line_id = $1
        `, [id]);

        // 4. Force the nightly engine to prioritize this part again by setting audit_requested to TRUE
        await client.query(`
            INSERT INTO part_inventory_stats (part_id, audit_requested)
            VALUES ($1, TRUE)
            ON CONFLICT (part_id) DO UPDATE 
            SET audit_requested = TRUE
        `, [line.part_id]);

        await client.query('COMMIT');
        res.json({ message: 'Recount requested successfully. Part flagged for audit.' });
        
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
