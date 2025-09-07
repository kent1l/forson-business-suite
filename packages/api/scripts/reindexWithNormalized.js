#!/usr/bin/env node
/**
 * Reindex all parts with normalized fields.
 * Use this after adding normalized_internal_sku and normalized_part_numbers
 * to ensure all documents have the new fields.
 */
const db = require('../db');
const { syncPartWithMeili } = require('../meilisearch');
const { getPartDataForMeili } = require('../routes/partRoutes');

(async function run() {
  const client = await db.getClient();
  let indexed = 0;
  let errors = 0;

  try {
    console.log('Fetching all part IDs...');
    const res = await client.query('SELECT part_id FROM part ORDER BY part_id');
    const ids = res.rows.map(r => r.part_id);
    const total = ids.length;
    console.log(`Found ${total} parts to reindex...`);

    // Process in batches of 50 to avoid memory issues
    const batchSize = 50;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(total/batchSize)}...`);
      
      const partDataPromises = batch.map(id => getPartDataForMeili(db, id));
      const results = await Promise.allSettled(partDataPromises);
      
      // Filter successful results and sync them
      const validDocs = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      
      if (validDocs.length > 0) {
        await syncPartWithMeili(validDocs);
        indexed += validDocs.length;
      }
      
      errors += results.filter(r => r.status === 'rejected').length;
      
      // Log progress
      console.log(`Progress: ${indexed}/${total} indexed, ${errors} errors`);
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
    process.exit(0);
  }
})();
