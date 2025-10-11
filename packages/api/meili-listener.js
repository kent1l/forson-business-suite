const db = require('./db');
const { syncPartWithMeili, removePartFromMeili } = require('./meilisearch');

/**
 * Dedicated listener that uses a persistent Postgres client to LISTEN for
 * NOTIFY events on the `meili_sync` channel. The payload is expected to be a
 * JSON string with the shape: { action: 'upsert'|'delete', part_id: <id> }
 */
const startMeiliListener = async () => {
  const client = await db.getClient();
  // Define safeRelease in outer scope so error handlers can call it
  let released = false;
  const safeRelease = () => {
    if (released) return;
    released = true;
    try { client.release(); } catch (e) { console.error('Error releasing meili listener client:', e && e.stack ? e.stack : e); }
  };
  // Simple in-memory queue for batching
  const pendingUpserts = new Set();
  const pendingDeletes = new Set();
  let flushTimer = null;

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
      const upserts = Array.from(pendingUpserts);
      const deletes = Array.from(pendingDeletes);
      pendingUpserts.clear();
      pendingDeletes.clear();
      flushTimer = null;

      try {
        // Handle deletes first
        for (const id of deletes) {
          await removePartFromMeili(id);
        }
        if (upserts.length) {
          // Fetch all docs in one query and bulk add
          const { rows } = await db.query(
            `SELECT p.part_id,
                    COALESCE(p.internal_sku, '') AS internal_sku,
                    COALESCE(p.detail, '') AS detail,
                    b.brand_name,
                    g.group_name,
                    p.is_active,
                    (SELECT COALESCE(json_agg(pn.part_number), '[]'::json) FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('./helpers/partNumberSoftDelete').activeAliasCondition('pn')}) AS part_numbers,
                    (SELECT COALESCE(json_agg(t.tag_name), '[]'::json) FROM part_tag pt JOIN tag t ON t.tag_id = pt.tag_id WHERE pt.part_id = p.part_id) AS tags,
                    (SELECT COALESCE(json_agg(
                        json_build_object(
                            'make', paf.make_name,
                            'model', paf.model_name,
                            'engine', paf.engine_name,
                            'year_start', paf.year_start,
                            'year_end', paf.year_end,
                            'notes', paf.notes
                        )
                    ), '[]'::json)
                     FROM part_application_flexible paf
                     WHERE paf.part_id = p.part_id) AS applications,
                    (SELECT COALESCE(json_agg(
                        TRIM(
                            CONCAT(
                                COALESCE(paf.make_name, ''),
                                CASE WHEN paf.model_name IS NOT NULL AND paf.model_name <> '' THEN CONCAT(' ', paf.model_name) ELSE '' END,
                                CASE WHEN paf.engine_name IS NOT NULL AND paf.engine_name <> '' THEN CONCAT(' ', paf.engine_name) ELSE '' END,
                                CASE
                                    WHEN paf.year_start IS NOT NULL AND paf.year_end IS NOT NULL AND paf.year_start = paf.year_end THEN CONCAT(' [', paf.year_start, ']')
                                    WHEN paf.year_start IS NOT NULL AND paf.year_end IS NOT NULL THEN CONCAT(' [', paf.year_start, '-', paf.year_end, ']')
                                    WHEN paf.year_start IS NOT NULL THEN CONCAT(' [', paf.year_start, '-]')
                                    WHEN paf.year_end IS NOT NULL THEN CONCAT(' [-', paf.year_end, ']')
                                    ELSE ''
                                END
                            )
                        )
                    ), '[]'::json)
                     FROM part_application_flexible paf
                     WHERE paf.part_id = p.part_id) AS searchable_applications
             FROM part p
             LEFT JOIN brand b ON b.brand_id = p.brand_id
             LEFT JOIN "group" g ON g.group_id = p.group_id
             WHERE p.part_id = ANY($1::int[])`,
            [upserts]
          );

          const docs = rows.map(row => ({
            part_id: row.part_id,
            display_name: row.internal_sku || row.detail || '',
            internal_sku: row.internal_sku,
            brand_name: row.brand_name,
            group_name: row.group_name,
            is_active: row.is_active,
            part_numbers: row.part_numbers || [],
            tags: row.tags || [],
            applications: row.applications || [],
            searchable_applications: row.searchable_applications || [],
          }));

          if (docs.length) await syncPartWithMeili(docs);
        }
      } catch (e) {
        console.error('Meili batch flush error:', e && e.stack ? e.stack : e);
      }
    }, 300); // 300ms debounce window
  };
  // Use a dedicated client to receive notifications
  try {
    await client.query('LISTEN meili_sync');
    console.log('Listening for meili_sync notifications...');

    client.on('notification', async (msg) => {
      try {
        if (!msg || !msg.payload) return;
        const payload = JSON.parse(msg.payload);
        if (!payload || !payload.action) return;

        if (payload.action === 'delete') {
          if (payload.part_id) {
            pendingDeletes.add(payload.part_id);
            pendingUpserts.delete(payload.part_id);
            scheduleFlush();
          }
          return;
        }

        if (payload.action === 'upsert') {
          if (payload.part_id) {
            pendingUpserts.add(payload.part_id);
            pendingDeletes.delete(payload.part_id);
            scheduleFlush();
          }
        }
      } catch (err) {
        console.error('Error handling meili_sync notification:', err && err.stack ? err.stack : err);
      }
    });

    // Keep the client open; handle errors and shutdown
    client.on('error', (err) => console.error('Postgres listener error:', err && err.stack ? err.stack : err));
    process.on('exit', safeRelease);
    process.on('SIGINT', safeRelease);
    process.on('SIGTERM', safeRelease);
  } catch (err) {
    console.error('Failed to start Meili listener:', err && err.stack ? err.stack : err);
    try {
      // Use safeRelease if available
      if (typeof safeRelease === 'function') safeRelease();
      else client.release();
    } catch (releaseErr) {
      console.error('Error releasing client after failed listener start:', releaseErr && releaseErr.stack ? releaseErr.stack : releaseErr);
    }
  }
};

module.exports = { startMeiliListener };
