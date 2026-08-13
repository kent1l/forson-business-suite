const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const embeddingLoader = require('./embeddingLoader');
const circuitBreaker = require('./circuitBreaker');

class EmbeddingClient {
    constructor() {
        this.keyIndices = new Map();
    }

    _getKey(envVarName) {
        const val = process.env[envVarName] || '';
        const keys = val.split(',').map(k => k.trim()).filter(Boolean);
        if (keys.length === 0) return null;

        const index = this.keyIndices.get(envVarName) || 0;
        const key = keys[index % keys.length];
        this.keyIndices.set(envVarName, (index + 1) % keys.length);
        return key;
    }

    /**
     * Executes HTTP request to provider endpoint to get vector representation of text.
     */
    async _callProviderEmbedding(candidate, text, targetDim = 768, timeoutMs = 15000) {
        const { provider, model, api_key_env, dimensions_override } = candidate;
        const envVar = api_key_env || (provider === 'gemini' ? 'GEMINI_API_KEY' : provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY');
        const apiKey = this._getKey(envVar);

        if (!apiKey) {
            const err = new Error(`Missing API key in environment variable '${envVar}' for provider '${provider}'`);
            err.status = 401;
            throw err;
        }

        let vector = null;

        if (provider === 'gemini') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(timeoutMs),
                body: JSON.stringify({
                    content: {
                        parts: [{ text }]
                    },
                    // gemini-embedding-001/2 both support this directly (Matryoshka
                    // truncation done server-side) — without it Gemini returns its full
                    // native 3072-dim vector and we were previously slicing it down
                    // client-side, which worked by luck but wasted bandwidth and bypassed
                    // Google's own supported reduction path.
                    outputDimensionality: dimensions_override || targetDim
                })
            });

            const textResponse = await response.text();
            if (!response.ok) {
                const err = new Error(`Gemini Embedding API error (HTTP ${response.status}): ${textResponse.substring(0, 200)}`);
                err.status = response.status;
                throw err;
            }

            const json = JSON.parse(textResponse);
            vector = json.embedding?.values || json.embedding?.value;
        } else if (provider === 'openrouter') {
            const url = 'https://openrouter.ai/api/v1/embeddings';
            const bodyObj = {
                model,
                input: text
            };
            // Only send `dimensions` when a candidate explicitly declares it supports
            // dimension reduction (dimensions_override). Some OpenRouter embedding
            // models (e.g. the nvidia/*:free tier) have a fixed native output size and
            // reject any `dimensions` value that doesn't match it — sending our pool's
            // default target unconditionally made those candidates fail on every call.
            if (dimensions_override) {
                bodyObj.dimensions = dimensions_override;
            }
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://forson-business-suite.local',
                    'X-Title': 'Forson Business Suite'
                },
                signal: AbortSignal.timeout(timeoutMs),
                body: JSON.stringify(bodyObj)
            });

            const textResponse = await response.text();
            if (!response.ok) {
                const err = new Error(`OpenRouter Embedding API error (HTTP ${response.status}): ${textResponse.substring(0, 200)}`);
                err.status = response.status;
                throw err;
            }

            const json = JSON.parse(textResponse);
            vector = json.data?.[0]?.embedding;
        } else if (provider === 'openai') {
            const url = 'https://api.openai.com/v1/embeddings';
            const bodyObj = {
                model,
                input: text,
                dimensions: dimensions_override || targetDim
            };
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                signal: AbortSignal.timeout(timeoutMs),
                body: JSON.stringify(bodyObj)
            });

            const textResponse = await response.text();
            if (!response.ok) {
                const err = new Error(`OpenAI Embedding API error (HTTP ${response.status}): ${textResponse.substring(0, 200)}`);
                err.status = response.status;
                throw err;
            }

            const json = JSON.parse(textResponse);
            vector = json.data?.[0]?.embedding;
        } else {
            throw new Error(`Unsupported embedding provider: ${provider}`);
        }

        if (!Array.isArray(vector) || vector.length === 0) {
            const err = new Error(`No embedding vector returned by ${provider}/${model}`);
            err.status = 500;
            throw err;
        }

        // Adjust vector dimensions to targetDim if needed. Truncating a LONGER vector
        // is safe for cosine-distance search (pgvector's <=> operator normalizes by
        // magnitude, so dropping trailing components changes precision, not
        // correctness) and matches how Gemini/OpenAI's own Matryoshka-trained models
        // are designed to be shortened. A vector coming back SHORTER than requested is
        // a different situation — there is no valid way to invent the missing
        // components, so zero-padding would silently store a degraded vector next to
        // full-quality ones in the same column. That candidate is treated as failed
        // instead, so the caller falls through to the next provider in the chain.
        if (vector.length > targetDim) {
            vector = vector.slice(0, targetDim);
        } else if (vector.length < targetDim) {
            const err = new Error(
                `${provider}/${model} returned a ${vector.length}-dim vector, shorter than the required ${targetDim} dims`
            );
            err.status = 502;
            throw err;
        }

        return vector;
    }

    /**
     * Cascading embedding generator.
     */
    async generateEmbeddingWithPool(text, poolName = 'default_embedding_pool', options = {}) {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Input text for embedding must be a non-empty string');
        }

        const poolConfig = embeddingLoader.getPoolConfig(poolName);
        const targetDimensions = poolConfig.dimensions || 768;
        const fallbackChain = poolConfig.fallback_chain;

        const errors = [];

        for (const candidate of fallbackChain) {
            const { provider, model } = candidate;

            if (circuitBreaker.isCoolingDown(provider, model) || circuitBreaker.isDeprecated(provider, model)) {
                console.warn(`[EmbeddingClient] Skipping ${provider}:${model} - in cooldown or deprecated`);
                continue;
            }

            try {
                const vector = await this._callProviderEmbedding(
                    candidate,
                    text,
                    targetDimensions,
                    options.timeoutMs || 15000
                );
                return {
                    vector,
                    provider,
                    model,
                    dimensions: vector.length
                };
            } catch (err) {
                console.warn(`[EmbeddingClient] Failed embedding generation with ${provider}:${model}: ${err.message}`);
                errors.push({ provider, model, error: err.message, status: err.status });

                if (err.status === 429 || (err.status >= 500 && err.status <= 599)) {
                    circuitBreaker.triggerCooldown(provider, model, 60000);
                } else if (err.status === 404) {
                    circuitBreaker.markDeprecated(provider, model);
                }
            }
        }

        const combinedMsg = errors.map(e => `[${e.provider}/${e.model}: ${e.error}]`).join(', ');
        throw new Error(`All embedding providers failed for pool '${poolName}'. Details: ${combinedMsg}`);
    }
}

const embeddingClientInstance = new EmbeddingClient();
module.exports = embeddingClientInstance;
