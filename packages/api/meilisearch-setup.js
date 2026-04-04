const { meiliClient } = require('./meilisearch');
const path = require('path');
const fs = require('fs');

// Import retry utility from meilisearch.js
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const isRetryable = (err) => {
  if (!err) return false;
  // Retry on 5xx and rate limiting, and common network errors
  if (err.statusCode && (err.statusCode >= 500 || err.statusCode === 429)) return true;
  if (err.code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) return true;
  if (err.message && /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network|ENOTFOUND/i.test(err.message)) return true;
  return false;
};

const retryAsync = async (fn, { attempts = 4, baseDelay = 200 } = {}) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      const delay = Math.round(baseDelay * Math.pow(2, i) * (0.5 + Math.random() * 0.5));
      console.warn(`Meili setup operation failed (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`, err && err.message ? err.message : err);
      await wait(delay);
    }
  }
  throw lastErr;
};

/**
 * Validates synonyms data structure
 * @param {Array} synonymsGroups - Array of synonym groups
 * @returns {boolean} - True if valid
 */
const validateSynonyms = (synonymsGroups) => {
  if (!Array.isArray(synonymsGroups)) {
    throw new Error('Synonyms must be an array of arrays');
  }
  
  for (const [index, group] of synonymsGroups.entries()) {
    if (!Array.isArray(group)) {
      throw new Error(`Synonym group at index ${index} must be an array`);
    }
    if (group.length < 2) {
      throw new Error(`Synonym group at index ${index} must have at least 2 terms`);
    }
    if (!group.every(term => typeof term === 'string' && term.trim().length > 0)) {
      throw new Error(`All terms in synonym group at index ${index} must be non-empty strings`);
    }
  }
  
  return true;
};

/**
 * Get environment-specific configuration
 * @param {string} environment - Environment name (development, staging, production)
 * @returns {object} - Configuration object
 */
const getEnvironmentConfig = (environment = process.env.NODE_ENV || 'production') => {
  const baseConfig = {
    maxRetries: parseInt(process.env.MEILI_SETUP_MAX_RETRIES) || 4,
    retryDelay: parseInt(process.env.MEILI_SETUP_RETRY_DELAY) || 200,
    typoMinWordSize: parseInt(process.env.MEILI_TYPO_MIN_WORD_SIZE) || 4,
    typoMinWordSizeTwo: parseInt(process.env.MEILI_TYPO_MIN_WORD_SIZE_TWO) || 8
  };

  const envConfigs = {
    development: {
      ...baseConfig,
      rankingRules: ['words', 'typo', 'exactness'], // Simpler ranking for faster dev
      typoEnabled: process.env.MEILI_TYPO_ENABLED !== 'false', // Allow disabling in dev
      maxRetries: 2 // Faster failures in dev
    },
    staging: {
      ...baseConfig,
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'exactness'],
      typoEnabled: true,
      maxRetries: 3
    },
    production: {
      ...baseConfig,
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
      typoEnabled: true,
      maxRetries: 4
    }
  };

  return envConfigs[environment] || envConfigs.production;
};

/**
 * Expand synonym groups into a symmetric mapping required by Meilisearch
 * @param {Array} groups - Array of synonym groups
 * @returns {object} - Symmetric synonym mapping
 */
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

/**
 * Configures the Meilisearch indexes with the necessary settings.
 * This function should be run once when the API server starts.
 * @returns {Promise<{success: boolean, error?: string}>} Setup result
 */
