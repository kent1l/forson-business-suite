/**
 * Low-level multi-provider LLM client.
 * Supports Google Gemini, OpenAI, and OpenRouter with automatic provider fallback,
 * API key pool rotation, and rate-limit backoff handling.
 */
class LLMClient {
    constructor() {
        this.provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();

        // Gemini Settings & API Key Pool
        const geminiPool = process.env.GEMINI_API_KEY_POOL || process.env.GEMINI_API_KEY || '';
        this.geminiKeys = geminiPool.split(',').map(k => k.trim()).filter(Boolean);
        this.geminiIndex = 0;
        this.geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

        // OpenAI Settings
        this.openaiKey = process.env.OPENAI_API_KEY || '';
        this.openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        // OpenRouter Settings
        this.openrouterKey = process.env.OPENROUTER_API_KEY || '';
        this.openrouterModel = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct';
    }

    /**
     * Executes a prompt returning structured JSON.
     */
    async generateJSON(prompt, timeoutMs = 25000) {
        if (this.provider === 'openai') {
            return this._callOpenAIJSON(prompt, timeoutMs);
        } else if (this.provider === 'openrouter') {
            return this._callOpenRouterJSON(prompt, timeoutMs);
        } else {
            return this._callGeminiJSON(prompt, timeoutMs);
        }
    }

    /**
     * Internal Google Gemini call
     */
    async _callGeminiJSON(prompt, timeoutMs, retries = 3) {
        if (this.geminiKeys.length === 0) {
            throw new Error('No Gemini API keys configured');
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            const key = this.geminiKeys[this.geminiIndex];
            this.geminiIndex = (this.geminiIndex + 1) % this.geminiKeys.length;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${key}`;

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

                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        console.warn(`[LLMClient] Gemini 429 Rate Limit. Retrying in ${attempt * 2}s...`);
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
                }

                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) throw new Error('Empty response candidate from Gemini');

                let parsed;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                    parsed = JSON.parse(cleaned);
                }

                return { data: parsed, provider: 'google', model: this.geminiModel };
            } catch (error) {
                console.error(`[LLMClient] Gemini attempt ${attempt} failed:`, error.message);
                if (attempt === retries) throw error;
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }
    }

    /**
     * Internal OpenAI call
     */
    async _callOpenAIJSON(prompt, timeoutMs, retries = 3) {
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
                        console.warn(`[LLMClient] OpenAI 429 Rate Limit. Retrying in ${attempt * 2}s...`);
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

    /**
     * Internal OpenRouter call with candidate model rotation
     */
    async _callOpenRouterJSON(prompt, timeoutMs) {
        if (!this.openrouterKey) throw new Error('No OpenRouter API key configured');

        const modelsToTry = Array.from(new Set([
            this.openrouterModel,
            'meta-llama/llama-3.3-70b-instruct',
            'google/gemini-2.5-flash',
            'deepseek/deepseek-chat',
            'qwen/qwen-2.5-coder-32b-instruct'
        ])).filter(Boolean);

        let lastError = null;
        for (const modelCandidate of modelsToTry) {
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.openrouterKey}`,
                        'HTTP-Referer': 'http://localhost:5173',
                        'X-Title': 'Forson Business Suite',
                        'Content-Type': 'application/json'
                    },
                    signal: AbortSignal.timeout(timeoutMs),
                    body: JSON.stringify({
                        model: modelCandidate,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    })
                });

                if (!response.ok) {
                    throw new Error(`OpenRouter API status ${response.status}: ${await response.text()}`);
                }

                const data = await response.json();
                let text = data.choices?.[0]?.message?.content || '{}';
                text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                const parsedData = JSON.parse(text);
                return { data: parsedData, provider: 'openrouter', model: modelCandidate };
            } catch (err) {
                console.warn(`[LLMClient] OpenRouter attempt with model ${modelCandidate} failed: ${err.message}`);
                lastError = err;
            }
        }

        throw lastError || new Error('All OpenRouter model attempts failed');
    }
}

module.exports = new LLMClient();
