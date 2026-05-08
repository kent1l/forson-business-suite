const { meiliClient } = require('../meilisearch');

class DuplicateFinder {
  constructor(db) { this.db = db; }

  static normalizeText(v='') { return String(v).toLowerCase().trim().replace(/\s+/g,' '); }
  static normalizePartNumber(v='') { return String(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  static numericTokens(part) {
    const text = `${part.detail || ''} ${part.display_name || ''}`;
    const out = new Set();
    const re = /(\d+(?:\.\d+)?)\s*(mm|ml|cm|l|kg|g|oz|in|v|w)?/gi;
    let m; while ((m = re.exec(text))) out.add(`${m[1]}${(m[2]||'').toLowerCase()}`);
    return out;
  }

  static scorePair(a, b, fromPhase1 = false) {
    const reasons = [];
    let score = fromPhase1 ? 0.88 : 0.5;

    const aPn = new Set((a.part_numbers || []).map((x) => this.normalizePartNumber(x)));
    const bPn = new Set((b.part_numbers || []).map((x) => this.normalizePartNumber(x)));
    const pnOverlap = [...aPn].filter((x) => bPn.has(x));

    const aBrand = this.normalizeText(a.brand_name || '');
    const bBrand = this.normalizeText(b.brand_name || '');

    if (pnOverlap.length > 0) {
      reasons.push('shared_part_number');
      score += 0.1;
      if (aBrand && bBrand && aBrand !== bBrand) {
        score -= 0.5; reasons.push('brand_mismatch_penalty');
      }
    }

    if (aPn.size > 0 && bPn.size > 0 && pnOverlap.length === 0) {
      score -= 0.8; reasons.push('part_number_conflict');
    }

    if (a.group_id && b.group_id && a.group_id === b.group_id) { score += 0.2; reasons.push('same_group'); }

    const na = this.numericTokens(a); const nb = this.numericTokens(b);
    const numericOverlap = [...na].some((t) => nb.has(t));
    if (numericOverlap) { score += 0.2; reasons.push('numeric_token_match'); }

    return { score: Math.max(0, Math.min(1, score)), reasons };
  }

  static confidence(score) { return score >= 0.85 ? 'High' : score >= 0.7 ? 'Medium' : score >= 0.6 ? 'Low' : 'Very Low'; }

  async findOptimizedDuplicateGroups(options = {}) {
    const { minScore = 0.6, limit = 50, query = '' } = options;
    const phase1Parts = await this.findDeterministicBlocks(query, limit * 5);
    const phase2Parts = await this.findMeiliCandidates(query, limit * 5);

    const allPairs = [...phase1Parts, ...phase2Parts];
    const groups = [];
    const seen = new Set();
    for (const pair of allPairs) {
      const key = [pair.part1.part_id, pair.part2.part_id].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const { score, reasons } = this.constructor.scorePair(pair.part1, pair.part2, pair.phase === 1);
      if (score < minScore) continue;
      groups.push({
        groupId: `dup_${pair.part1.part_id}_${pair.part2.part_id}`,
        score,
        confidence: this.constructor.confidence(score),
        reasons,
        parts: [pair.part1, pair.part2]
      });
    }
    return groups.sort((a,b)=>b.score-a.score).slice(0, limit);
  }

  async findDuplicateGroups(options = {}) { return this.findOptimizedDuplicateGroups(options); }

  async findDeterministicBlocks(query, limit) {
    const rows = await this.db.query(`
      WITH base AS (
        SELECT p.part_id, p.internal_sku, p.detail, p.group_id, p.brand_id, b.brand_name, p.internal_sku AS display_name,
               ARRAY_REMOVE(ARRAY_AGG(DISTINCT pn.part_number), NULL) AS part_numbers
        FROM part p
        LEFT JOIN brand b ON b.brand_id = p.brand_id
        LEFT JOIN part_number pn ON pn.part_id = p.part_id AND pn.deleted_at IS NULL
        WHERE p.merged_into_part_id IS NULL
          AND ($1 = '' OR p.internal_sku ILIKE $2 OR p.detail ILIKE $2)
        GROUP BY p.part_id, b.brand_name
      )
      SELECT b1.*, b2.*
      FROM base b1
      JOIN base b2 ON b1.part_id < b2.part_id
      WHERE (b1.internal_sku IS NOT NULL AND b1.internal_sku <> '' AND b1.internal_sku = b2.internal_sku)
         OR (EXISTS (SELECT 1 FROM unnest(b1.part_numbers) p1 JOIN unnest(b2.part_numbers) p2 ON UPPER(REGEXP_REPLACE(p1,'[^A-Za-z0-9]','','g')) = UPPER(REGEXP_REPLACE(p2,'[^A-Za-z0-9]','','g'))) AND COALESCE(LOWER(b1.brand_name),'') = COALESCE(LOWER(b2.brand_name),''))
      LIMIT $3
    `,[query, `%${query}%`, limit]);

    return rows.rows.map((r)=>({
      phase:1,
      part1:{ part_id:r.part_id, internal_sku:r.internal_sku, detail:r.detail, group_id:r.group_id, brand_id:r.brand_id, brand_name:r.brand_name, display_name:r.display_name, part_numbers:r.part_numbers||[] },
      part2:{ part_id:r.part_id_1, internal_sku:r.internal_sku_1, detail:r.detail_1, group_id:r.group_id_1, brand_id:r.brand_id_1, brand_name:r.brand_name_1, display_name:r.display_name_1, part_numbers:r.part_numbers_1||[] }
    }));
  }

  async findMeiliCandidates(query, limit) {
    const idx = meiliClient.index('parts');
    const seed = query ? (await idx.search(query, { limit: Math.min(limit, 30) })).hits : [];
    const candidates = [];
    for (const h of seed) {
      const term = h.internal_sku || h.display_name || h.detail;
      if (!term) continue;
      const rel = await idx.search(term, { limit: 8, typoTolerance: true });
      const ids = [...new Set(rel.hits.map(x => Number(x.part_id)).filter(Boolean))];
      if (ids.length < 2) continue;
      const parts = await this.loadPartsByIds(ids);
      for (let i=0;i<parts.length;i++) for (let j=i+1;j<parts.length;j++) candidates.push({ phase:2, part1:parts[i], part2:parts[j] });
    }
    return candidates.slice(0, limit);
  }

  async loadPartsByIds(ids) {
    const r = await this.db.query(`SELECT p.part_id, p.internal_sku, p.detail, p.group_id, p.brand_id, b.brand_name, p.internal_sku AS display_name,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT pn.part_number), NULL) AS part_numbers
      FROM part p LEFT JOIN brand b ON b.brand_id=p.brand_id
      LEFT JOIN part_number pn ON pn.part_id=p.part_id AND pn.deleted_at IS NULL
      WHERE p.part_id = ANY($1) AND p.merged_into_part_id IS NULL
      GROUP BY p.part_id,b.brand_name`, [ids]);
    return r.rows;
  }

  async findSimilarParts(partId, { limit = 20 } = {}) {
    const base = await this.loadPartsByIds([partId]);
    if (!base.length) return [];
    const query = base[0].internal_sku || base[0].detail || '';
    const groups = await this.findOptimizedDuplicateGroups({ query, limit: limit * 2, minScore: 0.5 });
    const partMap = new Map();
    groups.forEach(g => g.parts.forEach(p => { if (p.part_id !== partId) partMap.set(p.part_id, p); }));
    return [...partMap.values()].slice(0, limit);
  }

  async searchSimilarParts(query, { limit = 20 } = {}) {
    const groups = await this.findOptimizedDuplicateGroups({ query, limit, minScore: 0.5 });
    return groups.flatMap(g => g.parts).slice(0, limit);
  }
}

module.exports = DuplicateFinder;
