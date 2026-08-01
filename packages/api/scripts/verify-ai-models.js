const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const { modelLoader, llmClient, circuitBreaker } = require('../services/ai');

async function verifyAIModels() {
    console.log('====================================================');
    console.log('   Task-Specific Model Pool Verification Suite');
    console.log('====================================================\n');

    // 1. Verify Configuration Loading
    console.log('[1/4] Loading ai-models.yaml configuration...');
    let config;
    try {
        config = modelLoader.loadConfig();
        console.log(`✓ YAML Config Loaded Successfully (version ${config.version})`);
        console.log(`  Configured Providers: ${Object.keys(config.providers).join(', ')}`);
        console.log(`  Configured Pools: ${Object.keys(config.pools).join(', ')}\n`);
    } catch (err) {
        console.error('❌ Failed to load ai-models.yaml:', err.message);
        process.exit(1);
    }

    const testPrompt = 'Return a valid JSON object: {"status": "ok", "message": "Verification test"}';

    // 2. Test Execution across all pools
    console.log('[2/4] Testing Model Pool Executions...');
    const pools = Object.keys(config.pools);

    for (const poolName of pools) {
        console.log(`\n--- Testing Pool: [${poolName}] ---`);
        const poolConfig = config.pools[poolName];
        console.log(`Description: ${poolConfig.description || 'N/A'}`);
        console.log(`Fallback Chain: ${poolConfig.fallback_chain.map(c => `${c.provider}:${c.model}`).join(' -> ')}`);

        try {
            const start = Date.now();
            const res = await llmClient.executeWithPool(poolName, { prompt: testPrompt, timeoutMs: 15000, useCache: false });
            const duration = Date.now() - start;
            console.log(`✓ SUCCESS: Executed via Provider [${res.providerUsed}] Model [${res.modelUsed}] in ${duration}ms`);
            console.log(`  Output Data: ${JSON.stringify(res.data)}`);
        } catch (err) {
            console.warn(`⚠️ POOL FAILED: ${poolName} - ${err.message}`);
        }
    }

    // 3. Test Circuit Breaker & Fallback Chain Escalation
    console.log('\n[3/4] Testing Circuit Breaker Cooldown & Fallback Cascade...');
    const targetPool = 'expense_parser_pool';
    const fallbackChain = config.pools[targetPool].fallback_chain;

    if (fallbackChain.length >= 2) {
        const primaryCandidate = fallbackChain[0];
        console.log(`Simulating 429 Rate Limit Cooldown on Primary Candidate [${primaryCandidate.provider}:${primaryCandidate.model}]...`);
        circuitBreaker.triggerCooldown(primaryCandidate.provider, primaryCandidate.model, 60000);

        try {
            const res = await llmClient.executeWithPool(targetPool, { prompt: testPrompt, timeoutMs: 15000, useCache: false });
            console.log(`✓ SUCCESS: Skipped cooling candidate and failed over to [${res.providerUsed}] Model [${res.modelUsed}]`);
        } catch (err) {
            console.warn(`⚠️ Fallback execution failed: ${err.message}`);
        } finally {
            circuitBreaker.reset();
        }
    } else {
        console.log('Skipping fallback cascade test (less than 2 candidates in pool)');
    }

    // 4. Test Backward Compatibility
    console.log('\n[4/4] Testing LLMClient Backward Compatibility (generateJSON)...');
    try {
        const res = await llmClient.generateJSON('{"test": true}', { tier: 'ROUTINE' });
        console.log(`✓ SUCCESS: generateJSON routine call returned from provider [${res.provider}] model [${res.model}]`);
    } catch (err) {
        console.warn(`⚠️ generateJSON test failed: ${err.message}`);
    }

    console.log('\n====================================================');
    console.log('   Verification Complete');
    console.log('====================================================');
}

verifyAIModels().catch(err => {
    console.error('Fatal Verification Error:', err);
    process.exit(1);
});
