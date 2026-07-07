/**
 * Service for routing LLM verification requests to different providers
 * Supported: Google Gemini, OpenAI, OpenRouter
 */
class LLMRouter {
    constructor() {
        this.provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();
        
        // Parse Google Gemini Keys
        const geminiPool = process.env.GEMINI_API_KEY_POOL || process.env.GEMINI_API_KEY || '';
        this.geminiKeys = geminiPool.split(',').map(k => k.trim()).filter(Boolean);
        this.geminiIndex = 0;
        this.geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

        // OpenAI settings
        this.openaiKey = process.env.OPENAI_API_KEY || '';
        this.openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        // OpenRouter settings
        this.openrouterKey = process.env.OPENROUTER_API_KEY || '';
        this.openrouterModel = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free';
    }

    async verifyDuplicate(part1, part2) {
        const formatPns = (pns) => {
            if (!pns || !Array.isArray(pns)) return 'None';
            return pns.map(p => typeof p === 'object' ? p.part_number : p).join(', ') || 'None';
        };

        const prompt = `You are an inventory deduplication agent.
Verify if these two descriptions refer to the EXACT same physical inventory item (e.g. same brand, size, specifications). 
Different colors, sizes, materials, or part numbers mean they are DISTINCT items.

Item 1:
Name: ${part1.display_name}
Detail: ${part1.detail || 'None'}
Brand: ${part1.brand_name || 'None'}
Part Numbers: ${formatPns(part1.part_numbers)}

Item 2:
Name: ${part2.display_name}
Detail: ${part2.detail || 'None'}
Brand: ${part2.brand_name || 'None'}
Part Numbers: ${formatPns(part2.part_numbers)}

Respond ONLY with a JSON object:
{
  "isDuplicate": boolean,
  "reason": "short explanation"
}`;

        switch (this.provider) {
            case 'openai':
                return this.callOpenAI(prompt);
            case 'openrouter':
                return this.callOpenRouter(prompt);
            case 'google':
            default:
                return this.callGemini(prompt);
        }
    }

    async callGemini(prompt) {
        if (this.geminiKeys.length === 0) {
            console.warn('No Gemini API keys found. Skipping AI verification.');
            return { isDuplicate: true, skipped: true, reason: 'Skipped - No Gemini API Key' };
        }

        const key = this.geminiKeys[this.geminiIndex];
        this.geminiIndex = (this.geminiIndex + 1) % this.geminiKeys.length; // Rotate keys

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${key}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API returned status ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const result = JSON.parse(text);
        return { isDuplicate: result.isDuplicate === true, reason: result.reason || '', provider: 'google', model: this.geminiModel };
    }

    async callOpenAI(prompt) {
        if (!this.openaiKey) {
            console.warn('No OpenAI API key found. Skipping AI verification.');
            return { isDuplicate: true, skipped: true, reason: 'Skipped - No OpenAI API Key' };
        }

        const url = 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.openaiKey}`
            },
            body: JSON.stringify({
                model: this.openaiModel,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API returned status ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        const result = JSON.parse(text);
        return { isDuplicate: result.isDuplicate === true, reason: result.reason || '', provider: 'openai', model: this.openaiModel };
    }

    async callOpenRouter(prompt) {
        if (!this.openrouterKey) {
            console.warn('No OpenRouter API key found. Skipping AI verification.');
            return { isDuplicate: true, skipped: true, reason: 'Skipped - No OpenRouter API Key' };
        }

        const url = 'https://openrouter.ai/api/v1/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.openrouterKey}`
            },
            body: JSON.stringify({
                model: this.openrouterModel,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API returned status ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        let text = data.choices?.[0]?.message?.content || '{}';
        
        // Clean markdown backticks if the model decided to format it as code
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error('OpenRouter JSON parse error. Raw text:', text);
            return { isDuplicate: true, skipped: true, reason: 'AI JSON parsing failed' };
        }
        
        return { isDuplicate: result.isDuplicate === true, reason: result.reason || '', provider: 'openrouter', model: this.openrouterModel };
    }
}

module.exports = new LLMRouter();
