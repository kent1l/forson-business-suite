const cron = require('node-cron');
const db = require('../db');

let job = null;

async function abandonInactiveReviews(client, { batchSize = 100 } = {}) {
  const { rows } = await client.query(
    `SELECT import_id, version, lifecycle_events
     FROM grn_import_review
     WHERE status = 'IN_REVIEW'
       AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
     ORDER BY updated_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [batchSize]
  );

  let count = 0;
  for (const row of rows) {
    const events = row.lifecycle_events || [];
    events.push({
      event: 'ABANDONED',
      actor_id: null,
      reason: 'Maintenance: inactive for 30 days',
      timestamp: new Date().toISOString(),
      version: row.version + 1,
    });

    await client.query(
      `UPDATE grn_import_review
       SET status = 'ABANDONED',
           abandoned_at = CURRENT_TIMESTAMP,
           lifecycle_events = $1,
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE import_id = $2`,
      [JSON.stringify(events), row.import_id]
    );
    count++;
  }
  return count;
}

async function purgeExpiredAbandonedReviews(client, { batchSize = 100 } = {}) {
  const { rows } = await client.query(
    `SELECT import_id, version, lifecycle_events
     FROM grn_import_review
     WHERE status = 'ABANDONED'
       AND purged_at IS NULL
       AND abandoned_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
     ORDER BY abandoned_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [batchSize]
  );

  let count = 0;
  for (const row of rows) {
    const events = row.lifecycle_events || [];
    events.push({
      event: 'PURGED',
      actor_id: null,
      reason: 'Maintenance: 90 days past abandonment',
      timestamp: new Date().toISOString(),
      version: row.version + 1,
    });

    await client.query(
      `UPDATE grn_import_review
       SET source_payload = NULL,
           review_state = NULL,
           document_id = NULL,
           purged_at = CURRENT_TIMESTAMP,
           lifecycle_events = $1,
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE import_id = $2`,
      [JSON.stringify(events), row.import_id]
    );
    count++;
  }
  return count;
}

async function runGrnImportMaintenance() {
  const client = await db.getClient();
  try {
    const { rows: [lockRow] } = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended('grn_import_maintenance', 0)) as acquired"
    );
    if (!lockRow.acquired) {
      return { skipped: true, reason: 'Advisory lock held by another process' };
    }

    try {
      await client.query('BEGIN');
      const abandoned = await abandonInactiveReviews(client);
      const purged = await purgeExpiredAbandonedReviews(client);
      await client.query('COMMIT');
      if (abandoned > 0 || purged > 0) {
        console.log(`[GrnImportMaintenance] abandoned ${abandoned} inactive reviews, purged ${purged} expired reviews`);
      }
      return { abandoned, purged };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended('grn_import_maintenance', 0))");
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[GrnImportMaintenance] run failed:', error.message || error);
    throw error;
  } finally {
    client.release();
  }
}

function startGrnImportMaintenance() {
  if (job) return job;
  // Daily at 04:00 AM Manila time
  job = cron.schedule('0 4 * * *', () => {
    runGrnImportMaintenance().catch((err) => {
      console.error('[GrnImportMaintenance] cron execution error:', err.message || err);
    });
  });
  return job;
}

module.exports = {
  abandonInactiveReviews,
  purgeExpiredAbandonedReviews,
  runGrnImportMaintenance,
  startGrnImportMaintenance,
};
