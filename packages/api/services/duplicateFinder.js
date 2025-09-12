/**
 * Service for finding potential duplicate parts
 */
class DuplicateFinder {
    constructor(db) {
        this.db = db;
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
