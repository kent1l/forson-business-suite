const { Pool } = require('pg');
const llmRouter = require('./services/llmRouter');
const DuplicateFinder = require('./services/duplicateFinder');
require('dotenv').config({ path: '../../.env' }); // Adjust for potential execution paths

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'forson_business_suite',
});

const meiliHost = process.env.MEILISEARCH_HOST || 'http://localhost:7700';
const meiliKey = process.env.MEILISEARCH_MASTER_KEY || '';

// Delay helper
const delay = ms => new Promise(res => setTimeout(res, ms));

async function getPartById(partId) {
    const res = await pool.query(`
        SELECT p.*,
               COALESCE(
                   (SELECT json_agg(jsonb_build_object('part_number', pn.part_number))
                    FROM part_number pn
                    WHERE pn.part_id = p.part_id AND pn.deleted_at IS NULL),
               '[]'::json) as part_numbers_array
        FROM parts_view p
        WHERE p.part_id = $1 AND p.merged_into_part_id IS NULL
    `, [partId]);
    return res.rows[0];
}

async function findCandidates(part) {
    const candidates = new Map();

    // 1. Deterministic (Same SKU)
    if (part.internal_sku) {
        const skuRes = await pool.query(`
            SELECT p.*,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object('part_number', pn.part_number))
                        FROM part_number pn
                        WHERE pn.part_id = p.part_id AND pn.deleted_at IS NULL),
                   '[]'::json) as part_numbers_array
            FROM parts_view p
            WHERE p.internal_sku = $1 AND p.part_id != $2 AND p.merged_into_part_id IS NULL
        `, [part.internal_sku, part.part_id]);
        
        for (const row of skuRes.rows) {
            candidates.set(row.part_id, { part: row, baseScore: 0.8 });
        }
    }

    // 2. Fuzzy Meilisearch
    if (part.display_name) {
        try {
            const msRes = await fetch(`${meiliHost}/indexes/parts/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${meiliKey}`
                },
                body: JSON.stringify({
                    q: part.display_name,
                    limit: 10,
                    filter: `part_id != ${part.part_id}`
                })
            });
            if (msRes.ok) {
                const msData = await msRes.json();
                for (const hit of msData.hits) {
                    if (!candidates.has(hit.part_id)) {
                        const hitPart = await getPartById(hit.part_id);
                        if (hitPart) {
                            candidates.set(hit.part_id, { part: hitPart, baseScore: 0.4 });
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Meilisearch fetch error:', e.message);
        }
    }

    return Array.from(candidates.values());
}

async function processNextPart() {
    // 1. Get next part
    const res = await pool.query(`
        SELECT part_id FROM public.dedupe_scan_queue
        WHERE status = 'pending'
        ORDER BY updated_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED
    `);

    if (res.rowCount === 0) return false;
    const partId = res.rows[0].part_id;

    await pool.query(`UPDATE public.dedupe_scan_queue SET status = 'processing' WHERE part_id = $1`, [partId]);

    try {
        const sourcePart = await getPartById(partId);
        if (!sourcePart) {
            // Part was deleted or merged
            await pool.query(`DELETE FROM public.dedupe_scan_queue WHERE part_id = $1`, [partId]);
            return true;
        }

        const candidates = await findCandidates(sourcePart);
        const exclusionsRes = await pool.query('SELECT part_id_1, part_id_2 FROM part_exclusion');
        const exclusions = new Set(exclusionsRes.rows.map(r => `${r.part_id_1}_${r.part_id_2}`));

        for (const candidate of candidates) {
            const targetPart = candidate.part;
            const [a, b] = [sourcePart.part_id, targetPart.part_id].sort((x, y) => x - y);
            const pairId = `${a}_${b}`;

            if (exclusions.has(pairId)) continue;

            const { score } = DuplicateFinder.calculateCompositeScore(sourcePart, targetPart, candidate.baseScore);
            
            // Only verify if score is high enough but not guaranteed (e.g., above 0.5)
            if (score >= 0.5) {
                console.log(`[DedupeWorker] Verifying edge ${pairId} (Score: ${score})...`);
                
                try {
                    const aiResult = await llmRouter.verifyDuplicate(sourcePart, targetPart);
                    const isDuplicate = typeof aiResult === 'object' ? aiResult.isDuplicate : aiResult;
                    const aiReason = typeof aiResult === 'object' ? aiResult.reason : null;
                    const aiModel = typeof aiResult === 'object' ? aiResult.model : 'LLM';
                    
                    if (!isDuplicate) {
                        const reasonText = aiReason ? `AI (${aiModel}): ${aiReason}` : 'AI determined parts are not duplicates (Background)';
                        await pool.query(`
                            INSERT INTO part_exclusion (part_id_1, part_id_2, source, reason)
                            VALUES ($1, $2, 'AI', $3)
                            ON CONFLICT (part_id_1, part_id_2) DO UPDATE 
                            SET source = 'AI', reason = $3
                        `, [a, b, reasonText]);
                        console.log(`[DedupeWorker] Marked ${pairId} as exclusion.`);
                    } else {
                        console.log(`[DedupeWorker] AI confirmed ${pairId} is a positive match. Discarding per design.`);
                    }
                } catch (e) {
                    console.error(`[DedupeWorker] AI verification failed for ${pairId}:`, e.message);
                }

                // Strictly wait 10 seconds between AI calls to avoid rate limits
                await delay(10000); 
            }
        }
    } catch (e) {
        console.error(`[DedupeWorker] Error processing part ${partId}:`, e);
    } finally {
        // Delete from queue when done
        await pool.query(`DELETE FROM public.dedupe_scan_queue WHERE part_id = $1`, [partId]);
    }

    return true;
}

async function startWorker() {
    console.log('[DedupeWorker] Starting Dedupe Scan Background Worker...');
    
    while (true) {
        try {
            const processed = await processNextPart();
            if (!processed) {
                // Queue is empty, wait 60 seconds
                await delay(60000);
            } else {
                // Wait 1 second before next part
                await delay(1000);
            }
        } catch (e) {
            console.error('[DedupeWorker] Worker loop error:', e);
            await delay(10000);
        }
    }
}

function init() {
    startWorker();
}

module.exports = {
    init
};

if (require.main === module) {
    init();
}
