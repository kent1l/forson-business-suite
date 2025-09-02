// Quick test harness for meili-listener.js
// - Stubs packages/api/db and packages/api/meilisearch
// - Starts the listener and emits a fake notification

const path = require('path');
const EventEmitter = require('events');

// Resolve module absolute paths as Node would
const apiDir = path.resolve(__dirname, '..', 'packages', 'api');
const dbPath = require.resolve(path.join(apiDir, 'db.js'));
const meiliPath = require.resolve(path.join(apiDir, 'meilisearch.js'));
const listenerPath = path.join(apiDir, 'meili-listener.js');

// Create a fake DB client (EventEmitter) and module
const fakeClient = new EventEmitter();
fakeClient.query = async (sql, params) => {
  // Simulate LISTEN call and later SELECT
  return { rows: [{ part_id: params ? params[0] : 1, display_name: 'Test Part', internal_sku: 'SKU-1', brand_name: 'BrandX', group_name: 'GroupY', is_active: true }] };
};
fakeClient.release = () => { /* noop */ };

const fakeDbModule = {
  query: async (text, params) => fakeClient.query(text, params),
  getClient: async () => fakeClient,
};

// Create a fake Meili module to capture calls
let syncCalled = false;
const fakeMeiliModule = {
  syncPartWithMeili: async (doc) => {
    console.log('fakeMeili.syncPartWithMeili called with:', doc);
    syncCalled = true;
  },
  removePartFromMeili: async (id) => {
    console.log('fakeMeili.removePartFromMeili called with:', id);
  },
  meiliClient: {},
};

// Inject stubs into require.cache so relative requires resolve to them
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDbModule };
require.cache[meiliPath] = { id: meiliPath, filename: meiliPath, loaded: true, exports: fakeMeiliModule };

// Ensure env vars so meilisearch module doesn't throw during require
process.env.MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || 'http://127.0.0.1:7700';
process.env.MEILISEARCH_MASTER_KEY = process.env.MEILISEARCH_MASTER_KEY || 'masterKey';

// Now require the listener and start it
const { startMeiliListener } = require(listenerPath);

(async () => {
  await startMeiliListener();

  // Simulate a NOTIFY payload after a short delay
  setTimeout(() => {
    const payload = JSON.stringify({ action: 'upsert', part_id: 42 });
    console.log('Emitting fake notification payload:', payload);
    fakeClient.emit('notification', { payload });
  }, 100);

  // Wait a bit then exit, checking whether sync was called
  setTimeout(() => {
    if (syncCalled) {
      console.log('Test succeeded: sync was called.');
      process.exit(0);
    } else {
      console.error('Test failed: sync was not called.');
      process.exit(2);
    }
  }, 500);
})();
