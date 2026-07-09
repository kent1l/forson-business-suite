const db = require('./db');
const { syncPartWithMeili, removePartFromMeili } = require('./meilisearch');
const { normalizePartData } = require('./helpers/normalizePart');

const STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  DEAD: 'dead'
});

const DEFAULTS = Object.freeze({
  pollMs: Number(process.env.MEILI_OUTBOX_POLL_MS || 1500),
  batchSize: Number(process.env.MEILI_OUTBOX_BATCH_SIZE || 100),
  maxAttempts: Number(process.env.MEILI_OUTBOX_MAX_ATTEMPTS || 8),
  leaseSeconds: Number(process.env.MEILI_OUTBOX_LEASE_SECONDS || 120),
  metricsEvery: Number(process.env.MEILI_OUTBOX_METRICS_EVERY || 20),
  deadGrowthThreshold: Number(process.env.MEILI_OUTBOX_ALERT_DEAD_GROWTH || 10),
  backlogAgeThresholdSeconds: Number(process.env.MEILI_OUTBOX_ALERT_BACKLOG_AGE_SECONDS || 120),
  workerIdleThresholdSeconds: Number(process.env.MEILI_OUTBOX_ALERT_WORKER_IDLE_SECONDS || 300)
});

const parseTimestamp = (value) => {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
};

const loadPartDocs = async (partIds) => {
  if (!Array.isArray(partIds) || partIds.length === 0) return [];

  const query = `
    SELECT
      pv.*,
      (SELECT ARRAY_AGG(
        CONCAT(vmk.make_name, ' ', vmd.model_name, COALESCE(CONCAT(' ', veng.engine_name), ''))
      )
      FROM part_application pa
      JOIN application a ON pa.application_id = a.application_id
      LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
      LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
      LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
      WHERE pa.part_id = pv.part_id) AS applications_array,
      (SELECT ARRAY_AGG(t.tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = pv.part_id) AS tags_array
    FROM public.parts_view AS pv
    WHERE pv.part_id = ANY($1::int[])
  `;

  const { rows } = await db.query(query, [partIds]);

  return rows.map((part) => {
    const normalizedFields = normalizePartData(part);
    return {
      ...part,
      // display_name is provided natively by parts_view
      applications: part.applications_array || [],
      searchable_applications: (part.applications_array && Array.isArray(part.applications_array))
        ? part.applications_array.map((app) => (typeof app === 'string' ? app : `${app.make || ''} ${app.model || ''} ${app.engine || ''}`.trim())).join(', ')
        : '',
      tags: part.tags_array || [],
      normalized_internal_sku: normalizedFields.normalized_internal_sku,
      normalized_part_numbers: normalizedFields.normalized_part_numbers
    };
  });
};

const claimEvents = async (client, batchSize, leaseSeconds) => {
  const claimSql = `
    WITH latest_per_entity AS (
      SELECT DISTINCT ON (entity_id) outbox_id, entity_id, created_at
      FROM meili_sync_outbox
      WHERE status IN ($1, $2)
        AND available_at <= NOW()
        AND (lease_until IS NULL OR lease_until < NOW())
      ORDER BY entity_id, created_at DESC, outbox_id DESC
    ),
    candidates AS (
      SELECT outbox_id, entity_id, created_at
      FROM latest_per_entity
      ORDER BY created_at ASC
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
      UPDATE meili_sync_outbox o
      SET status = $4,
          lease_until = NOW() + ($5::text || ' seconds')::interval,
          attempts = attempts + 1,
          updated_at = NOW()
      FROM candidates c
      WHERE o.outbox_id = c.outbox_id
      RETURNING o.outbox_id, o.event_type, o.entity_id, o.attempts, o.payload, o.created_at
    ),
    coalesced AS (
      UPDATE meili_sync_outbox older
      SET status = $6,
          processed_at = NOW(),
          lease_until = NULL,
          last_error = 'Coalesced by newer event for same entity',
          updated_at = NOW()
      FROM claimed keep
      WHERE older.entity_id = keep.entity_id
        AND older.outbox_id <> keep.outbox_id
        AND older.status IN ($1, $2)
        AND older.available_at <= NOW()
        AND (older.lease_until IS NULL OR older.lease_until < NOW())
        AND older.created_at <= keep.created_at
      RETURNING older.outbox_id
    )
    SELECT
      COALESCE(
        (
          SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'outbox_id', claimed.outbox_id,
              'event_type', claimed.event_type,
              'entity_id', claimed.entity_id,
              'attempts', claimed.attempts,
              'payload', claimed.payload
            )
          )
          FROM claimed
        ),
        '[]'::json
      ) AS rows,
      (SELECT COUNT(*)::int FROM coalesced) AS coalesced_count
  `;

  const { rows } = await client.query(claimSql, [STATUS.PENDING, STATUS.PROCESSING, batchSize, STATUS.PROCESSING, String(leaseSeconds), STATUS.DONE]);
  return {
    claimedRows: rows[0]?.rows || [],
    coalescedCount: rows[0]?.coalesced_count || 0
  };
};

