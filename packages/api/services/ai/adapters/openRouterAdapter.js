const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const modelLoader = require('../core/modelLoader');
const schemaValidator = require('../core/schemaValidator');

class OpenRouterAdapter {
    _getApiKey() {
        let keyEnv = 'OPENROUTER_API_KEY';
        try {
            const providerConfig = modelLoader.getProviderConfig('openrouter');
            if (providerConfig.api_key_env) keyEnv = providerConfig.api_key_env;
        } catch {
            // fallback
        }
        return process.env[keyEnv] || '';
    }

    async generateContent({ model, prompt, timeoutMs = 30000 }) {
        const apiKey = this._getApiKey();
        if (!apiKey) {
            const err = new Error('No OpenRouter API key configured (OPENROUTER_API_KEY)');
            err.status = 401;
            throw err;
        }

        let baseUrl = 'https://openrouter.ai/api/v1';
        try {
            const providerConfig = modelLoader.getProviderConfig('openrouter');
            if (providerConfig.base_url) baseUrl = providerConfig.base_url;
        } catch {
            // use default
        }

        const effectiveTimeout = Math.max(
            timeoutMs,
            model === 'openrouter/free' ? 45000 : 25000
        );

        const url = `${baseUrl}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'http://localhost:5173',
                'X-Title': 'Forson Business Suite',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(effectiveTimeout),
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });

        const responseText = await response.text();

        if (!response.ok) {
            const err = new Error(`OpenRouter API error (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
            err.status = response.status;
            err.responseText = responseText;
            throw err;
        }

        const rawJson = JSON.parse(responseText);
        const textContent = rawJson.choices?.[0]?.message?.content || '';
        if (!textContent) {
            const err = new Error(`Empty response content from OpenRouter model ${model}`);
            err.status = 500;
            throw err;
        }

        const data = schemaValidator.parseJson(textContent);
        const usage = rawJson.usage || {};

        return {
            content: textContent,
            data,
            tokens: {
                promptTokens: usage.prompt_tokens || 0,
                completionTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0
            },
            modelUsed: model,
            providerUsed: 'openrouter'
        };
    }
}

const openRouterAdapterInstance = new OpenRouterAdapter();
module.exports = openRouterAdapterInstance;
