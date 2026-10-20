const db = require('../db');
const { meiliClient } = require('../meilisearch');
const jevClient = require('./jevClient');

const LOOKUP_TIMEOUT_MS = 2000;
const JEV_TIMEOUT_MS = 3500;
const MAX_CANDIDATES = 20;

function withTimeout(promise, ms, timeoutError) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutError)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function cleanString(str) {
  return str == null ? null : String(str).trim();
}

async function findPartCandidates({ brand, partNumber, description, rawText, query }) {
  const candidates = [];
  const seenPartIds = new Set();
  const searchBrand = cleanString(brand);
  const searchPartNo = cleanString(partNumber);
  const searchQuery = cleanString(query) || cleanString(description) || cleanString(rawText);

  // 1. Exact Identifier Lookup: part_number and internal_sku
  if (searchPartNo || cleanString(query)) {
    const targetIdentifier = searchPartNo || cleanString(query);
    try {
      const { rows: pnRows } = await db.query(
        `SELECT p.part_id, p.internal_sku, p.detail, p.measurement_unit as stock_uom,
                b.brand_name, g.group_name, p.last_cost, pv.display_name,
                pn.part_number, pn.number_type
         FROM part_number pn
         JOIN part p ON p.part_id = pn.part_id
         LEFT JOIN brand b ON p.brand_id = b.brand_id
         LEFT JOIN "group" g ON p.group_id = g.group_id
         LEFT JOIN parts_view pv ON pv.part_id = p.part_id
         WHERE pn.deleted_at IS NULL AND p.is_active = true
           AND UPPER(TRIM(pn.part_number)) = UPPER(TRIM($1))
         LIMIT 10`,
        [targetIdentifier]
      );

      for (const row of pnRows) {
        if (!seenPartIds.has(row.part_id)) {
          seenPartIds.add(row.part_id);
          const isBrandMatch = searchBrand && row.brand_name && searchBrand.toUpperCase() === row.brand_name.toUpperCase();
          candidates.push({
            part_id: row.part_id,
            internal_sku: row.internal_sku,
            detail: row.detail,
            display_name: row.display_name || row.detail,
            brand_name: row.brand_name,
            group_name: row.group_name,
            stock_uom: row.stock_uom || 'PCS',
            last_cost: row.last_cost != null ? Number(row.last_cost) : null,
            evidence_class: 'exact_identifier',
            match_reason: isBrandMatch ? 'exact_brand_and_part_number' : 'exact_part_number',
            score: isBrandMatch ? 1.0 : 0.95,
          });
        }
      }

      // Check internal_sku
      const { rows: skuRows } = await db.query(
        `SELECT p.part_id, p.internal_sku, p.detail, p.measurement_unit as stock_uom,
                b.brand_name, g.group_name, p.last_cost, pv.display_name
         FROM part p
         LEFT JOIN brand b ON p.brand_id = b.brand_id
         LEFT JOIN "group" g ON p.group_id = g.group_id
         LEFT JOIN parts_view pv ON pv.part_id = p.part_id
         WHERE p.is_active = true
           AND UPPER(TRIM(p.internal_sku)) = UPPER(TRIM($1))
         LIMIT 5`,
        [targetIdentifier]
      );

      for (const row of skuRows) {
        if (!seenPartIds.has(row.part_id)) {
          seenPartIds.add(row.part_id);
          candidates.push({
            part_id: row.part_id,
            internal_sku: row.internal_sku,
            detail: row.detail,
            display_name: row.display_name || row.detail,
            brand_name: row.brand_name,
            group_name: row.group_name,
            stock_uom: row.stock_uom || 'PCS',
            last_cost: row.last_cost != null ? Number(row.last_cost) : null,
            evidence_class: 'exact_identifier',
            match_reason: 'exact_sku',
            score: 0.98,
          });
        }
      }
    } catch (err) {
      console.warn('[PartCandidateService] Exact identifier lookup failed:', err.message);
    }
  }

  // 2. Catalog Search (Meilisearch or SQL fallback)
  if (candidates.length < MAX_CANDIDATES && searchQuery) {
    try {
      let meiliHits = [];
      try {
        const search = await withTimeout(
          meiliClient.index('parts').search(searchQuery, {
            limit: MAX_CANDIDATES,
            filter: 'is_active = true',
            showRankingScore: true,
            attributesToRetrieve: ['part_id'],
          }),
          LOOKUP_TIMEOUT_MS,
          'Meilisearch lookup timed out'
        );
        meiliHits = (search.hits || []).filter(h => h.part_id);
      } catch (meiliErr) {
        console.warn('[PartCandidateService] Meilisearch search failed/timed out, falling back to SQL:', meiliErr.message);
      }

      if (meiliHits.length > 0) {
        const ids = meiliHits.map(h => h.part_id);
        const { rows } = await db.query(
          `SELECT pv.part_id, pv.internal_sku, pv.detail, pv.brand_name, pv.group_name,
                  pv.last_cost, pv.display_name, p.measurement_unit as stock_uom
           FROM parts_view pv
           JOIN part p ON p.part_id = pv.part_id
           WHERE pv.is_active = true AND pv.part_id = ANY($1::int[])
           ORDER BY array_position($1::int[], pv.part_id)`,
          [ids]
        );
        const rowsById = new Map(rows.map(r => [r.part_id, r]));
        for (const hit of meiliHits) {
          const row = rowsById.get(hit.part_id);
          if (row && !seenPartIds.has(row.part_id) && candidates.length < MAX_CANDIDATES) {
            seenPartIds.add(row.part_id);
            candidates.push({
              part_id: row.part_id,
              internal_sku: row.internal_sku,
              detail: row.detail,
              display_name: row.display_name || row.detail,
              brand_name: row.brand_name,
              group_name: row.group_name,
              stock_uom: row.stock_uom || 'PCS',
              last_cost: row.last_cost != null ? Number(row.last_cost) : null,
              evidence_class: 'description_match',
              match_reason: 'meili_search',
              score: Math.min(0.9, Number(hit._rankingScore) || 0.7),
            });
          }
        }
      } else {
        // SQL fallback
        const wildcard = `%${searchQuery.replace(/[%_\\]/g, '\\$&')}%`;
        const { rows } = await db.query(
          `SELECT pv.part_id, pv.internal_sku, pv.detail, pv.brand_name, pv.group_name,
                  pv.last_cost, pv.display_name, p.measurement_unit as stock_uom
           FROM parts_view pv
           JOIN part p ON p.part_id = pv.part_id
           WHERE pv.is_active = true
             AND (pv.internal_sku ILIKE $1 OR pv.detail ILIKE $1 OR pv.display_name ILIKE $1)
           LIMIT $2`,
          [wildcard, MAX_CANDIDATES - candidates.length]
        );
        for (const row of rows) {
          if (!seenPartIds.has(row.part_id) && candidates.length < MAX_CANDIDATES) {
            seenPartIds.add(row.part_id);
            candidates.push({
              part_id: row.part_id,
              internal_sku: row.internal_sku,
              detail: row.detail,
              display_name: row.display_name || row.detail,
              brand_name: row.brand_name,
              group_name: row.group_name,
              stock_uom: row.stock_uom || 'PCS',
              last_cost: row.last_cost != null ? Number(row.last_cost) : null,
              evidence_class: 'description_match',
              match_reason: 'sql_search',
              score: 0.65,
            });
          }
        }
      }
    } catch (sqlErr) {
      console.warn('[PartCandidateService] Catalog search failed:', sqlErr.message);
    }
  }

  // 3. Optional JEV Ranking if candidates >= 2
  let aiStatus = 'unavailable';
  if (jevClient && jevClient.isConfigured && jevClient.isConfigured() && candidates.length >= 2) {
    try {
      const choices = candidates.slice(0, 10).map((c) => ({
        value: String(c.part_id),
        label: [c.display_name || c.detail, c.internal_sku, c.brand_name, c.group_name].filter(Boolean).join(' | '),
      }));
      choices.push({ value: 'no_match', label: 'No reliable catalog match' });

      const jevPromise = jevClient.evaluateChoice({
        question: 'grn_catalog_match',
        state: { description: searchQuery, brand: searchBrand, part_number: searchPartNo },
        choices,
        instructions: 'Choose the catalog item that most specifically matches the supplier document line. Choose no_match unless confident.',
      });

      const decision = await withTimeout(jevPromise, JEV_TIMEOUT_MS, 'JEV ranking timed out');
      if (decision && decision.choice !== 'no_match' && decision.confidence >= 0.75) {
        const idx = candidates.findIndex(c => String(c.part_id) === decision.choice);
        if (idx > 0) {
          const [matched] = candidates.splice(idx, 1);
          matched.match_reason = 'jev_ranked';
          matched.score = Math.max(matched.score, decision.confidence);
          candidates.unshift(matched);
        }
        aiStatus = 'available';
      } else {
        aiStatus = 'available';
      }
    } catch (jevErr) {
      aiStatus = /timed out/i.test(jevErr.message) ? 'timed_out' : 'unavailable';
      console.warn('[PartCandidateService] JEV evaluation failed:', jevErr.message);
    }
  }

  return {
    ai_status: aiStatus,
    candidates: candidates.slice(0, MAX_CANDIDATES),
  };
}

module.exports = {
  findPartCandidates,
};
