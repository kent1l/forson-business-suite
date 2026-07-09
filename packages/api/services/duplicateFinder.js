const { meiliClient } = require('../meilisearch');
const llmRouter = require('./llmRouter');
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
        // Matches numbers with optional decimals and optional alphabetical suffixes (e.g., 12.5, 12V, 10kg)
        const matches = text.match(/\d+(?:\.\d+)?[a-zA-Z]*/g) || [];
        return matches;
    }

    static calculateDiceCoefficient(str1, str2) {
        if (!str1 || !str2) return 0;
        if (str1 === str2) return 1;
        const getBigrams = str => {
            const map = new Map();
            for (let i = 0; i < str.length - 1; i++) {
                const bg = str.substring(i, i + 2);
                map.set(bg, (map.get(bg) || 0) + 1);
            }
            return map;
        };
        const bg1 = getBigrams(str1);
        const bg2 = getBigrams(str2);
        let intersection = 0;
        for (const [bg, count1] of bg1.entries()) {
            const count2 = bg2.get(bg) || 0;
            intersection += Math.min(count1, count2);
        }
        const totalSize = Math.max(1, (str1.length - 1) + (str2.length - 1));
        return (2.0 * intersection) / totalSize;
    }

    static calculateJaroWinkler(s1, s2) {
        if (s1 === s2) return 1.0;
        if (!s1 || !s2) return 0.0;
        const m = s1.length, n = s2.length;
        const matchWindow = Math.floor(Math.max(m, n) / 2) - 1;
        let matches = 0, transpositions = 0;
        const s1Matches = new Array(m).fill(false), s2Matches = new Array(n).fill(false);
        for (let i = 0; i < m; i++) {
            const start = Math.max(0, i - matchWindow), end = Math.min(n - 1, i + matchWindow);
            for (let j = start; j <= end; j++) {
                if (!s2Matches[j] && s1[i] === s2[j]) {
                    s1Matches[i] = true; s2Matches[j] = true; matches++; break;
                }
            }
        }
        if (matches === 0) return 0.0;
        let k = 0;
        for (let i = 0; i < m; i++) {
            if (s1Matches[i]) {
                while (!s2Matches[k]) k++;
                if (s1[i] !== s2[k]) transpositions++;
                k++;
            }
        }
        transpositions /= 2.0;
        const jaro = ((matches / m) + (matches / n) + ((matches - transpositions) / matches)) / 3.0;
        let prefix = 0;
        const maxPrefix = Math.min(4, Math.min(m, n));
        for (let i = 0; i < maxPrefix; i++) {
            if (s1[i] === s2[i]) prefix++; else break;
        }
        return jaro + (prefix * 0.1 * (1.0 - jaro));
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

        const normalizeBrandName = (brand) => {
            if (typeof brand !== 'string') return '';
            return brand.trim().toLowerCase();
        };

        const normalizedBrand1 = normalizeBrandName(part1.brand_name);
        const normalizedBrand2 = normalizeBrandName(part2.brand_name);

        // Strict Brand Disqualification Rule:
        // If both parts have explicitly defined brand names and they conflict,
        // immediately disqualify the pair regardless of deterministic/fuzzy base score.
        if (normalizedBrand1 && normalizedBrand2 && normalizedBrand1 !== normalizedBrand2) {
            score = -1.0;
            reasons.push('different_brands_disqualification');
        }

        // Strict Color Disqualification Rule:
        const colors = ['black', 'white', 'yellow', 'orange', 'green', 'blue', 'brown', 'red', 'gray', 'grey'];
        const getColor = (text) => colors.find(c => new RegExp(`\\b${c}\\b`, 'i').test(text));
        
        const color1 = getColor(detail1 + ' ' + name1);
        const color2 = getColor(detail2 + ' ' + name2);
        
        if (color1 && color2 && color1 !== color2) {
            score = -1.0;
            reasons.push('different_colors_disqualification');
        }

        // Penalty/Disqualification: Candidates have *different*, explicitly defined part numbers.
        // Only penalize if BOTH have part numbers and none are exact matches.
        // IMPORTANT: We must be JW-aware here. Vendor-prefix variants like SC-47575R vs 47575R
        // have zero exact overlap but JW ≈ 0.92 — they should NOT receive the full -0.80 penalty.
        if (pns1.length > 0 && pns2.length > 0 && sharedPns.length === 0) {
            // Compute the best Jaro-Winkler across all cross-pairs of part numbers
            const bestPnJw = Math.max(
                ...pns1.map(pn1 => Math.max(...pns2.map(pn2 => this.calculateJaroWinkler(pn1, pn2))))
            );
            if (bestPnJw >= 0.80) {
                // Vendor-prefix / size-suffix variant (e.g. SC-47575R vs 47575R, 010-47575 vs 47575R).
                // Apply only a soft penalty; let Dice + AI decide.
                score -= 0.15;
                reasons.push('fuzzy_part_number_variant');
            } else {
                // Genuinely different part numbers — apply strong disqualification.
                score -= 0.80;
                reasons.push('different_part_numbers_penalty');
            }
        } else if (sharedPns.length > 0) {
            score += 0.10;
            reasons.push('shared_part_numbers_boost');
        }

        // Boost: Candidates share the same `brand` and `group`. (+0.30)
        // Skip generic placeholder brands to prevent false positive clustering
        const genericBrands = ['no brand', 'none', 'n/a', 'generic'];
        if (normalizedBrand1 && normalizedBrand2 && part1.group_name && part2.group_name) {
            if (normalizedBrand1 === normalizedBrand2 && part1.group_name === part2.group_name) {
                if (!genericBrands.includes(normalizedBrand1)) {
                    score += 0.30;
                    reasons.push('same_brand_and_group');
                }
            }
        }

        // Boost: Extracted numeric tokens match exactly (+0.20)
        const nums1 = this.extractNumericTokens(detail1 + ' ' + name1);
        const nums2 = this.extractNumericTokens(detail2 + ' ' + name2);
        let hasNumericMismatch = false;
        if (nums1.length > 0 && nums2.length > 0) {
            const sortedNums1 = [...nums1].sort().join(',');
            const sortedNums2 = [...nums2].sort().join(',');
            if (sortedNums1 === sortedNums2) {
                score += 0.20;
                reasons.push('numeric_tokens_match');
            } else {
                hasNumericMismatch = true;
                score -= 0.10;
                reasons.push('numeric_tokens_mismatch');
            }
        }

        // Mathematical Algorithmic Gate:
        // Compute structural text overlap (Sørensen-Dice) and typo-resistant part number matching (Jaro-Winkler)
        const diceSimilarity = this.calculateDiceCoefficient(name1 + ' ' + detail1, name2 + ' ' + detail2);
        const jaroWinklerPartNum = (pns1.length > 0 && pns2.length > 0) 
            ? Math.max(...pns1.map(pn1 => Math.max(...pns2.map(pn2 => this.calculateJaroWinkler(pn1, pn2)))))
            : 0;

        // Strict Algorithmic Guardrail:
        // If descriptions share less than 40% bigram structure AND their part numbers aren't extremely close matches, discard instantly.
        if (diceSimilarity < 0.40 && jaroWinklerPartNum < 0.85) {
            score = -1.0;
            reasons.push('low_mathematical_similarity_disqualification');
        } else if (diceSimilarity > 0.80) {
            // Apply a slight confidence boost if textual structure is extremely identical
            score += 0.15;
            reasons.push('high_text_similarity');
        }

        // To safely skip AI, we demand both a high final score AND a solid text structure overlap,
        // and crucially, we FORBID skipping the AI if there is ANY mismatch in numeric tokens (like 12V vs 24V).
        if (score >= 0.95 && diceSimilarity > 0.75 && !hasNumericMismatch) {
            reasons.push('obvious_match');
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
        const { query = '', limit = 50, progressCallback = null } = options;
        const minScore = options.minScore !== undefined ? options.minScore : (options.minSimilarity !== undefined ? options.minSimilarity : 0.50);

        let aiRequests = 0;
        let aiDuplicatesFound = 0;
        let transitiveSkipped = 0;

        const reportProgress = (stage, message, details = {}) => {
            if (progressCallback) progressCallback({ stage, message, ...details });
        };

        const adjacency = new Map();
        const partById = new Map();
        const edgeDetails = new Map();
        const processedPairs = new Set();
        
        // Fetch all AI cached matches and exclusions
        const cacheRes = await this.db.query('SELECT part_id_1, part_id_2, is_duplicate FROM ai_match_cache');
        const aiCache = new Map(cacheRes.rows.map(r => [`${r.part_id_1}_${r.part_id_2}`, r.is_duplicate]));
        
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

            // Instant Cache Hit: False Positive
            if (aiCache.has(pairId) && aiCache.get(pairId) === false) return;

            const { score, reasons } = this.constructor.calculateCompositeScore(pair.part1, pair.part2, baseScore);
            if (score < minScore) return;

            // Instant Cache Hit: True Positive
            if (aiCache.has(pairId) && aiCache.get(pairId) === true) {
                reasons.push('ai_cached_positive');
            }

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
        reportProgress('deterministic', 'Phase 1: Finding exact matches (SQL)...');
        const deterministicPairs = await this.findDeterministicPairs(query, limit);
        
        for (const pair of deterministicPairs) {
            // Phase 3: Hierarchical Penalty & Boost Scoring
            // Start with a high base score (0.80) because they are deterministic matches.
            addEdge(pair, 0.80);
        }

        // Phase 2: Semantic/Fuzzy Blocking (The Wide Net) using Meilisearch
        try {
            reportProgress('semantic', 'Phase 2: Fuzzy searching for similar parts (Meilisearch)...');
            const fuzzyPairs = await this.findFuzzyMeilisearchPairs(query, limit);

            for (const pair of fuzzyPairs) {
                // Phase 3: Hierarchical Penalty & Boost Scoring
                // Base score for a Meilisearch fuzzy match.
                addEdge(pair, 0.40);
            }
        } catch (error) {
            console.error('Meilisearch fuzzy blocking failed, falling back/skipping:', error);
        }

        // Phase 3b: Strict Trim before AI Verification to avoid token waste
        reportProgress('scoring', 'Phase 3: Calculating similarity scores and applying business rules...');
        if (edgeDetails.size > limit) {
            const sortedEdges = Array.from(edgeDetails.entries()).sort((a, b) => b[1].score - a[1].score);
            const topEdges = sortedEdges.slice(0, limit);
            edgeDetails.clear();
            adjacency.clear(); 
            for (const [edgeId, edge] of topEdges) {
                edgeDetails.set(edgeId, edge);
                const [aStr, bStr] = edgeId.split('_');
                const a = parseInt(aStr);
                const b = parseInt(bStr);
                if (!adjacency.has(a)) adjacency.set(a, new Set());
                if (!adjacency.has(b)) adjacency.set(b, new Set());
                adjacency.get(a).add(b);
                adjacency.get(b).add(a);
            }
        }

        // Phase 4: LLM Verification (AI Guardrail) with Transitive Optimization
        const edges = Array.from(edgeDetails.entries()).sort((a, b) => b[1].score - a[1].score);
        
        const uf = {
            parent: new Map(),
            find(i) {
                if (!this.parent.has(i)) this.parent.set(i, i);
                if (this.parent.get(i) === i) return i;
                const p = this.find(this.parent.get(i));
                this.parent.set(i, p);
                return p;
            },
            union(i, j) {
                const rootI = this.find(i);
                const rootJ = this.find(j);
                if (rootI !== rootJ) {
                    this.parent.set(rootI, rootJ);
                    return true;
                }
                return false;
            }
        };

        // Pre-union obvious matches and cached positive matches to establish baseline components
        for (const [edgeId, edge] of edges) {
            if (edge.reasons && (edge.reasons.includes('obvious_match') || edge.reasons.includes('ai_cached_positive'))) {
                const [aStr, bStr] = edgeId.split('_');
                uf.union(parseInt(aStr), parseInt(bStr));
            }
        }

        if (options.skipAI) {
            reportProgress('ai_verification', 'Skipping AI Verification (Background worker enabled)...', { sent: 0, responded: 0, total: 0 });
            // Union all remaining edges since we are bypassing AI verification.
            // Any false positives should already be excluded by the background worker.
            for (const [edgeId] of edges) {
                const [aStr, bStr] = edgeId.split('_');
                uf.union(parseInt(aStr), parseInt(bStr));
            }
        } else {
            aiRequests = 0;
            aiDuplicatesFound = 0;
            let aiResponded = 0;
            transitiveSkipped = 0;
            
            let aiEdgesToProcess = 0;
            for (const [, edge] of edges) {
                if (!edge.reasons || (!edge.reasons.includes('obvious_match') && !edge.reasons.includes('ai_cached_positive'))) {
                    aiEdgesToProcess++;
                }
            }
            
            const batchSize = 5;
            reportProgress('ai_verification', 'Phase 4: LLM Verification (AI Guardrail)...', { sent: aiRequests, responded: aiResponded, total: aiEdgesToProcess });

            for (let i = 0; i < edges.length; i += batchSize) {
                const batch = edges.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async ([edgeId, edge]) => {
                    const [aStr, bStr] = edgeId.split('_');
                const a = parseInt(aStr);
                const b = parseInt(bStr);
                
                try {
                    if (edge.reasons && (edge.reasons.includes('obvious_match') || edge.reasons.includes('ai_cached_positive'))) {
                        return; // Already unioned or cached positive
                    }
                    
                    // Optimization: Skip AI if already in the same component via transitive links
                    if (uf.find(a) === uf.find(b)) {
                        edge.reasons.push('transitive_match');
                        aiResponded++; // Mark as skipped/handled
                        transitiveSkipped++;
                        reportProgress('ai_verification', 'Waiting for AI responses...', { sent: aiRequests, responded: aiResponded, total: aiEdgesToProcess });
                        return;
                    }

                    const part1 = partById.get(a);
                    const part2 = partById.get(b);
                    aiRequests++;
                    reportProgress('ai_verification', 'Waiting for AI responses...', { sent: aiRequests, responded: aiResponded, total: aiEdgesToProcess });
                    const aiResult = await llmRouter.verifyDuplicate(part1, part2);
                    aiResponded++;
                    reportProgress('ai_verification', 'Waiting for AI responses...', { sent: aiRequests, responded: aiResponded, total: aiEdgesToProcess });
                    
                    // Handle both boolean (old) and object (new) returns safely
                    const isDuplicate = typeof aiResult === 'object' ? aiResult.isDuplicate : aiResult;
                    const isSkipped = typeof aiResult === 'object' ? aiResult.skipped : false;
                    const aiReason = typeof aiResult === 'object' ? aiResult.reason : null;
                    const aiModel = typeof aiResult === 'object' ? aiResult.model : null;
                    
                    const reasonText = aiReason ? `AI (${aiModel || 'LLM'}): ${aiReason}` : 'AI verification result';

                    // Cache the AI verdict universally in ai_match_cache
                    this.db.query(`
                        INSERT INTO ai_match_cache (part_id_1, part_id_2, is_duplicate, source, reason)
                        VALUES ($1, $2, $3, 'AI', $4)
                        ON CONFLICT (part_id_1, part_id_2) DO UPDATE 
                        SET is_duplicate = $3, source = 'AI', reason = $4
                    `, [Math.min(a, b), Math.max(a, b), isDuplicate, reasonText]).catch(err => {
                        console.error('Failed to cache AI verdict:', err);
                    });

                    if (!isDuplicate) {
                        edgeDetails.delete(edgeId);
                        adjacency.get(a).delete(b);
                        adjacency.get(b).delete(a);
                    } else {
                        uf.union(a, b);
                        if (!isSkipped) {
                            aiDuplicatesFound++;
                            edge.reasons.push('ai_verified');
                            if (aiReason) edge.ai_reason = aiReason;
                            if (aiModel) edge.ai_model = aiModel;
                        }
                    }
                } catch (error) {
                    console.error('LLM verification failed for edge, keeping it by default:', error);
                    uf.union(a, b);
                }
            }));
        }
        } // End of else block for skipAI

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
            const componentAiReasons = new Set();
            let aiModelUsed = null;

            for (const edgeId of edgeDetails.keys()) {
                const [aStr, bStr] = edgeId.split('_');
                const a = parseInt(aStr);
                const b = parseInt(bStr);
                if (!componentSet.has(a) || !componentSet.has(b)) continue;

                const edge = edgeDetails.get(edgeId);
                componentScores.push(edge.score);
                for (const reason of edge.reasons) componentReasons.add(reason);
                if (edge.ai_reason) componentAiReasons.add(edge.ai_reason);
                if (edge.ai_model) aiModelUsed = edge.ai_model;
            }

            if (componentScores.length === 0) continue;

            const averageScore = componentScores.reduce((sum, val) => sum + val, 0) / componentScores.length;
            const normalizedIds = [...componentIds].sort((a, b) => a - b).join('_');

            duplicateGroups.push({
                groupId: `component_${normalizedIds}`,
                score: averageScore,
                confidence: this.constructor.getConfidenceLevel(averageScore),
                reasons: Array.from(componentReasons),
                ai_reasons: Array.from(componentAiReasons),
                ai_model: aiModelUsed,
                parts: componentParts
            });
        }

        return {
            groups: duplicateGroups.sort((a, b) => b.score - a.score).slice(0, limit),
            stats: { aiRequests, aiDuplicatesFound, transitiveSkipped }
        };
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
            ORDER BY p.date_modified DESC
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
                limit: 10,
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
