const db = require('../db');
const { syncPartWithMeili } = require('../meilisearch');

(async function run() {
  const client = await db.getClient();
  try {
    console.log('Fetching all part IDs...');
    const res = await client.query('SELECT part_id FROM part');
    const ids = res.rows.map(r => r.part_id);
    console.log(`Found ${ids.length} parts, syncing to Meilisearch...`);
    for (const id of ids) {
      try {
        // Reuse the existing helper to fetch full part object for Meili
        const partForMeili = await (async () => {
          const helper = require('../routes/partRoutes').getPartDataForMeili;
          return helper(db, id);
        })();
        if (partForMeili) {
          await syncPartWithMeili(partForMeili);
          console.log(`Synced part ${id}`);
        } else {
          console.log(`Skipping part ${id} (no data)`);
        }
      } catch (err) {
        console.error(`Error syncing part ${id}:`, err && err.stack ? err.stack : err);
      }
    }
    console.log('Reindex complete.');
  } catch (err) {
    console.error('Failed to reindex parts:', err && err.stack ? err.stack : err);
  } finally {
    client.release();
    process.exit(0);
  }
})();