const getCurrentPartVersionMap = async (partIds) => {
  if (!Array.isArray(partIds) || partIds.length === 0) return {};
  const { rows } = await db.query(
    `SELECT part_id, COALESCE(date_modified, date_created) AS version_ts
     FROM part
     WHERE part_id = ANY($1::int[])`,
    [partIds]
  );

  return rows.reduce((acc, row) => ({ ...acc, [Number(row.part_id)]: row.version_ts }), {});
};

const isStaleEvent = (row, currentVersionMap) => {
  const payload = row.payload || {};
  const eventTs = parseTimestamp(payload.version_ts || payload.updated_at || payload.event_created_at);
  if (!eventTs) return false;
  const currentTs = parseTimestamp(currentVersionMap[Number(row.entity_id)]);
  return Boolean(currentTs && eventTs < currentTs);
};

const markDone = async (client, ids) => {
  if (!ids.length) return;
  await client.query(
    `UPDATE meili_sync_outbox
     SET status = $1, processed_at = NOW(), lease_until = NULL, last_error = NULL, updated_at = NOW()
     WHERE outbox_id = ANY($2::bigint[])`,
    [STATUS.DONE, ids]
  );
};

const markFailed = async (client, rows, maxAttempts, errorMessage) => {
  if (!rows.length) return;
  const deadIds = rows.filter((r) => r.attempts >= maxAttempts).map((r) => r.outbox_id);
  const retryIds = rows.filter((r) => r.attempts < maxAttempts).map((r) => r.outbox_id);

  if (retryIds.length) {
    await client.query(
      `UPDATE meili_sync_outbox
       SET status = $1,
           available_at = NOW() + make_interval(secs => LEAST(600, GREATEST(2, attempts * attempts))),
           lease_until = NULL,
           last_error = $3,
           updated_at = NOW()
       WHERE outbox_id = ANY($2::bigint[])`,
      [STATUS.PENDING, retryIds, errorMessage]
    );
  }

  if (deadIds.length) {
    await client.query(
      `UPDATE meili_sync_outbox
       SET status = $1,
           lease_until = NULL,
           last_error = $3,
           updated_at = NOW()
       WHERE outbox_id = ANY($2::bigint[])`,
      [STATUS.DEAD, deadIds, errorMessage]
    );
  }

  return { dead: deadIds.length, retried: retryIds.length };
};

const processBatch = async (config) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { claimedRows: rows, coalescedCount } = await claimEvents(client, config.batchSize, config.leaseSeconds);
    await client.query('COMMIT');

    if (rows.length === 0) return { claimed: 0, done: 0, dead: 0, retried: 0, coalesced: coalescedCount, staleSkipped: 0 };

    const doneIds = [];
    const failedRows = [];
    let staleSkipped = 0;
    const entityIds = [...new Set(rows.map((r) => Number(r.entity_id)).filter(Boolean))];
    const currentVersionMap = await getCurrentPartVersionMap(entityIds);

    // Process deletes first.
    const deleteRows = rows.filter((r) => r.event_type === 'delete_part');
    for (const row of deleteRows) {
      try {
        if (isStaleEvent(row, currentVersionMap)) {
          staleSkipped += 1;
          doneIds.push(row.outbox_id);
          continue;
        }
        await removePartFromMeili(row.entity_id);
        doneIds.push(row.outbox_id);
      } catch (error) {
        failedRows.push(row);
        console.error('[MeiliOutbox] delete_part failed:', row.entity_id, error && error.message ? error.message : error);
      }
    }

    // Batch upserts.
    const upsertRows = rows.filter((r) => r.event_type === 'upsert_part');
    const freshUpsertRows = upsertRows.filter((row) => {
      const stale = isStaleEvent(row, currentVersionMap);
      if (stale) {
        staleSkipped += 1;
        doneIds.push(row.outbox_id);
      }
      return !stale;
    });
    if (freshUpsertRows.length) {
      try {
        const partIds = [...new Set(freshUpsertRows.map((r) => Number(r.entity_id)).filter(Boolean))];
        const docs = await loadPartDocs(partIds);
        if (docs.length) {
          await syncPartWithMeili(docs);
        }
        doneIds.push(...freshUpsertRows.map((r) => r.outbox_id));
      } catch (error) {
        failedRows.push(...freshUpsertRows);
        console.error('[MeiliOutbox] upsert_part batch failed:', error && error.message ? error.message : error);
      }
    }

    const finalize = await db.getClient();
    try {
      await finalize.query('BEGIN');
      await markDone(finalize, doneIds);
      const failResult = await markFailed(finalize, failedRows, config.maxAttempts, failedRows.length ? 'Meilisearch sync failed. Check API logs.' : null);
      await finalize.query('COMMIT');
      return {
        claimed: rows.length,
        done: doneIds.length,
        dead: failResult?.dead || 0,
        retried: failResult?.retried || 0,
        coalesced: coalescedCount,
        staleSkipped
      };
    } catch (error) {
      await finalize.query('ROLLBACK');
      throw error;
    } finally {
      finalize.release();
    }
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* no-op */ }
    throw error;
  } finally {
    client.release();
  }
};

