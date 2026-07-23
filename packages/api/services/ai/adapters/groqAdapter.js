const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const modelLoader = require('../core/modelLoader');
const schemaValidator = require('../core/schemaValidator');

class GroqAdapter {
    _getApiKey() {
        let keyEnv = 'GROQ_API_KEY';
        try {
            const providerConfig = modelLoader.getProviderConfig('groq');
            if (providerConfig.api_key_env) keyEnv = providerConfig.api_key_env;
        } catch {
            // fallback
        }
        return process.env[keyEnv] || '';
    }

    async generateContent({ model, prompt, timeoutMs = 30000 }) {
        const apiKey = this._getApiKey();
        if (!apiKey) {
            const err = new Error('No Groq API key configured (GROQ_API_KEY)');
            err.status = 401;
            throw err;
        }

        let baseUrl = 'https://api.groq.com/openai/v1';
        try {
            const providerConfig = modelLoader.getProviderConfig('groq');
            if (providerConfig.base_url) baseUrl = providerConfig.base_url;
        } catch {
            // use default
        }

        const url = `${baseUrl}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });

        const responseText = await response.text();

        if (!response.ok) {
            const err = new Error(`Groq API error (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
            err.status = response.status;
            err.responseText = responseText;
            throw err;
        }

        const rawJson = JSON.parse(responseText);
        const textContent = rawJson.choices?.[0]?.message?.content || '';
        if (!textContent) {
            const err = new Error(`Empty response content from Groq model ${model}`);
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
            providerUsed: 'groq'
        };
    }
}

const groqAdapterInstance = new GroqAdapter();
module.exports = groqAdapterInstance;
