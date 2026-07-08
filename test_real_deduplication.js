require('dotenv').config({ path: '.env' });
process.env.DB_HOST = '127.0.0.1';
process.env.MEILISEARCH_HOST = 'http://127.0.0.1:7700';
const db = require('./packages/api/db');
const DuplicateFinder = require('./packages/api/services/duplicateFinder');

async function run() {
    const df = new DuplicateFinder(db);
    try {
        console.log("Starting deduplication test...");
        const result = await df.findOptimizedDuplicateGroups({ 
            query: 'BP-HD-FRONT',
            limit: 10,
            progressCallback: (progress) => {
                const details = {...progress};
                delete details.stage;
                delete details.message;
                const detailsStr = Object.keys(details).length > 0 ? JSON.stringify(details) : '';
                console.log(`[Progress] ${progress.stage}: ${progress.message} ${detailsStr}`);
            }
        });
        console.log("Deduplication completed.");
        console.log(`Found ${result.groups.length} duplicate groups.`);
        console.log(`Stats:`, result.stats);
        
        result.groups.forEach((group, index) => {
            console.log(`\nGroup ${index + 1} (Score: ${group.score.toFixed(2)}, Confidence: ${group.confidence})`);
            console.log(`Reasons: ${group.reasons.join(', ')}`);
            if (group.ai_reasons && group.ai_reasons.length > 0) {
                console.log(`AI Reasons: ${group.ai_reasons.join(', ')}`);
            }
            group.parts.forEach(p => {
                console.log(`  - Part ${p.part_id}: ${p.display_name} (SKU: ${p.internal_sku})`);
                console.log(`    Detail: ${p.detail}`);
            });
        });
        
    } catch(err) {
        console.error("Error:", err);
    } finally {
        process.exit(0);
    }
}
run();
