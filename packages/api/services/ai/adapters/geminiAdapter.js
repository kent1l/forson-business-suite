const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const modelLoader = require('../core/modelLoader');
const schemaValidator = require('../core/schemaValidator');

class GeminiAdapter {
    constructor() {
        this.keyIndex = 0;
    }

    _getKeys() {
        let providerConfig = {};
        try {
            providerConfig = modelLoader.getProviderConfig('gemini');
        } catch {
            // Fallback if config not loaded yet
        }
        const keyEnvVar = providerConfig.api_key_env || 'GEMINI_API_KEY';
        const poolEnvVar = providerConfig.pool_env || 'GEMINI_API_KEY_POOL';

        const poolString = process.env[poolEnvVar] || process.env[keyEnvVar] || '';
        const keys = poolString.split(',').map(k => k.trim()).filter(Boolean);
        return keys;
    }

    _getNextKey() {
        const keys = this._getKeys();
        if (keys.length === 0) {
            throw new Error('No Gemini API keys configured (GEMINI_API_KEY or GEMINI_API_KEY_POOL)');
        }
        const key = keys[this.keyIndex % keys.length];
        this.keyIndex = (this.keyIndex + 1) % keys.length;
        return key;
    }

    async generateContent({ model, prompt, timeoutMs = 30000 }) {
        const key = this._getNextKey();
        let baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
        try {
            const providerConfig = modelLoader.getProviderConfig('gemini');
            if (providerConfig.base_url) baseUrl = providerConfig.base_url;
        } catch {
            // use default
        }

        const url = `${baseUrl}/models/${model}:generateContent?key=${key}`;

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
            const err = new Error(`Gemini API error (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
            err.status = response.status;
            err.responseText = responseText;
            throw err;
        }

        const rawJson = JSON.parse(responseText);
        const textContent = rawJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!textContent) {
            const err = new Error(`Empty response content from Gemini model ${model}`);
            err.status = 500;
            throw err;
        }

        const data = schemaValidator.parseJson(textContent);
        const usage = rawJson.usageMetadata || {};

        return {
            content: textContent,
            data,
            tokens: {
                promptTokens: usage.promptTokenCount || 0,
                completionTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0
            },
            modelUsed: model,
            providerUsed: 'gemini'
        };
    }
}

const geminiAdapterInstance = new GeminiAdapter();
module.exports = geminiAdapterInstance;
