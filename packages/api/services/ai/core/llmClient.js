const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const aiCache = require('./aiCache');
const modelConfig = require('./modelConfig');

/**
 * Advanced multi-provider LLM client with tier-based routing, automatic fallback cascade,
 * dynamic deprecation/rate-limit tracking, and in-memory caching.
 */
class LLMClient {
    constructor() {
        this.provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();

        // Gemini Settings & API Key Pool
        const geminiPool = process.env.GEMINI_API_KEY_POOL || process.env.GEMINI_API_KEY || '';
        this.geminiKeys = geminiPool.split(',').map(k => k.trim()).filter(Boolean);
        this.geminiIndex = 0;
        this.geminiModel = modelConfig.providers.google.defaultModel;

        // OpenAI Settings
        this.openaiKey = process.env.OPENAI_API_KEY || '';
        this.openaiModel = modelConfig.providers.openai.defaultModel;

        // OpenRouter Settings
        this.openrouterKey = process.env.OPENROUTER_API_KEY || '';
        this.openrouterModel = modelConfig.providers.openrouter.defaultModel;

        // Gemini Tier Map
        this.geminiTiers = modelConfig.providers.google.tiers;

        // OpenRouter Fallback Model Chain
        this.openrouterChain = [
            this.openrouterModel,
            ...modelConfig.providers.openrouter.fallbackChain
        ].filter((item, index, self) => item && self.indexOf(item) === index);

        // State Tracking for Health & Deprecation
        this.deprecatedModels = new Set();
        this.rateLimitedUntil = new Map(); // model -> timestamp
    }

    /**
     * Refresh environment variables from process.env if needed dynamically.
     */
    _refreshConfig() {
        const geminiPool = process.env.GEMINI_API_KEY_POOL || process.env.GEMINI_API_KEY || '';
        this.geminiKeys = geminiPool.split(',').map(k => k.trim()).filter(Boolean);
        this.openaiKey = process.env.OPENAI_API_KEY || '';
        this.openrouterKey = process.env.OPENROUTER_API_KEY || '';
    }

    /**
     * Executes a prompt returning structured JSON.
     * @param {string} prompt
     * @param {Object|number} options Options object or timeoutMs number for backwards compatibility.
     */
    async generateJSON(prompt, options = {}) {
        this._refreshConfig();
        const timeoutMs = typeof options === 'number' ? options : (options.timeoutMs || 30000);
        const tier = typeof options === 'object' && options.tier ? options.tier.toUpperCase() : 'ROUTINE';
        const useCache = typeof options === 'object' && options.useCache !== undefined ? options.useCache : true;

        // 1. Check in-memory cache
        if (useCache) {
            const cached = aiCache.get(prompt, tier);
            if (cached) {
                return { data: cached, provider: 'cache', model: 'in-memory-cache' };
            }
        }

        let lastError = null;

        // 2. Attempt Google Gemini Direct API if keys are available
        if (this.geminiKeys.length > 0) {
            try {
                const res = await this._callGeminiTierJSON(prompt, tier, timeoutMs);
                if (useCache && res?.data) aiCache.set(prompt, tier, res.data);
                return res;
            } catch (err) {
                console.warn(`[LLMClient] Direct Gemini tier ${tier} failed: ${err.message}. Cascading to fallback providers...`);
                lastError = err;
            }
        }

        // 3. Fallback Provider 1: OpenRouter
        if (this.openrouterKey) {
            try {
                const res = await this._callOpenRouterJSON(prompt, timeoutMs);
                if (useCache && res?.data) aiCache.set(prompt, tier, res.data);
                return res;
            } catch (err) {
                console.warn(`[LLMClient] OpenRouter fallback failed: ${err.message}. Cascading to OpenAI...`);
                lastError = err;
            }
        }

        // 4. Fallback Provider 2: OpenAI
        if (this.openaiKey) {
            try {
                const res = await this._callOpenAIJSON(prompt, timeoutMs);
                if (useCache && res?.data) aiCache.set(prompt, tier, res.data);
                return res;
            } catch (err) {
                console.error(`[LLMClient] OpenAI fallback failed: ${err.message}`);
                lastError = err;
            }
        }

        throw lastError || new Error('All configured LLM providers and models failed');
    }

