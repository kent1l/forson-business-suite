const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const modelLoader = require('../core/modelLoader');
const schemaValidator = require('../core/schemaValidator');

/**
 * Direct DeepSeek adapter for controlled, low-cost paid batch work and the
 * final interactive fallback. It intentionally uses the provider's current
 * `deepseek-flash` model rather than OpenRouter's legacy deepseek-chat alias.
 */
class DeepSeekAdapter {
    _getProviderConfig() {
        try {
            return modelLoader.getProviderConfig('deepseek');
        } catch {
            return {};
        }
    }

    async generateContent({ model, prompt, timeoutMs = 30000, temperature, max_tokens, reasoning_effort }) {
        const providerConfig = this._getProviderConfig();
        const apiKey = process.env[providerConfig.api_key_env || 'DEEPSEEK_API_KEY'] || '';
        if (!apiKey) {
            const err = new Error('No DeepSeek API key configured (DEEPSEEK_API_KEY)');
            err.status = 401;
            throw err;
        }

        const baseUrl = providerConfig.base_url || 'https://api.deepseek.com';
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
                // DeepSeek enables thinking by default. Routine JSON extraction
                // should disable it to prevent hidden reasoning-token spend.
                ...(reasoning_effort === 'none' ? { thinking: { type: 'disabled' } } : {}),
                ...(reasoning_effort && reasoning_effort !== 'none' ? { reasoning_effort } : {}),
                ...(typeof temperature === 'number' && reasoning_effort === 'none' ? { temperature } : {}),
                ...(typeof max_tokens === 'number' ? { max_tokens } : {})
            })
        });

        const responseText = await response.text();
        if (!response.ok) {
            const err = new Error(`DeepSeek API error (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
            err.status = response.status;
            err.responseText = responseText;
            throw err;
        }

        const rawJson = JSON.parse(responseText);
        const textContent = rawJson.choices?.[0]?.message?.content || '';
        if (!textContent) {
            const err = new Error(`Empty response content from DeepSeek model ${model}`);
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
            providerUsed: 'deepseek'
        };
    }
}

module.exports = new DeepSeekAdapter();
