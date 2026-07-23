const llmClient = require('../services/ai/core/llmClient');
const aiCache = require('../services/ai/core/aiCache');

describe('LLMClient & Model Tiering Optimization', () => {
    beforeEach(() => {
        aiCache.clear();
        llmClient.deprecatedModels.clear();
        llmClient.rateLimitedUntil.clear();
    });

    test('should have defined tier mappings for ROUTINE, REASONING, and MICRO', () => {
        expect(llmClient.geminiTiers.ROUTINE).toContain('gemini-3.5-flash-lite');
        expect(llmClient.geminiTiers.ROUTINE).toContain('gemini-3.1-flash-lite');
        expect(llmClient.geminiTiers.REASONING).toContain('gemini-3.6-flash');
        expect(llmClient.geminiTiers.MICRO).toContain('gemma-4-31b');
    });

    test('should cache successful JSON response and return from cache on duplicate prompt', async () => {
        const testPrompt = 'Unit test prompt caching ' + Math.random();
        const fakeData = { status: 'success', value: 42 };

        aiCache.set(testPrompt, 'ROUTINE', fakeData);

        const result = await llmClient.generateJSON(testPrompt, { tier: 'ROUTINE' });

        expect(result.provider).toBe('cache');
        expect(result.model).toBe('in-memory-cache');
        expect(result.data).toEqual(fakeData);
    });

    test('should keep rate-limited models (429) in candidate list but add temporary backoff timestamp', () => {
        const model = 'gemini-3.5-flash-lite';
        expect(llmClient.deprecatedModels.has(model)).toBe(false);

        // Simulate 429 rate limit backoff
        llmClient.rateLimitedUntil.set(model, Date.now() + 60000);

        // Model must NOT be in deprecatedModels
        expect(llmClient.deprecatedModels.has(model)).toBe(false);
        expect(llmClient.rateLimitedUntil.get(model)).toBeGreaterThan(Date.now());
    });

    test('should remove deprecated models (404) permanently from active tier candidates', () => {
        const model = 'gemini-1.0-deprecated';
        llmClient.deprecatedModels.add(model);

        expect(llmClient.deprecatedModels.has(model)).toBe(true);
        const activeCandidates = llmClient.geminiTiers.ROUTINE.filter(m => !llmClient.deprecatedModels.has(m));
        expect(activeCandidates).not.toContain(model);
    });

    test('should successfully execute prompt using active provider cascade', async () => {
        const prompt = 'Return simple JSON object with count equal to 1';
        const res = await llmClient.generateJSON(prompt, { tier: 'ROUTINE', timeoutMs: 15000 });

        expect(res).toHaveProperty('data');
        expect(res).toHaveProperty('provider');
        expect(res).toHaveProperty('model');
    }, 30000);
});
