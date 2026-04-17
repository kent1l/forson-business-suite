const db = require('./db');
const { meiliClient, syncPartWithMeili } = require('./meilisearch');
const { setupMeiliSearch } = require('./meilisearch-setup');
const { getPartDataForMeili } = require('./routes/partRoutes');

const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  CANCELLING: 'cancelling'
});

const JOB_MODES = Object.freeze({
  DRY: 'dry',
  FULL: 'full',
  RECONCILE: 'reconcile'
});

const DEFAULTS = Object.freeze({
  pollMs: Number(process.env.SEARCH_REPAIR_POLL_MS || 2000),
  batchSize: Number(process.env.SEARCH_REPAIR_BATCH_SIZE || 250),
  progressEvery: Number(process.env.SEARCH_REPAIR_PROGRESS_EVERY || 100),
  reconcileDriftThresholdAbs: Number(process.env.SEARCH_REPAIR_DRIFT_THRESHOLD_ABS || 25),
  reconcileDriftThresholdPct: Number(process.env.SEARCH_REPAIR_DRIFT_THRESHOLD_PCT || 0.02),
  reconcileSampleSize: Number(process.env.SEARCH_REPAIR_RECONCILE_SAMPLE_SIZE || 50)
});

let schemaReadyPromise = null;

const ensureSearchRepairSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(
        `CREATE TABLE IF NOT EXISTS search_repair_jobs (
          job_id BIGSERIAL PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'cancelling')),
          mode TEXT NOT NULL DEFAULT 'full' CHECK (mode IN ('dry', 'full', 'reconcile')),
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ,
          total INTEGER NOT NULL DEFAULT 0,
          processed INTEGER NOT NULL DEFAULT 0,
          success INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          error TEXT
        )`
      );

      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_search_repair_jobs_poll
         ON search_repair_jobs (status, created_at)`
      );
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
};

const createRepairJob = async ({ mode = JOB_MODES.FULL, createdBy = null }) => {
  await ensureSearchRepairSchema();
  const { rows } = await db.query(
    `INSERT INTO search_repair_jobs (mode, created_by, status)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [mode, createdBy, JOB_STATUS.PENDING]
  );
  return rows[0];
};

const getRepairJob = async (jobId) => {
  await ensureSearchRepairSchema();
  const { rows } = await db.query('SELECT * FROM search_repair_jobs WHERE job_id = $1', [jobId]);
  return rows[0] || null;
};

const cancelRepairJob = async (jobId) => {
  await ensureSearchRepairSchema();
  const { rows } = await db.query(
    `UPDATE search_repair_jobs
     SET status = CASE
       WHEN status = $2 THEN $3
       WHEN status = $4 THEN $5
       ELSE status
     END,
     finished_at = CASE WHEN status = $4 THEN NOW() ELSE finished_at END,
     error = CASE WHEN status = $4 THEN 'Cancelled by user before processing.' ELSE error END
     WHERE job_id = $1
     RETURNING *`,
    [jobId, JOB_STATUS.PROCESSING, JOB_STATUS.CANCELLING, JOB_STATUS.PENDING, JOB_STATUS.CANCELLED]
  );

  return rows[0] || null;
};

const estimateRemainingSeconds = (job) => {
  if (!job || !job.started_at || !job.total || !job.processed) return null;
  const started = new Date(job.started_at).getTime();
  const elapsed = Math.max(1, (Date.now() - started) / 1000);
  const rate = job.processed / elapsed;
  if (!rate || rate <= 0) return null;
  return Math.max(0, Math.ceil((job.total - job.processed) / rate));
};

const fetchJobStatusPayload = async (jobId) => {
  const job = await getRepairJob(jobId);
  if (!job) return null;

  const percent = job.total > 0 ? Number(((job.processed / job.total) * 100).toFixed(2)) : 0;
  return {
    ...job,
    progress_pct: percent,
    estimated_remaining_seconds: estimateRemainingSeconds(job)
  };
};

