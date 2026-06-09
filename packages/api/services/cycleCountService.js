const cron = require('node-cron');
const db = require('../db');

let currentCronJob = null;

async function generateCycleCountBatches() {
    console.log('[CycleCountEngine] Starting nightly batch generation...');
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Fetch settings
        const { rows: settingsRows } = await client.query('SELECT setting_key, setting_value FROM settings');
        const settings = settingsRows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});

        const isEnabled = settings['CYCLE_COUNT_ENABLED'] === 'true';
        if (!isEnabled) {
            console.log('[CycleCountEngine] Cycle counting is disabled. Exiting.');
            await client.query('ROLLBACK');
            return;
        }

        const batchSize = parseInt(settings['CYCLE_COUNT_BATCH_SIZE'] || '50', 10);
        const uncountedWeight = parseInt(settings['CYCLE_COUNT_UNCOUNTED_WEIGHT'] || '1', 10);
        const velocityWeight = parseInt(settings['CYCLE_COUNT_VELOCITY_WEIGHT'] || '5', 10);
        const negativeStockWeight = parseInt(settings['CYCLE_COUNT_NEGATIVE_STOCK_WEIGHT'] || '1000', 10);

        // 2. Fetch available employees
        const { rows: employees } = await client.query(`
            SELECT DISTINCT e.employee_id
            FROM employee e
            LEFT JOIN role_permission rp ON e.permission_level_id = rp.permission_level_id
            LEFT JOIN permission p ON rp.permission_id = p.permission_id
            WHERE e.is_active = TRUE
              AND (e.permission_level_id = 10 OR p.permission_key = 'cycle_count:execute')
        `);

        if (employees.length === 0) {
            console.log('[CycleCountEngine] No eligible employees found for cycle counting.');
            await client.query('ROLLBACK');
            return;
        }

        const employeeIds = employees.map(e => e.employee_id);

        // 3. Priority Scoring Algorithm
        const { rows: parts } = await client.query(`
            WITH part_metrics AS (
                SELECT
                    p.part_id,
                    p.group_id,
                    COALESCE(pis.last_counted_at, p.date_created) AS last_counted_at,
                    COALESCE(pis.audit_requested, FALSE) AS audit_requested,
                    (SELECT COALESCE(SUM(quantity), 0) FROM inventory_transaction WHERE part_id = p.part_id) AS current_stock,
                    (
                        SELECT COALESCE(SUM(ABS(quantity)), 0)
                        FROM inventory_transaction
                        WHERE part_id = p.part_id
                          AND trans_type = 'StockOut'
                          AND transaction_date >= NOW() - INTERVAL '30 days'
                    ) AS velocity_30d
                FROM part p
                LEFT JOIN part_inventory_stats pis ON p.part_id = pis.part_id
                WHERE p.is_active = TRUE
            )
            SELECT
                part_id,
                group_id,
                audit_requested,
                (
                    GREATEST(0, EXTRACT(DAY FROM (NOW() - last_counted_at))) * $1 +
                    velocity_30d * $2 +
                    CASE WHEN current_stock < 0 THEN $3 ELSE 0 END +
                    CASE WHEN audit_requested THEN 999999 ELSE 0 END
                ) AS priority_score
            FROM part_metrics
            ORDER BY priority_score DESC
        `, [uncountedWeight, velocityWeight, negativeStockWeight]);

        if (parts.length === 0) {
            console.log('[CycleCountEngine] No active parts found.');
            await client.query('ROLLBACK');
            return;
        }

        // 4. Concurrency Control Grouping
        const assignmentMap = {}; // { employee_id: [part] }
        employeeIds.forEach(id => { assignmentMap[id] = []; });
        const employeeUsedGroups = {}; // { employee_id: Set(group_id) }
        employeeIds.forEach(id => { employeeUsedGroups[id] = new Set(); });

        for (const part of parts) {
            // Find an eligible employee for this part
            let assignedEmployee = null;

            for (const empId of employeeIds) {
                if (assignmentMap[empId].length >= batchSize) continue;

                let canAssign = true;
                if (part.group_id !== null) {
                    // Ensure no OTHER employee is using this group_id
                    for (const otherEmpId of employeeIds) {
                        if (otherEmpId !== empId && employeeUsedGroups[otherEmpId].has(part.group_id)) {
                            canAssign = false;
                            break;
                        }
                    }
                }

                if (canAssign) {
                    assignedEmployee = empId;
                    break;
                }
            }

            if (assignedEmployee) {
                assignmentMap[assignedEmployee].push(part);
                if (part.group_id !== null) {
                    employeeUsedGroups[assignedEmployee].add(part.group_id);
                }
            }

            // If all employees are full, we can stop
            const allFull = employeeIds.every(id => assignmentMap[id].length >= batchSize);
            if (allFull) break;
        }

        // 5. Database Insertions
        let batchesCreated = 0;
        let linesCreated = 0;
        const auditRequestedPartsToClear = [];

        for (const empId of employeeIds) {
            const assignedParts = assignmentMap[empId];
            if (assignedParts.length === 0) continue;

            const { rows: batchRows } = await client.query(
                'INSERT INTO cycle_count_batch (employee_id, status) VALUES ($1, $2) RETURNING batch_id',
                [empId, 'PENDING']
            );
            const batchId = batchRows[0].batch_id;
            batchesCreated++;

            for (const part of assignedParts) {
                await client.query(
                    'INSERT INTO cycle_count_line (batch_id, part_id, status) VALUES ($1, $2, $3) RETURNING line_id',
                    [batchId, part.part_id, 'PENDING']
                );
                linesCreated++;
                if (part.audit_requested) {
                    auditRequestedPartsToClear.push(part.part_id);
                }
            }
        }

        if (auditRequestedPartsToClear.length > 0) {
            await client.query(
                'UPDATE part_inventory_stats SET audit_requested = FALSE WHERE part_id = ANY($1::int[])',
                [auditRequestedPartsToClear]
            );
        }

        await client.query('COMMIT');
        console.log(`[CycleCountEngine] Batch generation complete. Created ${batchesCreated} batches and ${linesCreated} lines.`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CycleCountEngine] Error generating batches:', err);
    } finally {
        client.release();
    }
}

async function startCycleCountEngine() {
    try {
        const { rows } = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'CYCLE_COUNT_SCHEDULE'");
        const schedule = (rows.length > 0 && rows[0].setting_value) ? rows[0].setting_value : '0 2 * * *';

        console.log(`[CycleCountEngine] Scheduling cron job with pattern: ${schedule}`);

        if (currentCronJob) {
            currentCronJob.stop();
        }

        currentCronJob = cron.schedule(schedule, () => {
            generateCycleCountBatches();
        });

    } catch (err) {
        console.error('[CycleCountEngine] Failed to start engine:', err);
    }
}

module.exports = {
    startCycleCountEngine,
    generateCycleCountBatches
};
