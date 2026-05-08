const { meiliClient } = require('../meilisearch');

/**
 * Service for finding potential duplicate parts using Cascade Record Linkage
 * Phase 1: Deterministic Blocking (SQL)
 * Phase 2: Semantic/Fuzzy Blocking (Meilisearch)
 * Phase 3: Hierarchical Penalty & Boost Scoring
 */
class DuplicateFinder {
    constructor(db) {
        this.db = db;
    }

    // Normalization helpers
    static normalizeText(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // unaccent
            .replace(/[^\w\s]/g, ' ') // remove punctuation
            .replace(/\s+/g, ' ')
            .trim();
    }

    static normalizePartNumber(pn) {
        if (!pn) return '';
        return pn.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    }

    static extractNumericTokens(text) {
        if (!text) return [];
        const matches = text.match(/\b\d+\b/g) || [];
        return matches.map(m => parseInt(m)).filter(n => !isNaN(n));
    }

    /**
     * Phase 3: Hierarchical Penalty & Boost Scoring
     */
    static calculateCompositeScore(part1, part2, baseScore = 0) {
        let score = baseScore;
        const reasons = [];

        // Normalize fields
        const detail1 = this.normalizeText(part1.detail || '');
        const detail2 = this.normalizeText(part2.detail || '');
        const name1 = this.normalizeText(part1.display_name || '');
        const name2 = this.normalizeText(part2.display_name || '');

        // Ensure part numbers are mapped as strings, handling both formats
        const getPns = (part) => {
            const pns = part.part_numbers || part.part_numbers_array || [];
            if (!Array.isArray(pns)) return [];
            return pns.map(p => {
                if (typeof p === 'string') return p;
                if (p && p.part_number) return p.part_number;
                return '';
            }).filter(Boolean);
        };

        const pns1 = getPns(part1).map(pn => this.normalizePartNumber(pn));
        const pns2 = getPns(part2).map(pn => this.normalizePartNumber(pn));

        const sharedPns = pns1.filter(pn => pns2.includes(pn));

        // Massive Penalty/Disqualification: Candidates have *different*, explicitly defined part numbers
        // Only penalize if BOTH have defined part numbers and they DO NOT share any.
        if (pns1.length > 0 && pns2.length > 0 && sharedPns.length === 0) {
            score -= 0.80;
            reasons.push('different_part_numbers_penalty');
        } else if (sharedPns.length > 0) {
            // Give a boost if they share part numbers but only if it's not already accounted for
            // We'll give a small boost for shared part numbers to maintain logic,
            // though phase 1 might have already found it.
            score += 0.10;
        }

        // Boost: Candidates share the same `brand` and `group`. (+0.30)
        if (part1.brand_name && part2.brand_name && part1.group_name && part2.group_name) {
            if (part1.brand_name === part2.brand_name && part1.group_name === part2.group_name) {
                score += 0.30;
                reasons.push('same_brand_and_group');
            }
        }

        // Boost: Extracted numeric tokens match exactly (+0.20)
        const nums1 = this.extractNumericTokens(detail1 + ' ' + name1);
        const nums2 = this.extractNumericTokens(detail2 + ' ' + name2);
        if (nums1.length > 0 && nums2.length > 0) {
            const sortedNums1 = [...nums1].sort().join(',');
            const sortedNums2 = [...nums2].sort().join(',');
            if (sortedNums1 === sortedNums2) {
                score += 0.20;
                reasons.push('numeric_tokens_match');
            }
        }

        return { score: Math.max(-1.0, Math.min(score, 1.0)), reasons };
    }

    // Map score to confidence level
    static getConfidenceLevel(score) {
        if (score >= 0.85) return 'High';
        if (score >= 0.70) return 'Medium';
        if (score >= 0.50) return 'Low';
        return 'Very Low';
    }

    /**
     * Find groups of potentially duplicate parts using the cascade strategy
     * @param {Object} options - Search options
     * @param {string} options.query - Optional search query to filter parts
     * @param {number} options.limit - Maximum number of groups to return
     * @returns {Array} Array of duplicate groups
     */
    async findDuplicateGroups(options = {}) {
        return this.findOptimizedDuplicateGroups(options);
    }

