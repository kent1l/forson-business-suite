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
            signal: AbortSignal.timeout(30000),
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
            signal: AbortSignal.timeout(30000),
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

    async callOpenRouter(prompt, retries = 3, overrideModel = null, useFallback = true) {
        const modelToUse = overrideModel || this.openrouterModel;
        
        if (!modelToUse) {
            return { isDuplicate: true, skipped: true, reason: 'No OpenRouter model configured' };
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'HTTP-Referer': 'http://localhost:5173',
                        'X-Title': 'Forson Business Suite',
                        'Content-Type': 'application/json'
                    },
                    signal: AbortSignal.timeout(30000),
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    })
                });

                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        console.warn(`OpenRouter 429 Rate Limit. Retrying in ${attempt * 2}s...`);
                        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                        continue;
                    }
                    throw new Error(`OpenRouter API returned status ${response.status}: ${await response.text()}`);
                }

                const responseText = await response.text();
                if (!responseText.trim()) {
                    throw new Error('OpenRouter returned empty response body');
                }

                let data;
                try {
                    data = JSON.parse(responseText);
                } catch (e) {
                    throw new Error('OpenRouter response body was not valid JSON');
                }

                let text = data.choices?.[0]?.message?.content || '{}';
                
                // Clean markdown backticks if the model decided to format it as code
                text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                
                let result;
                try {
                    result = JSON.parse(text);
                } catch (e) {
                    console.error('OpenRouter inner JSON parse error. Raw text:', text);
                    return { isDuplicate: true, skipped: true, reason: 'AI JSON parsing failed' };
                }
                
                return { isDuplicate: result.isDuplicate === true, reason: result.reason || '', provider: 'openrouter', model: modelToUse };
            } catch (error) {
                console.error(`OpenRouter Attempt ${attempt} failed with model ${modelToUse}:`, error.message);
                if (attempt === retries) {
                    if (useFallback && process.env.OPENROUTER_FALLBACK_MODEL) {
                        console.warn(`Primary model failed after ${retries} attempts. Falling back to secondary model: ${process.env.OPENROUTER_FALLBACK_MODEL}`);
                        return this.callOpenRouter(prompt, retries, process.env.OPENROUTER_FALLBACK_MODEL, false);
                    }
                    return { isDuplicate: true, skipped: true, reason: `AI failed: ${error.message}` };
                }
                await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            }
        }
    }
    /**
     * Analyzes a cluster of candidate parts and groups them into duplicate sets.
     * This is the primary detection method — replaces pair-by-pair verification.
     *
     * @param {Array} parts - Array of part objects (up to 20)
     * @returns {Object} { groups: [{ partIds: [], reason: '', confidence: 'high'|'medium'|'low' }] }
     */
    async analyzeGroup(parts) {
        // Format each part into a clean text block for the AI
        const formatPart = (p, index) => {
            const pns = (p.part_numbers || [])
                .map(pn => typeof pn === 'object' ? pn.part_number : pn)
                .join(', ') || 'None';
            return [
                `[Part ${index + 1}] ID: ${p.part_id}`,
                `  Name: ${p.display_name || 'N/A'}`,
                `  Detail: ${p.detail || 'N/A'}`,
                `  Brand: ${p.brand_name || 'N/A'}`,
                `  Group/Category: ${p.group_name || 'N/A'}`,
                `  SKU: ${p.internal_sku || 'N/A'}`,
                `  Part Numbers: ${pns}`,
            ].join('\n');
        };

        const partsList = parts.map(formatPart).join('\n\n');
        const partIds = parts.map(p => p.part_id);

        const prompt = `You are an automotive parts inventory deduplication expert.

You will be given a list of parts from an inventory system. Your job is to identify which parts are the SAME physical item that was entered more than once (duplicates), and group them together.

IMPORTANT RULES:
1. Different sizes, specs, or voltages (e.g., 12V vs 24V, 15/16 vs 1") = DIFFERENT items. Do NOT group them.
2. Different brands (e.g., SEIKEN vs TOYOTA) = DIFFERENT items UNLESS they are known OEM vs aftermarket cross-references for the exact same part.
3. Vendor prefixes in part numbers are common (e.g., SC-47575R and 47575R are the same part number). Strip vendor prefixes when comparing.
4. Parts with no overlapping part numbers but identical names may or may not be duplicates — be conservative.
5. If you are not confident, assign 'low' confidence. Do not guess.
6. A part can only belong to ONE group.

Parts to analyze:
${partsList}

Respond ONLY with a valid JSON object in this exact format:
{
  "groups": [
    {
      "partIds": [101, 102],
      "reason": "Both are RUBBER CUP (SEIKEN) with part number 47575R — SC-47575R and 47575R are the same number with a vendor prefix",
      "confidence": "high"
    }
  ]
}

Only include groups that contain 2 or more parts. Parts that are NOT duplicates of anything else should NOT appear in any group. If no duplicates are found, return { "groups": [] }.`;

        switch (this.provider) {
            case 'openai':
                return this._callOpenAIForGroup(prompt, partIds);
            case 'openrouter':
                return this._callOpenRouterForGroup(prompt, partIds);
            case 'google':
            default:
                return this._callGeminiForGroup(prompt, partIds);
        }
    }

    // Internal helper — calls Gemini and parses group response
    async _callGeminiForGroup(prompt, partIds) {
        if (this.geminiKeys.length === 0) {
            console.warn('[LLM] No Gemini API key. Returning empty groups.');
            return { groups: [], skipped: true };
        }
        const key = this.geminiKeys[this.geminiIndex];
        this.geminiIndex = (this.geminiIndex + 1) % this.geminiKeys.length;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${key}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(45000),
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
        }
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const result = JSON.parse(text);
        return this._validateGroupResult(result, partIds);
    }

    // Internal helper — calls OpenAI and parses group response
    async _callOpenAIForGroup(prompt, partIds) {
        if (!this.openaiKey) return { groups: [], skipped: true };
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiKey}` },
            signal: AbortSignal.timeout(45000),
            body: JSON.stringify({
                model: this.openaiModel,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });
        if (!response.ok) throw new Error(`OpenAI error ${response.status}`);
        const data = await response.json();
        const result = JSON.parse(data.choices?.[0]?.message?.content);
        return this._validateGroupResult(result, partIds);
    }

    // Internal helper — calls OpenRouter and parses group response
    async _callOpenRouterForGroup(prompt, partIds) {
        if (!this.openrouterKey && !this.openrouterModel) return { groups: [], skipped: true };
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'http://localhost:5173',
                'X-Title': 'Forson Business Suite',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(45000),
            body: JSON.stringify({
                model: this.openrouterModel,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });
        if (!response.ok) throw new Error(`OpenRouter error ${response.status}`);
        const data = await response.json();
        let text = data.choices?.[0]?.message?.content || '{}';
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const result = JSON.parse(text);
        return this._validateGroupResult(result, partIds);
    }

    /**
     * Validates the AI's group result — ensures part IDs are real and groups have ≥ 2 members.
     */
    _validateGroupResult(result, validPartIds) {
        const validIdSet = new Set(validPartIds);
        const groups = (result?.groups || [])
            .map(g => ({
                partIds: (g.partIds || []).filter(id => validIdSet.has(id)),
                reason: g.reason || '',
                confidence: ['high', 'medium', 'low'].includes(g.confidence) ? g.confidence : 'low'
            }))
            .filter(g => g.partIds.length >= 2);
        return { groups };
    }
}

module.exports = new LLMRouter();
