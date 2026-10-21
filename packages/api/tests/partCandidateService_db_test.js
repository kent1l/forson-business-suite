// Real PostgreSQL; external search/AI responses are controlled for repeatable assertions.
// DB_NAME=forson_grn_import_test node tests/partCandidateService_db_test.js
const assert = require('node:assert/strict');
if (process.env.DB_NAME !== 'forson_grn_import_test') throw new Error('Requires disposable forson_grn_import_test database.');
const db = require('../db');
const { createPartCandidateService } = require('../services/partCandidateService');

(async () => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const suffix = `M${require('node:crypto').randomBytes(4).toString('hex')}`;
    const { rows: [brand] } = await client.query('INSERT INTO brand (brand_name, brand_code) VALUES ($1,$2) RETURNING brand_id', [`ACME ${suffix}`, suffix]);
    const { rows: [group] } = await client.query('INSERT INTO "group" (group_name, group_code) VALUES ($1,$2) RETURNING group_id', [`FILTERS ${suffix}`, suffix]);
    const insertPart = async (name, active = true) => {
      const { rows: [part] } = await client.query(
        `INSERT INTO part (internal_sku,detail,brand_id,group_id,is_active,measurement_unit)
         VALUES ($1,$2,$3,$4,$5,'PCS') RETURNING part_id`,
        [`${suffix}-${name.replace(/\W/g, '')}`, name, brand.brand_id, group.group_id, active]);
      return part.part_id;
    };
    const filter = await insertPart('Diesel oil filter 04152 1L');
    const alternative = await insertPart('Diesel oil filter 04152 5L');
    const inactive = await insertPart('Diesel oil filter 04152 1L INACTIVE', false);
    await client.query('INSERT INTO part_number (part_id,part_number,number_type) VALUES ($1,$2,$3)', [filter, `04152-${suffix}`, 'OEM']);
    await client.query('INSERT INTO part_number (part_id,part_number,number_type,deleted_at) VALUES ($1,$2,$3,NOW())', [alternative, `DELETED-${suffix}`, 'OEM']);

    const calls = [];
    let decision = { choice: String(filter), confidence: 0.96, model: 'test-jev' };
    const jevClient = {
      isConfigured: () => true,
      evaluateChoice: async request => { calls.push(request); if (decision instanceof Error) throw decision; return decision; },
    };
    const offlineSearch = { index: () => ({ search: async () => { throw new Error('Search offline'); } }) };
    const service = createPartCandidateService({ dbClient: client, searchClient: offlineSearch, jevClient });
    const receipt = {
      brand: `ACME ${suffix}`, group: `FILTERS ${suffix}`, partNumber: `04152 ${suffix}`,
      supplierItemText: 'Diesel oil filter 04152 1L', description: 'Diesel filter',
      rawText: '2 PCS Diesel oil filter 04152 1L @ 125.00 TOTAL 250.00 ✓',
    };
    const result = await service.findPartCandidates(receipt);
    assert.equal(result.search_status, 'available');
    assert.equal(result.candidates[0].part_id, filter, 'Normalized exact identifier should lead');
    assert.equal(result.candidates[0].match_evidence.identifier, true);
    assert.equal(result.candidates[0].match_evidence.brand, true);
    assert.equal(result.candidates[0].match_evidence.group, true);
    assert.equal(result.verification.status, 'match');
    assert(result.candidates.some(part => part.part_id === alternative));
    assert(!result.candidates.some(part => part.part_id === inactive));
    assert.equal(calls[0].state.supplier_item.raw_text, receipt.rawText);
    assert.equal(calls[0].state.supplier_item.supplier_item_text, receipt.supplierItemText);
    assert(calls[0].state.catalog_items.find(part => part.part_id === filter).part_numbers.includes(`04152-${suffix}`));
    assert(!result.candidates[0].delivered_quantity, 'Matching must not create receiving facts');

    const reordered = await service.findPartCandidates({ ...receipt, partNumber: null, supplierItemText: '1L filter Diesel oil' });
    assert(reordered.candidates.some(part => part.part_id === filter), 'Reordered words must work without Meilisearch');
    const typo = await service.findPartCandidates({ description: 'Diesel oil filtter 04152 1L' });
    assert(typo.candidates.some(part => part.part_id === filter), 'Trigram/term fallback must handle typos');
    const singleReceipt = { rawText: `SKU ${suffix}`, partNumber: `04152-${suffix}`, description: null };
    await service.findPartCandidates(singleReceipt);
    assert.equal(calls.at(-1).choices.filter(choice => choice.value !== 'no_match').length, 1, 'Even a single exact candidate needs verification');

    decision = { choice: 'no_match', confidence: 0.99, model: 'test-jev' };
    const noMatch = await service.findPartCandidates(receipt);
    assert.equal(noMatch.verification.status, 'no_match');
    assert(noMatch.candidates.every(part => !part.jev_verification));
    decision = { choice: String(alternative), confidence: 0.55, model: 'test-jev' };
    assert.equal((await service.findPartCandidates(receipt)).verification.status, 'uncertain');
    decision = new Error('Provider unavailable');
    const failedAI = await service.findPartCandidates(receipt);
    assert.equal(failedAI.ai_status, 'unavailable');
    assert(failedAI.candidates.length > 0);
    decision = new Error('Jev verification timed out');
    assert.equal((await service.findPartCandidates(receipt)).ai_status, 'timed_out');
    decision = { choice: '999999999', confidence: 0.99 };
    assert.equal((await service.findPartCandidates(receipt)).ai_status, 'unavailable');

    decision = { choice: String(alternative), confidence: 0.98, model: 'test-jev' };
    const manual = await service.findPartCandidates({ ...receipt, query: `${suffix}-Dieseloilfilter041525L` });
    assert.equal(manual.candidates[0].part_id, alternative);
    assert.equal(calls.at(-1).state.supplier_item.raw_text, receipt.rawText, 'Manual search must never replace receipt evidence');

    const searchQueries = [];
    const withSearch = createPartCandidateService({ dbClient: client, jevClient,
      searchClient: { index: () => ({ search: async query => { searchQueries.push(query); return { hits: [{ part_id: alternative, _rankingScore: 0.99 }, { part_id: inactive }] }; } }) },
    });
    decision = { choice: 'no_match', confidence: 0.99 };
    const combined = await withSearch.findPartCandidates(receipt);
    assert(combined.candidates.some(part => part.part_id === filter), 'Nonempty Meilisearch must not suppress SQL identifier matches');
    const brokenSearch = createPartCandidateService({ dbClient: client, jevClient,
      searchClient: { index: () => { throw new Error('Search client unavailable'); } } });
    assert((await brokenSearch.findPartCandidates(receipt)).candidates.some(part => part.part_id === filter));
    assert(!combined.candidates.some(part => part.part_id === inactive));
    assert.equal(new Set(combined.candidates.map(part => part.part_id)).size, combined.candidates.length);
    assert(searchQueries.some(query => query.includes(receipt.brand) && query.includes(receipt.group)));
    assert(searchQueries.includes(receipt.supplierItemText));
    const deletedNumber = await service.findPartCandidates({ partNumber: `DELETED-${suffix}`, rawText: 'No identifiable wording' });
    assert(!deletedNumber.candidates.some(part => part.part_id === alternative && part.match_evidence.identifier), 'Retired identifiers must not count as exact evidence');
    const hydrated = await withSearch.findPartCandidates({ rawText: 'ZZZXQ unrelated inventory wording' });
    assert(hydrated.candidates.some(part => part.part_id === alternative), 'Meilisearch-only matches must hydrate from the active catalog');
    const unavailable = createPartCandidateService({ dbClient: { query: async () => { throw new Error('Database offline'); } }, searchClient: offlineSearch, jevClient });
    assert.equal((await unavailable.findPartCandidates(receipt)).search_status, 'unavailable');
    const partial = createPartCandidateService({ dbClient: { query: async () => { throw new Error('Database offline'); } },
      searchClient: { index: () => ({ search: async () => ({ hits: [] }) }) }, jevClient });
    assert.equal((await partial.findPartCandidates(receipt)).search_status, 'partial', 'Index-only empty results must not claim the full catalog was searched');

    await client.query(`INSERT INTO part (internal_sku,detail,brand_id,group_id,is_active,measurement_unit)
      SELECT $1 || '-' || n, 'Diesel oil filter variant ' || n, $2, $3, true, 'PCS' FROM generate_series(1,25) n`, [suffix, brand.brand_id, group.group_id]);
    const capped = await service.findPartCandidates(receipt);
    assert.equal(capped.candidates.length, 20, 'Candidate responses must stay bounded for dense catalog results');
    assert(capped.candidates.some(part => part.part_id === filter));
    console.log('Passed real database catalog matching, identifier formatting, brand/group, typos/reordering, single-candidate Jev, no-match/uncertainty/failures, and search merging.');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
