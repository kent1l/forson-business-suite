const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const aiCache = require('./aiCache');
const modelLoader = require('./modelLoader');
const circuitBreaker = require('./circuitBreaker');
const schemaValidator = require('./schemaValidator');

const geminiAdapter = require('../adapters/geminiAdapter');
const groqAdapter = require('../adapters/groqAdapter');
const openRouterAdapter = require('../adapters/openRouterAdapter');

/**
 * Task-Specific Model Pool LLM Execution Engine
 * Supports declarative fallback chains, provider rate-limit cooling,
 * circuit breaker tracking, and structured JSON output validation.
 */
class LLMClient {
    constructor() {
        this.providerAdapters = {
            gemini: geminiAdapter,
            groq: groqAdapter,
            openrouter: openRouterAdapter
        };

        // Expose circuitBreaker state for backwards compatibility
        this.deprecatedModels = circuitBreaker.deprecatedModels;
        this.rateLimitedUntil = circuitBreaker.rateLimitedUntil;

        // Legacy tier mappings for backwards compatibility
        this.geminiTiers = {
            ROUTINE: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
            REASONING: ['gemini-3.6-flash', 'gemini-3.5-flash'],
            MICRO: ['gemma-4-31b', 'gemma-4-26b']
        };
    }

    get provider() {
        return (process.env.LLM_PROVIDER || 'google').toLowerCase();
    }

    get geminiKeys() {
        const pool = process.env.GEMINI_API_KEY_POOL || process.env.GEMINI_API_KEY || '';
        return pool.split(',').map(k => k.trim()).filter(Boolean);
    }

    get geminiIndex() {
        return geminiAdapter.keyIndex;
    }

    set geminiIndex(idx) {
        geminiAdapter.keyIndex = idx;
    }

    get geminiModel() {
        return 'gemini-3.5-flash-lite';
    }

    get openaiKey() {
        return process.env.OPENAI_API_KEY || '';
    }

    get openaiModel() {
        return 'gpt-4o-mini';
    }

    get openrouterKey() {
        return process.env.OPENROUTER_API_KEY || '';
    }

    get openrouterModel() {
        return 'openrouter/free';
    }

    /**
     * Executes prompt using a specified model pool configured in ai-models.yaml.
     * 
     * @param {string} poolName Name of the pool defined in ai-models.yaml (e.g. 'expense_parser_pool')
     * @param {Object|string} optionsOrPrompt Prompt string or options object
     * @param {Object} [extraOptions] Options if prompt was passed as second argument
     */
    async executeWithPool(poolName, optionsOrPrompt, extraOptions = {}) {
        let prompt;
        let schema;
        let timeoutMs = 30000;
        let useCache = true;
        let cacheKey = poolName;

        if (typeof optionsOrPrompt === 'string') {
            prompt = optionsOrPrompt;
            schema = extraOptions.schema;
            if (typeof extraOptions.timeoutMs === 'number') timeoutMs = extraOptions.timeoutMs;
            if (typeof extraOptions.useCache === 'boolean') useCache = extraOptions.useCache;
            if (extraOptions.cacheKey) cacheKey = extraOptions.cacheKey;
            else if (extraOptions.tier) cacheKey = extraOptions.tier;
        } else if (typeof optionsOrPrompt === 'object' && optionsOrPrompt !== null) {
            prompt = optionsOrPrompt.prompt;
            schema = optionsOrPrompt.schema;
            if (typeof optionsOrPrompt.timeoutMs === 'number') timeoutMs = optionsOrPrompt.timeoutMs;
            if (typeof optionsOrPrompt.useCache === 'boolean') useCache = optionsOrPrompt.useCache;
            if (optionsOrPrompt.cacheKey) cacheKey = optionsOrPrompt.cacheKey;
            else if (optionsOrPrompt.tier) cacheKey = optionsOrPrompt.tier;
        } else {
            throw new Error('Prompt must be specified for executeWithPool');
        }

        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Prompt is required and must be a string');
        }

