/**
 * Service for finding potential duplicate parts
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

    static tokenizeAndSort(text) {
        if (!text) return [];
        return this.normalizeText(text)
            .split(/\s+/)
            .filter(word => word.length > 1) // ignore single chars
            .sort();
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

    // Composite scoring for optimized finder
    static calculateCompositeScore(part1, part2, detailSim = 0, nameSim = 0) {
        let score = 0;
        const reasons = [];

        // Normalize fields
        const detail1 = this.normalizeText(part1.detail || '');
        const detail2 = this.normalizeText(part2.detail || '');
        const name1 = this.normalizeText(part1.display_name || '');
        const name2 = this.normalizeText(part2.display_name || '');

        // Shared part numbers: +0.60
        const pns1 = (part1.part_numbers || []).map(pn => this.normalizePartNumber(pn.part_number));
        const pns2 = (part2.part_numbers || []).map(pn => this.normalizePartNumber(pn.part_number));
        const sharedPns = pns1.filter(pn => pns2.includes(pn));
        if (sharedPns.length > 0) {
            score += 0.60;
            reasons.push('shared_part_number');
        }

        // Detail trigram similarity: +0.25 * similarity
        if (detailSim > 0.7) {
            score += 0.25 * detailSim;
            reasons.push('similar_detail');
        }

        // Name trigram similarity: +0.10 * similarity
        if (nameSim > 0.8) {
            score += 0.10 * nameSim;
            reasons.push('similar_name');
        }

        // Numeric token overlap: +0.05 * (overlap / max)
        const nums1 = this.extractNumericTokens(detail1 + ' ' + name1);
        const nums2 = this.extractNumericTokens(detail2 + ' ' + name2);
        const overlap = nums1.filter(n => nums2.includes(n)).length;
        const maxLen = Math.max(nums1.length, nums2.length);
        if (maxLen > 0) {
            score += 0.05 * (overlap / maxLen);
            if (overlap > 0) reasons.push('numeric_overlap');
        }

        return { score: Math.min(score, 1.0), reasons };
    }

    // Map score to confidence level
    static getConfidenceLevel(score) {
        if (score >= 0.85) return 'High';
        if (score >= 0.70) return 'Medium';
        if (score >= 0.60) return 'Low';
        return 'Very Low';
    }

    /**
     * Optimized duplicate finder with confidence scoring
     */
    async findOptimizedDuplicateGroups(options = {}) {
        const { minScore = 0.6, limit = 50 } = options;

        // Query to find candidate pairs within same brand/group
        const queryText = `
            SELECT p1.part_id as part1_id, p1.internal_sku as part1_sku, p1.display_name as part1_name, p1.detail as part1_detail,
                   p1.brand_name as part1_brand, p1.group_name as part1_group,
                   p2.part_id as part2_id, p2.internal_sku as part2_sku, p2.display_name as part2_name, p2.detail as part2_detail,
                   p2.brand_name as part2_brand, p2.group_name as part2_group,
                   CASE WHEN pn1.part_number IS NOT NULL AND pn2.part_number IS NOT NULL THEN 1 ELSE 0 END as shared_pn,
                   similarity(p1.detail, p2.detail) as detail_sim,
                   similarity(p1.display_name, p2.display_name) as name_sim
            FROM parts_view p1
            JOIN parts_view p2 ON p1.part_id < p2.part_id 
                AND p1.brand_name = p2.brand_name 
                AND p1.group_name = p2.group_name
            LEFT JOIN part_number pn1 ON p1.part_id = pn1.part_id AND pn1.deleted_at IS NULL
            LEFT JOIN part_number pn2 ON p2.part_id = pn2.part_id AND pn2.deleted_at IS NULL AND pn1.part_number = pn2.part_number
            WHERE p1.merged_into_part_id IS NULL 
                AND p2.merged_into_part_id IS NULL
                AND (pn1.part_number IS NOT NULL OR similarity(p1.detail, p2.detail) > 0.7 OR similarity(p1.display_name, p2.display_name) > 0.7)
            ORDER BY (CASE WHEN pn1.part_number IS NOT NULL THEN 1 ELSE 0 END) DESC, 
                     GREATEST(similarity(p1.detail, p2.detail), similarity(p1.display_name, p2.display_name)) DESC
            LIMIT $1
        `;

        const result = await this.db.query(queryText, [limit * 10]); // get more candidates

        const groups = [];
        const processed = new Set();

        for (const row of result.rows) {
            if (processed.has(row.part1_id) || processed.has(row.part2_id)) continue;

            const part1 = {
                part_id: row.part1_id,
                internal_sku: row.part1_sku,
                display_name: row.part1_name,
                detail: row.part1_detail,
                brand_name: row.part1_brand,
                group_name: row.part1_group,
                part_numbers: [] // placeholder, need to fetch
            };
            const part2 = {
                part_id: row.part2_id,
                internal_sku: row.part2_sku,
                display_name: row.part2_name,
                detail: row.part2_detail,
                brand_name: row.part2_brand,
                group_name: row.part2_group,
                part_numbers: [] // placeholder
            };

            // Fetch part numbers for scoring
            const pnQuery = `SELECT part_id, part_number FROM part_number WHERE part_id IN ($1, $2) AND deleted_at IS NULL`;
            const pnResult = await this.db.query(pnQuery, [row.part1_id, row.part2_id]);
            pnResult.rows.forEach(pn => {
                if (pn.part_id === row.part1_id) part1.part_numbers.push({ part_number: pn.part_number });
                else part2.part_numbers.push({ part_number: pn.part_number });
            });

            const { score, reasons } = this.constructor.calculateCompositeScore(part1, part2, row.detail_sim, row.name_sim);

            if (score >= minScore) {
                const group = {
                    groupId: `opt_${row.part1_id}_${row.part2_id}`,
                    score,
                    confidence: this.constructor.getConfidenceLevel(score),
                    reasons,
                    parts: [this.formatPartData(part1), this.formatPartData(part2)]
                };
                groups.push(group);
                processed.add(row.part1_id);
                processed.add(row.part2_id);
            }
        }

        return groups.slice(0, limit);
    }

    /**
     * Find groups of potentially duplicate parts
     * @param {Object} options - Search options
     * @param {string} options.query - Optional search query to filter parts
     * @param {number} options.limit - Maximum number of groups to return
     * @param {number} options.offset - Offset for pagination
     * @param {string} options.strategy - Detection strategy ('auto', 'strict', 'loose')
     * @returns {Array} Array of duplicate groups
     */
    async findDuplicateGroups(options = {}) {
        const { query = '', limit = 50, offset = 0, strategy = 'auto' } = options;
        
        const duplicateGroups = [];
        
        // Strategy 1: Exact SKU matches (different parts with same SKU - shouldn't happen but might)
        const skuDuplicates = await this.findSkuDuplicates(query, limit, offset);
        duplicateGroups.push(...skuDuplicates);
        
        // Strategy 2: Exact part number overlaps
        const partNumberDuplicates = await this.findPartNumberDuplicates(query, limit, offset);
        duplicateGroups.push(...partNumberDuplicates);
        
        // Strategy 3: Similar names within same brand/group
        const nameDuplicates = await this.findSimilarNameDuplicates(query, limit, offset, strategy);
        duplicateGroups.push(...nameDuplicates);
        
        // Strategy 4: Very similar display names (trigram similarity)
        if (strategy === 'auto' || strategy === 'loose') {
            const trigramDuplicates = await this.findTrigramSimilarDuplicates(query, limit, offset);
            duplicateGroups.push(...trigramDuplicates);
        }
        
        // Deduplicate and sort by confidence score
        const uniqueGroups = this.deduplicateGroups(duplicateGroups);
        return uniqueGroups.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    async findSkuDuplicates(query, limit, offset) {
        const queryText = `
            SELECT p1.part_id, p1.internal_sku, p1.display_name, p1.brand_name, p1.group_name,
                   p1.tags, p1.created_at, p1.modified_at
            FROM parts_view p1
            JOIN parts_view p2 ON p1.internal_sku = p2.internal_sku 
                AND p1.part_id != p2.part_id
            WHERE p1.merged_into_part_id IS NULL 
                AND p2.merged_into_part_id IS NULL
                AND ($1 = '' OR p1.display_name ILIKE $1 OR p1.internal_sku ILIKE $1)
            ORDER BY p1.internal_sku, p1.part_id
            LIMIT $2 OFFSET $3
        `;
        
        const params = [`%${query}%`, limit * 2, offset];
        const result = await this.db.query(queryText, params);
        
        return this.groupPartsByKey(result.rows, 'internal_sku', 'exact_sku', 1.0);
    }

    async findPartNumberDuplicates(query, limit, offset) {
        const queryText = `
            SELECT DISTINCT p1.part_id, p1.internal_sku, p1.display_name, p1.brand_name, p1.group_name,
                   p1.tags, p1.created_at, p1.modified_at, pn1.part_number
            FROM parts_view p1
            JOIN part_number pn1 ON p1.part_id = pn1.part_id
            JOIN part_number pn2 ON pn1.part_number = pn2.part_number 
                AND pn1.part_id != pn2.part_id
            JOIN parts_view p2 ON pn2.part_id = p2.part_id
            WHERE p1.merged_into_part_id IS NULL 
                AND p2.merged_into_part_id IS NULL
                AND ($1 = '' OR p1.display_name ILIKE $1 OR p1.internal_sku ILIKE $1)
            ORDER BY pn1.part_number, p1.part_id
            LIMIT $2 OFFSET $3
        `;
        
        const params = [`%${query}%`, limit * 2, offset];
        const result = await this.db.query(queryText, params);
        
        return this.groupPartsByKey(result.rows, 'part_number', 'shared_part_number', 0.9);
    }

    async findSimilarNameDuplicates(query, limit, offset, strategy) {
        const similarityThreshold = strategy === 'strict' ? 0.9 : 0.8;
        
        const queryText = `
            SELECT p1.part_id, p1.internal_sku, p1.display_name, p1.brand_name, p1.group_name,
                   p1.tags, p1.created_at, p1.modified_at,
                   similarity(p1.display_name, p2.display_name) as name_similarity
            FROM parts_view p1
            JOIN parts_view p2 ON p1.part_id < p2.part_id 
                AND p1.brand_name = p2.brand_name 
                AND p1.group_name = p2.group_name
                AND similarity(p1.display_name, p2.display_name) > $4
            WHERE p1.merged_into_part_id IS NULL 
                AND p2.merged_into_part_id IS NULL
                AND ($1 = '' OR p1.display_name ILIKE $1 OR p1.internal_sku ILIKE $1)
            ORDER BY name_similarity DESC, p1.part_id
            LIMIT $2 OFFSET $3
        `;
        
        const params = [`%${query}%`, limit * 2, offset, similarityThreshold];
        
        try {
            const result = await this.db.query(queryText, params);
            return this.groupSimilarParts(result.rows, 'similar_name_brand_group', 0.8);
        } catch (error) {
            console.warn('Trigram similarity not available, skipping similar name detection:', error.message);
            return [];
        }
    }

    async findTrigramSimilarDuplicates(query, limit, offset) {
        const queryText = `
            SELECT p1.part_id, p1.internal_sku, p1.display_name, p1.brand_name, p1.group_name,
                   p1.tags, p1.created_at, p1.modified_at,
                   similarity(p1.display_name, p2.display_name) as name_similarity
            FROM parts_view p1
            JOIN parts_view p2 ON p1.part_id < p2.part_id 
                AND similarity(p1.display_name, p2.display_name) > 0.7
            WHERE p1.merged_into_part_id IS NULL 
                AND p2.merged_into_part_id IS NULL
                AND ($1 = '' OR p1.display_name ILIKE $1 OR p1.internal_sku ILIKE $1)
            ORDER BY name_similarity DESC, p1.part_id
            LIMIT $2 OFFSET $3
        `;
        
        const params = [`%${query}%`, limit * 2, offset];
        
        try {
            const result = await this.db.query(queryText, params);
            return this.groupSimilarParts(result.rows, 'similar_name_trigram', 0.7);
        } catch (error) {
            console.warn('Trigram similarity not available, skipping trigram detection:', error.message);
            return [];
        }
    }

    groupPartsByKey(rows, keyField, reason, score) {
        const groups = new Map();
        
        for (const row of rows) {
            const key = row[keyField];
            if (!groups.has(key)) {
                groups.set(key, {
                    groupId: `${reason}_${key}`,
                    score,
                    reasons: [reason],
                    parts: []
                });
            }
            groups.get(key).parts.push(this.formatPartData(row));
        }
        
        return Array.from(groups.values()).filter(group => group.parts.length > 1);
    }

    groupSimilarParts(rows, reason, score) {
        const groups = [];
        const processed = new Set();
        
        for (const row of rows) {
            if (processed.has(row.part_id)) continue;
            
            const group = {
                groupId: `${reason}_${row.part_id}`,
                score: Math.min(score, row.name_similarity || score),
                reasons: [reason],
                parts: [this.formatPartData(row)]
            };
            
            // Find all similar parts for this group
            for (const otherRow of rows) {
                if (otherRow.part_id !== row.part_id && 
                    !processed.has(otherRow.part_id) &&
                    (otherRow.name_similarity || 0) >= score) {
                    group.parts.push(this.formatPartData(otherRow));
                    processed.add(otherRow.part_id);
                }
            }
            
            if (group.parts.length > 1) {
                groups.push(group);
                processed.add(row.part_id);
            }
        }
        
        return groups;
    }

    formatPartData(row) {
        return {
            part_id: row.part_id,
            internal_sku: row.internal_sku,
            display_name: row.display_name,
            brand_name: row.brand_name,
            group_name: row.group_name,
            tags: row.tags,
            created_at: row.created_at,
            modified_at: row.modified_at
        };
    }

    deduplicateGroups(groups) {
        const seen = new Set();
        const unique = [];
        
        for (const group of groups) {
            const partIds = group.parts.map(p => p.part_id).sort().join(',');
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
            SELECT part_id, internal_sku, display_name, brand_name, group_name, 
                   tags, created_at, modified_at
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
