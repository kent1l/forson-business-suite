const { meiliClient } = require('./meilisearch');
const path = require('path');
const fs = require('fs');

/**
 * Configures the Meilisearch indexes with the necessary settings.
 * This function should be run once when the API server starts.
 */
const setupMeiliSearch = async () => {
  try {
    console.log('Configuring Meilisearch indexes...');
    
    const partsIndex = meiliClient.index('parts');
    const applicationsIndex = meiliClient.index('applications');
    // Load synonyms from a JSON file (groups of equivalent terms).
    const synonymsPath = path.join(__dirname, 'config', 'meili-synonyms.json');
    let synonymsGroups = [];
    try {
      if (fs.existsSync(synonymsPath)) {
        synonymsGroups = require(synonymsPath);
      } else {
        console.warn('Meili synonyms file not found at', synonymsPath);
      }
    } catch (err) {
      console.error('Failed to load Meili synonyms file:', err && err.message ? err.message : err);
      synonymsGroups = [];
    }

    // Expand groups into a symmetric mapping required by Meilisearch
    const buildSymmetricSynonyms = (groups) => {
      const map = {};
      if (!Array.isArray(groups)) return map;
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        const normalized = group.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
        for (const term of normalized) {
          const others = normalized.filter(t => t !== term);
          if (!map[term]) map[term] = [];
          // Avoid duplicates
          for (const o of others) if (!map[term].includes(o)) map[term].push(o);
        }
      }
      return map;
    };

    const symmetricSynonyms = buildSymmetricSynonyms(synonymsGroups);
    
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
        'normalized_internal_sku',
        'brand_name',
        'group_name',
        'searchable_applications',
        'part_numbers',
        'normalized_part_numbers',
        'tags'
      ],
      stopWords: [
        'a', 'an', 'and', 'the'
      ],
      // Load synonyms from file if provided, falling back to inline set for backwards compatibility
      synonyms: Object.keys(symmetricSynonyms).length > 0 ? symmetricSynonyms : {
        'ATF': ['automatic transmission fluid', 'automatic transmission oil'],
        'PSF': ['power steering fluid', 'power steering oil'],
        'Brake Fluid': ['Brake Oil']
      },
      filterableAttributes: ['is_active', 'tags', 'applications'],
      sortableAttributes: ['display_name', 'internal_sku', 'brand_name', 'group_name']
    });

    // Applications index settings with enhanced search capabilities
    await applicationsIndex.updateSettings({
      rankingRules: [
        'exactness',   // Finally exact matches
        'words',      // Then number of matching words
        'typo',       // Prioritize typo tolerance
        'proximity',  // Then word proximity
        'attribute',  // Then attribute importance
      ],
      searchableAttributes: [
        'label',      // Primary search field (combined make+model+engine)
        'make',       // Individual fields for more granular matching
        'model',
        'engine'
      ],
      filterableAttributes: ['make_id', 'model_id', 'engine_id'],
      sortableAttributes: ['make', 'model', 'engine'],
      // Configure typo tolerance
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: {
          oneTypo: 4,    // Allow 1 typo for words >= 4 chars
          twoTypos: 8    // Allow 2 typos for words >= 8 chars
        },
        disableOnWords: [], // No words are exact match only
        disableOnAttributes: [] // No attributes require exact matching
      },
      // Add common car-related synonyms
      synonyms: {
        'toyota': ['toyata', 'toyotta', 'toyta'],
        'diesel': ['deisel', 'desel'],
        'manual': ['manuel', 'man'],
        'automatic': ['auto', 'at'],
        'transmission': ['trans', 'tranny'],
        'engine': ['eng', 'motor']
      }
    });

    console.log('Meilisearch configuration complete.');
  } catch (error) {
    console.error('Error configuring Meilisearch:', error.message);
    // If Meilisearch is essential and cannot be configured, it's best to stop the server.
    process.exit(1);
  }
};

module.exports = { setupMeiliSearch };
