const { Pool } = require('pg');
require('dotenv').config({ path: 'packages/api/.env' });
const DuplicateFinder = require('./packages/api/services/duplicateFinder');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/forson_business_suite'
});

async function getPartById(partId) {
    const res = await pool.query('SELECT * FROM part WHERE part_id = $1 AND deleted_at IS NULL', [partId]);
    return res.rows[0];
}

async function run() {
    try {
        console.log('Fetching remaining dedupe_scan_queue...');
        const res = await pool.query('SELECT part_id FROM dedupe_scan_queue WHERE status = $1', ['pending']);
        const pendingParts = res.rows.map(r => r.part_id);
        console.log(`Found ${pendingParts.length} pending parts to evaluate.`);

        let aiVerificationNeeded = 0;
        let pairsNeeded = new Set();

        const cacheRes = await pool.query('SELECT part_id_1, part_id_2, is_duplicate FROM ai_match_cache');
        const aiCache = new Map(cacheRes.rows.map(r => [`${r.part_id_1}_${r.part_id_2}`, r.is_duplicate]));

        for (let i = 0; i < pendingParts.length; i++) {
            const partId = pendingParts[i];
            if (i % 100 === 0 && i > 0) process.stdout.write(`.` );
            
            const sourcePart = await getPartById(partId);
            if (!sourcePart) continue;

            const duplicateFinder = new DuplicateFinder(pool);
            const candidates = await duplicateFinder.findCandidates(sourcePart);

            for (const candidate of candidates) {
                const targetPart = candidate.part;
                const [a, b] = [sourcePart.part_id, targetPart.part_id].sort((x, y) => x - y);
                const pairId = `${a}_${b}`;

                if (aiCache.has(pairId)) continue; 

                const { score, reasons } = DuplicateFinder.calculateCompositeScore(sourcePart, targetPart, candidate.baseScore);
                
                if (score >= 0.95 && reasons.includes('obvious_match')) {
                    continue;
                }

                if (score >= 0.5) {
                    pairsNeeded.add(pairId);
                }
            }
        }

        console.log(`\n\nDONE!`);
        console.log(`Actual number of unique PAIRS that need AI Verification: ${pairsNeeded.size}`);
        
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