const claimNextPendingJob = async () => {
  await ensureSearchRepairSchema();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH candidate AS (
        SELECT job_id
        FROM search_repair_jobs
        WHERE status = $1
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE search_repair_jobs j
      SET status = $2,
          started_at = NOW(),
          error = NULL
      FROM candidate c
      WHERE j.job_id = c.job_id
      RETURNING j.*`,
      [JOB_STATUS.PENDING, JOB_STATUS.PROCESSING]
    );
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const persistProgress = async ({ jobId, processed, success, failed, total }) => {
  await db.query(
    `UPDATE search_repair_jobs
     SET processed = $2,
         success = $3,
         failed = $4,
         total = $5
     WHERE job_id = $1`,
    [jobId, processed, success, failed, total]
  );
};

const hasCancellationRequested = async (jobId) => {
  const { rows } = await db.query('SELECT status FROM search_repair_jobs WHERE job_id = $1', [jobId]);
  if (!rows[0]) return true;
  return rows[0].status === JOB_STATUS.CANCELLING;
};

const finishJob = async (jobId, status, fields = {}) => {
  await db.query(
    `UPDATE search_repair_jobs
     SET status = $2,
         finished_at = NOW(),
         processed = COALESCE($3, processed),
         success = COALESCE($4, success),
         failed = COALESCE($5, failed),
         total = COALESCE($6, total),
         error = $7
     WHERE job_id = $1`,
    [jobId, status, fields.processed ?? null, fields.success ?? null, fields.failed ?? null, fields.total ?? null, fields.error || null]
  );
};

const getPartIds = async () => {
  const { rows } = await db.query('SELECT part_id FROM part ORDER BY part_id ASC');
  return rows.map((row) => row.part_id);
};

const processRepairJob = async (job, config) => {
  const jobId = job.job_id;
  const mode = job.mode;

  try {
    const idsRes = await db.query('SELECT COUNT(*)::int AS count FROM part');
    const total = idsRes.rows[0].count || 0;

    if (mode === JOB_MODES.DRY) {
      await finishJob(jobId, JOB_STATUS.COMPLETED, {
        processed: total,
        success: total,
        failed: 0,
        total,
        error: null
      });
      return;
    }

    await db.query('UPDATE search_repair_jobs SET total = $2 WHERE job_id = $1', [jobId, total]);

    await setupMeiliSearch();

    const ids = await getPartIds();

    let processed = 0;
    let success = 0;
    let failed = 0;
    let payload = [];

    for (const id of ids) {
      if (await hasCancellationRequested(jobId)) {
        await finishJob(jobId, JOB_STATUS.CANCELLED, {
          processed,
          success,
          failed,
          total,
          error: 'Cancelled by user.'
        });
        return;
      }

      try {
        const doc = await getPartDataForMeili(db, id);
        if (doc) {
          payload.push(doc);
          success += 1;
        }
      } catch (error) {
        failed += 1;
      }

      processed += 1;

      if (payload.length >= config.batchSize) {
        await syncPartWithMeili(payload);
        payload = [];
      }

      if (processed % config.progressEvery === 0) {
        await persistProgress({ jobId, processed, success, failed, total });
      }
    }

    if (payload.length > 0) {
      await syncPartWithMeili(payload);
    }

    await finishJob(jobId, JOB_STATUS.COMPLETED, {
      processed,
      success,
      failed,
      total,
      error: null
    });
  } catch (error) {
    await finishJob(jobId, JOB_STATUS.FAILED, {
      error: error && error.message ? error.message : String(error)
    });
  }
};

const samplePartIds = async (sampleSize) => {
  const { rows } = await db.query(
    `SELECT part_id
     FROM part
     ORDER BY RANDOM()
     LIMIT $1`,
    [sampleSize]
  );
  return rows.map((row) => row.part_id);
};

const runNightlyReconciliation = async (config = DEFAULTS) => {
  await ensureSearchRepairSchema();
  const [{ rows: dbRows }, { rows: meiliRows }] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS count FROM part'),
    meiliClient.index('parts').getStats().then((stats) => ({ rows: [{ count: stats.numberOfDocuments || 0 }] }))
  ]);

  const dbCount = dbRows[0].count || 0;
  const indexedCount = meiliRows[0].count || 0;
  const absDrift = Math.abs(dbCount - indexedCount);
  const pctDrift = dbCount > 0 ? absDrift / dbCount : 0;

  let missingFromIndex = 0;
  const sampleIds = await samplePartIds(Math.min(config.reconcileSampleSize, Math.max(5, dbCount)));

  for (const partId of sampleIds) {
    try {
      await meiliClient.index('parts').getDocument(partId);
    } catch (_error) {
      missingFromIndex += 1;
    }
  }

  const sampleMismatchRate = sampleIds.length > 0 ? missingFromIndex / sampleIds.length : 0;
  const shouldOpenRepair = absDrift >= config.reconcileDriftThresholdAbs
    || pctDrift >= config.reconcileDriftThresholdPct
    || sampleMismatchRate >= 0.1;

  if (!shouldOpenRepair) {
    return { dbCount, indexedCount, absDrift, pctDrift, sampleMismatchRate, openedJob: false };
  }

  const activeRes = await db.query(
    `SELECT job_id
     FROM search_repair_jobs
     WHERE status IN ($1, $2)
     ORDER BY created_at DESC
     LIMIT 1`,
    [JOB_STATUS.PENDING, JOB_STATUS.PROCESSING]
  );

  if (activeRes.rows.length > 0) {
    return { dbCount, indexedCount, absDrift, pctDrift, sampleMismatchRate, openedJob: false, reason: 'active job exists' };
  }

  await createRepairJob({ mode: JOB_MODES.RECONCILE, createdBy: 'system:nightly-reconciliation' });
  return { dbCount, indexedCount, absDrift, pctDrift, sampleMismatchRate, openedJob: true };
};

const startSearchRepairWorker = (options = {}) => {
  const config = { ...DEFAULTS, ...options };
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const job = await claimNextPendingJob();
      if (!job) return;
      console.log('[SearchRepair] picked job', job.job_id, job.mode);
      await processRepairJob(job, config);
    } catch (error) {
      console.error('[SearchRepair] worker tick failed:', error && error.stack ? error.stack : error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, config.pollMs);
  tick();

  const scheduleNightly = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const delay = next.getTime() - now.getTime();

    setTimeout(async () => {
      try {
        const result = await runNightlyReconciliation(config);
        console.log('[SearchRepair] nightly reconciliation:', result);
      } catch (error) {
        console.error('[SearchRepair] nightly reconciliation failed:', error && error.message ? error.message : error);
      } finally {
        scheduleNightly();
      }
    }, delay);
  };

  scheduleNightly();

  console.log('[SearchRepair] worker started', config);

  return {
    stop: () => clearInterval(timer)
  };
};

module.exports = {
  JOB_MODES,
  JOB_STATUS,
  createRepairJob,
  getRepairJob,
  cancelRepairJob,
  fetchJobStatusPayload,
  startSearchRepairWorker,
  runNightlyReconciliation
};