const setupMeiliSearch = async () => {
  const config = getEnvironmentConfig();
  let setupErrors = [];

  try {
    console.log('Configuring Meilisearch indexes...');
    console.log(`Environment: ${process.env.NODE_ENV || 'production'}, Config:`, {
      maxRetries: config.maxRetries,
      typoEnabled: config.typoEnabled,
      rankingRules: config.rankingRules.length
    });
    
    const partsIndex = meiliClient.index('parts');
    const applicationsIndex = meiliClient.index('applications');
    
    // Load and validate synonyms from a JSON file (groups of equivalent terms).
    const synonymsPath = path.join(__dirname, 'config', 'meili-synonyms.json');
    let synonymsGroups = [];
    let symmetricSynonyms = {};
    
    try {
      if (fs.existsSync(synonymsPath)) {
        synonymsGroups = require(synonymsPath);
        validateSynonyms(synonymsGroups);
        symmetricSynonyms = buildSymmetricSynonyms(synonymsGroups);
        console.log(`Loaded ${synonymsGroups.length} synonym groups with ${Object.keys(symmetricSynonyms).length} total mappings`);
      } else {
        console.warn('Meili synonyms file not found at', synonymsPath);
        // Fallback to basic synonyms
        symmetricSynonyms = {
          'ATF': ['automatic transmission fluid', 'automatic transmission oil'],
          'PSF': ['power steering fluid', 'power steering oil'],
          'Brake Fluid': ['Brake Oil']
        };
      }
    } catch (err) {
      console.error('Failed to load/validate Meili synonyms file:', err && err.message ? err.message : err);
      setupErrors.push(`Synonyms loading failed: ${err.message}`);
      // Use fallback synonyms
      symmetricSynonyms = {
        'ATF': ['automatic transmission fluid', 'automatic transmission oil'],
        'PSF': ['power steering fluid', 'power steering oil'],
        'Brake Fluid': ['Brake Oil']
      };
    }

    // Configure Parts Index
    try {
      const partsSettings = {
        rankingRules: config.rankingRules,
        searchableAttributes: [
          'display_name',
          'detail',
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
        synonyms: symmetricSynonyms,
        filterableAttributes: ['is_active', 'tags', 'applications'],
        sortableAttributes: ['display_name', 'internal_sku', 'brand_name', 'group_name']
      };

      await retryAsync(
        () => partsIndex.updateSettings(partsSettings),
        { attempts: config.maxRetries, baseDelay: config.retryDelay }
      );
      console.log('Parts index configured successfully');
    } catch (error) {
      const errorMsg = `Failed to configure parts index: ${error.message}`;
      console.error(errorMsg);
      setupErrors.push(errorMsg);
    }

    // Configure Applications Index
    try {
      const applicationsSettings = {
        rankingRules: config.rankingRules,
        searchableAttributes: [
          'label',      // Primary search field (combined make+model+engine)
          'make',       // Individual fields for more granular matching
          'model',
          'engine'
        ],
        filterableAttributes: ['make_id', 'model_id', 'engine_id'],
        sortableAttributes: ['make', 'model', 'engine'],
        // Configure typo tolerance based on environment
        typoTolerance: {
          enabled: config.typoEnabled,
          minWordSizeForTypos: {
            oneTypo: config.typoMinWordSize,
            twoTypos: config.typoMinWordSizeTwo
          },
          disableOnWords: [],
          disableOnAttributes: []
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
      };

      await retryAsync(
        () => applicationsIndex.updateSettings(applicationsSettings),
        { attempts: config.maxRetries, baseDelay: config.retryDelay }
      );
      console.log('Applications index configured successfully');
    } catch (error) {
      const errorMsg = `Failed to configure applications index: ${error.message}`;
      console.error(errorMsg);
      setupErrors.push(errorMsg);
    }

    if (setupErrors.length > 0) {
      console.warn(`Meilisearch configuration completed with ${setupErrors.length} error(s):`, setupErrors);
      console.warn('Search functionality may be limited until these issues are resolved');
      return { success: false, errors: setupErrors };
    }

    console.log('Meilisearch configuration completed successfully.');
    return { success: true };
    
  } catch (error) {
    const errorMsg = `Critical error during Meilisearch setup: ${error.message}`;
    console.error(errorMsg);
    console.warn('Search functionality will be unavailable until Meilisearch is properly configured');
    return { success: false, error: errorMsg };
  }
};

module.exports = { setupMeiliSearch };