const startMeiliOutboxWorker = (options = {}) => {
  const config = { ...DEFAULTS, ...options };
  let running = false;
  let tickCount = 0;
  let timer = null;
  let previousDeadCount = 0;

  const getQueueHealthSnapshot = async () => {
    const [statusRes, lagRes, processingRes] = await Promise.all([
      db.query(
        `SELECT status, COUNT(*)::int AS count
         FROM meili_sync_outbox
         GROUP BY status`
      ),
      db.query(
        `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int AS oldest_pending_seconds
         FROM meili_sync_outbox
         WHERE status = 'pending'`
      ),
      db.query(
        `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(processed_at)))::int AS seconds_since_last_processed
         FROM meili_sync_outbox
         WHERE processed_at IS NOT NULL`
      )
    ]);

    const counts = { pending: 0, processing: 0, done: 0, dead: 0 };
    statusRes.rows.forEach((row) => {
      counts[row.status] = row.count;
    });

    return {
      counts,
      oldestPendingSeconds: lagRes.rows[0]?.oldest_pending_seconds || 0,
      secondsSinceLastProcessed: processingRes.rows[0]?.seconds_since_last_processed || null
    };
  };

  const logAlerts = async () => {
    try {
      const snapshot = await getQueueHealthSnapshot();
      const deadGrowth = snapshot.counts.dead - previousDeadCount;
      previousDeadCount = snapshot.counts.dead;

      if (deadGrowth >= config.deadGrowthThreshold) {
        console.error('[MeiliOutbox][ALERT] dead queue growth threshold breached', {
          deadGrowth,
          dead: snapshot.counts.dead
        });
      }

      if (snapshot.oldestPendingSeconds >= config.backlogAgeThresholdSeconds) {
        console.error('[MeiliOutbox][ALERT] backlog age threshold breached', {
          oldestPendingSeconds: snapshot.oldestPendingSeconds,
          pending: snapshot.counts.pending
        });
      }

      if (snapshot.counts.pending > 0 && snapshot.secondsSinceLastProcessed !== null && snapshot.secondsSinceLastProcessed >= config.workerIdleThresholdSeconds) {
        console.error('[MeiliOutbox][ALERT] worker appears idle with pending backlog', {
          pending: snapshot.counts.pending,
          secondsSinceLastProcessed: snapshot.secondsSinceLastProcessed
        });
      }
    } catch (error) {
      console.error('[MeiliOutbox] alert evaluation failed:', error && error.message ? error.message : error);
    }
  };

  const logMetrics = async () => {
    try {
      const snapshot = await getQueueHealthSnapshot();
      console.log('[MeiliOutbox] status metrics:', snapshot);
      await logAlerts();
    } catch (error) {
      console.error('[MeiliOutbox] metrics failed:', error && error.message ? error.message : error);
    }
  };

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processBatch(config);
      if (result.claimed > 0) {
        console.log('[MeiliOutbox] processed batch:', result);
      }
      tickCount += 1;
      if (tickCount % config.metricsEvery === 0) {
        await logMetrics();
      }
    } catch (error) {
      console.error('[MeiliOutbox] worker tick failed:', error && error.stack ? error.stack : error);
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, config.pollMs);
  tick();

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      console.log('[MeiliOutbox] worker stopped');
    }
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log('[MeiliOutbox] worker started', config);
  return { stop };
};

module.exports = { startMeiliOutboxWorker, processBatch };
