/**
 * dedupe-scan-worker.js
 *
 * Background worker that runs deduplication scans and writes pre-computed
 * suggestions to the duplicate_suggestion_group table.
 *
 * Lifecycle:
 *   1. On startup:
 *      a. reset_stale_dedupe_rows() — requeue 'processing' queue rows stuck >10m
 *      b. resetStaleBatches()       — mark 'running' batches stuck >30m as 'failed'
 *   2. Check if a scan is already running (prevents double-runs)
 *   3. Create a new batch record (status='running')
 *   4. Run DeduplicationEngine.runFullScan()
 *   5. Update batch record to status='complete'
 *   6. Mark processed queue rows as 'done'
 *   7. Wait SCAN_INTERVAL_MS, then repeat
 *
 * Can also be triggered on-demand via POST /api/parts/merge/trigger-scan
 */

const { Pool } = require('pg');
const DeduplicationEngine = require('./services/deduplicationEngine');
require('dotenv').config({ path: '../../.env' });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'forson_business_suite',
});

// How long to wait between automatic scans (default: 8 hours)
const SCAN_INTERVAL_MS = parseInt(process.env.DEDUPE_SCAN_INTERVAL_MS || '28800000');

const engine = new DeduplicationEngine(pool);
let isRunning = false;

async function isWorkerEnabled() {
    const res = await pool.query(
        `SELECT setting_value FROM public.settings WHERE setting_key = 'DEDUPE_BACKGROUND_WORKER_ENABLED'`
    );
    if (res.rowCount > 0) return res.rows[0].setting_value !== 'false';
    return true; // Default: enabled
}

/**
 * Runs one complete scan cycle.
 * Safe to call concurrently — skips if already running.
 */
async function runScanCycle() {
    if (isRunning) {
        console.log('[DedupeWorker] Scan already running, skipping.');
        return;
    }

    const enabled = await isWorkerEnabled();
    if (!enabled) {
        console.log('[DedupeWorker] Worker disabled via settings. Skipping scan.');
        return;
    }

    isRunning = true;

    // Create batch record
    const batchRes = await pool.query(`
        INSERT INTO public.duplicate_suggestion_batch (status, started_at)
        VALUES ('running', NOW())
        RETURNING batch_id
    `);
    const batchId = batchRes.rows[0].batch_id;
    console.log(`[DedupeWorker] Starting batch #${batchId}`);

    try {
        const { totalGroups, aiCallsMade, processedPartIds } = await engine.runFullScan(
            batchId,
            (msg) => console.log(`[DedupeWorker] Batch #${batchId}: ${msg}`)
        );

        await pool.query(`
            UPDATE public.duplicate_suggestion_batch
            SET status = 'complete',
                completed_at = NOW(),
                total_groups = $1,
                ai_calls_made = $2
            WHERE batch_id = $3
        `, [totalGroups, aiCallsMade, batchId]);

        // Mark scanned parts as 'done' in the queue so delta scans skip them next time
        if (processedPartIds && processedPartIds.length > 0) {
            await pool.query(
                `UPDATE public.dedupe_scan_queue SET status = 'done', updated_at = NOW()
                 WHERE part_id = ANY($1)`,
                [processedPartIds]
            );
            console.log(`[DedupeWorker] Marked ${processedPartIds.length} queue entries as done.`);
        }

        console.log(`[DedupeWorker] Batch #${batchId} complete. Groups: ${totalGroups}, AI calls: ${aiCallsMade}`);

    } catch (error) {
        console.error(`[DedupeWorker] Batch #${batchId} failed:`, error.message);
        await pool.query(`
            UPDATE public.duplicate_suggestion_batch
            SET status = 'failed',
                completed_at = NOW(),
                error_message = $1
            WHERE batch_id = $2
        `, [error.message, batchId]);
    } finally {
        isRunning = false;
    }
}

/**
 * Marks any batch stuck in 'running' for more than 30 minutes as 'failed'.
 * Prevents the manual-trigger guard from blocking new scans indefinitely after a crash.
 */
async function resetStaleBatches() {
    const res = await pool.query(`
        UPDATE public.duplicate_suggestion_batch
        SET status = 'failed',
            completed_at = NOW(),
            error_message = 'Automatically failed: batch was still running on worker startup (crash recovery).'
        WHERE status = 'running'
          AND started_at < NOW() - INTERVAL '30 minutes'
        RETURNING batch_id
    `);
    if (res.rowCount > 0) {
        const ids = res.rows.map(r => r.batch_id).join(', ');
        console.log(`[DedupeWorker] Crash-recovered ${res.rowCount} stale batch(es): #${ids}`);
    }
}

async function startWorker() {
    console.log('[DedupeWorker] Starting...');

    // Reset dedupe_scan_queue rows stuck in 'processing' from a previous crash
    await pool.query(`SELECT public.reset_stale_dedupe_rows()`);
    console.log('[DedupeWorker] Stale queue rows reset.');

    // Reset duplicate_suggestion_batch rows stuck in 'running' from a previous crash
    await resetStaleBatches();

    // Run first scan immediately on startup
    await runScanCycle();

    // Then run on interval
    setInterval(runScanCycle, SCAN_INTERVAL_MS);
    console.log(`[DedupeWorker] Scheduled to run every ${SCAN_INTERVAL_MS / 3600000}h`);
}

// Export runScanCycle so it can be triggered via API route
module.exports = { startWorker, runScanCycle };

if (require.main === module) {
    startWorker().catch(err => {
        console.error('[DedupeWorker] Fatal startup error:', err);
        process.exit(1);
    });
}
