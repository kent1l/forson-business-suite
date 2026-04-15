const db = require('./db');
const { syncPartWithMeili, removePartFromMeili } = require('./meilisearch');
const { constructDisplayName } = require('./helpers/displayNameHelper');
const { activeAliasCondition } = require('./helpers/partNumberSoftDelete');
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
  metricsEvery: Number(process.env.MEILI_OUTBOX_METRICS_EVERY || 20)
});

const loadPartDocs = async (partIds) => {
  if (!Array.isArray(partIds) || partIds.length === 0) return [];

  const query = `
    SELECT
      p.*,
      b.brand_name,
      g.group_name,
      (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${activeAliasCondition('pn')}) as part_numbers,
      (SELECT ARRAY_AGG(
        CONCAT(vmk.make_name, ' ', vmd.model_name, COALESCE(CONCAT(' ', veng.engine_name), ''))
      )
      FROM part_application pa
      JOIN application a ON pa.application_id = a.application_id
      LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
      LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
      LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
      WHERE pa.part_id = p.part_id) AS applications_array,
      (SELECT ARRAY_AGG(t.tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = p.part_id) AS tags_array
    FROM part AS p
    LEFT JOIN brand AS b ON p.brand_id = b.brand_id
    LEFT JOIN "group" AS g ON p.group_id = g.group_id
    WHERE p.part_id = ANY($1::int[])
  `;

  const { rows } = await db.query(query, [partIds]);

  return rows.map((part) => {
    const normalizedFields = normalizePartData(part);
    return {
      ...part,
      display_name: constructDisplayName(part),
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
    WITH candidates AS (
      SELECT outbox_id
      FROM meili_sync_outbox
      WHERE status IN ($1, $2)
        AND available_at <= NOW()
        AND (lease_until IS NULL OR lease_until < NOW())
      ORDER BY created_at ASC
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    )
    UPDATE meili_sync_outbox o
    SET status = $4,
        lease_until = NOW() + ($5::text || ' seconds')::interval,
        attempts = attempts + 1,
        updated_at = NOW()
    FROM candidates c
    WHERE o.outbox_id = c.outbox_id
    RETURNING o.outbox_id, o.event_type, o.entity_id, o.attempts
  `;

  const { rows } = await client.query(claimSql, [STATUS.PENDING, STATUS.PROCESSING, batchSize, STATUS.PROCESSING, String(leaseSeconds)]);
  return rows;
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
    const rows = await claimEvents(client, config.batchSize, config.leaseSeconds);
    await client.query('COMMIT');

    if (rows.length === 0) return { claimed: 0, done: 0, dead: 0, retried: 0 };

    const doneIds = [];
    const failedRows = [];

    // Process deletes first.
    const deleteRows = rows.filter((r) => r.event_type === 'delete_part');
    for (const row of deleteRows) {
      try {
        await removePartFromMeili(row.entity_id);
        doneIds.push(row.outbox_id);
      } catch (error) {
        failedRows.push(row);
        console.error('[MeiliOutbox] delete_part failed:', row.entity_id, error && error.message ? error.message : error);
      }
    }

    // Batch upserts.
    const upsertRows = rows.filter((r) => r.event_type === 'upsert_part');
    if (upsertRows.length) {
      try {
        const partIds = [...new Set(upsertRows.map((r) => Number(r.entity_id)).filter(Boolean))];
        const docs = await loadPartDocs(partIds);
        if (docs.length) {
          await syncPartWithMeili(docs);
        }
        doneIds.push(...upsertRows.map((r) => r.outbox_id));
      } catch (error) {
        failedRows.push(...upsertRows);
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
        retried: failResult?.retried || 0
      };
    } catch (error) {
      await finalize.query('ROLLBACK');
      throw error;
    } finally {
      finalize.release();
    }
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no-op */ }
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

  const logMetrics = async () => {
    try {
      const { rows } = await db.query(
        `SELECT status, COUNT(*)::int AS count
         FROM meili_sync_outbox
         GROUP BY status`
      );
      const summary = rows.reduce((acc, row) => ({ ...acc, [row.status]: row.count }), {});
      console.log('[MeiliOutbox] status metrics:', summary);
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
