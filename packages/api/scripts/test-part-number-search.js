#!/usr/bin/env node
/**
 * Quick test of part number search functionality
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

if (process.env.NODE_ENV !== 'production') {
  process.env.DB_HOST = 'localhost';
  process.env.MEILISEARCH_HOST = 'http://localhost:7700';
}

const { meiliClient } = require('../meilisearch');

async function testPartNumberSearch() {
  console.log('\n🔍 Testing Part Number Search\n');
  
  const testQueries = [
    'I3708',          // Part number from the data
    '8-976025-378',   // Another part number with dashes
    'FAS-8301',       // Air filter part number
    'BS-009',         // Bleeder screw
    'oise-musa-0001', // SKU test
    'OISE-MUSA-0002', // SKU uppercase
    'oisemusa0002',   // Normalized SKU
    '897602537 8'     // Part number without dashes
  ];
  
  const index = meiliClient.index('parts');
  
  for (const query of testQueries) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Searching for: "${query}"`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    try {
      const result = await index.search(query, {
        limit: 3,
        filter: 'is_active = true'
      });
      
      console.log(`✓ Found ${result.hits.length} results in ${result.processingTimeMs}ms`);
      
      if (result.hits.length > 0) {
        result.hits.forEach((hit, i) => {
          console.log(`\n  ${i + 1}. ${hit.display_name}`);
          console.log(`     SKU: ${hit.internal_sku}`);
          console.log(`     Part #s: ${hit.part_numbers?.join(', ') || 'none'}`);
          console.log(`     ID: ${hit.part_id}`);
        });
      } else {
        console.log('  ❌ No results found');
      }
    } catch (err) {
      console.log(`  ❌ Search failed: ${err.message}`);
    }
  }
  
  console.log('\n\n✅ Part number search testing complete!\n');
}

testPartNumberSearch().catch(console.error).finally(() => process.exit(0));
