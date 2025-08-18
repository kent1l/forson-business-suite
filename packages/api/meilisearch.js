const { MeiliSearch } = require('meilisearch');

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST,
  apiKey: process.env.MEILISEARCH_MASTER_KEY,
});

const syncPartWithMeili = async (partData) => {
  try {
    const index = client.index('parts');
    await index.addDocuments([partData], { primaryKey: 'part_id' });
  } catch (error) {
    console.error('Error syncing part with Meilisearch:', error);
  }
};

const removePartFromMeili = async (partId) => {
  try {
    const index = client.index('parts');
    await index.deleteDocument(partId);
  } catch (error) {
    console.error('Error removing part from Meilisearch:', error);
  }
};

module.exports = {
  meiliClient: client,
  syncPartWithMeili,
  removePartFromMeili,
};