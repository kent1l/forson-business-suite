const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const db = require('../db');
const { embeddingLoader, embeddingClient } = require('../services/ai');

async function verifyEmbeddings() {
    console.log('====================================================');
    console.log('   pgvector & Embedding Pool Verification Suite');
    console.log('====================================================\n');

    // 1. Verify PostgreSQL pgvector extension
    console.log('[1/3] Verifying PostgreSQL pgvector extension status...');
    try {
        const extRes = await db.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'");
        if (extRes.rows.length === 0) {
            console.warn('⚠️ pgvector extension is not installed in PostgreSQL. Attempting to enable...');
            await db.query('CREATE EXTENSION IF NOT EXISTS vector;');
            console.log('✓ pgvector extension enabled successfully.');
        } else {
            console.log(`✓ pgvector extension active (version: ${extRes.rows[0].extversion})`);
        }
    } catch (err) {
        console.error('❌ Database connection or pgvector check failed:', err.message);
        process.exit(1);
    }

    // 2. Generate test vector using Cascading Embedding Pool
    const testInput = 'Shell diesel for delivery van';
    console.log(`\n[2/3] Generating test vector embedding for: "${testInput}"...`);

    let embResult;
    try {
        const config = embeddingLoader.loadConfig();
        console.log(`✓ Config Loaded: Pool [default_embedding_pool], Target Dimensions [${config.pools.default_embedding_pool.dimensions}]`);

        const start = Date.now();
        embResult = await embeddingClient.generateEmbeddingWithPool(testInput);
        const duration = Date.now() - start;

        console.log(`✓ SUCCESS: Embedding generated in ${duration}ms`);
        console.log(`  Provider Used: ${embResult.provider}`);
        console.log(`  Model Used: ${embResult.model}`);
        console.log(`  Dimensions: ${embResult.dimensions}`);
        console.log(`  Vector snippet (first 5 elements): [${embResult.vector.slice(0, 5).map(v => v.toFixed(4)).join(', ')}, ...]`);

        if (!Array.isArray(embResult.vector) || embResult.vector.length !== 768) {
            throw new Error(`Expected vector dimension of 768, got ${embResult.vector ? embResult.vector.length : 0}`);
        }
    } catch (err) {
        console.error('❌ Embedding generation failed:', err.message);
        process.exit(1);
    }

    // 3. Perform test similarity search using pgvector cosine distance (<=>)
    console.log('\n[3/3] Performing pgvector cosine similarity search (<=>)...');
    try {
        const vectorJson = JSON.stringify(embResult.vector);

        // Ensure table has at least one seed correction record for testing if empty
        const countRes = await db.query('SELECT COUNT(*)::integer AS cnt FROM expense_ai_correction');
        if (countRes.rows[0].cnt === 0) {
            console.log('Notice: expense_ai_correction table is empty. Inserting test seed record with embedding...');
            await db.query(
                `INSERT INTO expense_ai_correction (raw_input, corrected_category, corrected_data, embedding)
                 VALUES ($1, $2, $3, $4)`,
                [
                    testInput,
                    'Transportation & Delivery',
                    JSON.stringify({ category: 'Transportation & Delivery', amount: 1500, payee: 'Shell' }),
                    vectorJson
                ]
            );
        }

        const searchQuery = `
            SELECT correction_id, raw_input, corrected_category, corrected_data,
                   (embedding <=> $1) AS cosine_distance
            FROM expense_ai_correction
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> $1
            LIMIT 3
        `;

        const searchRes = await db.query(searchQuery, [vectorJson]);
        console.log(`✓ Similarity query returned ${searchRes.rows.length} result(s):`);
        searchRes.rows.forEach((row, idx) => {
            console.log(`  [${idx + 1}] ID: ${row.correction_id} | Input: "${row.raw_input || 'N/A'}" | Category: "${row.corrected_category || 'N/A'}" | Cosine Distance: ${parseFloat(row.cosine_distance).toFixed(4)}`);
        });

    } catch (err) {
        console.error('❌ Similarity search failed:', err.message);
        process.exit(1);
    }

    console.log('\n====================================================');
    console.log('   pgvector & Embedding Verification PASSED');
    console.log('====================================================');
    process.exit(0);
}

verifyEmbeddings().catch(err => {
    console.error('Fatal Verification Error:', err);
    process.exit(1);
});