        // 1. Check in-memory prompt response cache
        if (useCache) {
            let cachedData = aiCache.get(prompt, cacheKey);
            if (!cachedData && cacheKey !== poolName) {
                cachedData = aiCache.get(prompt, poolName);
            }
            if (cachedData) {
                return {
                    data: cachedData,
                    content: JSON.stringify(cachedData),
                    provider: 'cache',
                    providerUsed: 'cache',
                    model: 'in-memory-cache',
                    modelUsed: 'in-memory-cache',
                    tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
                };
            }
        }

        // 2. Load pool configuration
        const poolConfig = modelLoader.getPoolConfig(poolName);
        const fallbackChain = poolConfig.fallback_chain || [];

        let lastError = null;

        // 3. Iterate through fallback chain candidates
        for (const candidate of fallbackChain) {
            const providerName = (candidate.provider || '').toLowerCase();
            const model = candidate.model;

            if (!providerName || !model) continue;

            // Check Circuit Breaker status
            if (circuitBreaker.isDeprecated(providerName, model)) {
                console.warn(`[llmClient] Skipping deprecated model ${providerName}:${model}`);
                continue;
            }

            if (circuitBreaker.isCoolingDown(providerName, model)) {
                console.warn(`[llmClient] Skipping cooling down model ${providerName}:${model}`);
                continue;
            }

            const adapter = this.providerAdapters[providerName];
            if (!adapter) {
                console.warn(`[llmClient] No adapter registered for provider '${providerName}'`);
                continue;
            }

            try {
                const res = await adapter.generateContent({ model, prompt, timeoutMs });
                const validatedData = schemaValidator.validate(res.data, schema);

                // Cache successful result
                if (useCache && validatedData) {
                    aiCache.set(prompt, cacheKey, validatedData);
                    if (cacheKey !== poolName) {
                        aiCache.set(prompt, poolName, validatedData);
                    }
                }

                return {
                    data: validatedData,
                    content: res.content,
                    tokens: res.tokens,
                    modelUsed: res.modelUsed,
                    providerUsed: res.providerUsed,
                    model: res.modelUsed,
                    provider: res.providerUsed
                };
            } catch (err) {
                lastError = err;
                console.warn(`[llmClient] Candidate ${providerName}:${model} in pool '${poolName}' failed: ${err.message}`);

                const errMessage = (err.message || '').toLowerCase();
                const errText = (err.responseText || '').toLowerCase();
                const is429 = err.status === 429 || errMessage.includes('429') || errText.includes('quota exceeded') || errText.includes('resource_exhausted');
                const is5xx = err.status >= 500 || errMessage.includes('500') || errMessage.includes('503') || errMessage.includes('504');
                const is404 = err.status === 404 || errMessage.includes('404') || errText.includes('not_found') || errText.includes('deprecated');

                if (is404) {
                    circuitBreaker.markDeprecated(providerName, model);
                } else if (is429 || is5xx) {
                    circuitBreaker.triggerCooldown(providerName, model, 60000);
                } else {
                    // Default temporary backoff on execution error
                    circuitBreaker.triggerCooldown(providerName, model, 30000);
                }
            }
        }

        throw new Error(`All model candidates in pool '${poolName}' failed. Last error: ${lastError ? lastError.message : 'No active candidates'}`);
    }

    /**
     * Backward-compatible JSON generation entry point.
     * Maps legacy options/tier requests into task-specific pools.
     */
    async generateJSON(prompt, options = {}) {
        let poolName = 'expense_parser_pool';
        let timeoutMs = 30000;
        let useCache = true;
        let schema = null;
        let tier = 'ROUTINE';

        if (typeof options === 'number') {
            timeoutMs = options;
        } else if (typeof options === 'object' && options !== null) {
            if (options.tier) tier = String(options.tier).toUpperCase();
            if (options.pool) {
                poolName = options.pool;
            } else if (tier === 'REASONING') {
                poolName = 'expense_reasoning_pool';
            }
            if (typeof options.timeoutMs === 'number') timeoutMs = options.timeoutMs;
            if (typeof options.useCache === 'boolean') useCache = options.useCache;
            if (options.schema) schema = options.schema;
        }

        return this.executeWithPool(poolName, { prompt, schema, timeoutMs, useCache, tier, cacheKey: tier });
    }
}

const llmClientInstance = new LLMClient();
module.exports = llmClientInstance;
