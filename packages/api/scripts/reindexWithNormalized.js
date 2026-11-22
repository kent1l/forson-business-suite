#!/usr/bin/env node
/**
 * Reconfigures Meilisearch settings and reindexes all parts with normalized fields.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const db = require('../db');
const { meiliClient, syncPartWithMeili } = require('../meilisearch');
const { setupMeiliSearch } = require('../meilisearch-setup');
const { loadPartDocs } = require('../meili-outbox-worker');

(async function run() {
  const client = await db.getClient();
  let indexed = 0;
  let errors = 0;

  try {
    console.log('Applying Meilisearch index settings...');
    const setupResult = await setupMeiliSearch();
    if (!setupResult.success) {
      throw new Error(`Meilisearch setup failed: ${JSON.stringify(setupResult.errors || setupResult.error)}`);
    }

    console.log('Fetching all part IDs...');
    const res = await client.query('SELECT part_id FROM part ORDER BY part_id');
    const ids = res.rows.map(r => r.part_id);
    const total = ids.length;
    console.log(`Found ${total} parts to reindex...`);

    const batchSize = 250;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(total / batchSize)}...`);

      try {
        const docs = await loadPartDocs(batch);
        if (docs.length > 0) {
          await syncPartWithMeili(docs);
          indexed += docs.length;
        }
      } catch (err) {
        errors += batch.length;
        console.error(`Batch starting at ${batch[0]} failed:`, err.message);
      }

      console.log(`Progress: ${indexed}/${total} indexed, ${errors} errors`);
    }

    // Wait briefly for Meilisearch tasks to settle
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const tasks = await meiliClient.getTasks({ statuses: ['enqueued', 'processing'], limit: 10 });
      if (!tasks.results || tasks.results.length === 0) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    console.log('\nReindex complete!');
    console.log(`Successfully indexed: ${indexed}`);
    if (errors > 0) console.log(`Failed to index: ${errors}`);
  } catch (err) {
    console.error('Reindex failed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    process.exit(errors > 0 ? 1 : 0);
  }
})();
