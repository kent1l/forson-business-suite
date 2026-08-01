const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const { modelLoader, llmClient, circuitBreaker, expenseParserAI, partDeduplicationAI } = require('../services/ai');
const geminiAdapter = require('../services/ai/adapters/geminiAdapter');
const groqAdapter = require('../services/ai/adapters/groqAdapter');
const openRouterAdapter = require('../services/ai/adapters/openRouterAdapter');

async function runComprehensiveVerification() {
    console.log('================================================================');
    console.log('   TASK-SPECIFIC MODEL POOLS: FULL USAGE SIMULATION & TEST');
    console.log('================================================================\n');

    const config = modelLoader.loadConfig();

    // -------------------------------------------------------------
    // PART 1: TEST ALL INDIVIDUAL MODEL CANDIDATES ACROSS PROVIDERS
    // -------------------------------------------------------------
    console.log('>>> SECTION 1: Testing Every Configured Model Candidate directly...\n');

    const adapters = {
        gemini: geminiAdapter,
        groq: groqAdapter,
        openrouter: openRouterAdapter
    };

    const prompt = 'Respond strictly with valid JSON: {"model_status": "active", "timestamp": ' + Date.now() + '}';

    for (const [poolName, poolConfig] of Object.entries(config.pools)) {
        console.log(`Pool [${poolName}] candidates:`);
        for (const candidate of poolConfig.fallback_chain) {
            const { provider, model } = candidate;
            const adapter = adapters[provider];
            process.stdout.write(`  - Testing ${provider}:${model} ... `);
            try {
                const res = await adapter.generateContent({ model, prompt, timeoutMs: 35000 });
                console.log(`✅ PASSED (${res.providerUsed}) -> Output: ${JSON.stringify(res.data)}`);
            } catch (err) {
                console.log(`❌ SKIPPED/FAILED -> ${err.message}`);
            }
        }
        console.log('');
    }

    // Reset circuit breaker after direct model candidate tests
    circuitBreaker.reset();

    // -------------------------------------------------------------
    // PART 2: SIMULATE ACTUAL FEATURE USAGE (REAL POOLS & FEATURES)
    // -------------------------------------------------------------
    console.log('>>> SECTION 2: Simulating Expected Actual Production Feature Usage...\n');

    // Scenario A: Expense Parser AI (Natural Language Expense Input)
    console.log('[Scenario A] expenseParserAI.parseExpenseText (Target Pool: expense_parser_pool)');
    const sampleText = 'Bought 5 liters of Petron Rev-X 15W-40 engine oil for 1850 pesos paid via GCash to Petron Express Store yesterday';
    console.log(`  Input Text: "${sampleText}"`);

    try {
        const start = Date.now();
        const parseResult = await expenseParserAI.parseExpenseText(sampleText);
        const duration = Date.now() - start;
        console.log(`  ✅ SUCCESS in ${duration}ms (Provider used: ${parseResult.provider})`);
        console.log('  Parsed Data Structure:');
        console.log('   ', JSON.stringify(parseResult.parsed, null, 2).replace(/\n/g, '\n    '));
    } catch (err) {
        console.error(`  ❌ Scenario A FAILED: ${err.message}`);
    }
    console.log('');

    circuitBreaker.reset();

    // Scenario B: Escalation Scenario to expense_reasoning_pool
    console.log('[Scenario B] Forcing Escalation to expense_reasoning_pool (Ambiguous Expense String)');
    const ambiguousText = 'misc store payment 450';
    console.log(`  Input Text: "${ambiguousText}"`);

    try {
        const start = Date.now();
        const parseResult = await expenseParserAI.parseExpenseText(ambiguousText);
        const duration = Date.now() - start;
        console.log(`  ✅ SUCCESS in ${duration}ms (Provider used: ${parseResult.provider})`);
        console.log('  Parsed Data Structure:');
        console.log('   ', JSON.stringify(parseResult.parsed, null, 2).replace(/\n/g, '\n    '));
    } catch (err) {
        console.error(`  ❌ Scenario B FAILED: ${err.message}`);
    }
    console.log('');

    circuitBreaker.reset();

    // Scenario C: Part Deduplication AI - Single Pair Verification
    console.log('[Scenario C] partDeduplicationAI.verifyDuplicate (Target Pool: part_deduplication_pool)');
    const part1 = {
        display_name: 'Oil Filter C-110',
        detail: 'Toyota Corolla 4AFE 1.6 Engine Oil Filter',
        brand_name: 'Vic',
        part_numbers: [{ part_number: 'C-110' }, { part_number: '90915-10001' }]
    };
    const part2 = {
        display_name: 'VIC Oil Filter C110',
        detail: 'Oil filter for Toyota 1.6L 4AFE',
        brand_name: 'VIC',
        part_numbers: ['C-110']
    };
    console.log(`  Comparing: "${part1.display_name}" vs "${part2.display_name}"`);

    try {
        const start = Date.now();
        const dedupResult = await partDeduplicationAI.verifyDuplicate(part1, part2);
        const duration = Date.now() - start;
        console.log(`  ✅ SUCCESS in ${duration}ms (Provider: ${dedupResult.provider}, Model: ${dedupResult.model})`);
        console.log(`  Result -> isDuplicate: ${dedupResult.isDuplicate}, Reason: "${dedupResult.reason}"`);
    } catch (err) {
        console.error(`  ❌ Scenario C FAILED: ${err.message}`);
    }
    console.log('');

    circuitBreaker.reset();

    // Scenario D: Part Deduplication AI - Cluster Group Analysis
    console.log('[Scenario D] partDeduplicationAI.analyzeGroup (Target Pool: part_deduplication_pool)');
    const clusterParts = [
        { part_id: 101, display_name: 'Brake Pad Front D2174', detail: 'Honda Civic 2016-2021 Front Brake Pads', brand_name: 'Akebono', part_numbers: ['AN-654K'] },
        { part_id: 102, display_name: 'Akebono Front Brake Pads Civic', detail: 'Civic 2016-2020 Front Disc Pads', brand_name: 'Akebono', part_numbers: ['AN-654K'] },
        { part_id: 103, display_name: 'Brake Pad Rear D2175', detail: 'Honda Civic 2016-2021 Rear Brake Pads', brand_name: 'Akebono', part_numbers: ['AN-655K'] },
        { part_id: 104, display_name: 'Spark Plug BKR6E-11', detail: 'NGK V-Power Spark Plug', brand_name: 'NGK', part_numbers: ['2756'] }
    ];
    console.log(`  Analyzing cluster of ${clusterParts.length} inventory records...`);

    try {
        const start = Date.now();
        const groupResult = await partDeduplicationAI.analyzeGroup(clusterParts);
        const duration = Date.now() - start;
        console.log(`  ✅ SUCCESS in ${duration}ms`);
        console.log('  Detected Duplicate Groups:');
        console.log('   ', JSON.stringify(groupResult, null, 2).replace(/\n/g, '\n    '));
    } catch (err) {
        console.error(`  ❌ Scenario D FAILED: ${err.message}`);
    }
    console.log('');

    circuitBreaker.reset();

    // -------------------------------------------------------------
    // PART 3: SIMULATE CROSS-PROVIDER FALLBACK IN ACTUAL POOL USAGE
    // -------------------------------------------------------------
    console.log('>>> SECTION 3: Simulating Primary Provider Failover in Actual Features...\n');

    console.log('Simulating cooldown on ALL Gemini candidates (Primary provider outage)...');
    circuitBreaker.triggerCooldown('gemini', 'gemini-3.5-flash-lite', 60000);
    circuitBreaker.triggerCooldown('gemini', 'gemini-3.6-flash', 60000);

    try {
        console.log('Executing expenseParserAI.parseExpenseText under simulated primary outage...');
        const failoverResult = await expenseParserAI.parseExpenseText('Bought 2 air filters for 800 pesos');
        console.log(`  ✅ FAILOVER SUCCESS: Successfully processed via fallback provider [${failoverResult.provider}]!`);
        console.log(`  Notes: "${failoverResult.parsed.notes}", Amount: ₱${failoverResult.parsed.amount}`);
    } catch (err) {
        console.error(`  ❌ Failover test failed: ${err.message}`);
    } finally {
        circuitBreaker.reset();
    }

    console.log('\n================================================================');
    console.log('   Comprehensive Verification & Simulation Complete');
    console.log('================================================================');
}

runComprehensiveVerification().catch(err => {
    console.error('Fatal Simulation Error:', err);
    process.exit(1);
});
