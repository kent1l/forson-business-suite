#!/usr/bin/env node
/**
 * Test script to debug Meilisearch search issues
 * This script will:
 * 1. Check Meilisearch connection
 * 2. Verify index configuration
 * 3. Check what data is actually indexed
 * 4. Test sample search queries
 * 5. Compare with database data
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// Override for local development
if (process.env.NODE_ENV !== 'production') {
  process.env.DB_HOST = 'localhost';
  process.env.MEILISEARCH_HOST = 'http://localhost:7700';
}

const db = require('../db');
const { meiliClient } = require('../meilisearch');
const { constructDisplayName } = require('../helpers/displayNameHelper');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = {
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}=== ${msg} ===${colors.reset}\n`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  data: (label, data) => console.log(`  ${colors.magenta}${label}:${colors.reset}`, data)
};

async function checkMeilisearchHealth() {
  log.header('Checking Meilisearch Connection');
  try {
    const health = await meiliClient.health();
    log.success('Meilisearch is running');
    log.data('Status', health.status);
    return true;
  } catch (err) {
    log.error('Meilisearch is not accessible');
    log.data('Error', err.message);
    log.data('Host', process.env.MEILISEARCH_HOST);
    return false;
  }
}

async function checkIndexConfiguration() {
  log.header('Checking Parts Index Configuration');
  try {
    const index = meiliClient.index('parts');
    const settings = await index.getSettings();
    
    log.success('Parts index exists');
    log.data('Searchable Attributes', settings.searchableAttributes);
    log.data('Filterable Attributes', settings.filterableAttributes);
    log.data('Ranking Rules', settings.rankingRules);
    
    // Check if normalized fields are in searchable attributes
    if (settings.searchableAttributes?.includes('normalized_internal_sku')) {
      log.success('normalized_internal_sku is searchable');
    } else {
      log.warning('normalized_internal_sku is NOT in searchableAttributes');
    }
    
    if (settings.searchableAttributes?.includes('normalized_part_numbers')) {
      log.success('normalized_part_numbers is searchable');
    } else {
      log.warning('normalized_part_numbers is NOT in searchableAttributes');
    }
    
    return settings;
  } catch (err) {
    log.error('Failed to get index configuration');
    log.data('Error', err.message);
    return null;
  }
}

async function checkIndexedData() {
  log.header('Checking Indexed Data Sample');
  try {
    const index = meiliClient.index('parts');
    const stats = await index.getStats();
    log.data('Total documents', stats.numberOfDocuments);
    
    if (stats.numberOfDocuments === 0) {
      log.error('NO DOCUMENTS INDEXED! You need to reindex parts.');
      return null;
    }
    
    // Get first 3 documents
    const result = await index.search('', { limit: 3 });
    log.info(`Showing first ${result.hits.length} documents:`);
    
    result.hits.forEach((doc, i) => {
      console.log(`\n  ${colors.bright}Document ${i + 1}:${colors.reset}`);
      log.data('  part_id', doc.part_id);
      log.data('  display_name', doc.display_name);
      log.data('  internal_sku', doc.internal_sku);
      log.data('  detail', doc.detail);
      log.data('  normalized_internal_sku', doc.normalized_internal_sku || '❌ MISSING');
      log.data('  normalized_part_numbers', doc.normalized_part_numbers || '❌ MISSING');
      log.data('  part_numbers', Array.isArray(doc.part_numbers) ? doc.part_numbers : '❌ NOT ARRAY');
      log.data('  brand_name', doc.brand_name);
      log.data('  is_active', doc.is_active);
    });
    
    // Check if documents have required fields
    const firstDoc = result.hits[0];
    if (!firstDoc.normalized_internal_sku) {
      log.error('Documents are missing normalized_internal_sku - REINDEX REQUIRED');
    }
    if (!firstDoc.normalized_part_numbers) {
      log.error('Documents are missing normalized_part_numbers - REINDEX REQUIRED');
    }
    if (!Array.isArray(firstDoc.part_numbers)) {
      log.error('part_numbers is not an array - REINDEX REQUIRED');
    }
    
    return result.hits;
  } catch (err) {
    log.error('Failed to get indexed data');
    log.data('Error', err.message);
    return null;
  }
}

async function testSearchQueries() {
  log.header('Testing Search Queries');
  
  const testQueries = [
    { query: '', description: 'Empty search (should return some results)' },
    { query: 'oil', description: 'Common term search' },
    { query: 'filter', description: 'Single word search' },
    { query: 'brake', description: 'Another common term' }
  ];
  
  const index = meiliClient.index('parts');
  
  for (const test of testQueries) {
    try {
      console.log(`\n${colors.bright}Testing: ${test.description}${colors.reset}`);
      log.data('Query', `"${test.query}"`);
      
      const result = await index.search(test.query, { 
        limit: 5,
        filter: 'is_active = true'
      });
      
      log.data('Results found', result.hits.length);
      log.data('Processing time', `${result.processingTimeMs}ms`);
      
      if (result.hits.length > 0) {
        console.log(`  ${colors.cyan}Top results:${colors.reset}`);
        result.hits.slice(0, 3).forEach((hit, i) => {
          console.log(`    ${i + 1}. ${hit.display_name || hit.internal_sku} (ID: ${hit.part_id})`);
        });
      } else {
        log.warning('No results found');
      }
    } catch (err) {
      log.error(`Search failed: ${err.message}`);
    }
  }
}

async function compareWithDatabase() {
  log.header('Comparing with Database');
  try {
    const result = await db.query('SELECT COUNT(*) as count FROM part WHERE is_active = true');
    const dbCount = parseInt(result.rows[0].count);
    log.data('Active parts in database', dbCount);
    
    const index = meiliClient.index('parts');
    const stats = await index.getStats();
    log.data('Documents in Meilisearch', stats.numberOfDocuments);
    
    if (dbCount > stats.numberOfDocuments) {
      log.warning(`Database has ${dbCount - stats.numberOfDocuments} more parts than Meilisearch`);
      log.info('Consider running reindex to sync all parts');
    } else if (dbCount < stats.numberOfDocuments) {
      log.warning(`Meilisearch has ${stats.numberOfDocuments - dbCount} more documents than active parts`);
      log.info('This might include inactive parts - this is normal');
    } else {
      log.success('Document count matches!');
    }
    
    // Sample a few parts from DB and check if they exist in Meili
    const sampleResult = await db.query(`
      SELECT p.part_id, p.internal_sku, p.detail, b.brand_name
      FROM part p
      LEFT JOIN brand b ON p.brand_id = b.brand_id
      WHERE p.is_active = true
      LIMIT 3
    `);
    
    console.log(`\n${colors.bright}Checking sample parts:${colors.reset}`);
    for (const part of sampleResult.rows) {
      const displayName = constructDisplayName(part);
      console.log(`\n  ${colors.cyan}Part ID ${part.part_id}:${colors.reset} ${displayName}`);
      
      try {
        const meiliDoc = await index.getDocument(part.part_id);
        log.success('Found in Meilisearch');
        log.data('    Meili display_name', meiliDoc.display_name);
        log.data('    DB display_name', displayName);
        if (meiliDoc.display_name !== displayName) {
          log.warning('    Display names do NOT match - REINDEX NEEDED');
        }
      } catch {
        log.error('NOT found in Meilisearch');
      }
    }
  } catch (err) {
    log.error('Failed to compare with database');
    log.data('Error', err.message);
  }
}

async function testSpecificSKU() {
  log.header('Testing Specific SKU Search');
  try {
    // Get a sample SKU from database
    const result = await db.query(`
      SELECT p.part_id, p.internal_sku, p.detail, b.brand_name
      FROM part p
      LEFT JOIN brand b ON p.brand_id = b.brand_id
      WHERE p.is_active = true AND p.internal_sku IS NOT NULL
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      log.warning('No parts with SKU found in database');
      return;
    }
    
    const part = result.rows[0];
    const sku = part.internal_sku;
    
    log.info(`Testing with SKU: ${sku}`);
    
    const index = meiliClient.index('parts');
    const searchResult = await index.search(sku, { limit: 5 });
    
    log.data('Results found', searchResult.hits.length);
    
    if (searchResult.hits.length > 0) {
      const firstResult = searchResult.hits[0];
      console.log(`\n  ${colors.cyan}Top result:${colors.reset}`);
      log.data('  part_id', firstResult.part_id);
      log.data('  display_name', firstResult.display_name);
      log.data('  internal_sku', firstResult.internal_sku);
      
      if (firstResult.part_id === part.part_id) {
        log.success('Correct part found as first result!');
      } else {
        log.warning('Expected part is not the first result');
        log.data('  Expected part_id', part.part_id);
        log.data('  Got part_id', firstResult.part_id);
      }
    } else {
      log.error('No results found for this SKU!');
      log.info('This indicates a serious indexing problem');
    }
  } catch (err) {
    log.error('Failed to test SKU search');
    log.data('Error', err.message);
  }
}

async function main() {
  console.log(`${colors.bright}${colors.blue}
╔════════════════════════════════════════════════════════╗
║   Meilisearch Search Functionality Test & Debug       ║
╚════════════════════════════════════════════════════════╝
${colors.reset}`);
  
  const healthy = await checkMeilisearchHealth();
  if (!healthy) {
    log.error('Cannot continue - Meilisearch is not running');
    process.exit(1);
  }
  
  await checkIndexConfiguration();
  const docs = await checkIndexedData();
  
  if (!docs || docs.length === 0) {
    log.error('\n⚠️  NO DOCUMENTS IN MEILISEARCH ⚠️');
    log.info('You MUST run the reindex script or endpoint:');
    log.info('  - Option 1: node packages/api/scripts/reindexParts.js');
    log.info('  - Option 2: POST to /api/reindex/parts');
    log.info('  - Option 3: Use admin panel "Fix Search Issues" button');
    process.exit(1);
  }
  
  await testSearchQueries();
  await compareWithDatabase();
  await testSpecificSKU();
  
  log.header('Summary & Recommendations');
  
  console.log(`
${colors.bright}If search is still not working correctly:${colors.reset}

1. ${colors.yellow}Restart API server${colors.reset} (to apply meilisearch-setup.js settings)
   
2. ${colors.yellow}Reindex all parts${colors.reset}:
   ${colors.cyan}node packages/api/scripts/reindexParts.js${colors.reset}
   
3. ${colors.yellow}Check for errors${colors.reset} in API server logs during reindex

4. ${colors.yellow}Run this test script again${colors.reset} to verify the fix

${colors.bright}Common Issues:${colors.reset}
- Documents missing normalized fields → Need to reindex
- Configuration not applied → Need to restart API server
- part_numbers not an array → Need to reindex
- Display names incorrect → Need to reindex
  `);
  
  process.exit(0);
}

// Run the test
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