    async findOptimizedDuplicateGroups(options = {}) {
        const { query = '', limit = 50 } = options;
        const minScore = options.minScore !== undefined ? options.minScore : (options.minSimilarity !== undefined ? options.minSimilarity : 0.50);

        const adjacency = new Map();
        const partById = new Map();
        const edgeDetails = new Map();
        const processedPairs = new Set();
        
        // Helper to generate a unique pair ID regardless of order
        const getPairId = (id1, id2) => {
            const [a, b] = [parseInt(id1), parseInt(id2)].sort((x, y) => x - y);
            return `${a}_${b}`;
        };

        const addEdge = (pair, baseScore) => {
            const part1Id = parseInt(pair.part1.part_id);
            const part2Id = parseInt(pair.part2.part_id);
            const pairId = getPairId(part1Id, part2Id);

            if (processedPairs.has(pairId)) return;
            processedPairs.add(pairId);

            const { score, reasons } = this.constructor.calculateCompositeScore(pair.part1, pair.part2, baseScore);
            if (score < minScore) return;

            partById.set(part1Id, pair.part1);
            partById.set(part2Id, pair.part2);

            if (!adjacency.has(part1Id)) adjacency.set(part1Id, new Set());
            if (!adjacency.has(part2Id)) adjacency.set(part2Id, new Set());
            adjacency.get(part1Id).add(part2Id);
            adjacency.get(part2Id).add(part1Id);

            edgeDetails.set(pairId, {
                score,
                reasons: [...(pair.reasons || []), ...reasons]
            });
        };

        // Phase 1: Deterministic Blocking (The Fast Net)
        // Group items that share exact, distinct identifiers (internal_sku or part_number)
        const deterministicPairs = await this.findDeterministicPairs(query, limit);
        
        for (const pair of deterministicPairs) {
            // Phase 3: Hierarchical Penalty & Boost Scoring
            // Start with a high base score (0.80) because they are deterministic matches.
            addEdge(pair, 0.80);
        }

        // Phase 2: Semantic/Fuzzy Blocking (The Wide Net) using Meilisearch
        try {
            const fuzzyPairs = await this.findFuzzyMeilisearchPairs(query, limit);

            for (const pair of fuzzyPairs) {
                // Phase 3: Hierarchical Penalty & Boost Scoring
                // Base score for a Meilisearch fuzzy match.
                addEdge(pair, 0.40);
            }
        } catch (error) {
            console.error('Meilisearch fuzzy blocking failed, falling back/skipping:', error);
        }

        // Extract connected components (O(V+E))
        const duplicateGroups = [];
        const visited = new Set();

        for (const partId of adjacency.keys()) {
            if (visited.has(partId)) continue;

            const stack = [partId];
            const componentIds = [];
            visited.add(partId);

            while (stack.length > 0) {
                const current = stack.pop();
                componentIds.push(current);

                for (const neighbor of adjacency.get(current) || []) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        stack.push(neighbor);
                    }
                }
            }

            if (componentIds.length <= 1) continue;

            const componentSet = new Set(componentIds);
            const componentParts = componentIds
                .map(id => partById.get(id))
                .filter(Boolean);

            const componentScores = [];
            const componentReasons = new Set();

            for (const edgeId of edgeDetails.keys()) {
                const [aStr, bStr] = edgeId.split('_');
                const a = parseInt(aStr);
                const b = parseInt(bStr);
                if (!componentSet.has(a) || !componentSet.has(b)) continue;

                const edge = edgeDetails.get(edgeId);
                componentScores.push(edge.score);
                for (const reason of edge.reasons) componentReasons.add(reason);
            }

            if (componentScores.length === 0) continue;

            const averageScore = componentScores.reduce((sum, val) => sum + val, 0) / componentScores.length;
            const normalizedIds = [...componentIds].sort((a, b) => a - b).join('_');

