const { meiliClient } = require('./meilisearch');

/**
 * Configures the Meilisearch indexes with the necessary settings.
 * This function should be run once when the API server starts.
 */
const setupMeiliSearch = async () => {
  try {
    console.log('Configuring Meilisearch indexes...');
    
    const partsIndex = meiliClient.index('parts');
    
    // Tell Meilisearch which fields we want to be able to search, filter and sort on.
    // This optimizes search performance and index size.
    await partsIndex.updateSettings({
      searchableAttributes: [
        'display_name',
        'internal_sku',
        'brand_name',
        'group_name',
        'searchable_applications', // <-- ADDED: Flattened application data
        'part_numbers',
        'applications',
        'tags'
      ],
      filterableAttributes: ['is_active', 'tags', 'applications'], // <-- ADDED: Allow filtering by application
      sortableAttributes: ['display_name', 'internal_sku', 'brand_name', 'group_name']
    });

    console.log('Meilisearch configuration complete.');
  } catch (error) {
    console.error('Error configuring Meilisearch:', error.message);
    // If Meilisearch is essential and cannot be configured, it's best to stop the server.
    process.exit(1);
  }
};

module.exports = { setupMeiliSearch };
