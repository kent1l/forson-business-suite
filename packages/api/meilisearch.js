const { MeiliSearch } = require('meilisearch');

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST,
  apiKey: process.env.MEILISEARCH_MASTER_KEY,
});

/**
 * Syncs one or more part documents with Meilisearch.
 * @param {object|object[]} documents - A single part object or an array of part objects.
 */
const syncPartWithMeili = async (documents) => {
  try {
  // Debug log to inspect the exact payload being sent to Meilisearch
  console.log('Syncing part with MeiliSearch:', JSON.stringify(documents, null, 2));
    const index = client.index('parts');
    // If 'documents' is not an array, wrap it in one. Otherwise, use it as is.
    const documentsToAdd = Array.isArray(documents) ? documents : [documents];

    if (documentsToAdd.length > 0) {
      await index.addDocuments(documentsToAdd, { primaryKey: 'part_id' });
    }
  } catch (error) {
    // Log the full error from Meilisearch for better debugging
    console.error('Error syncing part with Meilisearch:', error.message);
  }
};

const removePartFromMeili = async (partId) => {
  try {
    const index = client.index('parts');
    await index.deleteDocument(partId);
  } catch (error) {
    console.error('Error removing part from Meilisearch:', error.message);
  }
};

module.exports = {
  meiliClient: client,
  syncPartWithMeili,
  removePartFromMeili,
};