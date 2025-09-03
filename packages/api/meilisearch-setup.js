const { meiliClient } = require('./meilisearch');

/**
 * Configures the Meilisearch indexes with the necessary settings.
 * This function should be run once when the API server starts.
 */
const setupMeiliSearch = async () => {
  try {
    console.log('Configuring Meilisearch indexes...');
    
  const partsIndex = meiliClient.index('parts');
  const applicationsIndex = meiliClient.index('applications');
    
    // Tell Meilisearch which fields we want to be able to search, filter and sort on.
    // This optimizes search performance and index size.
    await partsIndex.updateSettings({
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness'
      ],
      searchableAttributes: [
        'display_name',
        'internal_sku',
        'brand_name',
        'group_name',
        'searchable_applications', // <-- ADDED: Flattened application data
        'part_numbers',
        'tags'
      ],
      stopWords: [
        'a', 'an', 'and', 'the'
      ],
      synonyms: {
        'ATF': ['automatic transmission fluid', 'automatic transmission oil'],
        'PSF': ['power steering fluid', 'power steering oil'],
        'Brake Fluid': ['Brake Oil']
      },
      filterableAttributes: ['is_active', 'tags', 'applications'], // <-- ADDED: Allow filtering by application
      sortableAttributes: ['display_name', 'internal_sku', 'brand_name', 'group_name']
    });

    // Applications index settings
    await applicationsIndex.updateSettings({
      rankingRules: ['words','typo','proximity','attribute','exactness'],
      searchableAttributes: ['make','model','engine','label'],
      filterableAttributes: ['make_id','model_id','engine_id'],
      sortableAttributes: ['make','model','engine']
    });

    console.log('Meilisearch configuration complete.');
  } catch (error) {
    console.error('Error configuring Meilisearch:', error.message);
    // If Meilisearch is essential and cannot be configured, it's best to stop the server.
    process.exit(1);
  }
};

module.exports = { setupMeiliSearch };