            duplicateGroups.push({
                groupId: `component_${normalizedIds}`,
                score: averageScore,
                confidence: this.constructor.getConfidenceLevel(averageScore),
                reasons: Array.from(componentReasons),
                parts: componentParts
            });
        }

        return duplicateGroups.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    async findDeterministicPairs(query, limit) {
        const pairs = [];
        
        // Deterministic by internal_sku
        const skuQueryText = `
            WITH duplicated_skus AS (
                SELECT internal_sku
                FROM part
                WHERE merged_into_part_id IS NULL AND internal_sku IS NOT NULL AND internal_sku != ''
                GROUP BY internal_sku
                HAVING COUNT(*) > 1
            )
            SELECT p.*,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object('part_number', pn.part_number))
                        FROM part_number pn
                        WHERE pn.part_id = p.part_id AND pn.deleted_at IS NULL),
                   '[]'::json) as part_numbers_array
            FROM parts_view p
            JOIN duplicated_skus ds ON p.internal_sku = ds.internal_sku
            WHERE p.merged_into_part_id IS NULL
              AND ($1 = '' OR p.display_name ILIKE $1 OR p.internal_sku ILIKE $1)
            ORDER BY p.internal_sku, p.part_id
            LIMIT $2
        `;
        
        const skuResult = await this.db.query(skuQueryText, [`%${query}%`, limit * 5]);
        const skuGroups = this.groupPartsByKey(skuResult.rows, 'internal_sku', 'exact_internal_sku');
        
        for (const group of skuGroups) {
            const parts = group.parts;
            for (let i = 0; i < parts.length; i++) {
                for (let j = i + 1; j < parts.length; j++) {
                    pairs.push({
                        part1: parts[i],
                        part2: parts[j],
                        reasons: ['exact_internal_sku']
                    });
                }
            }
        }

        // Deterministic by part_number
        const pnQueryText = `
            WITH duplicated_pns AS (
                SELECT part_number
                FROM part_number
                WHERE deleted_at IS NULL AND part_number IS NOT NULL AND part_number != ''
                GROUP BY part_number
                HAVING COUNT(DISTINCT part_id) > 1
            )
            SELECT p.*,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object('part_number', pn_inner.part_number))
                        FROM part_number pn_inner
                        WHERE pn_inner.part_id = p.part_id AND pn_inner.deleted_at IS NULL),
                   '[]'::json) as part_numbers_array,
                   dpn.part_number as matching_part_number
            FROM parts_view p
            JOIN part_number pn ON p.part_id = pn.part_id AND pn.deleted_at IS NULL
            JOIN duplicated_pns dpn ON pn.part_number = dpn.part_number
            WHERE p.merged_into_part_id IS NULL
              AND ($1 = '' OR p.display_name ILIKE $1 OR p.internal_sku ILIKE $1)
            ORDER BY dpn.part_number, p.part_id
            LIMIT $2
        `;
        
        const pnResult = await this.db.query(pnQueryText, [`%${query}%`, limit * 5]);
        const pnGroups = this.groupPartsByKey(pnResult.rows, 'matching_part_number', 'exact_part_number');
        
        for (const group of pnGroups) {
            const parts = group.parts;
            for (let i = 0; i < parts.length; i++) {
                for (let j = i + 1; j < parts.length; j++) {
                    pairs.push({
                        part1: parts[i],
                        part2: parts[j],
                        reasons: ['exact_part_number']
                    });
                }
            }
        }

        return pairs;
    }

    async findFuzzyMeilisearchPairs(query, limit) {
        const baseQueryText = `
            SELECT p.*,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object('part_number', pn.part_number))
                        FROM part_number pn
                        WHERE pn.part_id = p.part_id AND pn.deleted_at IS NULL),
                   '[]'::json) as part_numbers_array
            FROM parts_view p
            WHERE p.merged_into_part_id IS NULL
              AND ($1 = '' OR p.display_name ILIKE $1 OR p.internal_sku ILIKE $1 OR p.detail ILIKE $1)
            ORDER BY p.modified_at DESC
            LIMIT $2
        `;
        
        const baseResult = await this.db.query(baseQueryText, [`%${query}%`, limit]);
        const candidates = baseResult.rows;
        
        const pairs = [];
        const index = meiliClient.index('parts');
        const rawHitsByCandidate = [];
        const allHitIds = new Set();

        for (const candidate of candidates) {
            const searchQuery = candidate.display_name || candidate.internal_sku || '';
            if (!searchQuery) continue;

            const searchRes = await index.search(searchQuery, {
                limit: 5,
                attributesToRetrieve: ['part_id']
            });

            const hitIds = searchRes.hits.map(h => h.part_id).filter(id => id !== candidate.part_id);
            if (hitIds.length > 0) {
                rawHitsByCandidate.push({ candidate, hitIds });
                hitIds.forEach(id => allHitIds.add(id));
            }
        }

        // Proactive Edge Case Handling: Fetch up-to-date data from DB for all Meilisearch hits
        // This ensures we don't present stale data (e.g. recently merged parts) if Meili sync is lagging.
        const upToDateHits = new Map();
        if (allHitIds.size > 0) {
            const idsArray = Array.from(allHitIds);
            const hitsQuery = `
                SELECT p.*,
                       COALESCE(
                           (SELECT json_agg(jsonb_build_object('part_number', pn.part_number))
                            FROM part_number pn
                            WHERE pn.part_id = p.part_id AND pn.deleted_at IS NULL),
                       '[]'::json) as part_numbers_array
                FROM parts_view p
                WHERE p.part_id = ANY($1) AND p.merged_into_part_id IS NULL
            `;
            const hitsResult = await this.db.query(hitsQuery, [idsArray]);
            for (const row of hitsResult.rows) {
                upToDateHits.set(row.part_id, row);
            }
        }

        for (const { candidate, hitIds } of rawHitsByCandidate) {
            for (const hitId of hitIds) {
                const freshHit = upToDateHits.get(hitId);
                if (freshHit) {
                    pairs.push({
                        part1: this.formatPartData(candidate),
                        part2: this.formatPartData(freshHit),
                        reasons: ['meilisearch_fuzzy_match']
                    });
                }
            }
        }

        return pairs;
    }

    groupPartsByKey(rows, keyField, reason) {
        const groups = new Map();
        
        for (const row of rows) {
            const key = row[keyField];
            if (!groups.has(key)) {
                groups.set(key, {
                    groupId: `${reason}_${key}`,
                    reasons: [reason],
                    parts: []
                });
            }
            groups.get(key).parts.push(this.formatPartData(row));
        }
        
        return Array.from(groups.values()).filter(group => group.parts.length > 1);
    }

    formatPartData(row) {
        return {
            part_id: row.part_id,
            internal_sku: row.internal_sku,
            display_name: row.display_name,
            detail: row.detail,
            brand_name: row.brand_name,
            group_name: row.group_name,
            tags: row.tags || '',
            created_at: row.created_at || row.date_created,
            modified_at: row.modified_at || row.date_modified,
            part_numbers: row.part_numbers_array || row.part_numbers || []
        };
    }

    deduplicateGroups(groups) {
        const seen = new Set();
        const unique = [];
        
        for (const group of groups) {
            const partIds = group.parts.map(p => parseInt(p.part_id)).sort((a,b) => a-b).join(',');
            if (!seen.has(partIds)) {
                seen.add(partIds);
                unique.push(group);
            }
        }
        
        return unique;
    }

    /**
     * Search for parts that could be manually selected for merging
     * @param {string} searchTerm - Search term
     * @param {number} limit - Max results
     * @returns {Array} Array of parts
     */
    async searchPartsForMerge(searchTerm, limit = 20) {
        const queryText = `
            SELECT part_id, internal_sku, display_name, brand_name, group_name, detail,
                   date_created as created_at, date_modified as modified_at
            FROM parts_view
            WHERE merged_into_part_id IS NULL
                AND (display_name ILIKE $1 OR internal_sku ILIKE $1 OR detail ILIKE $1)
            ORDER BY 
                CASE WHEN internal_sku ILIKE $1 THEN 1 ELSE 2 END,
                CASE WHEN display_name ILIKE $1 THEN 1 ELSE 2 END,
                modified_at DESC
            LIMIT $2
        `;
        
        const result = await this.db.query(queryText, [`%${searchTerm}%`, limit]);
        return result.rows.map(row => this.formatPartData(row));
    }
}

module.exports = DuplicateFinder;