    /**
     * Executes prompt across Gemini models in specified tier cascade.
     */
    async _callGeminiTierJSON(prompt, tier, timeoutMs) {
        const candidates = (this.geminiTiers[tier] || this.geminiTiers.ROUTINE).filter(
            m => !this.deprecatedModels.has(m)
        );

        if (candidates.length === 0) {
            throw new Error(`No active Gemini models remaining in tier ${tier}`);
        }

        const now = Date.now();
        let lastError = null;

        for (const modelCandidate of candidates) {
            // Skip if currently rate-limited (temporary backoff)
            const coolOffUntil = this.rateLimitedUntil.get(modelCandidate);
            if (coolOffUntil && coolOffUntil > now) {
                console.warn(`[LLMClient] Skipping rate-limited model ${modelCandidate} (cool-off active)`);
                continue;
            }

            const key = this.geminiKeys[this.geminiIndex];
            this.geminiIndex = (this.geminiIndex + 1) % this.geminiKeys.length;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelCandidate}:generateContent?key=${key}`;

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(timeoutMs),
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { responseMimeType: 'application/json' }
                    })
                });

                const responseText = await response.text();

                if (!response.ok) {
                    if (response.status === 429 || responseText.includes('RESOURCE_EXHAUSTED') || responseText.includes('Quota exceeded')) {
                        console.warn(`[LLMClient] Gemini model ${modelCandidate} rate-limited/quota exhausted (429). Setting 60s backoff.`);
                        this.rateLimitedUntil.set(modelCandidate, Date.now() + 60000); // 60s backoff
                        continue;
                    }

                    if (response.status === 404 || responseText.includes('NOT_FOUND') || responseText.includes('is not found') || responseText.includes('deprecated')) {
                        console.error(`[LLMClient] Gemini model ${modelCandidate} deprecated or unsupported (HTTP ${response.status}). Removing from model list.`);
                        this.deprecatedModels.add(modelCandidate);
                        continue;
                    }

                    throw new Error(`Gemini model ${modelCandidate} error ${response.status}: ${responseText.substring(0, 150)}`);
                }

                const data = JSON.parse(responseText);
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) throw new Error(`Empty response candidate from Gemini model ${modelCandidate}`);

                let parsed;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                    parsed = JSON.parse(cleaned);
                }

                return { data: parsed, provider: 'google', model: modelCandidate };
            } catch (err) {
                console.warn(`[LLMClient] Gemini attempt with ${modelCandidate} failed: ${err.message}`);
                lastError = err;
            }
        }

        throw lastError || new Error(`All Gemini models in tier ${tier} failed or rate-limited`);
    }

    /**
     * Internal OpenRouter call with model candidate fallback chain
     */
    async _callOpenRouterJSON(prompt, timeoutMs) {
        if (!this.openrouterKey) throw new Error('No OpenRouter API key configured');

        let lastError = null;
        for (const modelCandidate of this.openrouterChain) {
            if (this.deprecatedModels.has(modelCandidate)) continue;

            const now = Date.now();
            const coolOffUntil = this.rateLimitedUntil.get(modelCandidate);
            if (coolOffUntil && coolOffUntil > now) continue;

            try {
                const effectiveTimeout = Math.max(
                    timeoutMs || 30000,
                    modelCandidate === 'openrouter/free' ? 45000 : 25000
                );

                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.openrouterKey}`,
                        'HTTP-Referer': 'http://localhost:5173',
                        'X-Title': 'Forson Business Suite',
                        'Content-Type': 'application/json'
                    },
                    signal: AbortSignal.timeout(effectiveTimeout),
                    body: JSON.stringify({
                        model: modelCandidate,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    })
                });

                const responseText = await response.text();

                if (!response.ok) {
                    if (response.status === 429) {
                        this.rateLimitedUntil.set(modelCandidate, Date.now() + 60000);
                        continue;
                    }

                    if (response.status === 404 || responseText.includes('not found') || responseText.includes('does not exist')) {
                        console.error(`[LLMClient] OpenRouter model ${modelCandidate} deprecated/not found. Removing.`);
                        this.deprecatedModels.add(modelCandidate);
                        continue;
                    }

                    throw new Error(`OpenRouter API status ${response.status}: ${responseText.substring(0, 150)}`);
                }

                const data = JSON.parse(responseText);
                let text = data.choices?.[0]?.message?.content || '{}';
                text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                const parsedData = JSON.parse(text);

                return { data: parsedData, provider: 'openrouter', model: modelCandidate };
            } catch (err) {
                console.warn(`[LLMClient] OpenRouter attempt with model ${modelCandidate} failed: ${err.message}`);
                lastError = err;
            }
        }

        throw lastError || new Error('All OpenRouter candidate models failed');
    }

    /**
     * Internal OpenAI call
     */
    async _callOpenAIJSON(prompt, timeoutMs, retries = 2) {
        if (!this.openaiKey) throw new Error('No OpenAI API key configured');
        const url = 'https://api.openai.com/v1/chat/completions';

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiKey}`
                    },
                    signal: AbortSignal.timeout(timeoutMs),
                    body: JSON.stringify({
                        model: this.openaiModel,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    })
                });

                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
                }

                const data = await response.json();
                const text = data.choices?.[0]?.message?.content || '{}';
                return { data: JSON.parse(text), provider: 'openai', model: this.openaiModel };
            } catch (error) {
                console.error(`[LLMClient] OpenAI attempt ${attempt} failed:`, error.message);
                if (attempt === retries) throw error;
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }
    }
}

module.exports = new LLMClient();
