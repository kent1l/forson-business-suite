/**
 * DeduplicationEngine
 *
 * Two-step AI-first deduplication:
 *   Step 1 — Blocking: Find candidate clusters using SQL (exact) and Meilisearch (fuzzy).
 *             This is fast and cheap — no AI involved.
 *   Step 2 — AI Group Analysis: Send each cluster to the LLM.
 *             The LLM sees the whole cluster and returns groups + reasons + confidence.
 *
 * Results are written to the duplicate_suggestion_group table.
 * The UI reads from that table — zero wait time.
 */

const crypto = require('crypto');
const { meiliClient } = require('../meilisearch');
const llmRouter = require('./llmRouter');

// Normalize a part number to alphanumeric uppercase for comparison
function normalizePartNumber(pn) {
    if (!pn) return '';
    return pn.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

class DeduplicationEngine {
    constructor(db) {
        this.db = db;
    }

    // ─────────────────────────────────────────────────────────────────
    // STEP 1A: SQL BLOCKING — Exact matches (free, no API calls)
    // ─────────────────────────────────────────────────────────────────

    /**
     * Finds parts that share the same normalized part number.
     * This catches: SC-47575R vs 47575R (both normalize to 47575R after stripping vendor prefix).
     *
     * NOTE: We normalize part numbers at query time using a simple regex-based strip.
     * The normalization logic here mirrors normalizePartNumber() above.
     *
     * Returns: Map<string, Set<number>>  (normalizedPartNumber → Set of part_ids)
     */
    async findExactPartNumberClusters() {
        // This query groups parts by their normalized part numbers.
        // REGEXP_REPLACE removes all non-alphanumeric characters then uppercases.
        const sql = `
            WITH normalized AS (
                SELECT
                    pn.part_id,
                    UPPER(REGEXP_REPLACE(pn.part_number, '[^a-zA-Z0-9]', '', 'g')) AS normalized_pn
                FROM part_number pn
                WHERE pn.deleted_at IS NULL
                  AND pn.part_number IS NOT NULL
                  -- Fix A: require at least 6 alphanumeric chars after normalization
                  -- This drops generic dimension tokens like '1', '12V', '10MM', '1000'
                  AND LENGTH(UPPER(REGEXP_REPLACE(pn.part_number, '[^a-zA-Z0-9]', '', 'g'))) >= 6
            ),
            duplicated_pns AS (
                SELECT normalized_pn
                FROM normalized
                GROUP BY normalized_pn
                HAVING COUNT(DISTINCT part_id) > 1
            )
            SELECT n.part_id, n.normalized_pn
            FROM normalized n
            JOIN duplicated_pns d ON n.normalized_pn = d.normalized_pn
            JOIN parts_view p ON n.part_id = p.part_id
            WHERE p.merged_into_part_id IS NULL
            ORDER BY n.normalized_pn, n.part_id
        `;
        const result = await this.db.query(sql);

        const clusters = new Map();
        for (const row of result.rows) {
            if (!clusters.has(row.normalized_pn)) {
                clusters.set(row.normalized_pn, new Set());
            }
            clusters.get(row.normalized_pn).add(row.part_id);
        }
        return clusters; // Each entry = one cluster of parts that share a part number
    }

    /**
     * Finds parts that share the same internal_sku.
     * Returns: Map<string, Set<number>>  (sku → Set of part_ids)
     */
    async findExactSkuClusters() {
        const sql = `
            SELECT internal_sku, ARRAY_AGG(part_id) AS part_ids
            FROM parts_view
            WHERE merged_into_part_id IS NULL
              AND internal_sku IS NOT NULL
              AND internal_sku != ''
            GROUP BY internal_sku
            HAVING COUNT(*) > 1
        `;
        const result = await this.db.query(sql);
        const clusters = new Map();
        for (const row of result.rows) {
            clusters.set(row.internal_sku, new Set(row.part_ids));
        }
        return clusters;
    }

    // ─────────────────────────────────────────────────────────────────
    // STEP 1B: MEILISEARCH BLOCKING — Fuzzy semantic blocking (cheap)
    // ─────────────────────────────────────────────────────────────────

    /**
     * For each part in the candidate set, searches Meilisearch for similar parts.
     * Parts that appear in each other's results form a cluster.
     *
     * @param {number[]} candidatePartIds - Part IDs to run fuzzy blocking on
     * @param {Map<number, Object>} partById - Already-loaded part data map
     * @returns {Array<Set<number>>} Array of candidate clusters (sets of part IDs)
     */
    async findFuzzyClusters(candidatePartIds, partById) {
        const index = meiliClient.index('parts');
        // adjacency[partId] = Set of part IDs that appeared in its Meili results
        const adjacency = new Map();

        for (const partId of candidatePartIds) {
            const part = partById.get(partId);
            if (!part) continue;
            const searchQuery = part.display_name || part.internal_sku || '';
            if (!searchQuery) continue;

            try {
                const searchRes = await index.search(searchQuery, {
                    limit: 15,                              // Increased from old value of 5
                    attributesToRetrieve: ['part_id']
                });

                for (const hit of searchRes.hits) {
                    const hitId = hit.part_id;
                    if (hitId === partId) continue; // Exclude self
                    if (!candidatePartIds.includes(hitId)) continue; // Only consider candidates we loaded
                    if (!adjacency.has(partId)) adjacency.set(partId, new Set());
                    if (!adjacency.has(hitId)) adjacency.set(hitId, new Set());
                    adjacency.get(partId).add(hitId);
                    adjacency.get(hitId).add(partId);    // Bidirectional
                }
            } catch (e) {
                console.error(`[DedupEngine] Meilisearch error for part ${partId}:`, e.message);
            }
        }

        // Extract connected components from the adjacency graph (BFS)
        const visited = new Set();
        const clusters = [];
        for (const startId of adjacency.keys()) {
            if (visited.has(startId)) continue;
            const cluster = new Set();
            const queue = [startId];
            while (queue.length > 0) {
                const curr = queue.shift();
                if (visited.has(curr)) continue;
                visited.add(curr);
                cluster.add(curr);
                for (const neighbor of (adjacency.get(curr) || [])) {
                    if (!visited.has(neighbor)) queue.push(neighbor);
                }
            }
            if (cluster.size >= 2 && cluster.size <= 50) {
                clusters.push(cluster);
            } else if (cluster.size > 50) {
                console.warn(`[DedupEngine] Skipping giant cluster of size ${cluster.size} (likely generic keyword connection)`);
            }
        }
        return clusters;
    }

    // ─────────────────────────────────────────────────────────────────
    // STEP 2: AI GROUP ANALYSIS
    // ─────────────────────────────────────────────────────────────────

    /**
     * Sends a cluster of parts to the LLM for group analysis.
     * Returns structured groups with confidence levels.
     *
     * @param {Object[]} parts - Full part objects for the cluster
     * @returns {Object[]} Array of group objects: { partIds, reason, confidence }
     */
    async analyzeClusterWithAI(parts) {
        // Check the ai_match_cache and part_exclusion tables first
        // to avoid re-asking the AI about pairs it already knows about
        const partIds = parts.map(p => p.part_id);

        // Load all known exclusions for parts in this cluster
        const exclusionRes = await this.db.query(`
            SELECT part_id_1, part_id_2
            FROM part_exclusion
            WHERE part_id_1 = ANY($1) OR part_id_2 = ANY($1)
        `, [partIds]);
        const exclusionPairs = new Set(exclusionRes.rows.map(r => `${r.part_id_1}_${r.part_id_2}`));

        const isExcluded = (id1, id2) => {
            const [a, b] = [id1, id2].sort((x, y) => x - y);
            return exclusionPairs.has(`${a}_${b}`);
        };

        // Call the AI
        const aiResult = await llmRouter.analyzeGroup(parts);
        if (aiResult.skipped) return [];

        // Filter out any groups that contain excluded pairs
        return aiResult.groups.filter(group => {
            for (let i = 0; i < group.partIds.length; i++) {
                for (let j = i + 1; j < group.partIds.length; j++) {
                    if (isExcluded(group.partIds[i], group.partIds[j])) return false;
                }
            }
            return true;
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // MAIN ENTRY POINT: Run full scan and populate suggestion table
    // ─────────────────────────────────────────────────────────────────

    /**
     * Runs a complete deduplication scan and writes results to
     * duplicate_suggestion_group table.
     *
     * @param {number} batchId - The batch ID to write results under
     * @param {Function} onProgress - Optional callback(message) for logging
     */
    async runFullScan(batchId, onProgress = () => {}) {

        // ── Load all active (non-merged) parts ───────────────────────
        onProgress('Loading parts catalog...');
        const partsResult = await this.db.query(`
            SELECT
                p.part_id, p.internal_sku, p.display_name, p.detail,
                p.brand_name, p.group_name,
                p.date_created as created_at, p.date_modified as modified_at,
                COALESCE(
                    (SELECT json_agg(jsonb_build_object('part_number', pn.part_number))
                     FROM part_number pn
                     WHERE pn.part_id = p.part_id AND pn.deleted_at IS NULL),
                '[]'::json) as part_numbers
            FROM parts_view p
            WHERE p.merged_into_part_id IS NULL
            ORDER BY p.part_id
        `);
        const allParts = partsResult.rows;
        const partById = new Map(allParts.map(p => [p.part_id, p]));
        const allPartIds = allParts.map(p => p.part_id);
        onProgress(`Loaded ${allParts.length} parts.`);

        // Track which suggestion group_keys already exist (to skip re-inserting)
        const existingKeysRes = await this.db.query(
            `SELECT group_key FROM duplicate_suggestion_group WHERE status = 'pending'`
        );
        const existingKeys = new Set(existingKeysRes.rows.map(r => r.group_key));

        const suggestionsToInsert = [];
        let aiCallsMade = 0;

        // ── EXACT BLOCKING ────────────────────────────────────────────
        onProgress('Phase 1: Finding exact part number matches...');
        const pnClusters = await this.findExactPartNumberClusters();
        const skuClusters = await this.findExactSkuClusters();

        // Collects cross-brand same-PN clusters to be routed to Phase 3 AI review
        const crossBrandClusters = [];

        // Brands that carry no meaningful identity — treat as neutral for brand comparison
        const NO_BRAND_TOKENS = new Set(['NO BRAND', 'UNKNOWN', 'GENERIC', 'N/A', 'NONE', '']);

        for (const [key, idSet] of [...pnClusters, ...skuClusters]) {
            const ids = [...idSet].sort((a, b) => a - b);
            const groupKey = crypto.createHash('sha256').update(ids.join(',')).digest('hex');
            if (existingKeys.has(groupKey)) continue;

            const parts = ids.map(id => partById.get(id)).filter(Boolean);
            if (parts.length < 2) continue;

            // 1. Compare if they belong to the same brand (unbranded/neutral brand tokens still pass)
            const meaningfulBrands = [...new Set(
                parts.map(p => (p.brand_name || '').trim().toUpperCase())
                     .filter(b => !NO_BRAND_TOKENS.has(b))
            )];

            // Prevent queuing to AI pairs that have the same part number and group but have distinct brand.
            if (meaningfulBrands.length > 1) {
                continue;
            }

            // 2. Compare if they belong to the same category/group
            const groupNames = [...new Set(
                parts.map(p => (p.group_name || '').trim().toUpperCase()).filter(Boolean)
            )];
            if (groupNames.length > 1) {
                console.warn(`[DedupEngine] Skipping cross-category exact match: ${groupNames.join(' vs ')} (PN: ${key})`);
                continue;
            }

            // 3. Compare exact match of part detail
            const details = [...new Set(
                parts.map(p => (p.detail || '').trim().toUpperCase())
            )];

            if (details.length === 1) {
                // Exact match of part number, brand, category, and detail -> Auto-promote to exact duplicate
                suggestionsToInsert.push({
                    batchId,
                    groupKey,
                    confidence: 'exact',
                    confidenceScore: 1.0,
                    detectionMethod: pnClusters.has(key) ? 'exact_part_number' : 'exact_sku',
                    aiReason: `Parts share the same normalized part number or SKU, brand, category, and detail: ${key}`,
                    partIds: ids,
                    partData: parts
                });
            } else {
                // Same brand, PN, and group, but differing details -> Queue for AI review
                crossBrandClusters.push(new Set(ids));
            }
        }
        onProgress(`Phase 1 complete. Found ${suggestionsToInsert.length} exact groups. ${crossBrandClusters.length} same-brand differing-detail clusters queued for AI review.`);

        // ── FUZZY BLOCKING + AI ANALYSIS ─────────────────────────────
        onProgress('Phase 2: Semantic blocking with Meilisearch...');
        // Only run fuzzy on parts NOT already in an exact cluster
        const exactPartIds = new Set([...pnClusters.values(), ...skuClusters.values()].flatMap(s => [...s]));
        const fuzzyPartIds = allPartIds.filter(id => !exactPartIds.has(id));

        let fuzzyClusters = [];
        try {
            fuzzyClusters = await this.findFuzzyClusters(fuzzyPartIds, partById);
            onProgress(`Phase 2 complete. Found ${fuzzyClusters.length} fuzzy candidate clusters.`);
        } catch (e) {
            console.error('[DedupEngine] Fuzzy blocking failed:', e.message);
            onProgress('Phase 2 failed (Meilisearch error). Continuing with exact matches only.');
        }

        // Fix B: merge cross-brand exact clusters into the AI analysis queue
        fuzzyClusters = [...fuzzyClusters, ...crossBrandClusters];

        // Update database with total clusters count to track progress in settings UI
        await this.db.query(
            "UPDATE public.duplicate_suggestion_batch SET total_clusters = $1 WHERE batch_id = $2",
            [fuzzyClusters.length, batchId]
        );

        // ── AI ANALYSIS per cluster ───────────────────────────────────
        // Includes both Meilisearch fuzzy clusters and cross-brand exact clusters (Fix B)
        onProgress(`Phase 3: AI group analysis on ${fuzzyClusters.length} clusters...`);
        for (let i = 0; i < fuzzyClusters.length; i++) {
            const cluster = fuzzyClusters[i];
            const parts = [...cluster].map(id => partById.get(id)).filter(Boolean);
            if (parts.length < 2) {
                // Update progress even if cluster is skipped
                await this.db.query(
                    "UPDATE public.duplicate_suggestion_batch SET processed_clusters = $1, ai_calls_made = $2 WHERE batch_id = $3",
                    [i + 1, aiCallsMade, batchId]
                );
                continue;
            }

            onProgress(`Phase 3: Analyzing cluster ${i + 1}/${fuzzyClusters.length} (${parts.length} parts)...`);

            try {
                // Split very large clusters into max-20-part chunks to stay within token limits
                const CHUNK_SIZE = 20;
                const chunks = [];
                for (let j = 0; j < parts.length; j += CHUNK_SIZE) {
                    chunks.push(parts.slice(j, j + CHUNK_SIZE));
                }

                for (const chunk of chunks) {
                    const aiGroups = await this.analyzeClusterWithAI(chunk);
                    aiCallsMade++;

                    for (const aiGroup of aiGroups) {
                        const ids = [...aiGroup.partIds].sort((a, b) => a - b);
                        const groupKey = crypto.createHash('sha256').update(ids.join(',')).digest('hex');
                        if (existingKeys.has(groupKey)) continue;

                        const groupParts = ids.map(id => partById.get(id)).filter(Boolean);
                        const scoreMap = { high: 0.85, medium: 0.65, low: 0.50 };

                        suggestionsToInsert.push({
                            batchId,
                            groupKey,
                            confidence: aiGroup.confidence,
                            confidenceScore: scoreMap[aiGroup.confidence] || 0.50,
                            detectionMethod: 'ai_semantic',
                            aiReason: aiGroup.reason,
                            partIds: ids,
                            partData: groupParts
                        });
                        existingKeys.add(groupKey); // Prevent duplicates in this run
                    }
                }
            } catch (e) {
                console.error(`[DedupEngine] AI analysis failed for cluster ${i + 1}:`, e.message);
                // Continue with next cluster — one failure should not stop the entire scan
            }

            // Update progress in database
            await this.db.query(
                "UPDATE public.duplicate_suggestion_batch SET processed_clusters = $1, ai_calls_made = $2 WHERE batch_id = $3",
                [i + 1, aiCallsMade, batchId]
            );

            // Small delay between AI calls to avoid rate limiting
            if (i < fuzzyClusters.length - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // ── WRITE RESULTS TO DB ───────────────────────────────────────
        onProgress(`Writing ${suggestionsToInsert.length} suggestions to database...`);
        for (const s of suggestionsToInsert) {
            await this.db.query(`
                INSERT INTO public.duplicate_suggestion_group
                    (batch_id, group_key, confidence, confidence_score, detection_method,
                     ai_reason, part_ids, part_data)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (group_key) DO NOTHING
            `, [
                s.batchId,
                s.groupKey,
                s.confidence,
                s.confidenceScore,
                s.detectionMethod,
                s.aiReason,
                s.partIds,
                JSON.stringify(s.partData)
            ]);
        }

        onProgress(`Scan complete. ${suggestionsToInsert.length} groups written. ${aiCallsMade} AI calls made.`);
        return { totalGroups: suggestionsToInsert.length, aiCallsMade };
    }
}

module.exports = DeduplicationEngine;
